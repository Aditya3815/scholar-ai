import { MAX_LEFT, MAX_LEFT_CHARS, MAX_LEFT_PERSON, MAX_NOTE_PHRASE, detectLanguage, isRomanNumeralI, subjectWords, tidyWords, withoutLeft, type AnswerLanguage, type MessageReading as Reading, type NoteKind, type ReadingNote } from "@scholar/shared";
import * as W from "./frame-words";

/**
 * R8, the request-frame cleaner (docs/design/intent-and-state.md, 4.8 and 5.3). `readRequest(text, route)` reads one Auto message that is going to be searched and says which of its words are only a REQUEST
 * ("can you search about", "please", "all papers", "what is") and which are the TOPIC. Pure, deterministic, the same for everyone, server only. It changes nothing: it returns a Reading (the topic, the pieces
 * left out, the notes) and the route decides what to do with it (shadow counts it, `on` searches the topic).
 *
 * THE CONTRACT (each line is a test in frame.test.ts):
 *  - Only English (`detectLanguage` and the route both say "en"), one line of at most 300 characters, a search whose words no model made, not a bare DOI or arXiv number and not a message with an id in it (R13's).
 *  - EDGES ONLY. The words are taken from the start and from the end of the message, from closed lists (frame-words.ts), in at most three passes; nothing in the middle changes, except the one word
 *    "really" of "does X really cause Y" and, with the personal-details strip, the first-person words. A message that would still have something to take out after the third pass is left as written, so that
 *    cleaning twice is cleaning once (and the topic is read again before it is given: if it would change, the message is left alone).
 *  - NEVER GROWS: the topic is the message less pieces of it. Every piece is an exact piece of the message (`left`), found in order, and `topic == withoutLeft(message, left)`: the page makes the same topic
 *    from the same pieces, so putting one back is made from the Reading alone.
 *  - Type words (review, survey, trial, meta-analysis, systematic) are in no list, so they stay. A token with a hyphen, a digit, an inner capital or only capitals is never changed, a frame word written in
 *    capitals is no frame ("ALL papers"), and nothing inside quotes goes.
 *  - Fewer than two content words left (`subjectWords`): the message is left alone, unless only politeness, a greeting and trailing words were taken out (then one word is enough).
 *  - A Title Case message of three words or more keeps its question stem, its recency word and its kind word when no politeness and no request were taken before it ("What Is Life?").
 *  - The words left must not begin with a preposition or a conjunction, and must not end with one: a removal that would do that is not made ("list of lists", "plagiarism in research papers").
 *  - What the box cannot do is NAMED, not applied: quantity, recency, a trailing negation, form words, a trailing order, a threshold, "papers that prove" are taken out and named; an author and a venue are named and
 *    STAY in the words. An answer language asked for in words ("answer in Hindi") is applied: it is the language the writer is given.
 */

export type RouteLike = { mode?: unknown; language?: unknown; how?: unknown; searchQuery?: unknown };
export type RequestRead = {
  reading: Reading;
  /** False when nothing is left to search: the personal-details strip left fewer than two content words. The route then asks what to look up (S-NO-TOPIC) and does not search. */
  searchable: boolean;
};
export type ReadOptions = {
  /** R4's lane read a DECISION or CARE and acts at the flag's position: first-person words, ages and the relation after "my" go too. */
  person?: boolean;
};

/* ---------------------------------------------------------------- the patterns, built once from the lists */

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/['’]/g, "['’]");
/** A phrase of the lists as a pattern: its words with any white space between them. */
const phrase = (p: string): string => p.split(" ").map(escape).join(String.raw`\s+`);
/** The phrases of a list as one alternation, the longest first (so that "all the" is tried before "all"). */
const alt = (list: readonly string[]): string => [...list].sort((a, b) => b.length - a.length).map(phrase).join("|");

// a word starts where no letter, digit, hyphen or apostrophe comes before it, and ends where none comes after it (a hyphen continues a word: "new-onset", "all-trans"; "what" is not "what's")
const B = String.raw`(?<![\p{L}\p{M}\p{N}_'’-])`;
const E = String.raw`(?![\p{L}\p{M}\p{N}_-]|['’]\p{L})`;
const re = (source: string, flags = "iu"): RegExp => new RegExp(source, flags);

const NUM = String.raw`(?:\d{1,3}|${W.QUANTITY_NUMBER_WORDS.join("|")})`;
const PREPS = alt(W.KIND_PREPOSITIONS);
const KINDS = alt(W.KIND_WORDS);
const SINGULAR = new Set(["paper", "article", "study", "publication"]);

