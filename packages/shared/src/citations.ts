/**
 * In-text citations of a paper ("[12]", "[3-5]", "[ADG16]", "(Vaswani et al., 2017)", "Smith and Jones (2019a)") found in the text of a page, and linked to the entry of the
 * paper's own reference list they point at. Pure functions on plain strings, shared by the reader (apps/web/src/lib/citations.ts) and the tests. docs/design/reader-citations.md.
 *
 * The rule throughout: a citation that cannot be linked to exactly one entry is not shown. A highlight with a wrong card costs more trust than a citation left plain.
 */
import type { LabelledEntry } from "./paperinfo";
import { words } from "./text";

/** What a citation points at: a number of a numbered list, a key of a keyed list ("ADG16"), or authors and a year. */
export type CiteTarget =
  | { kind: "num"; n: number }
  | { kind: "key"; key: string }
  | { kind: "ay"; surnames: string[]; etAl: boolean; year: number; suffix: string | null };

/** A citation in a page's text: its characters [start, end), and what it points at (a range "[3-5]" or "Smith (2019a, b)" points at several). */
export type InTextCite = { start: number; end: number; text: string; targets: CiteTarget[] };

/** Which kinds to look for: numbers only when the list is numbered (and up to its last number), keys only when it is keyed. Author-year is always looked for. */
export type CiteStyle = { maxNumber: number; keyed: boolean };

/* ---------------------------------------------------------------- the pieces */

// Lower-case name particles in front of a surname ("van der Berg", "de Souza", "al-Farabi" has its own hyphen).
const PARTICLE = String.raw`(?:(?:[vV]an|[vV]on|[dD]e|[dD]er|[dD]en|[dD]el|[dD]ella|[dD]i|[dD]a|[dD]u|[dD]os|[dD]as|[lL]a|[lL]e|[tT]en|[tT]er|bin|ibn|al|el|[sS]t\.?)\s+){0,3}`;
// A surname starts with a capital (or a letter of a script without case, such as Devanagari) and has two letters or more: "Vaswani", "O'Neil", "Rodríguez-García", "शर्मा", "WHO".
// PDFs made with LaTeX often give an accent as a character of its own next to its letter ("R¨uckl´e", "S´anchez"): those (\p{Sk}) are part of a name too.
const NAME = String.raw`[\p{Lu}\p{Lo}][\p{L}\p{M}\p{Sk}'’\-]*[\p{L}\p{M}]`;
const SURNAME = PARTICLE + NAME;
const ETAL = String.raw`\s+et\.?\s*al(?:ii|\.)?`;
const AND = String.raw`(?:\s*,?\s+(?:and|&|और|und|y|et)\s+|\s*&\s*)`;
/** "Smith", "Smith et al.", "Smith and Jones", "Smith & Jones", "Smith, Jones, and Lee" (the older form that names three). */
const AUTHORS = String.raw`${SURNAME}(?:${ETAL}|${AND}${SURNAME}|(?:\s*,\s*${SURNAME}){1,4}${AND}${SURNAME})?`;
const YEAR = String.raw`(?:1[6-9]\d\d|20\d\d)`;
/** "2017", "2019a", "2019a, b", "2019, 2020", "2019a, 2019b". */
const YEARS = String.raw`${YEAR}[a-z]?(?:\s*,\s*(?:${YEAR}[a-z]?|[a-z])(?![\p{L}\p{N}]))*`;
/** A page or part after the year: ", p. 4", ", pp. 3-5", " p. e62-e63", "p. 41", ", ch. 2", ", Table 1". */
const LOCATOR = String.raw`(?:\s*,?\s*(?:p|pp|pg|ch|chap|sec|fig|table|eq|para)\.\s*[\p{N}\p{L}–\-]+|\s*,\s*(?:p|pp|pg|ch|chap|sec|fig|table|eq|para)\s+[\p{N}–\-]+)?`;

