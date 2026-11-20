import { describe, expect, it } from "vitest";
import { MAX_CRITIQUE_POINTS, draftPages, type AskStreamEvent, type DocNote } from "@scholar/shared";
import { hashEmbedder } from "./testing/embed";
import { stubComplete, stubStream } from "./testing/stub";
import type { Complete, StoredChunk } from "./qa";
import { CRITIQUE_SYSTEM, EXPLAIN_SYSTEM, NOTES_SYSTEM, critique, critiqueOutcome, critiquePassages, critiqueStream, draftNotes, explain, explainPassages, explainQuestion, explainStream, notesNames, selectionInPaper, verifyCritique } from "./agents";

const chunks: StoredChunk[] = [
  { idx: 0, page: 1, text: "Abstract. We study glaucoma screening with deep learning on retinal photographs from one country.", embedding: null },
  { idx: 1, page: 2, text: "Participants were recruited from three hospitals in Pune between 2019 and 2021.", embedding: null },
  { idx: 2, page: 3, text: "Patch embedding maps each image patch to a vector with a single linear layer.", embedding: null },
  { idx: 3, page: 3, text: "Position embeddings are added so that the order of the patches is kept.", embedding: null },
  { idx: 4, page: 4, text: "Our model reached a sensitivity of 0.87 and clearly outperforms every earlier method.", embedding: null },
  { idx: 5, page: 5, text: "A limitation is that all images came from a single camera model.", embedding: null },
  { idx: 6, page: 6, text: "Future work will test the model in primary care clinics.", embedding: null },
];
const meta = { id: "a", createdAt: 1 };
const reply = (json: unknown): Complete => async () => ({ json, model: "test" });

describe("Explain: is the selection from this paper", () => {
  it("finds a selection of four words or more as a quote, near its page, and a short one as its words in a row", () => {
    expect(selectionInPaper("each image patch to a vector", 3, chunks)).toBe(true);
    expect(selectionInPaper("each image patch to a vector", 4, chunks)).toBe(true); // the page next to it
    expect(selectionInPaper("each image patch to a vector", 6, chunks)).toBe(false); // too far from its page
    expect(selectionInPaper("each image patch to a vector", null, chunks)).toBe(true);
    expect(selectionInPaper("Patch embedding", 3, chunks)).toBe(true);
    expect(selectionInPaper("transformer encoder blocks with attention", 3, chunks)).toBe(false);
    expect(selectionInPaper("quantum", null, chunks)).toBe(false);
    expect(selectionInPaper("  ", null, chunks)).toBe(false);
  });
});

describe("Explain: the passages it reads start from the selection's page", () => {
  it("takes the passage the selection is in and the ones on either side, then the best matches, in reading order", () => {
    const ex = explainPassages({ selection: "Position embeddings are added", page: 3, idea: "" }, null, chunks, 4);
    expect(ex.map((c) => c.idx)).toEqual(expect.arrayContaining([2, 3, 4]));
    expect(ex).toHaveLength(4);
    expect(ex.map((c) => c.idx)).toEqual([...ex.map((c) => c.idx)].sort((a, b) => a - b));
  });
  it("with no selection, the passages that best match the idea", () => {
    const ex = explainPassages({ selection: "", page: null, idea: "patch embedding linear layer" }, null, chunks, 2);
    expect(ex.map((c) => c.idx)).toContain(2);
  });
  it("says what it explains in its question line", () => {
    expect(explainQuestion({ selection: "a b c", page: 3, idea: "" })).toBe('Explain in plain words this passage of page 3: "a b c"');
    expect(explainQuestion({ selection: "a b c", page: null, idea: "why?" })).toBe('Explain in plain words this passage: "a b c". The reader asks: why?');
    expect(explainQuestion({ selection: "", page: null, idea: "attention" })).toBe("Explain in plain words: attention");
  });
});