/* leading */
const L_GREETING = re(String.raw`^(?:${alt(W.GREETINGS)})${E}`);
const L_POLITE = re(String.raw`^(?:${alt(W.POLITE_LEAD)}|(?:${alt(W.REQUEST_MODALS)})\s+(?:${alt(W.YOU_WORDS)})(?:\s+(?:please|kindly))?)${E}`);
const L_VERBS = W.REQUEST_VERBS.map((v) => ({ ...v, re: re(String.raw`^${phrase(v.verb)}${E}`) }));
const L_SEARCH = re(String.raw`^search(?=\s+(?:${alt(W.SEARCH_BEFORE)})${E})${E}`);
const L_OBJECT = re(String.raw`^(?:me${E}|(?:${alt(W.DETERMINERS)})\s|${NUM}${E}|top\s+${NUM}${E}|best\s|(?:${alt(W.KIND_MODIFIERS)})\s+(?:${KINDS})${E}|(?:${KINDS})${E})`);
const L_KIND_OBJECT = re(String.raw`^(?:(?:${alt(W.DETERMINERS)})\s+)?(?:(?:${alt(W.KIND_MODIFIERS)})\s+)?(?:${KINDS})${E}`);
const L_QTY_TOP =re(String.raw`^(?:the\s+)?(?:top|first|best)\s+(${NUM})${E}(?!\s*(?:%|(?:${alt(W.NOT_A_QUANTITY_UNITS)})${E}))`);
const L_QTY_KIND = re(String.raw`^(${NUM}\s+(?:(?:best|top)\s+)?(?:papers|articles|studies|results|references|publications))\s+(?:${PREPS})${E}`);
const L_KIND = re(String.raw`^(?:(${alt(W.DETERMINERS)})\s+)?(?:(?:${alt(W.KIND_MODIFIERS)})\s+)?(${KINDS})\s+(?:${PREPS})${E}`);
const L_LIST_OF = re(String.raw`^(?:${alt(W.LIST_OF)})(?:\s+(?:${KINDS})(?:\s+(?:${PREPS}))?)?${E}`);
const L_PROVE = re(String.raw`^(?:(?:(?:${alt(W.PROVE_HEADS)})\s+)?(?:that|which)\s+(?:${alt(W.PROVE_VERBS)})|(?:${alt(W.PROVE_HEADS)})\s+(?:dis)?proving)(?:\s+(?:that|it|this))?${E}`);
const L_FORM = re(String.raw`^(?:${alt(W.FORM_LEADING)})${E}`);
const L_RECENCY_ON = re(String.raw`^(${alt(W.RECENCY)})\s+(?:on|about|regarding|concerning)${E}`);
const L_STEM = re(String.raw`^(?:${alt(W.QUESTION_STEMS)})${E}`);
const L_DOES = re(String.raw`^does${E}(?=\s(?:\S+\s+){1,6}?really\s+cause${E})`);
const L_RECENCY = re(String.raw`^(${alt(W.RECENCY)})(?=\s+\p{L})${E}`);

/* trailing (each is matched at the end of the words, with the marks that end a sentence cut off; its first group is the piece, which ends the match) */
const T_POLITE = re(String.raw`${B}(${alt(W.POLITE_TRAIL)})$`);
const T_FRAME = re(String.raw`${B}(${alt(W.TRAIL_FRAME)})$`);
const T_ALL = re(String.raw`${B}(${alt(W.TRAIL_ALL)})$`);
const T_QTY = re(String.raw`${B}((?:top|first)\s+${NUM}(?:\s+(?:research\s+)?(?:papers|articles|studies|results|references|publications))?)$`);
const T_LANG = re(String.raw`${B}((?:${alt(W.ANSWER_VERBS)})\s+(?:(?:it|that|this)\s+)?in\s+(${Object.keys(W.ANSWER_LANGUAGE_NAMES).join("|")}))$`);
const T_FORM = re(String.raw`${B}((?:${alt(W.FORM_LEAD)})\s+(?:(?:a|an|the)\s+)?(?:${alt(W.FORM_WORDS)})|${alt(W.FORM_SHORT)})$`);
// "short" or "brief" as the last word, after a comma or not ("gestational diabetes diet short")
const T_FORM_COMMA = re(String.raw`(?:[,;]\s*|\s+)(short|brief)$`);
const MEASURE = alt(W.THRESHOLD_MEASURES);
const COMPARE = alt(W.THRESHOLD_COMPARATORS);
const AMOUNT = String.raw`\d[\d,.]*`;
const WITH = String.raw`(?:(?:with|having|where|that\s+have|of)\s+)?`;
const T_THRESHOLD = [
  // "with sample size above 1000", "participants over 500", "with n > 200"
  re(String.raw`${B}(${WITH}(?:a\s+)?(?:${MEASURE})\s+(?:${COMPARE})\s+${AMOUNT}(?:\s+(?:${alt(W.THRESHOLD_COUNT_UNITS)}))?)$`),
  // "with over 500 patients", "at least 300 patients enrolled"
  re(String.raw`${B}(${WITH}(?:${COMPARE})\s+${AMOUNT}\s+(?:${alt(W.THRESHOLD_COUNT_UNITS)})(?:\s+(?:enrolled|included|recruited|per\s+arm|each))?)$`),
  // "at least 5 years of follow-up", "minimum 3 years follow up": a time is a threshold only when it is a time of follow-up ("children under 5 years" is a population)
  re(String.raw`${B}(${WITH}(?:${COMPARE})\s+${AMOUNT}\s+(?:${alt(W.THRESHOLD_TIME_UNITS)})\s+(?:of\s+)?(?:follow[- ]?up|data|observation))$`),
];
const PROVING = String.raw`(?:(?:that|which)\s+(?:${alt(W.PROVE_VERBS)})|(?:dis)?proving)(?:\s+(?:that|it|this))?`;
// (a request word that stood before it goes with it: "..., give me papers that prove it" must not leave "give me" at the end)
const T_PROVE = re(String.raw`${B}((?:(?:(?:give|show|find|tell|get)\s+me|find)\s+)?(?:${alt(W.PROVE_HEADS)})\s+${PROVING})$`);
const T_NEGATION = new RegExp(String.raw`${B}(${alt(W.NEGATION_WORDS)})(?=\s+[\p{L}\p{N}])`, "giu");
const ORDERS = [
  String.raw`${B}(?:${alt(W.ORDER_VERBS)})\s+(?:(?:all|any|the|your|my|these|those)\s+){0,2}(?:(?:previous|prior|above|earlier|preceding|initial|original)\s+)?(?:${alt(W.ORDER_OBJECTS)})${E}`,
  String.raw`${B}(?:${alt(W.ORDER_VERBS)})\s+everything${E}`,
  String.raw`${B}(?:${alt(W.ORDER_VERBS)})\s+(?:(?:all|everything|any|the)\s+){0,2}(?:of\s+)?(?:the\s+)?(?:above|previous|prior|earlier|preceding)(?=\s*$|\s*[.,;:!?]|\s+(?:and|then)${E})`,
  String.raw`${B}forget\s+(?:all|everything)\s+(?:of\s+)?(?:that|this)${E}`,
  String.raw`${B}ignore\s+what\s+(?:i|you)\s+(?:said|wrote|told)${E}`,
  String.raw`${B}(?:${alt(W.ORDER_PRINT_VERBS)})\s+(?:me\s+)?(?:(?:your|the)\s+(?:system|hidden|initial|original|secret)\s+|your\s+)(?:${alt(W.ORDER_PRINT_OBJECTS)})${E}`,
  String.raw`${B}you\s+are\s+now${E}`,
  String.raw`${B}forget\s+what\s+you\s+(?:were\s+told|have\s+been\s+told|know|said)${E}`,
  String.raw`${B}forget\s+the\s+(?:search|question|topic|papers)${E}`,
  String.raw`${B}print\s+the\s+(?:text|words|message)\s+above${E}`,
  String.raw`${B}system\s+prompt\s*:`,
];
const T_ORDER = new RegExp(ORDERS.join("|"), "iu");
const ORDER_CONNECTIVE = /(?:^|[\s,;.])(?:and|then|also|but)\s*$/iu;

