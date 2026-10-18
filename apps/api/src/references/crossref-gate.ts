/**
 * Crossref's polite pool allows 3 requests per second and 3 at once (response headers `x-rate-limit-*`, `x-concurrency-limit`);
 * anything beyond that gets HTTP 429. A single reference makes up to three Crossref calls (two searches and a retraction check) and
 * a References tab checks several references at once, so unthrottled we turned 429s into "could not check" for most of a paper.
 *
 * This lets at most `MAX_IN_FLIGHT` calls run at once in this isolate and retries a 429 after the time Crossref asks for. It is a
 * per-isolate gate, not a global one: other isolates can still add calls, which the retry absorbs.
 */
const MAX_IN_FLIGHT = 2;
const MAX_ATTEMPTS = 4;
const MAX_WAIT_MS = 3_000;

let inFlight = 0;
const waiting: (() => void)[] = [];

async function enter(): Promise<void> {
  if (inFlight < MAX_IN_FLIGHT) {
    inFlight++;
    return;
  }
  await new Promise<void>((resolve) => waiting.push(resolve)); // the slot is handed over by leave(), inFlight stays counted
}

function leave(): void {
  const next = waiting.shift();
  if (next) next();
  else inFlight--;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Seconds in `Retry-After` (Crossref sends whole seconds), else a growing guess. Always bounded. */
export function retryDelay(res: Response, attempt: number): number {
  const asked = Number(res.headers.get("retry-after"));
  const ms = Number.isFinite(asked) && res.headers.has("retry-after") ? asked * 1000 : 400 * 2 ** attempt;
  return Math.min(MAX_WAIT_MS, Math.max(0, ms));
}

/** `fetch` for api.crossref.org: gated, and a 429 is retried a few times before it is reported. */
export async function crossrefFetch(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response> {
  await enter();
  try {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(url, init);
      if (res.status !== 429 || attempt + 1 >= MAX_ATTEMPTS) return res;
      await res.body?.cancel().catch(() => {});
      await sleep(retryDelay(res, attempt));
    }
  } finally {
    leave();
  }
}
