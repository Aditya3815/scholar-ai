import { ChevronUp, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { NotebookStyle } from "@scholar/shared";
import type { NbPage } from "../../../../lib/notebook";
import type { NbPop } from "./NbMenu";

/**
 * The pages as tabs (docs/design/paper-reader.md, 21.1, 2 and the notes polish of 19 Nov), a small chunk of its own (fetched as soon as the Notebook's arrives), so the Notebook chunk does
 * not grow. A tablist: ← → Home End move the focus, Enter or a click opens, Delete deletes; a tab without a title shows "Page N" by its place. Each tab has a × as a browser's tab does
 * (on the open tab, under the pointer, always on touch; a button beside the tab, hidden from assistive technology, since the tab's Delete key and the page's menu do the same).
 *
 * Reordering: drag a tab (a mouse: after 5 px; a finger: a long press, then drag), with the tab lifted and a line where it will go; Ctrl+Shift+← → (or Alt+Shift) on a focused tab; and the
 * All pages list (up and down). Each move is said through the live region ("Page moved to place 2 of 5") and saved by the store's PATCH of the page's place.
 * When the tabs do not fit, the row scrolls sideways with an edge fade and an "All pages" button before "+" lists them all (with a search field above 8 pages).
 */
export type PageTabsProps = {
  pages: NbPage[];
  openId: string;
  onOpen: (id: string) => void;
  onNew: (style: NotebookStyle) => void;
  onDelete: (page: NbPage) => void;
  /** To place `index`; returns the place taken, or -1. */
  onMove: (id: string, index: number) => number;
  announce: (s: string) => void;
  /** The notebook's pop-over, handed in: imported here, it would tie this chunk to the notebook's and to everything that one loads. */
  Pop: typeof NbPop;
  /** A page's name on screen (pageLabel), and the papers to choose from with their names: handed in for the same reason (shared's module sits in the first load's chunk). */
  label: (title: string, index: number) => string;
  papers: readonly (readonly [NotebookStyle, string])[];
};

// the icons the first load also has are drawn here (lucide's paths): imported, they would tie this small chunk to the first load's and so to everything it preloads
const Svg = ({ d, size }: { d: string; size: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
const ChevronDown = ({ size }: { size: number }) => <Svg size={size} d="m6 9 6 6 6-6" />;
const Plus = ({ size }: { size: number }) => <Svg size={size} d="M5 12h14M12 5v14" />;
const Check = ({ size }: { size: number }) => <Svg size={size} d="M20 6 9 17l-5-5" />;

type Press = { id: string; x: number; y: number; pid: number; touch: boolean; armed: boolean; timer: number; el: HTMLElement; mids: number[]; scroll0: number };

export function PageTabs({ pages, openId, onOpen, onNew, onDelete, onMove, announce, Pop: NbPop, label: pageLabel, papers }: PageTabsProps) {
  const row = useRef<HTMLDivElement>(null);
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
  }, [pages.length]);
  // the open page's tab is kept in sight
  useEffect(() => {
    document.getElementById(`nbt-${openId}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [openId]);

  /* ---- moving a page: the focus stays on its tab (a moved node can lose it), and the move is said ---- */
  const refocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!refocus.current) return;
    document.getElementById(`nbt-${refocus.current}`)?.focus({ preventScroll: true });
    refocus.current = null;
  });
  const move = (id: string, to: number, focusTab = true) => {
    const at = onMove(id, to);
    if (at < 0) return;
    if (focusTab) refocus.current = id;
    announce(`Page moved to place ${at + 1} of ${pages.length}`);
  };

  /* ---- drag: a pointer lifts the tab after 5 px, a finger after a long press; the line shows where it will go ---- */
  const press = useRef<Press | null>(null);
  const swallow = useRef(false);
  const [drag, setDrag] = useState<{ id: string; dx: number; to: number } | null>(null);
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    // once a long press has lifted a tab, the finger moves it instead of scrolling the row
    const hold = (e: TouchEvent) => {
      if (press.current?.armed) e.preventDefault();
    };
    el.addEventListener("touchmove", hold, { passive: false });
    return () => el.removeEventListener("touchmove", hold);
  }, []);
  const letGo = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
    setDrag(null);
  };
  const lift = (p: Press) => {
    const r = row.current!;
    const box = r.getBoundingClientRect();
    // the middles of the other tabs, in the row's own coordinates (so a scroll while dragging is allowed for)
    p.mids = [...r.querySelectorAll<HTMLElement>(".nb-tabwrap")].filter((w) => w.dataset.page !== p.id).map((w) => {
      const b = w.getBoundingClientRect();
      return b.left - box.left + r.scrollLeft + b.width / 2;
    });
    p.scroll0 = r.scrollLeft;
    p.armed = true;
    try {
      p.el.setPointerCapture(p.pid);
    } catch {
      /* the pointer has gone */
    }
    setDrag({ id: p.id, dx: 0, to: pages.findIndex((x) => x.id === p.id) });
  };
  const handlers = (id: string) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0 || pages.length < 2) return;
      const touch = e.pointerType !== "mouse";
      const p: Press = { id, x: e.clientX, y: e.clientY, pid: e.pointerId, touch, armed: false, timer: 0, el: e.currentTarget, mids: [], scroll0: 0 };
      if (touch)
        p.timer = window.setTimeout(() => {
          if (press.current !== p) return;
          navigator.vibrate?.(12);
          lift(p);
        }, 450);
      press.current = p;
    },
    onPointerMove: (e: PointerEvent<HTMLButtonElement>) => {
      const p = press.current;
      if (!p || p.pid !== e.pointerId) return;
      const dist = Math.hypot(e.clientX - p.x, e.clientY - p.y);
      if (!p.armed) {
        // a finger that moves before the long press is scrolling the row; a mouse lifts the tab after 5 px
        if (p.touch) return void (dist > 10 && letGo());
        if (Math.abs(e.clientX - p.x) < 5) return;
        lift(p);
      }
      const r = row.current!;
      const box = r.getBoundingClientRect();
      // near an edge, the row scrolls on
      if (e.clientX < box.left + 24) r.scrollLeft -= 10;
      else if (e.clientX > box.right - 24) r.scrollLeft += 10;
      const x = e.clientX - box.left + r.scrollLeft;
      // the lifted tab follows the pointer but stays inside the row (the row clips what passes its edge)
      const tab = p.el.parentElement!.getBoundingClientRect();
      const moved = e.clientX - p.x + (r.scrollLeft - p.scroll0);
      const now = drag?.dx ?? 0;
      const dx = Math.min(Math.max(moved, now + box.left - tab.left), now + box.right - tab.right);
      setDrag({ id: p.id, dx, to: p.mids.filter((m) => m < x).length });
    },
    onPointerUp: () => {
      const p = press.current;
      if (p?.armed && drag) {
        swallow.current = true;
        move(p.id, drag.to);
      }
      letGo();
    },
    onPointerCancel: letGo,
    onContextMenu: (e: React.MouseEvent) => {
      if (press.current?.touch) e.preventDefault();
    },
  });

  const keys = (e: KeyboardEvent<HTMLButtonElement>, k: number) => {
    const id = pages[k]!.id;
    if (e.key === "Delete") {
      e.preventDefault();
      onDelete(pages[k]!);
      return;
    }
    if (e.shiftKey && (e.ctrlKey || e.metaKey || e.altKey) && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      move(id, k + (e.key === "ArrowLeft" ? -1 : 1));
      return;
    }
    const to = e.key === "ArrowRight" ? Math.min(pages.length - 1, k + 1) : e.key === "ArrowLeft" ? Math.max(0, k - 1) : e.key === "Home" ? 0 : e.key === "End" ? pages.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    const el = document.getElementById(`nbt-${pages[to]!.id}`);
    el?.focus();
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  // where the line is drawn: before the tab that will follow the dragged one, or after the last
  const others = drag ? pages.filter((p) => p.id !== drag.id) : [];
  const from = drag ? pages.findIndex((p) => p.id === drag.id) : -1;
  const lineBefore = drag && drag.to !== from ? others[drag.to]?.id : undefined;
  const lineAfter = drag && drag.to !== from && drag.to === others.length ? others[others.length - 1]?.id : undefined;

  return (
    <div className="nb-tabsrow" data-dragging={drag ? true : undefined}>
      <div ref={row} className="nb-pagetabs" role="tablist" aria-label="Pages" data-more={more || undefined}>
        {pages.map((p, k) => {
          const name = pageLabel(p.title, k);
          const lifted = drag?.id === p.id;
          return (
            <span
              key={p.id}
              className="nb-tabwrap"
              role="presentation"
              data-page={p.id}
              data-lifted={lifted || undefined}
              data-line={lineBefore === p.id ? "before" : lineAfter === p.id ? "after" : undefined}
              style={lifted ? { transform: `translateX(${drag.dx}px)` } : undefined}
            >
              <button
                id={`nbt-${p.id}`}
                type="button"
                role="tab"
                className="nb-pagetab"
                aria-selected={p.id === openId}
                aria-controls="nb-pagepanel"
                aria-describedby="nb-tabs-hint"
                tabIndex={p.id === openId ? 0 : -1}
                aria-keyshortcuts="Delete Control+Shift+ArrowLeft Control+Shift+ArrowRight"
                title={name}
                onClick={() => {
                  if (swallow.current) return void (swallow.current = false);
                  onOpen(p.id);
                }}
                onKeyDown={(e) => keys(e, k)}
                {...handlers(p.id)}
              >
                <span className="nb-sw" data-style={p.style} aria-hidden="true" />
                <span className="nb-pagetab-t">{name}</span>
              </button>
              <button
                type="button"
                className="nb-tabx"
                tabIndex={-1}
                aria-hidden="true"
                title="Delete this page"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(p);
                }}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          );
        })}
      </div>
      <span id="nb-tabs-hint" className="sr-only">
        Drag to reorder, or press Control+Shift with the left or right arrow.
      </span>
      {more && (
        <NbPop
          kind="dialog"
          label="All pages"
          align="end"
          trigger={({ open, toggle, id, ref }) => (
            <button ref={ref} type="button" className="nb-addpage nb-allpages" aria-label={`All pages (${pages.length})`} title="All pages" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={toggle}>
              <ChevronDown size={16} />
            </button>
          )}
        >
          {(close) => <AllPages label={pageLabel} pages={pages} openId={openId} onPick={(id) => (close(false), onOpen(id), window.setTimeout(() => document.getElementById(`nbt-${id}`)?.focus(), 0))} onMove={(id, to) => move(id, to, false)} />}
        </NbPop>
      )}
      <NbPop
        kind="dialog"
        label="Choose paper for the new page"
        align="end"
        trigger={({ open, toggle, id, ref }) => (
          <button ref={ref} type="button" className="nb-addpage" aria-label="Add a page" title="Add a page" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} onClick={toggle}>
            <Plus size={16} />
          </button>
        )}
      >
        {(close) => (
          <div className="nb-paperpick">
            <div className="nb-paperpick-head">
              <p>Choose paper for the new page</p>
              <button type="button" className="icon-btn icon-btn-sm" aria-label="Close" onClick={() => close()}>
                <X size={15} aria-hidden="true" />
              </button>
            </div>
            <div className="nb-papercards">
              {papers.map(([s, name], k) => (
                <button key={s} type="button" className="nb-papercard" data-autofocus={k === 0 || undefined} onClick={() => (close(false), onNew(s))}>
                  <span className="nb-paperprev" data-style={s} aria-hidden="true" />
                  <span>{name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </NbPop>
    </div>
  );
}

/** "All pages": every page (a search field above 8), the open one ticked; a click opens one, and its ↑ ↓ move it. */
function AllPages({ label: pageLabel, pages, openId, onPick, onMove }: { label: PageTabsProps["label"]; pages: NbPage[]; openId: string; onPick: (id: string) => void; onMove: (id: string, to: number) => void }) {
  const [q, setQ] = useState("");
  const words = q.trim().toLowerCase();
  const rows = pages.map((p, k) => ({ p, k, name: pageLabel(p.title, k) })).filter((r) => !words || r.name.toLowerCase().includes(words));
  // a moved page keeps the focus on the button pressed (or its other one, at an end)
  const refocus = useRef<{ id: string; dir: "up" | "down" } | null>(null);
  const list = useRef<HTMLUListElement>(null);
  useLayoutEffect(() => {
    const r = refocus.current;
    if (!r) return;
    refocus.current = null;
    const btn = (d: string) => list.current?.querySelector<HTMLButtonElement>(`[data-mv="${r.id}-${d}"]`);
    const b = btn(r.dir);
    (b && !b.disabled ? b : btn(r.dir === "up" ? "down" : "up"))?.focus();
  });
  const mv = (id: string, dir: "up" | "down", k: number) => {
    refocus.current = { id, dir };
    onMove(id, k + (dir === "up" ? -1 : 1));
  };
  return (
    <div className="nb-allpages-box">
      <p className="nb-allpages-h">
        All pages <span>{pages.length}</span>
      </p>
      {pages.length > 8 && <input className="nb-allpages-find" type="search" data-autofocus aria-label="Find a page" placeholder="Find a page" value={q} onChange={(e) => setQ(e.target.value)} />}
      {rows.length === 0 ? (
        <p className="nb-allpages-none" role="status">No page has that name.</p>
      ) : (
        <ul ref={list} className="nb-allpages-list" aria-label="Pages">
          {rows.map(({ p, k, name }) => (
            <li key={p.id}>
              <button type="button" className="nb-ap-open" aria-current={p.id === openId ? "page" : undefined} data-autofocus={!words && pages.length <= 8 && p.id === openId ? true : undefined} onClick={() => onPick(p.id)}>
                <span className="nb-sw" data-style={p.style} aria-hidden="true" />
                <span className="nb-ap-name">{name}</span>
                {p.id === openId && <Check size={14} />}
              </button>
              <button type="button" className="nb-ap-mv" data-mv={`${p.id}-up`} aria-label={`Move ${name} up`} disabled={k === 0} onClick={() => mv(p.id, "up", k)}>
                <ChevronUp size={15} aria-hidden="true" />
              </button>
              <button type="button" className="nb-ap-mv" data-mv={`${p.id}-down`} aria-label={`Move ${name} down`} disabled={k === pages.length - 1} onClick={() => mv(p.id, "down", k)}>
                <ChevronDown size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
