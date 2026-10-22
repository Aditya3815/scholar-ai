import "pdfjs-dist/web/pdf_viewer.css";
import { m } from "motion/react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, ListTree, Loader2, Maximize2, Minus, Plus, Search, StickyNote, X } from "lucide-react";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import { NOTE_COLORS, type DocNote, type NoteColor, type OutlineItem } from "@scholar/shared";
import type { PDFDocumentProxy } from "../../lib/pdf";
import { Pop } from "../Pop";
import { pdfjs } from "../../lib/pdf";
import { clearHighlights, clearSaved, highlightMatches, highlightQuote, markSaved } from "../../lib/highlight";
import { locate, usePaperSearch } from "../../lib/paperSearch";
import { spring } from "../../lib/motion";

/** What the reader chose in the paper: a highlight in a colour, or a note. */
export type NewNote = { page: number; quote: string; color: NoteColor; withNote: boolean };

export type ViewerHandle = {
  /** Scroll to a page and, if a quote is given, highlight it once the page's text layer exists. */
  goTo: (page: number, quote?: string) => void;
};

const MAX_PAGE_PX = 920;
const ZOOMS = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.6, 2, 2.5];

/** True while the element is within `margin` of the scroll area; used to render only what can be seen. */
function useNear(ref: React.RefObject<HTMLElement | null>, root: React.RefObject<HTMLElement | null>, margin: string) {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setNear(!!e?.isIntersecting), { root: root.current, rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, root, margin]);
  return near;
}

type PageProps = {
  pdf: PDFDocumentProxy;
  n: number;
  scale: number;
  size: { w: number; h: number };
  root: React.RefObject<HTMLElement | null>;
  onSize: (n: number, w: number, h: number) => void;
  onText: (n: number, layer: HTMLElement | null) => void;
};

function PdfPage({ pdf, n, scale, size, root, onSize, onText }: PageProps) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const near = useNear(box, root, "900px 0px");
  const [painted, setPainted] = useState(false);

  useEffect(() => {
    if (!near) {
      setPainted(false);
      return;
    }
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<unknown> } | undefined;
    let layer: { cancel: () => void } | undefined;
    const cv = canvas.current!;
    const tl = text.current!;
    (async () => {
      const [page, lib] = await Promise.all([pdf.getPage(n), pdfjs()]);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      onSize(n, viewport.width / scale, viewport.height / scale);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.floor(viewport.width * dpr);
      cv.height = Math.floor(viewport.height * dpr);
      cv.style.width = `${Math.floor(viewport.width)}px`;
      cv.style.height = `${Math.floor(viewport.height)}px`;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      task = page.render({ canvas: cv, canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      try {
        await task.promise;
      } catch {
        return; // cancelled by a zoom change or by scrolling away
      }
      if (cancelled) return;
      setPainted(true);
      tl.replaceChildren();
      tl.style.setProperty("--total-scale-factor", String(scale));
      tl.style.setProperty("--scale-factor", String(scale));
      const tlr = new lib.TextLayer({ textContentSource: page.streamTextContent(), container: tl, viewport });
      layer = tlr;
      try {
        await tlr.render();
      } catch {
        return;
      }
      if (!cancelled) onText(n, tl);
    })().catch(() => {});
    return () => {
      cancelled = true;
      task?.cancel();
      layer?.cancel();
      onText(n, null);
      tl.replaceChildren();
    };
  }, [near, pdf, n, scale, onSize, onText]);

  return (
    <div ref={box} className="pdfp" data-page={n} role="group" style={{ width: size.w * scale, height: size.h * scale }} aria-label={`Page ${n}`}>
      <canvas ref={canvas} className="pdfp-canvas" data-painted={painted} />
      <div ref={text} className="textLayer pdfp-text" />
      {!painted && <span className="pdfp-skel" aria-hidden="true" />}
    </div>
  );
}

