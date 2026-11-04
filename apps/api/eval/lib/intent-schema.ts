// The case schema of the intent eval (plan 8.2, "Gold schema, one JSON per case") and a pure validator for it. Pure: no I/O, no imports, so the eval, a data script and a later gate can all use it.
//
// Every gold and retrieval field is OPTIONAL and means "a person or a study said so": a missing field is "not labelled", never "no". The one explicit "nothing" is `gold.spell: null`
// (no spelling change is expected), and `gold.ask: "none"` (no question to the person is expected). A list that is present is never empty: an empty list is left out.

export const INTENT_SETS = ["dev", "safety_dev", "notsearch", "ids_cues", "ask_typo_years_traps", "controls", "rare_valid", "holdout", "chains"] as const;
export const LANGUAGES = ["en", "hi", "hinglish", "other"] as const;
/** study: a case of the earlier studies; repository: a message taken from a data file already in the repository (the router cases, the G5 titles, the G6 queries); assistant-drafted: written by the assistant, for the owner to review; person: written by a person for this eval. */
export const AUTHORS = ["study", "repository", "assistant-drafted", "person"] as const;
/** The tool a person wants (the studies' own word list): "none" is a message no tool should work on (not research, or not doable); "small_talk" is the page's fixed reply. */
export const TOOLS = ["search", "verify", "idea", "paper", "small_talk", "none"] as const;
/** What answers a message before a search: the safety tiers of plan 4.5, TALK and NO-TOPIC of 4.10, small talk and the id lookup of U2 and U5; "none" means no lane fires. */
export const LANES = ["crisis", "urgent", "help", "decision", "care", "talk", "no_topic", "small_talk", "lookup", "none"] as const;
export const ASKS = ["none", "acronym", "broad", "notopic"] as const;
export const ANSWER_LANGUAGES = ["en", "hi", "hinglish"] as const;
export const ID_KINDS = ["doi", "arxiv", "pmid"] as const;
/** How `language` was decided when the study did not say: the script, Roman-letter Hindi words, plain Latin letters, another script, or no letter at all (an emoji, a number). */
export const LANGUAGE_BASES = ["source", "devanagari", "roman-hindi-words", "latin", "other-script", "no-letters"] as const;

export type IntentSet = (typeof INTENT_SETS)[number];
export type IntentLanguage = (typeof LANGUAGES)[number];
export type IntentAuthor = (typeof AUTHORS)[number];
export type IntentTool = (typeof TOOLS)[number];
export type IntentLane = (typeof LANES)[number];
export type IntentAsk = (typeof ASKS)[number];

export type IntentGold = {
  lane?: IntentLane;
  tool?: IntentTool;
  /** Groups of alternatives; every group must be present in the searched words. */
  topicAnyOf?: string[][];
  /** Words that must not be in the searched words. */
  mustNotContain?: string[];
  /** Phrases the reading should leave out. */
  removed?: string[];
  ids?: { kind: (typeof ID_KINDS)[number]; value: string }[];
  years?: { from?: number; to?: number };
  count?: number;
  answerLanguage?: (typeof ANSWER_LANGUAGES)[number];
  ask?: IntentAsk;
  /** null: no spelling change is expected. */
  spell?: { from: string; to: string } | null;
  /** Tokens that must reach the searched words unchanged. */
  protected?: string[];
};

export type IntentRetrieval = {
  /** A relevant record holds at least one of these (title or abstract). */
  anchorsAnyOf?: string[];
  /** A fully relevant record also holds one of these (study b's second group). */
  anchorsAlsoAnyOf?: string[];
  /**
   * The hand-cleaned form of the message, as the person or study who cleaned it wrote it. It is NOT only the message without its frame words: study a's also fixes typos and expands abbreviations,
   * study b's adds synonyms and translates Hindi. An edge-only cleaner (plan 4.8: the typos remain until R12) can reach it only for a message whose whole problem is the frame (the filler class),
   * so a gate that compares a cleaner with the oracle reads that class only.
   */
  cleanOracle?: string;
};

export type IntentSource = {
  /** The original file (the study files are outside the repository: their base name). */
  file: string;
  /** The position in that file's list of cases. */
  index: number;
  /** The original record, unchanged. */
  record?: unknown;
};

export type IntentCase = {
  id: string;
  set: IntentSet;
  language: IntentLanguage;
  languageBasis?: (typeof LANGUAGE_BASES)[number];
  class: string;
  text: string;
  gold?: IntentGold;
  retrieval?: IntentRetrieval;
  /** The Readings before this message (chains only); loosely typed here, the Reading type is not written yet. */
  prior?: Record<string, unknown>[];
  author: IntentAuthor;
  source?: IntentSource;
  tags?: string[];
};

