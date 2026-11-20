/**
 * Ink on the pages of notes (docs/design/paper-reader.md, 25): pen and highlighter strokes drawn straight on a page of the Notebook, over its text, in its margins and in blank room
 * (a `space` block). A page's text reflows (Split, the Notes view, a phone, the PDF, Word), so a stroke is not kept as an x and a y on the page: it is attached, when the pen lifts, to
 * what lies under the centre of its box, and drawn again from there wherever that lands.
 *   - over the text of a text, quote or answer block: to the CHARACTER nearest that centre. Its points are hundredths of an em from that character's left edge and the middle of its
 *     line box, so a circle round a word follows the word wherever the line breaks, and keeps its size with the text (1 em is the text's size: 0.95 rem on screen, 11 pt in the PDF);
 *   - over a capture, a picture, an old sketch or a `space` block: to the BLOCK's box, as ten-thousandths of the block's width on both axes (the sketch's and the paper's rule), so its
 *     ink scales with the block.
 * A page's ink is a row of its own on the server (doc_notebook_ink), apart from its blocks: typing and drawing never conflict, and a text save stays small.
 *
 * This module imports nothing (the dependency rule of shared, layers.test.ts): the colour ids are written out here, and a test holds them equal to ink.ts's.
 */

/** Where a stroke is attached. */
export type NoteInkAnchor =
  /** a character of a text, quote or answer block: `at` is its offset in the block's plain text (`inkPlainText`), `q` the text from it on (at most 16 characters), to find it again */
  | { k: "text"; b: string; at: number; q: string }
  /** the box of a capture, picture, sketch or space block */
  | { k: "box"; b: string };

export type NoteStroke = {
  id: string;
  tool: "pen" | "highlighter";
  color: string;
  /** width: hundredths of an em (text anchor) or ten-thousandths of the block's width (box anchor) */
  w: number;
  a: NoteInkAnchor;
  /** integers: dx, dy, pressure x 100, ... (hundredths of an em from the anchor character, or ten-thousandths of the block's width from its top left) */
  pts: number[];
};

/** A page's ink as the server sends it. */
export type NotebookInk = { pageId: string; strokes: NoteStroke[]; rev: number; updatedAt: number };

export const NOTE_INK_LIMITS = {
  strokes: 2000,
  pointsPerStroke: 2000,
  pointsPerPage: 40_000,
  /** bytes of a page's strokes as JSON (UTF-8) */
  pageBytes: 512 * 1024,
  /** bytes of all of a paper's note ink together */
  paperBytes: 4 * 1024 * 1024,
  /** text anchor: dx and dy in hundredths of an em (60 em and 40 em) */
  dx: 6000,
  dy: 4000,
  /** box anchor: x and y in ten-thousandths of the width */
  boxMin: -500,
  boxMaxX: 10_500,
  boxMaxY: 40_000,
  /** an anchor's offset (the longest text a block holds) and its quote */
  at: 8000,
  quote: 16,
  /** width: hundredths of an em, or ten-thousandths of the width */
  wMin: 1,
  wMax: 600,
} as const;

/** A request body can be no bigger than a full page of ink plus its envelope. */
export const MAX_NOTE_INK_BODY = NOTE_INK_LIMITS.pageBytes + 4 * 1024;

/** The pen and highlighter colours (equal to ink.ts's PEN_COLORS and HIGHLIGHTER_COLORS ids, by test). */
export const NOTE_PEN_COLORS = ["ink", "blue", "red", "green", "orange", "violet"] as const;
export const NOTE_HIGHLIGHTER_COLORS = ["yellow", "green", "pink", "blue", "orange"] as const;

/** Sizes of the ink on notes, in em (the text's size): the pen about 1.2 to 6.4 px and the highlighter 7 to 27 px on screen; the eraser's radius. */
export const NOTE_PEN_EM = { s: 0.08, m: 0.14, l: 0.24, xl: 0.42 } as const;
export const NOTE_HIGHLIGHTER_EM = { s: 0.45, m: 0.75, l: 1.2, xl: 1.8 } as const;
export const NOTE_ERASER_EM = { s: 0.3, m: 0.6, l: 1.1, xl: 1.8 } as const;

