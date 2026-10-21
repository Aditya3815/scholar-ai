import { useEffect, useMemo, useRef, useState } from "react";
import { findAll, words } from "@scholar/shared";
import type { PDFDocumentProxy } from "./pdf";

export type PageHits = { page: number; count: number };
export type FindState = { status: "idle" | "reading" | "done"; /** pages read so far, while reading */ progress: number; hits: PageHits[]; total: number };
const IDLE: FindState = { status: "idle", progress: 0, hits: [], total: 0 };

/** The n-th match overall (0-based) as a page and which occurrence on that page it is. */
export function locate(hits: PageHits[], index: number): { page: number; k: number } | null {
  let left = index;
  for (const h of hits) {
    if (left < h.count) return { page: h.page, k: left };
    left -= h.count;
  }
  return null;
}

/**
 * Search inside the open paper. The text of every page is read once (the same text items the page's text layer is drawn from, so the count
 * agrees with what is highlighted), kept, and searched as words: case, accents and punctuation do not matter, and the last word may still
 * be half typed. Results arrive as pages with a number of hits each.
 */
export function usePaperSearch(pdf: PDFDocumentProxy, active: boolean) {
  const cache = useRef(new Map<number, string[]>());
  const run = useRef(0);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<FindState>(IDLE);
  const N = pdf.numPages;

  useEffect(() => {
    const q = words(query);
    const id = ++run.current;
    if (!active || q.length === 0) {
      setState(IDLE);
      return;
    }
    const timer = window.setTimeout(async () => {
      setState((s) => ({ ...s, status: "reading", progress: 0 }));
      const hits: PageHits[] = [];
      let total = 0;
      for (let n = 1; n <= N; n++) {
        let w = cache.current.get(n);
        if (!w) {
          const page = await pdf.getPage(n);
          const content = await page.getTextContent();
          w = words(content.items.map((i) => ("str" in i ? i.str : "")).join(" "));
          cache.current.set(n, w);
          page.cleanup();
        }
        if (run.current !== id) return; // the query changed: this search is stale
        const count = findAll(q, w).length;
        if (count) {
          hits.push({ page: n, count });
          total += count;
        }
        if (n % 8 === 0) {
          setState({ status: "reading", progress: n, hits: [...hits], total });
          await new Promise((r) => setTimeout(r));
        }
      }
      if (run.current === id) setState({ status: "done", progress: N, hits, total });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, active, pdf, N]);

  return useMemo(() => ({ query, setQuery, state }), [query, state]);
}
