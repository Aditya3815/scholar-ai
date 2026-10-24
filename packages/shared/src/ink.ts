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

/** Straight lines, arrows, rectangles and ellipses: two points (the start and the opposite corner), drawn with the pen colours. */
export const SHAPE_KINDS = ["line", "arrow", "rect", "ellipse"] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];
export type InkShape = { id: string; page: number; tool: "shape"; kind: ShapeKind; color: string; w: number; /** x, y, pressure, x, y, pressure (two points) */ pts: number[] };

/** Font sizes of a text box, as fractions of the page width (a 600 px page: about 8, 11, 16 and 24 px). */
export const TEXT_SIZES: Record<InkSize, number> = { s: 0.014, m: 0.019, l: 0.027, xl: 0.04 };
/** A text box written on the page: its top left corner, its width and height (height is measured by the browser when the text is written), and its words. */
export type InkText = { id: string; page: number; tool: "text"; color: string; x: number; y: number; w: number; h: number; size: number; text: string };
/** A sticky note: a small coloured square on the page that holds words. Square side as a fraction of the page width: `STICKY_SIDE`. */
export const STICKY_SIDE = 0.034;
export type InkSticky = { id: string; page: number; tool: "sticky"; color: string; x: number; y: number; text: string };

/** Everything that can be drawn or written on a page. */
export type InkItem = InkStroke | InkShape | InkText | InkSticky;
export type InkItemTool = InkItem["tool"];

/** The colours an item of each kind may have: pen colours for pen, shapes and text; highlighter colours for the highlighter and sticky notes. */
export const paletteFor = (tool: InkItemTool): readonly { id: string; label: string; hex: string }[] => (tool === "highlighter" || tool === "sticky" ? HIGHLIGHTER_COLORS : PEN_COLORS);
export const itemHex = (item: InkItem): string => paletteFor(item.tool).find((c) => c.id === item.color)?.hex ?? paletteFor(item.tool)[0]!.hex;

export const INK_LIMITS = {
  strokes: 4000,
  pointsPerStroke: 2000,
  totalPoints: 200_000,
  /** Largest saved document, in characters of JSON (a database row holds 2 MB). */
  bytes: 1_400_000,
  minW: 0.0005,
  maxW: 0.08,
  /** Text boxes and sticky notes together, and the most characters one of them holds. */
  texts: 300,
  textChars: 2000,
  /** y can run past 1 because it is measured in page widths and a page is taller than it is wide; this is far more than any page. */
  maxY: 4,
} as const;

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

export type InkCheck = { ok: true; strokes: InkItem[] } | { ok: false; reason: string };

const clampN = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** Words written by the reader: line breaks and tabs stay, other control characters go, and the length is limited. */
const cleanWords = (v: unknown): string | null => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").slice(0, INK_LIMITS.textChars) : null);

/**
 * Checks and cleans what came from a browser (it is untrusted: a script can send anything): shape, ranges, palette, limits. Numbers are rounded to keep the
 * saved size small. An item that is not valid fails the whole save rather than being dropped quietly, so a bug is noticed and nothing is half saved.
 * (The list is called "strokes" for historical reasons: it also holds shapes, text boxes and sticky notes.)
 */
