import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { NbPage } from "../../../../lib/notebook";
import "./nb-allpages.css";

/**
 * "All pages" (the page tabs' list, a small chunk of its own fetched when the list is first wanted): every page (a search field above 8), the open one ticked; a click opens one.
 *
 * Reordering, as the tab strip does it: drag a row (a mouse after 4 px, a finger after a long press, or at once by its grip), with the row lifted, a line where it will go and the list
 * scrolling on near its edges; Esc puts it back. By keyboard, on a row's grip (dnd-kit's pattern): Space or Enter picks the page up, ↑ ↓ (Home End) move it, Space or Enter drops it,
 * Esc puts it back; Alt+↑ ↓ on either button moves it one place at once. Each move is said ("Page 4 moved to position 2 of 6") and saved by the store, as a tab's move is.
 */
type Props = {
  label: (title: string, index: number) => string;
  pages: NbPage[];
  openId: string;
  onPick: (id: string) => void;
  /** To place `index`; returns the place taken, or -1. */
  onMove: (id: string, index: number) => number;
  announce: (s: string) => void;
};
/** A row being moved: by a pointer (`dy` its offset, the line at `to`) or by keyboard (shown at `to` until it is dropped). */
type Drag = { id: string; from: number; to: number; dy: number; kbd: boolean };
type Press = { id: string; y: number; lastY: number; pid: number; touch: boolean; armed: boolean; timer: number; el: HTMLElement; mids: number[]; scroll0: number };

const Check = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const Grip = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    {[5, 12, 19].map((y) => [9, 15].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r={1.6} />))}
  </svg>
);

