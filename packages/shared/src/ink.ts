/**
 * Drawing on a paper (My Workspace): pen, highlighter and eraser strokes. Strokes are vectors in the paper's own coordinates, never pixels, so they stay sharp
 * at any zoom, can be erased as a whole stroke and undone, and are small enough to save with the paper.
 *
 * Coordinates are fractions of the PAGE WIDTH, on both axes (y too), so a stroke does not depend on the zoom or on the size of the window.
 */

export const INK_TOOLS = ["pen", "highlighter"] as const;
export type InkTool = (typeof INK_TOOLS)[number];

/** Marker colours of the pen, and of the highlighter (lighter, they go over text). `hex` is what is drawn on the page, which is white paper in every theme. */
export const PEN_COLORS = [
  { id: "ink", label: "Black", hex: "#1b1d22" },
  { id: "blue", label: "Blue", hex: "#2b4ccf" },
  { id: "red", label: "Red", hex: "#d1342b" },
  { id: "green", label: "Green", hex: "#1f8a52" },
  { id: "orange", label: "Orange", hex: "#d96b00" },
  { id: "violet", label: "Violet", hex: "#7a3fc2" },
] as const;
export const HIGHLIGHTER_COLORS = [
  { id: "yellow", label: "Yellow", hex: "#ffd84d" },
  { id: "green", label: "Green", hex: "#6fe3a1" },
  { id: "pink", label: "Pink", hex: "#ff8fc2" },
  { id: "blue", label: "Blue", hex: "#7cc4ff" },
  { id: "orange", label: "Orange", hex: "#ffb066" },
] as const;
export const COLORS: Record<InkTool, readonly { id: string; label: string; hex: string }[]> = { pen: PEN_COLORS, highlighter: HIGHLIGHTER_COLORS };
export const inkHex = (tool: InkTool, color: string): string => COLORS[tool].find((c) => c.id === color)?.hex ?? COLORS[tool][0]!.hex;

export const INK_SIZES = ["s", "m", "l", "xl"] as const;
export type InkSize = (typeof INK_SIZES)[number];
/** Line widths as fractions of the page width (a 600 px wide page: the pen is about 1, 2, 3.6 and 6.6 px; the highlighter 6.6 to 28 px). */
export const PEN_WIDTH: Record<InkSize, number> = { s: 0.0018, m: 0.0034, l: 0.006, xl: 0.011 };
export const HIGHLIGHTER_WIDTH: Record<InkSize, number> = { s: 0.011, m: 0.018, l: 0.03, xl: 0.046 };
/** The eraser's radius, same unit. */
export const ERASER_RADIUS: Record<InkSize, number> = { s: 0.007, m: 0.014, l: 0.026, xl: 0.045 };
export const widthFor = (tool: InkTool, size: InkSize) => (tool === "pen" ? PEN_WIDTH : HIGHLIGHTER_WIDTH)[size];

export type InkStroke = {
  id: string;
  page: number;
  tool: InkTool;
  color: string;
  /** Line width, fraction of the page width. */
  w: number;
  /** Flat list of points: x, y, pressure, x, y, pressure, ... (x and y as fractions of the page width, pressure 0 to 1). */
  pts: number[];
};

export const INK_LIMITS = {
  strokes: 4000,
  pointsPerStroke: 2000,
  totalPoints: 200_000,
  /** Largest saved document, in characters of JSON (a database row holds 2 MB). */
  bytes: 1_400_000,
  minW: 0.0005,
  maxW: 0.08,
  /** y can run past 1 because it is measured in page widths and a page is taller than it is wide; this is far more than any page. */
  maxY: 4,
} as const;

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

export type InkCheck = { ok: true; strokes: InkStroke[] } | { ok: false; reason: string };

/**
 * Checks and cleans strokes that came from a browser (it is untrusted: a script can send anything): shape, ranges, palette, limits. Numbers are rounded to keep the
 * saved size small. A stroke that is not valid fails the whole save rather than being dropped quietly, so a bug is noticed and nothing is half saved.
 */
export function checkInk(raw: unknown, maxPage: number): InkCheck {
  if (!Array.isArray(raw)) return { ok: false, reason: "strokes must be a list" };
  if (raw.length > INK_LIMITS.strokes) return { ok: false, reason: "too many strokes" };
  const seen = new Set<string>();
  const out: InkStroke[] = [];
  let total = 0;
  for (const s of raw) {
    if (!s || typeof s !== "object") return { ok: false, reason: "a stroke is not an object" };
    const { id, page, tool, color, w, pts } = s as Record<string, unknown>;
    if (typeof id !== "string" || !ID.test(id)) return { ok: false, reason: "a stroke has no valid id" };
    if (seen.has(id)) return { ok: false, reason: "two strokes share an id" };
    if (typeof page !== "number" || !Number.isInteger(page) || page < 1 || page > maxPage) return { ok: false, reason: "a stroke is on a page this paper does not have" };
    if (tool !== "pen" && tool !== "highlighter") return { ok: false, reason: "unknown tool" };
    if (typeof color !== "string" || !COLORS[tool].some((c) => c.id === color)) return { ok: false, reason: "unknown colour" };
    if (typeof w !== "number" || !Number.isFinite(w)) return { ok: false, reason: "a stroke has no width" };
    if (!Array.isArray(pts) || pts.length < 3 || pts.length % 3 !== 0 || pts.length > INK_LIMITS.pointsPerStroke * 3) return { ok: false, reason: "a stroke has no valid points" };
    total += pts.length / 3;
    if (total > INK_LIMITS.totalPoints) return { ok: false, reason: "too many points" };
    const clean: number[] = new Array(pts.length);
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i];
      const y = pts[i + 1];
      const p = pts[i + 2];
      if (typeof x !== "number" || typeof y !== "number" || typeof p !== "number" || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(p)) return { ok: false, reason: "a point is not a number" };
      clean[i] = round(Math.min(1.05, Math.max(-0.05, x)), 4);
      clean[i + 1] = round(Math.min(INK_LIMITS.maxY, Math.max(-0.05, y)), 4);
      clean[i + 2] = round(Math.min(1, Math.max(0, p)), 2);
    }
    seen.add(id);
    out.push({ id, page, tool, color, w: round(Math.min(INK_LIMITS.maxW, Math.max(INK_LIMITS.minW, w)), 5), pts: clean });
  }
  if (JSON.stringify(out).length > INK_LIMITS.bytes) return { ok: false, reason: "too much ink for one paper" };
  return { ok: true, strokes: out };
}