describe("Explain: the answer must cite pages, and the quote check runs", () => {
  it("streams its stages and ends with an answer whose every quote was found in the passages read", async () => {
    const events: AskStreamEvent[] = [];
    const a = await explainStream({ ask: { selection: "Position embeddings are added", page: 3, idea: "" }, chunks, embed: hashEmbedder, stream: stubStream, meta, emit: (e) => void events.push(e) });
    expect(events[0]).toEqual({ type: "stage", stage: "retrieving" });
    expect(events[1]).toMatchObject({ type: "sources" });
    expect((events[1] as { pages: number[] }).pages).toContain(3);
    expect(a).toMatchObject({ found: true, verified: true });
    expect(a.citations.length).toBeGreaterThan(0);
    expect(a.answer).toMatch(/\[\d\]/);
  });
  it("uses its own system prompt and label", async () => {
    let seen: { system: string; label?: string } | null = null;
    const spy: Complete = async (req) => ((seen = req), stubComplete(req));
    await explain({ ask: { selection: "", page: null, idea: "patch embedding" }, chunks, embed: hashEmbedder, complete: spy, meta });
    expect(seen!.system).toBe(EXPLAIN_SYSTEM);
    expect(seen!.label).toBe("doc_explain");
  });
  it("an invented quote is not a citation, its mark goes, and the answer is not called verified", async () => {
    const a = await explain({ ask: { selection: "", page: null, idea: "patch embedding" }, chunks, embed: hashEmbedder, complete: reply({ found: true, answer: "It is magic [1].", evidence: [{ excerpt: 1, quote: "magic happens inside the network every time" }] }), meta });
    expect(a.citations).toEqual([]);
    expect(a.verified).toBe(false);
    expect(a.answer).not.toMatch(/\[\d\]/);
  });
});

describe("Critique: a point without a checked quote never survives", () => {
  const ex = chunks.slice(0, 6).map((c) => ({ ...c, score: 1 }));
  it("keeps a point whose quote is in the passage it names, with that page", () => {
    const c = verifyCritique({ points: [{ kind: "overclaim", text: "One number cannot carry “clearly outperforms every earlier method”.", excerpt: 5, quote: "clearly outperforms every earlier method" }] }, ex, "", meta);
    expect(c.points).toEqual([{ kind: "overclaim", text: "One number cannot carry “clearly outperforms every earlier method”.", quote: "clearly outperforms every earlier method", page: 4, idx: 4 }]);
    expect(c.dropped).toBe(0);
  });
  it("drops a point with an invented quote, an unknown kind, no words, or no quote; counts each", () => {
    const c = verifyCritique(
      {
        points: [
          { kind: "overclaim", text: "Invented.", excerpt: 1, quote: "this sentence is not anywhere in the paper at all" },
          { kind: "rude", text: "Bad kind.", excerpt: 2, quote: "Participants were recruited from three hospitals" },
          { kind: "thin_evidence", text: "", excerpt: 2, quote: "Participants were recruited from three hospitals" },
          { kind: "thin_evidence", text: "No quote.", excerpt: 2 },
          "not an object",
        ],
      },
      ex,
      "",
      meta,
    );
    expect(c.points).toEqual([]);
    expect(c.dropped).toBe(5);
    expect(critiqueOutcome(c)).toBe("critique_all_dropped");
  });
  it("keeps a point whose quote is in another passage than the one it names (a wrong number), with the page where it is", () => {
    const c = verifyCritique({ points: [{ kind: "limitation_stated", text: "One camera.", excerpt: 1, quote: "all images came from a single camera model" }] }, ex, "", meta);
    expect(c.points[0]).toMatchObject({ page: 5, idx: 5 });
  });
  it("keeps at most the limit, a quote once, and takes the marks out of a point's words", () => {
    const many = Array.from({ length: 12 }, () => ({ kind: "thin_evidence", text: "Thin [2].", excerpt: 2, quote: "Participants were recruited from three hospitals in Pune" }));
    const c = verifyCritique({ points: many }, ex, "", meta);
    expect(c.points).toHaveLength(1);
    expect(c.points[0]!.text).toBe("Thin.");
    const distinct = verifyCritique({ points: chunks.slice(0, 6).flatMap((ch, i) => [{ kind: "thin_evidence", text: `Point ${i}`, excerpt: i + 1, quote: ch.text.split(" ").slice(0, 6).join(" ") }, { kind: "overclaim", text: `Other ${i}`, excerpt: i + 1, quote: ch.text.split(" ").slice(1, 7).join(" ") }]) }, ex, "", meta);
    expect(distinct.points).toHaveLength(MAX_CRITIQUE_POINTS);
  });
  it("says how it ended: points, all dropped, or none written", () => {
    expect(critiqueOutcome({ ...meta, focus: "", points: [], dropped: 0 })).toBe("critique_none");
    expect(critiqueOutcome({ ...meta, focus: "", points: [{ kind: "overclaim", text: "x", quote: "y", page: 1, idx: 0 }], dropped: 3 })).toBe("critique_points");
  });
});

