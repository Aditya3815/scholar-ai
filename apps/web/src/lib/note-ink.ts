import { SPACE_H, mdPlain, NOTE_INK_LIMITS, anchorQuote, remapOffset, resolveAnchor, simplify, type NotebookBlock, type NotebookBlockKind, type NoteStroke } from "@scholar/shared";

/**
 * The anchoring engine of ink on the pages of notes (docs/design/paper-reader.md, 25.4), pure: it never touches the DOM. The page measures itself (NbInk.tsx) into a `PageGeo`: each block's
 * box and, for a block of text, the box of any of its characters and the character nearest a point; this module turns a stroke drawn in page pixels into an anchored stroke, and an
 * anchored stroke back into page pixels wherever its anchor is now. A test drives it with a fake layout.
 */

export type Box = { left: number; top: number; right: number; bottom: number };
/** A block of text, measured: the box of character `i` (null when it has none: a collapsed space), and the character nearest a point. */
export type TextGeo = { len: number; box: (i: number) => Box | null; nearest: (x: number, y: number) => number };
export type BlockGeo = { id: string; kind: NotebookBlockKind; body: Box; text: TextGeo | null };
/**
 * A page, measured, in page pixels (the ink layer's own box). `em` is the text's size in pixels. `room` is where a new space block goes (below the last block, while drawing), with the left
 * and width a block's body has. `maxRight` is how far right ink may reach before it is moved in (the page's right margin).
 */
export type PageGeo = { em: number; blocks: BlockGeo[]; room: Box | null; maxRight: number; minLeft: number };
/** A stroke placed on the page: points x, y (pixels) and pressure (0 to 1), and its width in pixels. */
export type PlacedStroke = { s: NoteStroke; pts: number[]; w: number };

/** The kinds whose characters a stroke is attached to; the others are attached to their box. */
export const TEXT_KINDS: readonly NotebookBlockKind[] = ["text", "quote", "agent"];
/** The text of a block as the page puts it into the DOM (what an anchor's offset counts in), or null for a block that is a box. A quote is drawn in its marks “…”. */
export function inkPlainOf(b: NotebookBlock): string | null {
  if (b.kind === "text" || b.kind === "agent") return mdPlain(b.md);
  if (b.kind === "quote") return `“${b.quote}”`;
  return null;
}

const width = (b: Box) => b.right - b.left;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** The point of a character a text anchor measures from: its left edge, at the middle of its line box (so a different line height does not move ink up or down). */
const refOf = (b: Box) => ({ x: b.left, y: (b.top + b.bottom) / 2 });

