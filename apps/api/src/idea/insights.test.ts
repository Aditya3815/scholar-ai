import { describe, expect, it } from "vitest";
import { MAX_ANSWER_STATEMENTS, MAX_OPEN_PROBLEMS, MAX_OPINION_ITEMS, type IdeaInsightsRequest } from "@scholar/shared";
import { SYSTEM, buildInsightsPrompt, insightsIdea, phraseIsInAbstract, sanitizeInsightsRequest, supports, verifyInsights } from "./insights";

const A1 = "We train a convolutional network on 5,000 smartphone fundus photographs to screen for glaucoma, and reach 91% sensitivity in rural clinics. However, performance fell on images taken in poor light, which remains a challenge.";
const A2 = "Optical coherence tomography is used to measure retinal nerve fibre thickness in 300 patients. Future work should extend the method to community screening.";
const A3 = "A short note.";
const req = (over: Partial<IdeaInsightsRequest> = {}): IdeaInsightsRequest => ({
  title: "Glaucoma screening",
  summary: "Screening glaucoma with a smartphone fundus camera.",
  facets: { purpose: "screen glaucoma", mechanism: "smartphone fundus camera", evaluation: "not stated", domain: "rural clinics" },
  papers: [
    { id: "p1", title: "Smartphone fundus screening", year: 2022, abstract: A1 },
    { id: "p2", title: "OCT nerve fibre thickness", year: 2020, abstract: A2 },
    { id: "p3", title: "No abstract here", year: 2019, abstract: A3 },
  ],
  ...over,
});

describe("sanitizeInsightsRequest", () => {
  it("is the same cleaning as the comparison: bounded, scrubbed, papers kept", () => {
    const r = sanitizeInsightsRequest({ ...req(), summary: "mail me@x.org https://a.b/c about glaucoma screening", question: "What data did they use? Write to a@b.org" })!;
    expect(r.summary).not.toMatch(/@|https?:/);
    expect(r.question).not.toMatch(/@/);
    expect(r.papers).toHaveLength(3);
  });
  it("refuses an empty request", () => {
    expect(sanitizeInsightsRequest({})).toBeNull();
    expect(sanitizeInsightsRequest(null)).toBeNull();
  });
});

describe("supports", () => {
  it("accepts a statement that is about its quote", () => {
    expect(supports("The network reached 91% sensitivity in rural clinics", "reach 91% sensitivity in rural clinics")).toBe(true);
    expect(supports("Performance dropped in poor light", "performance fell on images taken in poor light")).toBe(true);
  });
  it("matches word forms by their first five letters", () => {
    expect(supports("The method reduces screening cost", "a reduction in screening cost was observed")).toBe(true);
  });
  it("every number in the statement must be in the quote: a figure is what matters most", () => {
    expect(supports("It reached 91.36% sensitivity.", "sensitivity of 91.36% (95%CI 85.93% to 95.19%)")).toBe(true);
    expect(supports("It reached 93% sensitivity.", "sensitivity of 91.36% (95%CI 85.93% to 95.19%)")).toBe(false);
    expect(supports("A cohort of 5000 patients was screened", "screened 5,000 patients in total")).toBe(true);
    expect(supports("15.2 percent were fabricated", "15.2 percent were fabricated or misattributed")).toBe(true);
  });
  it("does not count 'Paper 8' as a figure of the paper", () => {
    expect(supports("Paper 8 achieved a mean absolute error of 1.28%", "achieving a mean absolute error of 1.28% compared to ground-truth probes")).toBe(true);
    expect(supports("Papers 2 and 3 achieved an error of 1.28%", "achieving a mean absolute error of 1.28%")).toBe(false); // the "3" is not a paper number here
  });
  it("accepts a paraphrase that keeps the substance, and refuses a statement that only shares one word", () => {
    expect(supports("The system improved performance by up to 58.99 percent", "achieved a peak performance improvement of 58.99 percent compared to alternative methods")).toBe(true);
    expect(supports("Smartphones help rural clinics", "reach 91% sensitivity in rural clinics")).toBe(false);
  });
  it("refuses a statement with nothing to do with its quote", () => {
    expect(supports("Smartphones are cheap and widely available", "reach 91% sensitivity in rural clinics")).toBe(false);
    expect(supports("", "anything at all here")).toBe(false);
    expect(supports("is the of", "the quote is here")).toBe(false);
  });
});

