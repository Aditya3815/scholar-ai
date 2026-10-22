import {
  IDEA_RESULTS,
  MAX_KEYWORD_QUERIES,
  MAX_KEYWORD_QUERY_CHARS,
  MAX_SEMANTIC_QUERY_CHARS,
  type IdeaPaper,
  type IdeaSearchEvent,
  type IdeaSearchRequest,
  type IdeaSearchResult,
  type IdeaSearched,
  type IdeaSource,
  type Paper,
} from "@scholar/shared";
import type { Embedder } from "../docs/embed";
import { cosine } from "../docs/vector";
import { applyDoiIntegrity, applyRetractions, runProvider } from "../search";
import { normalizeTitle } from "../search/normalize";
import { mergeAndRank } from "../search/merge";
import { arxiv } from "../search/arxiv";
import { openalexForIdea, openalexSemantic } from "../search/openalex";
import { pubmed } from "../search/pubmed";
import { s2 } from "../search/s2";
import type { ProviderPaper, SearchEnv } from "../search/types";
import { classifyWork } from "./kind";
import { scrubText } from "./plan";

const SEMANTIC_LIMIT = 40;
const MAX_MERGED = 80;
const SEMANTIC_TIMEOUT_MS = 10_000;
/** Semantic Scholar allows one request per second for the whole product: an idea may use at most this many of them. */
const MAX_S2_QUERIES = 3;
const MIN_SEMANTIC_CHARS = 30;
/** Weight of "how close in meaning" against "how many searches agreed" when ordering the papers. */
const W_MEANING = 0.7;

/** PubMed and arXiv are asked about the first two keyword searches only: arXiv allows one request every three seconds. */
const MAX_PUBMED_QUERIES = 2;
const MAX_ARXIV_QUERIES = 2;
const ARXIV_GAP_MS = 3100;

const LABEL: Record<string, string> = { "openalex:semantic": "OpenAlex (meaning)", "openalex:keyword": "OpenAlex (keywords)", "s2:keyword": "Semantic Scholar", "pubmed:keyword": "PubMed", "arxiv:keyword": "arXiv" };

/** The plan comes back from the browser: it is untrusted, so it is cleaned again here. */
export function sanitizeRequest(raw: unknown): IdeaSearchRequest | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const semanticQuery = scrubText(r.semanticQuery, MAX_SEMANTIC_QUERY_CHARS);
  const seen = new Set<string>();
  const keywordQueries: string[] = [];
  for (const k of Array.isArray(r.keywordQueries) ? r.keywordQueries : []) {
    const q = scrubText(k, MAX_KEYWORD_QUERY_CHARS);
    if (q.length < 3 || seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase());
    keywordQueries.push(q);
    if (keywordQueries.length >= MAX_KEYWORD_QUERIES) break;
  }
  const semantic = semanticQuery.length >= MIN_SEMANTIC_CHARS ? semanticQuery : "";
  return semantic || keywordQueries.length > 0 ? { semanticQuery: semantic, keywordQueries } : null;
}

const minMax = (xs: number[]): ((x: number) => number) => {
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  return (x) => (hi > lo ? (x - lo) / (hi - lo) : 0.5);
};

/** Which searches returned each merged paper (a paper is found through its DOI, PMID or title and year, as the merge decides). */
function foundBy(papers: Paper[], lists: Record<string, ProviderPaper[]>): Map<string, string[]> {
  const byDoi = new Map<string, Paper>();
  const byPmid = new Map<string, Paper>();
  const byTitle = new Map<string, Paper>();
  for (const p of papers) {
    if (p.doi) byDoi.set(p.doi, p);
    if (p.pmid) byPmid.set(p.pmid, p);
    byTitle.set(`${normalizeTitle(p.title)}|${p.year ?? ""}`, p);
  }
  const out = new Map<string, Set<string>>();
  for (const [key, list] of Object.entries(lists)) {
    const label = LABEL[key.replace(/:\d+$/, "")] ?? key;
    for (const item of list) {
      const hit = (item.doi && byDoi.get(item.doi)) || (item.pmid && byPmid.get(item.pmid)) || byTitle.get(`${normalizeTitle(item.title)}|${item.year ?? ""}`);
      if (!hit) continue;
      if (!out.has(hit.id)) out.set(hit.id, new Set());
      out.get(hit.id)!.add(label);
    }
  }
  return new Map([...out].map(([id, set]) => [id, [...set]]));
}

