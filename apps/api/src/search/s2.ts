import { normalizeDoi } from "./normalize";
import type { Provider, ProviderPaper } from "./types";

const FIELDS = "paperId,externalIds,title,abstract,year,venue,authors,citationCount,openAccessPdf";

type S2Paper = {
  title?: string | null;
  abstract?: string | null;
  year?: number | null;
  venue?: string | null;
  citationCount?: number | null;
  authors?: { name?: string }[];
  externalIds?: { DOI?: string; PubMed?: string } | null;
  openAccessPdf?: { url?: string } | null;
};

const MAX_QUEUE_MS = 3000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Semantic Scholar: best relevance ranking of the four (landmark papers rank first), plus OA PDF links.
 * Key limit = 1 request/second per key, enforced globally by the S2Throttle Durable Object (`env.s2Gate`). If the queue is
 * longer than MAX_QUEUE_MS the source is skipped for this search. Still one retry after a 429, then it degrades gracefully.
 */
export const s2: Provider = {
  name: "s2",
  async search(q, limit, env, signal) {
    if (!env.S2_API_KEY) throw new Error("S2_API_KEY not configured");
    const params = new URLSearchParams({ query: q, limit: String(limit), fields: FIELDS });
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?${params}`;

    /** Every attempt, including the retry, takes its own slot so concurrent searches cannot collide. */
    const attempt = async () => {
      if (env.s2Gate) {
        const wait = await env.s2Gate(MAX_QUEUE_MS);
        if (wait === null) throw new Error("Semantic Scholar is busy; skipped for this search");
        if (wait > 0) await sleep(wait);
      }
      return fetch(url, { signal, headers: { "x-api-key": env.S2_API_KEY! } });
    };

    let res = await attempt();
    if (res.status === 429) {
      if (!env.s2Gate) await sleep(1100);
      res = await attempt();
    }
    if (!res.ok) throw new Error(`Semantic Scholar HTTP ${res.status}`);
    const body = (await res.json()) as { data?: S2Paper[] };

    const out: ProviderPaper[] = [];
    for (const p of body.data ?? []) {
      if (!p.title) continue;
      out.push({
        doi: normalizeDoi(p.externalIds?.DOI),
        pmid: p.externalIds?.PubMed ?? null,
        title: p.title,
        authors: (p.authors ?? []).map((a) => a.name).filter((n): n is string => !!n).slice(0, 10),
        year: p.year ?? null,
        venue: p.venue || null,
        abstract: p.abstract ?? null,
        citationCount: p.citationCount ?? null,
        oaUrl: p.openAccessPdf?.url || null,
        retracted: false,
      });
    }
    return out;
  },
};
