import { subjectWords } from "@scholar/shared";

/**
 * R3: what a message in the prompt box LOOKS like, as names from a closed list, so that how often messages are messy can be counted without keeping any of their text
 * (docs/design/intent-and-state.md, 4.4 and 5.3). The names are all that leaves this function: never a piece of the text, so that nothing about a person can reach a count, a bound value or a log.
 *
 * Phase 0 gives only the names that the text alone can define today. The rest are reserved in the list and NOT given here, because their definition needs a module of a later release: `lane_*` (the
 * safety lane, R4, and the not-a-search lane, R10), `cue_*` (the tool cues, R15), `ask_*` (the acronym and broad-field tables, R17), `spell_candidate` (the speller, R12), and the names that
 * exist only after the search (`one_source`, `tier_none`, `tier_few`) or on a hand-chosen search (`anyway`). A test pins that none of them is given.
 *
 * Each name below is the plan's own definition, read in the most conservative way where the plan leaves it open (fewer false names, every doubt written where the pattern is). The definitions
 * stay fixed once counting starts: a later change of a definition breaks the series, so it gets a new name instead. Pure, the same for everyone, English patterns (Hindi and Hinglish have only the first
 * person), and total: it never throws. Linear in the length of the text: no pattern scans a long run of spaces, letters or digits again from each position in it, and the test reads 20,000 and
 * 200,000 characters of every kind of run that could hurt.
 */
export const INPUT_SHAPE_NAMES = [
  "frame", "frame_polite", "frame_all", "qty", "year", "neg", "order", "long", "first_person",
  "subj0", "subj1", "subj2_6", "subj7p", "id",
  "lane_urgent", "lane_crisis", "lane_decision", "lane_care", "lane_notsearch",
  "cue_paper", "cue_list", "cue_paste", "ask_acronym", "ask_broad", "spell_candidate", "scrub",
  "one_source", "tier_none", "tier_few", "anyway",
  // R4 (4.5): the help tier of the safety lane, and what the lane would have done while it is only being read (`would_*`: shadow, and the phrases that are not yet acted on at `core`). Counted by the route, not given by `inputShape`.
  "lane_help", "would_urgent", "would_crisis", "would_help", "would_decision", "would_care",
  // R8 (4.8): what the request-frame cleaner did to an Auto message (`clean_applied`: CHAT_CLEAN on) or would have done (`would_clean`: shadow). Counted by the route, not given by `inputShape`.
  "would_clean", "clean_applied",
  // R9 (4.9): what the relevance floor would have done to a list while it only reads it (`would_tier_*`: shadow, and the state that the `writer` position does not act on); `tier_none` and `tier_few` are what it did.
  // Counted by the route, not given by `inputShape`.
  "would_tier_none", "would_tier_few",
] as const;
export type InputShapeName = (typeof INPUT_SHAPE_NAMES)[number];
/** The four counts of subject words: exactly one of them is given to every text, so together they are the number of messages counted (and countOutcomes always keeps it, past the cap of names). */
export const SUBJECT_NAMES = ["subj0", "subj1", "subj2_6", "subj7p"] as const satisfies readonly InputShapeName[];

/* ---------------------------------------------------------------- pieces of the patterns */

// what continues a word: a hyphen does, so "top-down", "all-trans" and "new-onset" are not "top", "all" and "new"
const WORD = String.raw`[\p{L}\p{M}\p{N}_-]`;
const START = String.raw`(?<!${WORD})`;
const END = String.raw`(?!${WORD})`;
const re = (source: string): RegExp => new RegExp(source, "iu");

/** The longest message that the frame, the notes and the id lookup of the plan read: the same 300 as `ruleRoute` and R8. Kept here so that the counted shape does not move if that number does. */
const LONG_CHARS = 300;
/** How far into a text the frame is looked for (at its start and at its end): a frame is a few words. */
const EDGE_CHARS = 200;