/**
 * The same work is often listed with different years (a preprint and its journal version; online-first and issue date), and the regular
 * merge only joins records whose title AND year agree. Here the year of the first listing is used for every record with the same
 * (long enough) title, so one work is one paper. Lists are also put in a fixed order, so the same answers always merge the same way.
 */
function prepare(lists: Record<string, ProviderPaper[]>): Record<string, ProviderPaper[]> {
  const yearOf = new Map<string, number | null>();
  const out: Record<string, ProviderPaper[]> = {};
  for (const key of Object.keys(lists).sort()) {
    out[key] = lists[key]!.map((p) => {
      const t = normalizeTitle(p.title);
      if (t.split(" ").length < 4) return p;
      if (!yearOf.has(t)) yearOf.set(t, p.year);
      return yearOf.get(t) === p.year ? p : { ...p, year: yearOf.get(t) ?? null };
    });
  }
  return out;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The services answer 429 when asked too fast (OpenAlex: its semantic search allows one request a second). A few of the idea's searches
 * go out together, so a 429 is retried after a pause instead of being reported as a service that did not answer.
 */
async function retryOn429<T>(run: () => Promise<T>, pauseMs: number, tries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      if (attempt + 1 >= tries || !/HTTP 429/.test(e instanceof Error ? e.message : "")) throw e;
      await sleep(pauseMs * (attempt + 1));
    }
  }
}

/** At most `n` of the jobs given to the returned function run at once; the rest wait their turn. */
function lane(n: number): <T>(job: () => Promise<T>) => Promise<T> {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async (job) => {
    if (running >= n) await new Promise<void>((resolve) => waiting.push(resolve));
    else running++;
    try {
      return await job();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else running--;
    }
  };
}

const toIdeaPaper = (p: Paper, by: Map<string, string[]>): IdeaPaper | null => {
  const kind = classifyWork({ workType: p.workType, doi: p.doi, venue: p.venue });
  return kind ? { ...p, kind, sources: toSources(p.sources), relevance: 0, foundBy: by.get(p.id) ?? [] } : null;
};

const toSources = (keys: string[]): IdeaSource[] => [...new Set(keys.map((k) => k.split(":")[0] as IdeaSource))];

/**
 * Step 2 of an Idea Check: search by meaning and by keywords in OpenAlex, by keywords in Semantic Scholar, merge, keep the papers closest in
 * meaning to the idea, then check every kept DOI and retraction status. A service that fails is reported, never hidden: the report
 * states what was searched. `emit` receives progress (the papers found so far, the stage) for the streaming route.
 */