export function checkInk(raw: unknown, maxPage: number): InkCheck {
  if (!Array.isArray(raw)) return { ok: false, reason: "strokes must be a list" };
  if (raw.length > INK_LIMITS.strokes) return { ok: false, reason: "too many strokes" };
  const seen = new Set<string>();
  const out: InkItem[] = [];
  let total = 0;
  let texts = 0;
  for (const s of raw) {
    if (!s || typeof s !== "object") return { ok: false, reason: "a stroke is not an object" };
    const o = s as Record<string, unknown>;
    const { id, page, tool, color } = o;
    if (typeof id !== "string" || !ID.test(id)) return { ok: false, reason: "a stroke has no valid id" };
    if (seen.has(id)) return { ok: false, reason: "two strokes share an id" };
    if (typeof page !== "number" || !Number.isInteger(page) || page < 1 || page > maxPage) return { ok: false, reason: "a stroke is on a page this paper does not have" };
    if (tool !== "pen" && tool !== "highlighter" && tool !== "shape" && tool !== "text" && tool !== "sticky") return { ok: false, reason: "unknown tool" };
    if (typeof color !== "string" || !paletteFor(tool).some((c) => c.id === color)) return { ok: false, reason: "unknown colour" };

    if (tool === "text" || tool === "sticky") {
      const { x, y } = o;
      if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return { ok: false, reason: "a note has no position" };
      const text = cleanWords(o.text);
      if (text === null) return { ok: false, reason: "a note has no text" };
      if (++texts > INK_LIMITS.texts) return { ok: false, reason: "too many text boxes and notes" };
      seen.add(id);
      if (tool === "sticky") {
        out.push({ id, page, tool, color, x: round(clampN(x, -0.05, 1.05), 4), y: round(clampN(y, -0.05, INK_LIMITS.maxY), 4), text });
        continue;
      }
      const { w, h, size } = o;
      if (typeof w !== "number" || typeof h !== "number" || typeof size !== "number" || !Number.isFinite(w + h + size)) return { ok: false, reason: "a text box has no size" };
      if (text.trim() === "") return { ok: false, reason: "a text box is empty" };
      out.push({ id, page, tool, color, x: round(clampN(x, -0.05, 1.05), 4), y: round(clampN(y, -0.05, INK_LIMITS.maxY), 4), w: round(clampN(w, 0.04, 1.1), 4), h: round(clampN(h, 0.005, INK_LIMITS.maxY), 4), size: round(clampN(size, 0.008, 0.08), 4), text });
      continue;
    }

    const { w, pts } = o;
    if (typeof w !== "number" || !Number.isFinite(w)) return { ok: false, reason: "a stroke has no width" };
    if (!Array.isArray(pts) || pts.length < 3 || pts.length % 3 !== 0 || pts.length > INK_LIMITS.pointsPerStroke * 3) return { ok: false, reason: "a stroke has no valid points" };
    let kind: ShapeKind | undefined;
    if (tool === "shape") {
      kind = SHAPE_KINDS.find((k) => k === o.kind);
      if (!kind) return { ok: false, reason: "unknown shape" };
      if (pts.length !== 6) return { ok: false, reason: "a shape has two points" };
    }
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
    const width = round(Math.min(INK_LIMITS.maxW, Math.max(INK_LIMITS.minW, w)), 5);
    out.push(tool === "shape" ? { id, page, tool, kind: kind!, color, w: width, pts: clean } : { id, page, tool, color, w: width, pts: clean });
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

/* ---------------------------------------------------------------- geometry of every kind of item */

export type Bounds = { x0: number; y0: number; x1: number; y1: number };

/** The outline of a shape as a list of points (page units), for hit tests: a line or arrow is its two ends, a rectangle its four corners and back, an ellipse 48 points round it. */
export function shapeOutline(s: InkShape): [number, number][] {
  const [ax, ay, bx, by] = [s.pts[0]!, s.pts[1]!, s.pts[3]!, s.pts[4]!];
  if (s.kind === "line" || s.kind === "arrow") return [[ax, ay], [bx, by]];
  if (s.kind === "rect") return [[ax, ay], [bx, ay], [bx, by], [ax, by], [ax, ay]];
  const cx = (ax + bx) / 2, cy = (ay + by) / 2, rx = Math.abs(bx - ax) / 2, ry = Math.abs(by - ay) / 2;
  return Array.from({ length: 49 }, (_, i) => [cx + rx * Math.cos((i / 48) * 2 * Math.PI), cy + ry * Math.sin((i / 48) * 2 * Math.PI)] as [number, number]);
}

/** The box round an item (the line's own half width included). */
export function itemBounds(it: InkItem): Bounds {
  if (it.tool === "text") return { x0: it.x, y0: it.y, x1: it.x + it.w, y1: it.y + it.h };
  if (it.tool === "sticky") return { x0: it.x, y0: it.y, x1: it.x + STICKY_SIDE, y1: it.y + STICKY_SIDE };
  const pts = it.tool === "shape" ? shapeOutline(it).flat() : null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  if (pts) {
    for (let i = 0; i < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i]!); x1 = Math.max(x1, pts[i]!); y0 = Math.min(y0, pts[i + 1]!); y1 = Math.max(y1, pts[i + 1]!);
    }
  } else {
    for (let i = 0; i < it.pts.length; i += 3) {
      x0 = Math.min(x0, it.pts[i]!); x1 = Math.max(x1, it.pts[i]!); y0 = Math.min(y0, it.pts[i + 1]!); y1 = Math.max(y1, it.pts[i + 1]!);
    }
  }
  const h = it.w / 2;
  return { x0: x0 - h, y0: y0 - h, x1: x1 + h, y1: y1 + h };
}