/** The size of a page's strokes as the server stores them (JSON, UTF-8 bytes). */
export const noteInkBytes = (strokes: readonly NoteStroke[]): number => new TextEncoder().encode(JSON.stringify(strokes)).length;

export type NoteInkCheck = { ok: true; strokes: NoteStroke[] } | { ok: false; status: 400 | 413; reason: string };

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
/** The characters XML and JSON keep without trouble: no control characters other than a tab and a line feed. */
const cleanQuote = (s: string) => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");

/**
 * A page's strokes, checked: every stroke rebuilt from its known fields, every number an integer in range, the colour one of its tool's, at most 2,000 strokes, 2,000 points a stroke,
 * 40,000 points and 512 KB a page. Too many or too big is 413; anything else wrong is 400, with what is wrong (never dropped quietly). The server does not check that `a.b` is a block of
 * the page: a page and its ink are saved apart, and the page re-attaches a stroke whose block is gone.
 */
export function checkNoteInk(raw: unknown): NoteInkCheck {
  if (!Array.isArray(raw)) return { ok: false, status: 400, reason: "strokes must be a list" };
  if (raw.length > NOTE_INK_LIMITS.strokes) return { ok: false, status: 413, reason: `too many strokes: a page holds at most ${NOTE_INK_LIMITS.strokes}` };
  const out: NoteStroke[] = [];
  const seen = new Set<string>();
  let points = 0;
  for (const r of raw) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return { ok: false, status: 400, reason: "a stroke is not an object" };
    const s = r as Record<string, unknown>;
    if (typeof s.id !== "string" || !ID.test(s.id)) return { ok: false, status: 400, reason: "a stroke's id is not valid" };
    if (seen.has(s.id)) return { ok: false, status: 400, reason: "two strokes have the same id" };
    if (s.tool !== "pen" && s.tool !== "highlighter") return { ok: false, status: 400, reason: "a stroke's tool is not pen or highlighter" };
    const palette: readonly string[] = s.tool === "pen" ? NOTE_PEN_COLORS : NOTE_HIGHLIGHTER_COLORS;
    if (typeof s.color !== "string" || !palette.includes(s.color)) return { ok: false, status: 400, reason: "a stroke's colour is not one of its tool's" };
    if (!isInt(s.w, NOTE_INK_LIMITS.wMin, NOTE_INK_LIMITS.wMax)) return { ok: false, status: 400, reason: "a stroke's width is not valid" };
    const a = s.a as Record<string, unknown> | null;
    if (!a || typeof a !== "object" || Array.isArray(a) || typeof a.b !== "string" || !ID.test(a.b)) return { ok: false, status: 400, reason: "a stroke's anchor is not valid" };
    let anchor: NoteInkAnchor;
    if (a.k === "text") {
      if (!isInt(a.at, 0, NOTE_INK_LIMITS.at)) return { ok: false, status: 400, reason: "a stroke's anchor offset is not valid" };
      if (typeof a.q !== "string" || a.q.length > NOTE_INK_LIMITS.quote) return { ok: false, status: 400, reason: "a stroke's anchor text is not valid" };
      anchor = { k: "text", b: a.b, at: a.at, q: cleanQuote(a.q) };
    } else if (a.k === "box") anchor = { k: "box", b: a.b };
    else return { ok: false, status: 400, reason: "a stroke's anchor is not text or box" };
    const pts = s.pts;
    if (!Array.isArray(pts) || pts.length < 3 || pts.length % 3 !== 0) return { ok: false, status: 400, reason: "a stroke's points are not x, y, pressure triples" };
    if (pts.length / 3 > NOTE_INK_LIMITS.pointsPerStroke) return { ok: false, status: 413, reason: `too long: a stroke holds at most ${NOTE_INK_LIMITS.pointsPerStroke} points` };
    const text = anchor.k === "text";
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i], y = pts[i + 1], p = pts[i + 2];
      const inX = text ? isInt(x, -NOTE_INK_LIMITS.dx, NOTE_INK_LIMITS.dx) : isInt(x, NOTE_INK_LIMITS.boxMin, NOTE_INK_LIMITS.boxMaxX);
      const inY = text ? isInt(y, -NOTE_INK_LIMITS.dy, NOTE_INK_LIMITS.dy) : isInt(y, NOTE_INK_LIMITS.boxMin, NOTE_INK_LIMITS.boxMaxY);
      if (!inX || !inY || !isInt(p, 0, 100)) return { ok: false, status: 400, reason: "a stroke's point is out of range" };
    }
    points += pts.length / 3;
    if (points > NOTE_INK_LIMITS.pointsPerPage) return { ok: false, status: 413, reason: `too long: a page holds at most ${NOTE_INK_LIMITS.pointsPerPage} points of ink` };
    seen.add(s.id);
    out.push({ id: s.id, tool: s.tool, color: s.color, w: s.w, a: anchor, pts: [...(pts as number[])] });
  }
  if (noteInkBytes(out) > NOTE_INK_LIMITS.pageBytes) return { ok: false, status: 413, reason: `too big: a page's drawing holds at most ${NOTE_INK_LIMITS.pageBytes / 1024} KB` };
  return { ok: true, strokes: out };
}