function Thumb({ pdf, n, active, root, onPick }: { pdf: PDFDocumentProxy; n: number; active: boolean; root: React.RefObject<HTMLElement | null>; onPick: (n: number) => void }) {
  const box = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const near = useNear(box, root, "300px 0px");
  const done = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!near || done.current) return;
    let cancelled = false;
    (async () => {
      const page = await pdf.getPage(n);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: 96 / base.width });
      const cv = canvas.current!;
      cv.width = Math.floor(viewport.width);
      cv.height = Math.floor(viewport.height);
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      await page.render({ canvas: cv, canvasContext: ctx, viewport }).promise;
      if (!cancelled) {
        done.current = true;
        setReady(true);
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [near, pdf, n]);

  return (
    <button ref={box} type="button" className="thumb" aria-label={`Go to page ${n}`} aria-current={active ? "true" : undefined} onClick={() => onPick(n)}>
      {active && <m.span layoutId="thumb-ring" className="thumb-ring" transition={spring} />}
      <span className="thumb-page">
        <canvas ref={canvas} data-ready={ready} />
        {!ready && <span className="thumb-skel" aria-hidden="true" />}
      </span>
      <span className="thumb-n">{n}</span>
    </button>
  );
}

/** The table of contents: the PDF's own bookmarks, or headings found by reading the page, in which case we say so. */
function Contents({ items, detected, current, onPick }: { items: OutlineItem[]; detected: boolean; current: number; onPick: (page: number) => void }) {
  // the section the reader is in: the last entry that starts on or before the current page
  const here = items.reduce((best, it, i) => (it.page <= current ? i : best), -1);
  return (
    <Pop
      label="Contents"
      align="start"
      trigger={(open) => (
        <button type="button" className="btn btn-ghost btn-sm pdfv-contents" aria-expanded={open}>
          <ListTree size={15} aria-hidden="true" />
          <span>Contents</span>
        </button>
      )}
    >
      {(close) => (
        <div className="toc">
          <p className="toc-note">{detected ? "Headings found by reading the pages. May be incomplete." : "From the PDF's own bookmarks."}</p>
          <ol className="toc-list">
            {items.map((it, i) => (
              <li key={i} style={{ paddingLeft: `${Math.min(it.level - 1, 3) * 0.8}rem` }}>
                <button type="button" className="toc-item" aria-current={i === here ? "location" : undefined} onClick={() => { onPick(it.page); close(); }}>
                  <span className="toc-title">{it.title}</span>
                  <span className="toc-page">{it.page}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Pop>
  );
}

export function PdfViewer({ pdf, ref, title, downloadHref, onPage, contents, notes, onCreateNote }: { pdf: PDFDocumentProxy; ref?: Ref<ViewerHandle>; title: string; downloadHref: string; onPage?: (n: number) => void; contents?: { items: OutlineItem[]; detected: boolean }; notes?: DocNote[]; onCreateNote?: (n: NewNote) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const [zoomIdx, setZoomIdx] = useState(3);
  const [width, setWidth] = useState(0);
  const [sizes, setSizes] = useState<Record<number, { w: number; h: number }>>({});
  const [current, setCurrent] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const layers = useRef(new Map<number, HTMLElement>());
  const notesRef = useRef<DocNote[]>(notes ?? []);
  notesRef.current = notes ?? [];
  const [sel, setSel] = useState<{ page: number; quote: string; x: number; y: number } | null>(null);
  const pending = useRef<{ page: number; quote: string } | null>(null);
  const pendingFind = useRef<{ page: number; query: string; k: number } | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findIdx, setFindIdx] = useState(0);
  const findInput = useRef<HTMLInputElement>(null);
  const find = usePaperSearch(pdf, findOpen);
  const lastHl = useRef<HTMLElement | null>(null);
  const N = pdf.numPages;
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Fit-to-width at zoom 1, capped so a page never gets absurdly wide on a big monitor.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const first = sizes[1] ?? { w: 595, h: 842 };
  const fit = width > 0 ? Math.min((width - 32) / first.w, MAX_PAGE_PX / first.w) : 1;
  const scale = Math.max(0.2, fit * ZOOMS[zoomIdx]!);

  const onSize = useCallback((n: number, w: number, h: number) => {
    setSizes((s) => (s[n] && Math.abs(s[n]!.w - w) < 0.5 && Math.abs(s[n]!.h - h) < 0.5 ? s : { ...s, [n]: { w, h } }));
  }, []);

  const applyHighlight = useCallback((page: number, quote: string) => {
    const layer = layers.current.get(page);
    if (!layer) return false;
    const el = highlightQuote(layer, quote);
    lastHl.current = el;
    // Scroll only the page area (scrollIntoView would also scroll the whole window and push the toolbar under the header).
    const sc = scroller.current;
    if (el && sc) {
      const a = el.getBoundingClientRect();
      const b = sc.getBoundingClientRect();
      sc.scrollTo({ top: sc.scrollTop + (a.top - b.top) - sc.clientHeight / 2 + a.height / 2, behavior: reduced ? "auto" : "smooth" });
    }
    return true;
  }, [reduced]);

  const scrollToSpan = useCallback((el: HTMLElement | null) => {
    const sc = scroller.current;
    if (!el || !sc) return;
    const a = el.getBoundingClientRect();
    const b = sc.getBoundingClientRect();
    sc.scrollTo({ top: sc.scrollTop + (a.top - b.top) - sc.clientHeight / 2 + a.height / 2, behavior: reduced ? "auto" : "smooth" });
  }, [reduced]);

  const applyFind = useCallback((page: number, query: string, k: number) => {
    const layer = layers.current.get(page);
    if (!layer) return false;
    scrollToSpan(highlightMatches(layer, query, k));
    return true;
  }, [scrollToSpan]);

  /** Draws the saved highlights of one page onto its text layer. */
  const paintSaved = useCallback((n: number) => {
    const layer = layers.current.get(n);
    if (!layer) return;
    clearSaved(layer);
    for (const note of notesRef.current) if (note.page === n) markSaved(layer, note.quote, note.id, note.color);
  }, []);

  const onText = useCallback(
    (n: number, layer: HTMLElement | null) => {
      if (layer) {
        layers.current.set(n, layer);
        paintSaved(n);
      } else layers.current.delete(n);
      if (layer && pending.current?.page === n) {
        const { quote } = pending.current;
        pending.current = null;
        applyHighlight(n, quote);
      }
      if (layer && pendingFind.current?.page === n) {
        const { query, k } = pendingFind.current;
        pendingFind.current = null;
        applyFind(n, query, k);
      }
    },
    [applyHighlight, applyFind, paintSaved],
  );

  // A note was added, changed or deleted: redraw the pages that are on screen.
  useEffect(() => {
    layers.current.forEach((_l, n) => paintSaved(n));
  }, [notes, paintSaved]);

  /* ---- the toolbar that appears when text is selected ---- */
  const captureSelection = useCallback(() => {
    const s = window.getSelection();
    if (!s || s.isCollapsed || s.rangeCount === 0) return setSel(null);
    const node = s.anchorNode;
    const el = node instanceof Element ? node : node?.parentElement;
    const box = el?.closest<HTMLElement>("[data-page]");
    if (!box || !scroller.current?.contains(box) || !el?.closest(".textLayer")) return setSel(null);
    const quote = s.toString().replace(/\s+/g, " ").trim();
    if (quote.length < 3) return setSel(null);
    const r = s.getRangeAt(0).getBoundingClientRect();
    setSel({ page: Number(box.dataset.page), quote: quote.slice(0, 600), x: r.left + r.width / 2, y: r.top });
  }, []);
  useEffect(() => {
    const onChange = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed) setSel(null);
    };
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, []);
  const createFromSelection = (color: NoteColor, withNote: boolean) => {
    if (!sel) return;
    onCreateNote?.({ page: sel.page, quote: sel.quote, color, withNote });
    window.getSelection()?.removeAllRanges();
    setSel(null);
  };

  const pageEl = (n: number) => scroller.current?.querySelector<HTMLElement>(`[data-page="${n}"]`);

  const goTo = useCallback(
    (page: number, quote?: string) => {
      const n = Math.min(Math.max(1, page), N);
      layers.current.forEach((l) => clearHighlights(l));
      const el = pageEl(n);
      if (el && scroller.current) scroller.current.scrollTo({ top: el.offsetTop - 12, behavior: reduced ? "auto" : "smooth" });
      if (quote) {
        pending.current = { page: n, quote };
        // The page may already be rendered (then there is no new text-layer event).
        window.setTimeout(() => {
          if (pending.current?.page === n && applyHighlight(n, quote)) pending.current = null;
        }, 350);
      }
    },
    [N, applyHighlight, reduced],
  );
  useImperativeHandle(ref, () => ({ goTo }), [goTo]);

  /* ---- find in the paper ---- */
  const hit = find.state.status === "idle" ? null : locate(find.state.hits, findIdx);
  useEffect(() => setFindIdx(0), [find.query]);
  useEffect(() => {
    if (!findOpen || !hit) return;
    layers.current.forEach((l, p) => p !== hit.page && clearHighlights(l));
    const el = pageEl(hit.page);
    if (el && scroller.current && !layers.current.has(hit.page)) scroller.current.scrollTo({ top: el.offsetTop - 12, behavior: reduced ? "auto" : "smooth" });
    pendingFind.current = { page: hit.page, query: find.query, k: hit.k };
    const t = window.setTimeout(() => {
      if (pendingFind.current?.page === hit.page && applyFind(hit.page, find.query, hit.k)) pendingFind.current = null;
    }, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hit?.page, hit?.k, find.query, findOpen]);
  const closeFind = useCallback(() => {
    setFindOpen(false);
    layers.current.forEach((l) => clearHighlights(l));
  }, []);
  const stepFind = (d: 1 | -1) => {
    const total = find.state.total;
    if (total > 0) setFindIdx((i) => (i + d + total) % total);
  };
  const openFind = useCallback(() => {
    setFindOpen(true);
    window.setTimeout(() => findInput.current?.select(), 0);
  }, []);

  // Which page is "current": the one whose middle is closest to the middle of the visible area.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const mid = el.scrollTop + el.clientHeight / 2;
      let best = 1;
      let bestD = Infinity;
      el.querySelectorAll<HTMLElement>("[data-page]").forEach((p) => {
        const d = Math.abs(p.offsetTop + p.offsetHeight / 2 - mid);
        if (d < bestD) {
          bestD = d;
          best = Number(p.dataset.page);
        }
      });
      setCurrent((c) => (c === best ? c : best));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [N, scale]);

  useEffect(() => {
    setPageInput(String(current));
    onPage?.(current);
    // keep the active thumbnail in view
    rail.current?.querySelector<HTMLElement>(`[aria-current="true"]`)?.scrollIntoView({ block: "nearest" });
  }, [current, onPage]);

  const zoom = (d: number) => setZoomIdx((i) => Math.min(ZOOMS.length - 1, Math.max(0, i + d)));
  const pages = useMemo(() => Array.from({ length: N }, (_, i) => i + 1), [N]);

  return (
    <div
      className="pdfv"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
          e.preventDefault();
          openFind();
        }
      }}
    >
      <div className="pdfv-bar" role="toolbar" aria-label="Paper controls">
        <div className="pdfv-pager">
          <button type="button" className="icon-btn icon-btn-sm" aria-label="Previous page" disabled={current <= 1} onClick={() => goTo(current - 1)}>
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <form
            className="pdfv-go"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(pageInput);
              if (Number.isInteger(n)) goTo(n);
            }}
          >
            <label className="sr-only" htmlFor="pdfv-page">Page number</label>
            <input id="pdfv-page" inputMode="numeric" pattern="[0-9]*" value={pageInput} onChange={(e) => setPageInput(e.target.value.replace(/\D/g, "").slice(0, 3))} onBlur={() => setPageInput(String(current))} />
            <span aria-hidden="true">/ {N}</span>
            <span className="sr-only">of {N}</span>
          </form>
          <button type="button" className="icon-btn icon-btn-sm" aria-label="Next page" disabled={current >= N} onClick={() => goTo(current + 1)}>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="pdfv-zoom">
          <button type="button" className="icon-btn icon-btn-sm" aria-label="Find in this paper" aria-pressed={findOpen} title="Find in this paper (Ctrl+F)" onClick={() => (findOpen ? closeFind() : openFind())}>
            <Search size={15} aria-hidden="true" />
          </button>
          {contents && <Contents items={contents.items} detected={contents.detected} current={current} onPick={(p) => goTo(p)} />}
          <button type="button" className="icon-btn icon-btn-sm" aria-label="Zoom out" disabled={zoomIdx === 0} onClick={() => zoom(-1)}>
            <Minus size={16} aria-hidden="true" />
          </button>
          <button type="button" className="pdfv-pct" aria-label="Fit to width" title="Fit to width" onClick={() => setZoomIdx(3)}>
            {Math.round(ZOOMS[zoomIdx]! * 100)}%
          </button>
          <button type="button" className="icon-btn icon-btn-sm" aria-label="Zoom in" disabled={zoomIdx === ZOOMS.length - 1} onClick={() => zoom(1)}>
            <Plus size={16} aria-hidden="true" />
          </button>
          <button type="button" className="icon-btn icon-btn-sm pdfv-fit" aria-label="Fit to width" onClick={() => setZoomIdx(3)}>
            <Maximize2 size={15} aria-hidden="true" />
          </button>
          <a className="icon-btn icon-btn-sm" href={downloadHref} download aria-label={`Download ${title}`} title="Download the PDF">
            <Download size={15} aria-hidden="true" />
          </a>
        </div>
      </div>

      {findOpen && (
        <div className="pdfv-find" role="search" aria-label="Find in this paper">
          <Search size={15} aria-hidden="true" />
          <input
            ref={findInput}
            autoFocus
            type="search"
            aria-label="Find in this paper"
            placeholder="Find in this paper"
            value={find.query}
            onChange={(e) => find.setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                stepFind(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                e.preventDefault();
                closeFind();
              }
            }}
          />
          <span className="pdfv-find-count" role="status" aria-live="polite">
            {find.query.trim() === "" ? "" : find.state.status === "reading" ? <><Loader2 className="spin" size={13} aria-hidden="true" /> {find.state.progress} of {N} pages</> : find.state.total === 0 ? "No matches" : `${findIdx + 1} of ${find.state.total}${hit ? ` · page ${hit.page}` : ""}`}
          </span>
          <button type="button" className="icon-btn icon-btn-sm" aria-label="Previous match" disabled={find.state.total === 0} onClick={() => stepFind(-1)}>
            <ChevronUp size={16} aria-hidden="true" />
          </button>
          <button type="button" className="icon-btn icon-btn-sm" aria-label="Next match" disabled={find.state.total === 0} onClick={() => stepFind(1)}>
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          <button type="button" className="icon-btn icon-btn-sm" aria-label="Close search" onClick={closeFind}>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      )}

      {sel && onCreateNote && (
        <div
          className="pdfv-sel"
          role="toolbar"
          aria-label="Highlight the selected text"
          style={{ left: Math.min(Math.max(sel.x, 150), window.innerWidth - 150), top: Math.max(sel.y - 48, 8) }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {NOTE_COLORS.map((c) => (
            <button key={c} type="button" className="pdfv-sel-dot" data-color={c} aria-label={`Highlight in ${c}`} title={`Highlight in ${c}`} onClick={() => createFromSelection(c, false)} />
          ))}
          <span className="pdfv-sel-sep" aria-hidden="true" />
          <button type="button" className="pdfv-sel-note" onClick={() => createFromSelection("yellow", true)}>
            <StickyNote size={14} aria-hidden="true" />
            <span>Add note</span>
          </button>
        </div>
      )}

      <div className="pdfv-main">
        <div ref={rail} className="pdfv-rail" aria-label="Page thumbnails">
          {pages.map((n) => (
            <Thumb key={n} pdf={pdf} n={n} active={n === current} root={rail} onPick={(p) => goTo(p)} />
          ))}
        </div>
        <div ref={scroller} className="pdfv-scroll" tabIndex={0} role="region" aria-label={`Pages of ${title}`} onMouseUp={onCreateNote ? captureSelection : undefined} onKeyUp={onCreateNote ? captureSelection : undefined} onScroll={() => sel && setSel(null)}>
          <div className="pdfv-pages">
            {pages.map((n) => (
              <PdfPage key={n} pdf={pdf} n={n} scale={scale} size={sizes[n] ?? first} root={scroller} onSize={onSize} onText={onText} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
