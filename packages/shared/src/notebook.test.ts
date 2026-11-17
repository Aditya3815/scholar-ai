import { describe, expect, it } from "vitest";
import { NOTE_COLORS } from "./documents";
import {
  MAX_NOTEBOOK_BODY,
  NOTEBOOK_KINDS_NOW,
  NOTEBOOK_LIMITS,
  QUOTE_COLORS,
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

const text = (id: string, md = "Some words"): NotebookBlock => ({ id, kind: "text", md });
const quote = (id: string, over: Record<string, unknown> = {}) => ({ id, kind: "quote", noteId: "n1", page: 2, quote: "a passage of the paper", color: "green", ...over });

describe("the Notebook's checks (shared by the page and the server)", () => {
  it("the four quote colours are the stored highlight colours", () => {
    expect([...QUOTE_COLORS]).toEqual([...NOTE_COLORS]);
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
    expect(bad([{ id: "a", kind: "image", src: "x" }])).toMatch(/^400 a block's kind/);
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

  it("refuses a capture and an answer in phase 2, and checks them for phase 3", () => {
    const capture = { id: "c", kind: "capture", page: 3, x: 0.1, y: 0.2, w: 0.5, h: 0.3 };
    const answer = { id: "a", kind: "answer", agent: "Explain", text: "It means…", pages: [1, 4] };
    expect([...NOTEBOOK_KINDS_NOW]).toEqual(["text", "quote"]);
    for (const b of [capture, answer]) {
      const r = checkNotebookBlocks([b], 10);
      expect(r.ok === false && r.status === 400 && /not accepted yet/.test(r.reason)).toBe(true);
    }
    const all = ["text", "quote", "capture", "answer"] as const;
    expect(checkNotebookBlocks([capture, answer], 10, all)).toEqual({ ok: true, blocks: [capture, answer] });
    expect(checkNotebookBlocks([{ ...capture, x: 0.8, w: 0.5 }], 10, all).ok).toBe(false);
    expect(checkNotebookBlocks([{ ...capture, w: 0 }], 10, all).ok).toBe(false);
    expect(checkNotebookBlocks([{ ...answer, pages: [11] }], 10, all).ok).toBe(false);
    expect(checkNotebookBlocks([{ ...answer, agent: "" }], 10, all).ok).toBe(false);
  });

  it("every limit: 200 blocks, 8,000 characters of text, 600 of a quote, 48 KB a page (413 for each)", () => {
    const many = Array.from({ length: NOTEBOOK_LIMITS.blocks }, (_, i) => text(`b${i}`, "x"));
    expect(checkNotebookBlocks(many, 10).ok).toBe(true);
    const tooMany = checkNotebookBlocks([...many, text("one-more")], 10);
    expect(tooMany.ok === false && tooMany.status).toBe(413);
    expect(checkNotebookBlocks([text("t", "x".repeat(NOTEBOOK_LIMITS.text))], 10).ok).toBe(true);
    const long = checkNotebookBlocks([text("t", "x".repeat(NOTEBOOK_LIMITS.text + 1))], 10);
    expect(long.ok === false && long.status).toBe(413);
    const longQ = checkNotebookBlocks([quote("q", { quote: "y".repeat(NOTEBOOK_LIMITS.quote + 1) })], 10);
    expect(longQ.ok === false && longQ.status).toBe(413);
    // seven full text blocks are about 56 KB: over the page's 48 KB
    const big = checkNotebookBlocks(Array.from({ length: 7 }, (_, i) => text(`t${i}`, "z".repeat(8000))), 10);
    expect(big.ok === false && big.status === 413 && /48 KB/.test(big.reason)).toBe(true);
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
