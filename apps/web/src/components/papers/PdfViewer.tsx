import "pdfjs-dist/web/pdf_viewer.css";
import { m } from "motion/react";
import { ChevronLeft, ChevronRight, Download, Maximize2, Minus, Plus } from "lucide-react";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import type { PDFDocumentProxy } from "../../lib/pdf";
import { pdfjs } from "../../lib/pdf";
import { clearHighlights, highlightQuote } from "../../lib/highlight";
import { spring } from "../../lib/motion";

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

export function PdfViewer({ pdf, ref, title, downloadHref, onPage }: { pdf: PDFDocumentProxy; ref?: Ref<ViewerHandle>; title: string; downloadHref: string; onPage?: (n: number) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const [zoomIdx, setZoomIdx] = useState(3);
  const [width, setWidth] = useState(0);
  const [sizes, setSizes] = useState<Record<number, { w: number; h: number }>>({});
  const [current, setCurrent] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const layers = useRef(new Map<number, HTMLElement>());
  const pending = useRef<{ page: number; quote: string } | null>(null);
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

  const onText = useCallback(
    (n: number, layer: HTMLElement | null) => {
      if (layer) layers.current.set(n, layer);
      else layers.current.delete(n);
      if (layer && pending.current?.page === n) {
        const { quote } = pending.current;
        pending.current = null;
        applyHighlight(n, quote);
      }
    },
    [applyHighlight],
  );

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
    <div className="pdfv">
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

      <div className="pdfv-main">
        <div ref={rail} className="pdfv-rail" aria-label="Page thumbnails">
          {pages.map((n) => (
            <Thumb key={n} pdf={pdf} n={n} active={n === current} root={rail} onPick={(p) => goTo(p)} />
          ))}
        </div>
        <div ref={scroller} className="pdfv-scroll" tabIndex={0} role="region" aria-label={`Pages of ${title}`}>
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
