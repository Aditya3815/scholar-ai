/**
 * Reading scanned pages (OCR): the limits, the instruction given to the models, and the rule that decides whether a page was read well enough to be used.
 *
 * A vision model that cannot read a page does not say so: it writes something that looks right (on a real test scan, one invented a whole different
 * document; another repeated one sentence until it ran out of room). So every page is read by TWO different models and compared. Where they agree, the
 * page is used; where they do not, the page is marked "not read reliably" and is kept out of questions and the reference check. This catches a page
 * that is hard to read; it cannot catch a mistake both models make the same way, which is why the reader is always told the text came from a scan.
 *
 * Pure functions only (no network), so the API and the tests use exactly the same rule. Background and the measurements behind the numbers:
 * docs/spikes/R4-ocr.md and docs/ocr.md.
 */

/** The two readings. The first one's text is the one kept; the second is only there to check it. */
export const OCR_MODEL_PRIMARY = "@cf/meta/llama-4-scout-17b-16e-instruct";
export const OCR_MODEL_CHECK = "@cf/mistralai/mistral-small-3.1-24b-instruct";

export const OCR_PROMPT =
  "Transcribe all the text in this scanned page exactly as written, in reading order. Keep Hindi (Devanagari) in Devanagari and English in English. " +
  "Do not translate, summarise, correct or add anything. Output only the transcribed text.";

/** Most that one model may write for one page. A page of dense text is about 1,900 tokens; a model that loops stops here instead of running on. */
export const OCR_MAX_TOKENS = 2500;
/** Pages one person may have read per day (both models count as one page). The API reads OCR_PAGES_PER_DAY from the environment when it is set. */
export const OCR_PAGES_PER_DAY = 60;
/** The page image the browser sends: a JPEG, at most this many pixels on the long side (150 dpi A4 is 1,754) and bytes. */
export const OCR_MAX_SIDE_PX = 1754;
export const OCR_MIN_SIDE_PX = 200;
export const OCR_MAX_IMAGE_BYTES = 1_500_000;
export const OCR_JPEG_QUALITY = 0.8;
/** A page with fewer characters than this has no text layer worth keeping. */
export const OCR_MIN_TEXT_CHARS = 25;
/** A document is "a scan" when at least this share of its pages has no text layer (a few image-only pages in a text paper are left alone). */
export const OCR_SCAN_SHARE = 0.5;
/** Pages read at the same time by the browser. */
export const OCR_PARALLEL_PAGES = 3;

/**
 * Models disagree by less than OCR_ACCEPT_BELOW (share of characters): the page is used. Up to OCR_WARN_BELOW: used, but marked "read with doubt".
 * Above: not read reliably. Measured: clean English scans 0.3% to 2%; real Hindi, and Sanskrit mixed with English, 9% to 11% (the first model's text is
 * mostly right, the checking model is the weaker one in Devanagari); a page neither model could read 95% (and 34% or more in the spike's poor scans).
 * These come from 8 real pages and 10 test pages: provisional, to be reset on pilot scans (docs/ocr.md).
 */
export const OCR_ACCEPT_BELOW = 0.02;
export const OCR_WARN_BELOW = 0.15;
/** One reading more than this many times longer than the other: they did not read the same thing. */
export const OCR_MAX_LENGTH_RATIO = 2;

export type OcrStatus = "ok" | "warn" | "unreliable" | "empty";
export type OcrWhy = "second_reading_failed" | "cut_off" | "repeating" | "lengths_differ" | "models_disagree";

/** What one model returned for one page. `cutOff` = it hit the limit on what it may write. */
export type Reading = { text: string; cutOff: boolean };

export type PageVerdict = {
  status: OcrStatus;
  /** Share of characters on which the two readings differ (0 = identical). null when they could not be compared. */
  disagreement: number | null;
  /** Numbers that one reading has and the other does not (for example "2005" and "2003"): shown to the reader as "check this on the page". */
  disputed: string[];
  why?: OcrWhy;
  /** The text to keep (the first reading, cleaned). Empty unless status is "ok" or "warn". */
  text: string;
};

/** What the paper's page list shows about a scanned paper. */
export type ScanPage = { page: number; status: OcrStatus; disagreement: number | null; disputed: string[]; why?: OcrWhy };
export type ScanInfo = {
  /** Pages of the PDF that are page images (the ones that need reading). */
  pages: number;
  read: number;
  warned: number;
  unreliable: number;
  /** Blank pages, or pages with no text on them. */
  empty: number;
  /** Pages not read yet, in page order (reading continues with these). */
  pending: number[];
  /** Pages read today and the most that may be read per day, so the screen can say what is left. */
  usedToday: number;
  perDay: number;
  /** Per page, in page order, only the pages that have been tried. */
  items: ScanPage[];
};