/* notes that stay in the words */
const NAME = String.raw`\p{Lu}[\p{L}'’-]*\.?`;
// "by Geoffrey Hinton" after a word like "papers" or "work"; and, with no such word, a name of two capitalised words or more ("endogenous growth theory by Paul Romer"), unless the message is Title Case
const AUTHOR = new RegExp(String.raw`${B}(by\s+(?:(?:Dr|Prof|Professor)\.?\s+)?${NAME}(?:\s+${NAME}){0,3}(?:\s+et\s+al\.?)?)`, "u");
const AUTHOR_NAME_ONLY = new RegExp(String.raw`(?<=[\p{Ll}\p{N}]\s)(by\s+(?:(?:Dr|Prof|Professor)\.?\s+)?${NAME}(?:\s+${NAME}){1,3})`, "u");
const AUTHOR_HEAD = re(String.raw`${B}(?:${alt(W.AUTHOR_HEADS)})\s+$`);
const CAPS_RUN = String.raw`(?:\p{Lu}[\p{L}&'’.-]*(?:\s+(?:of|and|for|the|in|on)\s+|\s+))`;
const NAME_ENDS = String.raw`(?=\s*$|\s*[,.;:)]|\s+(?:on|about|and|for|that|which|between|from|since|after|before)${E})`;
const VENUE = [
  // "in the Indian Journal of Medical Research", "published in Proceedings of ...": a capitalised name that ends in a journal word
  new RegExp(String.raw`${B}((?:published\s+in|in|from)\s+(?:the\s+|The\s+)?(?:${CAPS_RUN}){0,5}(?:${W.VENUE_NOUNS.join("|")})(?:\s+(?:of|on|in|for)\s+(?:\p{Lu}[\p{L}&'’.-]*\s*){1,4})?)`, "u"),
  // "published in Nature Structural Biology": "published in" and a capitalised name
  new RegExp(String.raw`${B}(published\s+in\s+(?:the\s+|The\s+)?(?:${CAPS_RUN}){1,5})`, "u"),
  // "published in Nature", "in The Lancet"
  new RegExp(String.raw`${B}((?:published\s+in|in)\s+(?:the\s+|The\s+)?(?:${W.VENUE_NAMES.map(escape).join("|")}))${NAME_ENDS}`, "u"),
  // "from AIIMS Delhi", "at IIT Bombay"
  new RegExp(String.raw`${B}((?:from|at)\s+(?:the\s+)?(?:${W.INSTITUTION_NAMES.join("|")})(?:\s+\p{Lu}[\p{L}-]*)?)${E}`, "u"),
  // "from the University of Oxford", "at Johns Hopkins University"
  new RegExp(String.raw`${B}((?:from|at)\s+(?:the\s+)?(?:${CAPS_RUN}){0,3}(?:${W.INSTITUTION_NOUNS.join("|")})(?:\s+of\s+(?:\p{Lu}[\p{L}-]*\s*){1,3})?)${E}`, "u"),
];

