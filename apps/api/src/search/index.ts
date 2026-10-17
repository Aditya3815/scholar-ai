import type { Paper, ProviderStatus, SearchResponse, SearchSnapshot } from "@scholar/shared";
import { cacheKey, cached } from "./cache";
import { crossref } from "./crossref";
import { mergeAndRank } from "./merge";
import { openalex } from "./openalex";
import { pubmed } from "./pubmed";
import { findRetracted } from "./retraction";
import { s2 } from "./s2";
import type { Provider, ProviderPaper, SearchEnv } from "./types";

const PROVIDERS: Provider[] = [openalex, s2, crossref, pubmed];
const PROVIDER_TIMEOUT_MS = 6000;
const SEARCH_TTL_S = 24 * 3600;
const RETRACTION_TTL_S = 24 * 3600;
const PER_PROVIDER = 20;

export const MAX_QUERY_LENGTH = 300;
export type SearchHooks = {
  /** Har provider ke settle hone par merged snapshot (retraction flags se pehle). */
  onSnapshot?: (s: SearchSnapshot) => void | Promise<void>;
};

async function runProvider(p: Provider, q: string, env: SearchEnv) {
  const t0 = Date.now();
  const key = await cacheKey(`search:${p.name}`, q.toLowerCase(), String(PER_PROVIDER));
  const { value, hit } = await cached<ProviderPaper[]>(env.DB, `search:${p.name}`, key, SEARCH_TTL_S, () =>
    p.search(q, PER_PROVIDER, env, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)),
  );
  return { value, status: { ok: true, count: value.length, ms: Date.now() - t0, cached: hit } satisfies ProviderStatus };
}

/** Crossref/Retraction Watch batch check; results ko in-place flag karta hai. Fail ho toh results phir bhi dikhte hain. */
async function applyRetractions(env: SearchEnv, results: Paper[]): Promise<ProviderStatus> {
  const t1 = Date.now();
  const dois = results.map((r) => r.doi).filter((d): d is string => !!d);
  if (dois.length === 0) return { ok: true, count: 0, ms: 0, cached: false };
  try {
    const key = await cacheKey("retraction", [...new Set(dois)].sort().join("|"));
    const { value, hit } = await cached<string[]>(env.DB, "retraction", key, RETRACTION_TTL_S, () =>
      findRetracted(dois, env, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)),
    );
    const retracted = new Set(value);
    for (const r of results) {
      if (r.doi && retracted.has(r.doi)) {
        r.retracted = true;
        if (!r.retractionSources.includes("crossref-retraction-watch")) {
          r.retractionSources.push("crossref-retraction-watch");
        }
      }
    }
    return { ok: true, count: retracted.size, ms: Date.now() - t1, cached: hit };
  } catch (err) {
    return {
      ok: false,
      count: 0,
      ms: Date.now() - t1,
      cached: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Multi-source search: parallel fetch, partial failure tolerated, dedup + RRF, retraction flag. */
export async function runSearch(
  env: SearchEnv,
  q: string,
  limit: number,
  hooks: SearchHooks = {},
): Promise<SearchResponse> {
  const started = Date.now();
  const lists: Record<string, ProviderPaper[]> = {};
  const providers: Record<string, ProviderStatus> = {};

  await Promise.all(
    PROVIDERS.map(async (p) => {
      try {
        const r = await runProvider(p, q, env);
        lists[p.name] = r.value;
        providers[p.name] = r.status;
      } catch (err) {
        providers[p.name] = {
          ok: false,
          count: 0,
          ms: Date.now() - started,
          cached: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
      await hooks.onSnapshot?.({ results: mergeAndRank(lists, limit), providers: { ...providers } });
    }),
  );

  const results = mergeAndRank(lists, limit);
  const retractionCheck = await applyRetractions(env, results);
  return { query: q, results, providers, retractionCheck, tookMs: Date.now() - started };
}
