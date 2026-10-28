import type { Paper, ProviderStatus, SearchResponse, SearchScope, SearchSnapshot } from "@scholar/shared";
import { cacheKey, cached } from "./cache";
import { applyDoiChecks, checkDois } from "./doi-check";
import { crossref } from "./crossref";
import { mergeAndRank } from "./merge";
import { openalex } from "./openalex";
import { pubmed } from "./pubmed";
import { retractedDois } from "./retraction";
import { doajIndia, openalexIndia, shodhganga } from "./india";
import { FEW_RESULTS, interleave, queryVariants } from "./query";
import { s2 } from "./s2";
import type { Provider, ProviderPaper, SearchEnv } from "./types";

/**
 * The sources of each scope, in the order their answers are merged. The regular search is unchanged by the Indian one: the search eval replays recorded answers of
 * these four. In the Indian scope the OpenAlex list comes first, so a paper it shares with DOAJ takes its fields (citations, retraction flag) from OpenAlex.
 */
const SCOPES: Record<SearchScope, Provider[]> = {
  all: [openalex, s2, crossref, pubmed],
  india: [openalexIndia, doajIndia, shodhganga],
};
const PROVIDER_TIMEOUT_MS = 6000;
const SEARCH_TTL_S = 24 * 3600;
const PER_PROVIDER = 20;

export const MAX_QUERY_LENGTH = 300;
export type SearchHooks = {
  /** Har provider ke settle hone par merged snapshot (retraction flags se pehle). */
  onSnapshot?: (s: SearchSnapshot) => void | Promise<void>;
};

/**
 * Providers answer in whatever order the network decides, and merging is order-sensitive (the first provider to describe a paper
 * supplies its base fields; ties keep insertion order). Always merge in the fixed PROVIDERS order so the same responses give the
 * same results, in production and in the eval.
 */
function inProviderOrder(providers: Provider[], lists: Record<string, ProviderPaper[]>): Record<string, ProviderPaper[]> {
  return Object.fromEntries(providers.filter((p) => lists[p.name]).map((p) => [p.name, lists[p.name]!]));
}

export async function runProvider(p: Provider, q: string, env: SearchEnv) {
  const t0 = Date.now();
  const key = await cacheKey(`search:${p.name}`, q.toLowerCase(), String(PER_PROVIDER));
  const { value, hit } = await cached<ProviderPaper[]>(env.store, `search:${p.name}`, key, SEARCH_TTL_S, () =>
    p.search(q, PER_PROVIDER, env, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)),
  );
  return { value, status: { ok: true, count: value.length, ms: Date.now() - t0, cached: hit } satisfies ProviderStatus };
}

/**
 * Removes DOIs that do not exist or that belong to a different record (see doi-check.ts). `count` = DOIs removed.
 * If the check itself fails the results are shown unchanged and `doiStatus` stays unset (never dropped on an error).
 */
export async function applyDoiIntegrity(env: SearchEnv, results: Paper[]): Promise<ProviderStatus> {
  const t0 = Date.now();
  const dois = results.map((r) => r.doi).filter((d): d is string => !!d);
  if (dois.length === 0) return { ok: true, count: 0, ms: 0, cached: false };
  try {
    const checks = await checkDois(dois, env, AbortSignal.timeout(PROVIDER_TIMEOUT_MS + 4000));
    return { ok: true, count: applyDoiChecks(results, checks), ms: Date.now() - t0, cached: false };
  } catch (err) {
    return { ok: false, count: 0, ms: Date.now() - t0, cached: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Crossref/Retraction Watch batch check; results ko in-place flag karta hai. Fail ho toh results phir bhi dikhte hain. */
export async function applyRetractions(env: SearchEnv, results: Paper[]): Promise<ProviderStatus> {
  const t1 = Date.now();
  const dois = results.map((r) => r.doi).filter((d): d is string => !!d);
  if (dois.length === 0) return { ok: true, count: 0, ms: 0, cached: false };
  try {
    const { retracted, fromCache } = await retractedDois(env.store, dois, env, AbortSignal.timeout(PROVIDER_TIMEOUT_MS));
    for (const r of results) {
      if (r.doi && retracted.has(r.doi)) {
        r.retracted = true;
        if (!r.retractionSources.includes("crossref-retraction-watch")) {
          r.retractionSources.push("crossref-retraction-watch");
        }
      }
    }
    return { ok: true, count: retracted.size, ms: Date.now() - t1, cached: fromCache };
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

/** Multi-source search: parallel fetch, partial failure tolerated, dedup + RRF, retraction flag. `scope` picks the sources (SCOPES). */
export async function runSearch(
  env: SearchEnv,
  q: string,
  limit: number,
  hooks: SearchHooks = {},
  scope: SearchScope = "all",
): Promise<SearchResponse> {
  const PROVIDERS = SCOPES[scope];
  const ordered = (lists: Record<string, ProviderPaper[]>) => inProviderOrder(PROVIDERS, lists);
  const started = Date.now();
  const lists: Record<string, ProviderPaper[]> = {};
  const providers: Record<string, ProviderStatus> = {};
  let alsoSearched: string[] = [];

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
      await hooks.onSnapshot?.({ results: mergeAndRank(ordered(lists), limit), providers: { ...providers }, alsoSearched });
    }),
  );

  // Few papers found, and the search has a name written as one word ("SwinYolo"): search again with it written as the words it is, and add what that finds.
  if (Object.keys(lists).length > 0 && mergeAndRank(ordered(lists), 100).length < FEW_RESULTS) {
    const variants = queryVariants(q);
    if (variants.length > 0) {
      alsoSearched = variants;
      await Promise.all(
        PROVIDERS.filter((p) => lists[p.name]).map(async (p) => {
          const extra = await Promise.all(variants.map((v) => runProvider(p, v, env).then((r) => r.value, () => [] as ProviderPaper[])));
          lists[p.name] = interleave([lists[p.name]!, ...extra]);
          providers[p.name] = { ...providers[p.name]!, count: lists[p.name]!.length };
        }),
      );
      await hooks.onSnapshot?.({ results: mergeAndRank(ordered(lists), limit), providers: { ...providers }, alsoSearched });
    }
  }

  const results = mergeAndRank(ordered(lists), limit);
  const doiCheck = await applyDoiIntegrity(env, results);
  const retractionCheck = await applyRetractions(env, results); // after the DOI check, so removed DOIs are not looked up
  return { query: q, results, providers, doiCheck, retractionCheck, tookMs: Date.now() - started, ...(alsoSearched.length ? { alsoSearched } : {}), ...(scope !== "all" ? { scope } : {}) };
}
