import { Eraser, Hand, Highlighter, PenLine, Redo2, SeparatorHorizontal, Undo2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import {
  HIGHLIGHTER_COLORS,
  INK_SIZES,
  NOTE_ERASER_EM,
  NOTE_HIGHLIGHTER_EM,
  NOTE_PEN_EM,
  PEN_COLORS,
  strokesWord,
  type InkSize,
  type NotebookBlock,
  type NoteStroke,
  type SketchBlock,
} from "@scholar/shared";
import { idbDelete, idbGet, idbSet } from "../../../../lib/idb";
import { isEraserEnd, pressureOf, samplesOf, touchVerdict } from "../../../../lib/ink-input";
import { markerPath, penPath } from "../../../../lib/ink-path";
import type { NotebookStore } from "../../../../lib/notebook";
import { anchorStroke, eraseHits, inkPlainOf, nearestIndex, placeStroke, sketchToInk, type BlockGeo, type Box, type PageGeo, type PlacedStroke, type TextGeo } from "../../../../lib/note-ink";
import { createNoteInkStore, type InkState, type NoteInkStore } from "../../../../lib/note-ink-store";
import { showNotice } from "../../../../lib/notice";
import { toast } from "../../../../lib/toast";

/**
 * Ink on the pages of notes (docs/design/paper-reader.md, 25): the `nb-ink` chunk, fetched when a page has ink or Draw is pressed. The layer that draws every stroke where its anchor is now
 * (one SVG over the page's blocks, never catching the pointer, so typing works as before), the layer that catches the pen in Draw mode, the ink row that takes the format row's place, and
 * the store that saves it. A Viewer's read-only notes draw the same ink with the same engine (InkView).
 */

export type InkTool = "pen" | "highlighter" | "eraser";
export type InkPrefs = { tool: InkTool; color: { pen: string; highlighter: string }; size: InkSize; finger: boolean };
const PREFS_KEY = "scholar.nbInk";
export const readPrefs = (): InkPrefs => {
  const base: InkPrefs = { tool: "pen", color: { pen: "ink", highlighter: "yellow" }, size: "m", finger: false };
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "null") as Partial<InkPrefs> | null;
    return v ? { ...base, ...v, color: { ...base.color, ...(v.color ?? {}) } } : base;
  } catch {
    return base;
  }
};
export const writePrefs = (p: InkPrefs) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* private mode: for this visit */
  }
};
/** An id made here (as the notebook's: lib/notebook.ts is not imported, so this chunk does not take it from the Notebook's). */
const newId = (): string => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 20) : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
const SIZE_NAME: Record<InkSize, string> = { s: "Fine", m: "Medium", l: "Thick", xl: "Very thick" };

/* ---------------------------------------------------------------- the store, one per notebook */

const stores = new WeakMap<NotebookStore, NoteInkStore>();
/** The ink store of a notebook: made once, loaded from what the notebook's load brought, sent when the page is hidden, and destroyed with the notebook. */
export function inkStoreFor(nb: NotebookStore): NoteInkStore {
  let s = stores.get(nb);
  if (s) return s;
  s = createNoteInkStore(
    nb,
    {
      fetch: (u, init) => fetch(u, init),
      idb: { get: (k) => idbGet(k), set: (k, v) => idbSet(k, v), delete: (k) => idbDelete(k) },
      timers: { set: (fn, ms) => window.setTimeout(fn, ms), clear: (id) => window.clearTimeout(id) },
      notice: showNotice,
    },
    (pageId, blocks) => nb.setBlocks(pageId, blocks),
  );
  stores.set(nb, s);
  const made = s;
  const hide = () => document.visibilityState === "hidden" && made.flush();
  const flush = () => made.flush();
  document.addEventListener("visibilitychange", hide);
  window.addEventListener("pagehide", flush);
  // someone else's saved drawing comes in with the notebook's refresh (live updates)
  nb.onServerRead(() => made.takeServer());
  nb.onDestroy(() => {
    document.removeEventListener("visibilitychange", hide);
    window.removeEventListener("pagehide", flush);
    made.destroy();
  });
  void s.load();
  return s;
}
const NONE: InkState = { pages: new Map(), tick: 0 };
const noop = () => () => {};
export function useInk(store: NoteInkStore | null): InkState {
  return useSyncExternalStore(store?.subscribe ?? noop, store?.get ?? (() => NONE), () => NONE);
}

