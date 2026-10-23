import type { IdeaPaper, IdeaSearchRequest, IdeaSearchResult } from "@scholar/shared";
import { extractJson } from "../llm/gateway";
import type { Complete, StreamComplete } from "../docs/qa";
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
  { title: "A dataset deposit about the topic (sample record)", year: 2022, authors: ["Data Team"], doi: "10.5281/zenodo.1", venue: "Zenodo" },
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
    abstract: `Sample abstract ${i + 1} for the offline test: ${req.keywordQueries[0] ?? req.semanticQuery.slice(0, 80)}. It describes a study of the topic in enough words to be compared with an idea, for the tests only. The method reached good accuracy on the sample data. A remaining limitation is that only a small sample was studied, and further work is needed.`,
    citationCount: 10 * (i + 1),
    oaUrl: i === 0 ? "https://example.org/sample.pdf" : null,
    retracted: false,
    retractionSources: [],
    sources: i === 0 ? ["openalex", "s2"] : ["openalex"],
    score: 1 - i / 10,
    doiStatus: r.doi ? "verified" : undefined,
    relevance: 0.8 - i * 0.1,
    kind: r.doi?.startsWith("10.5281/") ? "data" : "paper",
    foundBy: i === 0 ? ["OpenAlex (meaning)", "Semantic Scholar"] : ["OpenAlex (meaning)"],
  }));
  return {
    papers,
    considered: 42,
    searched: [
      ...(req.semanticQuery ? [{ source: "openalex" as const, kind: "semantic" as const, query: req.semanticQuery, ok: true, count: 40 }] : []),
      ...req.keywordQueries.map((q) => ({ source: "openalex" as const, kind: "keyword" as const, query: q, ok: true, count: 20 })),
      ...req.keywordQueries.slice(0, 3).map((q) => ({ source: "s2" as const, kind: "keyword" as const, query: q, ok: true, count: 20 })),
      ...req.keywordQueries.slice(0, 2).map((q) => ({ source: "pubmed" as const, kind: "keyword" as const, query: q, ok: true, count: 12 })),
      ...req.keywordQueries.slice(0, 2).map((q) => ({ source: "arxiv" as const, kind: "keyword" as const, query: q, ok: true, count: 9 })),
    ],
    checked: { doi: true, retraction: true },
    tookMs: 1,
  };
}

/**
 * What the model is shown for each paper, read back out of the prompt: its number, and its abstract's sentences by the numbers printed before them ("(1) ... (2) ...").
 * The offline models answer the way a real one is asked to: by sentence number.
 */
const papersInPrompt = (user: string) =>
  [...user.matchAll(/^\[(\d+)\] .*\n([\s\S]*?)(?=\n\n\[\d+\] |$)/gm)].map((m) => {
    const text = (m[2] ?? "").trim();
    const sentences = [...text.matchAll(/\((\d+)\) ([\s\S]*?)(?= \(\d+\) |$)/g)].map((s) => ({ s: Number(s[1]), text: (s[2] ?? "").trim() }));
    return { n: Number(m[1]), sentences, plain: sentences.map((s) => s.text).join(" ") };
  });
/** The number of the first sentence that matches `cue`, or 0. */
const numberOf = (sentences: { s: number; text: string }[], cue: RegExp) => sentences.find((x) => cue.test(x.text))?.s ?? 0;

/**
 * The second-reading model, offline. Papers 1 and 2 state a limitation and a result; paper 3 is pointed at a sentence number that does not exist, which verification
 * has to drop and count. A phrase for the method and for the data is copied, as a real model is asked to.
 */
export const stubInsightsStream: StreamComplete = async (req, hooks) => {
  const papers = papersInPrompt(req.user);
  const asked = !/asked no question/.test(req.user);
  const json = {
    open_problems: [
      ...papers.filter((p) => p.n <= 2).map((p) => ({ n: p.n, s: numberOf(p.sentences, /remaining limitation/) })),
      ...papers.filter((p) => p.n === 3).map((p) => ({ n: p.n, s: 99 })),
    ],
    papers: papers.map((p) => ({
      n: p.n,
      outcome: p.n === 1 ? "positive" : p.n === 2 ? "mixed" : "not_stated",
      outcome_s: p.n <= 2 ? numberOf(p.sentences, /reached good accuracy/) : 0,
      method_quote: p.n === 1 ? p.plain.split(/\s+/).slice(5, 13).join(" ") : "",
      data_quote: p.n === 1 ? "only a small sample was studied" : "",
    })),
    answer: asked
      ? [
          { statement: "The method reached good accuracy on the sample data.", n: 1, s: numberOf(papers[0]?.sentences ?? [], /reached good accuracy/) },
          { statement: "Smartphones are cheap and widely available.", n: 1, s: numberOf(papers[0]?.sentences ?? [], /remaining limitation/) },
        ]
      : [],
    opinion: ["Needs a few weeks of data collection and an ethics approval.", "This is a novel approach that nobody has tried.", "Some image-processing skill is needed."],
  };
  for (let i = 0; i < 3; i++) {
    hooks.onThinking?.();
    await new Promise((r) => setTimeout(r, 110));
  }
  const text = JSON.stringify(json);
  for (let i = 0; i < text.length; i += 40) {
    hooks.onContent?.(text.slice(i, i + 40));
    await new Promise((r) => setTimeout(r, 8));
  }
  return { json: extractJson(text), model: "stub" };
};

/** The comparison model, offline: purpose "same" (sentence 1) and mechanism "similar" (sentence 2, or 1) for every paper; paper 3's field is "same" with a sentence number that does not exist, which is dropped. */
export const stubCompareStream: StreamComplete = async (req, hooks) => {
  const papers = papersInPrompt(req.user);
  const json = {
    papers: papers.map(({ n, sentences }) => ({
      n,
      purpose: { match: "same", s: sentences.length >= 1 ? 1 : 0 },
      mechanism: { match: "similar", s: sentences.length >= 2 ? 2 : sentences.length },
      evaluation: { match: "not_stated", s: 0 },
      domain: n === 3 ? { match: "same", s: 99 } : { match: "different", s: 0 },
    })),
  };
  for (let i = 0; i < 3; i++) {
    hooks.onThinking?.();
    await new Promise((r) => setTimeout(r, 110));
  }
  const text = JSON.stringify(json);
  for (let i = 0; i < text.length; i += 40) {
    hooks.onContent?.(text.slice(i, i + 40));
    await new Promise((r) => setTimeout(r, 12));
  }
  return { json: extractJson(text), model: "stub" };
};