/** The nearest character to a point, from the boxes of all characters: on the line the point is on (or the nearest line), the nearest by x. -1 when no character has a box. */
export function nearestIndex(boxes: readonly (Box | null)[], x: number, y: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    if (!b || (b.right - b.left <= 0 && b.bottom - b.top <= 0)) continue;
    const dy = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0;
    const dx = x < b.left ? b.left - x : x > b.right ? x - b.right : 0;
    // a line apart weighs more than any distance along a line
    const d = dy * 10_000 + dx;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** The box of character `at`, or of the nearest character that has one. */
function charBox(t: TextGeo, at: number): Box | null {
  for (let k = 0; k < t.len; k++) {
    for (const i of k === 0 ? [at] : [at - k, at + k]) {
      if (i < 0 || i >= t.len) continue;
      const b = t.box(i);
      if (b) return b;
    }
  }
  return null;
}

/**
 * Where a stroke is now, in page pixels: a text anchor at its character's box (its offset checked against the block's text by its quote first: `texts`), a box anchor scaled to its block's
 * box. A text-anchored stroke that would cross the page's right edge is moved left until it fits, never scaled (scaling would take it off its word). Null when its block is not on the page
 * (or not measured: a block of text open for typing).
 */
export function placeStroke(s: NoteStroke, g: PageGeo, texts?: ReadonlyMap<string, string>): PlacedStroke | null {
  const blk = g.blocks.find((b) => b.id === s.a.b);
  if (!blk) return null;
  const out: number[] = [];
  let w: number;
  if (s.a.k === "text") {
    if (!blk.text || blk.text.len === 0) return null;
    const text = texts?.get(blk.id);
    const at = text !== undefined ? resolveAnchor(text, s.a.at, s.a.q) : Math.min(s.a.at, blk.text.len - 1);
    const box = at < 0 ? null : charBox(blk.text, Math.min(at, blk.text.len - 1));
    if (!box) return null;
    const r = refOf(box);
    const u = g.em / 100;
    let maxX = -Infinity;
    for (let i = 0; i < s.pts.length; i += 3) {
      const x = r.x + s.pts[i]! * u;
      out.push(x, r.y + s.pts[i + 1]! * u, s.pts[i + 2]! / 100);
      maxX = Math.max(maxX, x);
    }
    w = s.w * u;
    const over = maxX + w / 2 - g.maxRight;
    if (over > 0) {
      let minX = Infinity;
      for (let i = 0; i < out.length; i += 3) minX = Math.min(minX, out[i]!);
      const shift = Math.min(over, Math.max(0, minX - g.minLeft));
      for (let i = 0; i < out.length; i += 3) out[i] = out[i]! - shift;
    }
  } else {
    const u = width(blk.body) / 10_000;
    for (let i = 0; i < s.pts.length; i += 3) out.push(blk.body.left + s.pts[i]! * u, blk.body.top + s.pts[i + 1]! * u, s.pts[i + 2]! / 100);
    w = s.w * u;
  }
  return { s, pts: out, w };
}

/** The box round a list of points (x, y, pressure). */
export function boundsOf(pts: readonly number[]): Box {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    left = Math.min(left, pts[i]!);
    right = Math.max(right, pts[i]!);
    top = Math.min(top, pts[i + 1]!);
    bottom = Math.max(bottom, pts[i + 1]!);
  }
  return { left, top, right, bottom };
}

/** What a new stroke asks of the page besides itself: a new space block at the end (its id and height), or a space block made taller to hold it. */
export type InkAsk = { space: { id: string; h: number } | null; grow: { id: string; h: number } | null };

/** The height (ten-thousandths of the width) a space needs to hold ink down to `bottom` (page pixels) from its `top`, plus 1 em, and at least 48 px. */
export function spaceHeight(top: number, bottom: number, bodyWidth: number, em: number): number {
  const px = Math.max(48, bottom - top + em);
  return clamp(Math.ceil((px / bodyWidth) * 10_000), SPACE_H.min, SPACE_H.max);
}

/**
 * A stroke drawn in page pixels (x, y, pressure 0..1), attached when the pen lifts to what lies under the centre of its box (the start point when the centre is between blocks):
 *   - the character nearest it in a block of text (offsets in hundredths of an em from that character);
 *   - the box of any other block (ten-thousandths of the block's width), a space made taller when the stroke runs below it;
 *   - below the last block (the room): a new space block there, which holds it.
 * `wEm` is the line's width in em. Points are simplified first (0.02 em), and kept as integers. Null when the page has no block to attach to.
 */
