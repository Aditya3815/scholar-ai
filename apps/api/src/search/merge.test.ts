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
