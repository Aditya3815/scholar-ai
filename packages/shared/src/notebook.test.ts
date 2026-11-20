import { describe, expect, it } from "vitest";
import { NOTE_COLORS } from "./documents";
import { HIGHLIGHTER_COLORS, PEN_COLORS } from "./ink";
import {
  MAX_NOTEBOOK_BODY,
  NOTEBOOK_KINDS_NOW,
  NOTEBOOK_LIMITS,
  QUOTE_COLORS,
  SKETCH_HIGHLIGHTER_COLORS,
  SKETCH_PEN_COLORS,
  checkNotebookBlocks,
  cleanBlockText,
  cleanNotebookTitle,
  isNotebookId,
  isNotebookPosition,
  isNotebookStyle,
  notebookBytes,
  notebookMarkdown,
  type NotebookBlock,
} from "./notebook";
import { nextPageName, pageLabel } from "./notebook-names";

const text = (id: string, md = "Some words"): NotebookBlock => ({ id, kind: "text", md });
const quote = (id: string, over: Record<string, unknown> = {}) => ({ id, kind: "quote", noteId: "n1", page: 2, quote: "a passage of the paper", color: "green", ...over });

describe("the Notebook's checks (shared by the page and the server)", () => {
  it("the four quote colours are the stored highlight colours", () => {
    expect([...QUOTE_COLORS]).toEqual([...NOTE_COLORS]);
  });

  it("a sketch's colours are the reader's pen and highlighter colours", () => {
    expect([...SKETCH_PEN_COLORS]).toEqual(PEN_COLORS.map((c) => c.id));
    expect([...SKETCH_HIGHLIGHTER_COLORS]).toEqual(HIGHLIGHTER_COLORS.map((c) => c.id));
  });

  it("ids: 1 to 40 characters of [A-Za-z0-9_-]", () => {
    for (const ok of ["a", "abc_DEF-123", "x".repeat(40)]) expect(isNotebookId(ok), ok).toBe(true);
    for (const bad of ["", "x".repeat(41), "has space", "slash/", "dot.", "ü", 7, null, undefined]) expect(isNotebookId(bad), String(bad)).toBe(false);
  });

  it("titles are one line of at most 120 characters; styles are the four; a position is any finite number", () => {
    expect(cleanNotebookTitle("  Methods\n and\tresults  ")).toBe("Methods and results");
    expect(cleanNotebookTitle("x".repeat(200))).toHaveLength(NOTEBOOK_LIMITS.title);
    expect(cleanNotebookTitle(5)).toBeNull();
    expect(["plain", "ruled", "dotted", "grid"].every(isNotebookStyle)).toBe(true);
    expect(isNotebookStyle("lined")).toBe(false);
    expect(isNotebookPosition(1.5) && isNotebookPosition(-3)).toBe(true);
    for (const bad of [Number.NaN, Infinity, "1", null, 1e13]) expect(isNotebookPosition(bad)).toBe(false);
  });

  it("accepts text and quote blocks and rebuilds them from their known fields only", () => {
    const r = checkNotebookBlocks([{ ...text("t1", "Line one\r\nLine two\u0000"), extra: "dropped" }, quote("q1", { quote: "  a  passage\n of the paper " })], 10);
    expect(r).toEqual({ ok: true, blocks: [{ id: "t1", kind: "text", md: "Line one\nLine two" }, { id: "q1", kind: "quote", noteId: "n1", page: 2, quote: "a passage of the paper", color: "green" }] });
    expect(checkNotebookBlocks([quote("q2", { noteId: null })], 10)).toMatchObject({ ok: true, blocks: [{ noteId: null }] });
    expect(checkNotebookBlocks([], 10)).toEqual({ ok: true, blocks: [] });
  });

  it("refuses anything outside the union with 400, saying what is wrong (never dropped silently)", () => {
    const bad = (blocks: unknown, maxPage = 10) => {
      const r = checkNotebookBlocks(blocks, maxPage);
      return r.ok ? null : `${r.status} ${r.reason}`;
    };
    expect(bad("nope")).toMatch(/^400 blocks must be a list/);
    expect(bad([null])).toMatch(/^400 a block is not an object/);
    expect(bad([[1]])).toMatch(/^400 a block is not an object/);
    expect(bad([{ kind: "text", md: "x" }])).toMatch(/^400 a block's id/);
    expect(bad([{ id: "a b", kind: "text", md: "x" }])).toMatch(/^400 a block's id/);
    expect(bad([{ id: "a", kind: "video", src: "x" }])).toMatch(/^400 a block's kind/);
    expect(bad([{ id: "a", kind: "text" }])).toMatch(/^400 a text block has no text/);
    expect(bad([text("a"), text("a")])).toMatch(/^400 two blocks have the same id/);
    expect(bad([quote("q", { page: 0 })])).toMatch(/^400 a quote's page/);
    expect(bad([quote("q", { page: 11 })])).toMatch(/^400 a quote's page/);
    expect(bad([quote("q", { page: 2.5 })])).toMatch(/^400 a quote's page/);
    expect(bad([quote("q", { color: "magenta" })])).toMatch(/^400 a quote's colour/);
    expect(bad([quote("q", { noteId: "bad id" })])).toMatch(/^400 a quote's highlight id/);
    expect(bad([quote("q", { noteId: undefined })])).toMatch(/^400 a quote's highlight id/);
    expect(bad([quote("q", { quote: "   " })])).toMatch(/^400 a quote is empty/);
    expect(bad([quote("q", { quote: 5 })])).toMatch(/^400 a quote has no text/);
  });

  it("phase 3 takes every kind: a capture, a sketch and an agent's answer; a kind a caller does not accept is still refused", () => {
    const capture = { id: "c", kind: "capture", page: 3, x: 0.1, y: 0.2, w: 0.5, h: 0.3, caption: "Figure 1", size: "m" };
    const sketch = { id: "s", kind: "sketch", height: 240, strokes: [{ id: "k1", tool: "pen", color: "blue", w: 0.004, pts: [0.1, 0.1, 0.5, 0.2, 0.3, 0.5] }] };
    const agent = { id: "a", kind: "agent", agent: "explain", ask: "the patch embedding", md: "It means… (p. 1, 4)", pages: [1, 4], at: 1_763_500_000_000 };
    expect([...NOTEBOOK_KINDS_NOW]).toEqual(["text", "quote", "capture", "sketch", "image", "agent"]);
    expect(checkNotebookBlocks([capture, sketch, agent], 10)).toEqual({ ok: true, blocks: [capture, sketch, agent] });
    const r = checkNotebookBlocks([agent], 10, ["text", "quote"]);
    expect(r.ok === false && r.status === 400 && /not accepted yet/.test(r.reason)).toBe(true);
  });

  it("an agent's answer: one of the three agents, what it was asked (one line, at most 600), its Markdown (at most 8,000, not empty), pages of this paper each once, a time", () => {
    const agent = { id: "a", kind: "agent", agent: "critique", ask: "  the\n methods ", md: "- **Thin evidence.** Only one site.\n  “one hospital” (p. 2)", pages: [2], at: 5 };
    expect(checkNotebookBlocks([agent], 10)).toEqual({ ok: true, blocks: [{ ...agent, ask: "the methods" }] });
    const bad = (b: Record<string, unknown>) => {
      const r = checkNotebookBlocks([{ ...agent, ...b }], 10);
      return r.ok ? "ok" : `${r.status} ${r.reason}`;
    };
    expect(bad({ agent: "Explain" })).toMatch(/^400 an answer's agent/);
    expect(bad({ agent: "notes" })).toMatch(/^400 an answer's agent/);
    expect(bad({ ask: undefined })).toMatch(/^400 an answer has no question/);
    expect(bad({ ask: "q".repeat(NOTEBOOK_LIMITS.ask + 1) })).toMatch(/^413 too long/);
    expect(bad({ md: "  " })).toMatch(/^400 an answer is empty/);
    expect(bad({ md: 4 })).toMatch(/^400 an answer has no text/);
    expect(bad({ md: "m".repeat(NOTEBOOK_LIMITS.answer + 1) })).toMatch(/^413 too long/);
    expect(bad({ pages: [11] })).toMatch(/^400 an answer's pages/);
    expect(bad({ pages: [2, 2] })).toMatch(/^400 an answer names a page twice/);
    expect(bad({ pages: Array.from({ length: NOTEBOOK_LIMITS.answerPages + 1 }, (_, i) => i + 1) })).toMatch(/^400 an answer's pages/);
    expect(bad({ at: -1 })).toMatch(/^400 an answer's time/);
    expect(bad({ at: 1.5 })).toMatch(/^400 an answer's time/);
    // only its known fields come back
    const more = checkNotebookBlocks([{ ...agent, extra: "<script>" }], 10);
    expect(more.ok && Object.keys(more.blocks[0]!).sort()).toEqual(["agent", "ask", "at", "id", "kind", "md", "pages"]);
  });

  it("a capture: inside its page, a caption of at most 500 characters (cleaned), a size of s, m or full", () => {
    const capture = { id: "c", kind: "capture", page: 3, x: 0.1, y: 0.2, w: 0.5, h: 0.3, caption: "  Figure\n 1 ", size: "full" };
    expect(checkNotebookBlocks([capture], 10)).toEqual({ ok: true, blocks: [{ ...capture, caption: "Figure 1" }] });
    for (const bad of [{ x: 0.8, w: 0.5 }, { w: 0 }, { page: 11 }, { size: "xl" }, { caption: undefined }, { y: -0.1 }]) expect(checkNotebookBlocks([{ ...capture, ...bad }], 10).ok).toBe(false);
    const long = checkNotebookBlocks([{ ...capture, caption: "c".repeat(NOTEBOOK_LIMITS.caption + 1) }], 10);
    expect(long.ok === false && long.status).toBe(413);
    // only its known fields come back
    expect(checkNotebookBlocks([{ ...capture, png: "data:..." }], 10)).toEqual({ ok: true, blocks: [{ ...capture, caption: "Figure 1" }] });
  });

  it("a sketch: a height of 120 to 800, pen and highlighter strokes in their colours, every point inside, at most 400 strokes and 20,000 points", () => {
    const stroke = (id: string, more: Record<string, unknown> = {}) => ({ id, tool: "pen", color: "ink", w: 0.004, pts: [0.1, 0.1, 0.5, 0.9, 1.4, 0.5], ...more });
    const sketch = (strokes: unknown[], height = 240) => ({ id: "s", kind: "sketch", height, strokes });
    expect(checkNotebookBlocks([sketch([stroke("a"), stroke("b", { tool: "highlighter", color: "yellow", w: 0.03 })])], 10).ok).toBe(true);
    for (const h of [119, 801, 240.5]) expect(checkNotebookBlocks([sketch([], h)], 10).ok).toBe(false);
    for (const bad of [{ tool: "eraser" }, { color: "yellow" }, { w: 0 }, { w: 0.2 }, { pts: [0.1, 0.1] }, { pts: [1.2, 0.1, 0.5] }, { pts: [0.1, -0.1, 0.5] }, { pts: [0.1, 0.1, 2] }, { id: "bad id" }])
      expect(checkNotebookBlocks([sketch([stroke("a", bad)])], 10).ok).toBe(false);
    const tooMany = checkNotebookBlocks([sketch(Array.from({ length: NOTEBOOK_LIMITS.sketchStrokes + 1 }, (_, i) => stroke(`k${i}`)))], 10);
    expect(tooMany.ok === false && tooMany.status).toBe(413);
    const pts = Array.from({ length: 3 * 10_001 }, (_, i) => (i % 3 === 2 ? 0.5 : 0.25));
    const tooLong = checkNotebookBlocks([sketch([stroke("a", { pts }), stroke("b", { pts })])], 10);
    expect(tooLong.ok === false && tooLong.status).toBe(413);
  });

  it("every limit: 200 blocks, 8,000 characters of text, 600 of a quote, 128 KB a page (413 for each)", () => {
    const many = Array.from({ length: NOTEBOOK_LIMITS.blocks }, (_, i) => text(`b${i}`, "x"));
    expect(checkNotebookBlocks(many, 10).ok).toBe(true);
    const tooMany = checkNotebookBlocks([...many, text("one-more")], 10);
    expect(tooMany.ok === false && tooMany.status).toBe(413);
    expect(checkNotebookBlocks([text("t", "x".repeat(NOTEBOOK_LIMITS.text))], 10).ok).toBe(true);
    const long = checkNotebookBlocks([text("t", "x".repeat(NOTEBOOK_LIMITS.text + 1))], 10);
    expect(long.ok === false && long.status).toBe(413);
    const longQ = checkNotebookBlocks([quote("q", { quote: "y".repeat(NOTEBOOK_LIMITS.quote + 1) })], 10);
    expect(longQ.ok === false && longQ.status).toBe(413);
    // seventeen full text blocks are about 136 KB: over the page's 128 KB
    const big = checkNotebookBlocks(Array.from({ length: 17 }, (_, i) => text(`t${i}`, "z".repeat(8000))), 10);
    expect(big.ok === false && big.status === 413 && /128 KB/.test(big.reason)).toBe(true);
    // bytes, not characters: Devanagari is three bytes a letter
    expect(notebookBytes([text("t", "क".repeat(100))])).toBeGreaterThan(300);
    expect(MAX_NOTEBOOK_BODY).toBeGreaterThan(NOTEBOOK_LIMITS.pageBytes);
  });

  it("cleans a text block's line ends and control characters, and nothing else", () => {
    expect(cleanBlockText("a\r\nb\rc\td\u0007e  f")).toBe("a\nb\nc\tde  f");
  });
});

describe("notebookMarkdown", () => {
  const names = { yellow: "Key idea", green: "Method", blue: "Question", pink: "Result" } as const;
  it("writes the paper's title, each page under its heading, quotes with their meaning and page", () => {
    const md = notebookMarkdown("Vision  Transformers", [
      { title: "Methods", blocks: [text("t", "# Patches\nPatch embedding is **linear**."), { id: "q", kind: "quote", noteId: null, page: 4, quote: "split an image into patches", color: "yellow" }] },
      { title: "", blocks: [] },
    ], names);
    expect(md).toBe("# Vision Transformers\n\n## Methods\n\n### Patches\nPatch embedding is **linear**.\n\n> split an image into patches\n> (Key idea, p. 4)\n\n## Untitled page\n");
  });
});

describe("page names (the notes polish of 19 Nov)", () => {
  it("shows a page's title, or Page N by its place when it has none (an old 'Untitled page' counts as none)", () => {
    expect(pageLabel("Methods", 0)).toBe("Methods");
    expect(pageLabel("", 2)).toBe("Page 3");
    expect(pageLabel("   ", 0)).toBe("Page 1");
    expect(pageLabel("Untitled page", 4)).toBe("Page 5");
  });
  it("names a new page Page N, the next number no page shows", () => {
    expect(nextPageName([])).toBe("Page 1");
    expect(nextPageName(["Notes"])).toBe("Page 2");
    expect(nextPageName(["Notes", "Page 3"])).toBe("Page 4");
    expect(nextPageName(["Page 2", "Page 3", "Page 4"])).toBe("Page 5");
    expect(nextPageName(["Page 1", "Results"])).toBe("Page 3");
  });
});

describe("notebookMarkdown: an agent's answer (phase 3)", () => {
  const names = { yellow: "Key idea", green: "Method", blue: "Question", pink: "Result" } as const;
  it("writes the small header with its pages, what it was asked, and the answer with its pages", () => {
    const md = notebookMarkdown("P", [{ title: "Notes", blocks: [{ id: "a", kind: "agent", agent: "explain", ask: "patch embedding", md: "It cuts the image into squares (p. 3).", pages: [4, 3], at: 1 }] }], names);
    expect(md).toBe("# P\n\n## Notes\n\nExplain · p. 3, 4\n*Explained: patch embedding*\n\nIt cuts the image into squares (p. 3).\n");
    const ask = notebookMarkdown("P", [{ title: "Notes", blocks: [{ id: "a", kind: "agent", agent: "ask", ask: "", md: "# Big\nNo page.", pages: [], at: 1 }] }], names);
    expect(ask).toBe("# P\n\n## Notes\n\nAsk\n\n### Big\nNo page.\n");
  });
});

describe("a picture's width (20 Nov 2026)", () => {
  const img = { id: "i", kind: "image", w: 800, h: 600, type: "image/png", alt: "a chart" };
  it("is a fraction of the page from 0.2 to 1, kept to three places, and left out when not set", () => {
    expect(checkNotebookBlocks([img], 10)).toEqual({ ok: true, blocks: [img] });
    expect(checkNotebookBlocks([{ ...img, width: 0.45678 }], 10)).toEqual({ ok: true, blocks: [{ ...img, width: 0.457 }] });
    for (const width of [0.1, 1.2, "0.5", Number.NaN, null]) expect(checkNotebookBlocks([{ ...img, width }], 10).ok, String(width)).toBe(false);
  });
  it("is said in the Markdown when the picture is narrower than the page", () => {
    const names = { yellow: "Key idea", green: "Method", blue: "Question", pink: "Result" } as const;
    expect(notebookMarkdown("P", [{ title: "N", blocks: [{ ...img, kind: "image", type: "image/png", width: 0.5 } as never] }], names)).toContain("*A picture*: a chart (shown at 50% of the page's width)");
    expect(notebookMarkdown("P", [{ title: "N", blocks: [img as never] }], names)).toContain("*A picture*: a chart\n");
  });
});