/** Ramer–Douglas–Peucker on the x and y of a flat point list, keeping the pressure of the points it keeps. `eps` in page widths. */
export function simplify(pts: number[], eps: number): number[] {
  const n = pts.length / 3;
  if (n <= 2) return pts.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1;
    let dmax = eps;
    const ax = pts[a * 3]!, ay = pts[a * 3 + 1]!, bx = pts[b * 3]!, by = pts[b * 3 + 1]!;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(pts[i * 3]!, pts[i * 3 + 1]!, ax, ay, bx, by);
      if (d > dmax) {
        dmax = d;
        far = i;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i * 3]!, pts[i * 3 + 1]!, pts[i * 3 + 2]!);
  return out;
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Does the eraser (a circle of radius `r` at x, y) touch this stroke? The stroke's own half width counts. */
export function touches(s: InkStroke, x: number, y: number, r: number): boolean {
  const reach = r + s.w / 2;
  const n = s.pts.length / 3;
  // bounding box first: most strokes of a page are nowhere near the eraser
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const px = s.pts[i * 3]!, py = s.pts[i * 3 + 1]!;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  if (x < minX - reach || x > maxX + reach || y < minY - reach || y > maxY + reach) return false;
  if (n === 1) return Math.hypot(x - s.pts[0]!, y - s.pts[1]!) <= reach;
  for (let i = 0; i < n - 1; i++) {
    if (distToSegment(x, y, s.pts[i * 3]!, s.pts[i * 3 + 1]!, s.pts[(i + 1) * 3]!, s.pts[(i + 1) * 3 + 1]!) <= reach) return true;
  }
  return false;
}

/* ---------------------------------------------------------------- undo and redo */

/** What the reader did, in a form that can be turned around. Erasing several strokes in one sweep is one step. */
export type InkStep = { type: "add"; stroke: InkStroke } | { type: "erase"; items: { at: number; stroke: InkStroke }[] };

export function insertStroke(strokes: InkStroke[], s: InkStroke): InkStroke[] {
  return [...strokes, s];
}
export function eraseStrokes(strokes: InkStroke[], ids: ReadonlySet<string>): { strokes: InkStroke[]; items: { at: number; stroke: InkStroke }[] } {
  const items: { at: number; stroke: InkStroke }[] = [];
  const kept: InkStroke[] = [];
  strokes.forEach((s, at) => (ids.has(s.id) ? items.push({ at, stroke: s }) : kept.push(s)));
  return { strokes: kept, items };
}
/** Put erased strokes back where they were (so overlapping strokes keep their order). */
export function restoreStrokes(strokes: InkStroke[], items: { at: number; stroke: InkStroke }[]): InkStroke[] {
  const out = strokes.slice();
  for (const it of [...items].sort((a, b) => a.at - b.at)) out.splice(Math.min(it.at, out.length), 0, it.stroke);
  return out;
}

/** Do a step to the strokes (redo) or take it back (undo). */
export function apply(strokes: InkStroke[], step: InkStep, dir: "do" | "undo"): InkStroke[] {
  if (step.type === "add") return dir === "do" ? insertStroke(strokes, step.stroke) : eraseStrokes(strokes, new Set([step.stroke.id])).strokes;
  return dir === "do" ? eraseStrokes(strokes, new Set(step.items.map((i) => i.stroke.id))).strokes : restoreStrokes(strokes, step.items);
}

export const HISTORY_MAX = 200;
export type InkHistory = { done: InkStep[]; undone: InkStep[] };
export const emptyHistory = (): InkHistory => ({ done: [], undone: [] });
/** A new step: it can be undone, and what could have been redone is gone. */
export const record = (h: InkHistory, step: InkStep): InkHistory => ({ done: [...h.done, step].slice(-HISTORY_MAX), undone: [] });
export function undo(h: InkHistory, strokes: InkStroke[]): { history: InkHistory; strokes: InkStroke[] } | null {
  const step = h.done.at(-1);
  if (!step) return null;
  return { history: { done: h.done.slice(0, -1), undone: [...h.undone, step] }, strokes: apply(strokes, step, "undo") };
}
export function redo(h: InkHistory, strokes: InkStroke[]): { history: InkHistory; strokes: InkStroke[] } | null {
  const step = h.undone.at(-1);
  if (!step) return null;
  return { history: { done: [...h.done, step], undone: h.undone.slice(0, -1) }, strokes: apply(strokes, step, "do") };
}