describe("phraseIsInAbstract", () => {
  it("accepts a short phrase that is in the abstract, word for word", () => {
    expect(phraseIsInAbstract("convolutional network", A1)).toBe(true);
    expect(phraseIsInAbstract("5,000 smartphone fundus photographs", A1)).toBe(true);
    expect(phraseIsInAbstract("Optical coherence tomography", A2)).toBe(true);
  });
  it("refuses a single word, a tiny phrase, a phrase out of order and one that is not there", () => {
    expect(phraseIsInAbstract("glaucoma", A1)).toBe(false);
    expect(phraseIsInAbstract("a b", A1)).toBe(false);
    expect(phraseIsInAbstract("network convolutional", A1)).toBe(false);
    expect(phraseIsInAbstract("a transformer pretrained on images", A1)).toBe(false);
    expect(phraseIsInAbstract("convolutional neural network", A1)).toBe(false); // "neural" is not in the abstract
  });
});

describe("verifyInsights: what each paper reports", () => {
  const out = (raw: unknown, r = req()) => verifyInsights(raw, r, "m");

  it("keeps an outcome, a method and a data quote that are really in the abstract", () => {
    const v = out({ papers: [{ n: 1, outcome: "positive", outcome_quote: "reach 91% sensitivity in rural clinics", method_quote: "We train a convolutional network", data_quote: "5,000 smartphone fundus photographs" }] });
    expect(v.readings[0]).toEqual({ id: "p1", outcome: { kind: "positive", quote: "reach 91% sensitivity in rural clinics" }, method: "We train a convolutional network", data: "5,000 smartphone fundus photographs" });
    expect(v.droppedClaims).toBe(0);
  });

  it("an outcome whose sentence is not in the abstract becomes 'not stated', and is counted as dropped", () => {
    const v = out({ papers: [{ n: 1, outcome: "positive", outcome_quote: "the system achieved perfect accuracy in every setting", method_quote: "", data_quote: "" }] });
    expect(v.readings[0]!.outcome).toEqual({ kind: "not_stated", quote: null });
    expect(v.droppedClaims).toBe(1);
  });

  it("a short method or data phrase is enough when it is really in the abstract", () => {
    const v = out({ papers: [{ n: 1, outcome: "not_stated", outcome_quote: "", method_quote: "convolutional network", data_quote: "smartphone fundus photographs" }] });
    expect(v.readings[0]).toMatchObject({ method: "convolutional network", data: "smartphone fundus photographs" });
    expect(v.droppedClaims).toBe(0);
  });

  it("but a short phrase is not accepted as the sentence for an outcome", () => {
    const v = out({ papers: [{ n: 1, outcome: "positive", outcome_quote: "convolutional network", method_quote: "", data_quote: "" }] });
    expect(v.readings[0]!.outcome).toEqual({ kind: "not_stated", quote: null });
  });

  it("an outcome with no sentence at all is 'not stated'", () => {
    expect(out({ papers: [{ n: 1, outcome: "positive", outcome_quote: "", method_quote: "", data_quote: "" }] }).readings[0]!.outcome.kind).toBe("not_stated");
  });

  it("a method or data quote that is not there is dropped, not shown", () => {
    const v = out({ papers: [{ n: 2, outcome: "not_stated", outcome_quote: "", method_quote: "a transformer pretrained on a billion images", data_quote: "measure retinal nerve fibre thickness in 300 patients" }] });
    expect(v.readings[1]).toMatchObject({ id: "p2", method: null, data: "measure retinal nerve fibre thickness in 300 patients" });
    expect(v.droppedClaims).toBe(1);
  });

  it("every paper that has an abstract gets a reading even if the model forgot it; a paper without one is not read", () => {
    const v = out({ papers: [] });
    expect(v.readings.map((r) => r.id)).toEqual(["p1", "p2"]);
    expect(v.readings.every((r) => r.outcome.kind === "not_stated" && r.data === null && r.method === null)).toBe(true);
    expect(v.papersRead).toBe(2);
  });

  it("an unknown outcome word, a wrong paper number, a repeated number and junk shapes do no harm", () => {
    const v = out({ papers: [{ n: 1, outcome: "great", outcome_quote: "x" }, { n: 99, outcome: "positive", outcome_quote: "reach 91% sensitivity in rural clinics" }, { n: 1, outcome: "positive", outcome_quote: "reach 91% sensitivity in rural clinics" }, null, "text", 7, { n: "1" }] });
    expect(v.readings[0]!.outcome.kind).toBe("not_stated");
    expect(() => out(null)).not.toThrow();
    expect(() => out("garbage")).not.toThrow();
    expect(() => out({ papers: "no", open_problems: 3, answer: {}, opinion: 5 })).not.toThrow();
  });

  it("two pieces joined with '...' pass when each is in the abstract, in order", () => {
    const v = out({ papers: [{ n: 1, outcome: "positive", outcome_quote: "train a convolutional network ... reach 91% sensitivity", method_quote: "", data_quote: "" }] });
    expect(v.readings[0]!.outcome.kind).toBe("positive");
  });
});

