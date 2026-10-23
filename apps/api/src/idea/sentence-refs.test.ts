import { describe, expect, it } from "vitest";
import { FACET_KEYS, type IdeaCompareRequest, type IdeaInsightsRequest } from "@scholar/shared";
import { SYSTEM as COMPARE_SYSTEM, SCHEMA as COMPARE_SCHEMA, buildComparePrompt, verifyComparison } from "./compare";
import { SYSTEM as INSIGHTS_SYSTEM, SCHEMA as INSIGHTS_SCHEMA, buildInsightsPrompt, verifyInsights } from "./insights";
import { resolveCompareSentences, resolveInsightsSentences } from "./sentence-refs";

// Abstract 1 has four sentences; abstract 2 three. The model names sentences by number.
const A1 = "We train a convolutional network on 5,000 smartphone fundus photographs to screen for glaucoma. It reaches 91% sensitivity in rural clinics (Fig. 2). Performance fell on images taken in poor light, which remains a challenge. Future work will test other sites.";
const A2 = "Optical coherence tomography measures retinal nerve fibre thickness in 300 patients. Results agree with specialist grading. Future work should extend the method to community screening.";
const papers = [
  { id: "p1", title: "Smartphone fundus screening", year: 2022, abstract: A1 },
  { id: "p2", title: "OCT nerve fibre thickness", year: 2020, abstract: A2 },
  { id: "p3", title: "No abstract here", year: 2019, abstract: "short" },
];
const facets = { purpose: "screen glaucoma", mechanism: "smartphone fundus camera with a CNN", evaluation: "compare with specialist grading", domain: "rural clinics" };
const compareReq: IdeaCompareRequest = { title: "T", summary: "Screening glaucoma in rural clinics.", facets, papers };
const insightsReq: IdeaInsightsRequest = { ...compareReq, question: "What sensitivity was reported?" };
const abstractOf = (n: unknown) => (typeof n === "number" && Number.isInteger(n) ? ([A1, A2][n - 1] ?? null) : null);

describe("the prompts number the sentences, and the schemas ask for numbers", () => {
  it("the comparison prompt shows each abstract with numbered sentences", () => {
    const p = buildComparePrompt(compareReq, papers.slice(0, 2));
    expect(p).toContain("(1) We train a convolutional network on 5,000 smartphone fundus photographs to screen for glaucoma. (2) It reaches 91% sensitivity in rural clinics (Fig. 2). (3) Performance fell");
    expect(p).toContain("[2] OCT nerve fibre thickness (2020)\n(1) Optical coherence tomography");
    expect(p).toContain("each sentence numbered");
  });
  it("the second reading's prompt does too", () => {
    const p = buildInsightsPrompt(insightsReq, papers.slice(0, 2));
    expect(p).toContain("(4) Future work will test other sites.");
    expect(p).toContain("each sentence numbered");
  });
  it("the comparison asks for `s` and no longer for a copied quote", () => {
    const facetProps = (COMPARE_SCHEMA.properties.papers.items.properties as unknown as Record<string, { properties: Record<string, unknown>; required: string[] }>).purpose!;
    expect(Object.keys(facetProps.properties).sort()).toEqual(["match", "s"]);
    expect(facetProps.required).toEqual(["match", "s"]);
    expect(COMPARE_SYSTEM).toMatch(/NUMBER of the one sentence/);
    expect(COMPARE_SYSTEM).not.toMatch(/copied EXACTLY/);
  });
  it("the second reading asks for sentence numbers for results, open problems and answers, and a copied phrase only for the method and the data", () => {
    const s = INSIGHTS_SCHEMA.properties;
    expect(Object.keys(s.open_problems.items.properties).sort()).toEqual(["n", "s"]);
    expect(Object.keys(s.papers.items.properties).sort()).toEqual(["data_quote", "method_quote", "n", "outcome", "outcome_s"]);
    expect(Object.keys(s.answer.items.properties).sort()).toEqual(["n", "s", "statement"]);
    expect(INSIGHTS_SYSTEM).toMatch(/NUMBER of that sentence/);
  });
});

