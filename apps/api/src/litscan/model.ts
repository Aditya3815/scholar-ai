import type { LlmEnv } from "../platform/llm";
import type { SearchResponse, SearchScope } from "@scholar/shared";
import { runSearch } from "../search";
import { withGate } from "../gate";
import { searchEnvFrom, type SearchBindings } from "../search/env";
import type { Env } from "../platform/env";

/** What the scan needs from the Worker's environment, for the request that plans it and for the Workflow that runs it. */
export type ScanEnv = LlmEnv & SearchBindings & Pick<Env, "CHAT_JUDGE">;

/**
 * The scan's models are profiles (platform/llm/profiles.ts), all PRIVATE (the topic is the person's own text): `litscanPlan` plans it, `litscanAnswer` answers one sub-question (the same
 * private route, quota and ledger as the prompt box), `litscanJudge` is the support judge of one sub-question with its own short time limit (when the worker's limit fires the judge stops too,
 * and the answer stands as written, not marked as checked). Which model answers is the deps' (app/deps.ts).
 */

/** The search of one sub-question: what the prompt box does for a message, without the progressive lists, in the scan's scope (the regular sources, or only Indian ones). */
export function searchFor(env: ScanEnv, scope: SearchScope = "all"): (query: string) => Promise<SearchResponse> {
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