/* the personal-details strip */
const REL = alt(W.RELATIONS);
const AGE_UNIT = String.raw`\d{1,3}(?:\s*-\s*|\s+)?(?:years?|yrs?)(?:\s*-\s*|\s+)?old`;
const NOT_MORE_NUMBER = String.raw`(?![\p{L}\p{M}\p{N}%.-])`;
const PERSON_UNITS = [
  // "I am 34 years old", "I'm 34", "I am 34" (a person's own age)
  re(String.raw`${B}(?:i\s+am|i['’]m)\s+(?:${AGE_UNIT}|\d{1,3}(?:\s*(?:yo|y\/o))?${NOT_MORE_NUMBER})`, "giu"),
  re(String.raw`${B}my\s+\d{1,3}(?:\s*-\s*|\s+)?(?:years?|yrs?|months?|weeks?)(?:\s*-\s*|\s+)?old`, "giu"),
  re(String.raw`${B}(?:aged?\s+\d{1,3}${NOT_MORE_NUMBER}|${AGE_UNIT}|\d{1,3}\s*(?:yo|y\/o)${E})`, "giu"),
  re(String.raw`${B}my\s+(?:${REL})${E}`, "giu"),
  re(String.raw`${B}(?:i\s+am|i['’](?:m|ve|d|ll))${E}`, "giu"),
  re(String.raw`${B}(?:${W.FIRST_PERSON_WORDS.join("|")})${E}`, "giu"),
  re(String.raw`${B}i${E}(?![./&]\p{L})`, "giu"),
];

/* ---------------------------------------------------------------- the passes */

type Kind = "polite" | "verb" | "qty" | "kind" | "prove" | "stem" | "recent" | "trail" | "all" | "lang" | "form" | "threshold" | "order" | "negation" | "person";
type Span = { from: number; to: number; kind: Kind; note?: ReadingNote; lang?: AnswerLanguage };
/** The kinds that may go and leave a single content word: politeness, a greeting and trailing words (4.8). */
const LIGHT: ReadonlySet<Kind> = new Set<Kind>(["polite", "trail", "all"]);
/**
 * The kinds that a title does not lose unless a politeness or a request was taken before them: a Title Case message keeps its question stem ("What Is Life?", the plan), and a title with a subtitle round a colon
 * keeps its stem, its recency word and its kind word.
 */
const CASE_KEEPS: ReadonlySet<Kind> = new Set<Kind>(["stem"]);
const SUBTITLE_KEEPS: ReadonlySet<Kind> = new Set<Kind>(["stem", "recent", "kind"]);
type TitleStyle = "case" | "subtitle" | null;
const MAX_PASSES = 3;
const MAX_CHARS = 300;

