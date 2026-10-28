import { describe, expect, it } from "vitest";
import { applyTighten, canTighten, failTighten, startAssistant, startTighten, tightenRequestFor, trimForStorage, MAX_TIGHTEN_PAPERS, type AssistantMsg, type Paper, type TightenResponse } from "@scholar/shared";

const ABSTRACT = "First sentence of the paper is here. Second sentence says the model reached ninety percent. Third sentence is a limitation.";
const paper = (i: number, over: Partial<Paper> = {}): Paper => ({
  id: `doi:10.1/${i}`, doi: `10.1/${i}`, pmid: null, title: `Paper ${i}`, authors: ["A. B"], year: 2020, venue: "J", abstract: ABSTRACT,
  citationCount: 1, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 1, ...over,
});
const done = (over: Partial<AssistantMsg> = {}): AssistantMsg => ({
  ...startAssistant("a1", "q", 1),
  status: "done", step: null, papersFinal: true, papers: [paper(1), paper(2), paper(3)],
  answer: { text: "It reached 90 percent [1]. It was limited [2].", grounded: true, checked: true, leftOut: 0, citations: [
    { n: 1, paperId: "doi:10.1/1", sentenceNo: 2, sentence: "Second sentence says the model reached ninety percent." },
    { n: 2, paperId: "doi:10.1/2", sentenceNo: 3, sentence: "Third sentence is a limitation." },
  ] },
  ...over,
});

describe("canTighten: only an answer that can honestly be checked again", () => {
  it("is true for a finished answer that was read claim by claim, with its abstracts", () => expect(canTighten(done())).toBe(true));
  it("is false while the reply is still working, stopped, or failed", () => {
    for (const status of ["working", "stopped", "error", "interrupted"] as const) expect(canTighten(done({ status }))).toBe(false);
  });
  it("is false with no answer, an answer that is not grounded, or one that was not read claim by claim (the judge failed or was off)", () => {
    expect(canTighten(done({ answer: null }))).toBe(false);
    expect(canTighten(done({ answer: { ...done().answer!, grounded: false } }))).toBe(false);
    expect(canTighten(done({ answer: { ...done().answer!, checked: false } }))).toBe(false);
    expect(canTighten(done({ answer: { ...done().answer!, checked: undefined } }))).toBe(false);
  });
  it("is false once the answer was checked strictly, and while a strict check is running", () => {
    expect(canTighten(done({ answer: { ...done().answer!, strict: true } }))).toBe(false);
    expect(canTighten(startTighten(done()))).toBe(false);
  });
  it("is true again after a strict check failed", () => expect(canTighten(failTighten(done(), "x"))).toBe(true));
  it("is false when a cited paper has no abstract, or one that was cut for keeping (a reopened conversation)", () => {
    expect(canTighten(done({ papers: [paper(1, { abstract: null }), paper(2), paper(3)] }))).toBe(false);
    expect(canTighten(done({ papers: [paper(1), paper(2, { abstract: "   " }), paper(3)] }))).toBe(false);
    const kept = trimForStorage(done({ papers: [paper(1, { abstract: "x ".repeat(500) }), paper(2, { abstract: "y ".repeat(500) }), paper(3)] }));
    expect(kept.papers[0]!.abstract!.endsWith("…")).toBe(true);
    expect(canTighten(kept)).toBe(false);
  });
  it("is true when only a paper that was not cited has no abstract", () => expect(canTighten(done({ papers: [paper(1), paper(2), paper(3, { abstract: null })] }))).toBe(true));
  it("is false when a citation points at another paper than the one in that place, or at a place with no paper", () => {
    expect(canTighten(done({ papers: [paper(9), paper(2), paper(3)] }))).toBe(false);
    expect(canTighten(done({ papers: [paper(1)] }))).toBe(false);
  });
  it("is false for an answer too long, or one from too many papers, for the server to read", () => {
    expect(canTighten(done({ answer: { ...done().answer!, text: "x".repeat(2001) } }))).toBe(false);
    const n = MAX_TIGHTEN_PAPERS + 1;
    const papers = Array.from({ length: n }, (_, i) => paper(i + 1));
    const citations = papers.map((p, i) => ({ n: i + 1, paperId: p.id, sentenceNo: 2, sentence: "x" }));
    expect(canTighten(done({ papers, answer: { text: "a [1]", grounded: true, checked: true, citations } }))).toBe(false);
  });
  it("is false for an answer with no citation", () => expect(canTighten(done({ answer: { ...done().answer!, citations: [] } }))).toBe(false));
});

