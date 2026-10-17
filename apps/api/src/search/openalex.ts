import { invertedIndexToText, normalizeDoi, sanitizeQuery } from "./normalize";
import type { Provider, ProviderPaper } from "./types";

const SELECT =
  "id,doi,title,publication_year,cited_by_count,is_retracted,primary_location,open_access,authorships,abstract_inverted_index,ids";

type OAWork = {
  doi?: string | null;
  title?: string | null;
  publication_year?: number | null;
  cited_by_count?: number | null;
  is_retracted?: boolean | null;
  primary_location?: { source?: { display_name?: string | null } | null } | null;
  open_access?: { oa_url?: string | null } | null;
  authorships?: { author?: { display_name?: string | null } | null }[];
  abstract_inverted_index?: Record<string, number[]> | null;
  ids?: { pmid?: string | null };
};

/**
 * Cost note: har call ~$0.001 (OpenAlex Feb 2026 pricing, $1/day free) => ~1000 uncached calls/day.
 * Isliye orchestrator is provider ko 24h cache ke saath chalata hai.
 * `search=` full-text hai (noisy); title_and_abstract filter relevance ke liye behtar nikla.
 */
export const openalex: Provider = {
  name: "openalex",
  async search(q, limit, env, signal) {
    const clean = sanitizeQuery(q);
    if (!clean) return [];
    const params = new URLSearchParams({
      filter: `title_and_abstract.search:${clean}`,
      "per-page": String(limit),
      select: SELECT,
    });
    if (env.OPENALEX_API_KEY) params.set("api_key", env.OPENALEX_API_KEY);

    const res = await fetch(`https://api.openalex.org/works?${params}`, { signal });
    if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status}`);
    const body = (await res.json()) as { results?: OAWork[] };

    const out: ProviderPaper[] = [];
    for (const w of body.results ?? []) {
      if (!w.title) continue;
      const pmidMatch = w.ids?.pmid?.match(/(\d+)\/?$/);
      out.push({
        doi: normalizeDoi(w.doi),
        pmid: pmidMatch ? pmidMatch[1]! : null,
        title: w.title,
        authors: (w.authorships ?? [])
          .map((a) => a.author?.display_name)
          .filter((n): n is string => !!n)
          .slice(0, 10),
        year: w.publication_year ?? null,
        venue: w.primary_location?.source?.display_name ?? null,
        abstract: invertedIndexToText(w.abstract_inverted_index),
        citationCount: w.cited_by_count ?? null,
        oaUrl: w.open_access?.oa_url ?? null,
        retracted: w.is_retracted === true,
      });
    }
    return out;
  },
};