const PAREN = /\(([^()]{4,300})\)/g;
/** Inside parentheses: every "authors, year(s)" that ends a part: at the end, or before ";", "," or the closing text. */
const PART = new RegExp(String.raw`(?<![\p{L}\p{M}\p{Sk}'’\-])(${AUTHORS})\s*,?\s+(${YEARS})(${LOCATOR})(?=\s*(?:$|[;,]))`, "gu");
const ONLY_YEARS = new RegExp(String.raw`^\s*;\s*(${YEARS})${LOCATOR}(?=\s*(?:$|[;,]))`, "u");
const NARRATIVE = new RegExp(String.raw`(?<![\p{L}\p{M}\p{N}])(${AUTHORS})\s*([(\[])(${YEARS})${LOCATOR}([)\]])`, "gu");
const HAS_YEAR = new RegExp(String.raw`(?<!\d)${YEAR}(?!\d)`);
const BRACKET = /\[([^\[\]]{1,80})\]/g;
const NUMS = /^\s*\d{1,3}(?:\s*[-–—]\s*\d{1,3})?(?:\s*[,;]\s*\d{1,3}(?:\s*[-–—]\s*\d{1,3})?)*\s*$/;
const NUM_TOKEN = /(\d{1,3})(?:\s*[-–—]\s*(\d{1,3}))?/g;
const KEY_TOKEN = /\p{Lu}[\p{L}+\-]{1,9}\s?\d{2,4}[a-z]?/gu;
const KEYS = /^\s*\p{Lu}[\p{L}+\-]{1,9}\s?\d{2,4}[a-z]?(?:\s*[,;]\s*\p{Lu}[\p{L}+\-]{1,9}\s?\d{2,4}[a-z]?)*\s*$/u;
/** Signs that make a bracket maths ("x ∈ [0, 1]", "= [2, 3]"), and words that do ("the interval [1, 3]"). */
const MATH_BEFORE = /[∈∉=<>≤≥≈∼~+×·*/^∪∩⊂⊆∀∃→↦]\s*$/;
const WORD_BEFORE = /\b(interval|intervals|range|ranges|between|matrix|vector|array|tuple|set|indices|index|from|to|size|shape|dim|dimension|dimensions|bits?|bytes?)\s*$/i;

/** The surnames of an author string: "Smith and Jones" -> ["Smith", "Jones"]; "Smith et al." -> ["Smith"]. */
// Read by tokens, not by a split regex: "\s*,\s*" and "\s+and\s+" are slow on a long run of white space (CodeQL js/polynomial-redos).
const CONNECTORS = new Set([",", "and", "und", "y", "et", "&", "और"]);
const ET_AL_TOKEN = /^et\.?al(?:ii|\.)?$/u;
function readAuthors(s: string): { surnames: string[]; etAl: boolean } {
  const tokens = s.replace(/[,&]/g, (c) => ` ${c} `).split(/\s+/).filter(Boolean);
  let etAl = false;
  // "et al.", "et. al.", "etal.", "et alii" at the end, after at least one name
  for (const n of [2, 1]) {
    if (tokens.length > n && ET_AL_TOKEN.test(tokens.slice(-n).join(""))) {
      tokens.splice(-n);
      etAl = true;
      break;
    }
  }
  const surnames: string[] = [];
  let name: string[] = [];
  for (const t of tokens) {
    if (CONNECTORS.has(t)) {
      if (name.length) surnames.push(name.join(" "));
      name = [];
    } else name.push(t);
  }
  if (name.length) surnames.push(name.join(" "));
  return { surnames, etAl };
}

/** "2019a, b" -> [{2019,"a"}, {2019,"b"}]; "2019, 2020" -> [{2019,null}, {2020,null}]. */
function readYears(s: string): { year: number; suffix: string | null }[] {
  const out: { year: number; suffix: string | null }[] = [];
  let last: number | null = null;
  for (const raw of s.split(",")) {
    const m = /^(\d{4})([a-z])?$/.exec(raw.trim());
    if (m) {
      last = Number(m[1]);
      out.push({ year: last, suffix: m[2] ?? null });
    } else if (/^[a-z]$/.test(raw.trim()) && last !== null) out.push({ year: last, suffix: raw.trim() });
  }
  return out;
}

const ay = (authors: string, years: string): CiteTarget[] => {
  const { surnames, etAl } = readAuthors(authors);
  if (surnames.length === 0) return [];
  return readYears(years).map((y) => ({ kind: "ay" as const, surnames, etAl, ...y }));
};

