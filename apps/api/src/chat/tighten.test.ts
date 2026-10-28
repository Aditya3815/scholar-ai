import { describe, expect, it } from "vitest";
import { MAX_TIGHTEN_ABSTRACT, MAX_TIGHTEN_PAPERS, MAX_TIGHTEN_TEXT } from "@scholar/shared";
import { readTighten } from "./tighten";

const abstract = "First sentence of the paper is here. Second sentence says the model reached ninety percent. Third sentence is a limitation.";
const good = () => ({ text: "The model reached 90 percent [1].", papers: [{ n: 1, title: "A paper", year: 2020, abstract }], citations: [{ n: 1, sentenceNo: 2 }] });

describe("readTighten", () => {
  it("reads a good request, tidies the answer's spaces and takes the shown sentence from the abstract by number", () => {
    const r = readTighten({ ...good(), text: "  The model   reached 90 percent [1].  " });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.text).toBe("The model reached 90 percent [1].");
    expect(r.input.picked[0]).toMatchObject({ n: 1 });
    expect(r.input.citations).toEqual([{ n: 1, paperId: "req:1", sentenceNo: 2, sentence: "Second sentence says the model reached ninety percent." }]);
  });
  it("ignores a sentence the browser sends: the words come from the abstract", () => {
    const r = readTighten({ ...good(), citations: [{ n: 1, sentenceNo: 2, sentence: "A made up sentence." }] });
    expect(r.ok && r.input.citations[0]!.sentence).toBe("Second sentence says the model reached ninety percent.");
  });
  it("refuses what is not an object, or has no answer, or one that is too long", () => {
    for (const bad of [null, undefined, 5, "x", [], {}, { ...good(), text: "" }, { ...good(), text: "   " }, { ...good(), text: 5 }, { ...good(), text: "x".repeat(MAX_TIGHTEN_TEXT + 1) }]) expect(readTighten(bad).ok).toBe(false);
    expect(readTighten({ ...good(), text: "x".repeat(MAX_TIGHTEN_TEXT) }).ok).toBe(true);
  });
  it("refuses missing, too many, repeated or badly numbered papers", () => {
    const p = (n: unknown) => ({ n, title: "t", year: 2020, abstract });
    for (const papers of [undefined, null, [], "x", {}, Array.from({ length: MAX_TIGHTEN_PAPERS + 1 }, (_, i) => p(i + 1)), [p(1), p(1)], [p(0)], [p(100)], [p(1.5)], [p("1")], [p(-1)], [null], [5]]) expect(readTighten({ ...good(), papers }).ok).toBe(false);
  });
  it("accepts the most papers it allows when a citation names one of them", () => {
    const papers = Array.from({ length: MAX_TIGHTEN_PAPERS }, (_, i) => ({ n: i + 1, title: "t", year: 2020, abstract }));
    expect(readTighten({ ...good(), papers }).ok).toBe(true);
  });
  it("refuses a paper with no abstract or one that is too long, and does not need a title or a year", () => {
    for (const abs of [undefined, null, "", "   ", 5, "x".repeat(MAX_TIGHTEN_ABSTRACT + 1)]) expect(readTighten({ ...good(), papers: [{ n: 1, title: "t", abstract: abs }] }).ok).toBe(false);
    const r = readTighten({ ...good(), papers: [{ n: 1, abstract }] });
    expect(r.ok && r.input.picked[0]!.paper).toMatchObject({ title: "", year: null });
  });
  it("cuts a long title, and takes a year only when it is a plausible one", () => {
    const r = readTighten({ ...good(), papers: [{ n: 1, title: "t".repeat(1000), year: 99999, abstract }] });
    expect(r.ok && r.input.picked[0]!.paper.title.length).toBe(400);
    expect(r.ok && r.input.picked[0]!.paper.year).toBeNull();
  });
  it("drops a citation that is not a sentence of that paper, a paper that is not there, a repeat, and anything that is not a whole number", () => {
    const r = readTighten({ ...good(), citations: [{ n: 1, sentenceNo: 2 }, { n: 1, sentenceNo: 2 }, { n: 1, sentenceNo: 99 }, { n: 1, sentenceNo: 0 }, { n: 1, sentenceNo: 1.5 }, { n: 7, sentenceNo: 1 }, { n: "1", sentenceNo: 1 }, null, 5, { n: 1, sentenceNo: 3 }] });
    expect(r.ok && r.input.citations.map((c) => c.sentenceNo)).toEqual([2, 3]);
  });
  it("refuses a request with no usable citation, and reads at most sixty of them", () => {
    for (const citations of [undefined, [], "x", [{ n: 1, sentenceNo: 99 }]]) expect(readTighten({ ...good(), citations }).ok).toBe(false);
    const many = Array.from({ length: 200 }, () => ({ n: 1, sentenceNo: 2 }));
    expect(readTighten({ ...good(), citations: many }).ok).toBe(true);
  });
  it("never throws on a request that is not of the shape", () => {
    for (const x of [{ papers: [{ n: 1, abstract: {} }] }, { text: "a", papers: [{ n: 1, abstract }], citations: [{ n: 1, sentenceNo: Number.NaN }] }, { text: "a", papers: [{ n: 1, abstract }], citations: [[], "x"] }]) expect(() => readTighten(x)).not.toThrow();
  });
});