export function AllPages({ label, pages, openId, onPick, onMove, announce }: Props) {
  const [q, setQ] = useState("");
  const words = q.trim().toLowerCase();
  // reordering is for the whole list: not while a search hides some pages
  const sortable = !words && pages.length > 1;
  const list = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const n = pages.length;
  const nameOf = (id: string) => {
    const k = pages.findIndex((p) => p.id === id);
    return k < 0 ? "Page" : label(pages[k]!.title, k);
  };

  // the list's own focus: it is drawn after the pop-over opened (a chunk of its own), so it takes the focus itself
  useLayoutEffect(() => {
    list.current?.closest(".nb-pop")?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
  }, []);
  // a moved row keeps the focus on the button that moved it (a moved node can lose it)
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!refocus.current) return;
    list.current?.querySelector<HTMLElement>(refocus.current)?.focus({ preventScroll: true });
    refocus.current = null;
  });
  const commit = (id: string, to: number, focus: string) => {
    const name = nameOf(id);
    const at = onMove(id, to);
    if (at < 0) return;
    refocus.current = focus;
    announce(`${name} moved to position ${at + 1} of ${n}`);
  };

  /* ---- a pointer: the row lifts and follows; a line shows where it will go; near an edge the list scrolls on ---- */
  const press = useRef<Press | null>(null);
  const swallow = useRef(false);
  const frame = useRef(0);
  const letGo = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
    cancelAnimationFrame(frame.current);
    setDrag((d) => (d && !d.kbd ? null : d));
  };
  const place = (p: Press) => {
    const ul = list.current;
    if (!ul) return;
    const box = ul.getBoundingClientRect();
    const y = p.lastY - box.top + ul.scrollTop;
    const top0 = p.el.offsetTop;
    const dy = Math.min(Math.max(p.lastY - p.y + (ul.scrollTop - p.scroll0), -top0), ul.scrollHeight - top0 - p.el.offsetHeight);
    const to = p.mids.filter((m) => m < y).length;
    setDrag((d) => (d && d.id === p.id ? { ...d, dy, to } : d));
  };
  const roll = () => {
    const p = press.current;
    const ul = list.current;
    if (!p?.armed || !ul) return;
    const box = ul.getBoundingClientRect();
    const edge = 32;
    const step = p.lastY < box.top + edge ? -Math.ceil((box.top + edge - p.lastY) / 4) : p.lastY > box.bottom - edge ? Math.ceil((p.lastY - box.bottom + edge) / 4) : 0;
    if (step) {
      ul.scrollTop += step;
      place(p);
    }
    frame.current = requestAnimationFrame(roll);
  };
  const lift = (p: Press) => {
    const ul = list.current;
    if (!ul) return;
    const box = ul.getBoundingClientRect();
    // the middles of the other rows, in the list's own coordinates (so a scroll while dragging is allowed for)
    p.mids = [...ul.querySelectorAll<HTMLElement>(":scope > li")].filter((li) => li.dataset.page !== p.id).map((li) => {
      const b = li.getBoundingClientRect();
      return b.top - box.top + ul.scrollTop + b.height / 2;
    });
    p.scroll0 = ul.scrollTop;
    p.armed = true;
    try {
      p.el.setPointerCapture(p.pid);
    } catch {
      /* the pointer has gone */
    }
    const from = pages.findIndex((x) => x.id === p.id);
    setDrag({ id: p.id, from, to: from, dy: 0, kbd: false });
    frame.current = requestAnimationFrame(roll);
  };
  useEffect(() => {
    const ul = list.current;
    if (!ul) return;
    // once a long press has lifted a row, the finger moves it instead of scrolling the list
    const hold = (e: TouchEvent) => {
      if (press.current?.armed) e.preventDefault();
    };
    ul.addEventListener("touchmove", hold, { passive: false });
    return () => ul.removeEventListener("touchmove", hold);
  });
  // Esc while a pointer drags: the row goes back, and the pop-over stays open
  const dragging = !!drag && !drag.kbd;
  useEffect(() => {
    if (!dragging) return;
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      const id = press.current?.id;
      letGo();
      if (id) announce(`Move cancelled. ${nameOf(id)} is back in its place.`);
    };
    window.addEventListener("keydown", esc, true);
    return () => window.removeEventListener("keydown", esc, true);
  });
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const rowHandlers = (id: string) => ({
    onPointerDown: (e: PointerEvent<HTMLLIElement>) => {
      if (!sortable || e.button !== 0 || drag?.kbd) return;
      const grip = !!(e.target as HTMLElement).closest(".nb-ap-grip");
      const touch = e.pointerType !== "mouse";
      const p: Press = { id, y: e.clientY, lastY: e.clientY, pid: e.pointerId, touch: touch && !grip, armed: false, timer: 0, el: e.currentTarget, mids: [], scroll0: 0 };
      press.current = p;
      // the grip lifts at once (a finger too: it does not scroll the list); a finger elsewhere on the row lifts it after a long press
      if (grip && touch) lift(p);
      else if (touch)
        p.timer = window.setTimeout(() => {
          if (press.current !== p) return;
          navigator.vibrate?.(12);
          lift(p);
        }, 400);
    },
    onPointerMove: (e: PointerEvent<HTMLLIElement>) => {
      const p = press.current;
      if (!p || p.pid !== e.pointerId) return;
      p.lastY = e.clientY;
      if (!p.armed) {
        // a finger that moves before the long press is scrolling the list; a mouse lifts the row after 4 px
        if (p.touch) return void (Math.abs(e.clientY - p.y) > 10 && letGo());
        if (Math.abs(e.clientY - p.y) < 4) return;
        lift(p);
      }
      place(p);
    },
    onPointerUp: () => {
      const p = press.current;
      if (p?.armed && drag && !drag.kbd) {
        swallow.current = true;
        window.setTimeout(() => (swallow.current = false), 0);
        if (drag.to !== drag.from) commit(p.id, drag.to, `[data-grip="${p.id}"]`);
      }
      letGo();
    },
    onPointerCancel: letGo,
    onContextMenu: (e: React.MouseEvent) => {
      if (press.current?.touch) e.preventDefault();
    },
  });

  /* ---- the keyboard ---- */
  const held = drag?.kbd ? drag : null;
  const moveBy = (e: KeyboardEvent, id: string, k: number, focus: string) => {
    if (!sortable || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return false;
    e.preventDefault();
    const to = k + (e.key === "ArrowUp" ? -1 : 1);
    if (to >= 0 && to < n) commit(id, to, focus);
    return true;
  };
  const gripKeys = (e: KeyboardEvent<HTMLButtonElement>, id: string, k: number) => {
    const sel = `[data-grip="${id}"]`;
    if (held?.id === id) {
      const to = e.key === "ArrowUp" ? held.to - 1 : e.key === "ArrowDown" ? held.to + 1 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -2;
      if (to > -2) {
        e.preventDefault();
        const at = Math.min(n - 1, Math.max(0, to));
        if (at !== held.to) {
          refocus.current = sel;
          setDrag({ ...held, to: at });
        }
        announce(`${nameOf(id)}, position ${at + 1} of ${n}`);
      } else if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setDrag(null);
        if (held.to !== held.from) commit(id, held.to, sel);
        else announce(`${nameOf(id)} dropped at position ${held.to + 1} of ${n}`);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        refocus.current = sel;
        setDrag(null);
        announce(`Move cancelled. ${nameOf(id)} is back at position ${held.from + 1} of ${n}`);
      } else if (e.key === "Tab") setDrag(null);
      return;
    }
    if (moveBy(e, id, k, sel)) return;
    if (sortable && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      setDrag({ id, from: k, to: k, dy: 0, kbd: true });
      announce(`Picked up ${nameOf(id)}, position ${k + 1} of ${n}. Use the up and down arrows to move it, Space to drop it, Escape to cancel.`);
    }
  };

  const all = pages.map((p, k) => ({ p, k, name: label(p.title, k) }));
  let rows = all.filter((r) => !words || r.name.toLowerCase().includes(words));
  // a page held by the keyboard is shown where it would go
  if (held) {
    const at = rows.findIndex((r) => r.p.id === held.id);
    const [r] = rows.splice(at, 1);
    rows.splice(held.to, 0, r!);
  }
  // where the line is drawn during a pointer drag: before the row that will follow the dragged one, or after the last
  const others = dragging ? pages.filter((p) => p.id !== drag!.id) : [];
  const lineBefore = dragging && drag!.to !== drag!.from ? others[drag!.to]?.id : undefined;
  const lineAfter = dragging && drag!.to !== drag!.from && drag!.to === others.length ? others[others.length - 1]?.id : undefined;

  return (
    <div className="nb-allpages-box">
      <p className="nb-allpages-h">
        All pages <span>{n}</span>
      </p>
      {n > 8 && <input className="nb-allpages-find" type="search" data-autofocus aria-label="Find a page" placeholder="Find a page" value={q} onChange={(e) => setQ(e.target.value)} />}
      {rows.length === 0 ? (
        <p className="nb-allpages-none" role="status">
          No page has that name.
        </p>
      ) : (
        <ul ref={list} className="nb-allpages-list" aria-label="Pages" data-dragging={dragging || undefined}>
          {rows.map(({ p, k, name }) => {
            const lifted = drag?.id === p.id;
            return (
              <li
                key={p.id}
                data-page={p.id}
                data-lifted={(lifted && !drag!.kbd) || undefined}
                data-held={(lifted && drag!.kbd) || undefined}
                data-line={lineBefore === p.id ? "before" : lineAfter === p.id ? "after" : undefined}
                style={lifted && !drag!.kbd ? { transform: `translateY(${drag!.dy}px)` } : undefined}
                {...rowHandlers(p.id)}
              >
                {sortable && (
                  <button
                    type="button"
                    className="nb-ap-grip"
                    data-grip={p.id}
                    aria-label={`Reorder ${name}`}
                    aria-describedby="nb-ap-hint"
                    aria-keyshortcuts="Space Alt+ArrowUp Alt+ArrowDown"
                    title="Drag to reorder"
                    onKeyDown={(e) => gripKeys(e, p.id, k)}
                    onBlur={() => held?.id === p.id && !refocus.current && setDrag(null)}
                  >
                    <Grip />
                  </button>
                )}
                <button
                  type="button"
                  className="nb-ap-open"
                  data-open={p.id}
                  aria-current={p.id === openId ? "page" : undefined}
                  data-autofocus={!words && n <= 8 && p.id === openId ? true : undefined}
                  onKeyDown={(e) => moveBy(e, p.id, k, `[data-open="${p.id}"]`)}
                  onClick={() => !swallow.current && onPick(p.id)}
                >
                  <span className="nb-sw" data-style={p.style} aria-hidden="true" />
                  <span className="nb-ap-name">{name}</span>
                  {p.id === openId && <Check />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {sortable && (
        <span id="nb-ap-hint" className="sr-only">
          Space picks the page up; the up and down arrows move it, Space drops it, Escape cancels. Alt with the up or down arrow moves it at once.
        </span>
      )}
    </div>
  );
}
