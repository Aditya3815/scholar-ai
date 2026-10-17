import { useCallback, useEffect, useRef, useState } from "react";
import type { Paper, ProviderStatus, SearchResponse, SearchSnapshot } from "@scholar/shared";

export type SearchState = {
  status: "idle" | "loading" | "done" | "error";
  query: string;
  results: Paper[];
  providers: Record<string, ProviderStatus>;
  retractionCheck: ProviderStatus | null;
  /** `count` = DOIs removed because they do not exist or belong to another record */
  doiCheck: ProviderStatus | null;
  /** Pehla result kitni der mein dikha (ms): streaming ka asli fayda */
  firstResultMs: number | null;
  tookMs: number | null;
  error: string | null;
};

const IDLE: SearchState = {
  status: "idle",
  query: "",
  results: [],
  providers: {},
  retractionCheck: null,
  doiCheck: null,
  firstResultMs: null,
  tookMs: null,
  error: null,
};

/** SSE se streaming search: har source ke aate hi results merge hokar aate hain. */
export function useSearch() {
  const [state, setState] = useState<SearchState>(IDLE);
  const sourceRef = useRef<EventSource | null>(null);

  const cancel = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const run = useCallback(
    (raw: string) => {
      const q = raw.trim();
      cancel();
      if (q.length < 2) return;

      const started = performance.now();
      setState({ ...IDLE, status: "loading", query: q });

      const es = new EventSource(`/api/v1/search/stream?q=${encodeURIComponent(q)}&limit=20`);
      sourceRef.current = es;
      let finished = false;

      es.addEventListener("snapshot", (e) => {
        const snap = JSON.parse((e as MessageEvent<string>).data) as SearchSnapshot;
        setState((s) => ({
          ...s,
          results: snap.results,
          providers: snap.providers,
          firstResultMs: s.firstResultMs ?? (snap.results.length > 0 ? Math.round(performance.now() - started) : null),
        }));
      });

      es.addEventListener("done", (e) => {
        finished = true;
        const final = JSON.parse((e as MessageEvent<string>).data) as SearchResponse;
        setState((s) => ({
          ...s,
          status: "done",
          results: final.results,
          providers: final.providers,
          retractionCheck: final.retractionCheck,
          doiCheck: final.doiCheck,
          tookMs: final.tookMs,
        }));
        es.close();
      });

      const fail = (message: string) => {
        if (finished) return;
        finished = true;
        es.close();
        setState((s) => ({ ...s, status: "error", error: message }));
      };
      es.addEventListener("error", (e) => {
        // Server-sent `error` event (data ke saath) ya connection error (data nahi).
        const data = (e as MessageEvent<string>).data;
        fail(data ? ((JSON.parse(data) as { title?: string }).title ?? "Search failed") : "Connection lost");
      });
    },
    [cancel],
  );

  useEffect(() => cancel, [cancel]);

  const reset = useCallback(() => {
    cancel();
    setState(IDLE);
  }, [cancel]);

  return { state, run, reset };
}