describe("tightenRequestFor", () => {
  it("sends the answer, the cited papers (not the others) with their abstracts, and which sentences were shown", () => {
    const r = tightenRequestFor(done())!;
    expect(r.text).toBe("It reached 90 percent [1]. It was limited [2].");
    expect(r.papers.map((p) => p.n)).toEqual([1, 2]);
    expect(r.papers[0]).toEqual({ n: 1, title: "Paper 1", year: 2020, abstract: ABSTRACT });
    expect(r.citations).toEqual([{ n: 1, sentenceNo: 2 }, { n: 2, sentenceNo: 3 }]);
  });
  it("sends a paper once, with every sentence shown for it, in the order of the papers", () => {
    const m = done({ answer: { ...done().answer!, citations: [{ n: 2, paperId: "doi:10.1/2", sentenceNo: 1, sentence: "a" }, { n: 1, paperId: "doi:10.1/1", sentenceNo: 2, sentence: "b" }, { n: 2, paperId: "doi:10.1/2", sentenceNo: 3, sentence: "c" }] } });
    const r = tightenRequestFor(m)!;
    expect(r.papers.map((p) => p.n)).toEqual([1, 2]);
    expect(r.citations).toHaveLength(3);
  });
  it("cuts an abstract at 1,500 characters (what the answer's own model read)", () => {
    const long = `${"word ".repeat(600)}end.`;
    const r = tightenRequestFor(done({ papers: [paper(1, { abstract: long }), paper(2), paper(3)] }))!;
    expect(r.papers[0]!.abstract.length).toBe(1500);
  });
  it("is null when the answer cannot be checked", () => expect(tightenRequestFor(done({ status: "stopped" }))).toBeNull());
});

describe("applyTighten", () => {
  const res = (over: Partial<TightenResponse["answer"]> = {}, changed = true): TightenResponse => ({
    changed,
    answer: { text: "It reached 90 percent [1].", grounded: true, checked: true, leftOut: 1, rewritten: 0, strict: true, citations: [{ n: 1, paperId: "req:1", sentenceNo: 2, sentence: "Second sentence says the model reached ninety percent." }], ...over },
  });
  it("takes the new answer, with the page's own paper ids, and marks it strict and done", () => {
    const m = applyTighten(done(), res());
    expect(m.answer).toMatchObject({ text: "It reached 90 percent [1].", strict: true, leftOut: 1 });
    expect(m.answer!.citations[0]).toEqual({ n: 1, paperId: "doi:10.1/1", sentenceNo: 2, sentence: "Second sentence says the model reached ninety percent." });
    expect(m.strict).toEqual({ status: "done", note: undefined });
    expect(canTighten(m)).toBe(false);
  });
  it("says so when nothing changed", () => expect(applyTighten(done(), res({}, false)).strict).toEqual({ status: "done", note: "unchanged" }));
  it("leaves the reply as it was, and says the check failed, when the answer is not of the shape or cites a paper the reply does not have", () => {
    const bad: unknown[] = [null, undefined, {}, { answer: null }, { answer: { text: 5, citations: [] } }, { answer: { text: "a", citations: "x" } }, res({ citations: [{ n: 9, paperId: "x", sentenceNo: 1, sentence: "s" }] }), res({ citations: [{ n: 1, paperId: "x", sentenceNo: 1, sentence: 5 as unknown as string }] })];
    for (const b of bad) {
      const m = applyTighten(done(), b as TightenResponse);
      expect(m.strict?.status).toBe("failed");
      expect(m.answer).toEqual(done().answer);
    }
  });
  it("a strict answer that is no longer grounded is kept as it is (the reader sees that nothing supported it)", () => {
    const m = applyTighten(done(), res({ text: "", grounded: false, citations: [], leftOut: 2 }));
    expect(m.answer).toMatchObject({ grounded: false, strict: true, leftOut: 2 });
  });
});

describe("keeping a reply", () => {
  it("keeps a finished strict check, and drops one that was running or had failed", () => {
    const base = done();
    expect(trimForStorage(startTighten(base)).strict).toBeUndefined();
    expect(trimForStorage(failTighten(base, "x")).strict).toBeUndefined();
    expect(trimForStorage(applyTighten(base, { changed: true, answer: { text: "a [1]", grounded: true, citations: [{ n: 1, paperId: "r", sentenceNo: 2, sentence: "s" }] } })).strict?.status).toBe("done");
  });
});
