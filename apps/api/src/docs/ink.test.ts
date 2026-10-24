import { describe, expect, it } from "vitest";
import { INK_LIMITS, apply, checkInk, eraseStrokes, emptyHistory, inkHex, record, redo, restoreStrokes, simplify, touches, undo, type InkStroke } from "@scholar/shared";

const stroke = (id: string, over: Partial<InkStroke> = {}): InkStroke => ({ id, page: 1, tool: "pen", color: "blue", w: 0.0034, pts: [0.1, 0.1, 0.5, 0.2, 0.1, 0.5, 0.3, 0.12, 0.5], ...over });

describe("checkInk", () => {
  it("accepts good strokes and rounds the numbers", () => {
    const r = checkInk([stroke("a", { pts: [0.123456, 0.987654, 0.555, 0.2, 0.2, 0.5] })], 3);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.strokes[0]!.pts).toEqual([0.1235, 0.9877, 0.56, 0.2, 0.2, 0.5]);
  });
  it("refuses what is not a list, and each kind of bad stroke, with a reason", () => {
    expect(checkInk("no", 3)).toMatchObject({ ok: false });
    expect(checkInk([null], 3)).toMatchObject({ ok: false });
    expect(checkInk([stroke("bad id!")], 3)).toMatchObject({ ok: false, reason: expect.stringMatching(/id/) });
    expect(checkInk([stroke("a"), stroke("a")], 3)).toMatchObject({ ok: false, reason: expect.stringMatching(/share an id/) });
    expect(checkInk([stroke("a", { page: 4 })], 3)).toMatchObject({ ok: false, reason: expect.stringMatching(/page/) });
    expect(checkInk([stroke("a", { page: 0 })], 3)).toMatchObject({ ok: false });
    expect(checkInk([stroke("a", { page: 1.5 })], 3)).toMatchObject({ ok: false });
    expect(checkInk([{ ...stroke("a"), tool: "marker" }], 3)).toMatchObject({ ok: false, reason: expect.stringMatching(/tool/) });
    expect(checkInk([stroke("a", { color: "yellow" })], 3)).toMatchObject({ ok: false, reason: expect.stringMatching(/colour/) }); // yellow is a highlighter colour, not a pen colour
    expect(checkInk([stroke("a", { tool: "highlighter", color: "yellow" })], 3).ok).toBe(true);
    expect(checkInk([stroke("a", { pts: [] })], 3)).toMatchObject({ ok: false });
    expect(checkInk([stroke("a", { pts: [0.1, 0.1] })], 3)).toMatchObject({ ok: false });
    expect(checkInk([stroke("a", { pts: [0.1, Number.NaN, 0.5] })], 3)).toMatchObject({ ok: false });
    expect(checkInk([stroke("a", { pts: [0.1, "x" as unknown as number, 0.5] })], 3)).toMatchObject({ ok: false });
    expect(checkInk([stroke("a", { w: Number.POSITIVE_INFINITY })], 3)).toMatchObject({ ok: false });
  });
  it("clamps width, position and pressure into range instead of trusting them", () => {
    const r = checkInk([stroke("a", { w: 5, pts: [9, 99, 7, -3, -3, -1] })], 3);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.strokes[0]!.w).toBe(INK_LIMITS.maxW);
      expect(r.strokes[0]!.pts).toEqual([1.05, INK_LIMITS.maxY, 1, -0.05, -0.05, 0]);
    }
  });
  it("enforces the limits: strokes, points in one stroke, points in all, bytes", () => {
    expect(checkInk(Array.from({ length: INK_LIMITS.strokes + 1 }, (_, i) => stroke(`s${i}`)), 3)).toMatchObject({ ok: false, reason: expect.stringMatching(/many/) });
    expect(checkInk([stroke("a", { pts: new Array((INK_LIMITS.pointsPerStroke + 1) * 3).fill(0.5) })], 3).ok).toBe(false);
    const long = new Array(INK_LIMITS.pointsPerStroke * 3).fill(0.5);
    const many = Array.from({ length: Math.ceil(INK_LIMITS.totalPoints / INK_LIMITS.pointsPerStroke) + 1 }, (_, i) => stroke(`s${i}`, { pts: long }));
    expect(checkInk(many, 3)).toMatchObject({ ok: false, reason: expect.stringMatching(/points/) });
  });
  it("an empty drawing is fine (everything erased)", () => {
    expect(checkInk([], 3)).toEqual({ ok: true, strokes: [] });
  });
  it("knows the colours", () => {
    expect(inkHex("pen", "red")).toBe("#d1342b");
    expect(inkHex("highlighter", "nonsense")).toBe("#ffd84d");
  });
});

