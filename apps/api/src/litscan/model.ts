import { stubPlanScan, stubScanSearch, stubScanStream } from "./stub";
import type { Complete, StreamComplete } from "../docs/qa";
import { gatewayFromEnv, type LlmEnv } from "../llm";
import { cacheStore } from "../cache";
import type { SearchEnv } from "../search/types";
import type { S2Throttle } from "../s2-throttle";
import type { SearchResponse } from "@scholar/shared";
import { runSearch } from "../search";
import { withGate } from "../gate";

/** What the scan needs from the Worker's environment, for the request that plans it and for the Workflow that runs it. */
export type ScanEnv = LlmEnv & {
  DB: D1Database;
  S2_THROTTLE: DurableObjectNamespace<S2Throttle>;
  CROSSREF_MAILTO: string;
  OPENALEX_API_KEY?: string;
  NCBI_API_KEY?: string;
  S2_API_KEY?: string;
  CORE_API_KEY?: string;
  ENABLE_DEV_ROUTES?: string;
  /** "1" (with ENABLE_DEV_ROUTES) swaps the model and the search for stand-ins in local tests. */
  QA_STUB?: string;
};

export const stubbed = (env: Pick<ScanEnv, "ENABLE_DEV_ROUTES" | "QA_STUB">) => env.ENABLE_DEV_ROUTES === "1" && env.QA_STUB === "1";

/** The planning call. The topic is the person's own text: PRIVATE, so the gateway only uses providers that do not keep or train on it. */
export function planModel(env: ScanEnv, subject: string): Complete {
  if (stubbed(env)) return stubPlanScan;
  const gateway = gatewayFromEnv(env);
  return async (req) => {
    const r = await gateway.complete({ task: "qa", sensitivity: "private", subject, system: req.system, user: req.user, schema: req.schema, maxTokens: req.maxTokens, timeoutMs: 45_000, label: req.label });
    return { json: r.json, model: r.model };
  };
}

/** The answering call of one sub-question: the same private route, quota and ledger as the prompt box. `signal` is the time limit of that one worker. */
export function answerModel(env: ScanEnv, subject: string, signal: AbortSignal): StreamComplete {
  if (stubbed(env)) return stubScanStream;
  const gateway = gatewayFromEnv(env);
  return async (req, hooks) => {
    const r = await gateway.stream({ task: "qa", sensitivity: "private", subject, system: req.system, user: req.user, schema: req.schema, maxTokens: req.maxTokens, timeoutMs: 80_000, label: req.label }, hooks, signal);
    return { json: r.json, model: r.model };
  };
}

export const searchEnvOf = (env: ScanEnv): SearchEnv => ({
  store: cacheStore(env),
  OPENALEX_API_KEY: env.OPENALEX_API_KEY,
  NCBI_API_KEY: env.NCBI_API_KEY,
  S2_API_KEY: env.S2_API_KEY,
  CORE_API_KEY: env.CORE_API_KEY,
  CROSSREF_MAILTO: env.CROSSREF_MAILTO,
  s2Gate: (maxWaitMs) => env.S2_THROTTLE.getByName("global").reserve(maxWaitMs),
});

/** The search of one sub-question: what the prompt box does for a message, without the progressive lists. */
export function searchFor(env: ScanEnv): (query: string) => Promise<SearchResponse> {
  if (stubbed(env)) return async (q) => stubScanSearch(q);
  const se = searchEnvOf(env);
  return async (query) => {
    // the lane keeps a scan's searches from asking the sources all at once (see GATES.litscan); waiting there is not an error, a lane that stays busy for two minutes is
    const r = await withGate("litscan", 120_000, () => runSearch(se, query, 20));
    // a search that found nothing, or that some source did not answer, leaves one line (the sources' states and error words; no person, no text of the topic)
    const bad = Object.entries(r.providers).filter(([, p]) => !p.ok);
    if (r.results.length === 0 || bad.length > 0) {
      console.log(JSON.stringify({ level: "info", msg: "litscan_search", found: r.results.length, ms: r.tookMs, failed: Object.fromEntries(bad.map(([name, p]) => [name, String(p.error ?? "failed").slice(0, 80)])) }));
    }
    return r;
  };
}
