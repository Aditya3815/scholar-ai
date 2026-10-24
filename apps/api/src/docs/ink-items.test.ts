import { describe, expect, it } from "vitest";
import {
  INK_LIMITS, STICKY_SIDE, arrowHead, mergeItems, TEXT_SIZES, checkInk, clampMove, emptyHistory, inLasso, inPolygon, itemBounds, moveItem, record, redo, replaceItems, shapeOutline, touchesItem, undo,
  type InkItem, type InkShape, type InkSticky, type InkStroke, type InkText,
} from "@scholar/shared";

const shape = (id: string, kind: InkShape["kind"], over: Partial<InkShape> = {}): InkShape => ({ id, page: 1, tool: "shape", kind, color: "red", w: 0.004, pts: [0.2, 0.2, 0.5, 0.6, 0.5, 0.5], ...over });
const text = (id: string, over: Partial<InkText> = {}): InkText => ({ id, page: 1, tool: "text", color: "ink", x: 0.1, y: 0.1, w: 0.3, h: 0.05, size: TEXT_SIZES.m, text: "Check this table", ...over });
const sticky = (id: string, over: Partial<InkSticky> = {}): InkSticky => ({ id, page: 1, tool: "sticky", color: "yellow", x: 0.8, y: 0.2, text: "ask the supervisor", ...over });
const pen = (id: string, over: Partial<InkStroke> = {}): InkStroke => ({ id, page: 1, tool: "pen", color: "blue", w: 0.0034, pts: [0.1, 0.1, 0.5, 0.2, 0.1, 0.5, 0.3, 0.12, 0.5], ...over });

describe("checkInk: shapes, text boxes and sticky notes", () => {
  it("accepts each kind and keeps its fields, rounded", () => {
    const r = checkInk([shape("a", "arrow"), shape("b", "ellipse"), text("t", { x: 0.123456, size: 0.0191234 }), sticky("s")], 3);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.strokes.map((i) => i.tool)).toEqual(["shape", "shape", "text", "sticky"]);
      expect((r.strokes[0] as InkShape).kind).toBe("arrow");
      expect((r.strokes[2] as InkText).x).toBe(0.1235);
      expect((r.strokes[2] as InkText).size).toBe(0.0191);
    }
  });
  it("refuses a shape of an unknown kind, with the wrong number of points, or a colour its tool does not have", () => {
    expect(checkInk([shape("a", "star" as never)], 3)).toMatchObject({ ok: false, reason: expect.stringMatching(/shape/) });
    expect(checkInk([shape("a", "rect", { pts: [0.1, 0.1, 0.5] })], 3)).toMatchObject({ ok: false });
    expect(checkInk([shape("a", "rect", { pts: [0.1, 0.1, 0.5, 0.2, 0.2, 0.5, 0.3, 0.3, 0.5] })], 3)).toMatchObject({ ok: false, reason: expect.stringMatching(/two points/) });
    expect(checkInk([shape("a", "rect", { color: "yellow" })], 3)).toMatchObject({ ok: false, reason: expect.stringMatching(/colour/) }); // yellow is a highlighter colour
    expect(checkInk([sticky("s", { color: "red" })], 3)).toMatchObject({ ok: false, reason: expect.stringMatching(/colour/) }); // red is a pen colour
    expect(checkInk([text("t", { color: "yellow" })], 3)).toMatchObject({ ok: false });
  });
  it("refuses a text box with no words or no size, and a note with no position", () => {
    expect(checkInk([text("t", { text: "   " })], 3)).toMatchObject({ ok: false, reason: expect.stringMatching(/empty/) });
    expect(checkInk([text("t", { w: "x" as never })], 3)).toMatchObject({ ok: false });
    expect(checkInk([{ ...sticky("s"), x: "left" }], 3)).toMatchObject({ ok: false });
    expect(checkInk([{ ...sticky("s"), text: 5 }], 3)).toMatchObject({ ok: false });
  });
  it("a sticky note may be empty (it is a place to write), a text box may not", () => {
    expect(checkInk([sticky("s", { text: "" })], 3).ok).toBe(true);
  });
  it("clamps position, size and font size; cuts text to the limit; keeps line breaks; drops control characters", () => {
    const r = checkInk([text("t", { x: 9, y: 99, w: 9, h: 9, size: 9, text: "a\nb\tc\u0000d\u0007" + "x".repeat(INK_LIMITS.textChars) })], 3);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const t = r.strokes[0] as InkText;
      expect(t.x).toBe(1.05);
      expect(t.y).toBe(INK_LIMITS.maxY);
      expect(t.w).toBe(1.1);
      expect(t.size).toBe(0.08);
      expect(t.text.startsWith("a\nb\tcd")).toBe(true);
      expect(t.text).toHaveLength(INK_LIMITS.textChars);
    }
  });
  it("limits how many text boxes and notes there can be", () => {
    const many = Array.from({ length: INK_LIMITS.texts + 1 }, (_, i) => sticky(`s${i}`));
    expect(checkInk(many, 3)).toMatchObject({ ok: false, reason: expect.stringMatching(/many/) });
    expect(checkInk(many.slice(0, INK_LIMITS.texts), 3).ok).toBe(true);
  });
  it("the same checks as before still apply to every kind: id, page, duplicates", () => {
    expect(checkInk([text("t", { page: 9 })], 3)).toMatchObject({ ok: false, reason: expect.stringMatching(/page/) });
    expect(checkInk([text("t"), sticky("t")], 3)).toMatchObject({ ok: false, reason: expect.stringMatching(/share an id/) });
    expect(checkInk([{ ...text("t"), id: "bad id!" }], 3)).toMatchObject({ ok: false });
  });
  it("mixed lists keep their order", () => {
    const r = checkInk([pen("p"), text("t"), shape("s", "line"), sticky("n")], 3);
    expect(r.ok && r.strokes.map((i) => i.id)).toEqual(["p", "t", "s", "n"]);
  });
});

