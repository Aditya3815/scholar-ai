import { describe, expect, it } from "vitest";
import type { IdeaCompareRequest } from "@scholar/shared";
import { SYSTEM, buildComparePrompt, compareIdea, levelOf, quoteIsInAbstract, sanitizeCompareRequest, verifyComparison } from "./compare";
import { stubCompareStream } from "./stub";

const A1 = "We screen for glaucoma using smartphone fundus photographs and a convolutional neural network, tested against ophthalmologist grading in rural clinics.";
const A2 = "A review of tonometry devices for measuring intraocular pressure in hospital settings, with a focus on calibration and cost across several countries.";

const req = (over: Partial<IdeaCompareRequest> = {}): IdeaCompareRequest => ({
  title: "Phone-based glaucoma screening",
  summary: "Screening glaucoma in rural clinics with a smartphone camera and a neural network.",
  facets: { purpose: "screen for glaucoma", mechanism: "smartphone fundus camera with a CNN", evaluation: "compare with ophthalmologist grading", domain: "rural clinics" },
  papers: [
    { id: "doi:10.1/a", title: "Smartphone glaucoma screening", year: 2022, abstract: A1 },
    { id: "doi:10.1/b", title: "Tonometry review", year: 2019, abstract: A2 },
    { id: "doi:10.1/c", title: "No abstract here", year: 2020, abstract: "" },
  ],
  ...over,
});

const facet = (match: string, quote = "") => ({ match, quote });

describe("sanitizeCompareRequest", () => {
  it("keeps a good request and bounds what the browser can send", () => {
    const r = sanitizeCompareRequest({ ...req(), ideaExcerpt: "x ".repeat(5000), papers: Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, title: `Paper ${i}`, year: 2020, abstract: "word ".repeat(1000) })) })!;
    expect(r.papers).toHaveLength(8);
    expect(r.papers[0]!.abstract.length).toBeLessThanOrEqual(2000);
    expect(r.ideaExcerpt!.length).toBeLessThanOrEqual(3000);
  });
  it("removes e-mail addresses and links from what the model is told, and refuses an empty request", () => {
    const r = sanitizeCompareRequest({ ...req(), summary: "Contact me@x.org or https://lab.example/x about screening glaucoma.", title: "T" })!;
    expect(r.summary).not.toMatch(/@|https?:/);
    expect(sanitizeCompareRequest({ ...req(), papers: [] })).toBeNull();
    expect(sanitizeCompareRequest({ papers: [{ id: "x", title: "t", abstract: "a" }], summary: "", facets: {} })).toBeNull();
    expect(sanitizeCompareRequest(null)).toBeNull();
    expect(sanitizeCompareRequest({ ...req(), papers: [{ id: 5, title: "t" }, { id: "ok", title: "Fine", year: "2020", abstract: A1 }] })!.papers).toEqual([{ id: "ok", title: "Fine", year: null, abstract: A1 }]);
  });
});

describe("verifyComparison", () => {
  const good = {
    papers: [
      { n: 1, purpose: facet("same", "screen for glaucoma using smartphone fundus photographs"), mechanism: facet("same", "a convolutional neural network, tested against ophthalmologist grading"), evaluation: facet("similar", "tested against ophthalmologist grading in rural clinics"), domain: facet("same", "against ophthalmologist grading in rural clinics") },
      { n: 2, purpose: facet("different"), mechanism: facet("different"), evaluation: facet("not_stated"), domain: facet("different") },
    ],
  };

  it("shows a match only with a quote that really is in the abstract", () => {
    const c = verifyComparison(good, req(), "m");
    const a = c.comparisons[0]!;
    expect(a.facets.purpose).toEqual({ match: "same", quote: "screen for glaucoma using smartphone fundus photographs" });
    expect(a.level).toBe("close");
    expect(c.droppedClaims).toBe(0);
    expect(c.compared).toBe(2);
  });

  it("drops a claim whose quote is invented, and works the level out from what is left", () => {
    const lying = { papers: [{ n: 1, purpose: facet("same", "this sentence was never in the abstract at all"), mechanism: facet("same", "a convolutional neural network, tested against ophthalmologist grading"), evaluation: facet("different"), domain: facet("different") }, good.papers[1]] };
    const c = verifyComparison(lying, req(), "m");
    expect(c.comparisons[0]!.facets.purpose).toEqual({ match: "unverified", quote: null });
    expect(c.comparisons[0]!.level).toBe("related"); // one verified part only
    expect(c.droppedClaims).toBe(1);
    expect(c.coverage.find((r) => r.facet === "purpose")!.status).toBe("none");
  });

  it("never takes the overall closeness from the model", () => {
    const withOverall = { papers: [{ ...good.papers[1], n: 1, level: "close", overall: "close" }] };
    expect(verifyComparison(withOverall, req(), "m").comparisons[0]!.level).toBe("unrelated");
  });

  it("treats a part the idea does not state as not stated, whatever the model says", () => {
    const c = verifyComparison(good, req({ facets: { purpose: "screen for glaucoma", mechanism: "smartphone fundus camera with a CNN", evaluation: "not stated", domain: "rural clinics" } }), "m");
    expect(c.comparisons[0]!.facets.evaluation).toEqual({ match: "not_stated", quote: null });
    expect(c.coverage.find((r) => r.facet === "evaluation")!.status).toBe("not_stated");
  });

  it("marks a paper without an abstract, and a paper the model skipped", () => {
    const c = verifyComparison({ papers: [good.papers[0]] }, req(), "m");
    expect(c.comparisons[2]!.level).toBe("no_abstract");
    expect(c.comparisons[1]!.level).toBe("unrelated"); // skipped by the model: nothing was verified
    expect(c.compared).toBe(2);
  });

  it("builds the coverage map and the method-and-field combination from verified parts", () => {
    const c = verifyComparison(good, req(), "m");
    const by = Object.fromEntries(c.coverage.map((r) => [r.facet, r]));
    expect(by.purpose!.status).toBe("covered");
    expect(by.evaluation!.status).toBe("similar");
    expect(by.mechanism!.papers[0]).toMatchObject({ id: "doi:10.1/a", match: "same" });
    expect(c.combination).toEqual({ found: ["doi:10.1/a"], compared: 2 });
    const none = verifyComparison({ papers: [good.papers[1]] }, req(), "m");
    expect(none.combination).toEqual({ found: [], compared: 2 });
    expect(none.coverage.every((r) => r.status === "none")).toBe(true);
  });

  it("survives garbage from the model", () => {
    for (const raw of [null, "text", {}, { papers: "x" }, { papers: [null, 5, { n: "1" }] }]) {
      const c = verifyComparison(raw, req(), "m");
      expect(c.comparisons).toHaveLength(3);
      expect(c.comparisons.every((x) => x.level === "unrelated" || x.level === "no_abstract")).toBe(true);
    }
  });
});

