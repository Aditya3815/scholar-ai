import { describe, expect, it } from "vitest";
import { mergeAndRank } from "./merge";
import type { ProviderPaper } from "./types";

const p = (over: Partial<ProviderPaper>): ProviderPaper => ({
  doi: null, pmid: null, title: "A Paper", authors: [], year: 2020, venue: null, abstract: null, citationCount: null, oaUrl: null, retracted: false, ...over,
});

describe("mergeAndRank", () => {
  it("deduplicates by DOI across sources and unions the sources", () => {
    const out = mergeAndRank(
      {
        openalex: [p({ doi: "10.1/a", title: "Graph networks", authors: ["A One"], citationCount: 10 })],
        s2: [p({ doi: "10.1/a", title: "Graph networks", citationCount: 12, oaUrl: "https://x.org/a.pdf" })],
      },
      10,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ doi: "10.1/a", sources: ["openalex", "s2"], citationCount: 12, oaUrl: "https://x.org/a.pdf", authors: ["A One"] });
  });

  it("falls back to PMID and then to title+year when there is no DOI", () => {
    const out = mergeAndRank({ openalex: [p({ pmid: "7", title: "X marks" })], pubmed: [p({ pmid: "7", title: "X marks" }), p({ title: "No ids", year: 2019 })], s2: [p({ title: "No Ids", year: 2019 })] }, 10);
    expect(out).toHaveLength(2);
  });

  it("merges a preprint and its journal version (two DOIs, two years) by a long title and the first author", () => {
    const title = "Fine-Tuning Large Language Models for Relation Extraction within a Retrieval-Augmented Generation Framework";
    const out = mergeAndRank({ openalex: [p({ doi: "10.1/journal", title, year: 2025, authors: ["Sefika Efeoglu"] })], s2: [p({ doi: "10.48550/arxiv.1", title, year: 2024, authors: ["Efeoglu, Sefika"] })] }, 10);
    expect(out).toHaveLength(1);
    expect(out[0]!.sources).toEqual(["openalex", "s2"]);
  });

  it("does not merge a long title shared by different authors, a short title, or years far apart", () => {
    const title = "A Survey of Retrieval Augmented Generation Methods for Question Answering";
    expect(mergeAndRank({ a: [p({ doi: "10.1/1", title, year: 2024, authors: ["Ann Smith"] })], b: [p({ doi: "10.1/2", title, year: 2025, authors: ["Bo Jones"] })] }, 10)).toHaveLength(2);
    expect(mergeAndRank({ a: [p({ doi: "10.1/3", title: "Deep learning", year: 2020, authors: ["Ann Smith"] })], b: [p({ doi: "10.1/4", title: "Deep learning", year: 2021, authors: ["Ann Smith"] })] }, 10)).toHaveLength(2);
    expect(mergeAndRank({ a: [p({ doi: "10.1/5", title, year: 2015, authors: ["Ann Smith"] })], b: [p({ doi: "10.1/6", title, year: 2024, authors: ["Ann Smith"] })] }, 10)).toHaveLength(2);
  });

  it("is deterministic: merging in the same provider order gives the same output regardless of object build order", () => {
    const a = { openalex: [p({ doi: "10.1/a", title: "From OpenAlex", authors: ["O"] })], s2: [p({ doi: "10.1/a", title: "From S2", authors: ["S"] })] };
    const out = mergeAndRank(a, 5);
    expect(out[0]!.title).toBe("From OpenAlex"); // first provider supplies the base fields
  });

  it("ranks agreement between sources above a single source's top hit", () => {
    const out = mergeAndRank(
      {
        openalex: [p({ doi: "10.1/solo", title: "Solo" }), p({ doi: "10.1/both", title: "Both" })],
        s2: [p({ doi: "10.1/both", title: "Both" })],
      },
      5,
    );
    expect(out[0]!.doi).toBe("10.1/both");
  });

  it("ORs the retraction flag and remembers who raised it", () => {
    const out = mergeAndRank({ openalex: [p({ doi: "10.1/r", retracted: true })], s2: [p({ doi: "10.1/r" })] }, 5);
    expect(out[0]).toMatchObject({ retracted: true, retractionSources: ["openalex"] });
  });
});
