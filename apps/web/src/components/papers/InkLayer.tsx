import { getStroke } from "perfect-freehand";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StickyNote, Trash2 } from "lucide-react";
import {
  ERASER_RADIUS, STICKY_SIDE, TEXT_SIZES, arrowHead, clampMove, inLasso, inkHex, itemBounds, itemHex, moveItem, simplify, touchesItem, widthFor,
  type InkItem, type InkShape, type InkSize, type InkSticky, type InkStroke, type InkText, type InkTool, type ShapeKind,
} from "@scholar/shared";
import { newStrokeId } from "../../lib/ink";

/** What is in the hand: nothing (read and select text), a freehand tool, the eraser, a shape, the lasso, or a text box or sticky note to put down. */
export type DrawTool = "hand" | "pen" | "highlighter" | "eraser" | "lasso" | "text" | "sticky" | ShapeKind;
const SHAPE_TOOLS: readonly string[] = ["line", "arrow", "rect", "ellipse"];
export const isShapeTool = (t: DrawTool): t is ShapeKind => SHAPE_TOOLS.includes(t);

type Props = {
  page: number;
  /** The page's size in PDF points (unzoomed): strokes are drawn in these units and the SVG scales with the zoom. */
  size: { w: number; h: number };
  /** CSS pixels for one PDF point (the zoom), for the text boxes, which are HTML and not scaled by the SVG. */
  scale: number;
  items: InkItem[];
  tool: DrawTool;
  /** The drawing tools are open: text boxes can be edited, and what is in the hand works. */
  open: boolean;
  color: string;
  sizeKey: InkSize;
  textSize: InkSize;
  /** Draw with a finger too (a stylus and a mouse always draw). */
  finger: boolean;
  selection: ReadonlySet<string>;
  onAdd: (s: InkItem) => void;
  onErase: (ids: string[]) => void;
  onEdit: (items: InkItem[]) => void;
  onSelect: (ids: string[]) => void;
  /** A finger touched the page while a drawing tool was on and finger drawing is off: say how to turn it on. */
  onFingerBlocked?: () => void;
};

const avg = (a: number, b: number) => (a + b) / 2;
/** The outline from perfect-freehand as a smooth closed SVG path (quadratic curves through the midpoints). */
function outlinePath(points: number[][]): string {
  const n = points.length;
  if (n < 4) return "";
  let a = points[0]!, b = points[1]!;
  const c = points[2]!;
  let d = `M${a[0]!.toFixed(2)},${a[1]!.toFixed(2)} Q${b[0]!.toFixed(2)},${b[1]!.toFixed(2)} ${avg(b[0]!, c[0]!).toFixed(2)},${avg(b[1]!, c[1]!).toFixed(2)} T`;
  for (let i = 2; i < n - 1; i++) {
    a = points[i]!;
    b = points[i + 1]!;
    d += `${avg(a[0]!, b[0]!).toFixed(2)},${avg(a[1]!, b[1]!).toFixed(2)} `;
  }
  return d + "Z";
}

/** The outline of a pen stroke as a list of points (in page units: a width of 1 is the page width times `pageW`). The same outline is drawn on screen and put into the annotated PDF. */
export function penOutline(pts: number[], w: number, pageW: number): number[][] {
  const points: number[][] = [];
  let simulate = true;
  for (let i = 0; i < pts.length; i += 3) {
    points.push([pts[i]! * pageW, pts[i + 1]! * pageW, pts[i + 2]!]);
    if (pts[i + 2] !== 0.5) simulate = false;
  }
  if (points.length === 1) points.push([points[0]![0]! + 0.01, points[0]![1]!, points[0]![2]!]);
  return getStroke(points, { size: Math.max(0.6, w * pageW), thinning: simulate ? 0.45 : 0.6, smoothing: 0.5, streamline: 0.45, simulatePressure: simulate, last: true });
}
/** A pen stroke as a filled outline, thicker where the pressure was greater. A mouse has no pressure (all 0.5), so the speed of the hand shapes the line instead. */
export function penPath(pts: number[], w: number, pageW: number): string {
  return outlinePath(penOutline(pts, w, pageW));
}
/** A highlighter stroke: a flat-ended wide line of one width (no pressure), which is how a real marker looks. */
export function markerPath(pts: number[], pageW: number): string {
  let d = "";
  for (let i = 0; i < pts.length; i += 3) d += `${i === 0 ? "M" : "L"}${(pts[i]! * pageW).toFixed(2)},${(pts[i + 1]! * pageW).toFixed(2)} `;
  if (pts.length === 3) d += `L${(pts[0]! * pageW + 0.01).toFixed(2)},${(pts[1]! * pageW).toFixed(2)}`;
  return d;
}

