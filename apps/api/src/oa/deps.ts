import { withGate, type GateName } from "../gate";
import type { SourceDeps } from "./sources";
import { stubFetch } from "./stub";

type DepsEnv = { ENABLE_DEV_ROUTES?: string; QA_STUB?: string; CROSSREF_MAILTO: string; OPENALEX_API_KEY?: string };

/** How long a step waits for its lane to let it start before giving up (the Workflow then tries the step again, later). */
const LANE_WAIT_MS = 30_000;

/**
 * What the readers of papers need from the outside world: the network (a stand-in in the local end-to-end run, QA_STUB=1 together with ENABLE_DEV_ROUTES=1), the limits of each
 * service (the shared lanes), and who we are (a contact address, which is the polite thing to send and what arXiv, Europe PMC and OpenAlex ask for).
 */
export function sourceDepsFor(env: DepsEnv, gate: typeof withGate = withGate): SourceDeps {
  const stub = env.ENABLE_DEV_ROUTES === "1" && env.QA_STUB === "1";
  return {
    ...(stub ? { fetchImpl: stubFetch } : { gated: <T,>(lane: GateName, run: () => Promise<T>) => gate(lane, LANE_WAIT_MS, () => run()) }),
    userAgent: `ScholarAI/1.0 (+https://sodhsetu.in; mailto:${env.CROSSREF_MAILTO})`,
    mailto: env.CROSSREF_MAILTO,
    openAlexKey: env.OPENALEX_API_KEY,
  };
}
