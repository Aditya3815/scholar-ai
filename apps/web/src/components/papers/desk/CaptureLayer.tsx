import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { FIRST_FRAME, nudgeFrame, rectFromDrag, type CaptureRect } from "../../../lib/capture";

/**
 * Capture on a page of the paper (docs/design/paper-reader.md, 21.1, 6): over the page while the Capture tool is in hand. Drag a frame and let go to capture it. By keyboard: Enter places a
 * frame, the arrows move it, Shift and the arrows resize it, Enter captures and Esc lets the frame go (a second Esc puts the tool down). On touch the page scrolls as ever: a finger held
 * still for a moment (a long press) starts the frame, and only then does the drag draw it (the owner's choice of 18 Nov). Handed to the viewer as a slot, so its chunk does not grow.
 */
export function CaptureLayer({ page, onCapture, onCancel }: { page: number; onCapture: (r: CaptureRect & { page: number }) => void; onCancel: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const [frame, setFrame] = useState<CaptureRect | null>(null);
  // a touch: where it began and its timer; armed once it was held still long enough
  const press = useRef<{ x: number; y: number; timer: number; armed: boolean; id: number } | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // once a long press has started a frame, the finger draws it instead of scrolling the page
    const hold = (e: TouchEvent) => {
      if (press.current?.armed) e.preventDefault();
    };
    el.addEventListener("touchmove", hold, { passive: false });
    return () => el.removeEventListener("touchmove", hold);
  }, []);
  const letGo = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
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
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        if (e.pointerType === "touch") {
          // the page may be scrolling: wait to see the finger held still
          const p = at(e);
          const target = e.currentTarget;
          const id = e.pointerId;
          letGo();
          press.current = {
            x: e.clientX,
            y: e.clientY,
            armed: false,
            id,
            timer: window.setTimeout(() => {
              if (!press.current) return;
              press.current.armed = true;
              try {
                target.setPointerCapture(id);
              } catch {
                /* the finger has gone */
              }
              navigator.vibrate?.(12);
              setFrame(null);
              setDrag({ a: p, b: p });
            }, 450),
          };
          return;
        }
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = at(e);
        setFrame(null);
        setDrag({ a: p, b: p });
      }}
      onPointerMove={(e) => {
        const t = press.current;
        if (t && !t.armed) {
          // moved before the long press: it is a scroll, not a frame
          if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10) letGo();
          return;
        }
        if (drag) setDrag({ a: drag.a, b: at(e) });
      }}
      onPointerUp={(e) => {
        letGo();
        if (!drag) return;
        const r = rectFromDrag(drag.a, at(e), size());
        setDrag(null);
        if (r) onCapture({ page, ...r });
      }}
      onPointerCancel={() => {
        letGo();
        setDrag(null);
      }}
    >
      {shown && <div className="desk-capture-frame" style={shown} aria-hidden="true" />}
    </div>
  );
}