const cache = new WeakMap<InkStroke, { pageW: number; d: string }>();
function pathOf(s: InkStroke, pageW: number): string {
  const hit = cache.get(s);
  if (hit && hit.pageW === pageW) return hit.d;
  const d = s.tool === "pen" ? penPath(s.pts, s.w, pageW) : markerPath(s.pts, pageW);
  cache.set(s, { pageW, d });
  return d;
}

/** A shape as SVG elements (page units times `pageW`). Rectangles and ellipses are not filled: the page shows through. */
function ShapeEl({ s, pageW, erasing, selected, live = false }: { s: Pick<InkShape, "kind" | "color" | "w" | "pts"> & { id?: string }; pageW: number; erasing?: boolean; selected?: boolean; live?: boolean }) {
  const [ax, ay, bx, by] = [s.pts[0]! * pageW, s.pts[1]! * pageW, s.pts[3]! * pageW, s.pts[4]! * pageW];
  const hex = inkHex("pen", s.color);
  const common = { stroke: hex, strokeWidth: Math.max(0.6, s.w * pageW), strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none", "data-erasing": erasing, "data-selected": selected, className: live ? "ink-live ink-shape" : "ink-shape" };
  if (s.kind === "rect") return <rect x={Math.min(ax, bx)} y={Math.min(ay, by)} width={Math.abs(bx - ax)} height={Math.abs(by - ay)} {...common} />;
  if (s.kind === "ellipse") return <ellipse cx={(ax + bx) / 2} cy={(ay + by) / 2} rx={Math.abs(bx - ax) / 2} ry={Math.abs(by - ay) / 2} {...common} />;
  if (s.kind === "arrow") {
    // the head is sized in page widths, so the same arrow looks the same at any zoom
    const hh = arrowHead([s.pts[0]!, s.pts[1]!], [s.pts[3]!, s.pts[4]!], s.w);
    const P = (p: [number, number]) => `${(p[0] * pageW).toFixed(2)},${(p[1] * pageW).toFixed(2)}`;
    return (
      <g data-erasing={erasing} data-selected={selected} className={live ? "ink-live ink-shape" : "ink-shape"}>
        <line x1={ax} y1={ay} x2={hh.stop[0] * pageW} y2={hh.stop[1] * pageW} stroke={hex} strokeWidth={Math.max(0.6, s.w * pageW)} strokeLinecap="round" />
        <polygon points={`${P(hh.tip)} ${P(hh.left)} ${P(hh.right)}`} fill={hex} stroke={hex} strokeWidth={Math.max(0.6, s.w * pageW) * 0.5} strokeLinejoin="round" />
      </g>
    );
  }
  return <line x1={ax} y1={ay} x2={bx} y2={by} {...common} />;
}

/** Screen distance a pointer must move before another point is kept (less is noise, and only adds points). */
const MIN_STEP_PX = 0.8;
const PEN_SEEN_MS = 4000;
/** A press that moves less than this (screen pixels) and is let go is a tap. */
const TAP_PX = 8;

type Active = {
  pointer: number;
  mode: "pen" | "highlighter" | "eraser" | "shape" | "lasso" | "move" | "tap";
  pts: number[];
  erase: Set<string>;
  shift: boolean;
  frame: number;
  /** where the press began, in page widths and in screen pixels */
  x0: number;
  y0: number;
  sx: number;
  sy: number;
  moved: boolean;
  shape?: ShapeKind;
};

/** The shape a drag makes: Shift makes a line snap to 15 degrees and a rectangle or ellipse a square or circle. */
function shapePoints(kind: ShapeKind, x0: number, y0: number, x1: number, y1: number, shift: boolean): [number, number, number, number] {
  if (!shift) return [x0, y0, x1, y1];
  if (kind === "line" || kind === "arrow") {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const ang = Math.round(Math.atan2(y1 - y0, x1 - x0) / (Math.PI / 12)) * (Math.PI / 12);
    return [x0, y0, x0 + len * Math.cos(ang), y0 + len * Math.sin(ang)];
  }
  const d = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  return [x0, y0, x0 + Math.sign(x1 - x0 || 1) * d, y0 + Math.sign(y1 - y0 || 1) * d];
}

const Static = memo(function Static({ pens, shapes, pageW, pending, selection }: { pens: InkStroke[]; shapes: InkShape[]; pageW: number; pending: ReadonlySet<string>; selection: ReadonlySet<string> }) {
  return (
    <>
      {pens.map((s) => (
        <path key={s.id} d={pathOf(s, pageW)} fill={inkHex("pen", s.color)} data-erasing={pending.has(s.id)} data-selected={selection.has(s.id)} />
      ))}
      {shapes.map((s) => (
        <ShapeEl key={s.id} s={s} pageW={pageW} erasing={pending.has(s.id)} selected={selection.has(s.id)} />
      ))}
    </>
  );
});

/**
 * The drawing on one page: two transparent SVG layers over the page picture and a layer of text boxes and sticky notes. The highlighter layer goes under the text layer
 * and blends by multiplying, like a marker; the pen layer (with shapes) goes on top and takes the pointer while a drawing tool is on; text boxes and notes are HTML so
 * the words can be typed in any script. Everything is kept as vectors in page units, so the zoom needs no redraw.
 */
export function InkLayer({ page, size, scale, items, tool, open, color, sizeKey, textSize, finger, selection, onAdd, onErase, onEdit, onSelect, onFingerBlocked }: Props) {
  const pageW = size.w;
  const top = useRef<SVGSVGElement>(null);
  const hl = useRef<SVGSVGElement>(null);
  const boxes = useRef<HTMLDivElement>(null);
  const live = useRef<SVGPathElement>(null);
  const liveHl = useRef<SVGPathElement>(null);
  const liveLasso = useRef<SVGPolylineElement>(null);
  const ring = useRef<HTMLSpanElement>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [liveShape, setLiveShape] = useState<{ kind: ShapeKind; pts: number[] } | null>(null);
  const active = useRef<Active | null>(null);
  const penSeen = useRef(0);
  const touchIds = useRef(new Set<number>());
  const [editing, setEditing] = useState<{ id: string; draft?: InkText } | null>(null);
  const [openSticky, setOpenSticky] = useState<string | null>(null);

  const drawing = tool !== "hand";
  const pageItems = useMemo(() => items.filter((s) => s.page === page), [items, page]);
  const pens = useMemo(() => pageItems.filter((s): s is InkStroke => s.tool === "pen"), [pageItems]);
  const marks = useMemo(() => pageItems.filter((s): s is InkStroke => s.tool === "highlighter"), [pageItems]);
  const shapes = useMemo(() => pageItems.filter((s): s is InkShape => s.tool === "shape"), [pageItems]);
  const texts = useMemo(() => pageItems.filter((s): s is InkText => s.tool === "text"), [pageItems]);
  const stickies = useMemo(() => pageItems.filter((s): s is InkSticky => s.tool === "sticky"), [pageItems]);
  const selected = useMemo(() => pageItems.filter((s) => selection.has(s.id)), [pageItems, selection]);
  const selBox = useMemo(() => {
    if (selected.length === 0) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const it of selected) {
      const b = itemBounds(it);
      x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
    }
    return { x0, y0, x1, y1 };
  }, [selected]);

  const norm = useCallback((e: { clientX: number; clientY: number }) => {
    const r = top.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.width, r };
  }, []);

  const paintLive = useCallback(() => {
    const a = active.current;
    if (!a) return;
    a.frame = 0;
    if (a.mode === "lasso") {
      liveLasso.current?.setAttribute("points", a.pts.reduce<string[]>((acc, v, i) => (i % 3 === 0 ? [...acc, `${(v * pageW).toFixed(1)},${(a.pts[i + 1]! * pageW).toFixed(1)}`] : acc), []).join(" "));
      return;
    }
    if (a.mode === "shape") {
      const n = a.pts.length;
      const [x0, y0, x1, y1] = shapePoints(a.shape!, a.x0, a.y0, a.pts[n - 3]!, a.pts[n - 2]!, a.shift);
      setLiveShape({ kind: a.shape!, pts: [x0, y0, 0.5, x1, y1, 0.5] });
      return;
    }
    const pts = a.shift && a.pts.length > 6 ? [a.pts[0]!, a.pts[1]!, a.pts[2]!, a.pts[a.pts.length - 3]!, a.pts[a.pts.length - 2]!, a.pts[a.pts.length - 1]!] : a.pts;
    if (a.mode === "pen") live.current?.setAttribute("d", penPath(pts, widthFor("pen", sizeKey), pageW));
    else if (a.mode === "highlighter") liveHl.current?.setAttribute("d", markerPath(pts, pageW));
  }, [pageW, sizeKey]);

  const setShift = useCallback((dx: number, dy: number) => {
    // while items are being moved they follow the pointer with CSS only (nothing is re-drawn); the numbers change when the pointer is let go
    hl.current?.style.setProperty("--mx", `${dx * pageW}px`);
    hl.current?.style.setProperty("--my", `${dy * pageW}px`);
    top.current?.style.setProperty("--mx", `${dx * pageW}px`);
    top.current?.style.setProperty("--my", `${dy * pageW}px`);
    boxes.current?.style.setProperty("--mx", `${dx * pageW * scale}px`);
    boxes.current?.style.setProperty("--my", `${dy * pageW * scale}px`);
  }, [pageW, scale]);

  const clearLive = useCallback(() => {
    live.current?.setAttribute("d", "");
    liveHl.current?.setAttribute("d", "");
    liveLasso.current?.setAttribute("points", "");
    setLiveShape(null);
    setShift(0, 0);
  }, [setShift]);

  const cancel = useCallback(() => {
    const a = active.current;
    if (a) cancelAnimationFrame(a.frame);
    active.current = null;
    clearLive();
    setPending(new Set());
  }, [clearLive]);

  // a drawing tool being switched off, or another tool chosen, ends a stroke in progress
  useEffect(() => cancel, [tool, cancel]);
  // leaving the drawing tools closes what was being written
  useEffect(() => {
    if (!open) setOpenSticky((id) => (id && stickies.find((s) => s.id === id)?.text ? id : null));
  }, [open, stickies]);

  const moveRing = (e: { clientX: number; clientY: number }, r: DOMRect, mode: string) => {
    const el = ring.current;
    if (!el) return;
    if (mode !== "pen" && mode !== "highlighter" && mode !== "eraser") return void (el.dataset.on = "false");
    const radius = (mode === "eraser" ? ERASER_RADIUS[sizeKey] : widthFor(mode as InkTool, sizeKey) / 2) * r.width;
    const d = Math.max(6, radius * 2);
    el.style.width = el.style.height = `${d}px`;
    el.style.transform = `translate(${e.clientX - r.left - d / 2}px, ${e.clientY - r.top - d / 2}px)`;
    el.dataset.on = "true";
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (e.pointerType === "pen") penSeen.current = Date.now();
    const tap = tool === "text" || tool === "sticky";
    if (e.pointerType === "touch") {
      touchIds.current.add(e.pointerId);
      if (touchIds.current.size > 1) return cancel(); // a second finger is a pinch, not a stroke
      if (!tap && (!finger || Date.now() - penSeen.current < PEN_SEEN_MS)) {
        if (!finger) onFingerBlocked?.();
        return; // the palm resting while a stylus writes, or a finger that was not asked to draw
      }
    }
    const { x, y, r } = norm(e);
    const base = { pointer: e.pointerId, erase: new Set<string>(), shift: e.shiftKey, frame: 0, x0: x, y0: y, sx: e.clientX, sy: e.clientY, moved: false };
    if (tap) {
      // a tap is decided when the finger or pointer is let go (a scroll must not leave a text box behind)
      active.current = { ...base, mode: "tap", pts: [x, y, 0.5] };
      return;
    }
    // the eraser end of a stylus (or its barrel button) erases whatever tool is on
    const eraserEnd = e.pointerType === "pen" && (e.buttons & 32 || e.button === 5);
    const p = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
    top.current!.setPointerCapture(e.pointerId);
    e.preventDefault();
    if (tool === "lasso" && !eraserEnd) {
      const inside = selBox && x >= selBox.x0 - 0.01 && x <= selBox.x1 + 0.01 && y >= selBox.y0 - 0.01 && y <= selBox.y1 + 0.01;
      active.current = { ...base, mode: inside ? "move" : "lasso", pts: [x, y, p] };
      return;
    }
    const mode: Active["mode"] = eraserEnd || tool === "eraser" ? "eraser" : isShapeTool(tool) ? "shape" : (tool as "pen" | "highlighter");
    active.current = { ...base, mode, pts: [x, y, p], shape: isShapeTool(tool) ? tool : undefined };
    if (mode === "eraser") sweep(x, y);
    else if (mode !== "shape") paintLive();
    moveRing(e, r, mode);
  };

  /** The eraser at x, y: every item it touches is marked (and fades), and goes when the pointer is lifted, as one step. */
  const sweep = (x: number, y: number) => {
    const a = active.current;
    if (!a) return;
    const radius = ERASER_RADIUS[sizeKey];
    let added = false;
    for (const s of pageItems) if (!a.erase.has(s.id) && touchesItem(s, x, y, radius)) { a.erase.add(s.id); added = true; }
    if (added) setPending(new Set(a.erase));
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const a = active.current;
    const { r } = norm(e);
    if (!a) {
      if (drawing && e.pointerType !== "touch") moveRing(e, r, tool);
      return;
    }
    if (e.pointerId !== a.pointer) return;
    a.shift = e.shiftKey;
    if (Math.hypot(e.clientX - a.sx, e.clientY - a.sy) > TAP_PX) a.moved = true;
    if (a.mode === "tap") return;
    if (a.mode === "move") {
      const { dx, dy } = clampMove(selected, (e.clientX - r.left) / r.width - a.x0, (e.clientY - r.top) / r.width - a.y0);
      a.pts = [a.x0, a.y0, 0.5, dx, dy, 0.5];
      setShift(dx, dy);
      return;
    }
    const events = typeof e.nativeEvent.getCoalescedEvents === "function" ? e.nativeEvent.getCoalescedEvents() : [];
    const list = events.length > 0 ? events : [e.nativeEvent];
    for (const ev of list) {
      const x = (ev.clientX - r.left) / r.width;
      const y = (ev.clientY - r.top) / r.width;
      if (a.mode === "eraser") {
        sweep(x, y);
        continue;
      }
      const n = a.pts.length;
      if (Math.hypot((x - a.pts[n - 3]!) * r.width, (y - a.pts[n - 2]!) * r.width) < MIN_STEP_PX) continue;
      a.pts.push(x, y, ev.pointerType === "pen" ? ev.pressure || 0.5 : 0.5);
    }
    if (a.mode !== "eraser" && !a.frame) a.frame = requestAnimationFrame(paintLive);
    moveRing(e, r, a.mode);
  };

  const end = (e: React.PointerEvent<SVGSVGElement>, cancelled: boolean) => {
    touchIds.current.delete(e.pointerId);
    const a = active.current;
    if (!a || e.pointerId !== a.pointer) return;
    active.current = null;
    cancelAnimationFrame(a.frame);
    const { x, y } = norm(e);
    clearLive();
    setPending(new Set());
    if (cancelled) return;

    if (a.mode === "tap") {
      if (a.moved) return;
      const nx = Math.min(1 - 0.05, Math.max(0, x));
      if (tool === "text") {
        const w = Math.min(0.32, Math.max(0.12, 0.98 - nx));
        const draft: InkText = { id: newStrokeId(), page, tool: "text", color, x: nx, y: Math.max(0, y), w, h: TEXT_SIZES[textSize] * 1.4, size: TEXT_SIZES[textSize], text: "" };
        setEditing({ id: draft.id, draft });
      } else {
        const note: InkSticky = { id: newStrokeId(), page, tool: "sticky", color, x: Math.min(1 - STICKY_SIDE, Math.max(0, x - STICKY_SIDE / 2)), y: Math.max(0, y - STICKY_SIDE / 2), text: "" };
        onAdd(note);
        setOpenSticky(note.id);
      }
      return;
    }
    if (a.mode === "move") {
      const dx = a.pts[3]!, dy = a.pts[4]!;
      if (a.moved && (dx !== 0 || dy !== 0)) onEdit(selected.map((s) => moveItem(s, dx, dy)));
      return;
    }
    if (a.mode === "lasso") {
      if (!a.moved) {
        // a click: the top item under the pointer, or nothing
        const hit = [...pageItems].reverse().find((s) => touchesItem(s, x, y, 0.006));
        onSelect(hit ? [hit.id] : []);
        return;
      }
      const poly: [number, number][] = [];
      for (let i = 0; i < a.pts.length; i += 3) poly.push([a.pts[i]!, a.pts[i + 1]!]);
      onSelect(pageItems.filter((s) => inLasso(s, poly)).map((s) => s.id));
      return;
    }
    if (a.mode === "eraser") {
      if (a.erase.size > 0) onErase([...a.erase]);
      return;
    }
    if (a.mode === "shape") {
      const n = a.pts.length;
      const [x0, y0, x1, y1] = shapePoints(a.shape!, a.x0, a.y0, a.pts[n - 3]!, a.pts[n - 2]!, a.shift);
      if (Math.hypot((x1 - x0) * pageW * scale, (y1 - y0) * pageW * scale) < 4) return; // a click, not a shape
      onAdd({ id: newStrokeId(), page, tool: "shape", kind: a.shape!, color, w: widthFor("pen", sizeKey), pts: [x0, y0, 0.5, x1, y1, 0.5] });
      return;
    }
    // a straight line when Shift is held, else the hand's path with the points that do not matter taken out
    const pts = a.shift && a.pts.length > 6 ? [a.pts[0]!, a.pts[1]!, a.pts[2]!, a.pts[a.pts.length - 3]!, a.pts[a.pts.length - 2]!, a.pts[a.pts.length - 1]!] : simplify(a.pts, 0.0003);
    onAdd({ id: newStrokeId(), page, tool: a.mode, color, w: widthFor(a.mode, sizeKey), pts });
  };

  const px = pageW * scale; // the page's width on screen, in CSS pixels
  const interactive = open && (tool === "hand" || tool === "text" || tool === "sticky");

  const commitText = useCallback(
    (orig: InkText | undefined, draft: InkText | undefined, value: string, height: number) => {
      setEditing(null);
      const base = orig ?? draft;
      if (!base) return;
      const text = value.replace(/\s+$/g, "");
      const h = Math.max(0.01, height / px);
      if (!text.trim()) {
        if (orig) onErase([orig.id]); // an existing box emptied is a box removed (and Undo brings it back)
        return;
      }
      if (orig) {
        if (orig.text !== text || Math.abs(orig.h - h) > 0.002) onEdit([{ ...orig, text, h }]);
      } else onAdd({ ...base, text, h });
    },
    [onAdd, onEdit, onErase, px],
  );

  return (
    <>
      {/* highlighter: under the text, multiplied into the page */}
      <svg ref={hl} className="ink ink-hl" viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true">
        {marks.map((s) => (
          <path key={s.id} d={pathOf(s, pageW)} stroke={inkHex("highlighter", s.color)} strokeWidth={s.w * pageW} data-erasing={pending.has(s.id)} data-selected={selection.has(s.id)} />
        ))}
        <path ref={liveHl} className="ink-live" stroke={inkHex("highlighter", color)} strokeWidth={widthFor("highlighter", sizeKey) * pageW} d="" />
      </svg>
      {/* pen and shapes: on top; it is also what takes the pointer while a drawing tool is on */}
      <svg
        ref={top}
        className="ink ink-pen"
        viewBox={`0 0 ${size.w} ${size.h}`}
        data-tool={tool}
        data-finger={finger}
        aria-hidden="true"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={(e) => end(e, false)}
        onPointerCancel={(e) => end(e, true)}
        onPointerLeave={() => ring.current && (ring.current.dataset.on = "false")}
        onContextMenu={(e) => drawing && e.preventDefault()}
      >
        <Static pens={pens} shapes={shapes} pageW={pageW} pending={pending} selection={selection} />
        <path ref={live} className="ink-live" fill={inkHex("pen", color)} d="" />
        {liveShape && <ShapeEl s={{ kind: liveShape.kind, color, w: widthFor("pen", sizeKey), pts: liveShape.pts }} pageW={pageW} live />}
        <polyline ref={liveLasso} className="ink-lasso" fill="none" points="" />
        {selBox && (
          <rect className="ink-sel" data-selected="true" x={selBox.x0 * pageW - 3} y={selBox.y0 * pageW - 3} width={(selBox.x1 - selBox.x0) * pageW + 6} height={(selBox.y1 - selBox.y0) * pageW + 6} rx={3} />
        )}
      </svg>
      {/* text boxes and sticky notes: HTML, so any script can be typed; positions are fractions of the page width */}
      <div ref={boxes} className="ink-boxes" data-interactive={interactive} data-open={open} data-tool={tool}>
        {texts.map((t) =>
          editing?.id === t.id ? null : (
            <TextBox key={t.id} t={t} px={px} erasing={pending.has(t.id)} selected={selection.has(t.id)} interactive={interactive} onEdit={() => setEditing({ id: t.id })} />
          ),
        )}
        {editing && (() => {
          const orig = texts.find((t) => t.id === editing.id);
          const t = orig ?? editing.draft;
          return t ? <TextEditor key={t.id} t={t} px={px} isNew={!orig} onDone={(value, h) => commitText(orig, editing.draft, value, h)} /> : null;
        })()}
        {stickies.map((s) => (
          <Sticky key={s.id} s={s} px={px} erasing={pending.has(s.id)} selected={selection.has(s.id)} open={openSticky === s.id} editable={interactive} onToggle={() => setOpenSticky((id) => (id === s.id ? null : s.id))} onSave={(text) => text !== s.text && onEdit([{ ...s, text }])} onClose={() => setOpenSticky((id) => (id === s.id ? null : id))} />
        ))}
        {selected.length > 0 && selBox && open && tool === "lasso" && (
          <div className="ink-selbar" style={{ left: selBox.x0 * px, top: Math.max(0, selBox.y0 * px - 40) }} data-selected="true">
            <span>{selected.length} selected</span>
            <button type="button" className="ink-selbar-btn" aria-label={`Delete ${selected.length} selected`} onClick={() => onErase(selected.map((s) => s.id))}>
              <Trash2 size={14} aria-hidden="true" />
              <span>Delete</span>
            </button>
          </div>
        )}
      </div>
      {drawing && <span ref={ring} className="ink-ring" data-tool={tool} data-on="false" aria-hidden="true" />}
    </>
  );
}

