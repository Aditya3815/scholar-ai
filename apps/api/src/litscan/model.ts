import { stubPlanScan, stubScanSearch, stubScanStream } from "./stub";
import { stubJudgeStream } from "../chat/stub";
import type { Complete, StreamComplete } from "../platform/llm/port";
import { PROFILES, modelFor } from "../platform/llm/profiles";
import { gatewayModels } from "../platform/llm/models";
import type { LlmEnv } from "../platform/llm";
import type { SearchResponse, SearchScope } from "@scholar/shared";
import { runSearch } from "../search";
import { withGate } from "../gate";
import { searchEnvFrom, type SearchBindings } from "../search/env";
import type { Env } from "../platform/env";
import { standIns } from "../platform/dev";

/** What the scan needs from the Worker's environment, for the request that plans it and for the Workflow that runs it. */
export type ScanEnv = LlmEnv & SearchBindings & Pick<Env, "QA_STUB" | "CHAT_JUDGE">;

export const stubbed = (env: Pick<Env, "ENABLE_DEV_ROUTES" | "QA_STUB">) => standIns(env);

/** The planning call. The topic is the person's own text: PRIVATE, so the gateway only uses providers that do not keep or train on it. */
export function planModel(env: ScanEnv, subject: string): Complete {
  return stubbed(env) ? stubPlanScan : modelFor({ models: gatewayModels(env) }, PROFILES.litscanPlan, subject);
}

/** The answering call of one sub-question: the same private route, quota and ledger as the prompt box. `signal` is the time limit of that one worker. */
export function answerModel(env: ScanEnv, subject: string, signal: AbortSignal): StreamComplete {
  return stubbed(env) ? stubScanStream : modelFor({ models: gatewayModels(env) }, PROFILES.litscanAnswer, subject, signal);
}

/**
 * The support judge for one sub-question (chat/support.ts): the same private route as the prompt box's, with its own short time limit. `signal` is the worker's limit: when it fires
 * the judge stops too, and the answer stands as it was written (not marked as checked).
 */
export function judgeModel(env: ScanEnv, subject: string, signal: AbortSignal): StreamComplete {
  return stubbed(env) ? stubJudgeStream() : modelFor({ models: gatewayModels(env) }, PROFILES.litscanJudge, subject, signal);
}

/** The search of one sub-question: what the prompt box does for a message, without the progressive lists, in the scan's scope (the regular sources, or only Indian ones). */
export function searchFor(env: ScanEnv, scope: SearchScope = "all"): (query: string) => Promise<SearchResponse> {
  if (stubbed(env)) return async (q) => stubScanSearch(q, scope);
  const se = searchEnvFrom(env);
  return async (query) => {
    // the lane keeps a scan's searches from asking the sources all at once (see GATES.litscan); waiting there is not an error, a lane that stays busy for two minutes is
    const r = await withGate("litscan", 120_000, () => runSearch(se, query, 20, {}, scope));
    // a search that found nothing, or that some source did not answer, leaves one line (the sources' states and error words; no person, no text of the topic)
    const bad = Object.entries(r.providers).filter(([, p]) => !p.ok);
    if (r.results.length === 0 || bad.length > 0) {
      console.log(JSON.stringify({ level: "info", msg: "litscan_search", found: r.results.length, ms: r.tookMs, failed: Object.fromEntries(bad.map(([name, p]) => [name, String(p.error ?? "failed").slice(0, 80)])) }));
    }
    return r;
  };
}
