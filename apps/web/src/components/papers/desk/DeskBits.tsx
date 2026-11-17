import { AnimatePresence, m } from "motion/react";
import { Columns2, Download, FileDown, Highlighter, Loader2, MousePointer2, NotebookText, PencilLine, ScrollText, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { DocNote, InkItem, NoteColor } from "@scholar/shared";
import type { DeskView } from "../../../lib/desk";
import type { DeskTool } from "../../../lib/desk-keys";
import { MEANINGS, MEANING_LIST } from "../../../lib/meanings";
import { spring, springPop } from "../../../lib/motion";
import { toasts, useToast } from "../../../lib/toast";
import type { PDFDocumentProxy } from "../../../lib/pdf";
import { Pop } from "../../Pop";
import { useAnnotatedDownload } from "../AnnotatedDownload";

/**
 * The small pieces of the new Paper Reader (docs/design/paper-reader.md): the view switch, the tool segment and the meaning picker, the Download menu, the divider of Split,
 * the toasts and the Agents button. Every colour is a token (tokens.css), so each works in Light, Dark, Read and the system's dark.
 */

/* ---------------------------------------------------------------- a radio group of buttons (the view switch, the tools, the meanings) */

/** Arrow keys move the choice inside a radio group, as the ARIA pattern asks (Home and End go to the ends); the focus follows. */
function radioKeys(e: KeyboardEvent<HTMLElement>, ids: string[], value: string, pick: (id: string) => void) {
  const i = ids.indexOf(value);
  const to = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % ids.length : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + ids.length) % ids.length : e.key === "Home" ? 0 : e.key === "End" ? ids.length - 1 : -1;
  if (to < 0) return;
  e.preventDefault();
  pick(ids[to]!);
  const group = e.currentTarget;
  window.setTimeout(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(), 0);
}

const VIEW_LABEL: Record<DeskView, { label: string; Icon: typeof ScrollText; hint: string }> = {
  paper: { label: "Paper", Icon: ScrollText, hint: "The paper alone" },
  split: { label: "Split", Icon: Columns2, hint: "The paper and the notes side by side" },
  notes: { label: "Notes", Icon: NotebookText, hint: "Highlights and references" },
};

