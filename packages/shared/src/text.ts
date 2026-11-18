/**
 * The text toolkit of both apps (docs/design/untangle.md, 1.2 and F3): one way to fold, clean, cut and check text, so the browser and the server do it the same way. Imports nothing.
 * Word-level helpers are shared by the server (verifying quotes) and the browser (highlighting them in the PDF).
 */

/* ---------------------------------------------------------------- titles as keys */

/** Latin letters and digits of a title, lower case, diacritics folded, every other run one space: the fold the merge key had before F3. */
const foldLatin = (title: string): string =>
  title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * A title as a key: "Résumé of Deep-Learning (2nd ed.)" -> "resume of deep learning 2nd ed". A title with a Latin letter or a digit folds to exactly the key it always had (so a stored id
 * `t:<key>|<year>` does not change); a title with none (Devanagari, any other script) keeps the letters, marks and digits of its own script, lower case, every other run one space, where it
 * used to fold to "" and every such paper of a year shared one key (bug B5). `latinOnly`: the old fold alone, for the words of a query sent to a source (arXiv, DOAJ) that is asked in English.
 */
export function foldTitle(title: string, opts: { latinOnly?: boolean } = {}): string {
  const latin = foldLatin(title);
  if (latin || opts.latinOnly) return latin;
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

/** The key of a paper that has neither a DOI nor a PMID, as the search merges and names it (its id is `t:` and this key): its folded title and its year. */
export const titleKey = (title: string, year: number | null | undefined): string => `${foldTitle(title)}|${year ?? ""}`;

/* ---------------------------------------------------------------- one line */

/** White space collapsed to single spaces, nothing at either end. */
export const squash = (s: string): string => s.replace(/\s+/g, " ").trim();

const cp = (c: number) => String.fromCodePoint(c);
/**
 * Text that shows nothing, the one list of the server, the page and "Copy the answer" (bug B19): the bidi controls (U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069) can make text read
 * other than it is; the zero-width space, the word joiner and the invisible operators (U+2060 to U+2064) and the byte-order mark hide words from a person; the tag characters (U+E0000 to U+E007F)
 * mirror ASCII and are a known way to smuggle an instruction past a reader. Built from code points, so that no invisible character is typed into this file. U+200C and U+200D are NOT here: Hindi
 * and other Indian scripts are written with them (a conjunct with and without a joiner is not the same word). A record of a search is cleaned with a wider list (plainText).
 */
const INVISIBLE = new RegExp(`[${[0x061c, 0x200b, 0x200e, 0x200f, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff].map(cp).join("")}${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}${cp(0xe0000)}-${cp(0xe007f)}]`, "gu");
/** The C0 control characters and DEL (tab, line feed and carriage return among them). */
const CONTROLS = new RegExp(`[${cp(0)}-${cp(0x1f)}${cp(0x7f)}]`, "g");
/** The same, the C1 control characters and the two line separators: a record's field as one line of a copied list. */
const CONTROLS_C1 = new RegExp(`[${cp(0)}-${cp(0x1f)}${cp(0x7f)}-${cp(0x9f)}${cp(0x2028)}${cp(0x2029)}]`, "g");

/** The text without the characters that show nothing (INVISIBLE). */
export const stripInvisible = (s: string): string => s.replace(INVISIBLE, "");

/** Control characters and line breaks as single spaces, white space collapsed: a message, a topic, a tag or a name as it is checked (invisible characters are left; `oneLine` takes them out too). */
export const flatLine = (s: string): string => squash(s.replace(CONTROLS, " "));

/**
 * A text as one line: nothing invisible, no control character, no line break. A title or an answer is data from outside, and one that held a line break and "[2] ..." could otherwise start a line of
 * its own. `c1`: the C1 controls and the line separators become spaces too (a field of a record in a copied list).
 */
export const oneLine = (s: string, opts: { c1?: boolean } = {}): string => squash(stripInvisible(s).replace(opts.c1 ? CONTROLS_C1 : CONTROLS, " "));

let graphemes: Intl.Segmenter | null | undefined;
/**
 * At most `max` characters (UTF-16 units, as every limit here is counted), cut where a whole character ends: never between the two halves of a character outside the basic plane, and, where the
 * platform can tell, never in the middle of a Hindi conjunct or a letter with its marks. Only the start of a long text is segmented.
 */
export function cutWhole(s: string, max: number): string {
  if (s.length <= max) return s;
  if (graphemes === undefined) graphemes = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
  const head = s.slice(0, max + 16);
  const parts = graphemes ? Array.from(graphemes.segment(head), (x) => x.segment) : Array.from(head);
  let out = "";
  for (const part of parts) {
    if (out.length + part.length > max) break;
    out += part;
  }
  return out;
}

/**
 * The delimiters of a prompt, made harmless in a text that is put inside one: a run of three quotes (which closes a message block) and of three angle brackets (which would close or open a
 * fence). The same text always gives the same result, so prompts stay stable and tests can pin them.
 */
export const neutralise = (s: string): string => s.replace(/"{3,}/g, "'''").replace(/<{3,}/g, "<<").replace(/>{3,}/g, ">>");

const LOCAL = /[A-Za-z0-9._%+-]/;
const DOMAIN = /[A-Za-z0-9.-]/;
const LETTER = /[A-Za-z]/;
/**
 * Every e-mail address inside a text (Latin letters and digits) replaced by `by`: what `s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, by)` gives, found from each "@" outwards
 * (the name before it, as far back as it goes; after it, up to the last dot that two letters follow, and those letters), because that pattern is tried again from every start of a long run of
 * name characters with no "@" (CodeQL js/polynomial-redos).
 */
export function replaceEmails(s: string, by: string): string {
  let out = "";
  let from = 0;
  for (let at = s.indexOf("@"); at >= 0; at = s.indexOf("@", at + 1)) {
    if (at < from) continue;
    let start = at;
    while (start > from && LOCAL.test(s[start - 1]!)) start--;
    if (start === at) continue;
    let end = at + 1;
    while (end < s.length && DOMAIN.test(s[end]!)) end++;
    let dot = -1;
    for (let j = end - 1; j >= at + 2; j--) if (s[j] === "." && LETTER.test(s[j + 1] ?? "") && LETTER.test(s[j + 2] ?? "")) { dot = j; break; }
    if (dot < 0) continue;
    let stop = dot + 1;
    while (stop < end && LETTER.test(s[stop]!)) stop++;
    out += s.slice(from, start) + by;
    from = stop;
  }
  return out + s.slice(from);
}
const LINK_IN_TEXT = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;

/** One line of plain text, bounded, with e-mail addresses and links taken out: what a person's free text may be before it is sent to a model or kept. */
export function scrubText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return replaceEmails(v, " ").replace(LINK_IN_TEXT, " ").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max).trim();
}

/* ---------------------------------------------------------------- numbers and years */

/** A whole number, within `min` and `max` when they are given. */
export const isInt = (v: unknown, min = -Infinity, max = Infinity): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
/** A whole number from 0, at most `max`: a count. */
export const isCount = (v: unknown, max = Infinity): v is number => isInt(v, 0, max);

/** The years a search may be limited to (a filter, the router's and the Understand step's), and the years a paper's record may carry (the history and the page's copy of it). */
export const FILTER_YEARS = { min: 1900, max: 2100 } as const;
export const PUBLICATION_YEARS = { min: 1000, max: 2999 } as const;
export const isYear = (v: unknown, range: { readonly min: number; readonly max: number }): v is number => isInt(v, range.min, range.max);

/** Control characters, zero-width and bidirectional marks and the joiners as spaces, runs of space as one: the line the Understand step reads and writes (it keeps its own rule: the joiners too). */
export function plainLine(s: string): string {
  return s
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------------------------------------------------------------- a record's text as plain text */

/*
 * The entities plainText decodes: a fixed set, not HTML's 2,000 names. The XML five, the spaces, typographic punctuation, the whole of Latin-1 (U+00A0 to U+00FF, in code point order, as HTML 4 names
 * them), the letters of Latin Extended-A that HTML 4 names, Greek and the few signs that science titles use: 207 names, 205 of the 252 that HTML 4 gives. The 47 it leaves are the other arrows, mathematical and
 * technical signs, a few letter-like and Greek symbols and the card suits (plain-text.test.ts holds the table, name by name, against Python's html.entities). A name that is not here ("&NA;", which some
 * indexes put in an author field) is left as it came.
 */
const LATIN1 = "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml";
const GREEK_LOWER = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega"; // from U+03B1
const GREEK_UPPER = "Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho"; // from U+0391 (U+03A2 is not a letter)
const GREEK_UPPER_REST = "Sigma Tau Upsilon Phi Chi Psi Omega"; // from U+03A3
let entities: Map<string, number> | undefined;
/** The table, built the first time a text is decoded (the page loads this module and decodes nothing, so the table stays out of its first load). */
const entityTable = (): Map<string, number> =>
  (entities ??= new Map<string, number>([
  ...Object.entries({
    amp: 38, lt: 60, gt: 62, quot: 34, apos: 39, ast: 42, OElig: 0x152, oelig: 0x153, Scaron: 0x160, scaron: 0x161, Yuml: 0x178, fnof: 0x192, circ: 0x2c6, tilde: 0x2dc, ensp: 0x2002, emsp: 0x2003, thinsp: 0x2009,
    zwnj: 0x200c, zwj: 0x200d, lrm: 0x200e, rlm: 0x200f, ndash: 0x2013, mdash: 0x2014, lsquo: 0x2018, rsquo: 0x2019, sbquo: 0x201a, ldquo: 0x201c, rdquo: 0x201d,
    bdquo: 0x201e, dagger: 0x2020, Dagger: 0x2021, bull: 0x2022, hellip: 0x2026, permil: 0x2030, prime: 0x2032, Prime: 0x2033, lsaquo: 0x2039, rsaquo: 0x203a, euro: 0x20ac, trade: 0x2122, larr: 0x2190,
    uarr: 0x2191, rarr: 0x2192, darr: 0x2193, harr: 0x2194, part: 0x2202, nabla: 0x2207, isin: 0x2208, sum: 0x2211, minus: 0x2212, lowast: 0x2217, radic: 0x221a, prop: 0x221d, infin: 0x221e, int: 0x222b,
    there4: 0x2234, sim: 0x223c, asymp: 0x2248, ne: 0x2260, equiv: 0x2261, le: 0x2264, ge: 0x2265,
  }),
  ...LATIN1.split(" ").map((n, i): [string, number] => [n, 0xa0 + i]),
  ...GREEK_LOWER.split(" ").map((n, i): [string, number] => [n, 0x3b1 + i]),
  ...GREEK_UPPER.split(" ").map((n, i): [string, number] => [n, 0x391 + i]),
  ...GREEK_UPPER_REST.split(" ").map((n, i): [string, number] => [n, 0x3a3 + i]),
]));
// A numeric reference from 128 to 159 is the Windows-1252 character, as a browser reads it ("&#146;" is the right quote, "&#150;" the en dash); the five that Windows-1252 leaves unassigned (0) stay control characters.
const WINDOWS_1252 = [0x20ac, 0, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0, 0x17d, 0, 0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0, 0x17e, 0x178];
// a name is at most 8 characters and a number at most 7 digits (6 in hex), so no input makes this scan far ahead of where it stands
const ENTITY = /&(?:#([0-9]{1,7})|#[xX]([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{1,7}));/g;
/**
 * One pass of the entity decoder (the one decoder of both apps, decision 18): every name of ENTITIES, a decimal or hex reference (128 to 159 as Windows-1252), a name it does not know left as it came.
 * Nothing else is changed. plainText runs it at most twice; an XML text (JATS) and an attribute of a page are decoded once. `dropInvalid`: a reference to no character (0, past U+10FFFF, half a
 * surrogate pair) is taken out instead of left as it came, as the JATS reader has always done with a broken file.
 */
export const decodeEntities = (s: string, opts: { dropInvalid?: boolean } = {}): string =>
  s.replace(ENTITY, (whole, dec?: string, hex?: string, name?: string) => {
    const code = name !== undefined ? entityTable().get(name) : dec !== undefined ? Number(dec) : parseInt(hex!, 16);
    if (code !== undefined && opts.dropInvalid && (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))) return "";
    if (code === undefined || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole;
    return String.fromCodePoint((code >= 0x80 && code <= 0x9f && WINDOWS_1252[code - 0x80]) || code);
  });

/**
 * Characters that show nothing, as a letter or a mark would: direction marks and isolates (they can also make a title read backwards), the zero-width space, the word joiner and the invisible math signs, the
 * byte-order mark, the soft hyphen (a hint where a word may break, never a part of it: "Pre&shy;diction" is "Prediction"), the combining grapheme joiner, the Hangul fillers, the deprecated format characters
 * U+206A to U+206F, the interlinear annotation marks and the whole tag block U+E0000 to U+E007F (ASCII written in it shows nothing and a model reads it).
 * Not here, because a script or an emoji needs them: U+200C and U+200D (Hindi and Persian are written with them), the variation selectors, the Mongolian ones U+180B to U+180D and U+180F, the Arabic number
 * signs and the Khmer inherent vowels.
 */
const INVISIBLE_RANGES: [number, number][] = [[0xad, 0xad], [0x34f, 0x34f], [0x115f, 0x1160], [0x180e, 0x180e], [0x200b, 0x200b], [0x2060, 0x2064], [0x206a, 0x206f], [0x3164, 0x3164], [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff9, 0xfffb], [0xe0000, 0xe007f]];
let invisibleWide: RegExp | undefined;
const INVISIBLE_WIDE = (): RegExp => (invisibleWide ??= new RegExp(/\p{Bidi_Control}/u.source + "|[" + INVISIBLE_RANGES.map(([from, to]) => String.fromCodePoint(from) + (to > from ? "-" + String.fromCodePoint(to) : "")).join("") + "]", "gu"));
// tab, newline and carriage return, the C1 controls, a lone surrogate and a noncharacter (U+FDD0 to U+FDEF, U+FFFE, U+FFFF and the last two of every plane). U+2028 and U+2029 are white space: the collapse below makes them a space.
const CONTROL = /[\p{Cc}\p{Cs}\p{Noncharacter_Code_Point}]/gu;
/**
 * More than 30 combining marks in a row is not text (UAX #15 calls 30 the most a stream can hold, its Stream-Safe Text Format; no script comes near it) and it is the one thing that makes NFC slow: String.normalize
 * is quadratic on a run of marks it has to put in order, so 100,000 of them took 3.6 seconds and 400,000 over a minute. Cut at 30 before NFC, and again after it, because NFC makes two of a few marks (U+0344).
 */
const MARK_RUN = /\p{M}{31,}/gu;
const cutMarks = (s: string) =>
  s.replace(MARK_RUN, (run) => {
    let out = "";
    let n = 0;
    for (const mark of run) {
      if (++n > 30) break; // not Array.from: a run of a million marks is walked 30 steps, not a million
      out += mark;
    }
    return out;
  });

/** "<" and a letter, "/", "!" or "?" starts a tag; "x < 5" and "p<0.05" do not. Found with indexOf, so a long run of "<" with no ">" after it costs one pass and not one for each "<". */
function stripTags(s: string): string {
  let out = "";
  let from = 0;
  for (;;) {
    const open = s.indexOf("<", from);
    if (open < 0) break;
    if (!/[A-Za-z/!?]/.test(s.charAt(open + 1))) {
      out += s.slice(from, open + 1);
      from = open + 1;
      continue;
    }
    const close = s.indexOf(">", open + 2);
    if (close < 0) break; // nothing after this can be closed either
    out += s.slice(from, open) + " ";
    from = close + 1;
  }
  return out + s.slice(from);
}

/**
 * A provider's string as the plain text a person reads and a citation holds. In this order: tags out (`tags`: an abstract, which Crossref and DOAJ send as JATS; a title may hold a real "<"), invisible
 * characters out (INVISIBLE_WIDE), the entities of ENTITIES decoded, at most twice (Crossref sends "&amp;amp;"; the third level of "&amp;amp;amp;" stays as "&amp;"), control characters, noncharacters and lone surrogates
 * a space, white space (U+2028 and U+2029 too) collapsed, runs of more than 30 combining marks cut, NFC. Tags are never stripped after the decoding: "&lt;5 mg and &gt;3" is text, not a tag, and "&lt;script&gt;"
 * stays as the text "<script>". The result is text, never markup: show it as text, in a page and in a prompt.
 * A second look at a result changes nothing unless it still has a third level of escaping, so it is safe on what an earlier version already cleaned. That holds without `tags`, which is how the search reads
 * every field, and for the order the product uses (`tags` at the adapter, then none). With `tags` twice it does not hold on purpose: the first look decodes "&lt;b&gt;" to text that looks like a tag.
 * Nothing but NFC makes a string longer (it does for the few letters Unicode excludes from composing, such as U+0958). Not a string (null, undefined, a number): "".
 */
export function plainText(s: unknown, opts: { tags?: boolean } = {}): string {
  if (typeof s !== "string") return "";
  let t = opts.tags ? stripTags(s) : s;
  for (let pass = 0; pass < 2; pass++) {
    t = t.replace(INVISIBLE_WIDE(), ""); // first, so an entity written across one ("&am" + zero-width space + "p;") is still that entity
    const next = decodeEntities(t);
    if (next === t) break;
    t = next;
  }
  return cutMarks(cutMarks(t.replace(INVISIBLE_WIDE(), "").replace(CONTROL, " ").replace(/\s+/g, " ").trim()).normalize("NFC"));
}

/* ---------------------------------------------------------------- words */

/** Lower-case words and numbers; diacritics folded so "Résumé" and "resume" compare equal. Punctuation is dropped. */
export const words = (s: string): string[] => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * The words of a reference and of a record's title as the reference check compares them: decomposed first (NFKD), then diacritics folded and lower case, so a compatibility letter ("ℂ", "ﬁ") reads as
 * the plain one. `words` folds the case first; the two differ for some 700 such letters, and each keeps its own order so that what it compared does not change.
 */
export const tokenize = (s: string): string[] => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

/** The words of a query in a person's own papers (the page marks the same words it searched for): lower case, letters, marks and digits, two characters or more, each once, at most six. */
export const searchWords = (q: string): string[] => [...new Set(q.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w.length >= 2))].slice(0, 6);

/** The words of a query that carry meaning, for a source asked in English (arXiv, DOAJ): the Latin fold, longer than two letters, not in `stop`, each once, at most `max`. */
export const queryTerms = (q: string, stop: ReadonlySet<string>, max: number): string[] => [...new Set(foldTitle(q, { latinOnly: true }).split(" ").filter((w) => w.length > 2 && !stop.has(w)))].slice(0, max);

/* ---------------------------------------------------------------- numbers and negations in a sentence */

/** The words of a sentence for the checks of a model's restatement: NFKC, lower case, letters, marks and digits. `splitNot`: "doesn't" is read as "does not" (the rewrite check). */
export const sentenceWords = (s: string, opts: { splitNot?: boolean } = {}): string[] => {
  const t = s.normalize("NFKC").toLowerCase();
  return (opts.splitNot ? t.replace(/(\w)n['’]t/g, "$1 not") : t).match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
};

/** Devanagari digits as 0 to 9 ("२०२०" is 2020). */
export const asciiDigits = (s: string): string => s.replace(/[०-९]/g, (d) => String("०१२३४५६७८९".indexOf(d)));
/** The numbers a sentence states ("12,000" is 12000, "0.5" stays), in order. `devanagari`: Devanagari digits count too. */
export const statedNumbers = (s: string, opts: { devanagari?: boolean } = {}): string[] => {
  const t = s.normalize("NFKC");
  return (opts.devanagari ? asciiDigits(t) : t).replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? [];
};

/**
 * The words that negate, as each check reads them: the restatement check of a follow-up (with the Hinglish "nhi", "bina", "mat" and the Hindi "मत") and the check of a shorter claim (with "नहि").
 * Two named lists until the follow-up eval shows that their union changes nothing (docs/design/untangle.md, F3).
 */
export const NEGATIONS_RESTATE: ReadonlySet<string> = new Set(["no", "not", "nor", "never", "none", "neither", "without", "cannot", "nothing", "nahi", "nahin", "nhi", "bina", "mat", "नहीं", "नही", "बिना", "मत", "न"]);
export const NEGATIONS_REWRITE: ReadonlySet<string> = new Set(["no", "not", "nor", "never", "none", "neither", "without", "cannot", "nothing", "nahi", "nahin", "नहीं", "नही", "न", "बिना", "नहि"]);

export type Run = { /** words of `needle` found together */ len: number; /** index in `hay` where the run starts */ start: number };

/** The longest stretch of consecutive `needle` words that also appears, unbroken and in order, in `hay`. */
export function findRun(needle: string[], hay: string[]): Run {
  let best: Run = { len: 0, start: 0 };
  let prev = new Array<number>(hay.length + 1).fill(0);
  for (const w of needle) {
    const cur = new Array<number>(hay.length + 1).fill(0);
    for (let j = 1; j <= hay.length; j++) {
      if (hay[j - 1] === w) {
        cur[j] = prev[j - 1]! + 1;
        if (cur[j]! > best.len) best = { len: cur[j]!, start: j - cur[j]! };
      }
    }
    prev = cur;
  }
  return best;
}

/**
 * Every place the words of `needle` appear together, in order and unbroken, in `hay` (start indices). The LAST needle word may be a
 * beginning ("transfor" finds "transformer"), so a search can be run while it is still being typed.
 */
export function findAll(needle: string[], hay: string[]): number[] {
  const out: number[] = [];
  const n = needle.length;
  if (n === 0) return out;
  const last = needle[n - 1]!;
  for (let i = 0; i + n <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < n - 1 && ok; j++) ok = hay[i + j] === needle[j];
    if (ok && hay[i + n - 1]!.startsWith(last)) out.push(i);
  }
  return out;
}

/* ---------------------------------------------------------------- saved highlights: where they are on a page */

export type SpanPos = { span: number; start: number; end: number };

/**
 * Where a saved quote sits among the pieces of text of a rendered page (the spans of pdf.js's text layer): the first and the last word of the quote, each with
 * the span it is in and its character positions there. Found by words, like every other quote in the app, so it survives zoom and re-rendering. Null when
 * too little of the quote is on the page (`minShare` of its words, and at least `minWords`).
 * A span whose words cannot be mapped one to one onto its characters counts as wholly part of the quote (a marker slightly too wide, never one that is missing).
 */
export function locateInSpans(texts: readonly string[], quote: string, minShare = 0.6, minWords = 2): { first: SpanPos; last: SpanPos; matched: number; of: number } | null {
  const hay: string[] = [];
  const pos: SpanPos[] = [];
  texts.forEach((t, i) => {
    const w = words(t);
    const raw = [...t.matchAll(/[\p{L}\p{N}]+/gu)];
    const exact = raw.length === w.length;
    w.forEach((word, k) => {
      hay.push(word);
      pos.push(exact ? { span: i, start: raw[k]!.index!, end: raw[k]!.index! + raw[k]![0].length } : { span: i, start: 0, end: t.length });
    });
  });
  const q = words(quote);
  if (q.length === 0 || hay.length === 0) return null;
  const run = findRun(q, hay);
  if (run.len < Math.max(minWords, Math.ceil(q.length * minShare))) return null;
  return { first: pos[run.start]!, last: pos[run.start + run.len - 1]!, matched: run.len, of: q.length };
}

export type MarkRect = { x: number; y: number; w: number; h: number };

/**
 * The boxes of a highlight as the browser reports them (one per piece of text, and often one for the element round it too) become the boxes to draw:
 * tiny ones are dropped, a box inside another is dropped, and boxes on one line that touch or overlap are joined into one, so a highlight is a few clean bars.
 */
export function mergeLineRects(rects: readonly MarkRect[]): MarkRect[] {
  const ok = rects.filter((r) => r.w >= 1 && r.h >= 1 && Number.isFinite(r.x + r.y + r.w + r.h));
  const inside = (a: MarkRect, b: MarkRect) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
  const kept = ok.filter((a, i) => !ok.some((b, j) => j !== i && inside(a, b) && (!inside(b, a) || j < i)));
  // group the boxes by line (the middle of the box, within 40% of its height), then join those that touch from left to right
  const lines: MarkRect[][] = [];
  for (const r of [...kept].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l[0]!.y + l[0]!.h / 2 - (r.y + r.h / 2)) <= Math.max(l[0]!.h, r.h) * 0.4);
    if (line) line.push(r);
    else lines.push([r]);
  }
  const out: MarkRect[] = [];
  for (const line of lines) {
    let cur: MarkRect | null = null;
    for (const r of line.sort((a, b) => a.x - b.x)) {
      if (cur && r.x <= cur.x + cur.w + 3) {
        const top = Math.min(cur.y, r.y);
        const bottom = Math.max(cur.y + cur.h, r.y + r.h);
        const right = Math.max(cur.x + cur.w, r.x + r.w);
        cur = { x: cur.x, y: top, w: right - cur.x, h: bottom - top };
        out[out.length - 1] = cur;
      } else {
        cur = { ...r };
        out.push(cur);
      }
    }
  }
  return out.map((r) => ({ x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.w * 10) / 10, h: Math.round(r.h * 10) / 10 }));
}

/** What to do with a new highlight, given the highlights and notes already on the page. */
export type NewHighlightPlan =
  | { action: "add" }
  /** The same text is already highlighted (in this or another colour): change that one, never draw a second copy on top. */
  | { action: "recolor"; id: string }
  /** Nothing to do: it is the same text in the same colour, or a part of a highlight that already has that colour. */
  | { action: "skip"; id: string }
  /** The reader wants a note on text that already has a highlight: open that one. */
  | { action: "open"; id: string };

const norm = (s: string) => words(s).join(" ");

/**
 * Highlights may overlap (a different colour over part of one, a longer one around a short one) and each stays visible; what is refused is a copy of the same thing:
 *  - the same words again: a note request opens the existing one, a new colour recolours it, the same colour changes nothing;
 *  - a part of a highlight of the same colour, without a note: nothing to add;
 *  - everything else (a part in another colour, a longer text, an overlap, a note on a part) is added next to what is there.
 */
export function planNewHighlight(existing: readonly { id: string; page: number; quote: string; color: string }[], n: { page: number; quote: string; color: string; withNote: boolean }): NewHighlightPlan {
  const q = norm(n.quote);
  const same = existing.find((e) => e.page === n.page && norm(e.quote) === q);
  if (same) return n.withNote ? { action: "open", id: same.id } : same.color !== n.color ? { action: "recolor", id: same.id } : { action: "skip", id: same.id };
  if (!n.withNote) {
    const around = existing.find((e) => e.page === n.page && e.color === n.color && ` ${norm(e.quote)} `.includes(` ${q} `));
    if (around) return { action: "skip", id: around.id };
  }
  return { action: "add" };
}

/**
 * A note a person typed, as it is kept (docs/design/paper-reader.md, 19.6): line breaks stay; within a line, runs of spaces and tabs become one space and the line's end is trimmed;
 * at most two blank lines stay together; blank lines before the first line and after the last go. Cut to `max` characters. Not a string: "". (A quote, which comes from the paper's
 * text layer, keeps its one-line cleaning.)
 */
export function cleanNoteText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const lines = v
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .split("\n")
    .map((l) => l.replace(/[^\S\n]+/g, " ").trimEnd());
  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n").replace(/^\n+|\n+$/g, "").slice(0, max).trimEnd();
}