describe("geometry", () => {
  it("shapeOutline: a line is two points, a rectangle closes on itself, an ellipse is a closed round shape", () => {
    expect(shapeOutline(shape("a", "line"))).toEqual([[0.2, 0.2], [0.6, 0.5]]);
    const rect = shapeOutline(shape("a", "rect"));
    expect(rect).toHaveLength(5);
    expect(rect[0]).toEqual(rect[4]);
    const ell = shapeOutline(shape("a", "ellipse"));
    expect(ell[0]![0]).toBeCloseTo(ell[48]![0], 9);
    expect(Math.max(...ell.map((p) => p[0]))).toBeCloseTo(0.6, 6);
    expect(Math.min(...ell.map((p) => p[1]))).toBeCloseTo(0.2, 6);
  });
  it("itemBounds: text and notes use their box, a line its ends plus half its width", () => {
    expect(itemBounds(text("t"))).toEqual({ x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.15000000000000002 });
    expect(itemBounds(sticky("s"))).toEqual({ x0: 0.8, y0: 0.2, x1: 0.8 + STICKY_SIDE, y1: 0.2 + STICKY_SIDE });
    const b = itemBounds(shape("a", "line"));
    expect(b.x0).toBeCloseTo(0.2 - 0.002, 9);
    expect(b.y1).toBeCloseTo(0.5 + 0.002, 9);
  });
  it("touchesItem: a rectangle is touched on its edge, not in the middle; a text box anywhere in it", () => {
    const rect = shape("a", "rect", { pts: [0.2, 0.2, 0.5, 0.6, 0.5, 0.5] });
    expect(touchesItem(rect, 0.4, 0.2, 0.01)).toBe(true); // on the top edge
    expect(touchesItem(rect, 0.4, 0.4, 0.01)).toBe(false); // in the middle
    expect(touchesItem(text("t"), 0.2, 0.12, 0)).toBe(true);
    expect(touchesItem(text("t"), 0.6, 0.12, 0.01)).toBe(false);
    expect(touchesItem(sticky("s"), 0.81, 0.21, 0)).toBe(true);
    expect(touchesItem(pen("p"), 0.2, 0.1, 0.005)).toBe(true);
  });
  it("inPolygon uses the even-odd rule", () => {
    const sq: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    expect(inPolygon(sq, 0.5, 0.5)).toBe(true);
    expect(inPolygon(sq, 1.5, 0.5)).toBe(false);
  });
  it("inLasso: a text box by its middle, a line when at least half of it is inside", () => {
    const around: [number, number][] = [[0.05, 0.05], [0.5, 0.05], [0.5, 0.3], [0.05, 0.3]];
    expect(inLasso(text("t"), around)).toBe(true);
    expect(inLasso(sticky("s"), around)).toBe(false);
    expect(inLasso(pen("p"), around)).toBe(true);
    expect(inLasso(pen("p", { pts: [0.3, 0.1, 0.5, 0.9, 0.1, 0.5, 0.95, 0.1, 0.5] }), around)).toBe(false); // one point in, two out
    expect(inLasso(text("t"), [[0, 0], [1, 1]])).toBe(false); // two points are not an area
  });
  it("moveItem moves every kind and rounds; the original is untouched", () => {
    const p = pen("p");
    const moved = moveItem(p, 0.123456, -0.05);
    expect(moved.pts.slice(0, 3)).toEqual([0.2235, 0.05, 0.5]);
    expect(p.pts[0]).toBe(0.1);
    expect(moveItem(text("t"), 0.1, 0.1)).toMatchObject({ x: 0.2, y: 0.2, text: "Check this table" });
    expect(moveItem(sticky("s"), -0.1, 0)).toMatchObject({ x: 0.7 });
    expect(moveItem(shape("a", "rect"), 0.1, 0.1).pts).toEqual([0.3, 0.3, 0.5, 0.7, 0.6, 0.5]);
  });
  it("clampMove keeps a moved group on the page, as one group", () => {
    const items: InkItem[] = [text("t"), sticky("s")]; // from x 0.1 to 0.8 + side
    const c = clampMove(items, 0.5, -0.5);
    expect(0.8 + STICKY_SIDE + c.dx).toBeLessThanOrEqual(1.02 + 1e-9);
    expect(0.1 + c.dy).toBeGreaterThanOrEqual(-0.02 - 1e-9);
    expect(clampMove(items, 0.01, 0.01)).toEqual({ dx: 0.01, dy: 0.01 });
    expect(clampMove([], 1, 1)).toEqual({ dx: 0, dy: 0 });
  });
});