export function anchorStroke(
  raw: readonly number[],
  tool: "pen" | "highlighter",
  color: string,
  wEm: number,
  g: PageGeo,
  ids: { stroke: string; space: () => string },
  texts?: ReadonlyMap<string, string>,
): { stroke: NoteStroke; ask: InkAsk } | null {
  const em = g.em;
  const pts = raw.length > 6 ? simplify([...raw], 0.02 * em) : [...raw];
  const bb = boundsOf(pts);
  const cx = (bb.left + bb.right) / 2;
  const cy = (bb.top + bb.bottom) / 2;
  const ask: InkAsk = { space: null, grow: null };
  const intPts = (fx: (x: number) => number, fy: (y: number) => number, lo: [number, number], hi: [number, number]) => {
    const out: number[] = [];
    for (let i = 0; i < pts.length; i += 3) out.push(clamp(Math.round(fx(pts[i]!)), lo[0], hi[0]), clamp(Math.round(fy(pts[i + 1]!)), lo[1], hi[1]), clamp(Math.round(pts[i + 2]! * 100), 0, 100));
    return out;
  };
  const boxStroke = (id: string, body: Box): NoteStroke => {
    const u = width(body) / 10_000;
    return {
      id: ids.stroke,
      tool,
      color,
      w: clamp(Math.round((wEm * em) / u), NOTE_INK_LIMITS.wMin, NOTE_INK_LIMITS.wMax),
      a: { k: "box", b: id },
      pts: intPts((x) => (x - body.left) / u, (y) => (y - body.top) / u, [NOTE_INK_LIMITS.boxMin, NOTE_INK_LIMITS.boxMin], [NOTE_INK_LIMITS.boxMaxX, NOTE_INK_LIMITS.boxMaxY]),
    };
  };

  // below the last block: a new space there, or the last block's space made taller
  const last = g.blocks[g.blocks.length - 1];
  if (g.room && cy >= g.room.top) {
    if (last?.kind === "space") {
      ask.grow = { id: last.id, h: spaceHeight(last.body.top, bb.bottom, width(last.body), em) };
      return { stroke: boxStroke(last.id, last.body), ask };
    }
    const body = { ...g.room };
    const id = ids.space();
    ask.space = { id, h: spaceHeight(body.top, bb.bottom, width(body), em) };
    return { stroke: boxStroke(id, body), ask };
  }
  if (!g.blocks.length) return null;

  // the block under the centre; between blocks, the one under the start point; else the nearest
  const under = (y: number) => g.blocks.find((b) => y >= b.body.top && y <= b.body.bottom);
  const nearest = (y: number) => g.blocks.reduce((m, b) => (Math.abs(y - (b.body.top + b.body.bottom) / 2) < Math.abs(y - (m.body.top + m.body.bottom) / 2) ? b : m));
  const blk = under(cy) ?? under(pts[1]!) ?? nearest(cy);
  if (blk.text && blk.text.len > 0 && TEXT_KINDS.includes(blk.kind)) {
    // the start point decides when the centre is in empty space beside the text (an arrow from the margin)
    const at = blk.text.nearest(cx, cy);
    const box = at >= 0 ? blk.text.box(at) : null;
    if (box && at >= 0) {
      const r = refOf(box);
      const u = em / 100;
      const text = texts?.get(blk.id) ?? "";
      return {
        stroke: {
          id: ids.stroke,
          tool,
          color,
          w: clamp(Math.round(wEm * 100), NOTE_INK_LIMITS.wMin, NOTE_INK_LIMITS.wMax),
          a: { k: "text", b: blk.id, at, q: anchorQuote(text, at) },
          pts: intPts((x) => (x - r.x) / u, (y) => (y - r.y) / u, [-NOTE_INK_LIMITS.dx, -NOTE_INK_LIMITS.dy], [NOTE_INK_LIMITS.dx, NOTE_INK_LIMITS.dy]),
        },
        ask,
      };
    }
  }
  if (blk.kind === "space" && bb.bottom > blk.body.bottom - em / 2) ask.grow = { id: blk.id, h: spaceHeight(blk.body.top, bb.bottom, width(blk.body), em) };
  return { stroke: boxStroke(blk.id, blk.body), ask };
}

/** The distance from a point to a segment. */
function toSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l = dx * dx + dy * dy;
  const t = l ? clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
/** The strokes an eraser of radius `r` at x, y touches (their own half width counts): it removes whole strokes, as on the paper. */
export function eraseHits(placed: readonly PlacedStroke[], x: number, y: number, r: number): string[] {
  const out: string[] = [];
  for (const p of placed) {
    const reach = r + p.w / 2;
    const n = p.pts.length;
    let hit = n === 3 && Math.hypot(p.pts[0]! - x, p.pts[1]! - y) <= reach;
    for (let i = 3; !hit && i < n; i += 3) hit = toSegment(x, y, p.pts[i - 3]!, p.pts[i - 2]!, p.pts[i]!, p.pts[i + 1]!) <= reach;
    if (hit) out.push(p.s.id);
  }
  return out;
}

/**
 * The strokes of a page after its blocks' text changed (typing, a merge from another window): each text anchor's offset is carried through the edit (`remapOffset`), and its quote taken
 * again. Null when nothing moved. `before` and `after` are each block's plain text.
 */
