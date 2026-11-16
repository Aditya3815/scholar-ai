/**
 * Trying a request again (docs/design/untangle.md, F9): one abortable sleep, the wait a 429 asks for, and `retry` for a call tried a few times. The numbers are each call site's own, kept
 * there as a named policy (the feedback form's, the upload's, the indexing's, Check references', the scan reader's, the literature scan's, the drawing's): only the mechanism is here.
 */

/** Waits `ms`; resolves at once when `signal` aborts (the caller then looks at the signal). */
export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

/** The wait a 429 asks for, in ms: its Retry-After in seconds, `fallbackS` when it has none (or not a number of seconds), and at most `maxS`. */
export const retryAfterMs = (retryAfter: string | null, fallbackS: number, maxS: number): number => Math.min(Number(retryAfter) || fallbackS, maxS) * 1000;

export type RetryPolicy = {
  /** Tries in all, the first one included. */
  tries: number;
  /** The wait after the `attempt`-th try failed (1 after the first). */
  delayMs: (attempt: number) => number;
  /** Whether this failure is worth another try. */
  again: (e: unknown) => boolean;
};

/** Runs `run` until it resolves, at most `policy.tries` times, waiting `delayMs` between tries; a failure `again` says no to, or the last one, is thrown. `onRetry` runs before each wait. */
export async function retry<T>(policy: RetryPolicy, run: (attempt: number) => Promise<T>, onRetry?: (e: unknown, attempt: number) => void, signal?: AbortSignal): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run(attempt);
    } catch (e) {
      if (attempt >= policy.tries || !policy.again(e)) throw e;
      onRetry?.(e, attempt);
      await sleep(policy.delayMs(attempt), signal);
    }
  }
}
