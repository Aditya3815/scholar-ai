/**
 * "Paper intelligence" without GROBID: from the text lines of a PDF (with their font sizes and positions, as pdf.js gives them),
 * find the title, the paper's own DOI or arXiv id, a table of contents and the reference list split into entries.
 * Pure functions on plain data, so the browser, the tests and any future server-side step all run the same code.
 * Measured against GROBID on five papers in docs/spikes/R1b-grobid-alternatives.md.
 */
import { MAX_PAPER_REFERENCES, splitReferences } from "./references";

/** One piece of text from pdf.js (a TextItem), reduced to what we use. */
export type RawItem = { str: string; x: number; y: number; w: number; size: number };
/** A line of text on a page. y grows upwards (PDF coordinates). */
export type Line = { text: string; x: number; y: number; size: number; page: number };
export type OutlineItem = { title: string; page: number; level: number };

export type PaperMetadata = { title: string; authors: string[]; year: number | null; venue: string | null; doi: string | null; source: "crossref" | "openalex" };

export type PaperInfo = {
  pages: number;
  /** Largest text on the first page; null when nothing stands out. */
  title: string | null;
  /** The paper's own DOI as printed on its first pages. */
  doi: string | null;
  arxiv: string | null;
  /** The PDF's own bookmarks, when it has any. */
  outline: OutlineItem[];
  /** Headings found by looking at font size and numbering. Incomplete by nature: a hint. */
  headings: OutlineItem[];
  /** The reference list, one string per entry. */
  references: string[];
  /** Where `references` came from: read from the PDF, or the list the publisher deposited with Crossref (when the PDF's could not be read). */
  referencesSource: "pdf" | "crossref" | "none";
  /** Filled in by the server from OpenAlex or Crossref when a DOI is known. */
  metadata: PaperMetadata | null;
};

/* ---------------------------------------------------------------- items -> lines */