/* ---------------------------------------------------------------- measuring the page */

/** A block of text, measured from its DOM: the boxes of its characters, relative to the layer (`origin`), measured only when asked. */
function textGeo(el: HTMLElement, origin: DOMRect): TextGeo {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let len = 0;
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    nodes.push(n as Text);
    starts.push(len);
    len += (n as Text).data.length;
  }
  const cache = new Map<number, Box | null>();
  const range = document.createRange();
  const box = (i: number): Box | null => {
    if (i < 0 || i >= len) return null;
    if (cache.has(i)) return cache.get(i)!;
    let k = 0;
    let lo = 0, hi = starts.length - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (starts[m]! <= i) {
        k = m;
        lo = m + 1;
      } else hi = m - 1;
    }
    const node = nodes[k]!;
    const off = i - starts[k]!;
    range.setStart(node, off);
    range.setEnd(node, Math.min(node.data.length, off + 1));
    const rects = range.getClientRects();
    let r: DOMRect | null = null;
    for (const x of rects) if (x.width > 0 || x.height > 0) r = r ?? x;
    const b = r ? { left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top } : null;
    cache.set(i, b);
    return b;
  };
  return {
    len,
    box,
    nearest: (x, y) => nearestIndex(Array.from({ length: len }, (_, i) => box(i)), x, y),
  };
}

/** The page measured, relative to the ink layer's box (`wrap`): every block's body, and its text where it is drawn (a block open for typing is a field: its text is not measured). */
export function measurePage(wrap: HTMLElement, blocks: readonly NotebookBlock[], room: HTMLElement | null): PageGeo {
  const origin = wrap.getBoundingClientRect();
  const kinds = new Map(blocks.map((b) => [b.id, b.kind]));
  const geo: BlockGeo[] = [];
  let first: Box | null = null;
  for (const li of wrap.querySelectorAll<HTMLElement>("[data-block]")) {
    const id = li.dataset.block!;
    const kind = kinds.get(id);
    const body = li.querySelector<HTMLElement>("[data-ink-body]");
    if (!kind || !body) continue;
    const r = body.getBoundingClientRect();
    const b = { left: r.left - origin.left, top: r.top - origin.top, right: r.right - origin.left, bottom: r.bottom - origin.top };
    first ??= b;
    const t = li.querySelector<HTMLElement>("[data-ink-text]");
    geo.push({ id, kind, body: b, text: t ? textGeo(t, origin) : null });
  }
  const em = parseFloat(getComputedStyle(document.documentElement).fontSize || "16") * 0.95;
  const pad = 14;
  let roomBox: Box | null = null;
  if (room) {
    const rr = room.getBoundingClientRect();
    const left = first?.left ?? 30;
    const right = first?.right ?? origin.width - 30;
    roomBox = { left, right, top: rr.top - origin.top, bottom: rr.bottom - origin.top };
  }
  return { em, blocks: geo, room: roomBox, maxRight: origin.width + pad, minLeft: -pad };
}

/* ---------------------------------------------------------------- drawing a stroke */

/** The look of a stroke on screen: the pen's colour follows the theme (notebook.css --nbi-*), the highlighter is see-through. */
function StrokePath({ p, faded }: { p: PlacedStroke; faded?: boolean }) {
  const s = p.s;
  if (s.tool === "pen") return <path d={penPath(p.pts, p.w, 1)} className="nbi-pen" style={{ fill: `var(--nbi-${s.color})` }} opacity={faded ? 0.25 : undefined} />;
  return <path d={markerPath(p.pts, 1)} className="nbi-hl" style={{ stroke: `var(--nbh-${s.color})` }} strokeWidth={p.w} opacity={faded ? 0.25 : undefined} />;
}

type LayerProps = {
  wrap: RefObject<HTMLDivElement | null>;
  room?: RefObject<HTMLDivElement | null>;
  blocks: readonly NotebookBlock[];
  strokes: readonly NoteStroke[];
  /** The block open for typing (its text is a field): its strokes stay at their last place, faded. */
  editing?: string | null;
};

