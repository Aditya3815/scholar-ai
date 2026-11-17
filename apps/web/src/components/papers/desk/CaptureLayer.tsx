import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { FIRST_FRAME, nudgeFrame, rectFromDrag, type CaptureRect } from "../../../lib/capture";

/**
 * Capture on a page of the paper (docs/design/paper-reader.md, 21.1, 6): over the page while the Capture tool is in hand. Drag a frame and let go to capture it. By keyboard: Enter places a
 * frame, the arrows move it, Shift and the arrows resize it, Enter captures and Esc lets the frame go (a second Esc puts the tool down). Handed to the viewer as a slot, so its chunk does not grow.
 */
export function CaptureLayer({ page, onCapture, onCancel }: { page: number; onCapture: (r: CaptureRect & { page: number }) => void; onCancel: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const [frame, setFrame] = useState<CaptureRect | null>(null);
  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const size = () => {
    const r = box.current?.getBoundingClientRect();
    return { width: r?.width ?? 0, height: r?.height ?? 0 };
  };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (!frame) return setFrame(FIRST_FRAME);
      setFrame(null);
      return onCapture({ page, ...frame });
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      return frame ? setFrame(null) : onCancel();
    }
    if (frame && e.key.startsWith("Arrow")) {
      e.preventDefault();
      setFrame(nudgeFrame(frame, e.key, e.shiftKey));
    }
  };
  // what is drawn: the frame being dragged (pixels), or the keyboard's (fractions)
  const box2 = size();
  const shown = drag
    ? { left: Math.min(drag.a.x, drag.b.x), top: Math.min(drag.a.y, drag.b.y), width: Math.abs(drag.b.x - drag.a.x), height: Math.abs(drag.b.y - drag.a.y) }
    : frame && box2.width > 0
      ? { left: frame.x * box2.width, top: frame.y * box2.height, width: frame.w * box2.width, height: frame.h * box2.height }
      : null;
  return (
    <div
      ref={box}
      className="desk-capture"
      role="button"
      tabIndex={0}
      aria-label={`Capture a part of page ${page}: drag over it, or press Enter to place a frame (the arrows move it, Shift and the arrows resize it, Enter captures, Esc stops)`}
      data-framing={frame ? true : undefined}
      onKeyDown={keys}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = at(e);
        setFrame(null);
        setDrag({ a: p, b: p });
      }}
      onPointerMove={(e) => drag && setDrag({ a: drag.a, b: at(e) })}
      onPointerUp={(e) => {
        if (!drag) return;
        const r = rectFromDrag(drag.a, at(e), size());
        setDrag(null);
        if (r) onCapture({ page, ...r });
      }}
      onPointerCancel={() => setDrag(null)}
    >
      {shown && <div className="desk-capture-frame" style={shown} aria-hidden="true" />}
    </div>
  );
}
