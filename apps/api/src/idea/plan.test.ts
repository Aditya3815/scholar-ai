import { describe, expect, it } from "vitest";
import { SYSTEM, buildPlanPrompt, planIdea, sanitizePlan, scrubText, PlanError } from "./plan";
import { stubPlan } from "./stub";

describe("scrubText", () => {
  it("takes out e-mail addresses and links, control characters and extra space, and bounds the length", () => {
    expect(scrubText("write to  anita@univ.ac.in or see https://lab.example/x and www.lab.example now", 200)).toBe("write to or see and now");
    expect(scrubText("a\u0000b\n\nc   d", 50)).toBe("a b c d");
    expect(scrubText("x".repeat(500), 40)).toHaveLength(40);
    expect(scrubText(42, 10)).toBe("");
  });
});

describe("sanitizePlan", () => {
  const good = {
    title: "  Low-cost screening for glaucoma ",
    summary: "A plan to screen for glaucoma in rural clinics. It uses a phone camera.",
    facets: { purpose: "screen glaucoma", mechanism: "phone fundus camera + CNN", evaluation: "sensitivity on 500 eyes", domain: "rural ophthalmology" },
    semanticQuery: "We study smartphone-based fundus imaging with a convolutional network to screen for glaucoma in rural clinics.",
    keywordQueries: ["smartphone fundus imaging", "glaucoma screening deep learning", "  rural eye screening ", "smartphone fundus imaging"],
  };

  it("keeps a good plan, trimmed, with duplicate queries removed", () => {
    const p = sanitizePlan(good);
    expect(p.title).toBe("Low-cost screening for glaucoma");
    expect(p.keywordQueries).toEqual(["smartphone fundus imaging", "glaucoma screening deep learning", "rural eye screening"]);
    expect(p.facets.mechanism).toBe("phone fundus camera + CNN");
  });

  it("removes e-mail addresses and links the model let through, in every field that is sent out", () => {
    const p = sanitizePlan({ ...good, semanticQuery: `${good.semanticQuery} Contact me@x.org https://secret.lab/data`, keywordQueries: ["glaucoma me@x.org screening", "see https://a.b/c glaucoma"] });
    expect(p.semanticQuery).not.toMatch(/@|https?:/);
    expect(p.keywordQueries.join(" ")).not.toMatch(/@|https?:/);
  });

  it("caps the number and length of queries and drops one-word queries", () => {
    const p = sanitizePlan({ ...good, keywordQueries: ["single", ...Array.from({ length: 12 }, (_, i) => `query number ${i}`), `${"long ".repeat(60)}`] });
    expect(p.keywordQueries.length).toBeLessThanOrEqual(6);
    expect(p.keywordQueries.every((q) => q.length <= 100 && q.split(" ").length >= 2)).toBe(true);
  });

  it("fills what is missing: the summary stands in for the paragraph, the facets for the queries", () => {
    const p = sanitizePlan({ summary: "Short summary of the idea.", facets: { purpose: "detect fraud", mechanism: "graph analysis", evaluation: "", domain: "banking" }, keywordQueries: [] });
    expect(p.semanticQuery).toBe("Short summary of the idea.");
    expect(p.facets.evaluation).toBe("not stated");
    expect(p.keywordQueries).toEqual(["detect fraud banking", "graph analysis banking"]);
  });

  it("refuses an answer with nothing to search for, and survives garbage", () => {
    expect(() => sanitizePlan({})).toThrow(PlanError);
    expect(() => sanitizePlan(null)).toThrow(PlanError);
    expect(() => sanitizePlan("text")).toThrow(PlanError);
    expect(sanitizePlan({ summary: "Something worth searching for here.", keywordQueries: "not a list", facets: 5 }).summary).toBe("Something worth searching for here.");
  });
});

describe("planIdea", () => {
  it("sends the idea (cut to what the model reads) and the question to the model, and returns a clean plan", async () => {
    let seen = "";
    const out = await planIdea({
      text: `${"idea ".repeat(5000)}`,
      question: "Has this been done in India?",
      complete: async (req) => {
        seen = req.user;
        expect(req.system).toBe(SYSTEM);
        return { model: "m", json: { title: "T", summary: "Summary of an idea.", facets: {}, semanticQuery: "A paragraph about the idea and its method, long enough.", keywordQueries: ["idea method", "other words"] } };
      },
    });
    expect(seen).toContain("Has this been done in India?");
    expect(seen.length).toBeLessThan(12_400);
    expect(out.plan.keywordQueries).toEqual(["idea method", "other words"]);
    expect(out.model).toBe("m");
  });

  it("tells the model to treat the idea as untrusted and to keep identifying details out of the queries", () => {
    expect(SYSTEM).toMatch(/untrusted/);
    expect(SYSTEM).toMatch(/PRIVACY/);
    expect(buildPlanPrompt("my idea", "")).not.toMatch(/question/i);
  });

  it("the offline stand-in produces a usable plan", async () => {
    const out = await planIdea({ text: "We propose graph neural networks for detecting fraudulent invoices in small banks. The method is tested on public data.", question: "", complete: stubPlan });
    expect(out.plan.keywordQueries.length).toBeGreaterThanOrEqual(2);
    expect(out.plan.semanticQuery.length).toBeGreaterThan(30);
  });
});