/** A text box on the page, as the reader wrote it. */
function TextBox({ t, px, erasing, selected, interactive, onEdit }: { t: InkText; px: number; erasing: boolean; selected: boolean; interactive: boolean; onEdit: () => void }) {
  return (
    <div
      className="ink-text"
      data-erasing={erasing}
      data-selected={selected}
      data-interactive={interactive}
      style={{ left: t.x * px, top: t.y * px, width: t.w * px, fontSize: t.size * px, color: itemHex(t) }}
      role={interactive ? "button" : "note"}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `Text box: ${t.text.slice(0, 60)}. Edit` : undefined}
      onClick={interactive ? onEdit : undefined}
      onKeyDown={interactive ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onEdit()) : undefined}
    >
      {t.text}
    </div>
  );
}

/** The box a text is typed in. Enter makes a new line; Ctrl+Enter, Escape, or clicking elsewhere finishes. */
function TextEditor({ t, px, isNew, onDone }: { t: InkText; px: number; isNew: boolean; onDone: (value: string, heightPx: number) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const fit = () => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => {
    fit();
    ref.current?.focus();
    ref.current?.setSelectionRange(ref.current.value.length, ref.current.value.length);
  }, []);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    onDone(ref.current?.value ?? "", ref.current?.scrollHeight ?? 0);
  };
  return (
    <textarea
      ref={ref}
      className="ink-text ink-text-edit"
      defaultValue={t.text}
      maxLength={2000}
      rows={1}
      aria-label={isNew ? "New text box" : "Edit the text box"}
      style={{ left: t.x * px, top: t.y * px, width: t.w * px, fontSize: t.size * px, color: itemHex(t) }}
      onInput={fit}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          e.stopPropagation();
          finish();
        }
      }}
    />
  );
}