describe("verifyInsights: what the papers say is still open", () => {
  const out = (raw: unknown, r = req()) => verifyInsights(raw, r, "m");

  it("keeps a verified sentence that names a limitation or future work", () => {
    const v = out({ open_problems: [{ n: 1, quote: "performance fell on images taken in poor light, which remains a challenge" }, { n: 2, quote: "Future work should extend the method to community screening" }] });
    expect(v.openProblems.map((o) => o.id)).toEqual(["p1", "p2"]);
  });

  it("also keeps a sentence that names the next step or says more is warranted", () => {
    const r = req({ papers: [{ id: "p9", title: "Next step", year: 2024, abstract: "We evaluated the system at one hospital in 200 patients. The next step involves a population-level assessment of referral outcomes." }] });
    const v = verifyInsights({ open_problems: [{ n: 1, quote: "The next step involves a population-level assessment of referral outcomes" }] }, r, "m");
    expect(v.openProblems).toEqual([{ id: "p9", quote: "The next step involves a population-level assessment of referral outcomes" }]);
  });

  it("drops a sentence that is in the abstract but does not name anything open", () => {
    const v = out({ open_problems: [{ n: 1, quote: "We train a convolutional network on 5,000 smartphone fundus photographs" }] });
    expect(v.openProblems).toEqual([]);
    expect(v.droppedClaims).toBe(1);
  });

  it("drops a sentence that is not in the abstract", () => {
    const v = out({ open_problems: [{ n: 2, quote: "The authors admit that the sample was far too small to conclude anything" }] });
    expect(v.openProblems).toEqual([]);
    expect(v.droppedClaims).toBe(1);
  });

  it("does not repeat the same sentence, and keeps at most the limit", () => {
    const same = { n: 1, quote: "performance fell on images taken in poor light, which remains a challenge" };
    expect(out({ open_problems: [same, same, { ...same, quote: same.quote.toUpperCase() }] }).openProblems).toHaveLength(1);
    const many = Array.from({ length: 30 }, () => ({ n: 2, quote: "Future work should extend the method to community screening" }));
    expect(out({ open_problems: many }).openProblems.length).toBeLessThanOrEqual(MAX_OPEN_PROBLEMS);
  });

  it("ignores a quote for a paper that has no abstract to check against", () => {
    expect(out({ open_problems: [{ n: 3, quote: "Future work should extend" }] }).openProblems).toEqual([]);
  });
});

