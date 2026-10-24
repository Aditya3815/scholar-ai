import "pdfjs-dist/web/pdf_viewer.css";
import { m } from "motion/react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Download, ListTree, Loader2, Maximize2, Minus, PencilLine, Plus, Search, StickyNote, X } from "lucide-react";
import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type Ref } from "react";
import { NOTE_COLORS, anchoredScroll, clampZoom, pinchFactor, stepZoom, wheelFactor, type DocNote, type InkSize, type InkStroke, type MarkRect, type NoteColor, type OutlineItem } from "@scholar/shared";
import type { PDFDocumentProxy } from "../../lib/pdf";
import { Pop } from "../Pop";
import { pdfjs } from "../../lib/pdf";
import { clearHighlights, highlightMatches, highlightQuote, quoteRects } from "../../lib/highlight";
import { locate, usePaperSearch } from "../../lib/paperSearch";
import { spring } from "../../lib/motion";
import { showNotice } from "../../lib/notice";
import type { InkApi } from "../../lib/ink";
import { InkLayer, type DrawTool } from "./InkLayer";
import { InkToolbar, type InkPrefs } from "./InkToolbar";

/** What the reader chose in the paper: a highlight in a colour, or a note. */
export type NewNote = { page: number; quote: string; color: NoteColor; withNote: boolean };

export type ViewerHandle = {
  /** Scroll to a page and, if a quote is given, highlight it once the page's text layer exists. */
  goTo: (page: number, quote?: string) => void;
};

const MAX_PAGE_PX = 920;

const INK_PREFS_KEY = "scholar.ink.prefs.v1";
const DEFAULT_PREFS: InkPrefs = { tool: "pen", color: { pen: "blue", highlighter: "yellow" }, size: { pen: "m", highlighter: "m", eraser: "m" }, finger: false };
/** The colours, sizes and finger setting the reader used last time (checked, since storage can hold anything). */
function readInkPrefs(): InkPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(INK_PREFS_KEY) ?? "null") as Partial<InkPrefs> | null;
    if (!raw) return DEFAULT_PREFS;
    const sizes = ["s", "m", "l", "xl"];
    const size = (v: unknown, d: InkSize): InkSize => (typeof v === "string" && sizes.includes(v) ? (v as InkSize) : d);
    return {
      tool: "hand",
      color: { pen: typeof raw.color?.pen === "string" ? raw.color.pen : "blue", highlighter: typeof raw.color?.highlighter === "string" ? raw.color.highlighter : "yellow" },
      size: { pen: size(raw.size?.pen, "m"), highlighter: size(raw.size?.highlighter, "m"), eraser: size(raw.size?.eraser, "m") },
      finger: raw.finger === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}
const NO_MARKS: PageMark[] = [];

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

/** Where one saved highlight is drawn on its page (its colour and note come from the note itself, so a change of colour needs no new measuring). */
type PageMark = { id: string; rects: MarkRect[] };

type PageProps = {
  pdf: PDFDocumentProxy;
  n: number;
  scale: number;
  size: { w: number; h: number };
  root: React.RefObject<HTMLElement | null>;
  onSize: (n: number, w: number, h: number) => void;
  onText: (n: number, layer: HTMLElement | null) => void;
  marks: PageMark[];
  notesById: Map<string, DocNote>;
  /** A note being written now shows its icon even before it has any words. */
  focusId: string | null;
  onOpenNote?: (id: string) => void;
  /** The drawing on this paper and the tool in hand; absent where drawing is not offered. */
  draw?: DrawProps;
};

/** What a page needs to show and take drawing. */
export type DrawProps = { strokes: InkStroke[]; tool: DrawTool; color: string; sizeKey: InkSize; finger: boolean; onStroke: (s: InkStroke) => void; onErase: (ids: string[]) => void; onFingerBlocked: () => void };

const ICON = 18;

