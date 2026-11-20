import { describe, expect, it } from "vitest";
import { CRITIQUE_KINDS, CRITIQUE_KIND_LABEL, CRITIQUE_POINT_LABEL, MEANING_NAMES, answerMarkdown, buildNotesDraft, citedPages, critiqueMarkdown, draftPages, type NotesHighlight } from "./reader-agents";
import { checkNotebookBlocks } from "./notebook";
import { NOTE_COLORS } from "./documents";

const cites = [{ n: 1, page: 3 }, { n: 2, page: 4 }, { n: 3, page: 3 }];

describe("an answer kept in the notes", () => {
  it("writes each run of marks as one bracket of pages, each page once, and leaves out a mark with no citation", () => {
    expect(answerMarkdown("Patches are linear [1][2]. Positions are learned [3].", cites)).toBe("Patches are linear (p. 3, 4). Positions are learned (p. 3).");
    expect(answerMarkdown("A claim [1] [3], and more [9].", cites)).toBe("A claim (p. 3), and more.");
    expect(answerMarkdown("Nothing cited.", [])).toBe("Nothing cited.");
    expect(answerMarkdown("x [1]", cites)).not.toMatch(/\[\d\]/);
  });
  it("is linear on a long run of spaces (no backtracking)", () => {
    const t = performance.now();
    answerMarkdown(`a${" ".repeat(50_000)}b [1]`, cites);
    expect(performance.now() - t).toBeLessThan(200);
  });
  it("lists the pages an answer cites, in order, each once", () => {
    expect(citedPages(cites)).toEqual([3, 4]);
  });
  it("a critique: each point with its kind, the passage and its page, and the label", () => {
    const md = critiqueMarkdown({ points: [{ kind: "missing_baseline", text: "No comparison with ResNet.", quote: "we compare with nothing", page: 5, idx: 9 }] });
    expect(md).toBe(`- **Missing baseline.** No comparison with ResNet.\n  “we compare with nothing” (p. 5)\n  *${CRITIQUE_POINT_LABEL}.*`);
    expect(Object.keys(CRITIQUE_KIND_LABEL).sort()).toEqual([...CRITIQUE_KINDS].sort());
  });
});

const h = (id: string, page: number, color: NotesHighlight["color"], quote: string, note = ""): NotesHighlight => ({ id, page, quote, note, color });
const HL = [h("a", 1, "yellow", "a pure transformer applied to patches"), h("b", 3, "green", "we split an image into fixed-size patches"), h("c", 4, "pink", "88.55% top-1 accuracy on ImageNet"), h("d", 6, "blue", "does it need large data?"), h("e", 2, "yellow", "inductive bias is weaker")];
let n = 0;
const id = () => `b${++n}`;

describe("the Note-taker's draft", () => {
  it("puts each bullet under the meaning of its first highlight, in the order Key idea, Method, Question, Result, with the pages written by the draft", () => {
    const raw = { bullets: [
      { text: "ViT uses a plain transformer on image patches [1]", from: [1, 5], quote: false },
      { text: "Images are cut into patches (p. 9)", from: [2], quote: false },
      { text: "", from: [3], quote: true },
      { text: "Open question about data", from: [4], quote: false },
    ] };
    const d = buildNotesDraft(HL, raw, MEANING_NAMES, id);
    const texts = d.blocks.filter((b) => b.kind === "text").map((b) => (b as { md: string }).md);
    expect(texts[0]).toBe("## Key idea\n- ViT uses a plain transformer on image patches (p. 1, 2)");
    expect(texts[1]).toBe("## Method\n- Images are cut into patches (p. 3)");
    expect(texts[2]).toBe("## Question\n- Open question about data (p. 6)");
    expect(texts[3]).toBe("## Result");
    const quote = d.blocks.find((b) => b.kind === "quote")!;
    expect(quote).toMatchObject({ kind: "quote", noteId: "c", page: 4, color: "pink" });
    expect(d.kept).toBe(4);
    expect(d.dropped).toBe(0);
  });

  it("keeps every highlight's page: a bullet naming no highlight is dropped, and a highlight no bullet used comes in as a quote", () => {
    const raw = { bullets: [{ text: "Invented point", from: [], quote: false }, { text: "Out of range", from: [42], quote: false }, { text: "x", from: [1], quote: false }, { text: "Patches", from: [2], quote: false }] };
    const d = buildNotesDraft(HL, raw, MEANING_NAMES, id);
    expect(d.dropped).toBe(3);
    expect(draftPages(d)).toEqual([...new Set(HL.map((x) => x.page))].sort((a, b) => a - b));
    expect(d.blocks.filter((b) => b.kind === "quote").map((b) => (b as { noteId: string }).noteId).sort()).toEqual(["a", "c", "d", "e"]);
  });

  it("makes a page of every highlight as a quote when the model gave nothing usable, and its blocks pass the notebook's checks", () => {
    for (const raw of [null, {}, { bullets: "x" }, { bullets: [5, null, { from: "1" }] }]) {
      const d = buildNotesDraft(HL, raw, MEANING_NAMES, id);
      expect(draftPages(d)).toEqual([1, 2, 3, 4, 6]);
      expect(checkNotebookBlocks(d.blocks, 10).ok).toBe(true);
    }
  });

  it("uses the reader's own names for the headings, and a bullet's text is one line with no heading or list sign the model wrote", () => {
    const names = { yellow: "Main point", green: "How", blue: "Ask", pink: "Found" };
    const d = buildNotesDraft(HL, { bullets: [{ text: "## - Big\nidea", from: [1], quote: false }] }, names, id);
    expect((d.blocks[0] as { md: string }).md).toBe("## Main point\n- Big idea (p. 1)");
  });

  it("knows the four colours in the order of their meanings", () => {
    expect(Object.keys(MEANING_NAMES)).toEqual([...NOTE_COLORS]);
  });
});