/* ---------------------------------------------------------------- frame, frame_polite, frame_all (R8, 4.8) */

// a greeting or a politeness at the start, taken off one by one (the frame follows them): hi, please, can you
const LEAD_IN = re(String.raw`^\s*(?:(hi+|hello+|hey+|namaste)|(please|pls|plz|kindly|(?:can|could|would|will)\s+(?:you|u)))${END}[\s,;:!.]*`);
/**
 * The leading frame of 4.8, closed, at the start of what is left after the lead-ins: a verb of asking, "I want to know about", a kind word with its preposition (with a determiner or without), a
 * question stem, a recency word that leads. Conservative where the plan's list is short of a guard: "search" only with "for" or a kind word ("search engine optimisation" is a topic); a determiner alone
 * ("the effect of aspirin") is not a frame; a recency word only when a word follows it; and every word ends where a hyphen would continue it ("new-onset", "finding").
 */
const FRAME_START = re(
  String.raw`^(?:` +
    [
      String.raw`search\s+for`,
      String.raw`search\s+(?:the\s+)?(?:papers|articles|studies|research|literature|publications)`,
      "find", "show", String.raw`give\s+me`, String.raw`tell\s+me`, "list", String.raw`look\s+(?:up|for)`,
      String.raw`i\s+want\s+to\s+know\s+about`, String.raw`i(?:\s+am|['’]m)\s+looking\s+for`,
      String.raw`(?:(?:some|any|all|the)\s+|a\s+few\s+)?(?:papers|articles|studies|research|literature|publications)\s+(?:on|about|regarding|related\s+to|for|in|of)`,
      String.raw`what\s+(?:is|are)`, String.raw`what['’]?s`, String.raw`how\s+(?:do\s+you|to|does|common\s+is)`, String.raw`is\s+it\s+true\s+that`,
      String.raw`where\s+does\s+research\s+stand\s+on`, String.raw`what\s+has\s+been\s+written\s+about`, String.raw`what\s+percentage\s+of`,
      String.raw`(?:best|most\s+effective)\s+way\s+to`,
      String.raw`(?:latest|recent|newest|new|current)(?=\s+\p{L})`,
    ].join("|") +
    String.raw`)${END}`,
);
// "does X really cause": a frame too (the question word and "really" go and "cause" stays), but X is the topic, so it is not taken off the words that are counted
const FRAME_DOES = re(String.raw`^does\s+(?:\S+\s+){1,6}really\s+cause${END}`);
const REALLY = re(`${START}really${END}`);
// what can end a frame, after a word: for me, exactly, really, in simple terms, in detail, if possible, research papers. (please and thanks are `frame_polite`; all papers is `frame_all`.)
const AFTER_A_WORD = String.raw`(?<=[\p{L}\p{M}\p{N}][\s,.;:!?)'"’”]+)`;
const TRAIL_FRAME = re(String.raw`${AFTER_A_WORD}(?:for\s+me|exactly|really|in\s+simple\s+terms|in\s+detail|if\s+possible|research\s+papers)$`);
const TRAIL_POLITE = re(String.raw`${AFTER_A_WORD}(?:please|pls|plz|thanks|thank\s+you|thx)$`);
/** All of them: "all papers", "all the studies", "all of them", "any papers", "every paper" (the note that the box shows 20 and not every paper). "all-trans" and "overall" are not it. */
const ALL = re(
  String.raw`${START}(?:all\s+(?:the\s+)?(?:papers|articles|studies|research|literature|publications)|all\s+of\s+them|any\s+papers|every\s+(?:paper|article|study|publication))${END}`,
);

/** A thanks and nothing else: a message that is no search and has no subject. ("thanks to research funding" is not it.) */
const BARE_THANKS = re(String.raw`^(?:thanks|thank\s+you|thx)[\s.,;:!?]*$`);
const TRIM_END = /[\s.,;:!?)\]}'"’”…।]+$/u;