export function remapStrokes(strokes: readonly NoteStroke[], before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): NoteStroke[] | null {
  let changed = false;
  const out = strokes.map((s) => {
    if (s.a.k !== "text") return s;
    const was = before.get(s.a.b);
    const now = after.get(s.a.b);
    if (was === undefined || now === undefined || was === now) return s;
    const start = resolveAnchor(was, s.a.at, s.a.q);
    const at = Math.max(0, Math.min(remapOffset(was, now, start < 0 ? s.a.at : start), Math.max(0, now.length - 1)));
    const q = anchorQuote(now, at);
    if (at === s.a.at && q === s.a.q) return s;
    changed = true;
    return { ...s, a: { ...s.a, at, q } };
  });
  return changed ? out : null;
}

/**
 * Strokes whose block is gone (deleted in another window): attached to the block before it in the page's old order (the start of its text, or its box), else the first block, keeping their
 * shape. Returns the strokes and how many moved; strokes on no page at all (an empty page) stay as they are.
 */
export function reattachOrphans(strokes: readonly NoteStroke[], oldOrder: readonly string[], blocks: readonly NotebookBlock[]): { strokes: NoteStroke[]; moved: number } {
  const have = new Map(blocks.map((b) => [b.id, b]));
  let moved = 0;
  const out = strokes.map((s) => {
    if (have.has(s.a.b) || !blocks.length) return s;
    const k = oldOrder.indexOf(s.a.b);
    let to: NotebookBlock | undefined;
    for (let i = k - 1; i >= 0 && !to; i--) to = have.get(oldOrder[i]!);
    to ??= blocks[0]!;
    moved++;
    const text = inkPlainOf(to);
    // a box is about 40 em wide: one ten-thousandth of it is 0.4 hundredths of an em
    if (text && text.length) {
      const pts = s.a.k === "text" ? s.pts : s.pts.map((v, i) => (i % 3 === 2 ? v : clamp(Math.round(v * 0.4), i % 3 === 0 ? -NOTE_INK_LIMITS.dx : -NOTE_INK_LIMITS.dy, i % 3 === 0 ? NOTE_INK_LIMITS.dx : NOTE_INK_LIMITS.dy)));
      const at = text.length - 1;
      return { ...s, w: s.a.k === "text" ? s.w : clamp(Math.round(s.w * 0.4), NOTE_INK_LIMITS.wMin, NOTE_INK_LIMITS.wMax), a: { k: "text" as const, b: to.id, at, q: anchorQuote(text, at) }, pts };
    }
    const pts = s.a.k === "box" ? s.pts : s.pts.map((v, i) => (i % 3 === 2 ? v : clamp(Math.round(v * 2.5), NOTE_INK_LIMITS.boxMin, i % 3 === 0 ? NOTE_INK_LIMITS.boxMaxX : NOTE_INK_LIMITS.boxMaxY)));
    return { ...s, w: s.a.k === "box" ? s.w : clamp(Math.round(s.w * 2.5), NOTE_INK_LIMITS.wMin, NOTE_INK_LIMITS.wMax), a: { k: "box" as const, b: to.id }, pts };
  });
  return { strokes: out, moved };
}

/** An old sketch's strokes as ink on the page, attached to the space block that takes its place (25.9): both keep points as fractions of the width, so the drawing is the same. */
export function sketchToInk(blockId: string, strokes: readonly { id: string; tool: "pen" | "highlighter"; color: string; w: number; pts: number[] }[]): NoteStroke[] {
  return strokes.map((s) => ({
    id: s.id,
    tool: s.tool,
    color: s.color,
    w: clamp(Math.round(s.w * 10_000), NOTE_INK_LIMITS.wMin, NOTE_INK_LIMITS.wMax),
    a: { k: "box", b: blockId },
    pts: s.pts.map((v, i) => (i % 3 === 2 ? clamp(Math.round(v * 100), 0, 100) : clamp(Math.round(v * 10_000), NOTE_INK_LIMITS.boxMin, i % 3 === 0 ? NOTE_INK_LIMITS.boxMaxX : NOTE_INK_LIMITS.boxMaxY))),
  }));
}