/**
 * The head of an arrow whose line runs from `a` to `b` (page units): the tip (which is `b`) and the two back corners, and the point where the line itself should stop so
 * that its end does not stick out past the tip. The head grows with the line's width but never gets bigger than half the arrow.
 */
export function arrowHead(a: readonly [number, number], b: readonly [number, number], w: number): { tip: [number, number]; left: [number, number]; right: [number, number]; stop: [number, number] } {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len === 0) return { tip: [b[0], b[1]], left: [b[0], b[1]], right: [b[0], b[1]], stop: [b[0], b[1]] };
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const head = Math.min(len / 2, Math.max(w * 5, 0.014));
  const half = head * 0.45;
  const base: [number, number] = [b[0] - ux * head, b[1] - uy * head];
  return { tip: [b[0], b[1]], left: [base[0] - uy * half, base[1] + ux * half], right: [base[0] + uy * half, base[1] - ux * half], stop: [b[0] - ux * head * 0.7, b[1] - uy * head * 0.7] };
}

/** Does a circle of radius `r` at x, y touch this item? Shapes are touched on their line (not inside a rectangle), text boxes and notes anywhere in their box. */
export function touchesItem(it: InkItem, x: number, y: number, r: number): boolean {
  if (it.tool === "pen" || it.tool === "highlighter") return touches(it, x, y, r);
  if (it.tool === "shape") {
    const o = shapeOutline(it);
    const reach = r + it.w / 2;
    for (let i = 0; i < o.length - 1; i++) if (distToSegment(x, y, o[i]![0], o[i]![1], o[i + 1]![0], o[i + 1]![1]) <= reach) return true;
    return false;
  }
  const b = itemBounds(it);
  return x >= b.x0 - r && x <= b.x1 + r && y >= b.y0 - r && y <= b.y1 + r;
}