/* ---------------------------------------------------------------- finding */

/**
 * The citations in a page's text. Overlapping finds are resolved in favour of the longer one. Numbers are taken only up to `style.maxNumber` and not in maths;
 * see the header and docs/design/reader-citations.md for what is left out on purpose ("(12)", superscripts).
 */
export function findInTextCitations(text: string, style: CiteStyle): InTextCite[] {
  const found: InTextCite[] = [];

  // (Smith, 2019), (Smith and Jones 2019a; Lee et al., 2020, p. 4), (see Lee 2020), (Lucherini et al., 2017 p. 85, Rooke et al., 2016 p. e63)
  for (const m of text.matchAll(PAREN)) {
    const inner = m[1]!;
    if (!HAS_YEAR.test(inner)) continue;
    const open = m.index! + 1;
    const parts: { from: number; to: number; targets: CiteTarget[] }[] = [];
    for (const pm of inner.matchAll(PART)) {
      const authors = pm[1]!;
      const targets = ay(authors, pm[2]!);
      if (!targets.length) continue;
      let to = pm.index! + pm[0].length;
      parts.push({ from: pm.index!, to, targets });
      // "(Smith, 2019; 2020)": years after a ";" with no name belong to the authors before them
      for (let ym = ONLY_YEARS.exec(inner.slice(to)); ym; ym = ONLY_YEARS.exec(inner.slice(to))) {
        const lead = ym[0].length - ym[0].replace(/^\s*;\s*/, "").length;
        const more = ay(authors, ym[1]!);
        if (more.length) parts.push({ from: to + lead, to: to + ym[0].length, targets: more });
        to += ym[0].length;
      }
    }
    if (parts.length === 0) continue;
    // one citation in its own parentheses (little before it, nothing after it): the whole "(Vaswani et al., 2017)" is the citation
    if (parts.length === 1 && parts[0]!.from <= 12 && inner.slice(parts[0]!.to).trim() === "") {
      const end = m.index! + m[0].length;
      found.push({ start: m.index!, end, text: text.slice(m.index!, end), targets: parts[0]!.targets });
    } else {
      for (const p of parts) found.push({ start: open + p.from, end: open + p.to, text: text.slice(open + p.from, open + p.to), targets: p.targets });
    }
  }

  // Smith (2019), Smith and Jones (2019a, b), Vaswani et al. [2017]
  for (const m of text.matchAll(NARRATIVE)) {
    if ((m[2] === "(" && m[4] !== ")") || (m[2] === "[" && m[4] !== "]")) continue;
    const targets = ay(m[1]!, m[3]!);
    if (targets.length) found.push({ start: m.index!, end: m.index! + m[0].length, text: m[0], targets });
  }

  // [12], [3-5], [1, 4, 7–9], [ADG16], [BMR+20, KMH+20]
  for (const m of text.matchAll(BRACKET)) {
    const inner = m[1]!;
    const start = m.index!;
    const before = text.slice(Math.max(0, start - 24), start);
    if (start > 0 && /[\p{L}\p{N}_)\]]/u.test(text[start - 1]!)) continue; // a[1], x2[3], f(x)[2]
    if (MATH_BEFORE.test(before) || WORD_BEFORE.test(before)) continue;
    const tokens: { from: number; to: number; targets: CiteTarget[] }[] = [];
    if (style.maxNumber > 0 && NUMS.test(inner)) {
      let bad = false;
      for (const t of inner.matchAll(NUM_TOKEN)) {
        const a = Number(t[1]);
        const b = t[2] !== undefined ? Number(t[2]) : a;
        if (a < 1 || b < a || b > style.maxNumber || b - a > 30) {
          bad = true;
          break;
        }
        tokens.push({ from: t.index!, to: t.index! + t[0].length, targets: Array.from({ length: b - a + 1 }, (_, i) => ({ kind: "num" as const, n: a + i })) });
      }
      if (bad) continue;
    } else if (style.keyed && KEYS.test(inner)) {
      for (const t of inner.matchAll(KEY_TOKEN)) tokens.push({ from: t.index!, to: t.index! + t[0].length, targets: [{ kind: "key", key: t[0].replace(/\s/g, "") }] });
    } else continue;
    const end = start + m[0].length;
    if (tokens.length === 1) found.push({ start, end, text: m[0], targets: tokens[0]!.targets });
    else for (const t of tokens) found.push({ start: start + 1 + t.from, end: start + 1 + t.to, text: inner.slice(t.from, t.to), targets: t.targets });
  }

  // longer first, then drop what overlaps something already kept
  found.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const kept: InTextCite[] = [];
  for (const f of found) if (!kept.some((k) => f.start < k.end && k.start < f.end)) kept.push(f);
  return kept.sort((a, b) => a.start - b.start);
}

