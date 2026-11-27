import { describe, expect, it } from "vitest";
import type { Paper } from "@scholar/shared";
import { citationHint, queryTerms, rerank } from "./rank";
import { mergeAndRank } from "./merge";

const mk = (id: string, title: string, o: Partial<Paper> = {}): Paper => ({
  id, doi: null, pmid: null, title, authors: [], year: 2020, venue: null, abstract: null, citationCount: 0, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 0.01, workType: null, ...o,
});

describe("queryTerms", () => {
  it("drops filler, keeps content and phrase", () => {
    const t = queryTerms("effect of the screen time on children's eyes")!;
    expect(t.stems).toContain("scree");
    expect(t.stems).not.toContain("the");
  });
  it("abstains on Devanagari or an empty query", () => {
    expect(queryTerms("बच्चों की आँखें")).toBeNull();
    expect(queryTerms("the of and")).toBeNull();
  });
});

describe("rerank", () => {
  it("puts the paper that is about the words above a better-fused one that is not", () => {
    const off = mk("a", "Battery explosion injuries from mobile phones", { score: 0.05, abstract: "A blast injury case." });
    const on = mk("b", "Screen time and myopia in children", { score: 0.02, abstract: "We study screen time and myopia among school children." });
    const out = rerank([off, on], "screen time myopia children", { thisYear: 2026 });
    expect(out.map((p) => p.id)).toEqual(["b", "a"]);
  });
  it("a whole-phrase title match beats a scattered abstract mention", () => {
    const scattered = mk("s", "Deep learning for images", { score: 0.03, abstract: "We also touch on medical topics and diagnosis tools for imaging." });
    const phrase = mk("p", "Medical image diagnosis with deep learning", { score: 0.03 });
    const out = rerank([scattered, phrase], "medical image diagnosis", { thisYear: 2026 });
    expect(out[0]!.id).toBe("p");
  });
  it("citations only nudge: they do not lift an off-topic paper", () => {
    const famous = mk("f", "Cooking pasta", { score: 0.03, citationCount: 100000 });
    const rel = mk("r", "Transformer attention for translation", { score: 0.03, citationCount: 10 });
    expect(rerank([famous, rel], "transformer attention translation", { thisYear: 2026 })[0]!.id).toBe("r");
  });
  it("demotes stub records", () => {
    const stub = mk("x", "Introduction", { score: 0.05, abstract: "neural networks" });
    const real = mk("y", "Neural networks in practice", { score: 0.02 });
    expect(rerank([stub, real], "neural networks", { thisYear: 2026 })[0]!.id).toBe("y");
  });
  it("is deterministic and keeps the order when the query cannot be judged", () => {
    const l = [mk("1", "A"), mk("2", "B")];
    expect(rerank(l, "बच्चों")).toBe(l);
  });
});

describe("mergeAndRank with a query", () => {
  it("reranks; without one it is plain fusion", () => {
    const lists = {
      openalex: [
        { doi: null, pmid: null, title: "Battery explosion injuries", authors: [], year: 2020, venue: null, abstract: null, citationCount: 5, oaUrl: null, retracted: false },
        { doi: null, pmid: null, title: "Screen time and myopia", authors: [], year: 2020, venue: null, abstract: null, citationCount: 5, oaUrl: null, retracted: false },
      ],
    };
    expect(mergeAndRank(lists, 5)[0]!.title).toMatch(/Battery/);
    expect(mergeAndRank(lists, 5, "screen time myopia")[0]!.title).toMatch(/Screen/);
  });
});

describe("known paper asked for by name", () => {
  it("the paper whose title is exactly what was typed outranks a paper that only shares words", () => {
    const near = mk("n", "Making Pre-trained Language Models Better Few-shot Learners", { score: 0.05, citationCount: 10 });
    const exact = mk("e", "Language Models are Few-Shot Learners", { score: 0.02, citationCount: 30000 });
    expect(rerank([near, exact], "Language models are few-shot learners", { thisYear: 2026 })[0]!.id).toBe("e");
  });
  it("a citation-style query ('Hochreiter 1997 Long short-term memory') is judged by the title words, the author and the year", () => {
    const other = mk("o", "Time series model with long short-term memory", { score: 0.05, year: 2025, authors: ["A. Other"] });
    const real = mk("r", "Long Short-Term Memory", { score: 0.02, year: 1997, authors: ["Sepp Hochreiter", "Jürgen Schmidhuber"] });
    expect(rerank([other, real], "Hochreiter 1997 Long short-term memory", { thisYear: 2026 })[0]!.id).toBe("r");
  });
});

describe("citationHint", () => {
  it("reads surname, year and the rest", () => {
    expect(citationHint("Vaswani 2017 Attention is all")).toEqual({ rest: "Attention is all", surname: "vaswani", year: 2017 });
    expect(citationHint("Breiman (2001), Random forests")?.rest).toBe("Random forests");
  });
  it("leaves ordinary searches alone", () => {
    for (const q of ["Attention is all you need", "diabetes 2019", "deep learning 2015 review"]) {
      expect(citationHint(q)).toBeNull();
    }
  });
});