/* ---------------------------------------------------------------- anchors through an edit */

/**
 * Where offset `at` of `before` is in `after`, the text it became: the edit is what lies between the two texts' common start and common end. An offset before it stays, one after it
 * moves by the change in length, and one inside it stays inside what replaced it (at its start when the text there was deleted: "a stroke on a word you deleted moves to where that
 * word was").
 */
export function remapOffset(before: string, after: string, at: number): number {
  if (before === after) return at;
  const n = Math.min(before.length, after.length);
  let p = 0;
  while (p < n && before.charCodeAt(p) === after.charCodeAt(p)) p++;
  let s = 0;
  while (s < n - p && before.charCodeAt(before.length - 1 - s) === after.charCodeAt(after.length - 1 - s)) s++;
  if (at < p) return at;
  if (at >= before.length - s) return Math.max(0, at + after.length - before.length);
  const room = after.length - s - p;
  return room <= 0 ? Math.min(p, Math.max(0, after.length - 1)) : p + Math.min(at - p, room - 1);
}

/** The anchor's quote: the text from `at` on, at most 16 characters (what finds the anchor again when its offset drifted). */
export const anchorQuote = (text: string, at: number): string => text.slice(at, at + NOTE_INK_LIMITS.quote);

/**
 * Where a text anchor is in `text` now: its offset when its quote is still there, else the nearest place within 200 characters where its quote is (another window's edit moved it), else
 * its offset kept inside the text. -1 for an empty text.
 */
export function resolveAnchor(text: string, at: number, q: string): number {
  if (!text.length) return -1;
  if (!q || text.startsWith(q, at)) return Math.min(at, text.length - 1);
  let best = -1;
  for (let i = text.indexOf(q, Math.max(0, at - 200)); i >= 0 && i <= at + 200; i = text.indexOf(q, i + 1)) if (best < 0 || Math.abs(i - at) < Math.abs(best - at)) best = i;
  return best >= 0 ? best : Math.min(at, text.length - 1);
}

/* ---------------------------------------------------------------- the merge on a conflict */

const same = (a: NoteStroke | undefined, b: NoteStroke | undefined) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Another window saved this page's ink first. By stroke id (the paper's `mergeItems` rule, with changes): the server's strokes, less those this window erased, with this window's version of
 * those it changed (a stroke re-attached after an edit), plus those it added (after the server's, in this window's order).
 */
export function mergeNoteInk(server: readonly NoteStroke[], base: readonly NoteStroke[], mine: readonly NoteStroke[]): NoteStroke[] {
  const baseMap = new Map(base.map((s) => [s.id, s]));
  const mineMap = new Map(mine.map((s) => [s.id, s]));
  const serverIds = new Set(server.map((s) => s.id));
  const out: NoteStroke[] = [];
  for (const s of server) {
    const b = baseMap.get(s.id);
    const m = mineMap.get(s.id);
    if (b && !m) continue; // erased here
    out.push(m && b && !same(b, m) ? m : s);
  }
  for (const m of mine) if (!serverIds.has(m.id) && !baseMap.has(m.id)) out.push(m);
  return out;
}

/** "1 stroke", "3 strokes". */
export const strokesWord = (n: number): string => `${n} ${n === 1 ? "stroke" : "strokes"}`;