/** Where each stroke is now, measured after every change of the page, its width or its fonts. Strokes on a block open for typing keep their last place (`faded`). */
function usePlaced({ wrap, room, blocks, strokes, editing }: LayerProps): { placed: PlacedStroke[]; faded: Set<string>; geo: () => PageGeo | null } {
  const [size, setSize] = useState(0);
  const last = useRef(new Map<string, PlacedStroke>());
  const [out, setOut] = useState<{ placed: PlacedStroke[]; faded: Set<string> }>({ placed: [], faded: new Set() });
  const texts = useMemo(() => new Map(blocks.flatMap((b) => (inkPlainOf(b) !== null ? [[b.id, inkPlainOf(b)!] as const] : []))), [blocks]);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize((n) => n + 1));
    ro.observe(el);
    const list = el.querySelector("ol");
    if (list) ro.observe(list);
    void document.fonts?.ready.then(() => setSize((n) => n + 1));
    return () => ro.disconnect();
  }, [wrap]);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el || !strokes.length) {
      setOut({ placed: [], faded: new Set() });
      return;
    }
    const g = measurePage(el, blocks, room?.current ?? null);
    const placed: PlacedStroke[] = [];
    const faded = new Set<string>();
    for (const s of strokes) {
      const p = s.a.b === editing ? null : placeStroke(s, g, texts);
      if (p) {
        last.current.set(s.id, p);
        placed.push(p);
      } else {
        const was = last.current.get(s.id);
        if (was && s.a.b === editing) {
          placed.push({ ...was, s });
          faded.add(s.id);
        }
      }
    }
    setOut({ placed, faded });
  }, [wrap, room, blocks, strokes, editing, size, texts]);
  const geo = useCallback(() => (wrap.current ? measurePage(wrap.current, blocks, room?.current ?? null) : null), [wrap, room, blocks]);
  return { ...out, geo };
}

/** The ink of a page, drawn, for reading (a Viewer's notes, or the owner's when not drawing): an SVG that never catches the pointer. */
export function InkView(props: LayerProps & { hidden?: boolean }) {
  const { placed, faded } = usePlaced(props);
  if (props.hidden || !placed.length) return null;
  return (
    <svg className="nb-inksvg" aria-hidden="true" focusable="false">
      {placed.map((p) => (
        <StrokePath key={p.s.id} p={p} faded={faded.has(p.s.id)} />
      ))}
    </svg>
  );
}

type DrawProps = LayerProps & {
  pageId: string;
  store: NoteInkStore;
  prefs: InkPrefs;
  setPrefs: (p: InkPrefs) => void;
  /** The page's blocks changed by the drawing (a space made, or made taller). */
  onBlocks: (blocks: NotebookBlock[]) => void;
  /** Leave Draw mode (Esc, V, D, Done). */
  onLeave: () => void;
  announce: (s: string) => void;
  /** The scroller, for a two-finger drag while Finger is on. */
  scroller: () => HTMLElement | null;
};

/**
 * The page in Draw mode: the ink drawn (as InkView) and, over the blocks and their margins, the layer that catches the pen. Pointer events: a stylus and a mouse draw; a finger scrolls unless
 * Finger is on (then one finger draws and two scroll); the palm is ignored for 4 s after a stylus was seen; the stylus's eraser end erases. The pen lifts: the stroke is attached (lib/note-ink.ts).
 */
