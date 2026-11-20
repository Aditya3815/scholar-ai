import { describe, expect, it } from "vitest";
import { HIGHLIGHTER_COLORS, PEN_COLORS } from "./ink";
import { NOTEBOOK_LIMITS, SPACE_H, checkNotebookBlocks, notebookMarkdown } from "./notebook";
import { mdPlain } from "./notebook-md";
import { NOTE_HIGHLIGHTER_COLORS, NOTE_INK_LIMITS, NOTE_PEN_COLORS, anchorQuote, checkNoteInk, mergeNoteInk, remapOffset, resolveAnchor, type NoteStroke } from "./notebook-ink";

const pen = (id: string, over: Partial<NoteStroke> = {}): NoteStroke => ({ id, tool: "pen", color: "ink", w: 14, a: { k: "text", b: "b1", at: 3, q: "word" }, pts: [0, 0, 50, 120, -40, 50], ...over });

describe("checkNoteInk", () => {
  it("keeps a valid stroke of each anchor and rebuilds it from its known fields", () => {
    const r = checkNoteInk([{ ...pen("s1"), extra: 1 }, pen("s2", { tool: "highlighter", color: "yellow", a: { k: "box", b: "sp1" }, pts: [100, 200, 50, 9000, 30000, 50] })]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.strokes).toEqual([pen("s1"), pen("s2", { tool: "highlighter", color: "yellow", a: { k: "box", b: "sp1" }, pts: [100, 200, 50, 9000, 30000, 50] })]);
  });
  it("refuses with 400 what is not valid, never drops it", () => {
    const bad: [unknown, RegExp][] = [
      [{}, /list/],
      [[pen("s 1")], /id/],
      [[pen("s1"), pen("s1")], /same id/],
      [[pen("s1", { tool: "shape" as never })], /tool/],
      [[pen("s1", { color: "yellow" })], /colour/],
      [[pen("s1", { tool: "highlighter", color: "violet" })], /colour/],
      [[pen("s1", { w: 0 })], /width/],
      [[pen("s1", { w: 1.5 })], /width/],
      [[pen("s1", { a: { k: "text", b: "b1", at: -1, q: "" } })], /offset/],
      [[pen("s1", { a: { k: "text", b: "b1", at: 1, q: "x".repeat(17) } })], /anchor text/],
      [[pen("s1", { a: { k: "pin", b: "b1" } as never })], /text or box/],
      [[pen("s1", { a: { k: "box", b: "../x" } })], /anchor/],
      [[pen("s1", { pts: [0, 0] })], /triples/],
      [[pen("s1", { pts: [0, 0, 0.5] })], /out of range/],
      [[pen("s1", { pts: [6001, 0, 50] })], /out of range/],
      [[pen("s1", { pts: [0, 4001, 50] })], /out of range/],
      [[pen("s1", { pts: [0, 0, 101] })], /out of range/],
      [[pen("s1", { a: { k: "box", b: "b1" }, pts: [10_501, 0, 50] })], /out of range/],
      [[pen("s1", { a: { k: "box", b: "b1" }, pts: [0, -501, 50] })], /out of range/],
    ];
    for (const [raw, why] of bad) {
      const r = checkNoteInk(raw);
      expect(r.ok, JSON.stringify(raw).slice(0, 80)).toBe(false);
      if (!r.ok) {
        expect(r.status).toBe(400);
        expect(r.reason).toMatch(why);
      }
    }
  });
  it("answers 413 for too many strokes, points or bytes", () => {
    const many = Array.from({ length: NOTE_INK_LIMITS.strokes + 1 }, (_, i) => pen(`s${i}`));
    expect(checkNoteInk(many)).toMatchObject({ ok: false, status: 413 });
    const long = pen("s1", { pts: Array.from({ length: (NOTE_INK_LIMITS.pointsPerStroke + 1) * 3 }, () => 1) });
    expect(checkNoteInk([long])).toMatchObject({ ok: false, status: 413 });
    const pts = Array.from({ length: 2000 * 3 }, () => 1);
    const page = Array.from({ length: 21 }, (_, i) => pen(`s${i}`, { pts }));
    expect(checkNoteInk(page)).toMatchObject({ ok: false, status: 413, reason: expect.stringMatching(/points/) });
    const big = Array.from({ length: 19 }, (_, i) => pen(`s${i}`, { pts: Array.from({ length: 2000 * 3 }, (_, k) => [-5999, -3999, 100][k % 3]!) }));
    expect(checkNoteInk(big)).toMatchObject({ ok: false, status: 413, reason: expect.stringMatching(/KB/) });
  });
  it("uses the paper's colour ids", () => {
    expect([...NOTE_PEN_COLORS]).toEqual(PEN_COLORS.map((c) => c.id));
    expect([...NOTE_HIGHLIGHTER_COLORS]).toEqual(HIGHLIGHTER_COLORS.map((c) => c.id));
  });
});

