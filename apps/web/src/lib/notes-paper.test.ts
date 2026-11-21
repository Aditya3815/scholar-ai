import { describe, expect, it, vi } from "vitest";
import { PDFPage } from "@cantoo/pdf-lib";
import type { NotebookBlock } from "@scholar/shared";
import { notesPdf } from "./notes-export";
import { PAPER, onLines, paperMarks } from "./notes-paper";

const box = { x: 56, y: 56, w: 483.28, h: 729.89 };

describe("a page's paper in the exports: where its lines and dots go", () => {
  it("ruled: a line at the foot of each line of text (21 pt, the screen's 28 px), across the text's width, none at the top", () => {
    const m = paperMarks("ruled", box);
    expect(m.lines).toHaveLength(34);
    expect(m.lines[0]).toEqual([56, 77, 539.28, 77]);
    expect(m.lines.every(([, y1, , y2]) => y1 === y2 && (y1 - 56) % PAPER.pitch === 0)).toBe(true);
    expect(m.lines.at(-1)![1]).toBeLessThanOrEqual(box.y + box.h);
    expect(m.dots).toHaveLength(0);
  });
  it("graph: squares a line high, whole squares only, inside the margins", () => {
    const m = paperMarks("grid", box);
    const h = m.lines.filter(([, y1, , y2]) => y1 === y2);
    const v = m.lines.filter(([x1, , x2]) => x1 === x2);
    expect(h).toHaveLength(35);
    expect(v).toHaveLength(24);
    expect(Math.max(...v.map(([x]) => x))).toBe(56 + 23 * 21);
    expect(Math.max(...h.map(([, y]) => y))).toBe(56 + 34 * 21);
    expect(m.lines.every(([x1, y1, x2, y2]) => [x1, x2].every((x) => x >= box.x && x <= box.x + box.w) && [y1, y2].every((y) => y >= box.y && y <= box.y + box.h))).toBe(true);
  });
  it("dotted: a dot at each corner of the squares; plain: nothing", () => {
    const m = paperMarks("dotted", box);
    expect(m.dots).toHaveLength(35 * 24);
    expect(m.dots[0]).toEqual([56, 56]);
    expect(m.lines).toHaveLength(0);
    expect(paperMarks("plain", box)).toMatchObject({ lines: [], dots: [] });
    expect(paperMarks(undefined, box)).toMatchObject({ lines: [], dots: [] });
  });
  it("a line of text takes whole lines of the paper, its letters in their middle", () => {
    expect(onLines(11)).toEqual({ lead: 21, off: expect.closeTo(7.69, 2) });
    expect(onLines(15).lead).toBe(21);
    // the title (18 pt) takes two, standing on the line between them, its tail clear of it
    expect(onLines(18)).toEqual({ lead: 42, off: 21 + 4.5 });
    // the letters (0.718 above the baseline, 0.207 below) are as far from the line above as from the line below
    const { lead, off } = onLines(11);
    expect(lead - (off + 0.718 * 11)).toBeCloseTo(off - 0.207 * 11, 6);
  });
});

