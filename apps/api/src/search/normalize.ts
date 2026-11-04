import type { ProviderPaper } from "./types";

/**
 * "https://doi.org/10.1000/ABC" -> "10.1000/abc" (DOIs are case-insensitive).
 * Also strips link artefacts some indexes leave on the DOI ("10.1051/bioconf/202621302009/pdf"), which would otherwise be a DOI
 * that does not exist.
 */
export function normalizeDoi(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.trim().match(/10\.\d{4,9}\/\S+/i);
  if (!m) return null;
  return m[0]
    .toLowerCase()
    .replace(/[.,;)\]]+$/, "")
    .replace(/\/(pdf|epdf|pdfdirect|full|fulltext|full-text|abstract|summary|html|xml|meta)$/, "");
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/*
 * The entities plainText decodes: a fixed set, not HTML's 2,000 names. The XML five, the spaces, typographic punctuation, the whole of Latin-1 (U+00A0 to U+00FF, in code point order, as HTML 4 names
 * them), the letters of Latin Extended-A that HTML 4 names, Greek and the few signs that science titles use: 207 names, 205 of the 252 that HTML 4 gives. The 47 it leaves are the other arrows, mathematical and
 * technical signs, a few letter-like and Greek symbols and the card suits (plain-text.test.ts holds the table, name by name, against Python's html.entities). A name that is not here ("&NA;", which some
 * indexes put in an author field) is left as it came.
 */