describe("the space block", () => {
  it("is a block kind with a height in ten-thousandths of the width", () => {
    expect(checkNotebookBlocks([{ id: "sp", kind: "space", h: 2500, x: 1 }], 10)).toEqual({ ok: true, blocks: [{ id: "sp", kind: "space", h: 2500 }] });
    expect(checkNotebookBlocks([{ id: "sp", kind: "space", h: SPACE_H.min - 1 }], 10).ok).toBe(false);
    expect(checkNotebookBlocks([{ id: "sp", kind: "space", h: 1.5 }], 10).ok).toBe(false);
    expect(NOTEBOOK_LIMITS.blocks).toBe(200);
  });
  it("says in Markdown what was drawn", () => {
    const md = notebookMarkdown(
      "P",
      [{ title: "One", blocks: [{ id: "t", kind: "text", md: "Hello" }, { id: "sp", kind: "space", h: 2000 }, { id: "e", kind: "space", h: 2000 }], ink: [{ a: { b: "t" } }, { a: { b: "t" } }, { a: { b: "sp" } }] }],
      { yellow: "Y", green: "G", blue: "B", pink: "P" },
    );
    expect(md).toContain("Hello\n\n*(Drawn on: 2 strokes)*");
    expect(md).toContain("*(A drawing: 1 stroke)*");
    expect(md.match(/A drawing/g)?.length).toBe(1);
  });
});

describe("mdPlain", () => {
  it("is the text of every token, in order, as the DOM has it", () => {
    expect(mdPlain("# Title\nSome **bold** and *it*\nnext line\n\n- one\n- ==two==\n\n3. three")).toBe("TitleSome bold and itnext lineonetwothree");
    expect(mdPlain("a \\*star\\* <u>u</u> ++v++")).toBe("a *star* u v");
    expect(mdPlain("")).toBe("");
  });
});

describe("anchors through an edit", () => {
  const before = "The baseline was strong";
  it("keeps an offset before the edit, and moves one after it", () => {
    const after = "The new baseline was strong";
    expect(remapOffset(before, after, 2)).toBe(2);
    expect(remapOffset(before, after, before.indexOf("baseline"))).toBe(after.indexOf("baseline"));
    expect(remapOffset(before, "The baseline was very strong", before.indexOf("strong"))).toBe("The baseline was very strong".indexOf("strong"));
  });
  it("puts a deleted word's anchor where the word was", () => {
    const after = "The was strong";
    expect(remapOffset(before, after, before.indexOf("line"))).toBe(4);
  });
  it("keeps an anchor inside replaced text", () => {
    expect(remapOffset("abcXYZdef", "abcQdef", 4)).toBe(3);
    expect(remapOffset("abcdef", "abcdef", 4)).toBe(4);
  });
  it("finds an anchor again by its quote when its offset drifted", () => {
    const text = "Intro words. The baseline was strong.";
    const at = text.indexOf("baseline");
    const q = anchorQuote(text, at);
    expect(q).toBe("baseline was str");
    const moved = `More at the start. ${text}`;
    expect(resolveAnchor(moved, at, q)).toBe(moved.indexOf("baseline"));
    expect(resolveAnchor(text, at, q)).toBe(at);
    expect(resolveAnchor("short", 40, "gone")).toBe(4);
    expect(resolveAnchor("", 3, "x")).toBe(-1);
  });
});

describe("mergeNoteInk", () => {
  it("keeps the server's, less what this window erased, with what it changed and added", () => {
    const base = [pen("a"), pen("b"), pen("c")];
    const server = [pen("a"), pen("b"), pen("c"), pen("s")];
    const mine = [pen("a", { pts: [1, 1, 50] }), pen("c"), pen("m")];
    expect(mergeNoteInk(server, base, mine).map((s) => s.id)).toEqual(["a", "c", "s", "m"]);
    expect(mergeNoteInk(server, base, mine)[0]!.pts).toEqual([1, 1, 50]);
    // erased on the server, untouched here: stays erased
    expect(mergeNoteInk([pen("a")], base, base).map((s) => s.id)).toEqual(["a"]);
  });
});