/** Is the point inside the polygon (even-odd rule)? */
export function inPolygon(poly: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Is this item chosen by a lasso? A text box or note when its middle is inside; a line or shape when at least half of its points are. */
export function inLasso(it: InkItem, poly: readonly (readonly [number, number])[]): boolean {
  if (poly.length < 3) return false;
  if (it.tool === "text" || it.tool === "sticky") {
    const b = itemBounds(it);
    return inPolygon(poly, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
  }
  const pts: [number, number][] = it.tool === "shape" ? shapeOutline(it) : Array.from({ length: it.pts.length / 3 }, (_, i) => [it.pts[i * 3]!, it.pts[i * 3 + 1]!] as [number, number]);
  const inside = pts.filter(([x, y]) => inPolygon(poly, x, y)).length;
  return inside * 2 >= pts.length;
}

/** The shift (dx, dy) to apply to a group of items so that none of them leaves the page: a request to move them is cut back to that. */
export function clampMove(items: readonly InkItem[], dx: number, dy: number): { dx: number; dy: number } {
  if (items.length === 0) return { dx: 0, dy: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of items) {
    const b = itemBounds(it);
    x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
  }
  return { dx: clampN(dx, -0.02 - x0, 1.02 - x1), dy: clampN(dy, -0.02 - y0, INK_LIMITS.maxY - 0.02 - y1) };
}

/** The same item moved by (dx, dy), numbers rounded as they are when saved. */
export function moveItem<T extends InkItem>(it: T, dx: number, dy: number): T {
  if (it.tool === "text" || it.tool === "sticky") return { ...it, x: round(it.x + dx, 4), y: round(it.y + dy, 4) };
  const pts = it.pts.slice();
  for (let i = 0; i < pts.length; i += 3) {
    pts[i] = round(pts[i]! + dx, 4);
    pts[i + 1] = round(pts[i + 1]! + dy, 4);
  }
  return { ...it, pts };
}

/* ---------------------------------------------------------------- undo and redo */

/** What the reader did, in a form that can be turned around. Erasing or moving several things in one go is one step. */
export type InkStep =
  | { type: "add"; stroke: InkItem }
  | { type: "erase"; items: { at: number; stroke: InkItem }[] }
  /** Some items changed (moved, a text edited): the same items before and after, matched by id. */
  | { type: "edit"; before: InkItem[]; after: InkItem[] };

export function insertStroke(strokes: InkItem[], s: InkItem): InkItem[] {
  return [...strokes, s];
}
export function eraseStrokes(strokes: InkItem[], ids: ReadonlySet<string>): { strokes: InkItem[]; items: { at: number; stroke: InkItem }[] } {
  const items: { at: number; stroke: InkItem }[] = [];
  const kept: InkItem[] = [];
  strokes.forEach((s, at) => (ids.has(s.id) ? items.push({ at, stroke: s }) : kept.push(s)));
  return { strokes: kept, items };
}
/** Put erased strokes back where they were (so overlapping strokes keep their order). */
export function restoreStrokes(strokes: InkItem[], items: { at: number; stroke: InkItem }[]): InkItem[] {
  const out = strokes.slice();
  for (const it of [...items].sort((a, b) => a.at - b.at)) out.splice(Math.min(it.at, out.length), 0, it.stroke);
  return out;
}
/**
 * The drawing the server has, with what was drawn here since the reader last saw it (offline, or in a tab whose drawing was changed in another window) added.
 * `known` are the ids the reader had when they last saw the server's drawing: a local item that is not in it is new, so it is added; one that is in it but is no longer
 * on the server was erased elsewhere, so it is NOT brought back. For an item both sides have, the server's version wins. Nothing the reader drew is lost, and nothing
 * erased comes back. The result keeps the limit on the number of items.
 */
export function mergeItems(server: InkItem[], local: InkItem[], known: Iterable<string> = []): InkItem[] {
  const have = new Set(server.map((s) => s.id));
  const seen = new Set(known);
  const added = local.filter((s) => !have.has(s.id) && !seen.has(s.id));
  return [...server, ...added].slice(0, INK_LIMITS.strokes);
}

/** Swap items for their changed versions, keeping their place in the order. An id that is no longer there is ignored. */
export function replaceItems(strokes: InkItem[], changed: readonly InkItem[]): InkItem[] {
  const by = new Map(changed.map((c) => [c.id, c]));
  return strokes.map((s) => by.get(s.id) ?? s);
}

/** Do a step to the strokes (redo) or take it back (undo). */
export function apply(strokes: InkItem[], step: InkStep, dir: "do" | "undo"): InkItem[] {
  if (step.type === "add") return dir === "do" ? insertStroke(strokes, step.stroke) : eraseStrokes(strokes, new Set([step.stroke.id])).strokes;
  if (step.type === "edit") return replaceItems(strokes, dir === "do" ? step.after : step.before);
  return dir === "do" ? eraseStrokes(strokes, new Set(step.items.map((i) => i.stroke.id))).strokes : restoreStrokes(strokes, step.items);
}

export const HISTORY_MAX = 200;
export type InkHistory = { done: InkStep[]; undone: InkStep[] };
export const emptyHistory = (): InkHistory => ({ done: [], undone: [] });
/** A new step: it can be undone, and what could have been redone is gone. */
export const record = (h: InkHistory, step: InkStep): InkHistory => ({ done: [...h.done, step].slice(-HISTORY_MAX), undone: [] });
export function undo(h: InkHistory, strokes: InkItem[]): { history: InkHistory; strokes: InkItem[] } | null {
  const step = h.done.at(-1);
  if (!step) return null;
  return { history: { done: h.done.slice(0, -1), undone: [...h.undone, step] }, strokes: apply(strokes, step, "undo") };
}
export function redo(h: InkHistory, strokes: InkItem[]): { history: InkHistory; strokes: InkItem[] } | null {
  const step = h.undone.at(-1);
  if (!step) return null;
  return { history: { done: [...h.done, step], undone: h.undone.slice(0, -1) }, strokes: apply(strokes, step, "do") };
}