export function InkDraw(props: DrawProps) {
  const { store, pageId, prefs, blocks, strokes, onBlocks } = props;
  const { placed, faded, geo } = usePlaced(props);
  const svg = useRef<SVGSVGElement>(null);
  const live = useRef<SVGPathElement>(null);
  const act = useRef<{ id: number; mode: "draw" | "erase"; pts: number[]; hits: Set<string>; frame: number } | null>(null);
  const [erasing, setErasing] = useState<Set<string>>(new Set());
  const touches = useRef(new Map<number, number>());
  const penSeen = useRef(-Infinity);
  const em = () => parseFloat(getComputedStyle(document.documentElement).fontSize || "16") * 0.95;
  const at = (e: { clientX: number; clientY: number }) => {
    const r = props.wrap.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const wEm = (t: "pen" | "highlighter") => (t === "pen" ? NOTE_PEN_EM : NOTE_HIGHLIGHTER_EM)[prefs.size];
  const paint = () => {
    const a = act.current;
    if (!a) return;
    a.frame = 0;
    const t = prefs.tool === "highlighter" ? "highlighter" : "pen";
    live.current?.setAttribute("d", t === "pen" ? penPath(a.pts, wEm("pen") * em(), 1) : markerPath(a.pts, 1));
  };
  const sweep = (x: number, y: number) => {
    const a = act.current;
    if (!a) return;
    const hits = eraseHits(placed, x, y, NOTE_ERASER_EM[prefs.size] * em());
    if (hits.some((h) => !a.hits.has(h))) {
      hits.forEach((h) => a.hits.add(h));
      setErasing(new Set(a.hits));
    }
  };

  const down = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.pointerType === "pen") penSeen.current = Date.now();
    if (e.pointerType === "touch") {
      touches.current.set(e.pointerId, e.clientY);
      const v = touchVerdict(touches.current.size, prefs.finger, penSeen.current, Date.now());
      if (v === "pinch") return cancel();
      if (v === "finger-off") {
        toast("Turn on Finger to draw with your finger", { label: "Turn on", run: () => props.setPrefs({ ...prefs, finger: true }) });
        return;
      }
      if (v === "palm") return;
    }
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* a pointer the browser no longer has (a synthetic one): drawn without capture */
    }
    e.currentTarget.focus({ preventScroll: true });
    const [x, y] = at(e);
    const erase = prefs.tool === "eraser" || isEraserEnd(e);
    act.current = { id: e.pointerId, mode: erase ? "erase" : "draw", pts: [x!, y!, pressureOf(e)], hits: new Set(), frame: 0 };
    if (erase) sweep(x!, y!);
    else paint();
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch" && touches.current.size > 1 && prefs.finger) {
      // two fingers: the page scrolls by their drag
      const was = touches.current.get(e.pointerId);
      if (was !== undefined) props.scroller()?.scrollBy(0, was - e.clientY);
      touches.current.set(e.pointerId, e.clientY);
      return;
    }
    const a = act.current;
    if (!a || e.pointerId !== a.id) return;
    const r = props.wrap.current!.getBoundingClientRect();
    for (const ev of samplesOf(e.nativeEvent)) {
      const x = ev.clientX - r.left, y = ev.clientY - r.top;
      if (a.mode === "erase") {
        sweep(x, y);
        continue;
      }
      const n = a.pts.length;
      if (Math.hypot(x - a.pts[n - 3]!, y - a.pts[n - 2]!) < 0.8) continue;
      a.pts.push(x, y, pressureOf(ev));
    }
    if (a.mode === "draw" && !a.frame) a.frame = requestAnimationFrame(paint);
  };
  const cancel = () => {
    const a = act.current;
    if (a) cancelAnimationFrame(a.frame);
    act.current = null;
    live.current?.setAttribute("d", "");
    setErasing(new Set());
  };
  const up = (e: ReactPointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId);
    const a = act.current;
    if (!a || e.pointerId !== a.id) return;
    cancel();
    if (a.mode === "erase") {
      if (a.hits.size) store.commit(pageId, [], [...a.hits]);
      return;
    }
    const g = geo();
    if (!g) return;
    const t = prefs.tool === "highlighter" ? "highlighter" : "pen";
    const texts = new Map(blocks.flatMap((b) => (inkPlainOf(b) !== null ? [[b.id, inkPlainOf(b)!] as const] : [])));
    const made = anchorStroke(a.pts, t, prefs.color[t], wEm(t), g, { stroke: newId(), space: newId }, texts);
    if (!made) return;
    const before = [...blocks];
    let after: NotebookBlock[] | null = null;
    if (made.ask.space) after = [...before, { id: made.ask.space.id, kind: "space", h: made.ask.space.h }];
    else if (made.ask.grow) {
      const { id, h } = made.ask.grow;
      if (before.some((b) => b.id === id && b.kind === "space" && b.h < h)) after = before.map((b) => (b.id === id && b.kind === "space" ? { ...b, h } : b));
    }
    if (after) onBlocks(after);
    store.commit(pageId, [made.stroke], [], after ? { before, after } : undefined);
  };

  return (
    <>
      <svg ref={svg} className="nb-inksvg" aria-hidden="true" focusable="false">
        {placed.map((p) => (
          <StrokePath key={p.s.id} p={p} faded={faded.has(p.s.id) || erasing.has(p.s.id)} />
        ))}
        <path ref={live} d="" className={prefs.tool === "highlighter" ? "nbi-hl" : "nbi-pen"} style={prefs.tool === "highlighter" ? { stroke: `var(--nbh-${prefs.color.highlighter})`, strokeWidth: wEm("highlighter") * em() } : { fill: `var(--nbi-${prefs.color.pen})` }} />
      </svg>
      <div
        className="nb-inkcatch"
        tabIndex={-1}
        aria-hidden="true"
        data-tool={prefs.tool}
        data-finger={prefs.finger || undefined}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={(e) => {
          touches.current.delete(e.pointerId);
          cancel();
        }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <span className="sr-only" aria-live="polite">{strokes.length ? `${strokesWord(strokes.length)} on this page` : ""}</span>
    </>
  );
}