describe("Critique: the passages and the stream", () => {
  it("reads the paper's opening and a passage for each kind of weak point, or the focus", () => {
    const all = critiquePassages("", [], chunks, 8);
    expect(all[0]!.idx).toBe(0);
    expect(all.map((c) => c.idx)).toContain(5); // limitations
    expect(all.length).toBeLessThanOrEqual(8);
    const focus = critiquePassages("recruited hospitals participants", [null], chunks, 2);
    expect(focus.map((c) => c.idx)).toContain(1);
    expect(focus).toHaveLength(2);
  });
  it("streams retrieving, the pages, thinking, writing, checking, never any text, and ends with checked points (the stand-in's invented one dropped)", async () => {
    const events: AskStreamEvent[] = [];
    const c = await critiqueStream({ focus: "", chunks, embed: hashEmbedder, stream: stubStream, meta, emit: (e) => void events.push(e) });
    const kinds = events.map((e) => (e.type === "stage" ? `stage:${e.stage}` : e.type));
    expect(kinds).toEqual(["stage:retrieving", "sources", "stage:thinking", "stage:writing", "stage:checking"]);
    expect(c.points.length).toBe(3);
    expect(c.dropped).toBe(1);
    for (const p of c.points) expect(chunks.some((ch) => ch.page === p.page && ch.text.includes(p.quote))).toBe(true);
  });
  it("uses its own system prompt and label; a focus the stand-in cannot critique gives no point", async () => {
    let seen: { system: string; label?: string } | null = null;
    const spy: Complete = async (req) => ((seen = req), stubComplete(req));
    const c = await critique({ focus: "an unanswerable focus", chunks, embed: hashEmbedder, complete: spy, meta });
    expect(seen!.system).toBe(CRITIQUE_SYSTEM);
    expect(seen!.label).toBe("doc_critique");
    expect(c).toMatchObject({ focus: "an unanswerable focus", points: [], dropped: 0 });
  });
});

describe("the Note-taker: a draft page made only from the highlights", () => {
  const n = (id: string, page: number, color: DocNote["color"], quote: string, note = ""): DocNote => ({ id, page, quote, note, color, createdAt: 1, updatedAt: 1 });
  const notes = [n("h1", 1, "yellow", "a pure transformer applied to sequences of image patches"), n("h2", 3, "green", "we split an image into fixed-size patches", "the key step"), n("h3", 4, "pink", "88.55% top-1 accuracy on ImageNet")];
  it("keeps every highlight's page, links its quotes to the highlights, and drops the stand-in's bullet that names none", async () => {
    let seen: { system: string; user: string; label?: string } | null = null;
    const spy: Complete = async (req) => ((seen = req), stubComplete(req));
    const r = await draftNotes({ notes, legend: { yellow: "yellow", green: "green", blue: "blue", pink: "pink" }, complete: spy });
    expect(seen!.system).toBe(NOTES_SYSTEM);
    expect(seen!.label).toBe("doc_notes");
    expect(seen!.user).toContain("Reader's note: the key step");
    expect(draftPages(r.draft)).toEqual([1, 3, 4]);
    expect(r.dropped).toBe(1);
    expect(r.draft.blocks.filter((b) => b.kind === "quote").map((b) => (b as { noteId: string }).noteId)).toEqual(["h2"]);
    expect(r.draft.blocks[0]).toMatchObject({ kind: "text", md: "## Key idea\n- In short: a pure transformer applied to sequences of image (p. 1)" });
    expect(r).toMatchObject({ used: 3, total: 3 });
  });
  it("names the headings by the meanings, or by the reader's own names for their colours", () => {
    expect(notesNames({ yellow: "yellow", green: "green", blue: "blue", pink: "pink" }).yellow).toBe("Key idea");
    expect(notesNames({ yellow: "Big", green: "How", blue: "Hmm", pink: "Got" }).green).toBe("How");
  });
});