export async function runIdeaSearch(input: { env: SearchEnv; embed: Embedder | null; req: IdeaSearchRequest; emit?: (e: IdeaSearchEvent) => void | Promise<void>; /** Pause before a retry after a 429 (tests pass 0). */ retryPauseMs?: number; /** Which extra sources to ask (default: all). The eval turns them off to measure what each one adds. */ sources?: { pubmed?: boolean; arxiv?: boolean }; /** Gap between two arXiv requests (tests pass 0). */ arxivGapMs?: number }): Promise<IdeaSearchResult> {
  const { env, embed, req } = input;
  const emit = input.emit ?? (() => {});
  const pause = input.retryPauseMs ?? 1100;
  const useSources = { pubmed: input.sources?.pubmed ?? true, arxiv: input.sources?.arxiv ?? true };
  const arxivGap = input.arxivGapMs ?? ARXIV_GAP_MS;
  const openalexLane = lane(2);
  const started = Date.now();
  const lists: Record<string, ProviderPaper[]> = {};
  const searched: IdeaSearched[] = [];
  const toIdea = (papers: Paper[], prepared: Record<string, ProviderPaper[]>): IdeaPaper[] => {
    const by = foundBy(papers, prepared);
    return papers.map((p) => toIdeaPaper(p, by)).filter((p): p is IdeaPaper => p !== null);
  };
  const snapshot = async () => {
    const prepared = prepare(lists);
    await emit({ type: "papers", papers: toIdea(mergeAndRank(prepared, IDEA_RESULTS), prepared), searched: [...searched] });
  };

  await emit({ type: "stage", stage: "searching" });

  const record = async (key: string, source: IdeaSource, kind: "semantic" | "keyword", query: string, run: () => Promise<ProviderPaper[]>) => {
    try {
      const found = await retryOn429(run, pause);
      lists[key] = found;
      searched.push({ source, kind, query, ok: true, count: found.length });
    } catch (e) {
      searched.push({ source, kind, query, ok: false, count: 0, error: e instanceof Error ? e.message : String(e) });
    }
    await snapshot();
  };

  const jobs: Promise<void>[] = [];
  if (req.semanticQuery) jobs.push(record("openalex:semantic", "openalex", "semantic", req.semanticQuery, () => openalexLane(() => openalexSemantic(req.semanticQuery, SEMANTIC_LIMIT, env, AbortSignal.timeout(SEMANTIC_TIMEOUT_MS)))));
  req.keywordQueries.forEach((q, i) => jobs.push(record(`openalex:keyword:${i}`, "openalex", "keyword", q, () => openalexLane(async () => (await runProvider(openalexForIdea, q, env)).value))));
  // Semantic Scholar goes one query after another: its 1-request-per-second allowance is shared by everyone.
  jobs.push(
    (async () => {
      for (const [i, q] of req.keywordQueries.slice(0, MAX_S2_QUERIES).entries()) await record(`s2:keyword:${i}`, "s2", "keyword", q, async () => (await runProvider(s2, q, env)).value);
    })(),
  );
  // PubMed (biomedicine) and arXiv (physics, maths, computing, statistics) for the first two keyword searches.
  if (useSources.pubmed) {
    jobs.push(
      (async () => {
        for (const [i, q] of req.keywordQueries.slice(0, MAX_PUBMED_QUERIES).entries()) await record(`pubmed:keyword:${i}`, "pubmed", "keyword", q, async () => (await runProvider(pubmed, q, env)).value);
      })(),
    );
  }
  if (useSources.arxiv) {
    jobs.push(
      (async () => {
        for (const [i, q] of req.keywordQueries.slice(0, MAX_ARXIV_QUERIES).entries()) {
          if (i > 0) await sleep(arxivGap); // arXiv asks for one request every three seconds
          await record(`arxiv:keyword:${i}`, "arxiv", "keyword", q, async () => (await runProvider(arxiv, q, env)).value);
        }
      })(),
    );
  }
  await Promise.all(jobs);

  const prepared = prepare(lists);
  // Records that are not works at all (front-page notices, errata, peer-review reports) are left out before anything is ranked.
  const merged = mergeAndRank(prepared, MAX_MERGED).filter((p) => classifyWork({ workType: p.workType, doi: p.doi, venue: p.venue }) !== null);
  const considered = merged.length;
  const by = foundBy(merged, prepared);

  // Keep the papers closest in meaning to the idea. Embedding failure is not fatal: the order then follows how many searches agreed.
  await emit({ type: "stage", stage: "ranking" });
  const queryText = req.semanticQuery || req.keywordQueries.join(". ");
  let cos: number[] | null = null;
  if (embed && merged.length > 0) {
    try {
      const vecs = await embed([queryText, ...merged.map((p) => `${p.title}. ${(p.abstract ?? "").slice(0, 1500)}`)]);
      cos = merged.map((_, i) => cosine(vecs[0]!, vecs[i + 1]!));
    } catch {
      cos = null;
    }
  }
  const rrf = merged.map((p) => p.score);
  const nRrf = minMax(rrf);
  const nCos = cos ? minMax(cos) : () => 0;
  const ranked = merged
    .map((p, i) => {
      const base = cos ? W_MEANING * nCos(cos[i]!) + (1 - W_MEANING) * nRrf(rrf[i]!) : nRrf(rrf[i]!);
      // a dataset or software record is hidden by default; it always ranks after every paper so it does not take their places
      return { p, i, order: base, data: classifyWork({ workType: p.workType, doi: p.doi, venue: p.venue }) === "data" };
    })
    .sort((a, b) => Number(a.data) - Number(b.data) || b.order - a.order)
    .slice(0, IDEA_RESULTS);
  const papers: IdeaPaper[] = ranked.map(({ p, i }) => ({
    ...toIdeaPaper(p, by)!,
    relevance: cos ? Math.max(0, Math.min(1, Math.round(cos[i]! * 1000) / 1000)) : 0,
  }));
  await emit({ type: "papers", papers, searched: [...searched] });

  await emit({ type: "stage", stage: "checking" });
  const doi = await applyDoiIntegrity(env, papers);
  const retraction = await applyRetractions(env, papers);

  return { papers, searched, considered, checked: { doi: doi.ok, retraction: retraction.ok }, tookMs: Date.now() - started };
}