/** The size to draw a page of `widthPt` x `heightPt` points at: 150 dpi, but never more than the server accepts (1,240 x 1,754 for an A4 page). */
export function pictureSize(widthPt: number, heightPt: number): { width: number; height: number } {
  const w = Number.isFinite(widthPt) && widthPt > 0 ? widthPt : 595;
  const h = Number.isFinite(heightPt) && heightPt > 0 ? heightPt : 842;
  const scale = Math.min(150 / 72, 1240 / w, OCR_MAX_SIDE_PX / h, OCR_MAX_SIDE_PX / w);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** What the server answers for one page that was sent to be read. "retry" = a model could not be reached: the page is still to be read and no allowance was used. */
export type ScanPageResult = {
  page: number;
  status: OcrStatus | "retry";
  disagreement: number | null;
  disputed: string[];
  why?: OcrWhy;
  /** What was read (only for pages that were used). */
  text: string;
  /** Passages stored for questions. */
  chunks: number;
  /** Nothing left to read: the paper has been marked ready or failed. */
  done: boolean;
  usedToday: number;
  perDay: number;
};

/**
 * True when a page picture has nothing on it. `luma` is the brightness (0 to 255) of every pixel of a small copy of the page. A blank sheet, or a scanner lid
 * with nothing on it, is one even tone with noise; a page with a few lines of text has pixels well away from that tone. Leaning towards "not blank": a page
 * that is sent and found empty costs a little, a page with text that is skipped is lost.
 */
export function looksBlank(luma: ArrayLike<number>): boolean {
  const n = luma.length;
  if (n === 0) return true;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[Math.max(0, Math.min(255, Math.round(luma[i]!)))]!++;
  let seen = 0;
  let median = 0;
  for (; median < 256; median++) {
    seen += hist[median]!;
    if (seen >= n / 2) break;
  }
  let away = 0;
  for (let v = 0; v < 256; v++) if (Math.abs(v - median) > 60) away += hist[v]!;
  return away < Math.max(12, n * 0.00015);
}

/* ---------------------------------------------------------------- cleaning and comparing */

const FENCE = /^\s*```[a-z]*\s*$/i;
const LEAD_IN = /^\s*[*_#>\s]*(here is|here's|here are|below is|the following|transcri(bed|ption)|sure)[^\n]{0,80}:[*_\s]*$/i;

/** Takes the chatter off a model's answer (a heading line, code fences, **bold**, # headings, trailing spaces) without touching the page's own words. */
export function cleanReading(raw: string): string {
  let lines = String(raw ?? "").replace(/\r\n?/g, "\n").replace(/﻿/g, "").normalize("NFC").split("\n");
  lines = lines.filter((l) => !FENCE.test(l));
  while (lines.length > 0 && (lines[0]!.trim() === "" || LEAD_IN.test(lines[0]!))) lines.shift();
  const out = lines.map((l) =>
    l
      .replace(/^\s{0,3}#{1,6}\s+/, "")
      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .replace(/[ \t]+$/g, ""),
  );
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

const QUOTES: Record<string, string> = { "‘": "'", "’": "'", "‚": "'", "‛": "'", "“": '"', "”": '"', "„": '"', "‟": '"', "«": '"', "»": '"' };
const DASHES = /[‐-―−]/g;
const DEVANAGARI_DIGITS = /[०-९]/g;

/**
 * The form two readings are compared in: one Unicode form (so "²" and "2", or "ﬁ" and "fi", are the same), one kind of quote and dash, no markup,
 * no line breaks or spaces (where a model breaks a line is not a difference in what it read), and capitals folded (small capitals are read either way).
 */
export function comparable(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[‘’‚‛“”„‟«»]/g, (c) => QUOTES[c] ?? c)
    .replace(DASHES, "-")
    .replace(DEVANAGARI_DIGITS, (d) => String(d.charCodeAt(0) - 0x966))
    .replace(/[*_#`]/g, "")
    .replace(/[\s​ ]+/g, "")
    .toLowerCase();
}