/** Convert pdf.js text-content items (structurally typed, so this file needs no pdf.js import). */
export function rawItems(items: readonly { str?: string; transform?: number[]; width?: number; height?: number }[]): RawItem[] {
  const out: RawItem[] = [];
  for (const it of items) {
    if (typeof it.str !== "string" || !it.transform) continue;
    const size = Math.abs(it.transform[3] ?? 0) || Math.abs(it.height ?? 0);
    out.push({ str: it.str, x: it.transform[4] ?? 0, y: it.transform[5] ?? 0, w: it.width ?? 0, size: Math.round(size * 10) / 10 });
  }
  return out;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** Items of one page -> lines. Items on (nearly) the same baseline are one line; a gap wider than a space gets a space. */
export function groupLines(items: readonly RawItem[], page: number): Line[] {
  const lines: Line[] = [];
  let cur: { text: string; x: number; y: number; size: number; end: number; last: string } | null = null;
  const flush = () => {
    if (cur && squash(cur.text)) lines.push({ text: squash(cur.text), x: Math.round(cur.x * 10) / 10, y: cur.y, size: cur.size, page });
    cur = null;
  };
  for (const it of items) {
    const blank = it.str.trim() === "";
    if (cur && Math.abs(cur.y - it.y) <= Math.max(1.5, cur.size * 0.3)) {
      const gap = it.x - cur.end;
      if (gap > Math.max(cur.size, it.size, 4) * 0.22 && !cur.last.endsWith(" ") && !it.str.startsWith(" ")) cur.text += " ";
      cur.text += it.str;
      cur.end = Math.max(cur.end, it.x + it.w);
      cur.last = it.str || cur.last;
      if (!blank) cur.size = Math.max(cur.size, it.size);
    } else {
      flush();
      cur = { text: it.str, x: it.x, y: it.y, size: blank ? 0 : it.size, end: it.x + it.w, last: it.str };
    }
  }
  flush();
  return lines.filter((l) => l.size > 0);
}

/** Page numbers and headers or footers that repeat on many pages are not content. */
export function stripRunningHeads(lines: Line[], pageCount: number): Line[] {
  const key = (t: string) => t.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  const pagesBy = new Map<string, Set<number>>();
  for (const l of lines) {
    if (l.text.length > 140) continue;
    const k = key(l.text);
    (pagesBy.get(k) ?? pagesBy.set(k, new Set()).get(k)!).add(l.page);
  }
  const minPages = Math.max(3, Math.ceil(pageCount * 0.3));
  return lines.filter((l) => {
    if (/^(page\s+)?\d{1,4}(\s+of\s+\d{1,4})?$/i.test(l.text)) return false;
    return !((pagesBy.get(key(l.text))?.size ?? 0) >= minPages && l.text.length <= 140);
  });
}

/** The size most of the text is set in. */
export function bodySize(lines: Line[]): number {
  const w = new Map<number, number>();
  for (const l of lines) w.set(l.size, (w.get(l.size) ?? 0) + l.text.length);
  return [...w.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10;
}

/* ---------------------------------------------------------------- title and identifiers */

const NOT_A_TITLE = /^(abstract|introduction|contents|research article|original article|review( article)?|short communication|preprint|article|letter|report|keywords?|arxiv:|doi:|https?:|www\.|journal\b|vol(ume)?\b|provided proper attribution)|@/i;

/** Working papers often set the title in capitals at the body size: take the first run of capital-letter lines on the page. */
function capsTitle(first: Line[]): string | null {
  const isCaps = (t: string) => /^[\p{Lu}\p{N}\s\-&:,'’()]{6,120}$/u.test(t) && /\p{Lu}{3}/u.test(t) && !NOT_A_TITLE.test(t);
  const start = first.findIndex((l) => isCaps(l.text));
  if (start < 0) return null;
  const parts: string[] = [];
  for (let i = start; i < first.length && isCaps(first[i]!.text) && parts.length < 4; i++) parts.push(first[i]!.text);
  const title = squash(parts.join(" ")).replace(/[,;:\s]+$/, "");
  return title.length >= 20 ? title : null;
}

export function detectTitle(lines: Line[], body: number): string | null {
  const first = lines.filter((l) => l.page === 1).slice(0, 45);
  // Prefer text clearly larger than the body; when nothing is (some journals set the title only a little larger), accept a little larger.
  const pick = (factor: number) => first.filter((l) => l.size >= body * factor && l.text.length >= 3 && !NOT_A_TITLE.test(l.text));
  const big = pick(1.25).length > 0 ? pick(1.25) : pick(1.08);
  if (big.length === 0) return capsTitle(first);
  const top = Math.max(...big.map((l) => l.size));
  // the title is the largest run of consecutive lines in that size (it may wrap over two or three lines)
  const idx = first.findIndex((l) => l.size >= top - 0.6 && big.includes(l));
  const parts: string[] = [];
  for (let i = idx; i < first.length; i++) {
    const l = first[i]!;
    if (l.size < top - 0.6 || l.size > top + 0.6) break;
    parts.push(l.text);
    if (parts.length >= 4) break;
  }
  const title = squash(parts.join(" ")).replace(/[,;:\s]+$/, "");
  return title.length >= 6 && title.length <= 300 ? title : null;
}

/** "10.1000/abc.def)." -> "10.1000/abc.def" */
export function findDoi(text: string): string | null {
  const m = text.match(/10\.\d{4,9}\/[^\s"<>]+/i);
  if (!m) return null;
  return m[0].replace(/[.,;:)\]}>'"]+$/, "").toLowerCase();
}

export function findArxiv(text: string): string | null {
  const m = text.match(/arXiv:\s*((?:\d{4}\.\d{4,5})|(?:[a-z\-]+(?:\.[A-Z]{2})?\/\d{7}))(?:v\d+)?/i);
  return m ? m[1]! : null;
}

/** The paper's own identifiers are printed on its first page (the second is checked when the first has none). */
export function detectIdentifiers(lines: Line[]): { doi: string | null; arxiv: string | null } {
  for (const pages of [[1], [2]]) {
    const text = lines.filter((l) => pages.includes(l.page)).map((l) => l.text).join(" ");
    const doi = findDoi(text);
    const arxiv = findArxiv(text);
    if (doi || arxiv) return { doi, arxiv };
  }
  return { doi: null, arxiv: null };
}

/** The DOI to look a paper up by: its own, or the DataCite DOI that arXiv gives every preprint. */
export const lookupDoi = (info: Pick<PaperInfo, "doi" | "arxiv">): string | null => info.doi ?? (info.arxiv ? `10.48550/arxiv.${info.arxiv.toLowerCase()}` : null);

/* ---------------------------------------------------------------- headings */

const KNOWN = /^(abstract|introduction|background|related work|literature review|methods?|materials and methods|methodology|results?|results and discussion|discussion|conclusions?|conclusion and future work|future work|acknowledge?ments?|references|bibliography|appendix|limitations|data|experiments?|evaluation|preliminaries)\s*$/i;
const NUMBERED = /^((\d+(\.\d+){0,3})|([IVX]+)|([A-Z]))[.)]?\s+\p{Lu}/u;

const levelOf = (text: string): number => {
  const m = /^(\d+(?:\.\d+){0,3})[.)]?\s/.exec(text);
  return m ? m[1]!.split(".").length : 1;
};

export function detectHeadings(lines: Line[], body: number, title: string | null, stopAt?: number): OutlineItem[] {
  const out: OutlineItem[] = [];
  const upto = stopAt ?? lines.length;
  let prev: { item: OutlineItem; line: Line } | null = null;
  // Everything on page 1 above the abstract or the first section is the title block (authors, affiliations, stamps), not headings.
  const firstReal = lines.findIndex((l, i) => i < 80 && l.page === 1 && /^(abstract|summary|(1\.?|i\.?)\s+introduction|introduction)\b/i.test(l.text));
  for (let i = firstReal >= 0 ? firstReal : 0; i < upto; i++) {
    const l = lines[i]!;
    const t = l.text;
    if (/^arxiv:/i.test(t) || /@/.test(t)) continue;
    const caps = /^[\p{Lu}\s\-&:,]{5,70}$/u.test(t) && /\p{Lu}{3}/u.test(t);
    const looks =
      t.length >= 3 && t.length <= 100 && !/[.,;]$/.test(t) && !/^\d+$/.test(t) && !/^(figure|fig\.|table|algorithm|equation)\s*\d/i.test(t) && (title ? !title.includes(t) : true);
    const heading = looks && (l.size >= body * 1.12 || (NUMBERED.test(t) && t.length <= 80 && l.size >= body * 0.97) || KNOWN.test(t) || caps);
    if (!heading) {
      prev = null;
      continue;
    }
    // a heading that wraps onto a second line of the same size or in capitals is one heading
    if (prev && prev.line.page === l.page && Math.abs(prev.line.size - l.size) < 0.6 && prev.line.y - l.y < l.size * 1.8 && prev.line.y > l.y && !NUMBERED.test(t) && !KNOWN.test(t)) {
      prev.item.title = squash(`${prev.item.title} ${t}`);
      prev.line = l;
      continue;
    }
    const item: OutlineItem = { title: t, page: l.page, level: levelOf(t) };
    out.push(item);
    prev = { item, line: l };
  }
  return out.slice(0, 150);
}

/* ---------------------------------------------------------------- references */

/** "References", "7 REFERENCES", "R EFERENCES" (small capitals come out of a PDF with a gap after the first letter), "Notes and references" ... compared with the spaces taken out. */
const REF_HEADING = /^((\d+|[ivx]+)[.)]?)?(references?|bibliography|literaturecited|workscited|referencelist|citedliterature|referencescited|citedreferences|listofreferences|referencesandnotes|notesandreferences):?$/i;
export const isReferenceHeading = (text: string): boolean => text.length <= 40 && REF_HEADING.test(text.replace(/\s+/g, ""));

const AFTER_REFS = /^(appendix|appendices|supplement(ary)?\b|supporting information|author contributions?|competing interests?|conflicts? of interest|data availability|about the authors?|(neurips |icml |iclr )?paper checklist|checklist\b)/i;

/**
 * The number a list marker carries: "[12]", "(12)", "12." or "12)". "12" followed by anything else ("2024 IEEE", "1.5 times", a bare page number) is not a marker.
 * Returns null when the line does not start with one.
 */
export function markerNumber(text: string): number | null {
  const m = /^\s*(?:\[\s*(\d{1,3})\s*\]\s*|\(\s*(\d{1,3})\s*\)\s+|(\d{1,3})[.)]\s+)\S/.exec(text);
  const n = Number(m?.[1] ?? m?.[2] ?? m?.[3]);
  return m && Number.isFinite(n) ? n : null;
}

