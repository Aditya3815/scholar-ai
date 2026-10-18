import type { IdeaPaper, IdeaSearchRequest, IdeaSearchResult } from "@scholar/shared";
import type { Complete } from "../docs/qa";
import { keywords } from "../docs/vector";

/**
 * Offline stand-ins for the language model and the literature services, used ONLY by tests and the local end-to-end run (QA_STUB=1 together
 * with ENABLE_DEV_ROUTES=1, neither of which is ever uploaded as a production secret). The plan is made from the idea's own most frequent
 * words; the search returns a fixed set of invented-looking records, labelled as such, so the pages and routes can be tested without a network.
 */
export const stubPlan: Complete = async ({ user }) => {
  const idea = /"""\n([\s\S]*?)\n"""/.exec(user)?.[1] ?? user;
  const counts = new Map<string, number>();
  for (const w of keywords(idea)) counts.set(w, (counts.get(w) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([w]) => w);
  const [a = "method", b = "data", c = "model", d = "study"] = top;
  const sentence = idea.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s/)[0]?.slice(0, 300) ?? "";
  return {
    model: "stub",
    json: {
      title: `Idea about ${a} and ${b}`,
      summary: `This idea is about ${a} and ${b}. ${sentence}`,
      facets: { purpose: `understand ${a}`, mechanism: `${b} ${c}`, evaluation: "not stated", domain: `${d}` },
      semanticQuery: `A study of ${a} and ${b} using a ${c} approach, applied to ${d}, with an evaluation on public data.`,
      keywordQueries: [`${a} ${b}`, `${b} ${c}`, `${a} ${d} ${c}`],
    },
  };
};

const RECORDS = [
  { title: "Closest prior work on the idea (sample record)", year: 2021, authors: ["Anita Desai", "Rahul Verma"], doi: "10.1234/sample.1", venue: "Journal of Sample Records" },
  { title: "A related method in another field (sample record)", year: 2019, authors: ["Meera Iyer"], doi: "10.1234/sample.2", venue: "Sample Proceedings" },
  { title: "A survey that mentions the idea (sample record)", year: 2023, authors: ["Kiran Rao", "J. Smith", "L. Chen", "P. Gupta"], doi: null, venue: "Sample Reviews" },
] as const;

export function stubSearch(req: IdeaSearchRequest): IdeaSearchResult {
  const papers: IdeaPaper[] = RECORDS.map((r, i) => ({
    id: r.doi ? `doi:${r.doi}` : `t:sample-${i}`,
    doi: r.doi,
    pmid: null,
    title: r.title,
    authors: [...r.authors],
    year: r.year,
    venue: r.venue,
    abstract: `Sample abstract ${i + 1} for the offline test: ${req.keywordQueries[0] ?? req.semanticQuery.slice(0, 80)}.`,
    citationCount: 10 * (i + 1),
    oaUrl: i === 0 ? "https://example.org/sample.pdf" : null,
    retracted: false,
    retractionSources: [],
    sources: i === 0 ? ["openalex", "s2"] : ["openalex"],
    score: 1 - i / 10,
    doiStatus: r.doi ? "verified" : undefined,
    relevance: 0.8 - i * 0.1,
    foundBy: i === 0 ? ["OpenAlex (meaning)", "Semantic Scholar"] : ["OpenAlex (meaning)"],
  }));
  return {
    papers,
    considered: 42,
    searched: [
      ...(req.semanticQuery ? [{ source: "openalex" as const, kind: "semantic" as const, query: req.semanticQuery, ok: true, count: 40 }] : []),
      ...req.keywordQueries.map((q) => ({ source: "openalex" as const, kind: "keyword" as const, query: q, ok: true, count: 20 })),
      ...req.keywordQueries.slice(0, 3).map((q) => ({ source: "s2" as const, kind: "keyword" as const, query: q, ok: true, count: 20 })),
    ],
    checked: { doi: true, retraction: true },
    tookMs: 1,
  };
}
