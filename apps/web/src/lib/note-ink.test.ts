import { describe, expect, it } from "vitest";
import type { NotebookBlock, NoteStroke } from "@scholar/shared";
import { anchorStroke, eraseHits, inkPlainOf, nearestIndex, placeStroke, reattachOrphans, remapStrokes, sketchToInk, type BlockGeo, type Box, type PageGeo } from "./note-ink";
import { touchVerdict, PEN_SEEN_MS } from "./ink-input";

/**
 * The anchoring engine of ink on the pages of notes (docs/design/paper-reader.md, 25.13) against a fake layout: a monospace text, every character 8 px wide and every line 20 px high,
 * broken into lines of `cols` characters, blocks one under the other. The same text at two widths breaks in two places, as Split and the Notes view do.
 */
const CH = 8;
const LINE = 20;
const EM = 16;
function textBlock(id: string, text: string, top: number, cols: number, left = 40): { geo: BlockGeo; bottom: number } {
  // a character's box is its glyphs' height (14 px) inside its line (20 px), as the browser's are: there is room between two lines
  const box = (i: number): Box | null => (i < 0 || i >= text.length ? null : { left: left + (i % cols) * CH, top: top + Math.floor(i / cols) * LINE + 3, right: left + (i % cols) * CH + CH, bottom: top + Math.floor(i / cols) * LINE + 17 });
  const lines = Math.max(1, Math.ceil(text.length / cols));
  const bottom = top + lines * LINE;
  return {
    geo: { id, kind: "text", body: { left, top, right: left + cols * CH, bottom }, text: { len: text.length, box, nearest: (x, y) => nearestIndex(Array.from({ length: text.length }, (_, i) => box(i)), x, y) } },
    bottom,
  };
}
const TEXT = "The baseline sensitivity was strong in every district we visited and the follow up was long enough";
function page(cols: number, extra: BlockGeo[] = [], room = true): PageGeo {
  const a = textBlock("t1", TEXT, 0, cols);
  const blocks = [a.geo, ...extra.map((b) => ({ ...b, body: { ...b.body, top: b.body.top + a.bottom, bottom: b.body.bottom + a.bottom } }))];
  const end = blocks[blocks.length - 1]!.body.bottom;
  return { em: EM, blocks, room: room ? { left: 40, right: 40 + cols * CH, top: end, bottom: end + 300 } : null, maxRight: 40 + cols * CH + 14, minLeft: -14 };
}
const texts = new Map([["t1", TEXT]]);
const wordBox = (g: PageGeo, word: string): Box => {
  const t = g.blocks[0]!.text!;
  const i = TEXT.indexOf(word);
  const a = t.box(i)!;
  const b = t.box(i + word.length - 1)!;
  return { left: a.left, top: a.top, right: b.right, bottom: b.bottom };
};
const circle = (b: Box, pad = 6): number[] => {
  const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2, rx = (b.right - b.left) / 2 + pad, ry = (b.bottom - b.top) / 2 + pad;
  const pts: number[] = [];
  for (let k = 0; k <= 32; k++) pts.push(cx + Math.cos((k / 32) * Math.PI * 2) * rx, cy + Math.sin((k / 32) * Math.PI * 2) * ry, 0.5);
  return pts;
};
const centre = (pts: number[]) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    x0 = Math.min(x0, pts[i]!);
    x1 = Math.max(x1, pts[i]!);
    y0 = Math.min(y0, pts[i + 1]!);
    y1 = Math.max(y1, pts[i + 1]!);
  }
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0 };
};
const ids = { stroke: "s1", space: () => "sp1" };
const inside = (p: { x: number; y: number }, b: Box) => p.x >= b.left && p.x <= b.right && p.y >= b.top && p.y <= b.bottom;