describe("mergeItems", () => {
  it("keeps what the server has and adds what is new here", () => {
    const a = pen("a"), b = pen("b"), c = pen("c");
    expect(mergeItems([a, b], [b, c]).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
  it("does not bring back what was erased elsewhere: an item the reader already knew of, that the server no longer has", () => {
    const a = pen("a"), b = pen("b"), c = pen("c");
    // the reader saw a and b; another window erased b; the reader drew c here
    expect(mergeItems([a], [a, b, c], ["a", "b"]).map((i) => i.id)).toEqual(["a", "c"]);
  });
  it("the server's version of an item that both have wins", () => {
    expect((mergeItems([pen("a", { color: "red" })], [pen("a", { color: "green" })])[0] as InkStroke).color).toBe("red");
  });
  it("is the server's drawing when there is nothing new here", () => {
    const a = pen("a");
    expect(mergeItems([a], [a])).toEqual([a]);
    expect(mergeItems([a], [])).toEqual([a]);
    expect(mergeItems([], [a])).toEqual([a]);
  });
  it("never goes past the limit", () => {
    const many = Array.from({ length: INK_LIMITS.strokes }, (_, i) => pen(`s${i}`));
    expect(mergeItems(many, [pen("extra")])).toHaveLength(INK_LIMITS.strokes);
  });
});

describe("arrowHead", () => {
  it("has its tip at the end, two corners behind it on either side, and the line stops short of the tip", () => {
    const h = arrowHead([0, 0], [1, 0], 0.004);
    expect(h.tip).toEqual([1, 0]);
    expect(h.left[0]).toBeCloseTo(h.right[0], 9);
    expect(h.left[0]).toBeLessThan(1);
    expect(h.left[1]).toBeCloseTo(-h.right[1], 9);
    expect(h.stop[0]).toBeLessThan(1);
    expect(h.stop[0]).toBeGreaterThan(h.left[0]);
  });
  it("points the right way for a line at any angle, and a very short arrow has a small head", () => {
    const h = arrowHead([0, 0], [0, 1], 0.004);
    expect(h.left[1]).toBeLessThan(1);
    expect(Math.abs(h.left[0] + h.right[0])).toBeLessThan(1e-9);
    const tiny = arrowHead([0, 0], [0.01, 0], 0.01);
    expect(1 - 0 > 0 && tiny.tip[0] - tiny.left[0]).toBeLessThanOrEqual(0.005 + 1e-9);
  });
  it("does not divide by zero for a point", () => {
    expect(arrowHead([0.5, 0.5], [0.5, 0.5], 0.004).left).toEqual([0.5, 0.5]);
  });
});

describe("undo and redo of an edit", () => {
  it("an edit step goes back and forth, in place, and several items move as one step", () => {
    const a = pen("a"), b = text("b"), c = sticky("c");
    const start: InkItem[] = [a, b, c];
    const after = [moveItem(a, 0.1, 0.1), moveItem(b, 0.1, 0.1)];
    const now = replaceItems(start, after);
    expect(now.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect((now[0] as InkStroke).pts[0]).toBe(0.2);
    const h = record(emptyHistory(), { type: "edit", before: [a, b], after });
    const u = undo(h, now)!;
    expect((u.strokes[0] as InkStroke).pts[0]).toBe(0.1);
    expect((u.strokes[1] as InkText).x).toBe(0.1);
    const r = redo(u.history, u.strokes)!;
    expect((r.strokes[1] as InkText).x).toBe(0.2);
    expect(r.strokes[2]).toBe(c);
  });
  it("replaceItems ignores an item that is gone, so an undo after an erase cannot bring it back by accident", () => {
    expect(replaceItems([pen("a")], [text("zzz")]).map((i) => i.id)).toEqual(["a"]);
  });
});
