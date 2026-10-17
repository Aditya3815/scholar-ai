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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Semantic Scholar: best relevance ranking of the four (landmark papers rank first), plus OA PDF links.
 * Key limit = 1 request/second per key. Workers isolates share no state, so a strict global limiter needs a
 * Durable Object (Phase 1). For now: one retry after a 429, then the provider degrades gracefully.
 */
export const s2: Provider = {
  name: "s2",
  async search(q, limit, env, signal) {
    if (!env.S2_API_KEY) throw new Error("S2_API_KEY not configured");
    const params = new URLSearchParams({ query: q, limit: String(limit), fields: FIELDS });
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?${params}`;

    let res = await fetch(url, { signal, headers: { "x-api-key": env.S2_API_KEY } });
    if (res.status === 429) {
      await sleep(1100);
      res = await fetch(url, { signal, headers: { "x-api-key": env.S2_API_KEY } });
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
