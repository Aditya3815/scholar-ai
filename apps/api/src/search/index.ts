import type { ProviderStatus, SearchResponse } from "@scholar/shared";
import { cacheKey, cached } from "./cache";
import { crossref } from "./crossref";
import { mergeAndRank } from "./merge";
import { openalex } from "./openalex";
import { pubmed } from "./pubmed";
import { findRetracted } from "./retraction";
import type { Provider, ProviderPaper, SearchEnv } from "./types";

const PROVIDERS: Provider[] = [openalex, crossref, pubmed];
const PROVIDER_TIMEOUT_MS = 6000;
const SEARCH_TTL_S = 24 * 3600;
const RETRACTION_TTL_S = 24 * 3600;
const PER_PROVIDER = 20;

export const MAX_QUERY_LENGTH = 300;

async function runProvider(p: Provider, q: string, env: SearchEnv) {
  const t0 = Date.now();
  const key = await cacheKey(`search:${p.name}`, q.toLowerCase(), String(PER_PROVIDER));
  const { value, hit } = await cached<ProviderPaper[]>(env.DB, `search:${p.name}`, key, SEARCH_TTL_S, () =>
    p.search(q, PER_PROVIDER, env, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)),
  );
  return { value, status: { ok: true, count: value.length, ms: Date.now() - t0, cached: hit } satisfies ProviderStatus };
}

/** Multi-source search: parallel fetch, partial failure tolerated, dedup + RRF, retraction flag. */
export async function runSearch(env: SearchEnv, q: string, limit: number): Promise<SearchResponse> {
  const started = Date.now();

  const settled = await Promise.allSettled(PROVIDERS.map((p) => runProvider(p, q, env)));
  const lists: Record<string, ProviderPaper[]> = {};
  const providers: Record<string, ProviderStatus> = {};
  settled.forEach((r, i) => {
    const name = PROVIDERS[i]!.name;
    if (r.status === "fulfilled") {
      lists[name] = r.value.value;
      providers[name] = r.value.status;
    } else {
      providers[name] = {
        ok: false,
        count: 0,
        ms: Date.now() - started,
        cached: false,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      };
    }
  });

  const results = mergeAndRank(lists, limit);

  // Retraction check: Crossref/Retraction Watch, ek batch call. Fail ho toh results phir bhi dikhte hain.
  const t1 = Date.now();
  let retractionCheck: ProviderStatus = { ok: true, count: 0, ms: 0, cached: false };
  const dois = results.map((r) => r.doi).filter((d): d is string => !!d);
  if (dois.length > 0) {
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
      retractionCheck = { ok: true, count: retracted.size, ms: Date.now() - t1, cached: hit };
    } catch (err) {
      retractionCheck = {
        ok: false,
        count: 0,
        ms: Date.now() - t1,
        cached: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return { query: q, results, providers, retractionCheck, tookMs: Date.now() - started };
}