describe("resolveCompareSentences", () => {
  it("turns a sentence number into the sentence", () => {
    const raw = { papers: [{ n: 1, purpose: { match: "same", s: 1 }, mechanism: { match: "similar", s: 2 }, evaluation: { match: "different", s: 0 }, domain: { match: "not_stated", s: 0 } }] };
    const out = resolveCompareSentences(raw, abstractOf, FACET_KEYS) as { papers: Record<string, { quote: string }>[] };
    expect(out.papers[0]!.purpose!.quote).toBe("We train a convolutional network on 5,000 smartphone fundus photographs to screen for glaucoma.");
    expect(out.papers[0]!.mechanism!.quote).toBe("It reaches 91% sensitivity in rural clinics (Fig. 2).");
    expect(out.papers[0]!.evaluation!.quote).toBe("");
  });
  it("leaves an answer that already has a quote alone, and does not change what it was given", () => {
    const raw = { papers: [{ n: 1, purpose: { match: "same", quote: "a copied piece", s: 2 } }] };
    const copy = JSON.stringify(raw);
    const out = resolveCompareSentences(raw, abstractOf, FACET_KEYS) as { papers: Record<string, { quote: string }>[] };
    expect(out.papers[0]!.purpose!.quote).toBe("a copied piece");
    expect(JSON.stringify(raw)).toBe(copy);
  });
  it("a number that is not a sentence, or a paper that does not exist, gives nothing", () => {
    const raw = { papers: [{ n: 1, purpose: { match: "same", s: 9 }, mechanism: { match: "same", s: -1 }, evaluation: { match: "same", s: 1.5 }, domain: { match: "same", s: "2" } }, { n: 7, purpose: { match: "same", s: 1 } }, { n: "x", purpose: { match: "same", s: 1 } }] };
    const out = resolveCompareSentences(raw, abstractOf, FACET_KEYS) as { papers: Record<string, { quote: string }>[] };
    for (const k of ["purpose", "mechanism", "evaluation", "domain"]) expect(out.papers[0]![k]!.quote).toBe("");
    expect(out.papers[1]!.purpose!.quote).toBe("");
    expect(out.papers[2]!.purpose!.quote).toBe("");
  });
  it("copes with an answer that is not the shape it should be", () => {
    for (const raw of [null, undefined, 5, "text", [], {}, { papers: "no" }, { papers: [null, 3, "x"] }]) expect(() => resolveCompareSentences(raw, abstractOf, FACET_KEYS)).not.toThrow();
  });
});

describe("verifyComparison with sentence numbers", () => {
  const facetAns = (match: string, s: number) => ({ match, s });
  const raw = {
    papers: [
      { n: 1, purpose: facetAns("same", 1), mechanism: facetAns("similar", 1), evaluation: facetAns("same", 2), domain: facetAns("same", 2) },
      { n: 2, purpose: facetAns("similar", 1), mechanism: facetAns("different", 0), evaluation: facetAns("same", 2), domain: facetAns("not_stated", 0) },
    ],
  };
  it("shows the sentence as the evidence and drops nothing", () => {
    const c = verifyComparison(raw, compareReq, "m");
    expect(c.droppedClaims).toBe(0);
    expect(c.comparisons[0]!.facets.purpose).toEqual({ match: "same", quote: "We train a convolutional network on 5,000 smartphone fundus photographs to screen for glaucoma." });
    expect(c.comparisons[1]!.facets.evaluation).toEqual({ match: "same", quote: "Results agree with specialist grading." });
    expect(c.comparisons[0]!.level).toBe("close");
    expect(c.coverage.find((r) => r.facet === "domain")!.status).toBe("covered");
  });
  it("counts a 'same' or 'similar' with no sentence behind it as unverified, as it counts a quote that is not in the abstract", () => {
    const c = verifyComparison({ papers: [{ n: 1, purpose: facetAns("same", 0), mechanism: facetAns("same", 12), evaluation: facetAns("same", 1), domain: facetAns("not_stated", 0) }] }, compareReq, "m");
    expect(c.droppedClaims).toBe(2);
    expect(c.comparisons[0]!.facets.purpose.match).toBe("unverified");
    expect(c.comparisons[0]!.facets.evaluation.match).toBe("same");
  });
  it("a paper's sentence number is looked up in THAT paper's abstract", () => {
    const c = verifyComparison({ papers: [{ n: 2, purpose: facetAns("same", 3) }] }, compareReq, "m");
    expect(c.comparisons[1]!.facets.purpose.quote).toBe("Future work should extend the method to community screening.");
    expect(c.comparisons[0]!.facets.purpose.match).toBe("not_stated");
  });
  it("a sentence longer than the limit is shown as a prefix of itself, which is still in the abstract", () => {
    const long = `A short opening sentence about screening. ${Array.from({ length: 70 }, (_, i) => `term${i}`).join(" ")} ends here.`;
    const r = { ...compareReq, papers: [{ id: "L", title: "Long", year: 2020, abstract: `${long} Another sentence follows.` }] };
    const c = verifyComparison({ papers: [{ n: 1, purpose: facetAns("same", 1) }] }, r, "m");
    expect(c.droppedClaims).toBe(0);
    const q = c.comparisons[0]!.facets.purpose.quote!;
    expect(q.length).toBeLessThanOrEqual(300);
    expect(/term\d+$/.test(q)).toBe(true); // cut at a word, not inside one
    expect(r.papers[0]!.abstract.replace(/\s+/g, " ")).toContain(q);
  });
});