const LATIN1 = "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml".split(" ");
const GREEK_LOWER = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega".split(" "); // from U+03B1
const GREEK_UPPER = "Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho".split(" "); // from U+0391 (U+03A2 is not a letter)
const GREEK_UPPER_REST = "Sigma Tau Upsilon Phi Chi Psi Omega".split(" "); // from U+03A3
const ENTITIES = new Map<string, number>([
  ...Object.entries({
    amp: 38, lt: 60, gt: 62, quot: 34, apos: 39, ast: 42, OElig: 0x152, oelig: 0x153, Scaron: 0x160, scaron: 0x161, Yuml: 0x178, fnof: 0x192, circ: 0x2c6, tilde: 0x2dc, ensp: 0x2002, emsp: 0x2003, thinsp: 0x2009,
    zwnj: 0x200c, zwj: 0x200d, lrm: 0x200e, rlm: 0x200f, ndash: 0x2013, mdash: 0x2014, lsquo: 0x2018, rsquo: 0x2019, sbquo: 0x201a, ldquo: 0x201c, rdquo: 0x201d,
    bdquo: 0x201e, dagger: 0x2020, Dagger: 0x2021, bull: 0x2022, hellip: 0x2026, permil: 0x2030, prime: 0x2032, Prime: 0x2033, lsaquo: 0x2039, rsaquo: 0x203a, euro: 0x20ac, trade: 0x2122, larr: 0x2190,
    uarr: 0x2191, rarr: 0x2192, darr: 0x2193, harr: 0x2194, part: 0x2202, nabla: 0x2207, isin: 0x2208, sum: 0x2211, minus: 0x2212, lowast: 0x2217, radic: 0x221a, prop: 0x221d, infin: 0x221e, int: 0x222b,
    there4: 0x2234, sim: 0x223c, asymp: 0x2248, ne: 0x2260, equiv: 0x2261, le: 0x2264, ge: 0x2265,
  }),
  ...LATIN1.map((n, i): [string, number] => [n, 0xa0 + i]),
  ...GREEK_LOWER.map((n, i): [string, number] => [n, 0x3b1 + i]),
  ...GREEK_UPPER.map((n, i): [string, number] => [n, 0x391 + i]),
  ...GREEK_UPPER_REST.map((n, i): [string, number] => [n, 0x3a3 + i]),
]);
// A numeric reference from 128 to 159 is the Windows-1252 character, as a browser reads it ("&#146;" is the right quote, "&#150;" the en dash); the five that Windows-1252 leaves unassigned (0) stay control characters.
const WINDOWS_1252 = [0x20ac, 0, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0, 0x17d, 0, 0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0, 0x17e, 0x178];
// a name is at most 8 characters and a number at most 7 digits (6 in hex), so no input makes this scan far ahead of where it stands
const ENTITY = /&(?:#([0-9]{1,7})|#[xX]([0-9A-Fa-f]{1,6})|([A-Za-z][A-Za-z0-9]{1,7}));/g;
const decodeOnce = (s: string) =>
  s.replace(ENTITY, (whole, dec?: string, hex?: string, name?: string) => {
    const code = name !== undefined ? ENTITIES.get(name) : dec !== undefined ? Number(dec) : parseInt(hex!, 16);
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
const INVISIBLE = new RegExp(/\p{Bidi_Control}/u.source + "|[" + INVISIBLE_RANGES.map(([from, to]) => String.fromCodePoint(from) + (to > from ? "-" + String.fromCodePoint(to) : "")).join("") + "]", "gu");
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
 * characters out (INVISIBLE), the entities of ENTITIES decoded, at most twice (Crossref sends "&amp;amp;"; the third level of "&amp;amp;amp;" stays as "&amp;"), control characters, noncharacters and lone surrogates
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
    t = t.replace(INVISIBLE, ""); // first, so an entity written across one ("&am" + zero-width space + "p;") is still that entity
    const next = decodeOnce(t);
    if (next === t) break;
    t = next;
  }
  return cutMarks(cutMarks(t.replace(INVISIBLE, "").replace(CONTROL, " ").replace(/\s+/g, " ").trim()).normalize("NFC"));
}

const textOrNull = (v: unknown): string | null => (typeof v === "string" ? plainText(v) || null : null);

/**
 * A provider's paper with every string it shows made plain text: title, venue, authors and abstract (a list entry with nothing left is dropped, a venue or abstract with nothing left is null). Tags are not stripped here:
 * the adapter did that for an abstract (stripJats) before the text was decoded, and a second strip of decoded text would take "n<m and k>j" for a tag. So an abstract is decoded twice there and twice again here, four
 * levels of escaping in all, and a title, venue or author two. Never changes its argument.
 */
export function plainPaper(p: ProviderPaper): ProviderPaper {
  return {
    ...p,
    title: plainText(p.title),
    authors: Array.isArray(p.authors) ? p.authors.map((a) => plainText(a)).filter(Boolean) : [],
    venue: textOrNull(p.venue),
    abstract: textOrNull(p.abstract),
  };
}

/**
 * A provider's list, as the search reads it: every paper plain text (plainPaper). What is not a record in it (null, a number, a string) is skipped and a value that is not a list is no papers, because the list may have
 * come from the cache. A paper whose title is nothing once cleaned ("&nbsp;") is dropped, as every adapter drops one that came with no title: a card with no title cannot be shown, and the id of a paper with
 * no DOI is built from its title, so every such paper of a year would be the same one.
 */
export function plainPapers(list: unknown): ProviderPaper[] {
  if (!Array.isArray(list)) return [];
  return list.filter((p): p is ProviderPaper => !!p && typeof p === "object").map((p) => plainPaper(p)).filter((p) => p.title !== "");
}

/** Crossref abstracts JATS XML hote hain: tags hata kar plain text banao. */
export function stripJats(xml: string | null | undefined): string | null {
  if (!xml) return null;
  return plainText(xml, { tags: true }).replace(/^abstract\s*/i, "") || null;
}

/** OpenAlex abstract_inverted_index ({word: [positions]}) se text banao. */
export function invertedIndexToText(idx: Record<string, number[]> | null | undefined): string | null {
  if (!idx) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(idx)) {
    for (const p of positions) words[p] = word;
  }
  const text = words.filter(Boolean).join(" ").trim();
  return text || null;
}

/** OpenAlex filter syntax todne wale characters hatao (, | : se filters/OR split hote hain). */
export function sanitizeQuery(q: string): string {
  return q.replace(/[,|:;"]/g, " ").replace(/\s+/g, " ").trim();
}
