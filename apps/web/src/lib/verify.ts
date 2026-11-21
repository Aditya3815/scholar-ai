import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_REFERENCES, type RefVerdict } from "@scholar/shared";
import { ApiError, api } from "./api/client";
import { retryAfterMs, sleep } from "./api/retry";

export type ItemState = "queued" | "checking" | "done" | "error";
export type VerifyItem = {
  id: number;
  input: string;
  state: ItemState;
  verdict?: RefVerdict;
  /** Shown when the request itself failed (network, rate limit). Never presented as a verdict about the reference. */
  error?: string;
};

export type VerifyState = {
  items: VerifyItem[];
  running: boolean;
  /** Entries beyond MAX_REFERENCES that were not queued. */
  skipped: number;
};

const CONCURRENCY = 2;
const idle: VerifyState = { items: [], running: false, skipped: 0 };

/** One reference checked (also the chat's tool card's "Check again"). A failure rejects with an ApiError, or with fetch's TypeError when the connection is lost. */
export const checkReference = (reference: string, signal?: AbortSignal) => api<RefVerdict>("/api/v1/references/verify", { method: "POST", json: { reference }, signal });

/**
 * Trying a reference again: a 429 waits what its Retry-After says (20 s without one, 60 s at most), every worker with it, and is tried three times in all; any other failure that is not
 * a refusal (a 4xx: bug B2, this used to be read from the message's words) is tried once more after 0.6 s.
 */
const VERIFY_RETRY = { busy: { tries: 3, fallbackS: 20, maxS: 60 }, failed: { tries: 2, waitMs: 600 } } as const;
const busy = (e: unknown): e is ApiError => e instanceof ApiError && e.status === 429;
const refused = (e: unknown): boolean => e instanceof ApiError && e.status >= 400 && e.status < 500;

/** Check references' words for a reference that could not be checked: too many requests, the server's detail or its status, the network's own message. */
const verifyWords = (e: unknown): string =>
  busy(e) ? "Too many requests at once. Wait a minute, then re-check." : e instanceof ApiError ? (e.detail ?? `The service answered ${e.status}`) : e instanceof Error ? e.message : "Network error";

/**
 * Runs a bibliography through the verifier: one request per reference, a few at a time, results appear as they arrive and
 * keep the order of the list. A failed request is shown as "could not check" with a retry, never as a verdict.
 */
export function useVerify() {
  const [state, setState] = useState<VerifyState>(idle);
  const abort = useRef<AbortController | null>(null);
  const latest = useRef(state);
  latest.current = state;
  /** The ids still waiting in the run in progress, in the order they will be checked (the workers take them from the front). */
  const waiting = useRef<number[]>([]);

  const patch = useCallback((id: number, change: Partial<VerifyItem>) => {
    setState((s) => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, ...change } : it)) }));
  }, []);

  const work = useCallback(
    async (ids: number[], inputs: Map<number, string>, signal: AbortSignal) => {
      const queue = [...ids];
      waiting.current = queue;
      let pausedUntil = 0;
      const worker = async () => {
        for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
          if (signal.aborted) return;
          const input = inputs.get(id)!;
          patch(id, { state: "checking", error: undefined });
          for (let attempt = 0; ; attempt++) {
            const wait = pausedUntil - Date.now();
            if (wait > 0) await sleep(wait, signal);
            if (signal.aborted) return;
            try {
              const verdict = await checkReference(input, signal);
              patch(id, { state: "done", verdict: { ...verdict, input } });
              break;
            } catch (e) {
              if (signal.aborted) return;
              if (busy(e) && attempt < VERIFY_RETRY.busy.tries - 1) {
                pausedUntil = Math.max(pausedUntil, Date.now() + retryAfterMs(e.retryAfter, VERIFY_RETRY.busy.fallbackS, VERIFY_RETRY.busy.maxS));
                continue;
              }
              if (!busy(e) && !refused(e) && attempt < VERIFY_RETRY.failed.tries - 1) {
                await sleep(VERIFY_RETRY.failed.waitMs, signal);
                continue;
              }
              patch(id, { state: "error", error: verifyWords(e) });
              break;
            }
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    },
    [patch],
  );

  const start = useCallback(
    async (entries: string[], max: number = MAX_REFERENCES) => {
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      const used = entries.slice(0, max);
      const items: VerifyItem[] = used.map((input, id) => ({ id, input, state: "queued" }));
      setState({ items, running: true, skipped: entries.length - used.length });
      await work(items.map((i) => i.id), new Map(items.map((i) => [i.id, i.input])), ctl.signal);
      if (abort.current === ctl) setState((s) => ({ ...s, running: false }));
    },
    [work],
  );

  /** Re-run entries that could not be checked (database outage, network, rate limit). */
  const recheck = useCallback(
    async (ids: number[]) => {
      if (ids.length === 0) return;
      abort.current?.abort();
      const ctl = new AbortController();
      abort.current = ctl;
      const inputs = new Map(latest.current.items.map((i) => [i.id, i.input]));
      setState((s) => ({ ...s, running: true, items: s.items.map((i) => (ids.includes(i.id) ? { ...i, state: "queued", error: undefined } : i)) }));
      await work(ids, inputs, ctl.signal);
      if (abort.current === ctl) setState((s) => ({ ...s, running: false }));
    },
    [work],
  );

  const stop = useCallback(() => {
    abort.current?.abort();
    setState((s) => ({
      ...s,
      running: false,
      items: s.items.map((i) => (i.state === "queued" || i.state === "checking" ? { ...i, state: "error", error: "Stopped before this one was checked." } : i)),
    }));
  }, []);

  const clear = useCallback(() => {
    abort.current?.abort();
    setState(idle);
  }, []);

  /** Check this entry next: a reader looking at its citation card should not wait for the hundred before it. Nothing changes for an entry already checked. */
  const bump = useCallback((id: number) => {
    const q = waiting.current;
    const k = q.indexOf(id);
    if (k > 0) {
      q.splice(k, 1);
      q.unshift(id);
    }
  }, []);

  useEffect(() => () => abort.current?.abort(), []);

  return { state, start, recheck, stop, clear, bump };
}