/**
 * Index of the line where the bibliography starts. Normally the last "References" heading (a bibliography is at the end; an earlier mention is a
 * table of contents). Without any heading, the last "[1]" (or "1.") that is followed by "[2]", "[3]" ... in order is where a numbered list begins.
 */
export function findReferenceStart(lines: Line[]): number {
  for (let i = lines.length - 1; i >= 0; i--) if (isReferenceHeading(lines[i]!.text)) return i;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (markerNumber(lines[i]!.text) !== 1) continue;
    let want = 2;
    for (let j = i + 1; j < lines.length && want <= 5; j++) if (markerNumber(lines[j]!.text) === want) want++;
    if (want > 5) return i - 1;
  }
  return -1;
}

/**
 * The lines of the reference list. It ends at a line that names what follows (an appendix, a checklist ...) or, when `body` (the size of the main text) is
 * given, at a heading set larger than the text: papers often put an appendix straight after the last reference with no word to say so.
 */
export function referenceLines(lines: Line[], body?: number): Line[] {
  const start = findReferenceStart(lines);
  if (start < 0) return [];
  const tail = lines.slice(start + 1);
  const isHeading = (l: Line) => body !== undefined && l.size >= body * 1.15 && l.text.length <= 90 && markerNumber(l.text) === null && /\p{L}{3}/u.test(l.text);
  const end = tail.findIndex((l, i) => i > 2 && ((AFTER_REFS.test(l.text) && l.text.length < 60) || isHeading(l)));
  return end >= 0 ? tail.slice(0, end) : tail;
}

const MARKER = /^\s*(\[\s*\d{1,3}\s*\]|\(\s*\d{1,3}\s*\)|\d{1,3}\s*[.)])\s+/;