describe("a stroke is attached to what lies under its middle", () => {
  it("a circle round a word: to a character of that word, and drawn round it again at another width", () => {
    const wide = page(60);
    const made = anchorStroke(circle(wordBox(wide, "district")), "pen", "ink", 0.14, wide, ids, texts)!;
    expect(made.stroke.a.k).toBe("text");
    const at = (made.stroke.a as { at: number }).at;
    expect(at).toBeGreaterThanOrEqual(TEXT.indexOf("district"));
    expect(at).toBeLessThan(TEXT.indexOf("district") + 8);
    expect((made.stroke.a as { q: string }).q).toBe(TEXT.slice(at, at + 16));
    expect(made.stroke.pts.every(Number.isInteger)).toBe(true);
    // a narrow column (a phone): "district" is on another line, the circle with it
    for (const cols of [60, 32, 18]) {
      const g = page(cols);
      const placed = placeStroke(made.stroke, g, texts)!;
      expect(inside(centre(placed.pts), wordBox(g, "district"))).toBe(true);
    }
  });
  it("an underline just below a word: to that word's line", () => {
    const g = page(60);
    const b = wordBox(g, "strong");
    const under = [b.left, b.bottom + 2, 0.5, b.right, b.bottom + 2, 0.5];
    const made = anchorStroke(under, "pen", "ink", 0.14, g, ids, texts)!;
    const at = (made.stroke.a as { at: number }).at;
    expect(TEXT.slice(at - 3, at + 4)).toContain(TEXT.slice(at, at + 1));
    expect(at).toBeGreaterThanOrEqual(TEXT.indexOf("strong") - 1);
    expect(at).toBeLessThanOrEqual(TEXT.indexOf("strong") + 6);
  });
  it("a mark in the right margin: to the last character of its line", () => {
    const g = page(30);
    const tick = [40 + 30 * CH + 6, 26, 0.5, 40 + 30 * CH + 10, 34, 0.5];
    const made = anchorStroke(tick, "pen", "red", 0.14, g, ids, texts)!;
    expect((made.stroke.a as { at: number }).at).toBe(59); // the second line's last character
  });
  it("below the last block: a new space there, tall enough for the stroke and an em", () => {
    const g = page(60);
    const room = g.room!;
    const made = anchorStroke([60, room.top + 20, 0.5, 200, room.top + 80, 0.5], "pen", "ink", 0.14, g, ids, texts)!;
    expect(made.stroke.a).toEqual({ k: "box", b: "sp1" });
    expect(made.ask.space).toEqual({ id: "sp1", h: Math.ceil(((80 + EM) / (60 * CH)) * 10_000) });
    // and a stroke under a space that is the last block makes it taller, not a second one
    const sp: BlockGeo = { id: "sp0", kind: "space", body: { left: 40, top: 0, right: 40 + 60 * CH, bottom: 100 } };
    const g2 = page(60, [sp]);
    const grown = anchorStroke([60, g2.room!.top + 10, 0.5, 90, g2.room!.top + 60, 0.5], "pen", "ink", 0.14, g2, ids, texts)!;
    expect(grown.stroke.a).toEqual({ k: "box", b: "sp0" });
    expect(grown.ask.grow?.id).toBe("sp0");
  });
  it("over a picture: to the block's box, by fractions of its width, and scaled with it", () => {
    const pic: BlockGeo = { id: "img", kind: "image", body: { left: 40, top: 0, right: 440, bottom: 200 }, text: null };
    const g = page(50, [pic], false);
    const top = g.blocks[1]!.body.top;
    const made = anchorStroke([140, top + 50, 0.5, 240, top + 100, 0.5], "highlighter", "yellow", 0.75, g, ids, texts)!;
    expect(made.stroke.a).toEqual({ k: "box", b: "img" });
    expect(made.stroke.pts.slice(0, 2)).toEqual([2500, 1250]);
    const half: PageGeo = { ...g, blocks: [g.blocks[0]!, { ...pic, body: { left: 40, top, right: 240, bottom: top + 100 } }] };
    expect(placeStroke(made.stroke, half)!.pts.slice(0, 2)).toEqual([90, top + 25]);
  });
  it("a stroke wider than the column is moved left to fit, never scaled", () => {
    const g = page(60);
    const b = wordBox(g, "enough");
    const long = [b.left, b.top + 10, 0.5, b.left + 300, b.top + 10, 0.5];
    const made = anchorStroke(long, "pen", "ink", 0.14, g, ids, texts)!;
    const narrow = page(40);
    const placed = placeStroke(made.stroke, narrow, texts)!;
    const c = centre(placed.pts);
    expect(Math.round(c.w)).toBe(300);
    expect(Math.max(placed.pts[0]!, placed.pts[3]!) + placed.w / 2).toBeLessThanOrEqual(narrow.maxRight + 0.01);
  });
});