describe("levelOf", () => {
  const f = (p: string, m: string, e: string, d: string) => ({ purpose: facet(p), mechanism: facet(m), evaluation: facet(e), domain: facet(d) }) as never;
  it("is close only when three parts match and one of them is the purpose or the method", () => {
    expect(levelOf(f("same", "similar", "similar", "different"))).toBe("close");
    expect(levelOf(f("different", "different", "same", "same"))).toBe("partial");
    expect(levelOf(f("different", "different", "similar", "different"))).toBe("related");
    expect(levelOf(f("different", "different", "different", "different"))).toBe("unrelated");
  });
});

describe("compareIdea", () => {
  it("reads only the abstracts, in numbered order, and treats everything as untrusted", async () => {
    let seen = "";
    const stages: string[] = [];
    const out = await compareIdea({
      req: req(),
      stream: async (r) => {
        seen = r.user;
        expect(r.system).toBe(SYSTEM);
        return { json: { papers: [] }, model: "m" };
      },
      hooks: { onStage: (s) => stages.push(s) },
    });
    expect(seen).toContain("[1] Smartphone glaucoma screening (2022)");
    expect(seen).toContain("[2] Tonometry review (2019)");
    expect(seen).not.toContain("No abstract here");
    expect(SYSTEM).toMatch(/untrusted/);
    expect(stages).toEqual(["reading", "comparing", "checking"]);
    expect(out.compared).toBe(2);
  });

  it("does not call the model when no paper has an abstract", async () => {
    let calls = 0;
    const out = await compareIdea({ req: req({ papers: [{ id: "x", title: "t", year: 2020, abstract: "" }] }), stream: async () => (calls++, { json: {}, model: "m" }) });
    expect(calls).toBe(0);
    expect(out.compared).toBe(0);
    expect(out.comparisons[0]!.level).toBe("no_abstract");
  });

  it("works end to end with the offline stand-in, which includes one invented quote that must be dropped", async () => {
    const r = req({ papers: [1, 2, 3].map((i) => ({ id: `p${i}`, title: `Paper ${i}`, year: 2020, abstract: `${A1} Extra sentence number ${i} about the same work.` })) });
    const out = await compareIdea({ req: r, stream: stubCompareStream });
    expect(out.droppedClaims).toBe(1);
    expect(out.comparisons[2]!.facets.domain.match).toBe("unverified");
    expect(out.comparisons.slice(0, 2).every((c) => c.facets.purpose.match === "same" && !!c.facets.purpose.quote)).toBe(true);
  });

  it("the prompt names the parts the idea leaves out", () => {
    const p = buildComparePrompt(req({ facets: { purpose: "x", mechanism: "y", evaluation: "not stated", domain: "z" } }), req().papers.slice(0, 1));
    expect(p).toContain("evaluation: (not stated by the researcher)");
  });
});

describe("quoteIsInAbstract", () => {
  const abs = "We screen for glaucoma using smartphone fundus photographs and a convolutional neural network, tested against ophthalmologist grading in rural clinics.";
  it("accepts one continuous piece", () => {
    expect(quoteIsInAbstract("screen for glaucoma using smartphone fundus photographs", abs)).toBe(true);
  });
  it("accepts two real pieces joined with ... when they come in order", () => {
    expect(quoteIsInAbstract("screen for glaucoma ... tested against ophthalmologist grading", abs)).toBe(true);
    expect(quoteIsInAbstract("screen for glaucoma … tested against ophthalmologist grading", abs)).toBe(true);
  });
  it("rejects pieces in the wrong order, an invented piece, keywords strung together, and anything too short", () => {
    expect(quoteIsInAbstract("tested against ophthalmologist grading ... screen for glaucoma", abs)).toBe(false);
    expect(quoteIsInAbstract("screen for glaucoma ... measured on ten thousand patients", abs)).toBe(false);
    expect(quoteIsInAbstract("glaucoma ... smartphone ... neural network ... clinics", abs)).toBe(false);
    expect(quoteIsInAbstract("glaucoma ... smartphone", abs)).toBe(false);
    expect(quoteIsInAbstract("convolutional network", abs)).toBe(false);
  });
});