/* ---------------------------------------------------------------- the validator */

const MAX_TEXT = 20_000;
const MAX_COUNT = 50;
const MIN_YEAR = 1900;
const MAX_YEAR = 2100;
const TOP_KEYS = ["id", "set", "language", "languageBasis", "class", "text", "gold", "retrieval", "prior", "author", "source", "tags"];
const GOLD_KEYS = ["lane", "tool", "topicAnyOf", "mustNotContain", "removed", "ids", "years", "count", "answerLanguage", "ask", "spell", "protected"];
const RETRIEVAL_KEYS = ["anchorsAnyOf", "anchorsAlsoAnyOf", "cleanOracle"];
const SOURCE_KEYS = ["file", "index", "record"];

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isText = (x: unknown): x is string => typeof x === "string" && x.trim().length > 0;
const isInt = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x);
const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T => typeof x === "string" && (list as readonly string[]).includes(x);
const has = (o: Record<string, unknown>, key: string) => o[key] !== undefined;
const unknownKeys = (where: string, o: Record<string, unknown>, known: string[]) => Object.keys(o).filter((k) => o[k] !== undefined && !known.includes(k)).map((k) => `${where}: unknown field "${k}"`);

// Special characters are built from code points: a typed escape in a source file can be turned into the character by an editor.
const APOSTROPHE = String.fromCharCode(0x2019);
const EN_DASH = String.fromCharCode(0x2013);
const DEVANAGARI = new RegExp("[" + String.fromCharCode(0x900) + "-" + String.fromCharCode(0x97f) + "]");
const hasDevanagari = (text: string) => DEVANAGARI.test(text);

/** Characters that show nothing and come along when text is pasted from a web page, a PDF or a Word file: from, to (both included). */
const INVISIBLE_RANGES: [number, number][] = [
  [0x80, 0x9f], // the C1 controls (U+0085 is "next line")
  [0xad, 0xad], // soft hyphen
  [0x34f, 0x34f], // combining grapheme joiner
  [0x61c, 0x61c], // Arabic letter mark
  [0x115f, 0x1160], // Hangul fillers
  [0x180b, 0x180e], // Mongolian free variation selectors and vowel separator
  [0x200b, 0x200f], // zero-width and direction marks
  [0x2028, 0x202e], // line and paragraph separators, direction embeddings
  [0x2060, 0x2069], // word joiner, invisible operators, direction isolates
  [0x3164, 0x3164], // Hangul filler
  [0xd800, 0xdfff], // a surrogate on its own: a pair is read as one code point and never gets here
  [0xfe00, 0xfe0f], // variation selectors
  [0xfeff, 0xfeff], // byte-order mark
  [0xffa0, 0xffa0], // halfwidth Hangul filler
  [0xfff9, 0xfffc], // interlinear annotation marks and the object replacement character
  [0xe0000, 0xe007f], // tag characters
  [0xe0100, 0xe01ef], // variation selectors supplement
];
/** The ranges above, and the control characters other than tab, line feed and carriage return. */
const isInvisible = (cp: number) => (cp < 0x20 && cp !== 9 && cp !== 10 && cp !== 13) || cp === 0x7f || INVISIBLE_RANGES.some(([from, to]) => cp >= from && cp <= to);

// The zero-width joiner and non-joiner are refused too. A message of a person's that needs one on purpose (an emoji sequence, a Devanagari half-form) is the one reason to loosen this.
function invisibleProblems(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (isInvisible(cp)) out.push(`text: invisible or control character U+${cp.toString(16).toUpperCase().padStart(4, "0")} at index ${i}`);
    i += ch.length;
  }
  return out;
}

const YEAR_OR_PAGE_RANGE = new RegExp(String.raw`^\d{4}\s?[-${EN_DASH}]\s?(?:\d{4}|\d{2})$`);
/** Years in a row ("2019-2020-2021 results"): more than ten digits, and not a phone number. */
const YEAR_CHAIN = new RegExp(String.raw`^(?:(?:1[89]|20)\d{2}[ ${EN_DASH}-]+)+(?:1[89]|20)\d{2}$`);

/**
 * An e-mail address, a web address or a phone number in a message: the data of the eval is all synthetic, so none may appear. A DOI, an arXiv number, a PubMed number, an ISBN, a range of
 * years or pages and a row of years are not phone numbers; digits of any script count (a Hindi writer may type Devanagari digits). A link is a known ending (.com, .ac.in ...) or any
 * dotted word followed by a slash and a path ("bit.ly/3xYz", "t.me/group"). An address with no dot in its domain ("user@localhost", "recall@10") is left alone: "precision@k" is a research term.
 */