/** The last 200 characters of `t` up to `end` at most, without the punctuation at the end and without a word cut in half at the start; `from` is where it starts in `t`. */
function tailOf(t: string, end: number): { text: string; from: number } {
  let from = Math.max(0, end - EDGE_CHARS);
  if (from > 0) from += /^\S*/.exec(t.slice(from, end))![0].length;
  return { text: t.slice(from, end).replace(TRIM_END, ""), from };
}

/* ---------------------------------------------------------------- qty, year, neg, order (R8 and R16, 4.8 and 4.16) */

const NUM = String.raw`(?:\d{1,3}|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|fifty)`;
/**
 * A quantity: "top 5", "first 10", "5 best", "N papers" (R16). Known false names: "5 best practices". "top-down", "top 2019" and "5-year" are not it, and neither is a number that belongs to the
 * topic: "top 10%", "first 100 days" and "top-1 accuracy" (a unit or a metric follows "top N"), and "phase 3 studies", "COVID 19 studies" and "vitamin B 12 studies" (a word that numbers a thing
 * comes before "N studies"; checked in code, on the few characters before, so that no pattern looks back over a long run).
 */
const QTY_LEAD = re(
  String.raw`${START}(?:top|first)[\s-]+${NUM}${END}(?!\s*(?:%|(?:percent|per\s+cent|percentile|accuracy|error|rate|(?:day|week|month|year|hour|minute)s?)${END}))`,
);
const QTY_NOUN = new RegExp(String.raw`${START}${NUM}\s+(?:best|papers|articles|studies|results)${END}`, "giu");
const NUMBERS_A_TOPIC = /(?:^|[^\p{L}\p{N}_-])(?:phase|stage|type|grade|class|group|level|factor|covid|sars-cov|vitamin\s+\p{L})[\s-]*$/iu;
function hasQuantity(t: string): boolean {
  if (QTY_LEAD.test(t)) return true;
  for (const m of t.matchAll(QTY_NOUN)) if (!NUMBERS_A_TOPIC.test(t.slice(Math.max(0, m.index - 20), m.index))) return true;
  return false;
}
const YEAR_AT = String.raw`(?:19|20)\d{2}(?![\p{L}\p{M}\p{N}_]|[.\/:]\d)`;
/** A year in one of the frames of R16 (after, since, from, in, before, between, and "2023 onwards"): "Olympics 2020" and "COVID-19 variants of 2021 vaccine" have none. A year of 1900 to 2099, and not part of a longer number. */
const YEAR = re(String.raw`${START}(?:(?:after|since|from|in|before|between)\s+${YEAR_AT}|${YEAR_AT}\s+onwards?${END})`);
/**
 * A negation clause: "but not X", "without X", "excluding X", with a word before it and a word after. Plan 4.8 reads a TRAILING one (what R8 takes out and names), so it counts only when it runs
 * to the end of the message (after the trailing politeness is off) in at most five more words and with no sentence end in them: "rice but not wheat" and "tea, without sugar, please", not "women
 * without children had higher mortality in Kerala". "without" is a topic word too ("life without parole", "patients without diabetes"): the short ones are counted, as R8 would take them out.
 */