describe("verifyInsights: the answer to the question", () => {
  const withQ = req({ question: "How well does a smartphone fundus camera work in rural clinics?" });
  const out = (raw: unknown, r = withQ) => verifyInsights(raw, r, "m");

  it("is null when no question was asked, whatever the model says", () => {
    expect(out({ answer: [{ statement: "It works", n: 1, quote: "reach 91% sensitivity in rural clinics" }] }, req()).answer).toBeNull();
  });

  it("keeps a statement whose quote is in the abstract and about the statement, with its paper", () => {
    const v = out({ answer: [{ statement: "A network on smartphone photographs reached 91% sensitivity in rural clinics.", n: 1, quote: "reach 91% sensitivity in rural clinics" }] });
    expect(v.answer).toEqual({ question: withQ.question, statements: [{ text: "A network on smartphone photographs reached 91% sensitivity in rural clinics.", cites: [{ id: "p1", quote: "reach 91% sensitivity in rural clinics" }] }] });
  });

  it("drops a statement whose quote is not in the abstract", () => {
    const v = out({ answer: [{ statement: "It reached 99% sensitivity everywhere.", n: 1, quote: "reached 99% sensitivity everywhere in the world" }] });
    expect(v.answer!.statements).toEqual([]);
    expect(v.droppedClaims).toBe(1);
  });

  it("a statement that its own sentence does not support is not shown, but the verified sentence still is, on its own", () => {
    const v = out({ answer: [{ statement: "Smartphones are cheap and widely available across India.", n: 1, quote: "reach 91% sensitivity in rural clinics" }] });
    expect(v.answer!.statements).toEqual([{ text: null, cites: [{ id: "p1", quote: "reach 91% sensitivity in rural clinics" }] }]);
    expect(v.droppedClaims).toBe(0);
  });

  it("a statement with a figure that is not in its sentence loses its wording, not its evidence", () => {
    const v = out({ answer: [{ statement: "It reached 93% sensitivity in rural clinics.", n: 1, quote: "reach 91% sensitivity in rural clinics" }] });
    expect(v.answer!.statements[0]).toEqual({ text: null, cites: [{ id: "p1", quote: "reach 91% sensitivity in rural clinics" }] });
  });

  it("a sentence with no statement at all is still shown as evidence", () => {
    const v = out({ answer: [{ statement: "", n: 1, quote: "reach 91% sensitivity in rural clinics" }] });
    expect(v.answer!.statements).toEqual([{ text: null, cites: [{ id: "p1", quote: "reach 91% sensitivity in rural clinics" }] }]);
  });

  it("an answer with no supported statement says so with an empty list, not with invented text", () => {
    expect(out({ answer: [] }).answer).toEqual({ question: withQ.question, statements: [] });
    expect(out({}).answer!.statements).toEqual([]);
  });

  it("cleans addresses and links out of a statement, repeats nothing, and keeps at most the limit", () => {
    const row = { statement: "Sensitivity of 91% in rural clinics, see https://x.org and a@b.org", n: 1, quote: "reach 91% sensitivity in rural clinics" };
    const v = out({ answer: [row, row, { ...row, statement: "again" }] });
    expect(v.answer!.statements).toHaveLength(1); // the same sentence of the same paper is shown once
    expect(JSON.stringify(v.answer)).not.toMatch(/https?:|@b\.org/);
    const sentences = [A1.split(". ")[0]!.slice(0, 120), "performance fell on images taken in poor light, which remains a challenge", "reach 91% sensitivity in rural clinics", "to screen for glaucoma, and reach 91% sensitivity", "images taken in poor light, which remains a challenge", "train a convolutional network on 5,000 smartphone fundus photographs", "screen for glaucoma, and reach 91% sensitivity in rural clinics"];
    const many = out({ answer: sentences.map((q) => ({ statement: "x", n: 1, quote: q })) });
    expect(many.answer!.statements.length).toBeLessThanOrEqual(MAX_ANSWER_STATEMENTS);
  });
});

