import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_REFERENCES, type RefVerdict } from "@scholar/shared";

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

class RateLimited extends Error {
  constructor(readonly waitMs: number) {
    super("rate limited");
  }
}

async function checkOne(input: string, signal: AbortSignal): Promise<RefVerdict> {
  const res = await fetch("/api/v1/references/verify", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reference: input }),
    signal,
  });
  if (res.status === 429) throw new RateLimited(Math.min(Number(res.headers.get("retry-after")) || 20, 60) * 1000);
  if (!res.ok) {
    const detail = ((await res.json().catch(() => null)) as { detail?: string } | null)?.detail;
    throw new Error(detail ?? `The service answered ${res.status}`);
  }
  return (await res.json()) as RefVerdict;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { window.clearTimeout(t); resolve(); }, { once: true });
  });

/**
 * Runs a bibliography through the verifier: one request per reference, a few at a time, results appear as they arrive and
 * keep the order of the list. A failed request is shown as "could not check" with a retry, never as a verdict.
 */
export function useVerify() {
  const [state, setState] = useState<VerifyState>(idle);
  const abort = useRef<AbortController | null>(null);
  const latest = useRef(state);
  latest.current = state;

  const patch = useCallback((id: number, change: Partial<VerifyItem>) => {
    setState((s) => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, ...change } : it)) }));
  }, []);

  const work = useCallback(
    async (ids: number[], inputs: Map<number, string>, signal: AbortSignal) => {
      const queue = [...ids];
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
              const verdict = await checkOne(input, signal);
              patch(id, { state: "done", verdict: { ...verdict, input } });
              break;
            } catch (e) {
              if (signal.aborted) return;
              if (e instanceof RateLimited && attempt < 2) {
                pausedUntil = Math.max(pausedUntil, Date.now() + e.waitMs);
                continue;
              }
              if (!(e instanceof RateLimited) && attempt < 1 && !(e instanceof Error && /answered 4/.test(e.message))) {
                await sleep(600, signal);
                continue;
              }
              patch(id, { state: "error", error: e instanceof RateLimited ? "Too many requests at once. Wait a minute, then re-check." : e instanceof Error ? e.message : "Network error" });
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

  useEffect(() => () => abort.current?.abort(), []);

  return { state, start, recheck, stop, clear };
}
