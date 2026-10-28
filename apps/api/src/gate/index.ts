import { GateCore, type Acquired, type GateConfig } from "./core";

/**
 * The services we call that limit how fast they may be asked. What each one says about itself (response headers, 24 Oct 2026):
 *   Crossref, polite pool (a `mailto` is sent): 3 requests per second and 3 at once (`x-rate-limit-limit`, `x-concurrency-limit`).
 *     Exactly that: a start every 340 ms (a little under 3 a second, measured: 24 calls at 3 a second all answered, at 6 a second 4 of 47 got a 429) and three at once.
 *   CORE, with a key: 10 requests per minute (`x-ratelimit-limit`; the eleventh gets a 429 and `x-ratelimit-retry-after`); a daily
 *     allowance of 1,000 requests is documented by CORE but nothing in the responses shows it, so 800 are used and the rest is left for development.
 */
export const GATES = {
  crossref: { minIntervalMs: 340, maxConcurrent: 3, leaseMs: 20_000 },
  core: { minIntervalMs: 1_000, maxConcurrent: 1, window: { max: 9, ms: 60_000 }, dailyBudget: 800, leaseMs: 20_000 },
  // The open-access ingest (W4). Europe PMC and OpenAlex ask for reasonable use and answer fast; arXiv asks for one request every three seconds; the free PDFs of
  // publishers and repositories are one lane of two at a time and one start a second, so no host is asked for more than a polite trickle (the ingest itself runs three papers at most).
  europepmc: { minIntervalMs: 200, maxConcurrent: 3, leaseMs: 40_000 },
  openalex: { minIntervalMs: 250, maxConcurrent: 2, leaseMs: 20_000 },
  arxiv: { minIntervalMs: 3_200, maxConcurrent: 1, leaseMs: 40_000 },
  oahost: { minIntervalMs: 1_000, maxConcurrent: 2, leaseMs: 40_000 },
  // The searches of a literature scan (src/litscan): five or six sub-questions searched at once made OpenAlex, PubMed and Crossref answer 429 to all of them (a live run, 27 Oct 2026: every source
  // refused, so the search found "nothing"). Two at a time, a start every two seconds: a scan's search phase takes about 25 s instead of 10, and every source answers.
  litscan: { minIntervalMs: 2_000, maxConcurrent: 2, leaseMs: 60_000 },
  // DOAJ (the "Indian sources" search, src/search/india.ts): two requests a second on every route, bursts of five queued (its API page, 28 Oct 2026). A start every 600 ms leaves room.
  doaj: { minIntervalMs: 600, maxConcurrent: 2, leaseMs: 20_000 },
} satisfies Record<string, GateConfig>;
export type GateName = keyof typeof GATES;

/** What the Durable Object offers (see api-gate.ts). */
export interface RemoteGate {
  acquire(name: GateName, maxWaitMs: number): Promise<Acquired>;
  release(name: GateName, lease: string): Promise<void>;
  closeUntil(name: GateName, until: number): Promise<void>;
}

/** The lane was too busy, closed by the service, or out of its daily allowance: the call was not made. */
export class GateBusy extends Error {
  constructor(readonly gate: GateName, readonly reason: "busy" | "budget" | "closed", readonly retryInMs: number) {
    super(reason === "budget" ? `${gate} daily allowance used` : reason === "closed" ? `${gate} asked us to wait` : `${gate} is busy`);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const deps = { now: () => Date.now(), sleep };

let remote: RemoteGate | null = null;
let off = false;
let local = new Map<GateName, GateCore>();
let overrides: Partial<Record<GateName, Partial<GateConfig>>> = {};
let warned = false;

/** Called once per isolate with the Durable Object (the bindings do not change while an isolate lives). Without it the lanes work inside this isolate only. */
export function installGates(r: RemoteGate | null): void {
  remote = r;
}
/** Tests and the eval (which replays recorded answers and must not wait): no waiting, no limits. */
export function gatesOff(): void {
  off = true;
}
/** Tests: start again with the given settings (for example a short interval) and no Durable Object. */
export function resetGates(settings: Partial<Record<GateName, Partial<GateConfig>>> = {}): void {
  remote = null;
  off = false;
  local = new Map();
  overrides = settings;
  warned = false;
}

const localCore = (name: GateName): GateCore => {
  let core = local.get(name);
  if (!core) local.set(name, (core = new GateCore({ ...GATES[name], ...overrides[name] } as GateConfig, deps)));
  return core;
};

export type GateControl = {
  /** The service said "not before then": close the lane until `until` (ms since epoch). */
  closeUntil(until: number): void;
};

/**
 * Runs `run` when the lane lets it start, and tells the lane when it is done. If the Durable Object cannot be reached the lane of this
 * isolate is used instead (a limit that is a little too loose is better than every lookup failing).
 */
export async function withGate<T>(name: GateName, maxWaitMs: number, run: (ctl: GateControl) => Promise<T>): Promise<T> {
  if (off) return run({ closeUntil: () => {} });
  let useRemote = remote;
  let got: Acquired;
  try {
    got = useRemote ? await useRemote.acquire(name, maxWaitMs) : await localCore(name).acquire(maxWaitMs);
  } catch (e) {
    if (!warned) {
      warned = true;
      console.warn(JSON.stringify({ level: "warn", msg: "gate_unreachable", gate: name, error: e instanceof Error ? e.message : "unknown" }));
    }
    useRemote = null;
    got = await localCore(name).acquire(maxWaitMs);
  }
  if (!got.ok) throw new GateBusy(name, got.reason, got.retryInMs);
  let closeAt = 0;
  try {
    return await run({ closeUntil: (until) => void (closeAt = Math.max(closeAt, until)) });
  } finally {
    // A lease that is not released is freed by the lane after `leaseMs`, so a failure here only costs a short wait for the next caller.
    const done = useRemote
      ? Promise.all([closeAt ? useRemote.closeUntil(name, closeAt) : undefined, useRemote.release(name, got.lease)])
      : Promise.all([closeAt ? localCore(name).closeUntil(closeAt) : undefined, localCore(name).release(got.lease)]);
    await done.catch(() => {});
  }
}