/** A sticky note: a small coloured square; pressing it opens (or closes) the words. Words can be changed only while the drawing tools are open. */
function Sticky({ s, px, erasing, selected, open, editable, onToggle, onSave, onClose }: { s: InkSticky; px: number; erasing: boolean; selected: boolean; open: boolean; editable: boolean; onToggle: () => void; onSave: (text: string) => void; onClose: () => void }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const side = STICKY_SIDE * px;
  useEffect(() => {
    if (open && editable) area.current?.focus();
  }, [open, editable]);
  return (
    <div className="ink-sticky" style={{ left: s.x * px, top: s.y * px }} data-erasing={erasing} data-selected={selected}>
      <button
        type="button"
        className="ink-sticky-btn"
        style={{ width: side, height: side, background: itemHex(s) }}
        aria-expanded={open}
        aria-label={s.text ? `Sticky note: ${s.text.slice(0, 80)}` : "Empty sticky note"}
        title={s.text ? s.text.slice(0, 120) : "Empty sticky note"}
        onClick={onToggle}
      >
        <StickyNote size={Math.max(10, side * 0.6)} aria-hidden="true" />
      </button>
      {open && (
        <div className="ink-sticky-pop" role="group" aria-label="Sticky note" style={s.x > 0.55 ? { left: "auto", right: 0 } : undefined}>
          {editable ? (
            <textarea
              ref={area}
              className="ink-sticky-text"
              defaultValue={s.text}
              maxLength={2000}
              rows={3}
              placeholder="Write a note…"
              aria-label="Words of the sticky note"
              onBlur={(e) => onSave(e.currentTarget.value.replace(/\s+$/g, ""))}
              onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), e.currentTarget.blur(), onClose())}
            />
          ) : (
            <p className="ink-sticky-read">{s.text || "Empty note"}</p>
          )}
        </div>
      )}
    </div>
  );
}