describe("verifyInsights with sentence numbers", () => {
  it("builds results, open problems and answer evidence from sentence numbers", () => {
    const raw = {
      open_problems: [{ n: 1, s: 3 }, { n: 2, s: 3 }],
      papers: [
        { n: 1, outcome: "positive", outcome_s: 2, method_quote: "convolutional network", data_quote: "5,000 smartphone fundus photographs" },
        { n: 2, outcome: "positive", outcome_s: 2, method_quote: "", data_quote: "" },
      ],
      answer: [{ statement: "The network reaches 91% sensitivity in rural clinics.", n: 1, s: 2 }],
      opinion: ["Two months of work."],
    };
    const r = verifyInsights(raw, insightsReq, "m");
    expect(r.droppedClaims).toBe(0);
    expect(r.openProblems.map((o) => o.quote)).toEqual(["Performance fell on images taken in poor light, which remains a challenge.", "Future work should extend the method to community screening."]);
    expect(r.readings[0]!.outcome).toEqual({ kind: "positive", quote: "It reaches 91% sensitivity in rural clinics (Fig. 2)." });
    expect(r.readings[0]!.method).toBe("convolutional network");
    expect(r.readings[0]!.data).toBe("5,000 smartphone fundus photographs");
    expect(r.answer!.statements).toEqual([{ text: "The network reaches 91% sensitivity in rural clinics.", cites: [{ id: "p1", quote: "It reaches 91% sensitivity in rural clinics (Fig. 2)." }] }]);
  });
  it("a sentence that is not an open problem is still not shown as one, and a bad number counts as dropped, not as evidence", () => {
    const r = verifyInsights({ open_problems: [{ n: 1, s: 1 }, { n: 1, s: 99 }], papers: [{ n: 1, outcome: "positive", outcome_s: 0, method_quote: "", data_quote: "" }], answer: [{ statement: "x", n: 1, s: 0 }], opinion: [] }, insightsReq, "m");
    expect(r.openProblems).toEqual([]);
    expect(r.readings[0]!.outcome).toEqual({ kind: "not_stated", quote: null });
    expect(r.answer!.statements).toEqual([]);
  });
  it("a sentence number that is not in the abstract is a claim with nothing behind it: dropped and counted; the number 0 means none and is not", () => {
    const r = verifyInsights({ open_problems: [{ n: 1, s: 99 }, { n: 1, s: 0 }], papers: [{ n: 1, outcome: "positive", outcome_s: 99, method_quote: "", data_quote: "" }], answer: [{ statement: "x", n: 1, s: 99 }, { statement: "y", n: 1, s: 0 }], opinion: [] }, insightsReq, "m");
    expect(r.droppedClaims).toBe(3);
    expect(r.openProblems).toEqual([]);
    expect(r.readings[0]!.outcome).toEqual({ kind: "not_stated", quote: null });
    expect(r.answer!.statements).toEqual([]);
  });
  it("an answer statement keeps its own wording only when its sentence supports it", () => {
    const r = verifyInsights({ open_problems: [], papers: [], answer: [{ statement: "It cured everyone in 12 days.", n: 1, s: 2 }], opinion: [] }, insightsReq, "m");
    expect(r.answer!.statements[0]).toEqual({ text: null, cites: [{ id: "p1", quote: "It reaches 91% sensitivity in rural clinics (Fig. 2)." }] });
  });
  it("quotes in the older form still work", () => {
    const r = verifyInsights({ open_problems: [{ n: 2, quote: "Future work should extend the method to community screening." }], papers: [{ n: 1, outcome: "positive", outcome_quote: "It reaches 91% sensitivity in rural clinics (Fig. 2).", method_quote: "", data_quote: "" }], answer: [], opinion: [] }, insightsReq, "m");
    expect(r.openProblems).toHaveLength(1);
    expect(r.readings[0]!.outcome.kind).toBe("positive");
  });
  it("copes with an answer that is not the shape it should be", () => {
    for (const raw of [null, undefined, 5, "text", [], {}, { papers: "no", open_problems: 3, answer: {} }]) expect(() => resolveInsightsSentences(raw, abstractOf)).not.toThrow();
  });
});
