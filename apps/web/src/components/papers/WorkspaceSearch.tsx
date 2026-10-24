import { FileText, Highlighter, Quote, Search, WifiOff, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { searchWorkspace, type WorkspaceHits } from "../../lib/documents";
import { requestJump } from "../../lib/jump";

/** The words of a query as they were searched for (same rule as the server: letters and numbers, two or more characters). */
const words = (q: string) => [...new Set(q.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w.length >= 2))].slice(0, 6);

/** Text with the searched words marked. Marking is by position in the lower-cased text, which has the same length as the text for the scripts we use; where it does not, the text is shown unmarked. */
function Marked({ text, q }: { text: string; q: string }): ReactNode {
  const ws = words(q);
  const low = text.toLowerCase();
  if (ws.length === 0 || low.length !== text.length) return text;
  const spans: [number, number][] = [];
  for (const w of ws) for (let i = low.indexOf(w); i >= 0; i = low.indexOf(w, i + w.length)) spans.push([i, i + w.length]);
  spans.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([...s]);
  }
  const out: ReactNode[] = [];
  let at = 0;
  merged.forEach(([a, b], i) => {
    if (a > at) out.push(<Fragment key={`t${i}`}>{text.slice(at, a)}</Fragment>);
    out.push(<mark key={`m${i}`}>{text.slice(a, b)}</mark>);
    at = b;
  });
  if (at < text.length) out.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return out;
}

type State = { status: "idle" } | { status: "loading" } | { status: "error" } | { status: "ready"; hits: WorkspaceHits; q: string };

/** The box that searches everything a person has here: titles and tags, the text of the papers, highlights and notes. */
export function WorkspaceSearch({ query, onQuery }: { query: string; onQuery: (q: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="wsearch" role="search">
      <label className="sr-only" htmlFor="ws-search">Search all your papers, highlights and notes</label>
      <Search size={16} className="wsearch-ico" aria-hidden="true" />
      <input
        id="ws-search"
        ref={input}
        type="search"
        className="wsearch-in"
        value={query}
        placeholder="Search your papers, highlights and notes"
        autoComplete="off"
        spellCheck={false}
        maxLength={200}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && query && (e.preventDefault(), onQuery(""))}
      />
      {query && (
        <button type="button" className="wsearch-x" aria-label="Clear the search" onClick={() => { onQuery(""); input.current?.focus(); }}>
          <X size={15} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** The results themselves, drawn in place of the grid. */
export function SearchResults({ query, onOpen }: { query: string; onOpen: (id: string) => void }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const q = query.trim();
  const usable = words(q).length > 0;

  useEffect(() => {
    if (!usable) return setState({ status: "idle" });
    setState((s) => (s.status === "ready" ? s : { status: "loading" }));
    const ctl = new AbortController();
    const t = window.setTimeout(() => {
      searchWorkspace(q, ctl.signal).then(
        (hits) => setState({ status: "ready", hits, q }),
        () => !ctl.signal.aborted && setState({ status: "error" }),
      );
    }, 280);
    return () => {
      window.clearTimeout(t);
      ctl.abort();
    };
  }, [q, usable]);

  const go = (docId: string, page?: number, quote?: string) => {
    if (page) requestJump(docId, page, quote);
    onOpen(docId);
  };

  if (!usable) return <p className="sres-empty" role="status">Type at least two letters to search.</p>;
  if (state.status === "error") {
    return (
      <p className="sres-empty" role="alert">
        <WifiOff size={16} aria-hidden="true" /> The search could not be done. Check your connection and try again.
      </p>
    );
  }
  if (state.status !== "ready") return <p className="sres-empty" role="status" aria-busy="true">Searching…</p>;
  const { hits } = state;
  const none = hits.papers.length + hits.passages.length + hits.highlights.length === 0;
  return (
    <div className="sres" aria-live="polite">
      {none && <p className="sres-empty" role="status">Nothing found for “{state.q}”. Every word you type must be on the page, so try fewer words.</p>}
      {hits.papers.length > 0 && (
        <section aria-labelledby="sr-p">
          <h3 id="sr-p" className="sres-h"><FileText size={14} aria-hidden="true" /> Papers</h3>
          <ul>
            {hits.papers.map((p) => (
              <li key={p.docId}><button type="button" className="sres-item" onClick={() => go(p.docId)}><span className="sres-title"><Marked text={p.title} q={state.q} /></span></button></li>
            ))}
          </ul>
        </section>
      )}
      {hits.highlights.length > 0 && (
        <section aria-labelledby="sr-h">
          <h3 id="sr-h" className="sres-h"><Highlighter size={14} aria-hidden="true" /> Highlights and notes</h3>
          <ul>
            {hits.highlights.map((h, i) => (
              <li key={`${h.docId}-${h.page}-${i}`}>
                <button type="button" className="sres-item" onClick={() => go(h.docId, h.page, h.quote)}>
                  <span className="sres-where"><span className="sres-dot" data-color={h.color} aria-hidden="true" />{h.title} · page {h.page}</span>
                  <span className="sres-quote"><Marked text={h.quote} q={state.q} /></span>
                  {h.note && <span className="sres-note"><Marked text={h.note} q={state.q} /></span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {hits.passages.length > 0 && (
        <section aria-labelledby="sr-t">
          <h3 id="sr-t" className="sres-h"><Quote size={14} aria-hidden="true" /> In the text of your papers</h3>
          <ul>
            {hits.passages.map((p, i) => (
              <li key={`${p.docId}-${p.page}-${i}`}>
                <button type="button" className="sres-item" onClick={() => go(p.docId, p.page, undefined)}>
                  <span className="sres-where">{p.title} · page {p.page}</span>
                  <span className="sres-quote"><Marked text={p.snippet} q={state.q} /></span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