describe("the PDF draws each page's paper behind its text", () => {
  const text = (id: string, md: string): NotebookBlock => ({ id, kind: "text", md });
  const names = { yellow: "Key idea", green: "Method", blue: "Question", pink: "Result" } as const;
  const quote: NotebookBlock = { id: "q", kind: "quote", noteId: null, page: 3, quote: "A network trained on 12,000 images", color: "yellow" };
  const pdfOf = (pages: { title: string; blocks: NotebookBlock[]; style?: "plain" | "ruled" | "dotted" | "grid" }[]) => notesPdf({ docTitle: "Paper", pages, names, pdf: null });

  it("each page of notes on a sheet of its own, with its own paper: graph lines, dots, nothing on plain", async () => {
    const lines = vi.spyOn(PDFPage.prototype, "drawLine");
    const dots = vi.spyOn(PDFPage.prototype, "drawCircle");
    const { PDFDocument } = await import("@cantoo/pdf-lib");
    const doc = await PDFDocument.load(await pdfOf([{ title: "G", style: "grid", blocks: [text("a", "one")] }, { title: "D", style: "dotted", blocks: [text("b", "two")] }, { title: "P", blocks: [text("c", "three")] }]));
    expect(doc.getPageCount()).toBe(3);
    expect(lines.mock.calls.length).toBe(35 + 24);
    expect(dots.mock.calls.length).toBe(35 * 24);
    expect(new Set(dots.mock.instances).size).toBe(1);
    lines.mockRestore();
    dots.mockRestore();
  });

  it("ruled: the paper is drawn before the text, and every line of text sits in the middle between two of its lines, across quotes and headings", async () => {
    const order: string[] = [];
    const rules: number[] = [];
    const bases: { y: number; size: number }[] = [];
    const line = vi.spyOn(PDFPage.prototype, "drawLine").mockImplementation(function (o) {
      order.push("line");
      rules.push(o.start.y);
    });
    const txt = vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (_t, o) {
      order.push("text");
      bases.push({ y: o!.y!, size: o!.size! });
    });
    await pdfOf([{ title: "Ruled", style: "ruled", blocks: [text("a", "# A heading\nA sentence that goes on for a while. ".repeat(6)), quote, text("b", "- one\n- two")] }]);
    expect(order.indexOf("text")).toBeGreaterThan(order.lastIndexOf("line"));
    expect(rules).toHaveLength(34);
    for (const b of bases) {
      const { lead, off } = onLines(b.size);
      const foot = b.y - off;
      expect(rules.some((r) => Math.abs(r - foot) < 1e-6), `a line of ${b.size} pt at ${b.y}`).toBe(true);
      expect(rules.some((r) => Math.abs(r - (foot + lead)) < 1e-6) || Math.abs(foot + lead - (841.89 - 56)) < 1e-6).toBe(true);
    }
    line.mockRestore();
    txt.mockRestore();
  });
});

describe("Word gets each page's paper as a picture behind its section", () => {
  it("a section a page, the graph page's header holding its paper (drawn once on a canvas), the plain page's an empty one", async () => {
    const { notesDocx } = await import("./notes-export");
    const { unzipSync, strFromU8 } = await import("fflate");
    const drawn = { lines: 0, dots: 0 };
    const ctx = { scale() {}, beginPath() {}, moveTo() {}, lineTo: () => drawn.lines++, arc: () => drawn.dots++, stroke() {}, fill() {}, strokeStyle: "", fillStyle: "", lineWidth: 0 };
    const canvas = { width: 0, height: 0, getContext: () => ctx, toBlob: (cb: (b: Blob) => void) => cb(new Blob([new Uint8Array([137, 80, 78, 71])])) };
    vi.stubGlobal("document", { createElement: () => canvas });
    try {
      const names = { yellow: "Key idea", green: "Method", blue: "Question", pink: "Result" } as const;
      const t = (id: string): NotebookBlock => ({ id, kind: "text", md: "words" });
      const blob = await notesDocx({ docTitle: "P", names, pdf: null, pages: [{ title: "G", style: "grid", blocks: [t("a")] }, { title: "N", style: "plain", blocks: [t("b")] }, { title: "G2", style: "grid", blocks: [t("c")] }] });
      const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
      expect(files["word/media/paper-grid.png"]).toBeDefined();
      // Word's margins (65.2 pt above and below, 56.7 at the sides): 33 squares down, 22 across
      expect(drawn.lines).toBe(34 + 23);
      expect(canvas.width).toBe(1191);
      const xml = strFromU8(files["word/document.xml"]!);
      expect([...xml.matchAll(/headerReference w:type="default" r:id="(rIdH\d)"/g)].map((m) => m[1])).toEqual(["rIdH1", "rIdH0", "rIdH1"]);
      expect(strFromU8(files["word/header1.xml"]!)).toContain('descr="Graph paper"');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