export function contactProblems(text: string): string[] {
  const out: string[] = [];
  const email = text.match(/[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/u);
  if (email) out.push(`text: e-mail address (${email[0]})`);
  // "john (at) gmail (dot) com": both marks are needed, because "(AT)" or "(DOT)" alone can be an abbreviation
  if (/[[(]\s*at\s*[\])]/i.test(text) && /[[(]\s*dot\s*[\])]/i.test(text)) out.push("text: e-mail address written out (at and dot)");
  const link = text.match(
    /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|edu|gov|io|ai|co\.in|ac\.in|gov\.in|nic\.in|edu\.in)\b(?:\/\S*)?|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/\S+/i,
  );
  if (link) out.push(`text: web address (${link[0]})`);
  const rest = text
    .replace(/\b10\.\d{4,9}\/\S+/g, " ")
    .replace(/\barxiv:?\s*\d{4}\.\d{4,5}(?:v\d+)?/gi, " ")
    .replace(/\b\d{4}\.\d{4,5}(?:v\d+)?\b/g, " ")
    .replace(/\b(?:pmid|pmcid|pubmed)\s*:?\s*(?:pmc)?\d+/gi, " ")
    .replace(/\bisbn(?:-1[03])?\s*:?\s*[0-9X][0-9X -]*/gi, " ");
  for (const run of rest.match(/\+?\p{Nd}[\p{Nd} ().-]{6,}\p{Nd}/gu) ?? []) {
    const digits = run.replace(/\P{Nd}/gu, "").length;
    if (!YEAR_OR_PAGE_RANGE.test(run) && !YEAR_CHAIN.test(run) && (digits >= 10 || (run.startsWith("+") && digits >= 8))) out.push(`text: phone number (${run.trim()})`);
  }
  return out;
}

/* ---------- filler frames (plan 4.8's closed lists), for the controls ---------- */