/** The note icons of one page: just above the first line of the highlight, side by side where two would sit on top of each other. */
function noteIcons(marks: PageMark[], notesById: Map<string, DocNote>, focusId: string | null) {
  const placed: { x: number; y: number }[] = [];
  const out: { id: string; x: number; y: number; note: DocNote }[] = [];
  for (const m of marks) {
    const note = notesById.get(m.id);
    const first = m.rects[0];
    if (!note || !first || (note.note.trim() === "" && note.id !== focusId)) continue;
    // straddling the top-left corner of the highlight, like a sticky note on paper: seen at once, and covering little of the text
    let x = Math.max(2, first.x - ICON / 2);
    const y = Math.max(1, first.y - ICON / 2 - 3);
    while (placed.some((p) => Math.abs(p.x - x) < ICON + 2 && Math.abs(p.y - y) < ICON)) x += ICON + 2;
    placed.push({ x, y });
    out.push({ id: m.id, x, y, note });
  }
  return out;
}

function PdfPage({ pdf, n, scale, size, root, onSize, onText, marks, notesById, focusId, onOpenNote, draw }: PageProps) {
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
      {draw && <InkLayer page={n} size={size} strokes={draw.strokes} tool={draw.tool} color={draw.color} sizeKey={draw.sizeKey} finger={draw.finger} onStroke={draw.onStroke} onErase={draw.onErase} onFingerBlocked={draw.onFingerBlocked} />}
      <div ref={text} className="textLayer pdfp-text" />
      {marks.length > 0 && (
        <div className="pdfp-marks">
          {marks.map((m) =>
            m.rects.map((r, i) => <span key={`${m.id}-${i}`} className="pdfp-hl" data-color={notesById.get(m.id)?.color ?? "yellow"} data-note={m.id} aria-hidden="true" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />),
          )}
          {noteIcons(marks, notesById, focusId).map((ic) => (
            <button
              key={ic.id}
              type="button"
              className="pdfp-noteicon"
              data-color={ic.note.color}
              data-note={ic.id}
              style={{ left: ic.x, top: ic.y }}
              aria-label={`Open the note on page ${n}${ic.note.note.trim() ? `: ${ic.note.note.trim().slice(0, 60)}` : ""}`}
              title={ic.note.note.trim() ? ic.note.note.trim().slice(0, 140) : "Note (empty)"}
              onClick={() => onOpenNote?.(ic.id)}
            >
              <StickyNote size={11} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
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

export function PdfViewer({ pdf, ref, title, downloadHref, onPage, contents, notes, onCreateNote, focusNoteId = null, onOpenNote, ink }: { pdf: PDFDocumentProxy; ref?: Ref<ViewerHandle>; title: string; downloadHref: string; onPage?: (n: number) => void; contents?: { items: OutlineItem[]; detected: boolean }; notes?: DocNote[]; onCreateNote?: (n: NewNote) => void; focusNoteId?: string | null; onOpenNote?: (id: string) => void; /** Drawing on the paper (My Workspace). Without it the viewer has no drawing tools. */ ink?: InkApi }) {
  const scroller = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLDivElement>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [width, setWidth] = useState(0);
  const [sizes, setSizes] = useState<Record<number, { w: number; h: number }>>({});
  const [current, setCurrent] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const layers = useRef(new Map<number, HTMLElement>());
  const notesRef = useRef<DocNote[]>(notes ?? []);
  notesRef.current = notes ?? [];
  const [marks, setMarks] = useState<Record<number, PageMark[]>>({});
  const notesById = useMemo(() => new Map((notes ?? []).map((x) => [x.id, x])), [notes]);
  const [sel, setSel] = useState<{ page: number; quote: string; x: number; y: number; hidden?: boolean } | null>(null);
  const selFrame = useRef(0);
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

  /* ---- zoom: the buttons, and a pinch (two fingers on a touch screen, or a trackpad pinch, which a browser reports as Ctrl and the wheel) ---- */
  const pagesEl = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  zoomRef.current = zoomLevel;
  /** The point to keep still when the new zoom is drawn: where it was in the pages and where it was in the view. */
  const anchor = useRef<{ fx: number; fy: number; cx: number; cy: number; f: number; h0: number } | null>(null);
  /** The height of a page as laid out now. The pages can grow by a little less or more than the zoom (the width they fit to changes with the scroll bars), so the scroll is set from this. */
  const pageHeight = () => pagesEl.current?.querySelector<HTMLElement>(".pdfp")?.offsetHeight ?? 0;
  /** A pinch in progress: pages are scaled with a transform (cheap, and smooth) and the real zoom is set when the fingers rest. */
  const live = useRef<{ f: number; fx: number; fy: number; cx: number; cy: number; timer: number } | null>(null);

  const commitPinch = useCallback(() => {
    const l = live.current;
    live.current = null;
    if (!l) return;
    const pg = pagesEl.current;
    if (pg) {
      pg.style.transform = "";
      pg.style.transformOrigin = "";
    }
    const next = clampZoom(zoomRef.current * l.f);
    if (Math.abs(next - zoomRef.current) < 0.002) return;
    anchor.current = { fx: l.fx, fy: l.fy, cx: l.cx, cy: l.cy, f: next / zoomRef.current, h0: pageHeight() };
    setZoomLevel(next);
  }, []);

  const pinchBy = useCallback(
    (factor: number, clientX: number, clientY: number) => {
      const sc = scroller.current;
      const pg = pagesEl.current;
      if (!sc || !pg || !Number.isFinite(factor)) return;
      const box = sc.getBoundingClientRect();
      let l = live.current;
      if (!l) l = live.current = { f: 1, fx: sc.scrollLeft + clientX - box.left, fy: sc.scrollTop + clientY - box.top, cx: clientX - box.left, cy: clientY - box.top, timer: 0 };
      l.f = clampZoom(zoomRef.current * l.f * factor) / zoomRef.current;
      pg.style.transformOrigin = `${l.fx}px ${l.fy}px`;
      pg.style.transform = `scale(${l.f})`;
      window.clearTimeout(l.timer);
      l.timer = window.setTimeout(commitPinch, 160);
    },
    [commitPinch],
  );

  /** Zoom by a button or a step: about the middle of what is in view. */
  const zoomTo = useCallback((level: number) => {
    const sc = scroller.current;
    const next = clampZoom(level);
    if (!sc || Math.abs(next - zoomRef.current) < 0.002) return;
    anchor.current = { fx: sc.scrollLeft + sc.clientWidth / 2, fy: sc.scrollTop + sc.clientHeight / 2, cx: sc.clientWidth / 2, cy: sc.clientHeight / 2, f: next / zoomRef.current, h0: pageHeight() };
    setZoomLevel(next);
  }, []);

  // after the pages have their new size, scroll so that the point that was under the fingers is still there
  useLayoutEffect(() => {
    const a = anchor.current;
    const sc = scroller.current;
    anchor.current = null;
    if (!a || !sc) return;
    const h1 = pageHeight();
    const f = a.h0 > 0 && h1 > 0 ? h1 / a.h0 : a.f; // how much the pages really grew
    sc.scrollLeft = anchoredScroll(a.fx - a.cx, a.cx, f);
    sc.scrollTop = anchoredScroll(a.fy - a.cy, a.cy, f);
  }, [zoomLevel]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    // a trackpad pinch (and Ctrl with a mouse wheel) is a wheel event with Ctrl held; it must not zoom the whole page
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      pinchBy(wheelFactor(e.deltaY, e.deltaMode), e.clientX, e.clientY);
    };
    // two fingers on a touch screen: only while there are two, so one finger still scrolls and selects
    let last = 0;
    const dist = (t: TouchList) => Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const onTouchStart = (e: TouchEvent) => {
      last = e.touches.length === 2 ? dist(e.touches) : 0;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const d = dist(e.touches);
      if (last > 0) pinchBy(pinchFactor(last, d), (e.touches[0]!.clientX + e.touches[1]!.clientX) / 2, (e.touches[0]!.clientY + e.touches[1]!.clientY) / 2);
      last = d;
    };
    const onTouchEnd = (e: TouchEvent) => {
      last = e.touches.length === 2 ? dist(e.touches) : 0;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      if (live.current) window.clearTimeout(live.current.timer);
    };
  }, [pinchBy]);

  /* ---- drawing: pen, highlighter, eraser (only where `ink` is given) ---- */
  const [drawOpen, setDrawOpen] = useState(false);
  const [prefs, setPrefs] = useState<InkPrefs>(readInkPrefs);
  const savePrefs = useCallback((p: InkPrefs) => {
    setPrefs(p);
    try {
      localStorage.setItem(INK_PREFS_KEY, JSON.stringify(p));
    } catch {
      /* private mode: the choices are just not remembered */
    }
  }, []);
  const canTouch = typeof navigator !== "undefined" && (navigator.maxTouchPoints > 0 || (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches));
  /** Drawing starts when the strokes saved before have been loaded (else a first stroke could cover them). */
  const tool: DrawTool = ink && drawOpen && ink.ready ? prefs.tool : "hand";
  const hintShown = useRef(false);
  const inkRef = useRef(ink);
  inkRef.current = ink;
  const draw = useMemo<DrawProps | undefined>(() => {
    if (!ink) return undefined;
    const kind = tool === "hand" ? "pen" : tool;
    return {
      strokes: ink.strokes,
      tool,
      color: kind === "eraser" ? "" : prefs.color[kind],
      sizeKey: prefs.size[kind],
      finger: prefs.finger,
      onStroke: (s) => inkRef.current?.add(s),
      onErase: (ids) => inkRef.current?.erase(ids),
      onFingerBlocked: () => {
        if (hintShown.current) return;
        hintShown.current = true;
        showNotice("A finger scrolls the paper. Turn on \u201CDraw with a finger\u201D in the drawing tools to draw with it. A stylus always draws.");
      },
    };
  }, [ink, tool, prefs]);
  const closeDraw = useCallback(() => {
    setDrawOpen(false);
    setPrefs((p) => ({ ...p, tool: "hand" }));
  }, []);
  // keyboard: V P H E choose the tool, Ctrl+Z undoes, Ctrl+Shift+Z or Ctrl+Y redoes, Esc closes (never while typing, or inside a dialog)
  useEffect(() => {
    if (!ink || !drawOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        (e.shiftKey ? inkRef.current?.redo : inkRef.current?.undo)?.();
      } else if (mod && k === "y") {
        e.preventDefault();
        inkRef.current?.redo();
      } else if (!mod && !e.altKey && ["v", "p", "h", "e"].includes(k)) {
        e.preventDefault();
        setPrefs((p) => {
          const next: InkPrefs = { ...p, tool: ({ v: "hand", p: "pen", h: "highlighter", e: "eraser" } as const)[k as "v"] };
          try {
            localStorage.setItem(INK_PREFS_KEY, JSON.stringify(next));
          } catch {
            /* ignore */
          }
          return next;
        });
      } else if (k === "escape" && !mod) {
        closeDraw();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ink, drawOpen, closeDraw]);

  const first = sizes[1] ?? { w: 595, h: 842 };
  const fit = width > 0 ? Math.min((width - 32) / first.w, MAX_PAGE_PX / first.w) : 1;
  const scale = Math.max(0.2, fit * zoomLevel);

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

  /** Measures where the saved highlights of one page are, once its text is on screen. They are drawn in a layer of their own, so several can overlap. */
  const paintSaved = useCallback((n: number) => {
    const layer = layers.current.get(n);
    if (!layer) return;
    const list: PageMark[] = [];
    for (const note of notesRef.current) {
      if (note.page !== n) continue;
      const rects = quoteRects(layer, note.quote);
      if (rects.length > 0) list.push({ id: note.id, rects });
    }
    setMarks((m) => ({ ...m, [n]: list }));
  }, []);

  const onText = useCallback(
    (n: number, layer: HTMLElement | null) => {
      if (layer) {
        layers.current.set(n, layer);
        paintSaved(n);
      } else {
        layers.current.delete(n);
        setMarks((m) => (m[n] ? { ...m, [n]: [] } : m));
      }
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
    const view = scroller.current.getBoundingClientRect();
    setSel({ page: Number(box.dataset.page), quote: quote.slice(0, 600), x: r.left + r.width / 2, y: Math.max(r.top, view.top + 52) });
  }, []);
  /**
   * The toolbar belongs to the selected text, not to the spot on the screen where it appeared: while the page is scrolled it follows the text (and waits at the top
   * edge when the first line has gone above it), and it is hidden only while the whole selection is out of sight. Scrolling back brings it back.
   */
  const followSelection = useCallback(() => {
    if (selFrame.current) return;
    selFrame.current = requestAnimationFrame(() => {
      selFrame.current = 0;
      const s = window.getSelection();
      const view = scroller.current?.getBoundingClientRect();
      if (!s || s.isCollapsed || s.rangeCount === 0 || !view) return setSel(null);
      const r = s.getRangeAt(0).getBoundingClientRect();
      const out = r.bottom < view.top + 8 || r.top > view.bottom - 8;
      setSel((cur) => (cur ? { ...cur, hidden: out, x: Math.min(Math.max(r.left + r.width / 2, view.left + 120), view.right - 120), y: Math.max(r.top, view.top + 52) } : cur));
    });
  }, []);
  useEffect(() => () => cancelAnimationFrame(selFrame.current), []);
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

  const pages = useMemo(() => Array.from({ length: N }, (_, i) => i + 1), [N]);

  return (
    <div
      className="pdfv"
      data-drawing={tool !== "hand"}
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
          {ink && (
            <button type="button" className="btn btn-ghost btn-sm pdfv-draw" aria-pressed={drawOpen} title="Draw and highlight on the paper" onClick={() => (drawOpen ? closeDraw() : (setDrawOpen(true), setPrefs((p) => (p.tool === "hand" ? { ...p, tool: "pen" } : p))))}>
              <PencilLine size={15} aria-hidden="true" />
              <span>Draw</span>
            </button>
          )}
          {contents && <Contents items={contents.items} detected={contents.detected} current={current} onPick={(p) => goTo(p)} />}
          <button type="button" className="icon-btn icon-btn-sm" aria-label="Zoom out" disabled={zoomLevel <= 0.6} onClick={() => zoomTo(stepZoom(zoomLevel, -1))}>
            <Minus size={16} aria-hidden="true" />
          </button>
          <button type="button" className="pdfv-pct" aria-label="Fit to width" title="Fit to width" onClick={() => zoomTo(1)}>
            {Math.round(zoomLevel * 100)}%
          </button>
          <button type="button" className="icon-btn icon-btn-sm" aria-label="Zoom in" disabled={zoomLevel >= 2.5} onClick={() => zoomTo(stepZoom(zoomLevel, 1))}>
            <Plus size={16} aria-hidden="true" />
          </button>
          <button type="button" className="icon-btn icon-btn-sm pdfv-fit" aria-label="Fit to width" onClick={() => zoomTo(1)}>
            <Maximize2 size={15} aria-hidden="true" />
          </button>
          <a className="icon-btn icon-btn-sm" href={downloadHref} download aria-label={`Download ${title}`} title="Download the PDF">
            <Download size={15} aria-hidden="true" />
          </a>
        </div>
      </div>

      {ink && <InkToolbar open={drawOpen} prefs={prefs} onPrefs={savePrefs} ink={ink} canTouch={canTouch} onClose={closeDraw} />}

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

      {sel && !sel.hidden && onCreateNote && (
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
        <div ref={scroller} className="pdfv-scroll" tabIndex={0} role="region" aria-label={`Pages of ${title}`} onMouseUp={onCreateNote ? captureSelection : undefined} onKeyUp={onCreateNote ? captureSelection : undefined} onScroll={sel ? followSelection : undefined}>
          <div ref={pagesEl} className="pdfv-pages">
            {pages.map((n) => (
              <PdfPage key={n} pdf={pdf} n={n} scale={scale} size={sizes[n] ?? first} root={scroller} onSize={onSize} onText={onText} marks={marks[n] ?? NO_MARKS} notesById={notesById} focusId={focusNoteId} onOpenNote={onOpenNote} draw={draw} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