const NOT_START: ReadonlySet<string> = new Set(W.NOT_AT_START);
const NOT_END: ReadonlySet<string> = new Set(W.NOT_AT_END);
const TITLE_SMALL: ReadonlySet<string> = new Set(W.TITLE_SMALL_WORDS);
// an id: a DOI, an arXiv number (a month from 01 to 12), an old-style arXiv id, a PubMed number after "pmid" or "pubmed"
const ID_IN_TEXT = /(?<![\p{L}\p{M}\p{N}_.])10\.\d{4,9}\/\S|(?<![\p{L}\p{N}.])\d{2}(?:0[1-9]|1[0-2])\.\d{4,5}(?:v\d+)?(?![\p{N}])|(?:pmid|pubmed)\s*[:#]?\s*\d{6,9}|(?<![\p{L}\p{N}.])[a-z]+(?:-[a-z]+)?\/\d{7}(?![\p{N}])/iu;
// an e-mail address or a link: R11's, not ours
const ADDRESS = /@|:\/\/|(?:^|[\s(])www\./i;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const firstWord = (s: string): string => /^[^\p{L}\p{N}]*([\p{L}\p{N}'’-]+)/u.exec(s)?.[1]?.toLowerCase() ?? "";
const lastWord = (s: string): string => /([\p{L}\p{N}'’-]+)[^\p{L}\p{N}]*$/u.exec(s)?.[1]?.toLowerCase() ?? "";
const allCaps = (s: string): boolean => /\p{L}{2}/u.test(s) && s === s.toUpperCase() && s !== s.toLowerCase();
/** Does a piece hold a word that is written in capitals ("ALL papers")? A frame word in capitals is not a frame. */
const hasCapsWord = (s: string): boolean => (s.match(/[\p{L}\p{N}'’-]+/gu) ?? []).some(allCaps);
/** A phrase for a note: at most MAX_NOTE_PHRASE characters, cut at a word, with the marks that end a sentence off its end. */
function notePhrase(s: string): string {
  let p = s.replace(/[\s.,;:!?)\]}'"’”…]+$/u, "");
  if (p.length > MAX_NOTE_PHRASE) {
    const cut = p.lastIndexOf(" ", MAX_NOTE_PHRASE);
    p = p.slice(0, cut > 0 ? cut : MAX_NOTE_PHRASE);
  }
  return p;
}

/** The regions of the message that are inside quotes (double quotes, straight or curly): a word there is never taken out. A single quote counts only as a pair round a word ('give me'), never as an apostrophe. */
function quotedRegions(t: string): [number, number][] {
  const out: [number, number][] = [];
  const close = new Map<string, string>([['"', '"'], ["“", "”"], ["„", "“"], ["«", "»"]]);
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    const closer = close.get(c);
    if (closer !== undefined) {
      const j = t.indexOf(closer, i + 1);
      if (j < 0) {
        out.push([i, t.length]);
        break;
      }
      out.push([i, j + 1]);
      i = j;
    } else if (c === "'" && (i === 0 || /[\s(]/.test(t[i - 1]!)) && /\p{L}/u.test(t[i + 1] ?? "")) {
      for (let j = i + 2; j < t.length; j++) {
        if (t[j] === "'" && !/\p{L}/u.test(t[j + 1] ?? "")) {
          out.push([i, j + 1]);
          i = j;
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Does the message look like the title of a work: Title Case with three words or more (every word that is not a small word begins with a capital), or a title and a subtitle round a colon
 * ("how to conduct a bibliometric analysis: an overview and guidelines")? A Title Case message keeps its question stem, and one with a subtitle also its recency word and its kind word, unless a politeness or a request was taken before them.
 */
function titleStyle(t: string): TitleStyle {
  if (/[\p{L}\p{N}]: [\p{L}\p{N}]/u.test(t) && t.split(/\s+/).length >= 5) return "subtitle";
  const words = t.match(/\p{L}[\p{L}'’-]*/gu) ?? [];
  if (words.length < 3) return null;
  const big = words.filter((w) => !TITLE_SMALL.has(w.toLowerCase()));
  return big.length >= 2 && big.every((w) => /^\p{Lu}/u.test(w)) && t !== t.toUpperCase() ? "case" : null;
}

type State = { start: number; end: number; spans: Span[] };

/**
 * One trial of the passes over `t`, taking only the kinds in `only` (all when null). Returns the state, or null if a fourth pass could still take something out (the message is then left as written).
 * A pass takes, at the start, what stands there from the lists of leading frames in turn (a greeting, politeness, a request, a stem, a recency word, a quantity, a kind of thing, "papers that prove") and, at the
 * end, what stands there from the lists of trailing frames in turn; a pass that took nothing is the last.
 */
function passes(t: string, only: ReadonlySet<Kind> | null, quotes: [number, number][], title: TitleStyle): State | null {
  const st: State = { start: 0, end: t.length, spans: [] };
  const inQuotes = (from: number, to: number) => quotes.some(([a, b]) => from < b && to > a);
  const ok = (kind: Kind) => (only === null || only.has(kind)) && !(title !== null && (title === "subtitle" ? SUBTITLE_KEEPS : CASE_KEEPS).has(kind) && !st.spans.some((s) => s.kind === "polite" || s.kind === "verb"));
  /** The marks that hold a piece in place are skipped; a span is exactly the piece. */
  const skipLead = () => {
    while (st.start < st.end && /[\s,;:!]/.test(t[st.start]!)) st.start++;
  };
  const trimTail = () => {
    while (st.end > st.start && /[\s.,;:!?)\]}'"’”…]/u.test(t[st.end - 1]!)) st.end--;
  };
  const lead = (len: number, kind: Kind, extra: Partial<Span> = {}): boolean => {
    if (!ok(kind) || len <= 0) return false;
    const from = st.start;
    const to = from + len;
    if (hasCapsWord(t.slice(from, to)) || inQuotes(from, to)) return false;
    const rest = t.slice(to, st.end);
    if (!LETTER_OR_DIGIT.test(rest) || NOT_START.has(firstWord(rest))) return false;
    st.spans.push({ from, to, kind, ...extra });
    st.start = to;
    skipLead();
    return true;
  };
  /** `marker`: where the words that make the clause what it is end, when the rest of it is the person's own words (the topic of a negation, an order): only the marker is held to the rule about capitals. */
  const trail = (from: number, kind: Kind, extra: Partial<Span> = {}, marker?: number): boolean => {
    if (!ok(kind) || from < st.start) return false;
    const to = st.end;
    if (hasCapsWord(t.slice(from, marker ?? to)) || inQuotes(from, to)) return false;
    const rest = t.slice(st.start, from);
    if (!LETTER_OR_DIGIT.test(rest) || NOT_END.has(lastWord(rest))) return false;
    st.spans.push({ from, to, kind, ...extra });
    st.end = from;
    trimTail();
    return true;
  };
  const rest = (): string => t.slice(st.start, st.end);
  /** Where the piece of a trailing match begins: its first group ends the match, so it is the end of the match less its own length. */
  const pieceAt = (m: RegExpExecArray): number => st.start + m.index + m[0].length - m[1]!.length;
  const sweep = (): boolean => {
    let moved = false;
    skipLead();
    trimTail();
    // ---- the start
    let m: RegExpExecArray | null;
    if ((m = L_GREETING.exec(rest()))) moved = lead(m[0].length, "polite") || moved;
    if ((m = L_POLITE.exec(rest()))) moved = lead(m[0].length, "polite") || moved;
    for (const v of L_VERBS) {
      const r = rest();
      const found = v.re.exec(r);
      if (!found) continue;
      const after = r.slice(found[0].length).replace(/^\s+/, "");
      if (v.against?.includes(firstWord(after))) continue;
      if (v.needsKind && !L_KIND_OBJECT.test(after)) continue;
      // "list" and the like ask for papers only with an object ("list papers on", "list me") or after politeness ("can you list ..."); "list price" is a topic
      if (v.needsObject && !L_OBJECT.test(after) && !st.spans.some((sp) => sp.kind === "polite")) continue;
      moved = lead(found[0].length, "verb") || moved;
      break;
    }
    if ((m = L_SEARCH.exec(rest()))) moved = lead(m[0].length, "verb") || moved;
    // a stem takes the place of a request: "what is", "how to"; and "does X really cause" (the question word and "really" go, "cause" stays)
    if (L_DOES.test(rest())) {
      const r = rest();
      const really = /\sreally\s+cause/i.exec(r);
      if (really && ok("stem")) {
        const dFrom = st.start;
        const rFrom = st.start + really.index + 1;
        if (!hasCapsWord(t.slice(dFrom, dFrom + 4)) && !hasCapsWord("really") && !inQuotes(dFrom, dFrom + 4) && !inQuotes(rFrom, rFrom + 6) && !NOT_START.has(firstWord(t.slice(dFrom + 4, rFrom)))) {
          st.spans.push({ from: dFrom, to: dFrom + 4, kind: "stem" }, { from: rFrom, to: rFrom + 6, kind: "stem" });
          st.start = dFrom + 4;
          skipLead();
          moved = true;
        }
      }
    } else if ((m = L_STEM.exec(rest()))) moved = lead(m[0].length, "stem") || moved;
    if ((m = L_RECENCY_ON.exec(rest()))) {
      // "latest on X": the preposition goes with the word
      moved = lead(m[0].length, "recent", { note: { kind: "recent", phrase: m[1]! } }) || moved;
    } else if ((m = L_RECENCY.exec(rest()))) {
      const word = m[1]!;
      const next = /^\s+(\p{L}[\p{L}'’-]*)/u.exec(rest().slice(m[0].length))?.[1];
      // "New York", "New Delhi", "new public management": a name, not a word about time
      const name = word.toLowerCase() === "new" && next !== undefined && (/^\p{Lu}/u.test(next) || W.NEW_NAMES.includes(next.toLowerCase()));
      if (!name) moved = lead(m[0].length, "recent", { note: { kind: "recent", phrase: word } }) || moved;
    }
    if ((m = L_QTY_TOP.exec(rest()))) {
      moved = lead(m[0].length, "qty", { note: { kind: "count", phrase: rest().slice(0, m[0].length).replace(/^the\s+/i, "") } }) || moved;
    } else if ((m = L_QTY_KIND.exec(rest()))) {
      // "10 papers on": the number, the kind word and the preposition go as one piece, and the note names the number and the kind word
      moved = lead(m[0].length, "qty", { note: { kind: "count", phrase: m[1]! } }) || moved;
    }
    if ((m = L_KIND.exec(rest()))) {
      // a singular kind word ("a study of") is a request only after something else was asked of the box ("find a study of X"): at the very start it is a title
      if (!SINGULAR.has(m[2]!.toLowerCase()) || st.spans.length > 0) {
        const all = m[1] !== undefined && W.ALL_DETERMINERS.includes(m[1].toLowerCase().replace(/\s+/g, " "));
        moved = lead(m[0].length, "kind", all ? { note: { kind: "all" } } : {}) || moved;
      }
    } else if ((m = L_LIST_OF.exec(rest()))) moved = lead(m[0].length, "kind") || moved;
    if ((m = L_FORM.exec(rest()))) moved = lead(m[0].length, "form", { note: { kind: "form", phrase: notePhrase(rest().slice(0, m[0].length)) } }) || moved;
    if ((m = L_PROVE.exec(rest()))) moved = lead(m[0].length, "prove", { note: { kind: "prove", phrase: notePhrase(rest().slice(0, m[0].length)) } }) || moved;
    // ---- the end
    trimTail();
    const tail = (r: RegExp): RegExpExecArray | null => r.exec(rest());
    // "papers please" is one piece, so the trailing frame is looked at before the politeness, and once more after it ("for me please", "if possible, thanks")
    if ((m = tail(T_FRAME))) moved = trail(pieceAt(m), "trail") || moved;
    if ((m = tail(T_POLITE))) moved = trail(pieceAt(m), "polite") || moved;
    if ((m = tail(T_FRAME))) moved = trail(pieceAt(m), "trail") || moved;
    if ((m = tail(T_ALL))) moved = trail(pieceAt(m), "all", { note: { kind: "all" } }) || moved;
    if ((m = tail(T_LANG))) moved = trail(pieceAt(m), "lang", { lang: W.ANSWER_LANGUAGE_NAMES[m[2]!.toLowerCase()] }) || moved;
    if ((m = tail(T_QTY))) moved = trail(pieceAt(m), "qty", { note: { kind: "count", phrase: m[1]! } }) || moved;
    if ((m = tail(T_FORM) ?? tail(T_FORM_COMMA))) moved = trail(pieceAt(m), "form", { note: { kind: "form", phrase: notePhrase(m[1]!) } }) || moved;
    // a trailing order: from the first order phrase of the last 160 characters to the end, with the word that joined it ("and") taken too
    {
      const r = rest();
      const near = Math.max(0, r.length - 160);
      const o = T_ORDER.exec(r.slice(near));
      if (o && ok("order")) {
        let from = near + o.index;
        const join = ORDER_CONNECTIVE.exec(r.slice(0, from));
        if (join) from -= join[0].replace(/^[\s,;.]+/u, "").length;
        if (from > 0) moved = trail(st.start + from, "order", { note: { kind: "order" } }, st.start + near + o.index + o[0].length) || moved;
      }
    }
    for (const rx of T_THRESHOLD) {
      if ((m = tail(rx))) {
        moved = trail(pieceAt(m), "threshold", { note: { kind: "threshold", phrase: notePhrase(m[1]!) } }) || moved;
        break;
      }
    }
    // a trailing negation: "but not X", "without X", "excluding X", in at most five more words and no sentence end
    {
      const r = rest();
      for (const n of r.matchAll(T_NEGATION)) {
        const from = n.index;
        const after = r.slice(from + n[0].length);
        if (r.slice(0, from).trim() === "" || /[.;!?]/.test(after) || after.split(/\s+/).filter(Boolean).length > W.NEGATION_MAX_WORDS) continue;
        moved = trail(st.start + from, "negation", { note: { kind: "negation", phrase: notePhrase(r.slice(from)) } }, st.start + from + n[0].length) || moved;
        break;
      }
    }
    if ((m = tail(T_PROVE))) moved = trail(pieceAt(m), "prove", { note: { kind: "prove", phrase: notePhrase(m[1]!) } }) || moved;
    return moved;
  };
  let did = 0;
  while (did < MAX_PASSES && sweep()) did++;
  // a fourth pass that could still take something: the message is not a frame that three passes can read, and is left as written
  if (did === MAX_PASSES && sweep()) return null;
  return st;
}

/** The pieces of the personal-details strip: first-person words, an age, and the relation after "my", found in what is left between the edges (not inside quotes, not a Roman numeral "I"). */
function personSpans(t: string, st: State, quotes: [number, number][]): Span[] {
  const out: Span[] = [];
  const taken = (from: number, to: number) => out.some((s) => from < s.to && to > s.from) || st.spans.some((s) => from < s.to && to > s.from) || quotes.some(([a, b]) => from < b && to > a);
  const body = t.slice(st.start, st.end);
  for (const rx of PERSON_UNITS) {
    rx.lastIndex = 0;
    for (const m of body.matchAll(rx)) {
      const from = st.start + m.index;
      let to = from + m[0].length;
      const text = m[0];
      if (allCaps(text)) continue;
      if (/^i$/i.test(text) && isRomanNumeralI(t, from)) continue;
      // "I am 34 years old and pregnant ...": the "and" that joins the personal clause to the rest of the message goes with it, at the very start only
      if (from === st.start && /\d|am\b|['’]m\b/i.test(text)) {
        const join = /^\s*,?\s*(?:and|but)(?=\s)/i.exec(t.slice(to, st.end));
        if (join) to += join[0].length;
      }
      if (taken(from, to)) continue;
      out.push({ from, to, kind: "person" });
    }
  }
  return out.sort((a, b) => a.from - b.from);
}

/** The author and the venue the words still carry: found in the stretches between the pieces, and named with the piece of the message that says it. */
function keptNotes(t: string, st: State, quotes: [number, number][], title: TitleStyle): ReadingNote[] {
  const notes: ReadingNote[] = [];
  const segments: [number, number][] = [];
  let at = st.start;
  for (const s of [...st.spans].sort((a, b) => a.from - b.from)) {
    if (s.from >= st.start && s.to <= st.end) {
      if (s.from > at) segments.push([at, s.from]);
      at = Math.max(at, s.to);
    }
  }
  if (at < st.end) segments.push([at, st.end]);
  const inQuotes = (from: number, to: number) => quotes.some(([a, b]) => from < b && to > a);
  for (const [a, b] of segments) {
    const seg = t.slice(a, b);
    const author = AUTHOR.exec(seg);
    const named = title === "case" ? null : AUTHOR_NAME_ONLY.exec(seg);
    if (author && AUTHOR_HEAD.test(t.slice(Math.max(0, a + author.index - 24), a + author.index)) && !inQuotes(a + author.index, a + author.index + author[1]!.length)) notes.push({ kind: "author", phrase: notePhrase(author[1]!) });
    else if (named && !inQuotes(a + named.index, a + named.index + named[1]!.length)) notes.push({ kind: "author", phrase: notePhrase(named[1]!) });
    for (const rx of VENUE) {
      const v = rx.exec(seg);
      if (!v || inQuotes(a + v.index, a + v.index + v[1]!.length)) continue;
      notes.push({ kind: "venue", phrase: notePhrase(v[1]!) });
      break;
    }
  }
  return notes;
}

/** The pieces (`left`) of the message, from the spans: those that touch (only white space between them) are one piece when it fits, and a piece that is too long is cut at a word. */
function pieces(t: string, spans: Span[]): string[] | null {
  const sorted = [...spans].sort((a, b) => a.from - b.from);
  const merged: { from: number; to: number }[] = [];
  for (const s of sorted) {
    const last = merged.at(-1);
    if (last && t.slice(last.to, s.from).trim() === "" && s.to - last.from <= MAX_LEFT_CHARS) last.to = s.to;
    else merged.push({ from: s.from, to: s.to });
  }
  const out: string[] = [];
  for (const m of merged) {
    let from = m.from;
    while (m.to - from > MAX_LEFT_CHARS) {
      const cut = t.lastIndexOf(" ", from + MAX_LEFT_CHARS);
      if (cut <= from) return null;
      out.push(t.slice(from, cut));
      from = cut + 1;
    }
    out.push(t.slice(from, m.to));
  }
  return out;
}

const NOTE_ORDER: Record<NoteKind, number> = { all: 0, recent: 1, count: 2, negation: 3, form: 4, order: 5, author: 6, venue: 7, threshold: 8, prove: 9, person: 10 };

/** The Reading of one set of spans, or null when it does not hold together (a piece cannot be found again in order, the topic is not the message less the pieces). */
function build(t: string, spans: Span[], extra: ReadingNote[]): RequestRead | null {
  const left = pieces(t, spans);
  const personal = spans.some((s) => s.kind === "person");
  if (!left || left.length > (personal ? MAX_LEFT_PERSON : MAX_LEFT)) return null;
  // the topic the spans make is the topic the pieces make: the page makes it again from the pieces alone
  const blank = [...t];
  for (const s of spans) for (let i = s.from; i < s.to; i++) blank[i] = " ";
  const topic = tidyWords(blank.join(""));
  if (topic === "" || withoutLeft(t, left) !== topic) return null;
  const found: { n: ReadingNote; at: number }[] = [];
  for (const s of spans) if (s.note) found.push({ n: s.note, at: s.from });
  for (const n of extra) found.push({ n, at: n.phrase === undefined ? 0 : t.indexOf(n.phrase) });
  found.sort((a, b) => a.at - b.at || NOTE_ORDER[a.n.kind] - NOTE_ORDER[b.n.kind]);
  const notes: ReadingNote[] = [];
  const seen = new Set<NoteKind>();
  for (const { n } of found) {
    if (seen.has(n.kind)) continue;
    seen.add(n.kind);
    notes.push(n.phrase === undefined ? { kind: n.kind } : { kind: n.kind, phrase: n.phrase });
  }
  if (personal) notes.push({ kind: "person" });
  const lang = spans.find((s) => s.lang)?.lang;
  const reading: Reading = { v: 1, source: "rules", topic, left, notes, ...(lang ? { answerLanguage: lang } : {}) };
  const content = subjectWords(topic).length;
  // one word is enough when only politeness, a greeting and trailing words went; otherwise two
  const searchable = content >= 2 || (spans.every((s) => LIGHT.has(s.kind)) && content >= 1);
  return { reading, searchable };
}

function readInner(text: string, route: RouteLike, options: ReadOptions, again: boolean): RequestRead | null {
  if (route.mode !== "search" || route.language !== "en" || route.how === "chosen") return null;
  if (typeof route.searchQuery === "string" && route.searchQuery !== "") return null;
  if (typeof text !== "string" || /[\n\r]/.test(text)) return null;
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length < 2 || t.length > MAX_CHARS) return null;
  if (detectLanguage(t) !== "en" || ID_IN_TEXT.test(t) || ADDRESS.test(t)) return null;
  const quotes = quotedRegions(t);
  const title = titleStyle(t);

  const edges = passes(t, null, quotes, title);
  if (edges === null) return null;
  const strip = options.person ? personSpans(t, edges, quotes) : [];
  const spans = [...edges.spans, ...strip];
  const kept = keptNotes(t, { ...edges, spans }, quotes, title);
  // nothing taken out: a message that only names an author or a venue still has its note, and its words are its own
  if (spans.length === 0) return kept.length > 0 ? { reading: { v: 1, source: "rules", topic: t, left: [], notes: kept }, searchable: true } : null;

  let result: RequestRead | null = null;
  const asked = build(t, spans, kept);
  if (asked && asked.searchable) result = asked;
  else if (asked && strip.length > 0) result = { reading: asked.reading, searchable: false };
  else {
    // too little left: only politeness, a greeting and trailing words may go, and one word is enough
    const light = passes(t, LIGHT, quotes, title);
    if (light && light.spans.length > 0) {
      const lightSpans = [...light.spans, ...strip];
      const r = build(t, lightSpans, keptNotes(t, { ...light, spans: lightSpans }, quotes, title));
      if (r && r.searchable) result = r;
    }
  }
  if (!result) return null;
  // cleaning the topic again must change nothing: if it would, the message is left as it was written
  if (!again && result.searchable) {
    const second = readInner(result.reading.topic, route, options, true);
    if (second && (second.reading.topic !== result.reading.topic || second.reading.left.length > 0)) return null;
  }
  return result;
}

/** The Reading of an Auto message that is going to be searched, or null when the message is left exactly as it was written and nothing is said about it. Never throws. */
export function readRequest(text: string, route: RouteLike, options: ReadOptions = {}): RequestRead | null {
  try {
    return readInner(text, route ?? {}, options, false);
  } catch {
    return null;
  }
}

const AS_SEARCH: RouteLike = { mode: "search", language: "en", how: "rules" };
/** String in, string out: the words searched for a plain English one-line Auto message (the message itself, with its white space tidied, when it is left alone). The same as `readRequest(text, search)?.reading.topic`. */
export function cleanRequest(text: string, options: ReadOptions = {}): string {
  const t = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
  return readRequest(text, AS_SEARCH, options)?.reading.topic ?? t;
}
