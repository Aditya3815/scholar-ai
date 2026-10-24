import { getStroke } from "perfect-freehand";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ERASER_RADIUS, inkHex, simplify, touches, widthFor, type InkSize, type InkStroke, type InkTool } from "@scholar/shared";
import { newStrokeId } from "../../lib/ink";

export type DrawTool = "hand" | "pen" | "highlighter" | "eraser";

type Props = {
  page: number;
  /** The page's size in PDF points (unzoomed): strokes are drawn in these units and the SVG scales with the zoom. */
  size: { w: number; h: number };
  strokes: InkStroke[];
  tool: DrawTool;
  color: string;
  sizeKey: InkSize;
  /** Draw with a finger too (a stylus and a mouse always draw). */
  finger: boolean;
  onStroke: (s: InkStroke) => void;
  onErase: (ids: string[]) => void;
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

/** A pen stroke as a filled outline, thicker where the pressure was greater. A mouse has no pressure (all 0.5), so the speed of the hand shapes the line instead. */
export function penPath(pts: number[], w: number, pageW: number): string {
  const points: number[][] = [];
  let simulate = true;
  for (let i = 0; i < pts.length; i += 3) {
    points.push([pts[i]! * pageW, pts[i + 1]! * pageW, pts[i + 2]!]);
    if (pts[i + 2] !== 0.5) simulate = false;
  }
  if (points.length === 1) points.push([points[0]![0]! + 0.01, points[0]![1]!, points[0]![2]!]);
  return outlinePath(getStroke(points, { size: Math.max(0.6, w * pageW), thinning: simulate ? 0.45 : 0.6, smoothing: 0.5, streamline: 0.45, simulatePressure: simulate, last: true }));
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

/** Screen distance a pointer must move before another point is kept (less is noise, and only adds points). */
const MIN_STEP_PX = 0.8;
const PEN_SEEN_MS = 4000;

/**
 * The drawing on one page: two transparent SVG layers over the page picture. The highlighter layer goes under the text layer and blends by multiplying, like a marker;
 * the pen layer goes on top and takes the pointer while a drawing tool is on. Strokes are vectors in page units, so the zoom needs no redraw.
 */
export function InkLayer({ page, size, strokes, tool, color, sizeKey, finger, onStroke, onErase, onFingerBlocked }: Props) {
  const pageW = size.w;
  const top = useRef<SVGSVGElement>(null);
  const live = useRef<SVGPathElement>(null);
  const liveHl = useRef<SVGPathElement>(null);
  const ring = useRef<HTMLSpanElement>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const active = useRef<{ pointer: number; mode: "pen" | "highlighter" | "eraser"; pts: number[]; erase: Set<string>; shift: boolean; frame: number } | null>(null);
  const penSeen = useRef(0);
  const touchIds = useRef(new Set<number>());

  const drawing = tool !== "hand";
  const pageStrokes = useMemo(() => strokes.filter((s) => s.page === page), [strokes, page]);
  const pens = pageStrokes.filter((s) => s.tool === "pen");
  const marks = pageStrokes.filter((s) => s.tool === "highlighter");

  const norm = useCallback((e: { clientX: number; clientY: number }) => {
    const r = top.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.width, r };
  }, []);

  const paintLive = useCallback(() => {
    const a = active.current;
    if (!a) return;
    a.frame = 0;
    const pts = a.shift && a.pts.length > 6 ? [a.pts[0]!, a.pts[1]!, a.pts[2]!, a.pts[a.pts.length - 3]!, a.pts[a.pts.length - 2]!, a.pts[a.pts.length - 1]!] : a.pts;
    if (a.mode === "pen") live.current?.setAttribute("d", penPath(pts, widthFor("pen", sizeKey), pageW));
    else if (a.mode === "highlighter") liveHl.current?.setAttribute("d", markerPath(pts, pageW));
  }, [pageW, sizeKey]);

  const clearLive = useCallback(() => {
    live.current?.setAttribute("d", "");
    liveHl.current?.setAttribute("d", "");
  }, []);

  const cancel = useCallback(() => {
    const a = active.current;
    if (a) cancelAnimationFrame(a.frame);
    active.current = null;
    clearLive();
    setPending(new Set());
  }, [clearLive]);

  // a drawing tool being switched off, or another tool chosen, ends a stroke in progress
  useEffect(() => cancel, [tool, cancel]);

  const moveRing = (e: { clientX: number; clientY: number }, r: DOMRect, mode: string) => {
    const el = ring.current;
    if (!el) return;
    const radius = (mode === "eraser" ? ERASER_RADIUS[sizeKey] : widthFor(mode as InkTool, sizeKey) / 2) * r.width;
    const d = Math.max(6, radius * 2);
    el.style.width = el.style.height = `${d}px`;
    el.style.transform = `translate(${e.clientX - r.left - d / 2}px, ${e.clientY - r.top - d / 2}px)`;
    el.dataset.on = "true";
  };

  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (e.pointerType === "pen") penSeen.current = Date.now();
    if (e.pointerType === "touch") {
      touchIds.current.add(e.pointerId);
      if (touchIds.current.size > 1) return cancel(); // a second finger is a pinch, not a stroke
      if (!finger || Date.now() - penSeen.current < PEN_SEEN_MS) {
        if (!finger) onFingerBlocked?.();
        return; // the palm resting while a stylus writes, or a finger that was not asked to draw
      }
    }
    // the eraser end of a stylus (or its barrel button) erases whatever tool is on
    const mode: "pen" | "highlighter" | "eraser" = e.pointerType === "pen" && (e.buttons & 32 || e.button === 5) ? "eraser" : tool === "eraser" ? "eraser" : (tool as "pen" | "highlighter");
    const { x, y, r } = norm(e);
    top.current!.setPointerCapture(e.pointerId);
    e.preventDefault();
    const p = e.pointerType === "pen" ? e.pressure || 0.5 : 0.5;
    active.current = { pointer: e.pointerId, mode, pts: [x, y, p], erase: new Set(), shift: e.shiftKey, frame: 0 };
    if (mode === "eraser") sweep(x, y);
    else paintLive();
    moveRing(e, r, mode);
  };

  /** The eraser at x, y: every stroke it touches is marked (and fades), and goes when the pointer is lifted, as one step. */
  const sweep = (x: number, y: number) => {
    const a = active.current;
    if (!a) return;
    const radius = ERASER_RADIUS[sizeKey];
    let added = false;
    for (const s of pageStrokes) if (!a.erase.has(s.id) && touches(s, x, y, radius)) { a.erase.add(s.id); added = true; }
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
    clearLive();
    setPending(new Set());
    if (cancelled) return;
    if (a.mode === "eraser") {
      if (a.erase.size > 0) onErase([...a.erase]);
      return;
    }
    // a straight line when Shift is held, else the hand's path with the points that do not matter taken out
    const pts = a.shift && a.pts.length > 6 ? [a.pts[0]!, a.pts[1]!, a.pts[2]!, a.pts[a.pts.length - 3]!, a.pts[a.pts.length - 2]!, a.pts[a.pts.length - 1]!] : simplify(a.pts, 0.0003);
    onStroke({ id: newStrokeId(), page, tool: a.mode, color, w: widthFor(a.mode, sizeKey), pts });
  };

  return (
    <>
      {/* highlighter: under the text, multiplied into the page */}
      <svg className="ink ink-hl" viewBox={`0 0 ${size.w} ${size.h}`} aria-hidden="true">
        {marks.map((s) => (
          <path key={s.id} d={pathOf(s, pageW)} stroke={inkHex("highlighter", s.color)} strokeWidth={s.w * pageW} data-erasing={pending.has(s.id)} />
        ))}
        <path ref={liveHl} className="ink-live" stroke={inkHex("highlighter", color)} strokeWidth={widthFor("highlighter", sizeKey) * pageW} d="" />
      </svg>
      {/* pen: on top; it is also what takes the pointer while a drawing tool is on */}
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
        {pens.map((s) => (
          <path key={s.id} d={pathOf(s, pageW)} fill={inkHex("pen", s.color)} data-erasing={pending.has(s.id)} />
        ))}
        <path ref={live} className="ink-live" fill={inkHex("pen", color)} d="" />
      </svg>
      {drawing && <span ref={ring} className="ink-ring" data-tool={tool} data-on="false" aria-hidden="true" />}
    </>
  );
}