/* ---------------------------------------------------------------- the ink row */

type RowProps = {
  prefs: InkPrefs;
  setPrefs: (p: InkPrefs) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSpace: () => void;
  onLeave: () => void;
  announce: (s: string) => void;
};

/**
 * The ink row (25.6): in Draw mode it takes the format row's place, one row: Draw (pressed) · Pen · Highlighter · Eraser | the tool's colours | S M L XL | Undo · Redo | Finger | Insert space |
 * Done. The paper's tools, colours, sizes and keys (P, H, E; Ctrl+Z and Ctrl+Shift+Z); Esc, V, D or Done go back to typing. On a phone the colours open from one button, and the row scrolls
 * sideways with a fade.
 */
export function InkRow({ prefs, setPrefs, canUndo, canRedo, onUndo, onRedo, onSpace, onLeave, announce }: RowProps) {
  const row = useRef<HTMLDivElement>(null);
  const [colors, setColors] = useState(false);
  // the row's fade on the side that has more (a phone), as the format row's
  const [more, setMore] = useState("");
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const seen = () => {
      const start = el.scrollLeft > 1;
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setMore(start && end ? "both" : start ? "start" : end ? "end" : "");
    };
    seen();
    el.addEventListener("scroll", seen, { passive: true });
    const ro = new ResizeObserver(seen);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", seen);
      ro.disconnect();
    };
  }, []);
  const pen = prefs.tool === "highlighter" ? "highlighter" : "pen";
  const palette = pen === "pen" ? PEN_COLORS : HIGHLIGHTER_COLORS;
  const current = palette.find((c) => c.id === prefs.color[pen]) ?? palette[0]!;
  const tool = (t: InkTool) => {
    setPrefs({ ...prefs, tool: t });
    announce(t === "pen" ? "Pen" : t === "highlighter" ? "Highlighter" : "Eraser: touch a stroke to take it away");
  };
  // the keys of Draw mode, wherever the focus is (but not in a text field): they win over the reader's own letters while drawing
  const keys = useRef({ tool, onUndo, onRedo, onLeave });
  keys.current = { tool, onUndo, onRedo, onLeave };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      let done = true;
      if (mod && !e.altKey && k === "z") (e.shiftKey ? keys.current.onRedo : keys.current.onUndo)();
      else if (mod && !e.altKey && k === "y") keys.current.onRedo();
      else if (mod || e.altKey) done = false;
      else if (k === "escape" || k === "v" || k === "d") {
        if (t?.closest?.("[role='menu'], [role='dialog']") && k === "escape") return;
        keys.current.onLeave();
      } else if (k === "p") keys.current.tool("pen");
      else if (k === "h") keys.current.tool("highlighter");
      else if (k === "e") keys.current.tool("eraser");
      else done = false;
      if (done) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  const roving = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled])")].filter((b) => b.offsetParent !== null);
    const k = items.indexOf(document.activeElement as HTMLElement);
    const to = e.key === "ArrowRight" ? (k + 1) % items.length : e.key === "ArrowLeft" ? (k - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
    if (to < 0 || k < 0) return;
    e.preventDefault();
    items[to]?.focus();
  };
  return (
    <div className="nb-inkrow" role="toolbar" aria-label="Draw on this page" onKeyDown={roving}>
      <div ref={row} className="nb-tools-main nb-inkrow-main" data-more={more || undefined}>
        <button type="button" className="nb-tool nb-inkon" aria-pressed="true" aria-keyshortcuts="D" title="Draw (D): press to go back to typing" onClick={onLeave} data-ink-toggle>
          <PenLine size={15} aria-hidden="true" />
          <span className="nb-tl">Draw</span>
        </button>
        <i aria-hidden="true" />
        <span role="radiogroup" aria-label="Tool" className="nb-inkgroup">
          {(
            [
              ["pen", "Pen", "P", PenLine],
              ["highlighter", "Highlighter", "H", Highlighter],
              ["eraser", "Eraser", "E", Eraser],
            ] as const
          ).map(([id, label, key, Icon]) => (
            <button key={id} type="button" role="radio" aria-checked={prefs.tool === id} className="nb-tool" aria-label={label} aria-keyshortcuts={key} title={`${label} (${key})`} onClick={() => tool(id)}>
              <Icon size={15} aria-hidden="true" />
            </button>
          ))}
        </span>
        {prefs.tool !== "eraser" && (
          <>
            <i aria-hidden="true" />
            <button type="button" className="nb-tool nb-inkpalbtn" aria-expanded={colors} aria-controls="nb-inkpal" aria-label={`Colour: ${current.label}`} title="Colour" onClick={() => setColors((o) => !o)}>
              <span className="nb-inkdot" style={{ background: current.hex }} aria-hidden="true" />
            </button>
            <span id="nb-inkpal" role="radiogroup" aria-label="Colour" className="nb-inkgroup nb-inkpal" data-open={colors || undefined}>
              {palette.map((c) => (
                <button key={c.id} type="button" role="radio" aria-checked={prefs.color[pen] === c.id} className="nb-tool nb-inkcolor" aria-label={c.label} title={c.label} onClick={() => (setPrefs({ ...prefs, color: { ...prefs.color, [pen]: c.id } }), setColors(false))}>
                  <span className="nb-inkdot" style={{ background: c.hex }} aria-hidden="true" />
                </button>
              ))}
            </span>
          </>
        )}
        <i aria-hidden="true" />
        <span role="radiogroup" aria-label="Size" className="nb-inkgroup">
          {INK_SIZES.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={prefs.size === k} className="nb-tool" aria-label={SIZE_NAME[k]} title={SIZE_NAME[k]} onClick={() => setPrefs({ ...prefs, size: k })}>
              <span className="nb-sk-dot" data-size={k} aria-hidden="true" />
            </button>
          ))}
        </span>
        <i aria-hidden="true" />
        <button type="button" className="nb-tool" aria-label="Undo" aria-keyshortcuts="Control+Z" title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={15} aria-hidden="true" />
        </button>
        <button type="button" className="nb-tool" aria-label="Redo" aria-keyshortcuts="Control+Shift+Z" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={15} aria-hidden="true" />
        </button>
        <i aria-hidden="true" />
        <button type="button" role="switch" className="nb-tool" aria-checked={prefs.finger} aria-label="Draw with a finger" title="Finger: draw with one finger (two fingers scroll)" onClick={() => setPrefs({ ...prefs, finger: !prefs.finger })}>
          <Hand size={15} aria-hidden="true" />
          <span className="nb-tl">Finger</span>
        </button>
        <button type="button" className="nb-tool" aria-label="Insert space" title="Insert room to draw in, after the block drawn on last" onClick={onSpace}>
          <SeparatorHorizontal size={15} aria-hidden="true" />
          <span className="nb-tl">Space</span>
        </button>
        <button type="button" className="nb-tool nb-inkdone" onClick={onLeave} title="Done: back to typing (Esc)">
          Done
        </button>
      </div>
    </div>
  );
}

/** An old sketch turned into page drawing (25.9): a space block of the same shape in its place, with its strokes as ink attached to it. Exact, and one step of Undo. */
export function sketchToPage(nb: NotebookStore, pageId: string, b: SketchBlock, shownWidth: number) {
  const page = nb.get().pages.find((p) => p.id === pageId);
  if (!page) return;
  const lowest = b.strokes.reduce((m, s) => {
    for (let i = 1; i < s.pts.length; i += 3) m = Math.max(m, s.pts[i]!);
    return m;
  }, 0);
  const w = Math.max(1, shownWidth);
  const h = Math.max(b.height, Math.ceil(lowest * w + 12));
  const before = page.blocks;
  const after = before.map((x): NotebookBlock => (x.id === b.id ? { id: b.id, kind: "space", h: Math.min(40_000, Math.max(300, Math.round((h / w) * 10_000))) } : x));
  nb.setBlocks(pageId, after);
  inkStoreFor(nb).put(pageId, sketchToInk(b.id, b.strokes), { before, after });
}
