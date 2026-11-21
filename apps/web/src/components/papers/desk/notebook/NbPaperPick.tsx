import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { NotebookStyle } from "@scholar/shared";
import type { NbPage } from "../../../../lib/notebook";
import "./nb-paperpick.css";

// lucide's check, drawn here so this small chunk imports no icon module
const Check = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

/**
 * The papers of one page, drawn small (a menu of four, the page's ticked), under its tab's picture and inside the row: the arrows move (left and right one, up and down a row of two), Enter or
 * a click takes one and closes; Esc, Tab or a press outside closes. The focus goes back to the tab.
 */
export function PaperPick({ page, name, papers, row, onPick, onClose }: { page: NbPage; name: string; papers: readonly (readonly [NotebookStyle, string])[]; row: React.RefObject<HTMLDivElement | null>; onPick: (s: NotebookStyle) => void; onClose: (refocus: boolean) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    const icon = row.current?.querySelector<HTMLElement>(`[data-page-style="${page.id}"]`);
    const bar = el?.offsetParent as HTMLElement | null;
    if (!el || !bar) return;
    const b = bar.getBoundingClientRect();
    const at = icon ? icon.getBoundingClientRect().left - b.left - 8 : 8;
    setLeft(Math.max(8, Math.min(at, b.width - el.offsetWidth - 8)));
  }, [page.id, row]);
  // placed (and so shown: a hidden box cannot take the focus), the focus goes to the page's paper
  const placed = left !== null;
  useLayoutEffect(() => {
    if (placed) box.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  }, [placed]);
  const shut = useRef(onClose);
  shut.current = onClose;
  useEffect(() => {
    const away = (e: globalThis.PointerEvent) => {
      const t = e.target as Element;
      if (!box.current?.contains(t) && !t.closest?.(`[data-page-style="${page.id}"]`)) shut.current(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [page.id]);
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      return onClose(true);
    }
    const items = [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const n = items.length;
    const step = ({ ArrowRight: 1, ArrowLeft: -1, ArrowDown: 2, ArrowUp: -2 } as Record<string, number>)[e.key];
    const to = step !== undefined ? (i + step + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    items[to]?.focus();
  };
  return (
    <div ref={box} className="nb-pop nb-stylepick" role="menu" aria-label={`Paper for ${name}`} style={{ left: left ?? 8, visibility: left === null ? "hidden" : undefined }} onKeyDown={keys}>
      {papers.map(([s, label]) => (
        <button
          key={s}
          type="button"
          role="menuitemradio"
          aria-checked={page.style === s}
          tabIndex={-1}
          className="nb-papercard"
          onClick={() => {
            if (page.style !== s) onPick(s);
            onClose(true);
          }}
        >
          <span className="nb-paperprev" data-style={s} aria-hidden="true" />
          <span className="nb-stylepick-name">
            {label}
            {page.style === s && <Check />}
          </span>
        </button>
      ))}
    </div>
  );
}

