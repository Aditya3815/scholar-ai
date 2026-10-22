import { describe, expect, it } from "vitest";
import { buildIdeaReport, combinationGaps, md, relatedIds, uncoveredParts, type CoverageRow, type FacetKey, type IdeaComparison, type IdeaInsights, type IdeaPaper, type ReportInput } from "@scholar/shared";

const row = (facet: FacetKey, ids: string[], status?: CoverageRow["status"]): CoverageRow => ({
  facet,
  status: status ?? (ids.length ? "covered" : "none"),
  papers: ids.map((id) => ({ id, match: "same" as const, quote: `${id} does ${facet} work in a way that matters` })),
});
const cmpOf = (id: string, level: "close" | "partial" | "related" | "unrelated" | "no_abstract") => ({ id, level, facets: {} as never });
const comparison = (rows: CoverageRow[], extra: Partial<IdeaComparison> = {}): IdeaComparison => ({ comparisons: [cmpOf("p1", "close"), cmpOf("p2", "related")], coverage: rows, combination: null, compared: 8, droppedClaims: 0, model: "m", ...extra });

describe("combinationGaps", () => {
  it("finds a pair that is covered by different papers and never by one", () => {
    const gaps = combinationGaps(comparison([row("purpose", ["p1"]), row("mechanism", ["p2"]), row("evaluation", []), row("domain", ["p1"])]));
    expect(gaps.map((g) => `${g.a}+${g.b}`)).toEqual(["mechanism+domain", "purpose+mechanism"]);
    expect(gaps[0]).toEqual({ a: "mechanism", b: "domain", aPapers: ["p2"], bPapers: ["p1"] });
  });

  it("no gap when one paper covers both parts, even if others cover only one", () => {
    expect(combinationGaps(comparison([row("purpose", ["p1", "p2"]), row("mechanism", ["p2", "p3"]), row("evaluation", []), row("domain", [])]))).toEqual([]);
  });

  it("a part nobody covers makes no combination gap (it is reported as an uncovered part instead)", () => {
    const c = comparison([row("purpose", ["p1"]), row("mechanism", []), row("evaluation", []), row("domain", ["p2"])]);
    expect(combinationGaps(c).map((g) => `${g.a}+${g.b}`)).toEqual(["purpose+domain"]);
    expect(uncoveredParts(c)).toEqual(["mechanism", "evaluation"]);
  });

  it("a part the researcher did not state is neither covered nor uncovered", () => {
    const c = comparison([row("purpose", ["p1"]), row("mechanism", ["p2"]), row("evaluation", [], "not_stated"), row("domain", [], "not_stated")]);
    expect(uncoveredParts(c)).toEqual([]);
    expect(combinationGaps(c).map((g) => `${g.a}+${g.b}`)).toEqual(["purpose+mechanism"]);
  });

  it("nothing compared gives nothing", () => {
    expect(combinationGaps(comparison([]))).toEqual([]);
    expect(combinationGaps(comparison([row("purpose", []), row("mechanism", []), row("evaluation", []), row("domain", [])]))).toEqual([]);
    expect(uncoveredParts(comparison([]))).toEqual([]);
  });

  it("the most useful pair, method with field, comes first", () => {
    const c = comparison([row("purpose", ["a"]), row("mechanism", ["b"]), row("evaluation", ["c"]), row("domain", ["d"])]);
    expect(combinationGaps(c)[0]!.a + combinationGaps(c)[0]!.b).toBe("mechanismdomain");
    expect(combinationGaps(c)).toHaveLength(6);
  });
});

describe("relatedIds", () => {
  it("is the compared papers that match some part of the idea, and only those", () => {
    const c = comparison([], { comparisons: [cmpOf("a", "close"), cmpOf("b", "partial"), cmpOf("c", "related"), cmpOf("d", "unrelated"), cmpOf("e", "no_abstract")] });
    expect([...relatedIds(c)].sort()).toEqual(["a", "b", "c"]);
    expect(relatedIds(comparison([], { comparisons: [] })).size).toBe(0);
  });
});