/** Edit distance between two strings (by code point), with a ceiling: returns `limit + 1` as soon as it is certain the distance is larger than `limit`. */
export function editDistance(a: string, b: string, limit = Infinity): number {
  const x = Array.from(a);
  const y = Array.from(b);
  if (x.length > y.length) return editDistance(b, a, limit);
  const n = x.length;
  const m = y.length;
  if (m - n > limit) return limit + 1;
  if (n === 0) return m;
  let prev = new Int32Array(n + 1);
  let cur = new Int32Array(n + 1);
  for (let i = 0; i <= n; i++) prev[i] = i;
  for (let j = 1; j <= m; j++) {
    cur[0] = j;
    let rowMin = j;
    const yj = y[j - 1];
    for (let i = 1; i <= n; i++) {
      const sub = prev[i - 1]! + (x[i - 1] === yj ? 0 : 1);
      const v = Math.min(sub, prev[i]! + 1, cur[i - 1]! + 1);
      cur[i] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > limit) return limit + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[n]!;
}

/** Share of characters on which two readings differ (0 to 1), compared in `comparable` form. Two empty readings do not differ. */
export function disagreement(a: string, b: string, ceiling = 1): number {
  const x = comparable(a);
  const y = comparable(b);
  const len = Math.max(Array.from(x).length, Array.from(y).length);
  if (len === 0) return 0;
  const limit = Math.ceil(len * ceiling);
  return Math.min(1, editDistance(x, y, limit) / len);
}

/** Numbers in a text as written ("2005", "0.01", "1,200"), Devanagari digits turned into 0-9, a trailing full stop or comma not counted. */
export function numbersIn(text: string): string[] {
  const t = text.normalize("NFKC").replace(DEVANAGARI_DIGITS, (d) => String(d.charCodeAt(0) - 0x966));
  return (t.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]+$/, ""));
}

/** Numbers that appear more often in one reading than in the other, each once, in order of first appearance (at most 12). */
export function disputedNumbers(a: string, b: string): string[] {
  const count = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
  const na = numbersIn(a);
  const nb = numbersIn(b);
  const ca = count(na);
  const cb = count(nb);
  const out: string[] = [];
  for (const n of [...na, ...nb]) if ((ca.get(n) ?? 0) !== (cb.get(n) ?? 0) && !out.includes(n)) out.push(n);
  return out.slice(0, 12);
}

/**
 * True when the text repeats itself the way a model does when it is lost: the same few words again and again (the share of different four-word runs
 * is small), or one character repeated many times. Dot leaders in a contents page ("......") are not counted.
 */
export function looksLooping(text: string): boolean {
  const t = text.normalize("NFKC").toLowerCase();
  if (/([^\s.\-_·•–—=~*])\1{29,}/u.test(t)) return true;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 60) return false;
  const runs = new Set<string>();
  let total = 0;
  for (let i = 0; i + 4 <= words.length; i++) {
    runs.add(words.slice(i, i + 4).join(" "));
    total++;
  }
  return runs.size / total < 0.55;
}

/* ---------------------------------------------------------------- the rule */

/**
 * Decides what to do with a page from its two readings. `first` is the primary model's, `second` the checking model's; null = that call failed.
 * Never "fixes" text and never picks the better of two: the first reading is kept as it is when the pair agree, and nothing is kept when they do not.
 */
export function judgePage(first: Reading | null, second: Reading | null): PageVerdict {
  const unreliable = (why: OcrWhy, d: number | null = null, disputed: string[] = []): PageVerdict => ({ status: "unreliable", disagreement: d, disputed, why, text: "" });
  if (!first || !second) return unreliable("second_reading_failed");
  if (first.cutOff || second.cutOff) return unreliable("cut_off");
  const a = cleanReading(first.text);
  const b = cleanReading(second.text);
  if (looksLooping(a) || looksLooping(b)) return unreliable("repeating");

  const la = Array.from(comparable(a)).length;
  const lb = Array.from(comparable(b)).length;
  if (la < 3 && lb < 3) return { status: "empty", disagreement: 0, disputed: [], text: "" };
  const [short, long] = la < lb ? [la, lb] : [lb, la];
  if (short === 0 || long / short > OCR_MAX_LENGTH_RATIO) return unreliable("lengths_differ", 1);

  const d = disagreement(a, b, OCR_WARN_BELOW * 2);
  const disputed = disputedNumbers(a, b);
  if (d >= OCR_WARN_BELOW) return unreliable("models_disagree", d, disputed);
  return { status: d < OCR_ACCEPT_BELOW ? "ok" : "warn", disagreement: d, disputed, text: a };
}

/** True for a page with so little text that it has to be read from its image. */
export function needsReading(textChars: number): boolean {
  return textChars < OCR_MIN_TEXT_CHARS;
}

/** A document is a scan when most of its pages have no text layer. (A paper with a few image-only pages is a text paper.) */
export function isScanned(pageTextChars: number[]): boolean {
  if (pageTextChars.length === 0) return false;
  const bare = pageTextChars.filter(needsReading).length;
  return bare / pageTextChars.length >= OCR_SCAN_SHARE;
}

/** Order to read the pages in: the first pages (title, DOI, abstract) and then the last (references), then the rest. Page numbers start at 1. */
export function readingOrder(pages: number[]): number[] {
  const sorted = [...new Set(pages)].sort((p, q) => p - q);
  const head = sorted.slice(0, 3);
  const tail = sorted.slice(3).slice(-6);
  const middle = sorted.slice(3, sorted.length - tail.length);
  return [...head, ...tail, ...middle];
}
