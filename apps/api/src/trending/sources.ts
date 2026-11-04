/**
 * The plumbing under every call the Trending job makes to a public source (docs/design/chatview-and-trending.md, T3): a budget of calls that stops a runaway loop, a timeout on every
 * call, one retry for what is worth retrying, a clear failure for the rest, a pause between arXiv requests, and a bounded number of calls at once. Nothing here knows OpenAlex or arXiv.
 *
 * The errors carry the source, the kind and the HTTP status, never the address of the call: an OpenAlex address holds the API key, and the error ends up in the heartbeat table and in Sentry.
 */

export type SourceName = "openalex" | "arxiv";
export type SourceErrorKind = "http" | "timeout" | "network" | "shape" | "error_entry";

/** A source answered wrongly or not at all. The job stops on it and leaves the last good file as it is. */
export class SourceError extends Error {
  readonly source: SourceName;
  readonly kind: SourceErrorKind;
  readonly status?: number;
  constructor(source: SourceName, kind: SourceErrorKind, status?: number, detail = "") {
    super(`${source}: ${kind}${status ? ` HTTP ${status}` : ""}${detail ? ` (${detail})` : ""}`);
    this.name = "SourceError";
    this.source = source;
    this.kind = kind;
    if (status !== undefined) this.status = status;
  }
}

/** The run has made as many calls as it was allowed. */
export class BudgetError extends Error {
  constructor(what: string, limit: number) {
    super(`call budget used up: ${what} (${limit})`);
    this.name = "BudgetError";
  }
}

/** A count of calls with a ceiling. `take` throws before the call that would go over, and then nothing is used. */
export class CallBudget {
  used = 0;
  readonly limit: number;
  readonly what: string;
  constructor(limit: number, what: string) {
    this.limit = limit;
    this.what = what;
  }
  get left(): number {
    return Math.max(0, this.limit - this.used);
  }
  take(n = 1): void {
    if (!(this.used + n <= this.limit)) throw new BudgetError(this.what, this.limit);
    this.used += n;
  }
}

export type Http = {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  /** Every call gets this long, queueing included (a Worker holds a seventh connection until one of six is free). */
  timeoutMs: number;
  /** Extra tries after the first, for a timeout, a network failure, a 5xx and a 429 that asks for a short wait. */
  retries: number;
  retryWaitMs: number;
  /** A 429 that asks for a longer wait than this is the day's allowance used up: not retried. */
  maxRetryWaitMs: number;
};

const retryAfterMs = (res: Response): number | null => {
  const raw = res.headers.get("retry-after");
  if (raw === null) return null;
  const s = Number(raw);
  return Number.isFinite(s) && s >= 0 ? s * 1000 : null;
};

/**
 * GET an address and return its body as text. Each try is one call of the budget. A timeout, a network failure, a 5xx and a 429 are tried again (up to `retries` more times) after a short
 * wait; any other answer that is not a success, or the last try's failure, is a `SourceError`.
 */
export async function getText(http: Http, source: SourceName, url: string, init: RequestInit, budget: CallBudget): Promise<string> {
  const transport = (e: unknown): SourceError => new SourceError(source, e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "timeout" : "network");
  for (let attempt = 0; ; attempt++) {
    budget.take();
    const last = attempt >= http.retries;
    // 1. the call itself and the reading of its body: a timeout or a broken connection is worth another try
    let res: Response | null = null;
    let body: string | null = null;
    let broken: SourceError | null = null;
    try {
      res = await http.fetch(url, { ...init, signal: AbortSignal.timeout(http.timeoutMs) });
      if (res.ok) body = await res.text();
    } catch (e) {
      broken = transport(e);
    }
    if (body !== null) return body;
    if (broken) {
      if (last) throw broken;
      await http.sleep(http.retryWaitMs);
      continue;
    }
    // 2. an answer that is not a success
    const status = res!.status;
    void res!.body?.cancel().catch(() => {});
    const failure = new SourceError(source, "http", status);
    if (status !== 429 && status < 500) throw failure; // the request's own fault: not retried
    let wait = http.retryWaitMs;
    if (status === 429) {
      const asked = retryAfterMs(res!);
      if (asked !== null && asked > http.maxRetryWaitMs) throw failure; // the day's allowance is used up: not retried
      if (asked !== null) wait = asked;
    }
    if (last) throw failure;
    await http.sleep(wait);
  }
}

/** Waits until at least `gapMs` have passed since the last start it let through (arXiv: one request every three seconds, one after the other). */
export function makePacer(gapMs: number, now: () => number, sleep: (ms: number) => Promise<void>): () => Promise<void> {
  let lastStart = -Infinity;
  return async () => {
    const wait = lastStart + gapMs - now();
    if (wait > 0) await sleep(wait);
    lastStart = now();
  };
}

/** `fn` over `items`, at most `limit` at once; the answers in the order of the items. After the first failure nothing new is started, and the call rejects with that failure. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  let firstError: unknown;
  const worker = async (): Promise<void> => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]!, i);
      } catch (e) {
        if (!failed) {
          failed = true;
          firstError = e;
        }
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(Math.trunc(limit) || 1, items.length || 1)) }, worker));
  if (failed) throw firstError;
  return out;
}