describe("md: one line of text that cannot change the Markdown around it", () => {
  it("escapes links, headings, emphasis, tables, code and HTML", () => {
    const t = md("[click](http://evil.example) <script>x</script> # not a heading | pipe `code` *em* _u_");
    expect(t).not.toMatch(/(?<!\\)\[|(?<!\\)<|(?<!\\)\||(?<!\\)`|(?<!\\)\*/);
  });
  it("puts newlines and control characters on one line, trims and cuts", () => {
    expect(md("a\nb\r\n\tc\u0000d")).toBe("a b c d");
    expect(md("x".repeat(1000), 50)).toHaveLength(50);
    expect(md(null)).toBe("");
    expect(md(undefined)).toBe("");
  });
  it("does not let text begin a list or a numbered list", () => {
    expect(md("- item")).toBe("\\- item");
    expect(md("1. item")).toBe("\\1. item");
  });
});

const paper = (over: Partial<IdeaPaper> & { id: string }): IdeaPaper => ({
  doi: "10.1000/abc", pmid: null, title: "A paper", authors: ["A. Author", "B. Writer"], year: 2022, venue: "Journal of Tests", abstract: "x", citationCount: 1, oaUrl: null, retracted: false,
  retractionSources: [], sources: ["openalex"], score: 1, kind: "paper", relevance: 0.5, foundBy: ["OpenAlex (meaning)"], ...over,
});

const INSIGHTS: IdeaInsights = {
  readings: [
    { id: "p1", outcome: { kind: "positive", quote: "reach 91% sensitivity in rural clinics" }, method: "We train a convolutional network", data: "5,000 smartphone fundus photographs" },
    { id: "p2", outcome: { kind: "not_stated", quote: null }, method: null, data: null },
  ],
  openProblems: [{ id: "p1", quote: "performance fell on images taken in poor light" }],
  answer: { question: "How well does it work?", statements: [{ text: "It reached 91% sensitivity.", cites: [{ id: "p1", quote: "reach 91% sensitivity in rural clinics" }] }] },
  opinion: ["Needs a camera adapter."],
  papersRead: 2,
  droppedClaims: 0,
  model: "m",
};

const input = (over: Partial<ReportInput> = {}): ReportInput => ({
  appName: "Scholar AI",
  generatedAt: "2026-10-22T10:30:00.000Z",
  title: "Glaucoma screening",
  summary: "Screening glaucoma with a smartphone fundus camera in rural clinics.",
  facets: { purpose: "screen glaucoma", mechanism: "smartphone fundus camera", evaluation: "not stated", domain: "rural clinics" },
  question: "How well does it work?",
  searched: [
    { source: "openalex", kind: "semantic", query: "glaucoma screening smartphone", ok: true, count: 40 },
    { source: "s2", kind: "keyword", query: "glaucoma fundus", ok: false, count: 0, error: "HTTP 429" },
  ],
  considered: 55,
  papers: [paper({ id: "p1", title: "Smartphone fundus screening" }), paper({ id: "p2", title: "OCT thickness", doi: null, kind: "preprint", retracted: true })],
  comparison: comparison([row("purpose", ["p1"]), row("mechanism", ["p2"]), row("evaluation", []), row("domain", ["p1"])]),
  insights: INSIGHTS,
  ...over,
});

describe("buildIdeaReport", () => {
  const text = buildIdeaReport(input());

  it("opens with the title, the date and what the report is and is not", () => {
    expect(text.startsWith("# Idea Check: Glaucoma screening\n")).toBe(true);
    expect(text).toContain("on 2026-10-22 (UTC)");
    expect(text).toMatch(/does not say whether the idea is new/);
  });

  it("is deterministic: the same input gives the same text", () => {
    expect(buildIdeaReport(input())).toBe(text);
  });

  it("lists what was searched and warns about a search that did not answer", () => {
    expect(text).toContain("OpenAlex, by meaning: “glaucoma screening smartphone”, 40 papers");
    expect(text).toContain("Semantic Scholar, by keywords: “glaucoma fundus”, did not answer");
    expect(text).toContain("1 of 2 searches did not answer");
    expect(text).toContain("55 different papers came back; the 2 closest");
  });

  it("numbers the papers, links a real DOI, labels a preprint and flags a retraction", () => {
    expect(text).toContain("1. **Smartphone fundus screening** (2022) A. Author, B. Writer *Journal of Tests* <https://doi.org/10.1000/abc>");
    expect(text).toMatch(/2\. \*\*OCT thickness\*\*.*\[preprint\] \*\*RETRACTED\*\*/);
  });

  it("refers to papers by their number everywhere else", () => {
    expect(text).toMatch(/- \[1\] \(does this\)\n> “p1 does purpose work/);
    expect(text).toContain("Method (\\[2\\])".replace(/\\/g, "")); // combination gap names the papers by number
  });

  it("states each gap kind that applies", () => {
    expect(text).toContain("Parts of your idea that no compared paper covers");
    expect(text).toContain("Combinations that no single compared paper covers");
    expect(text).toContain("What the papers themselves say is still open");
    expect(text).toContain("> “performance fell on images taken in poor light”");
  });

  it("shows what a paper reports with its sentence, and leaves out a paper that reports nothing", () => {
    expect(text).toContain("- **[1] reports that it worked**");
    expect(text).toContain("> “reach 91% sensitivity in rural clinics”");
    expect(text).toContain("Method: “We train a convolutional network”");
    expect(text).toContain("Data: “5,000 smartphone fundus photographs”");
    expect(text).not.toContain("**[2] no result stated");
  });

  it("leaves out what an unrelated paper reports: it says nothing about this idea", () => {
    const c = comparison([row("purpose", ["p1"]), row("mechanism", ["p1"]), row("evaluation", []), row("domain", ["p1"])], { comparisons: [cmpOf("p1", "close"), cmpOf("p2", "unrelated")] });
    const withBoth: IdeaInsights = { ...INSIGHTS, readings: [INSIGHTS.readings[0]!, { id: "p2", outcome: { kind: "positive", quote: "an unrelated paper reports a good result here" }, method: null, data: null }] };
    const t = buildIdeaReport(input({ comparison: c, insights: withBoth }));
    expect(t).toContain("- **[1] reports that it worked**");
    expect(t).not.toContain("an unrelated paper reports");
  });

  it("labels the model's notes as opinion, in their own section", () => {
    expect(text).toMatch(/## Practical feasibility: opinion\n\n\*Written by the AI model from your idea alone\. It is opinion, not checked against any paper\.\*/);
    expect(text).toContain("- Needs a camera adapter.");
  });

  it("gives each answer statement with its sentence", () => {
    expect(text).toContain("## Answer to your question");
    expect(text).toMatch(/- It reached 91% sensitivity\. \[1\]\n  > “reach 91% sensitivity in rural clinics”/);
  });

  it("ends with what the report cannot tell, including theses and abstracts only", () => {
    expect(text).toMatch(/## What this report cannot tell you[\s\S]*Theses, books[\s\S]*abstracts, not their full text[\s\S]*Please read the papers/);
  });

  it("never claims an idea is novel", () => {
    expect(text).not.toMatch(/\bnovel(ty)?\b/i);
    expect(text).not.toMatch(/\b\d+(\.\d+)?\s?%\s+(novel|new|original)/i);
  });

  it("has no 'undefined', 'null' or 'NaN' in it", () => {
    expect(text).not.toMatch(/\bundefined\b|\bnull\b|\bNaN\b/);
  });

  it("a sentence the AI picked for the question is shown as evidence on its own, without wording of the AI's", () => {
    const t = buildIdeaReport(input({ insights: { ...INSIGHTS, answer: { question: "Q?", statements: [{ text: null, cites: [{ id: "p1", quote: "reach 91% sensitivity in rural clinics" }] }] } } }));
    expect(t).toMatch(/- A sentence the AI picked for your question: \[1\]\n  > “reach 91% sensitivity in rural clinics”/);
  });

  it("says plainly when an abstract-based answer found nothing", () => {
    const t = buildIdeaReport(input({ insights: { ...INSIGHTS, answer: { question: "Q?", statements: [] } } }));
    expect(t).toContain("The abstracts of these papers do not answer it.");
  });

  it("says plainly when no gap was found, and when the abstracts report nothing", () => {
    const full = comparison([row("purpose", ["p1"]), row("mechanism", ["p1"]), row("evaluation", ["p1"]), row("domain", ["p1"])]);
    const t = buildIdeaReport(input({ comparison: full, insights: { ...INSIGHTS, openProblems: [], readings: [], answer: null, opinion: [] } }));
    expect(t).toContain("No gap was found");
    expect(t).toContain("say nothing about results, data or methods that could be quoted");
    expect(t).not.toContain("## Answer to your question");
    expect(t).not.toContain("## Practical feasibility");
  });

  it("without a comparison or the second reading, those sections are simply absent", () => {
    const t = buildIdeaReport(input({ comparison: null, insights: null, question: undefined }));
    expect(t).not.toContain("## How the compared papers relate");
    expect(t).not.toContain("## Gaps");
    expect(t).not.toContain("## Feasibility");
    expect(t).not.toContain("Your question");
    expect(t).toContain("## The closest papers");
  });

  it("an empty list of papers and searches still makes a report", () => {
    const t = buildIdeaReport(input({ papers: [], searched: [], considered: 0, comparison: null, insights: null }));
    expect(t).toContain("0 different papers came back; the 0 closest");
  });

  it("text from a database or a model cannot add links, headings or HTML", () => {
    const evil = "[free pdf](http://evil.example) <img src=x onerror=alert(1)>\n# Injected heading\n| a | b |";
    const t = buildIdeaReport(input({ papers: [paper({ id: "p1", title: evil, venue: evil, authors: [evil], doi: "10.1000/x\ninjected" })], comparison: null, insights: { ...INSIGHTS, opinion: [evil], openProblems: [{ id: "p1", quote: evil }] }, title: evil, summary: evil }));
    expect(t).not.toMatch(/(?<!\\)<img/);
    expect(t).not.toMatch(/\n# Injected/);
    expect(t).not.toMatch(/(?<!\\)\[free pdf\]\(http/);
    expect(t).not.toContain("https://doi.org/10.1000/x");
  });

  it("an invalid DOI is not turned into a link", () => {
    for (const doi of ["not-a-doi", "10.1/x", "http://evil.example", "10.1000/has space", null]) {
      expect(buildIdeaReport(input({ papers: [paper({ id: "p1", doi })] }))).not.toContain("https://doi.org/");
    }
  });

  it("a bad date does not print 'Invalid Date'", () => {
    expect(buildIdeaReport(input({ generatedAt: "yesterday" }))).not.toMatch(/Invalid Date|NaN/);
  });

  it("long fields are cut and a paper with many authors is shortened to three and 'et al.'", () => {
    const t = buildIdeaReport(input({ summary: "s".repeat(5000), papers: [paper({ id: "p1", authors: ["A", "B", "C", "D", "E"], title: "t".repeat(2000) })], comparison: null, insights: null }));
    expect(t.length).toBeLessThan(6000);
    expect(t).toContain("A, B, C et al.");
  });

  it("a reference to a paper that is not in the list shows [?] instead of failing", () => {
    const t = buildIdeaReport(input({ insights: { ...INSIGHTS, openProblems: [{ id: "gone", quote: "an open problem is stated here" }] } }));
    expect(t).toContain("- [?]");
  });
});