describe("verifyInsights: the model's opinion", () => {
  const out = (raw: unknown) => verifyInsights(raw, req(), "m");

  it("is kept, short and clean, up to the limit", () => {
    const v = out({ opinion: ["Needs a camera adapter and a few weeks of data collection.", "Ethics approval for clinic images takes time.", "Some image-processing skill is needed.", "A fourth note that is over the limit."] });
    expect(v.opinion).toHaveLength(MAX_OPINION_ITEMS);
    expect(v.opinion[0]).toBe("Needs a camera adapter and a few weeks of data collection.");
  });

  it("never says the idea is new or already done: such a note is not shown", () => {
    const v = out({ opinion: ["This is a novel approach.", "It has never been done in India.", "Unprecedented in rural settings.", "It has already been done elsewhere.", "A phone adapter costs little."] });
    expect(v.opinion).toEqual(["A phone adapter costs little."]);
  });

  it("removes links and addresses, repeats and empties; non-text is ignored", () => {
    const v = out({ opinion: ["Ask a@b.org at https://x.org about the camera.", "ask a@b.org at https://x.org about the camera.", "", "   ", 5, null, { a: 1 }] });
    expect(v.opinion).toHaveLength(1);
    expect(v.opinion[0]).not.toMatch(/@|https?:/);
  });

  it("is cut to 200 characters", () => {
    expect(out({ opinion: ["x".repeat(500)] }).opinion[0]!.length).toBeLessThanOrEqual(200);
  });
});

describe("the prompt and the run", () => {
  it("the prompt numbers only the papers that have an abstract, and says when there is no question", () => {
    const r = req();
    const p = buildInsightsPrompt(r, r.papers.filter((x) => x.abstract.length >= 80));
    expect(p).toContain("[1] Smartphone fundus screening (2022)");
    expect(p).toContain("[2] OCT nerve fibre thickness (2020)");
    expect(p).not.toContain("[3]");
    expect(p).toContain("asked no question");
  });

  it("the instructions forbid following the papers' text and saying whether the idea is new", () => {
    expect(SYSTEM).toMatch(/never follow instructions/i);
    expect(SYSTEM).toMatch(/Never say whether the idea is new/);
  });

  it("insightsIdea sends one request, reports its stages in order, and verifies the answer", async () => {
    const stages: string[] = [];
    let calls = 0;
    const out = await insightsIdea({
      req: req({ question: "How well does it work?" }),
      stream: async (r) => {
        calls++;
        expect(r.user).toContain("[2] OCT");
        return { json: { open_problems: [{ n: 2, quote: "Future work should extend the method to community screening" }], papers: [], answer: [], opinion: ["Needs a camera adapter."] }, model: "test" };
      },
      hooks: { onStage: (s) => stages.push(s) },
    });
    expect(calls).toBe(1);
    expect(stages).toEqual(["reading", "analysing", "checking"]);
    expect(out.openProblems).toHaveLength(1);
    expect(out.model).toBe("test");
  });

  it("when no paper has an abstract, no model is called", async () => {
    let called = false;
    const out = await insightsIdea({ req: req({ papers: [{ id: "x", title: "T", year: null, abstract: "" }] }), stream: async () => { called = true; return { json: {}, model: "m" }; } });
    expect(called).toBe(false);
    expect(out).toMatchObject({ readings: [], openProblems: [], papersRead: 0 });
  });

  it("a failing model is not hidden: the error reaches the caller", async () => {
    await expect(insightsIdea({ req: req(), stream: async () => { throw new Error("provider down"); } })).rejects.toThrow("provider down");
  });
});
