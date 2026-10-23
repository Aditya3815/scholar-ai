import { GateBusy, withGate } from "../gate";

/**
 * Crossref's polite pool allows 3 requests per second and 3 at once (response headers `x-rate-limit-*`, `x-concurrency-limit`);
 * anything beyond that gets HTTP 429. A single reference makes up to three Crossref calls (two searches and a retraction check), a
 * References tab checks several references at once, and a search checks its DOIs, so unthrottled we turned 429s into "could not check".
 *
 * Every Crossref call now starts only when the shared lane lets it (`gate/`: one Durable Object that all isolates ask, so the limit
 * holds for the whole product, not per process). A 429 that still comes is retried after the time Crossref asks for, and the lane is
 * closed for that long so the other callers do not walk into the same wall. A call the lane cannot place in time is not made and
 * looks like a 429 to the caller, which every caller already treats as "could not check", never as "not found".
 */
const MAX_ATTEMPTS = 4;
const MAX_WAIT_MS = 3_000;
/**
 * How long a call may wait for its turn. A search has 6 s in all, so it gives up early and goes on without Crossref. A reference check is something a person started
 * and watches (the page shows each reference as it is done), so it may queue behind others for a while rather than fail: 40 references need about 120 calls, which the lane
 * serves at 3 a second.
 */
export const SEARCH_GATE_WAIT_MS = 2_500;
export const LOOKUP_GATE_WAIT_MS = 15_000;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Seconds in `Retry-After` (Crossref sends whole seconds), else a growing guess. Always bounded. */
export function retryDelay(res: Response, attempt: number): number {
  const asked = Number(res.headers.get("retry-after"));
  const ms = Number.isFinite(asked) && res.headers.has("retry-after") ? asked * 1000 : 400 * 2 ** attempt;
  return Math.min(MAX_WAIT_MS, Math.max(0, ms));
}

const busy = () => new Response("Crossref lane is busy", { status: 429, headers: { "x-gate": "busy" } });

/** `timeoutMs` starts counting when the lane lets the call go, not when it joined the line (a wait for a turn must not eat the time the answer needs). */
export type CrossrefInit = RequestInit & { timeoutMs?: number };

/** `fetch` for api.crossref.org: gated, and a 429 is retried a few times before it is reported. */
export async function crossrefFetch(fetchImpl: typeof fetch, url: string, init: CrossrefInit, maxWaitMs = LOOKUP_GATE_WAIT_MS): Promise<Response> {
  const { timeoutMs, ...rest } = init;
  for (let attempt = 0; ; attempt++) {
    let delay = 0;
    let res: Response;
    try {
      res = await withGate("crossref", maxWaitMs, async (lane) => {
        const r = await fetchImpl(url, timeoutMs ? { ...rest, signal: AbortSignal.timeout(timeoutMs) } : rest);
        if (r.status === 429) {
          delay = retryDelay(r, attempt);
          lane.closeUntil(Date.now() + delay);
        }
        return r;
      });
    } catch (e) {
      if (e instanceof GateBusy) return busy();
      throw e;
    }
    if (res.status !== 429 || attempt + 1 >= MAX_ATTEMPTS) return res;
    await res.body?.cancel().catch(() => {});
    await sleep(delay);
  }
}