/**
 * Hanging-indent bibliographies (APA and most journal styles): every entry starts at the left edge of its column and its
 * continuation lines are indented. Works for two columns too: a "left edge" is a position with no other position within 40 units to
 * its left; an indent sits a few units right of one.
 */
function splitByIndent(block: Line[]): string[] | null {
  const byPage = new Map<number, Line[]>();
  for (const l of block) (byPage.get(l.page) ?? byPage.set(l.page, []).get(l.page)!).push(l);
  const flush = new Set<Line>();
  let indented = 0;
  for (const ls of byPage.values()) {
    const xs = [...new Set(ls.map((l) => Math.round(l.x)))].sort((a, b) => a - b);
    const edges: number[] = [];
    for (const x of xs) if (!xs.some((o) => o < x - 2 && o >= x - 40)) edges.push(x);
    for (const l of ls) {
      if (edges.some((e) => Math.abs(l.x - e) <= 2.5)) flush.add(l);
      else indented++;
    }
  }
  if (flush.size < 3 || indented < block.length / 3) return null;
  const entries: string[] = [];
  for (const l of block) {
    if (flush.has(l) || entries.length === 0) entries.push(l.text);
    else entries[entries.length - 1] += ` ${l.text}`;
  }
  return entries;
}

/**
 * A numbered list ([1] ... [n], or 1. ... n.): a line starts a new entry only when its number is the NEXT one (or one or two ahead, when a marker was lost).
 * A line that merely begins with a number or a dash ("2024 IEEE International ...", "- 2024 IEEE ...", "19 pages.") continues the entry before it.
 */
function splitNumbered(block: Line[]): string[] {
  const entries: string[] = [];
  let last = 0;
  for (const l of block) {
    const n = markerNumber(l.text);
    // a "1." after a long list is the start of something else (a numbered list in an appendix), not a continuation of the last entry
    if (n === 1 && last >= 5) break;
    const starts = n !== null && (entries.length === 0 ? n <= 2 : n > last && n <= last + 3);
    if (starts) {
      entries.push(l.text);
      last = n!;
    } else if (entries.length > 0) entries[entries.length - 1] += ` ${l.text}`;
  }
  return entries;
}

/** Something that cites a work: a year, a DOI, an arXiv id or an address. What does not is not a reference (an appendix paragraph that followed the list). */
const CITES = /\b(1[5-9]\d{2}|20\d{2})[a-z]?\b|doi\.org|\b10\.\d{4,9}\/|arxiv|https?:\/\/|www\.|in press|forthcoming|to appear/i;

const clean = (s: string) => squash(s.replace(MARKER, ""));

/**
 * An entry with a very long author list (hundreds of names) would be cut inside the author list when it is checked, and the title, which comes after
 * the authors, would be lost. Keep the first authors and the end (title, venue, year) instead.
 */
export function compactLong(e: string, max = 900): string {
  if (e.length <= max) return e;
  const head = e.slice(0, 280).replace(/\s+\S*$/, "");
  const tail = e.slice(-(max - 300)).replace(/^\S*\s+/, "");
  return `${head} … ${tail}`;
}

export function referenceEntries(block: Line[]): string[] {
  if (block.length === 0) return [];
  const numbered = block.filter((l) => markerNumber(l.text) !== null).length >= Math.min(3, Math.ceil(block.length / 12));
  const byNumber = numbered ? splitNumbered(block) : [];
  const entries = (byNumber.length >= 2 && byNumber) || (!numbered && splitByIndent(block)) || splitReferences(block.map((l) => l.text).join("\n"));
  const kept = entries
    .map((e) => compactLong(clean(e)))
    .filter((e) => e.length >= 20 && /\p{L}{3}/u.test(e));
  // Text after the last reference (a paragraph of an appendix that nothing separated from the list) is not a reference.
  while (kept.length > 3 && !CITES.test(kept[kept.length - 1]!)) kept.pop();
  return kept.slice(0, MAX_PAPER_REFERENCES);
}

/* ---------------------------------------------------------------- everything together */

export function analyzePaper(args: { lines: Line[]; outline?: OutlineItem[]; pages: number }): PaperInfo {
  const lines = stripRunningHeads(args.lines, args.pages);
  const body = bodySize(lines);
  const title = detectTitle(lines, body);
  const ids = detectIdentifiers(args.lines);
  const refStart = findReferenceStart(lines);
  const block = referenceLines(lines, body);
  const references = referenceEntries(block);
  return {
    pages: args.pages,
    title,
    doi: ids.doi,
    arxiv: ids.arxiv,
    outline: (args.outline ?? []).slice(0, 150),
    headings: detectHeadings(lines, body, title, refStart >= 0 ? refStart + 1 : undefined),
    references,
    referencesSource: references.length > 0 ? "pdf" : "none",
    metadata: null,
  };
}