const NEG = new RegExp(String.raw`[\p{L}\p{M}\p{N}][\s,]+(?:but\s+not|without|excluding)${END}\s+(?=[\p{L}\p{M}\p{N}])`, "giu");
const NEG_MAX_WORDS = 5;
const NEG_MAX_CHARS = 80;
function hasTrailingNegation(body: string): boolean {
  for (const m of body.matchAll(NEG)) {
    const at = m.index + m[0].length;
    if (body.length - at > NEG_MAX_CHARS) continue; // far from the end: no need to read it (and no long text is copied)
    const rest = body.slice(at).replace(TRIM_END, "");
    if (rest.split(/\s+/).length <= NEG_MAX_WORDS && !/[.;!?]/.test(rest)) return true;
  }
  return false;
}
/**
 * An order to the box, in the closed phrases of an attempt to talk to the model and not to search (plan 4.8: ignore, forget, reveal, print, you are now, system): ignore, disregard or forget the
 * instructions (with the word for what is ignored), or "the above" / "previous" with nothing after it but the end of the sentence or "and", forget everything or "all that", "ignore what I said",
 * reveal or print your (system) prompt or instructions, "you are now", and a line that begins "system:" with an order after it. The plan's bare words are topics too ("papers that ignore the
 * placebo", "ignore previous findings", "3D printing", "System: a survey of schedulers"), so each is read only with the words that make it an order. Other ways of giving an order (override, pretend,
 * act as) are not in the plan's list and are not counted: that is for the owner to decide.
 */
const ORDER = re(
  [
    String.raw`${START}(?:ignore|disregard|forget)\s+(?:(?:all|any|the|your|my|these|those)\s+){0,2}(?:(?:previous|prior|above|earlier|preceding|initial|original)\s+)?(?:instructions?|prompts?|rules?|guidelines?|directions?)${END}`,
    String.raw`${START}(?:ignore|disregard|forget)\s+everything${END}`,
    String.raw`${START}(?:ignore|disregard|forget)\s+(?:(?:all|everything|any|the)\s+){0,2}(?:of\s+)?(?:the\s+)?(?:above|previous|prior|earlier|preceding)(?=\s*$|\s*[.,;:!?]|\s+(?:and|then)${END})`,
    String.raw`${START}forget\s+(?:all|everything)\s+(?:of\s+)?(?:that|this)${END}`,
    String.raw`${START}ignore\s+what\s+(?:i|you)\s+(?:said|wrote|told)${END}`,
    String.raw`${START}(?:reveal|print|show|repeat|output|display)\s+(?:me\s+)?(?:(?:your|the)\s+(?:system|hidden|initial|original|secret)\s+|your\s+)(?:prompt|instructions?|rules?)${END}`,
    String.raw`${START}you\s+are\s+now${END}`,
    String.raw`(?:^|\n)[ \t]*system[ \t]*:[ \t]*(?:you|your|ignore|disregard|forget|reveal|print|answer|respond|reply|say|always|do\s+not|don['’]t|new\s+instructions?|from\s+now)${END}`,
  ].join("|"),
);

/* ---------------------------------------------------------------- first_person (R4 and 4.8) */