describe("simplify", () => {
  it("keeps the ends and the bends, drops the middle of a straight run, keeps the pressure of what it keeps", () => {
    const pts = [0, 0, 0.1, 0.1, 0, 0.2, 0.2, 0, 0.3, 0.3, 0.2, 0.4, 0.3, 0.4, 0.5];
    expect(simplify(pts, 0.01)).toEqual([0, 0, 0.1, 0.2, 0, 0.3, 0.3, 0.2, 0.4, 0.3, 0.4, 0.5]);
  });
  it("leaves one or two points alone", () => {
    expect(simplify([0.1, 0.1, 0.5], 0.1)).toEqual([0.1, 0.1, 0.5]);
    expect(simplify([0, 0, 0.5, 1, 1, 0.5], 0.1)).toEqual([0, 0, 0.5, 1, 1, 0.5]);
  });
  it("a wobbly line becomes fewer points, a bigger epsilon fewer still", () => {
    const wobble = Array.from({ length: 200 }, (_, i) => [i / 200, 0.5 + Math.sin(i / 3) * 0.004, 0.5]).flat();
    const a = simplify(wobble, 0.0005).length / 3;
    const b = simplify(wobble, 0.004).length / 3;
    expect(a).toBeLessThan(200);
    expect(b).toBeLessThan(a);
  });
});

describe("touches (the stroke eraser)", () => {
  const line = stroke("l", { pts: [0.1, 0.5, 0.5, 0.9, 0.5, 0.5], w: 0.004 });
  it("is true near the line, anywhere along it, false away from it", () => {
    expect(touches(line, 0.5, 0.5, 0.01)).toBe(true);
    expect(touches(line, 0.5, 0.52, 0.01)).toBe(false);
    expect(touches(line, 0.5, 0.511, 0.01)).toBe(true);
    expect(touches(line, 0.95, 0.5, 0.01)).toBe(false);
    expect(touches(line, 0.1, 0.5, 0.001)).toBe(true);
  });
  it("counts the stroke's own half width", () => {
    const fat = stroke("f", { pts: [0.1, 0.5, 0.5, 0.9, 0.5, 0.5], w: 0.04 });
    expect(touches(fat, 0.5, 0.52, 0.001)).toBe(true);
    expect(touches(line, 0.5, 0.52, 0.001)).toBe(false);
  });
  it("works for a dot (one point)", () => {
    const dot = stroke("d", { pts: [0.3, 0.3, 0.5], w: 0.01 });
    expect(touches(dot, 0.305, 0.3, 0.002)).toBe(true);
    expect(touches(dot, 0.4, 0.3, 0.002)).toBe(false);
  });
});

describe("undo and redo", () => {
  const a = stroke("a");
  const b = stroke("b");
  const c = stroke("c");

  it("undoes and redoes drawing, in order", () => {
    let strokes: InkStroke[] = [];
    let h = emptyHistory();
    for (const s of [a, b]) {
      strokes = [...strokes, s];
      h = record(h, { type: "add", stroke: s });
    }
    const u1 = undo(h, strokes)!;
    expect(u1.strokes.map((s) => s.id)).toEqual(["a"]);
    const u2 = undo(u1.history, u1.strokes)!;
    expect(u2.strokes).toEqual([]);
    expect(undo(u2.history, u2.strokes)).toBeNull();
    const r1 = redo(u2.history, u2.strokes)!;
    expect(r1.strokes.map((s) => s.id)).toEqual(["a"]);
    const r2 = redo(r1.history, r1.strokes)!;
    expect(r2.strokes.map((s) => s.id)).toEqual(["a", "b"]);
    expect(redo(r2.history, r2.strokes)).toBeNull();
  });

  it("a new step after an undo throws the redo steps away", () => {
    let strokes = [a, b];
    let h = record(record(emptyHistory(), { type: "add", stroke: a }), { type: "add", stroke: b });
    const u = undo(h, strokes)!;
    strokes = [...u.strokes, c];
    h = record(u.history, { type: "add", stroke: c });
    expect(redo(h, strokes)).toBeNull();
    expect(strokes.map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("erasing several strokes is one step, and undo puts them back in their old places", () => {
    const start = [a, b, c];
    const { strokes, items } = eraseStrokes(start, new Set(["a", "c"]));
    expect(strokes.map((s) => s.id)).toEqual(["b"]);
    expect(items.map((i) => i.at)).toEqual([0, 2]);
    expect(restoreStrokes(strokes, items).map((s) => s.id)).toEqual(["a", "b", "c"]);
    const h = record(emptyHistory(), { type: "erase", items });
    const u = undo(h, strokes)!;
    expect(u.strokes.map((s) => s.id)).toEqual(["a", "b", "c"]);
    const r = redo(u.history, u.strokes)!;
    expect(r.strokes.map((s) => s.id)).toEqual(["b"]);
  });

  it("erasing something that is already gone changes nothing, and undoing a missing add is harmless", () => {
    expect(eraseStrokes([a], new Set(["zzz"])).strokes).toEqual([a]);
    expect(apply([], { type: "add", stroke: a }, "undo")).toEqual([]);
  });

  it("the history is bounded", () => {
    let h = emptyHistory();
    for (let i = 0; i < 500; i++) h = record(h, { type: "add", stroke: stroke(`s${i}`) });
    expect(h.done.length).toBe(200);
    expect(h.done[0]!.type === "add" && h.done[0]!.stroke.id).toBe("s300");
  });
});
