import { Eraser, Highlighter, PenLine, Undo2 } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ERASER_RADIUS, HIGHLIGHTER_COLORS, INK_SIZES, NOTEBOOK_LIMITS, PEN_COLORS, inkHex, widthFor, type InkSize, type SketchBlock, type SketchStroke } from "@scholar/shared";
import { markerPath, penPath } from "../../../../lib/ink-path";

type SketchTool = "pen" | "highlighter" | "eraser";
const SIZE_NAME: Record<InkSize, string> = { s: "Fine", m: "Medium", l: "Thick", xl: "Very thick" };
const newId = () => `k${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/**
 * A sketch in the notes (docs/design/paper-reader.md, 21.1, 5): a drawing area on the same white paper as the pages, with the reader's pen, highlighter and eraser, their colours and sizes,
 * and Undo (the button, or Ctrl+Z inside it). Strokes are kept in the block as fractions of its width (both axes), so they keep their shape at any width; its height is dragged at its
 * bottom edge, or set with Alt+↑ and Alt+↓ there.
 */
export function SketchBlockView({ b, onStrokes, onHeight, onRefused }: { b: SketchBlock; onStrokes: (s: SketchStroke[]) => void; onHeight: (h: number) => void; onRefused: (why: string) => void }) {
  const area = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [tool, setTool] = useState<SketchTool>("pen");
  const [color, setColor] = useState({ pen: "ink", highlighter: "yellow" });
  const [size, setSize] = useState<InkSize>("m");
  const [live, setLive] = useState<number[] | null>(null);
  const [height, setHeight] = useState(b.height);
  const undo = useRef<SketchStroke[][]>([]);
  const drag = useRef<{ y: number; h: number } | null>(null);
  useEffect(() => setHeight(b.height), [b.height]);
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const at = (e: PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const w = r.width || 1;
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / w)), Math.min(r.height / w, Math.max(0, (e.clientY - r.top) / w)), e.pointerType === "pen" ? Math.min(1, Math.max(0, e.pressure)) : 0.5];
  };
  const keep = (next: SketchStroke[]) => {
    undo.current = [...undo.current.slice(-49), b.strokes];
    onStrokes(next);
  };
  const erase = (p: number[]) => {
    const r = ERASER_RADIUS[size];
    const hit = (s: SketchStroke) => {
      for (let i = 0; i < s.pts.length; i += 3) if (Math.hypot(s.pts[i]! - p[0]!, s.pts[i + 1]! - p[1]!) <= r + s.w / 2) return true;
      return false;
    };
    const left = b.strokes.filter((s) => !hit(s));
    if (left.length !== b.strokes.length) keep(left);
  };
  const points = b.strokes.reduce((n, s) => n + s.pts.length / 3, 0);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = at(e);
    if (tool === "eraser") return erase(p);
    setLive(p);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (tool === "eraser") {
      if (e.buttons & 1) erase(at(e));
      return;
    }
    if (!live) return;
    const p = at(e);
    const n = live.length;
    // a point closer than a pixel and a half to the last one adds nothing
    if (width && Math.hypot((p[0]! - live[n - 3]!) * width, (p[1]! - live[n - 2]!) * width) < 1.5) return;
    setLive([...live, ...p]);
  };
  const up = () => {
    if (!live) return;
    const pts = live;
    setLive(null);
    if (b.strokes.length >= NOTEBOOK_LIMITS.sketchStrokes || points + pts.length / 3 > NOTEBOOK_LIMITS.sketchPoints) return onRefused("This sketch is full. Start a new sketch for more.");
    const t = tool === "highlighter" ? "highlighter" : "pen";
    keep([...b.strokes, { id: newId(), tool: t, color: color[t], w: widthFor(t, size), pts: pts.map((v) => Math.round(v * 10000) / 10000) }]);
  };
  const back = () => {
    const prev = undo.current.pop();
    if (prev) onStrokes(prev);
  };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      back();
    }
  };
  const setH = (h: number) => {
    const v = Math.round(Math.min(NOTEBOOK_LIMITS.sketchMax, Math.max(NOTEBOOK_LIMITS.sketchMin, h)));
    setHeight(v);
    return v;
  };

  // the area is as tall as its height, or as its lowest stroke at this width when that is lower (strokes keep their shape at any width, so a sketch shown wider than it was drawn grows taller rather than being cut off)
  const lowest = b.strokes.reduce((m, s) => { for (let i = 1; i < s.pts.length; i += 3) m = Math.max(m, s.pts[i]!); return m; }, 0);
  const shownH = Math.max(height, width ? Math.ceil(lowest * width + 12) : 0);
  const path = (s: { tool: "pen" | "highlighter"; w: number; pts: number[] }) => (s.tool === "pen" ? penPath(s.pts, s.w, width) : markerPath(s.pts, width));
  const liveTool = tool === "highlighter" ? "highlighter" : "pen";
  const palette = tool === "highlighter" ? HIGHLIGHTER_COLORS : PEN_COLORS;
  return (
    <div className="nb-sketch" onKeyDown={keys}>
      <div className="nb-sketch-bar" role="toolbar" aria-label="Sketch">
        <span className="nb-sketch-group" role="radiogroup" aria-label="Tool">
          {(
            [
              ["pen", "Pen", PenLine],
              ["highlighter", "Highlighter", Highlighter],
              ["eraser", "Eraser", Eraser],
            ] as const
          ).map(([id, label, Icon]) => (
            <button key={id} type="button" role="radio" aria-checked={tool === id} aria-label={label} title={label} className="nb-sk-btn" onClick={() => setTool(id)}>
              <Icon size={15} aria-hidden="true" />
            </button>
          ))}
        </span>
        {tool !== "eraser" && (
          <span className="nb-sketch-group" role="radiogroup" aria-label="Colour">
            {palette.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={color[liveTool] === c.id} aria-label={c.label} title={c.label} className="nb-sk-color" style={{ background: c.hex }} onClick={() => setColor((x) => ({ ...x, [liveTool]: c.id }))} />
            ))}
          </span>
        )}
        <span className="nb-sketch-group" role="radiogroup" aria-label="Size">
          {INK_SIZES.slice(0, 3).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={size === k} aria-label={SIZE_NAME[k]} title={SIZE_NAME[k]} className="nb-sk-btn" onClick={() => setSize(k)}>
              <span className="nb-sk-dot" data-size={k} aria-hidden="true" />
            </button>
          ))}
        </span>
        <button type="button" className="nb-sk-btn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={undo.current.length === 0} onClick={back}>
          <Undo2 size={15} aria-hidden="true" />
        </button>
      </div>
      <div
        ref={area}
        className="nb-sketch-area"
        role="img"
        aria-label={`A sketch, ${b.strokes.length} ${b.strokes.length === 1 ? "stroke" : "strokes"}`}
        data-tool={tool}
        style={{ height: shownH }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => setLive(null)}
      >
        {width > 0 && (
          <svg width={width} height={shownH} aria-hidden="true">
            {b.strokes.map((s) =>
              s.tool === "pen" ? (
                <path key={s.id} d={path(s)} fill={inkHex("pen", s.color)} />
              ) : (
                <path key={s.id} d={path(s)} fill="none" stroke={inkHex("highlighter", s.color)} strokeWidth={s.w * width} strokeLinecap="round" strokeLinejoin="round" opacity={0.45} />
              ),
            )}
            {live &&
              (liveTool === "pen" ? (
                <path d={penPath(live, widthFor("pen", size), width)} fill={inkHex("pen", color.pen)} />
              ) : (
                <path d={markerPath(live, width)} fill="none" stroke={inkHex("highlighter", color.highlighter)} strokeWidth={widthFor("highlighter", size) * width} strokeLinecap="round" strokeLinejoin="round" opacity={0.45} />
              ))}
          </svg>
        )}
      </div>
      <div
        className="nb-sketch-grip"
        role="slider"
        tabIndex={0}
        aria-label="Height of the sketch (Alt+Up and Alt+Down)"
        aria-orientation="vertical"
        aria-valuemin={NOTEBOOK_LIMITS.sketchMin}
        aria-valuemax={NOTEBOOK_LIMITS.sketchMax}
        aria-valuenow={height}
        aria-valuetext={`${height} pixels`}
        onKeyDown={(e) => {
          if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
          e.preventDefault();
          onHeight(setH(height + (e.key === "ArrowDown" ? 40 : -40)));
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, h: height };
        }}
        onPointerMove={(e) => drag.current && setH(drag.current.h + e.clientY - drag.current.y)}
        onPointerUp={() => {
          if (!drag.current) return;
          drag.current = null;
          onHeight(height);
        }}
      >
        <span aria-hidden="true" />
      </div>
    </div>
  );
}
