import { withGate, type GateName } from "../gate";
import type { SourceDeps } from "./sources";
import type { Env } from "../platform/env";

type DepsEnv = Pick<Env, "CROSSREF_MAILTO" | "OPENALEX_API_KEY">;

/** How long a step waits for its lane to let it start before giving up (the Workflow then tries the step again, later). */
const LANE_WAIT_MS = 30_000;

/**
 * What the readers of papers need from the outside world: the network (`fetchImpl`: deps.fetch.papers, the stand-in of a test run, which takes no lane), the limits of each
 * service (the shared lanes), and who we are (a contact address, which is the polite thing to send and what arXiv, Europe PMC and OpenAlex ask for).
 */
export function sourceDepsFor(env: DepsEnv, fetchImpl?: typeof fetch): SourceDeps {
  return {
    ...(fetchImpl ? { fetchImpl } : { gated: <T,>(lane: GateName, run: () => Promise<T>) => withGate(lane, LANE_WAIT_MS, () => run()) }),
    userAgent: `Sodhsetu/1.0 (+https://sodhsetu.in; mailto:${env.CROSSREF_MAILTO})`,
    mailto: env.CROSSREF_MAILTO,
    openAlexKey: env.OPENALEX_API_KEY,
  };
}