/**
 * One piece of a page's text with its box: a pdf.js text item, or a span of the text layer (the reader measures the span). x grows to the right; y is any
 * vertical position that is the same for pieces of one line.
 */
export type TextPiece = { str: string; x: number; y: number; w: number; h: number; eol?: boolean };

/**
 * A page's pieces as one string, and where each piece starts in it. Pieces of one line that touch are joined as they are ("Vas" + "wani"); a gap, a new line or a
 * line end gives one space. The reader finds citations in this string and maps a find back to its pieces by `starts`.
 */
export function joinPieces(pieces: readonly TextPiece[]): { text: string; starts: number[] } {
  let text = "";
  const starts: number[] = [];
  let prev: TextPiece | null = null;
  for (const p of pieces) {
    if (prev) {
      const h = Math.max(prev.h, p.h, 1);
      const sameLine = Math.abs(p.y - prev.y) < h * 0.5;
      const gap = p.x - (prev.x + prev.w);
      const touches = sameLine && !prev.eol && gap < h * 0.12 && gap > -h;
      if (!sameLine || prev.eol) {
        // a word broken at the end of a line ("Ham-" then "bardzumyan"): joined without its hyphen. A capital after it ("Rodríguez-" "García") keeps the hyphen.
        if (/\p{L}-$/u.test(text) && /^\p{Ll}/u.test(p.str)) text = text.slice(0, -1);
        else if (!/\s$/.test(text) && !/^\s/.test(p.str)) text += " ";
      } else if (!touches && !/\s$/.test(text) && !/^\s/.test(p.str)) text += " ";
    }
    starts.push(text.length);
    text += p.str;
    prev = p;
  }
  return { text, starts };
}

/**
 * True when a find is the label at the start of its own entry in the reference list ("[12] A. Vaswani, ..."): the words after it are the entry's first words.
 * Such a find is a list marker, not a citation.
 */
export function isListMarker(text: string, c: InTextCite, entry: string): boolean {
  const after = words(text.slice(c.end, c.end + 120)).slice(0, 6);
  const head = words(entry).slice(0, 6);
  if (after.length < 3 || head.length < 3) return false;
  let same = 0;
  for (let i = 0; i < Math.min(5, after.length, head.length); i++) if (after[i] === head[i]) same++;
  return same >= 3;
}

/* ---------------------------------------------------------------- linking */

type EntryKey = {
  /** the entry's words, lower case, diacritics folded */
  words: string[];
  /** years it carries, with a letter when it has one: "2017", "2019a" */
  years: Set<string>;
  /** how many words come before its first year: the author part, in every common style */
  authorWords: number;
  /** how many words the first author takes: up to the first comma, semicolon or "and" ("Vaswani" of "Vaswani, A.", "Ashish Vaswani" of "Ashish Vaswani, Noam ...") */
  firstWords: number;
  /** a guess at how many authors it names (for "et al." against two names, as a last tie-break only) */
  authorCount: number;
};

export type CiteIndex = {
  size: number;
  /** label ("12", "ADG16") -> index in the list; empty when the list's labels are not known */
  byLabel: Map<string, number>;
  entries: EntryKey[];
  style: CiteStyle;
};

/** Words for comparing names: accents written as characters of their own ("R¨uckl´e") are dropped first, so they compare equal to "Rücklé" and "Ruckle". */
const nameWords = (s: string): string[] => words(s.replace(/\p{Sk}/gu, ""));

const YEAR_IN_ENTRY = /(?<!\d)(1[6-9]\d\d|20\d\d)([a-z])?(?![\d])/g;