const NOT_IN_A_WORD = String.raw`(?<![\p{L}\p{M}\p{N}_'’-])`;
// what must not follow: a letter, a digit or a hyphen ("I-131", "main-effects"), or a dot, slash or ampersand and a letter ("i.e.", "I/O", "R&D")
const NOT_A_WORD_AFTER = String.raw`(?![\p{L}\p{M}\p{N}_-]|[.\/&]\p{L})`;
/** Words that are a first person and nothing else: my, mine, myself, we, our, ours, ourselves, and in Hindi (mera, meri, maine, mujhe, mujhko, hamara, hamare, hamari, humne, and the Devanagari forms). */
const FIRST_PERSON = re(
  `${NOT_IN_A_WORD}(?:my|mine|myself|we|our|ours|ourselves|mera|meri|maine|mujhe|mujhko|hamara|hamare|hamari|hamaari|humne|मेरा|मेरे|मेरी|मैं|मैंने|मुझे|हमारा|हमारे)${NOT_A_WORD_AFTER}`,
);
const PRONOUN_I = new RegExp(`${NOT_IN_A_WORD}i${NOT_A_WORD_AFTER}`, "giu");
const PRONOUN_ME = new RegExp(`${NOT_IN_A_WORD}me${NOT_A_WORD_AFTER}`, "giu");
// words that are English too (main effects, mere exposure, the hum of an engine) and Hindi, and the Hindi words next to them that are not English
const HINGLISH_PRONOUN = re(`${NOT_IN_A_WORD}(?:main|mere|hum|meine)${NOT_A_WORD_AFTER}`);
const HINGLISH_SIGN = re(String.raw`${START}(?:hai|hain|hoon|hun|mein|nahi|nahin|kya|aur|tha|thi|raha|rahi|rahe|chahta|chahti|chahiye|karta|karti|karte|bahut|ko|ke|ki|ka|padha|liya)${END}`);
// where a capital or small I is a person, read from the few characters on each side (never a look back over a long run): at the start of the text, after punctuation, after a word like "and"
// or "can", before a verb like "am" or "have", and before "'m", "'ve", "'d", "'ll". After a noun that it numbers ("World War I", "Tier I cities", "Henry I of England") it is a Roman numeral.
const I_AFTER_PUNCTUATION = /[.!?;:,()"“”\n]\s*$/u;
const I_AFTER_WORD = /(?:^|[^\p{L}\p{N}_-])(?:and|but|or|so|that|if|when|whether|how|what|why|where|because|since|while|as|than|then|can|could|do|does|did|should|would|will|shall|may|might|must|am|think|hope|wish|guess|know|say|said|before|after|once|until|though|although|unless|whenever)\s+$/iu;
const I_CONTRACTION = /^['’](?:m|ve|d|ll)(?![\p{L}\p{N}_-])/iu;
const I_BEFORE_VERB = /^\s+(?:am|have|had|was|will|would|want|need|think|feel|got|get|can|could|should|do|did|like|love|hope|wish|read|found|take|took|work|study|live|teach|suffer|believe|know|wonder|guess|mean|see|saw|tried|try|use|used|must|might|may|shall|keep|started|began|uploaded|attached|pasted|wrote|made|submitted|sent|met|asked|heard|noticed)(?![\p{L}\p{N}_-])/iu;
// "me" after a verb of asking is a frame (give me, tell me, show me), not a story; so is "help me find" (but "does aspirin help me" is a person) and "find X for me" (but "is it safe for me" is a person)
const ME_AFTER_REQUEST = /(?:^|[^\p{L}\p{N}_-])(?:give|tell|show|find|get|send|bring|let|email|mail|teach|lend|pass|list|offer)\s+$/iu;
const ME_AFTER_HELP = /(?:^|[^\p{L}\p{N}_-])help\s+$/iu;
const ME_AFTER_FOR = /(?:^|[^\p{L}\p{N}_-])for\s+$/iu;
const ME_FOR_A_DECISION = /(?:^|[^\p{L}\p{N}_-])(?:safe|ok|okay|good|bad|right|fine|suitable|harmful|dangerous|risky|healthy|recommended)\s+for\s+$/iu;

/**
 * A first person: I, I'm, I've (a capital or small "i" where it is a person and not a Roman numeral), my, mine, myself, we, our, ours, ourselves, "me" (but not after a verb of asking, where it is a
 * frame: "give me", "tell me", "show me", "find me", "email me"), and in Hindi the words that are nothing else (mera, meri, maine, mujhe, mujhko, hamara, hamare, hamari, humne, and the Devanagari
 * forms). "main", "mere", "hum" and "meine" are English words too, so they count only with a Hinglish word that is not English next to them ("main bimar hoon"); in such a message "me" means "in" and is not read.
 * "us" is left out on purpose ("US" is a country). "i.e.", "I/O" and "I-131" are not a person. "for me" is a frame (plan 4.8: "find X for me") and not a person, except after a word of a decision
 * ("is it safe for me", plan 4.5); "help me" is a request when a word follows ("help me find") and a person at the end ("does aspirin help me"). Known misses: an "I" before a verb that is not in the
 * closed list when the word before it is not in the list either ("papers I did not find" is read, "papers I skimmed" is not).
 */
function hasFirstPerson(t: string): boolean {
  if (FIRST_PERSON.test(t)) return true;
  for (const m of t.matchAll(PRONOUN_I)) {
    const before = t.slice(Math.max(0, m.index - 16), m.index);
    const after = t.slice(m.index + 1, m.index + 17);
    if (m.index === 0 || I_CONTRACTION.test(after) || I_AFTER_PUNCTUATION.test(before) || I_AFTER_WORD.test(before) || I_BEFORE_VERB.test(after)) return true;
  }
  if (HINGLISH_SIGN.test(t)) return HINGLISH_PRONOUN.test(t);
  for (const m of t.matchAll(PRONOUN_ME)) {
    const before = t.slice(Math.max(0, m.index - 24), m.index);
    if (ME_AFTER_REQUEST.test(before)) continue;
    if (ME_AFTER_HELP.test(before) && /^\s*[\p{L}\p{N}]/u.test(t.slice(m.index + 2, m.index + 6))) continue;
    if (ME_AFTER_FOR.test(before) && !ME_FOR_A_DECISION.test(before)) continue;
    return true;
  }
  return false;
}

/* ---------------------------------------------------------------- id (R13, 4.13) */

const DOI = /(?<![\p{L}\p{M}\p{N}_.])10\.\d{4,9}\/\S/u;
const PMID = re(String.raw`${START}(?:pmid|pubmed)\s*[:#]?\s*\d{6,9}(?!\d)`);
const ARXIV_WORD = /arxiv/i;
const ARXIV_ADDRESS = /arxiv\.org\/(?:abs|pdf)\//i;
const ARXIV_NEW = String.raw`\d{2}(?:0[1-9]|1[0-2])\.\d{4,5}(?:v\d+)?`; // four digits (the month is 01 to 12, so "2019.2020" is not one), a dot, four or five digits
const ARXIV_OLD = String.raw`[a-z]+(?:-[a-z]+)?(?:\.[A-Za-z]{2})?\/\d{7}(?:v\d+)?`; // cs/0501001, hep-th/9901001
const ARXIV_IN_TEXT = new RegExp(String.raw`(?<![\p{L}\p{N}.])(?:${ARXIV_NEW}|${ARXIV_OLD})(?![\p{N}])`, "u");
const ARXIV_WHOLE = new RegExp(String.raw`^(?:${ARXIV_NEW}|${ARXIV_OLD})$`, "u");
/**
 * Does the message hold an id by 4.13's own words: a DOI (also behind doi: and doi.org), an arXiv number with the word "arxiv" or an arxiv.org address or as the whole message, a PubMed number
 * after "pmid" or "pubmed" (6 to 9 digits)? Only in a message of at most 14 words and 300 characters, as R13 reads one. Not read: whether the id is what is asked for ("find", "what is").
 */
function hasId(t: string): boolean {
  if (t.length > LONG_CHARS || t.split(/\s+/).length > 14) return false;
  if (DOI.test(t) || PMID.test(t) || ARXIV_ADDRESS.test(t) || ARXIV_WHOLE.test(t)) return true;
  return ARXIV_WORD.test(t) && ARXIV_IN_TEXT.test(t);
}

/* ---------------------------------------------------------------- scrub (R11, 4.11) */

const EMAIL = /(?<=[\p{L}\p{N}._%+-])@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}(?![\p{L}\p{N}-])/u;
// a web address (a scheme or "www."): a DOI or an arXiv address is not one (R13 owns those). A bare "example.com" is not read.
const WEB_ADDRESS = re(String.raw`(?<![\p{L}\p{M}\p{N}_])(?:(?:https?|ftps?|sftp):\/\/|www\.)(?!(?:www\.)?(?:dx\.)?(?:doi|arxiv)\.org(?![\p{L}\p{N}-]))\S`);
// a United States number with the area code in brackets ("(555) 010-0199", "+1 (555) 010-0199"): its groups are too short for the run below
const US_PHONE = /(?<![\p{L}\p{M}\p{N}_])(?:\+\d{1,3}[ -]?)?\(\d{3}\)[ -]?\d{3}[ -]?\d{4}(?![\p{L}\p{M}\p{N}_\/])/u;
// a run of digits with single spaces or dashes between the groups, and maybe a plus before: it starts at a digit that no letter, dot, slash or colon touches (so not inside a DOI or "10.5 mg")
const NUMBER_RUN = /(?<![\p{L}\p{M}\p{N}_.\/:#-])\+?\d+(?:[ -]\d+)*(?![\p{L}\p{M}\p{N}_\/])/gu;

/**
 * Is this run a phone number (or another number that is no business of a search index)? Eight or more digits, and: with a plus sign, or ten or more with no gap ("9876543210": a PubMed number has
 * at most eight), or in groups of two digits or more ("98765 43210", "+91 98765 43210", "1234 5678 9012"; "5 10 15 20 25 30" and an ISBN are not). Not a year range or a list of years ("2018-2021"),
 * not a date ("2021-03-15", "15-03-2021", "15 03 2021"), not a page range of two numbers of four digits with a small step ("1054-1062"), and not a list of numbers of six to nine digits (PubMed
 * numbers: plan 4.11 exempts them; a PIN code too). A plus sign says it is a phone number, so none of these exemptions is read after one. A bare ISSN ("0028-0836") is counted: it cannot be told from a
 * number of eight digits in two groups. A page range with a step of more than 300 ("1234-5678") is counted for the same reason.
 */
function isPhoneRun(run: string): boolean {
  const plus = run.charCodeAt(0) === 43;
  let digits = 0;
  let groups = 0;
  let years = 0;
  let singles = 0;
  let notPubmed = 0; // groups that are not of six to nine digits
  let len = 0;
  let value = 0;
  const lens: number[] = []; // the first three groups: their length and their value (exact up to four digits)
  const values: number[] = [];
  for (let i = plus ? 1 : 0; i <= run.length; i++) {
    const c = i < run.length ? run.charCodeAt(i) : 32; // the end closes the last group
    if (c >= 48 && c <= 57) {
      if (++len <= 4) value = value * 10 + (c - 48);
      continue;
    }
    if (len > 0) {
      groups++;
      digits += len;
      if (len === 4 && value >= 1900 && value <= 2099) years++;
      if (len < 2 && !(plus && groups === 1)) singles++;
      if (len < 6 || len > 9) notPubmed++;
      if (groups <= 3) {
        lens.push(len);
        values.push(value);
      }
    }
    len = 0;
    value = 0;
  }
  if (digits < 8 || singles > 0 || years === groups) return false;
  if (groups === 1) return plus || digits >= 10;
  if (plus) return true;
  if (notPubmed === 0) return false;
  if (groups === 3 && isDate(lens, values)) return false;
  if (groups === 2 && lens[0] === 4 && lens[1] === 4 && values[0]! >= 1000 && values[1]! > values[0]! && values[1]! - values[0]! <= 300 && run.includes("-")) return false;
  return true;
}
/** Three groups that are a day, a month and a year of 1900 to 2099, in either order (15-03-2021, 03-15-2021, 2021-03-15). */
function isDate(lens: number[], v: number[]): boolean {
  const year = (y: number) => y >= 1900 && y <= 2099;
  if (lens[0]! <= 2 && lens[1]! <= 2 && lens[2] === 4) return year(v[2]!) && v[0]! >= 1 && v[1]! >= 1 && v[0]! <= 31 && v[1]! <= 31 && Math.min(v[0]!, v[1]!) <= 12;
  if (lens[0] === 4 && lens[1]! <= 2 && lens[2]! <= 2) return year(v[0]!) && v[1]! >= 1 && v[1]! <= 12 && v[2]! >= 1 && v[2]! <= 31;
  return false;
}
function hasScrub(t: string): boolean {
  if (EMAIL.test(t) || WEB_ADDRESS.test(t) || US_PHONE.test(t)) return true;
  for (const m of t.matchAll(NUMBER_RUN)) if (isPhoneRun(m[0])) return true;
  return false;
}

/* ---------------------------------------------------------------- the shape */

/**
 * The names a message has, from the text alone, in the order of `INPUT_SHAPE_NAMES`, each once. Exactly one of `subj0`, `subj1`, `subj2_6` and `subj7p` is always among them, so those four add up
 * to the number of messages counted (`countOutcomes` keeps that one name even when a message has more names than it may write). The count is of the words about a subject (`subjectWords`) of what
 * is left after the greeting, the politeness and the frame phrase at the two edges are taken off (plan 6.2 S1; the passes are those of R8, at most three at the end), so "Hello, tuberculosis" and
 * "tuberculosis, thanks" have one subject word and "hello" has none. `frame` is the union of what R8 would take off (a leading frame, a trailing frame, a politeness, "all papers", a greeting with
 * something after it); `frame_polite` and `frame_all` are parts of it. `long` is more than 300 characters. A text that is not a string has no shape: `[]`. Never throws.
 */
export function inputShape(text: string): InputShapeName[] {
  if (typeof text !== "string") return [];
  try {
    const t = text.trim();
    const found = new Set<InputShapeName>();
    // the lead-ins come off one at a time (a greeting, please, can you); the frame is what follows them
    let from = 0;
    let polite = false;
    let greeted = false;
    for (let i = 0; i < 6; i++) {
      const m = LEAD_IN.exec(t.slice(from, EDGE_CHARS));
      if (!m) break;
      if (m[2]) polite = true;
      else greeted = true;
      from += m[0].length;
    }
    const window = t.slice(from, EDGE_CHARS);
    const lead = FRAME_START.exec(window);
    const does = lead === null && FRAME_DOES.test(window);
    // a greeting is a frame when something follows it (R8 takes it off); a greeting alone is not a search and has none
    let framed = lead !== null || does || (greeted && /[\p{L}\p{N}]/u.test(t.slice(from, from + EDGE_CHARS)));
    // the trailing politeness and frame phrases come off the end, at most three of them ("in detail if possible, thanks")
    let end = t.length;
    for (let i = 0; i < 3; i++) {
      const tail = tailOf(t, end);
      const p = TRAIL_POLITE.exec(tail.text);
      const f = p ? null : TRAIL_FRAME.exec(tail.text);
      const m = p ?? f;
      if (!m) break;
      if (p) polite = true;
      else framed = true;
      end = tail.from + m.index;
    }
    const all = ALL.test(t);
    if (framed || polite || all) found.add("frame");
    if (polite) found.add("frame_polite");
    if (all) found.add("frame_all");
    if (hasQuantity(t)) found.add("qty");
    if (YEAR.test(t)) found.add("year");
    // what is left of the message: no greeting, no politeness, no frame phrase at the edges
    let body = t.slice(from + (lead ? lead[0].length : 0), Math.max(end, from));
    if (does) body = body.replace(REALLY, " ");
    if (BARE_THANKS.test(body)) body = "";
    if (hasTrailingNegation(body)) found.add("neg");
    if (ORDER.test(t)) found.add("order");
    if (t.length > LONG_CHARS) found.add("long");
    if (hasFirstPerson(t)) found.add("first_person");
    const subject = subjectWords(body).length;
    found.add(subject === 0 ? "subj0" : subject === 1 ? "subj1" : subject <= 6 ? "subj2_6" : "subj7p");
    if (hasId(t)) found.add("id");
    if (hasScrub(t)) found.add("scrub");
    return INPUT_SHAPE_NAMES.filter((n) => found.has(n));
  } catch {
    return [];
  }
}
