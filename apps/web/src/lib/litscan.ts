import { useCallback, useEffect, useRef, useState } from "react";
import { emptyView, reduceView, type LitscanEvent, type LitscanListItem, type LitscanPlan, type LitscanPublic, type LitscanSnapshot, type LitscanStartRequest, type LitscanView, type LitscanLanguage } from "@scholar/shared";
import { ApiError, api, send, streamError } from "./api/client";
import { sleep } from "./api/retry";
import { readSse } from "./api/stream";

const BASE = "/api/v1/litscan";

/** Another scan of the same person is still running (409 scan_running): the id of that one, so the page can open it instead; null for any other error. */
export const runningScanId = (e: unknown): string | null => (e instanceof ApiError && e.type === "scan_running" && typeof e.extra.id === "string" && e.extra.id ? e.extra.id : null);

/** The topic goes to the private model, which proposes the sub-questions (nothing is stored). `language` "auto" follows the topic. */
export async function planScan(topic: string, language: LitscanLanguage | "auto", signal?: AbortSignal): Promise<LitscanPlan> {
  return (await api<{ plan: LitscanPlan }>(`${BASE}/plan`, { method: "POST", json: { topic, language }, signal })).plan;
}

/** Starts the scan the person approved. Resolves with its id. */
export async function startScan(req: LitscanStartRequest): Promise<string> {
  return (await api<{ id: string }>(BASE, { method: "POST", json: req })).id;
}

export async function listScans(signal?: AbortSignal): Promise<LitscanListItem[]> {
  return (await api<{ scans: LitscanListItem[] }>(BASE, { signal })).scans;
}

export async function getScan(id: string, signal?: AbortSignal): Promise<LitscanSnapshot> {
  return (await api<{ scan: LitscanSnapshot }>(`${BASE}/${id}`, { signal })).scan;
}

/** A shared scan, by its link (no sign-in). */
export async function getSharedScan(token: string, signal?: AbortSignal): Promise<LitscanPublic> {
  return (await api<{ scan: LitscanPublic }>(`${BASE}/shared/${token}`, { credentials: "omit", signal })).scan;
}

/** Turns on the read-only link of a finished scan (asking again gives the same link). Resolves with its token. */
export async function shareScan(id: string): Promise<string> {
  return (await api<{ token: string }>(`${BASE}/${id}/share`, { method: "POST" })).token;
}

export async function unshareScan(id: string): Promise<void> {
  await send(`${BASE}/${id}/share`, { method: "DELETE" });
}

export async function cancelScan(id: string): Promise<void> {
  await send(`${BASE}/${id}/cancel`, { method: "POST" });
}

export async function deleteScan(id: string): Promise<void> {
  await send(`${BASE}/${id}`, { method: "DELETE" });
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

/** Following a scan: after the `failures`-th failure in a row the scan is read again after 2, 4, then 8 s (and 1 s after a stream that was merely cut, `failures` 0). */
const RECONNECT_MS = (failures: number) => Math.min(1000 * 2 ** Math.min(failures, 3), 8000);

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
          const res = await send(`${BASE}/${id}/events?after=${viewRef.current.seq}`, { headers: { Accept: "text/event-stream" }, signal, fallback: "The scan stream is not available" });
          await readSse<LitscanEvent>(
            res,
            (e) => {
              if (e.type === "error") throw streamError(500, e); // reaches the catch below as a failure (bug B1)
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
        await sleep(RECONNECT_MS(failures), signal);
      }
    })();
    return () => ctl.abort();
  }, [id, round]);

  const reload = useCallback(() => setRound((r) => r + 1), []);
  return { ...live, reload };
}