function keyOf(entry: string): EntryKey {
  const w = nameWords(entry);
  const years = new Set<string>();
  let first = -1;
  for (const m of entry.matchAll(YEAR_IN_ENTRY)) {
    years.add(m[1]!);
    if (m[2]) years.add(m[1]! + m[2]);
    if (first < 0) first = m.index!;
  }
  const head = first >= 0 ? entry.slice(0, first) : entry.slice(0, 160);
  const authorWords = nameWords(head).length;
  // the authors end at the first full stop that does not close an initial ("Polosukhin. Attention is ...", not "Graves, A. (2013)"); each name is a piece between
  // commas or "and" with two letters or more in a row ("A." alone is an initial, not a name)
  const names = head.split(/(?<![\s.\-]\p{Lu}|^\p{Lu})\.\s/u)[0]!;
  const authorCount = /\bet\.?\s*al\b/i.test(names) ? 3 : Math.max(1, names.split(/,|;|\s(?:and|&|और)\s/u).filter((p) => /[\p{L}\p{M}]{2}/u.test(p.replace(/\bet\.?\s*al\b.*/i, ""))).length);
  const firstWords = nameWords(entry.split(/[,;]|\s(?:and|&|और)\s/u)[0] ?? "").length;
  return { words: w, years, authorWords, authorCount, firstWords };
}

/** A key as compared: "VSP+17", "VSP 17" and "VSP17" are one key (a PDF often loses the "+" of the list's label, or the space). */
const keyNorm = (k: string) => k.replace(/[\s+]/g, "");

/** The first word of a surname without its particles: "van der Berg" -> "berg", "Rodríguez-García" -> "rodriguez". */
const coreOf = (surname: string): string | null => {
  const ws = nameWords(surname.replace(new RegExp("^" + PARTICLE, "u"), ""));
  return ws[0] ?? null;
};

/**
 * The index over a paper's stored reference list. `labels` (from labelledReferenceEntries, lined up with alignLabels) makes numbers and keys linkable; without them
 * only author-year citations are.
 */
export function buildCiteIndex(references: readonly string[], labels: readonly (string | null)[] | null): CiteIndex {
  const byLabel = new Map<string, number>();
  const twice = new Set<string>();
  let maxNumber = 0;
  let keyed = 0;
  labels?.forEach((l, i) => {
    if (!l) return;
    const k = /^\d+$/.test(l) ? l : keyNorm(l);
    if (byLabel.has(k)) return void twice.add(k);
    byLabel.set(k, i);
    if (/^\d+$/.test(l)) maxNumber = Math.max(maxNumber, Number(l));
    else keyed++;
  });
  // a label printed twice (or two keys that differ only by a lost "+") cannot be told apart: neither is linked
  for (const k of twice) byLabel.delete(k);
  return { size: references.length, byLabel, entries: references.map(keyOf), style: { maxNumber, keyed: keyed >= 3 } };
}

/** The entries a target points at: one index, or none when it cannot be told (no entry, or more than one that fits equally). */
export function resolveTarget(t: CiteTarget, idx: CiteIndex): number | null {
  if (t.kind === "num") return idx.byLabel.get(String(t.n)) ?? null;
  if (t.kind === "key") return idx.byLabel.get(keyNorm(t.key)) ?? null;
  const found = resolveAuthorYear(t, idx);
  // "(BiRNN, Schuster and Paliwal, 1997)": a word in front that was read as a first name; tried once more without it, still needing first author, second author and year
  if (found === null && t.surnames.length >= 3 && !t.etAl) return resolveAuthorYear({ ...t, surnames: t.surnames.slice(1) }, idx);
  return found;
}

