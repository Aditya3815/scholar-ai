import { isoDay } from "@scholar/shared";
import { runTrending, type TrendingJobEnv, type TrendingResult } from "../job";
import { STUB_FAULT_KEY, STUB_SUBFIELDS, makeStubTrending, parseStubFault } from "./stub";

/**
 * The Trending job of a test run (app/stand-ins.ts; QA_STUB=1 with ENABLE_DEV_ROUTES=1, never in production): the job's own code over the stand-ins of stub.ts, with no real waiting (a clock of
 * its own that only the pauses move: the KV's pause between two writes of a key, the pause between arXiv requests). Without KV bound there is nowhere to keep a list: it does nothing, and says so,
 * as the real job does.
 */
export async function runTrendingStandIn(env: TrendingJobEnv, scheduledTime: number): Promise<TrendingResult> {
  const kv = env.CACHE;
  if (!kv) return { skipped: "no_kv", asOf: isoDay(scheduledTime), calls: 0, kvOps: 0, ms: 0 };
  let now = scheduledTime;
  // a stand-in can be made to fail from outside, for the local end-to-end run (stub.ts, STUB_FAULT_KEY, written through the development route /api/v1/dev/kv): read here and nowhere else
  const stub = makeStubTrending({ asOf: () => isoDay(scheduledTime), fault: parseStubFault(await kv.get(STUB_FAULT_KEY)) });
  return runTrending({ kv, mailto: env.CROSSREF_MAILTO, fetch: stub.fetch, search: stub.search, sleep: async (ms) => void (now += ms), clock: () => now, subfields: STUB_SUBFIELDS, variable: env.TRENDING, lane: false }, scheduledTime);
}
