import { useCallback, useEffect, useRef, useState } from "react";
import { emptyView, reduceView, type LitscanEvent, type LitscanListItem, type LitscanPlan, type LitscanPublic, type LitscanSnapshot, type LitscanStartRequest, type LitscanView, type LitscanLanguage } from "@scholar/shared";
import { ApiError } from "./documents";
import { readSse } from "./sse";

const BASE = "/api/v1/litscan";
const json = (method: string, body?: unknown, signal?: AbortSignal): RequestInit => ({ method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin", signal });

/** Another scan of the same person is still running: `id` is that one, so the page can open it instead. */
export class ScanRunningError extends ApiError {
  constructor(title: string, detail: string | undefined, readonly id: string) {
    super(409, "scan_running", title, detail);
  }
}

async function fail(res: Response): Promise<never> {
  const j = (await res.json().catch(() => null)) as { type?: string; title?: string; detail?: string; id?: string } | null;
  if (j?.type === "scan_running" && j.id) throw new ScanRunningError(j.title ?? "A scan is already running", j.detail, j.id);
  throw new ApiError(res.status, j?.type ?? "error", j?.title ?? `The service answered ${res.status}`, j?.detail);
}

/** The topic goes to the private model, which proposes the sub-questions (nothing is stored). `language` "auto" follows the topic. */
export async function planScan(topic: string, language: LitscanLanguage | "auto", signal?: AbortSignal): Promise<LitscanPlan> {
  const res = await fetch(`${BASE}/plan`, json("POST", { topic, language }, signal));
  if (!res.ok) await fail(res);
  return ((await res.json()) as { plan: LitscanPlan }).plan;
}

/** Starts the scan the person approved. Resolves with its id. */
export async function startScan(req: LitscanStartRequest): Promise<string> {
  const res = await fetch(BASE, json("POST", req));
  if (!res.ok) await fail(res);
  return ((await res.json()) as { id: string }).id;
}

export async function listScans(signal?: AbortSignal): Promise<LitscanListItem[]> {
  const res = await fetch(BASE, { credentials: "same-origin", signal });
  if (!res.ok) await fail(res);
  return ((await res.json()) as { scans: LitscanListItem[] }).scans;
}

export async function getScan(id: string, signal?: AbortSignal): Promise<LitscanSnapshot> {
  const res = await fetch(`${BASE}/${id}`, { credentials: "same-origin", signal });
  if (!res.ok) await fail(res);
  return ((await res.json()) as { scan: LitscanSnapshot }).scan;
}

/** A shared scan, by its link (no sign-in). */
export async function getSharedScan(token: string, signal?: AbortSignal): Promise<LitscanPublic> {
  const res = await fetch(`${BASE}/shared/${token}`, { credentials: "omit", signal });
  if (!res.ok) await fail(res);
  return ((await res.json()) as { scan: LitscanPublic }).scan;
}

/** Turns on the read-only link of a finished scan (asking again gives the same link). Resolves with its token. */
export async function shareScan(id: string): Promise<string> {
  const res = await fetch(`${BASE}/${id}/share`, json("POST"));
  if (!res.ok) await fail(res);
  return ((await res.json()) as { token: string }).token;
}

export async function unshareScan(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${id}/share`, json("DELETE"));
  if (!res.ok) await fail(res);
}

export async function cancelScan(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${id}/cancel`, json("POST"));
  if (!res.ok) await fail(res);
}

export async function deleteScan(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${id}`, json("DELETE"));
  if (!res.ok) await fail(res);
}

/** The view of a scan as it stands in a snapshot (the same shape the events fold into). */
export function viewOf(s: LitscanSnapshot): LitscanView {
  return { state: s.state, total: s.total, done: s.done, stages: s.stages, parts: Object.fromEntries(s.parts.map((p) => [p.idx, p])), seq: s.seq };
}

export type ScanLive = {
  /** The scan itself (topic, plan, language): known once the first read has answered. */
  scan: LitscanSnapshot | null;
  view: LitscanView;
  /** "missing": the scan is gone (a day passed, or it was deleted); "offline": it cannot be reached right now (it is retried). */
  problem: "missing" | "offline" | null;
};

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((r) => { const t = setTimeout(r, ms); signal.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true }); });

/**
 * A scan, live. It reads the scan once, then follows its event stream from the last event it has; if the stream is cut it waits a moment, reads the scan again (so nothing that
 * happened meanwhile is missed, and a scan that ended while the page was away is seen as ended) and asks for the events after the last one it saw. The server holds the scan, not the
 * page: closing the tab loses nothing.
 */
export function useScan(id: string | null): ScanLive & { reload: () => void } {
  const [live, setLive] = useState<ScanLive>({ scan: null, view: emptyView(), problem: null });
  const [round, setRound] = useState(0);
  const viewRef = useRef<LitscanView>(emptyView());

  useEffect(() => {
    if (!id) {
      viewRef.current = emptyView();
      setLive({ scan: null, view: emptyView(), problem: null });
      return;
    }
    const ctl = new AbortController();
    const { signal } = ctl;
    viewRef.current = emptyView();
    setLive({ scan: null, view: emptyView(), problem: null });
    const push = (patch: Partial<ScanLive>) => !signal.aborted && setLive((l) => ({ ...l, ...patch, view: viewRef.current }));
    void (async () => {
      let failures = 0;
      while (!signal.aborted) {
        try {
          const scan = await getScan(id, signal);
          viewRef.current = viewOf(scan);
          push({ scan, problem: null });
          if (scan.state !== "running") return;
          let ended = false;
          const res = await fetch(`${BASE}/${id}/events?after=${viewRef.current.seq}`, { credentials: "same-origin", headers: { Accept: "text/event-stream" }, signal });
          if (!res.ok) throw new ApiError(res.status, "stream", "The scan stream is not available");
          await readSse<LitscanEvent>(
            res,
            (e) => {
              if (e.type === "error") throw new ApiError(500, e.code, e.title);
              viewRef.current = reduceView(viewRef.current, e);
              if (e.type === "done") ended = true;
              push({});
            },
            signal,
          );
          failures = 0;
          if (ended) {
            // read it once more so the page holds the scan as it was stored (the counts, the end state)
            const scan = await getScan(id, signal);
            viewRef.current = viewOf(scan);
            push({ scan });
            return;
          }
        } catch (e) {
          if (signal.aborted) return;
          if (e instanceof ApiError && (e.status === 404 || e.status === 401)) return void push({ problem: "missing" });
          failures++;
          push({ problem: failures >= 2 ? "offline" : null });
        }
        await wait(Math.min(1000 * 2 ** Math.min(failures, 3), 8000), signal);
      }
    })();
    return () => ctl.abort();
  }, [id, round]);

  const reload = useCallback(() => setRound((r) => r + 1), []);
  return { ...live, reload };
}