describe("the strokes of a page through changes", () => {
  const s = (at: number, b = "t1"): NoteStroke => ({ id: `s${at}`, tool: "pen", color: "ink", w: 14, a: { k: "text", b, at, q: TEXT.slice(at, at + 16) }, pts: [0, 0, 50] });
  it("text typed before a word: the anchor moves with it; nothing typed: no change", () => {
    const at = TEXT.indexOf("district");
    const now = `New words first. ${TEXT}`;
    const out = remapStrokes([s(at)], texts, new Map([["t1", now]]))!;
    expect((out[0]!.a as { at: number }).at).toBe(now.indexOf("district"));
    expect(remapStrokes([s(at)], texts, texts)).toBeNull();
  });
  it("a block gone (another window): its strokes go to the block before it, and are counted", () => {
    const blocks: NotebookBlock[] = [{ id: "a", kind: "text", md: "First block" }, { id: "c", kind: "space", h: 2000 }];
    const r = reattachOrphans([s(3, "b"), s(1, "a")], ["a", "b", "c"], blocks);
    expect(r.moved).toBe(1);
    expect(r.strokes[0]!.a).toEqual({ k: "text", b: "a", at: 10, q: "k" });
    const r2 = reattachOrphans([{ ...s(3, "x"), a: { k: "box", b: "x" } }], ["c", "x"], blocks);
    expect(r2.strokes[0]!.a).toEqual({ k: "box", b: "c" });
  });
  it("the eraser takes the strokes it touches, their half width counted", () => {
    const g = page(60);
    const made = anchorStroke(circle(wordBox(g, "district")), "pen", "ink", 0.14, g, ids, texts)!;
    const placed = [placeStroke(made.stroke, g, texts)!];
    const p = placed[0]!.pts;
    expect(eraseHits(placed, p[0]!, p[1]!, 2)).toEqual(["s1"]);
    expect(eraseHits(placed, p[0]! + 100, p[1]! + 100, 2)).toEqual([]);
  });
  it("an old sketch's strokes become ink on the space in its place, the same fractions of the width", () => {
    const ink = sketchToInk("k", [{ id: "a", tool: "pen", color: "blue", w: 0.0034, pts: [0.1, 0.25, 0.5, 0.5, 1.2, 1] }]);
    expect(ink).toEqual([{ id: "a", tool: "pen", color: "blue", w: 34, a: { k: "box", b: "k" }, pts: [1000, 2500, 50, 5000, 12000, 100] }]);
  });
  it("a block's plain text is what the page puts into the DOM; a picture has none", () => {
    expect(inkPlainOf({ id: "a", kind: "text", md: "# Head\nSome **bold**" })).toBe("HeadSome bold");
    expect(inkPlainOf({ id: "q", kind: "quote", noteId: null, page: 1, quote: "a passage", color: "pink" })).toBe("“a passage”");
    expect(inkPlainOf({ id: "s", kind: "space", h: 900 })).toBeNull();
  });
});

describe("the palm rule (lib/ink-input.ts, one copy for the paper and the notes)", () => {
  it("a second finger is a pinch; a finger draws only with Finger on, and not within 4 s of a stylus", () => {
    expect(touchVerdict(2, true, -Infinity, 0)).toBe("pinch");
    expect(touchVerdict(1, false, -Infinity, 0)).toBe("finger-off");
    expect(touchVerdict(1, true, 1000, 1000 + PEN_SEEN_MS - 1)).toBe("palm");
    expect(touchVerdict(1, true, 1000, 1000 + PEN_SEEN_MS)).toBe("draw");
  });
});