function resolveAuthorYear(t: Extract<CiteTarget, { kind: "ay" }>, idx: CiteIndex): number | null {
  const first = coreOf(t.surnames[0] ?? "");
  if (!first) return null;
  const y = String(t.year);
  const second = t.surnames.length >= 2 ? coreOf(t.surnames[1]!) : null;
  let cands: number[] = [];
  idx.entries.forEach((e, i) => {
    if (t.suffix ? !e.years.has(y + t.suffix) : !e.years.has(y)) return;
    // the first author: the surname is in the entry's first author ("Vaswani, A.", "A. Vaswani", "Ashish Vaswani", "van der Berg, A."), never a later one
    const at = e.words.indexOf(first);
    if (at < 0 || at > 4 || at >= Math.max(1, e.firstWords)) return;
    // a second named author must be in the author part
    if (second) {
      const at2 = e.words.indexOf(second, at + 1);
      if (at2 < 0 || at2 > Math.max(e.authorWords, at + 8)) return;
    }
    cands.push(i);
  });
  if (cands.length > 1 && !t.suffix) {
    // "Smith 2019" when the list has "2019a" and "2019b": cannot be told
    const plain = cands.filter((i) => [...idx.entries[i]!.years].every((v) => v === y || !v.startsWith(y)));
    if (plain.length >= 1) cands = plain;
  }
  if (cands.length > 1) {
    const fits = cands.filter((i) => (t.etAl ? idx.entries[i]!.authorCount >= 3 : t.surnames.length === 2 ? idx.entries[i]!.authorCount === 2 : t.surnames.length === 1 ? idx.entries[i]!.authorCount === 1 : true));
    if (fits.length >= 1) cands = fits;
  }
  return cands.length === 1 ? cands[0]! : null;
}

/** A citation linked to its entries (in the order it names them, without repeats). Null when any of its targets cannot be linked. */
export function linkCitation(c: InTextCite, idx: CiteIndex): number[] | null {
  const out: number[] = [];
  for (const t of c.targets) {
    const i = resolveTarget(t, idx);
    if (i === null) return null;
    if (!out.includes(i)) out.push(i);
  }
  return out.length ? out : null;
}

/**
 * The labels and first pages of the stored list (PaperInfo.references), taken from the list as it is read from the open PDF now (labelledReferenceEntries). An entry is
 * matched by its text (the same code made both), else by its first twelve words. `aligned` says how many were matched: when a list was corrected by hand or came from
 * Crossref, few are, and numbers must then not be linked (see `labelsUsable`).
 */
export function alignLabels(stored: readonly string[], read: readonly LabelledEntry[]): { labels: (string | null)[]; pages: (number | null)[]; aligned: number } {
  const exact = new Map<string, LabelledEntry[]>();
  const loose = new Map<string, LabelledEntry[]>();
  const looseKey = (s: string) => words(s).slice(0, 12).join(" ");
  for (const r of read) {
    (exact.get(r.text) ?? exact.set(r.text, []).get(r.text)!).push(r);
    const k = looseKey(r.text);
    (loose.get(k) ?? loose.set(k, []).get(k)!).push(r);
  }
  const used = new Set<LabelledEntry>();
  const take = (list: LabelledEntry[] | undefined) => {
    const r = list?.find((x) => !used.has(x));
    if (r) used.add(r);
    return r ?? null;
  };
  const labels: (string | null)[] = [];
  const pages: (number | null)[] = [];
  let aligned = 0;
  for (const s of stored) {
    const r = take(exact.get(s)) ?? take(loose.get(looseKey(s)));
    labels.push(r?.label ?? null);
    pages.push(r?.page ?? null);
    if (r) aligned++;
  }
  return { labels, pages, aligned };
}

/** Labels are trusted for numbers and keys only when nearly the whole stored list was found again with its label. */
export const labelsUsable = (stored: readonly string[], a: { labels: readonly (string | null)[]; aligned: number }): boolean =>
  stored.length > 0 && a.aligned >= stored.length * 0.8 && a.labels.filter(Boolean).length >= stored.length * 0.8;

/** A short way to name a target in words, for the citation's accessible name: "Vaswani et al., 2017", "reference 12", "ADG16". */
export function describeTarget(t: CiteTarget): string {
  if (t.kind === "num") return `reference ${t.n}`;
  if (t.kind === "key") return t.key;
  const who = t.etAl ? `${t.surnames[0]} et al.` : t.surnames.length === 2 ? `${t.surnames[0]} and ${t.surnames[1]}` : t.surnames.length > 2 ? `${t.surnames[0]} et al.` : t.surnames[0];
  return `${who}, ${t.year}${t.suffix ?? ""}`;
}