const withCurly = (phrases: string[]) => phrases.flatMap((p) => (p.includes("'") ? [p, p.replace(/'/g, APOSTROPHE)] : [p]));
/** What a request-frame cleaner takes off the front: politeness, the request verbs, the determiners (some, any, all, the, a few: "the" is in plan 4.8's list, so a title that opens with it is framed and is named in the manifest), the question stems and the recency words; "papers on" and its kin go only with a preposition. Whole words: "all-trans", "new-onset" and "CAN bus" are not frames. */
const LEAD = withCurly([
  "hi", "hello", "hey", "please", "kindly", "can you", "could you", "can u", "would you",
  "i", "i'm", "i've", "i'd", "im",
  "search", "find", "show", "give me", "tell me", "list", "look up", "help me",
  "some", "any", "all", "the", "a few",
  "what is", "what are", "whats", "what's", "how do you", "how to", "how does", "is it true that", "where does research stand on", "what has been written about",
  "best way to", "most effective way to", "how common is", "what percentage of",
  "latest", "recent", "newest", "new", "current",
]);
const KIND_WORDS = ["papers", "articles", "studies", "research", "literature", "publications"];
const KIND_PREPOSITIONS = ["on", "about", "regarding", "related to", "for", "in", "of"];
const TRAIL = ["please", "thanks", "thank you", "for me", "exactly", "really", "in simple terms", "in detail", "if possible", "all papers", "all of them", "any papers", "papers please", "research papers"];
const ANYWHERE = [
  "please", "thanks", "thank you", "can you", "could you", "all papers", "all of them", "every paper", "every study", "some papers", "a few papers",
  // Roman-letter Hindi request words, then the same kind of words in Devanagari (kripya, mujhe, chahiye, bataiye)
  "batao", "bataiye", "dikhao", "dhundo", "dhoondo", "chahiye", "mujhe", "kripya",
  ...[[0x915, 0x943, 0x92a, 0x92f, 0x93e], [0x92e, 0x941, 0x91d, 0x947], [0x91a, 0x93e, 0x939, 0x93f, 0x90f], [0x92c, 0x924, 0x93e, 0x907, 0x90f]].map((cps) => String.fromCharCode(...cps)),
];
const COUNT = /\b(?:top|first|last|best)\s+\d+\b|\b\d+\s+(?:best|top|papers|articles|studies)\b/;
const YEAR_FRAME = /\b(?:after|since|before|until|till|between|from|during|in|published in|published after)\s+(?:1[89]|20)\d{2}\b|\b(?:1[89]|20)\d{2}\s+(?:onwards?|to present)\b/;
const WORD = new RegExp(String.raw`[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'${APOSTROPHE}-]*`, "gu");

const phraseAt = (tokens: string[], at: number, phrase: string) => phrase.split(" ").every((w, i) => tokens[at + i] === w);

/** The filler frames a message carries, as "lead:...", "trail:...", "anywhere:...", "count:..." or "year:..."; empty for a clean message. */
export function frameMarkers(text: string): string[] {
  const tokens = text.toLowerCase().match(WORD) ?? [];
  const out: string[] = [];
  for (const p of LEAD) if (phraseAt(tokens, 0, p)) out.push(`lead:${p}`);
  for (const kind of KIND_WORDS) for (const prep of KIND_PREPOSITIONS) if (phraseAt(tokens, 0, `${kind} ${prep}`)) out.push(`lead:${kind} ${prep}`);
  for (const p of TRAIL) {
    const n = p.split(" ").length;
    if (tokens.length > n && phraseAt(tokens, tokens.length - n, p)) out.push(`trail:${p}`);
  }
  for (const p of ANYWHERE) if (tokens.some((_, i) => phraseAt(tokens, i, p))) out.push(`anywhere:${p}`);
  const lower = text.toLowerCase();
  const count = lower.match(COUNT);
  if (count) out.push(`count:${count[0]}`);
  const year = lower.match(YEAR_FRAME);
  if (year) out.push(`year:${year[0]}`);
  return out;
}

/* ---------------------------------------------------------------- validateCase */

function listProblems(where: string, x: unknown, out: string[]) {
  if (!Array.isArray(x) || x.length === 0) out.push(`${where}: must be a non-empty list (leave the field out instead of an empty list)`);
  else {
    const bad = x.findIndex((s) => !isText(s));
    if (bad >= 0) out.push(`${where}: item ${bad} must be a non-blank string`);
  }
}

function goldProblems(g: unknown): string[] {
  if (!isObject(g)) return ["gold: must be an object"];
  const out = unknownKeys("gold", g, GOLD_KEYS);
  if (Object.keys(g).filter((k) => g[k] !== undefined).length === 0) out.push("gold: is empty (leave it out)");
  if (has(g, "lane") && !oneOf(LANES, g.lane)) out.push(`gold.lane: must be one of ${LANES.join(", ")}`);
  if (has(g, "tool") && !oneOf(TOOLS, g.tool)) out.push(`gold.tool: must be one of ${TOOLS.join(", ")}`);
  if (has(g, "ask") && !oneOf(ASKS, g.ask)) out.push(`gold.ask: must be one of ${ASKS.join(", ")}`);
  if (has(g, "answerLanguage") && !oneOf(ANSWER_LANGUAGES, g.answerLanguage)) out.push(`gold.answerLanguage: must be one of ${ANSWER_LANGUAGES.join(", ")}`);
  if (has(g, "topicAnyOf")) {
    if (!Array.isArray(g.topicAnyOf) || g.topicAnyOf.length === 0) out.push("gold.topicAnyOf: must be a non-empty list of groups");
    else g.topicAnyOf.forEach((group, i) => listProblems(`gold.topicAnyOf[${i}]`, group, out));
  }
  if (has(g, "mustNotContain")) listProblems("gold.mustNotContain", g.mustNotContain, out);
  if (has(g, "removed")) listProblems("gold.removed", g.removed, out);
  if (has(g, "protected")) listProblems("gold.protected", g.protected, out);
  if (has(g, "ids")) {
    if (!Array.isArray(g.ids) || g.ids.length === 0) out.push("gold.ids: must be a non-empty list");
    else
      g.ids.forEach((id, i) => {
        if (!isObject(id) || !oneOf(ID_KINDS, id.kind) || !isText(id.value)) out.push(`gold.ids[${i}]: must be { kind: ${ID_KINDS.join(" | ")}, value: string }`);
      });
  }
  if (has(g, "years")) {
    const y = g.years;
    if (!isObject(y)) out.push("gold.years: must be { from?, to? }");
    else {
      const ends = [y.from, y.to].filter((v) => v !== undefined);
      if (ends.length === 0) out.push("gold.years: needs a from or a to");
      if (ends.some((v) => !isInt(v) || v < MIN_YEAR || v > MAX_YEAR)) out.push(`gold.years: each end must be a whole year from ${MIN_YEAR} to ${MAX_YEAR}`);
      else if (isInt(y.from) && isInt(y.to) && y.from > y.to) out.push("gold.years: from is after to");
      out.push(...unknownKeys("gold.years", y, ["from", "to"]));
    }
  }
  if (has(g, "count") && (!isInt(g.count) || g.count < 1 || g.count > MAX_COUNT)) out.push(`gold.count: must be a whole number from 1 to ${MAX_COUNT}`);
  if (g.spell !== undefined && g.spell !== null && (!isObject(g.spell) || !isText(g.spell.from) || !isText(g.spell.to))) out.push("gold.spell: must be null or { from: string, to: string }");
  return out;
}

function retrievalProblems(r: unknown): string[] {
  if (!isObject(r)) return ["retrieval: must be an object"];
  const out = unknownKeys("retrieval", r, RETRIEVAL_KEYS);
  if (Object.keys(r).filter((k) => r[k] !== undefined).length === 0) out.push("retrieval: is empty (leave it out)");
  if (has(r, "anchorsAnyOf")) listProblems("retrieval.anchorsAnyOf", r.anchorsAnyOf, out);
  if (has(r, "anchorsAlsoAnyOf")) listProblems("retrieval.anchorsAlsoAnyOf", r.anchorsAlsoAnyOf, out);
  if (has(r, "cleanOracle") && !isText(r.cleanOracle)) out.push("retrieval.cleanOracle: must be a non-blank string");
  return out;
}

/** Every problem of a case, empty when it is valid. A case that has only what a study labelled is valid: gold and retrieval are optional, and so is each field in them. */
export function validateCase(x: unknown): string[] {
  if (!isObject(x)) return ["case: must be an object"];
  const out = unknownKeys("case", x, TOP_KEYS);
  if (typeof x.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(x.id)) out.push("id: required; letters, digits, dot, dash and underscore only, at most 64");
  if (!oneOf(INTENT_SETS, x.set)) out.push(`set: must be one of ${INTENT_SETS.join(", ")}`);
  if (!oneOf(LANGUAGES, x.language)) out.push(`language: must be one of ${LANGUAGES.join(", ")}`);
  if (has(x, "languageBasis") && !oneOf(LANGUAGE_BASES, x.languageBasis)) out.push(`languageBasis: must be one of ${LANGUAGE_BASES.join(", ")}`);
  if (typeof x.class !== "string" || !/^[a-z][a-z0-9_]*$/.test(x.class)) out.push("class: required; a lowercase slug (letters, digits, underscore)");
  if (!oneOf(AUTHORS, x.author)) out.push(`author: must be one of ${AUTHORS.join(", ")}`);

  if (typeof x.text !== "string" || x.text.trim().length === 0) out.push("text: required, not blank");
  else if (x.text.length > MAX_TEXT) out.push(`text: longer than ${MAX_TEXT} characters`); // too long to scan: the e-mail check is quadratic in the length
  else {
    out.push(...invisibleProblems(x.text), ...contactProblems(x.text));
    const deva = hasDevanagari(x.text);
    if (x.language === "hi" && !deva) out.push("language: hi needs Devanagari letters in the text");
    if (x.language === "en" && deva) out.push("language: en but the text has Devanagari letters");
  }

  if (has(x, "gold")) out.push(...goldProblems(x.gold));
  if (has(x, "retrieval")) out.push(...retrievalProblems(x.retrieval));

  if (has(x, "prior")) {
    if (x.set !== "chains") out.push("prior: only a case of the chains set has earlier Readings");
    if (!Array.isArray(x.prior) || x.prior.length === 0 || x.prior.length > 10 || !x.prior.every(isObject)) out.push("prior: must be a list of 1 to 10 Reading objects");
  }

  if (has(x, "source")) {
    const s = x.source;
    if (!isObject(s)) out.push("source: must be { file, index, record? }");
    else {
      out.push(...unknownKeys("source", s, SOURCE_KEYS));
      if (!isText(s.file)) out.push("source.file: required");
      if (!isInt(s.index) || s.index < 0) out.push("source.index: must be a whole number, 0 or more");
    }
  } else if (x.author === "study" || x.author === "repository") out.push("source: required for a case taken from a study or a repository file (the original file and index)");

  if (has(x, "tags")) {
    const t = x.tags;
    if (!Array.isArray(t) || t.length === 0 || !t.every((s) => typeof s === "string" && /^[a-z0-9][a-z0-9_-]*$/.test(s))) out.push("tags: must be a non-empty list of lowercase slugs");
    else if (new Set(t).size !== t.length) out.push("tags: the same tag twice");
  }
  return out;
}