/** Paper | Split | Notes in the header; a phone is offered Paper | Notes (lib/desk.ts). */
export function ViewSwitch({ view, views, onChange }: { view: DeskView; views: DeskView[]; onChange: (v: DeskView) => void }) {
  return (
    <div className="seg desk-views" role="radiogroup" aria-label="View" onKeyDown={(e) => radioKeys(e, views, view, (v) => onChange(v as DeskView))}>
      {views.map((v) => {
        const { label, Icon, hint } = VIEW_LABEL[v];
        const on = v === view;
        return (
          <button key={v} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} className="seg-btn desk-view" data-view={v} title={hint} onClick={() => onChange(v)}>
            {on && <m.span layoutId="desk-view-pill" className="seg-pill" transition={spring} />}
            <Icon size={15} aria-hidden="true" />
            <span className="desk-view-label">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

const TOOLS: { id: DeskTool; label: string; key: string; Icon: typeof ScrollText; hint: string }[] = [
  { id: "select", label: "Select", key: "V", Icon: MousePointer2, hint: "Select and read: a selection shows what can be done with it" },
  { id: "highlight", label: "Highlight", key: "H", Icon: Highlighter, hint: "Highlight: every selection becomes a highlight in the meaning chosen" },
  { id: "draw", label: "Draw", key: "D", Icon: PencilLine, hint: "Draw, highlight by hand and write on the paper" },
];

/** The tool segment of the paper's toolbar: Select V, Highlight H, Draw D (Capture comes in phase 3). Icons only on a phone; the name is always the button's. */
export function ToolSegment({ tool, onTool }: { tool: DeskTool; onTool: (t: DeskTool) => void }) {
  return (
    <div className="seg desk-tools" role="radiogroup" aria-label="Tool" onKeyDown={(e) => radioKeys(e, TOOLS.map((t) => t.id), tool, (t) => onTool(t as DeskTool))}>
      {TOOLS.map(({ id, label, key, Icon, hint }) => {
        const on = id === tool;
        return (
          <button key={id} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} aria-keyshortcuts={key} aria-label={label} className="seg-btn desk-tool" data-tool={id} title={`${hint} (${key})`} onClick={() => onTool(id)}>
            {on && <m.span layoutId="desk-tool-pill" className="seg-pill" transition={spring} />}
            <Icon size={15} aria-hidden="true" />
            <span className="desk-tool-label" aria-hidden="true">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A meaning's dot: a ring in its colour with its letter inside (K, M, Q, R), so the colour is never the only sign. */
export function MeaningDot({ color }: { color: NoteColor }) {
  return (
    <span className="desk-dot" data-color={color} aria-hidden="true">
      {MEANINGS[color].letter}
    </span>
  );
}

/** The four meanings to highlight in, shown only while Highlight is the tool. */
export function MeaningPicker({ value, onChange }: { value: NoteColor; onChange: (c: NoteColor) => void }) {
  return (
    <div className="desk-meanings" role="radiogroup" aria-label="Highlight as" onKeyDown={(e) => radioKeys(e, MEANING_LIST.map((x) => x.color), value, (c) => onChange(c as NoteColor))}>
      {MEANING_LIST.map((x) => {
        const on = x.color === value;
        return (
          <button key={x.color} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} aria-label={x.name} className="desk-meaning" data-color={x.color} title={`${x.name}: ${x.hint}`} onClick={() => onChange(x.color)}>
            <MeaningDot color={x.color} />
            <span className="desk-meaning-name" aria-hidden="true">{x.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- the Download menu */

/** One menu for the two downloads: the original PDF, and a copy with my marks (today's two buttons). */
export function DownloadMenu({ href, title, docId, pdf, notes, strokes }: { href: string; title: string; docId: string; pdf: PDFDocumentProxy; notes: DocNote[]; strokes: InkItem[] }) {
  const marked = useAnnotatedDownload({ docId, pdf, title, notes, strokes });
  return (
    <Pop
      label="Download"
      align="end"
      trigger={(open) => (
        <button type="button" className="icon-btn icon-btn-sm desk-download" aria-haspopup="menu" aria-expanded={open} aria-label="Download" title="Download">
          {marked.busy ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
        </button>
      )}
    >
      {(close) => (
        <div
          className="desk-menu"
          role="menu"
          aria-label="Download"
          onKeyDown={(e) => {
            // a menu: the arrows move between its items (Esc closes it: the popover's own)
            const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=menuitem]:not([disabled])")];
            const i = items.indexOf(document.activeElement as HTMLElement);
            const to = e.key === "ArrowDown" ? (i + 1) % items.length : e.key === "ArrowUp" ? (i - 1 + items.length) % items.length : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : -1;
            if (to < 0) return;
            e.preventDefault();
            items[to]?.focus();
          }}
        >
          <a role="menuitem" className="desk-menu-item" href={href} download onClick={() => close()}>
            <Download size={15} aria-hidden="true" />
            <span>
              The original PDF
              <small>As it was uploaded</small>
            </span>
          </a>
          <button
            type="button"
            role="menuitem"
            className="desk-menu-item"
            disabled={marked.busy}
            onClick={() => {
              close();
              marked.run();
            }}
          >
            <FileDown size={15} aria-hidden="true" />
            <span>
              A copy with my marks
              <small>{marked.empty ? "Nothing is marked yet" : "Highlights, drawings and notes"}</small>
            </span>
          </button>
        </div>
      )}
    </Pop>
  );
}

/* ---------------------------------------------------------------- the divider of Split */

export const SIDE_KEY = "scholar.split.side";
const REM = 16;
/** The panel's width, kept on this device: between 22rem and 48 % of the window. */
export const clampSide = (px: number, windowWidth: number) => Math.round(Math.min(Math.max(px, 22 * REM), Math.max(22 * REM, windowWidth * 0.48)));

/** The line between the paper and the panel in Split: drag it, or focus it and use the arrow keys (Home and End go to the ends). */
export function SplitDivider({ width, onWidth, panel }: { width: number | null; onWidth: (px: number) => void; panel: () => HTMLElement | null }) {
  const drag = useRef<{ x: number; w: number } | null>(null);
  const now = () => width ?? panel()?.getBoundingClientRect().width ?? 23 * REM;
  const min = 22 * REM;
  const max = typeof window === "undefined" ? 800 : Math.max(min, Math.round(window.innerWidth * 0.48));
  const set = (px: number) => onWidth(clampSide(px, window.innerWidth));
  return (
    <div
      className="desk-divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Width of the panel"
      aria-valuemin={Math.round(min)}
      aria-valuemax={max}
      aria-valuenow={Math.round(now())}
      aria-valuetext={`${Math.round(now())} pixels`}
      tabIndex={0}
      title="Drag, or use the arrow keys, to change the width of the panel"
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 24;
        // the panel is on the right: the line moves left and the panel grows
        if (e.key === "ArrowLeft") set(now() + step);
        else if (e.key === "ArrowRight") set(now() - step);
        else if (e.key === "Home") set(max);
        else if (e.key === "End") set(min);
        else return;
        e.preventDefault();
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, w: now() };
      }}
      onPointerMove={(e) => {
        if (drag.current) set(drag.current.w + (drag.current.x - e.clientX));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <span className="desk-divider-grip" aria-hidden="true" />
    </div>
  );
}

/* ---------------------------------------------------------------- toasts */

/** One toast at a time at the bottom centre (above the Agents button on a phone): role="status", its action a real button reached with Tab; its clock stops while pointed at or focused. */
export function Toasts({ onRect }: { onRect: (r: DOMRect | null) => void }) {
  const t = useToast();
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    onRect(t ? (box.current?.querySelector(".desk-toast")?.getBoundingClientRect() ?? null) : null);
  }, [t, onRect]);
  useEffect(() => () => toasts.clear(), []);
  return (
    <div
      ref={box}
      className="desk-toasts"
      role="status"
      aria-live="polite"
      onPointerEnter={() => toasts.pause(true)}
      onPointerLeave={() => toasts.pause(false)}
      onFocus={() => toasts.pause(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) toasts.pause(false);
      }}
    >
      <AnimatePresence initial={false}>
        {t && (
          <m.div key={t.id} className="desk-toast" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, transition: { duration: 0.12 } }} transition={spring}>
            <span className="desk-toast-text">{t.text}</span>
            {t.action && (
              <button type="button" className="desk-toast-act" onClick={() => toasts.act(t.id)}>
                {t.action.label}
              </button>
            )}
            <button type="button" className="icon-btn icon-btn-sm desk-toast-x" aria-label="Dismiss" onClick={() => toasts.dismiss(t.id)}>
              <X size={14} aria-hidden="true" />
            </button>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------------- the Agents button */

/** The round Agents button at the bottom right; Close while the drawer is open. `lift` moves it up above the pop-up of a selection or a toast, so it never covers them. */
export function AgentsFab({ open, wide, lift, hidden, onToggle, fabRef }: { open: boolean; wide: boolean; lift: number; hidden: boolean; onToggle: () => void; fabRef: React.RefObject<HTMLButtonElement | null> }) {
  return (
    <m.button
      ref={fabRef}
      type="button"
      className="desk-fab"
      data-open={open}
      data-wide={wide}
      hidden={hidden}
      aria-expanded={open}
      aria-controls="desk-agents"
      aria-label={open ? "Close the agents" : "Agents"}
      title={open ? "Close the agents (Esc)" : "Agents: ask this paper"}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1, y: -lift }}
      transition={springPop}
      onClick={onToggle}
    >
      <AnimatePresence mode="wait" initial={false}>
        <m.span key={open ? "x" : "s"} className="desk-fab-ico" initial={{ rotate: -45, opacity: 0 }} animate={{ rotate: 0, opacity: 1 }} exit={{ rotate: 45, opacity: 0 }} transition={springPop}>
          {open ? <X size={20} aria-hidden="true" /> : <Sparkles size={20} aria-hidden="true" />}
        </m.span>
      </AnimatePresence>
      {wide && <span className="desk-fab-word" aria-hidden="true">{open ? "Close" : "Agents"}</span>}
    </m.button>
  );
}

/** Calls `fn` with the element's box now and whenever it changes size (for the Agents button to stay clear of it). */
export function useReportRect(ref: React.RefObject<HTMLElement | null>, fn: (r: DOMRect | null) => void, deps: unknown[]) {
  const latest = useRef(fn);
  latest.current = fn;
  const report = useCallback(() => latest.current(ref.current?.getBoundingClientRect() ?? null), [ref]);
  useLayoutEffect(() => {
    report();
    const el = ref.current;
    if (!el) return () => latest.current(null);
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => {
      ro.disconnect();
      latest.current(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export type Slot = ReactNode;
