import "../../styles/cites.css";
import * as Popover from "@radix-ui/react-popover";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import type { Paper } from "@scholar/shared";
import type { PageCite } from "../../lib/citations";
import { CITE_LABEL, NOT_FOUND_HELP, cardRecord, citeStatus, metaLine } from "../../lib/citeStatus";
import type { VerifyItem } from "../../lib/verify";

// The card's few marks are drawn here rather than taken from the icon set or the library's modules: those live in the first load, and importing them from the
// reader's chunk split them out of it (docs/design/reader-citations.md, "Work and speed"). What the card does with a paper (ask, save) comes from the page as props.
const Svg = ({ children, size = 13 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const TickMark = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);
const ShieldMark = () => (
  <Svg>
    <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" />
    <path d="M12 8v5M12 16.5h.01" />
  </Svg>
);
const InfoMark = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Svg>
);
const OutMark = () => (
  <Svg size={12}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Svg>
);

type Open = { id: string; el: HTMLElement; pinned: boolean; via: "hover" | "focus" | "key" | "click" | "tap" };

const OPEN_DELAY = 200;
const SWITCH_DELAY = 60;
const CLOSE_DELAY = 250;

/**
 * The card a citation in the paper opens (docs/design/reader-citations.md, 4): one card for the whole reader, anchored to the citation in hand.
 * - Mouse: it opens after a short rest on the citation, stays while the pointer moves into it, and closes a moment after the pointer leaves both.
 * - Keyboard: focus on a citation shows it without taking the focus; Enter or Space opens it and moves the focus in; Escape closes it and gives the focus back.
 * - Touch: a tap opens it, a tap outside closes it.
 * Its status says "Verified" only when the Reference Verifier said so.
 */
export function CitationCard({
  root,
  cites,
  references,
  itemOf,
  bump,
  onShowInList,
  disabled,
  online,
  onAsk,
  savedIds,
  onToggleSave,
}: {
  /** the scrolling area of the pages: the citations are buttons inside it */
  root: RefObject<HTMLElement | null>;
  cites: ReadonlyMap<string, PageCite>;
  references: readonly string[];
  itemOf: (entry: number) => VerifyItem | undefined;
  bump: (entry: number) => void;
  onShowInList: (entry: number) => void;
  /** while drawing, citations do nothing */
  disabled: boolean;
  online: boolean;
  /** "Ask about it": the page's "Ask this paper" sheet */
  onAsk: (paper: Paper) => void;
  /** the library: which papers are saved, and saving or removing one */
  savedIds: ReadonlySet<string>;
  onToggleSave: (paper: Paper) => void;
}) {
  const [open, setOpen] = useState<Open | null>(null);
  const [k, setK] = useState(0);
  const openRef = useRef<Open | null>(null);
  openRef.current = open;
  const card = useRef<HTMLDivElement>(null);
  const timers = useRef({ open: 0, close: 0 });
  const lastPointer = useRef<string>("mouse");
  const titleId = useId();

  const clearTimers = () => {
    window.clearTimeout(timers.current.open);
    window.clearTimeout(timers.current.close);
  };
  const show = useCallback((el: HTMLElement, pinned: boolean, via: Open["via"]) => {
    const id = el.dataset.cite;
    if (!id) return;
    clearTimers();
    const prev = openRef.current;
    if (prev && prev.el !== el) prev.el.setAttribute("aria-expanded", "false");
    el.setAttribute("aria-expanded", "true");
    if (prev?.id !== id) setK(0);
    setOpen({ id, el, pinned: pinned || (prev?.id === id && prev.pinned), via });
  }, []);
  /** A citation the card gives the focus back to: its focus must not open the card again. */
  const quiet = useRef<HTMLElement | null>(null);
  const close = useCallback((returnFocus: boolean) => {
    clearTimers();
    const prev = openRef.current;
    if (!prev) return;
    prev.el.setAttribute("aria-expanded", "false");
    setOpen(null);
    if (returnFocus && prev.el.isConnected) {
      quiet.current = prev.el;
      prev.el.focus({ preventScroll: true });
    }
  }, []);
  const closeSoon = useCallback(() => {
    window.clearTimeout(timers.current.close);
    timers.current.close = window.setTimeout(() => {
      if (!openRef.current?.pinned) close(false);
    }, CLOSE_DELAY);
  }, [close]);

  // the citations are many buttons drawn by the pages: one set of listeners on the scrolling area serves them all
  useEffect(() => {
    const el = root.current;
    if (!el || disabled) return;
    const citeOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>(".pdfp-cite") : null);
    const over = (e: PointerEvent) => {
      const c = citeOf(e.target);
      if (!c || e.pointerType === "touch") return;
      window.clearTimeout(timers.current.close);
      if (openRef.current?.id === c.dataset.cite) return;
      window.clearTimeout(timers.current.open);
      timers.current.open = window.setTimeout(() => show(c, false, "hover"), openRef.current ? SWITCH_DELAY : OPEN_DELAY);
    };
    const out = (e: PointerEvent) => {
      const c = citeOf(e.target);
      if (!c || e.pointerType === "touch") return;
      const to = e.relatedTarget as Node | null;
      if (to && (c.contains(to) || card.current?.contains(to))) return;
      window.clearTimeout(timers.current.open);
      if (openRef.current && !openRef.current.pinned) closeSoon();
    };
    const down = (e: PointerEvent) => {
      lastPointer.current = e.pointerType;
    };
    const focusIn = (e: FocusEvent) => {
      const c = citeOf(e.target);
      if (c && quiet.current === c) return void (quiet.current = null);
      quiet.current = null;
      if (!c || !c.matches(":focus-visible")) return;
      show(c, false, "focus");
    };
    const focusOut = (e: FocusEvent) => {
      const c = citeOf(e.target);
      const to = e.relatedTarget as Node | null;
      if (!c || !openRef.current || openRef.current.pinned || (to && card.current?.contains(to))) return;
      if (!citeOf(to)) close(false);
    };
    const click = (e: MouseEvent) => {
      const c = citeOf(e.target);
      if (!c) return;
      e.preventDefault();
      const now = openRef.current;
      if (now && now.id === c.dataset.cite && now.pinned) return close(e.detail === 0);
      // a click from the keyboard (Enter or Space on the button) has no pointer: its card takes the focus
      show(c, true, e.detail === 0 ? "key" : lastPointer.current === "touch" ? "tap" : "click");
    };
    el.addEventListener("pointerover", over);
    el.addEventListener("pointerout", out);
    el.addEventListener("pointerdown", down);
    el.addEventListener("focusin", focusIn);
    el.addEventListener("focusout", focusOut);
    el.addEventListener("click", click);
    return () => {
      el.removeEventListener("pointerover", over);
      el.removeEventListener("pointerout", out);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("focusin", focusIn);
      el.removeEventListener("focusout", focusOut);
      el.removeEventListener("click", click);
    };
  }, [root, disabled, show, close, closeSoon]);

  // drawing started, the citation went (a zoom redraws the page), or the card's citation is no longer drawn: the card goes
  useEffect(() => {
    if (open && (disabled || !open.el.isConnected || !cites.has(open.id))) close(false);
  }, [open, disabled, cites, close]);
  useEffect(() => () => clearTimers(), []);

  const cite = open ? cites.get(open.id) : undefined;
  const entry = cite ? cite.entries[Math.min(k, cite.entries.length - 1)]! : -1;
  // the entry being looked at is checked next
  useEffect(() => {
    if (entry >= 0) bump(entry);
  }, [entry, bump]);
  // opened from the keyboard: the focus goes to the card's first control
  useEffect(() => {
    if (open?.via !== "key") return;
    const t = window.requestAnimationFrame(() => card.current?.querySelector<HTMLElement>("button, a[href]")?.focus());
    return () => window.cancelAnimationFrame(t);
  }, [open?.id, open?.via]);

  const item = entry >= 0 ? itemOf(entry) : undefined;
  const status = citeStatus(item, online);
  const rec = cardRecord(item);
  const retracted = item?.state === "done" && !!item.verdict?.retracted;
  const saved = !!rec && savedIds.has(rec.paper.id);
  const printed = entry >= 0 ? references[entry] ?? "" : "";

  return (
    <Popover.Root open={!!cite} onOpenChange={(o) => !o && close(false)}>
      <Popover.Anchor virtualRef={{ current: open?.el ?? null } as never} />
      {cite && (
        <Popover.Portal>
          <Popover.Content
            ref={card}
            className="cite-card"
            side="bottom"
            align="start"
            sideOffset={6}
            collisionPadding={12}
            aria-labelledby={titleId}
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => {
              e.preventDefault();
              const inside = card.current?.contains(document.activeElement) || document.activeElement === open?.el;
              close(!!inside || open?.via === "key" || open?.via === "focus");
            }}
            onPointerDownOutside={(e) => {
              // a press on a citation is handled by its click (it switches or closes the card)
              if ((e.target as Element | null)?.closest?.(".pdfp-cite")) e.preventDefault();
            }}
            onFocusOutside={(e) => {
              if ((e.target as Element | null)?.closest?.(".pdfp-cite")) e.preventDefault();
            }}
            onPointerEnter={() => window.clearTimeout(timers.current.close)}
            onPointerLeave={(e) => {
              if (e.pointerType !== "touch" && !open?.pinned) closeSoon();
            }}
            onKeyDown={(e) => {
              // Tab past the last control (or Shift+Tab before the first) leaves the card: the focus goes back to its citation
              if (e.key !== "Tab") return;
              const all = [...(card.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]") ?? [])];
              const atEnd = !e.shiftKey && document.activeElement === all[all.length - 1];
              const atStart = e.shiftKey && document.activeElement === all[0];
              if (atEnd || atStart) {
                e.preventDefault();
                close(true);
              }
            }}
          >
            <div className="cite-top">
              <Status status={status} />
              {retracted && (
                <span className="cite-retracted">
                  <ShieldMark /> Retracted
                </span>
              )}
              {cite.entries.length > 1 && (
                <span className="cite-pager">
                  <button type="button" className="icon-btn icon-btn-xs" aria-label="Previous reference" disabled={k === 0} onClick={() => setK((x) => Math.max(0, x - 1))}>
                    <ChevronLeft size={14} aria-hidden="true" />
                  </button>
                  <span aria-live="polite">
                    {k + 1} of {cite.entries.length}
                  </span>
                  <button type="button" className="icon-btn icon-btn-xs" aria-label="Next reference" disabled={k >= cite.entries.length - 1} onClick={() => setK((x) => Math.min(cite.entries.length - 1, x + 1))}>
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </span>
              )}
            </div>
            {rec ? (
              <>
                <h3 id={titleId} className="cite-title">
                  {rec.record.title}
                </h3>
                {metaLine(rec.record) && <p className="cite-meta">{metaLine(rec.record)}</p>}
                <div className="cite-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      close(false);
                      onAsk(rec.paper);
                    }}
                  >
                    Ask about it
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" aria-pressed={saved} onClick={() => onToggleSave(rec.paper)}>
                    {saved ? "Saved" : "Save to library"}
                  </button>
                  <a className="btn btn-ghost btn-sm" href={`https://doi.org/${rec.record.doi}`} target="_blank" rel="noreferrer noopener">
                    <span>Open</span>
                    <OutMark />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </div>
              </>
            ) : (
              <>
                <p id={titleId} className="cite-printed">
                  <span className="sr-only">Reference as printed in this paper: </span>
                  {printed.length > 220 ? `${printed.slice(0, 220).replace(/\s+\S*$/, "")} …` : printed}
                </p>
              </>
            )}
            <button
              type="button"
              className="link-btn cite-list"
              onClick={() => {
                close(false);
                onShowInList(entry);
              }}
            >
              Show in reference list
            </button>
          </Popover.Content>
        </Popover.Portal>
      )}
    </Popover.Root>
  );
}

/** The status at the top of the card. Verified is the word alone with a small green tick in a circle; the rest use the Reference Verifier's own words. */
function Status({ status }: { status: ReturnType<typeof citeStatus> }) {
  if (status === "verified")
    return (
      <span className="cite-status" data-tone="ok" title="Verified at Crossref and OpenAlex">
        <span className="cite-tick" aria-hidden="true">
          <TickMark />
        </span>
        Verified<span className="sr-only"> at Crossref and OpenAlex</span>
      </span>
    );
  if (status === "checking")
    return (
      <span className="cite-status" data-tone="muted">
        <Loader2 className="spin" size={13} aria-hidden="true" /> Checking…
      </span>
    );
  if (status === "offline")
    return (
      <span className="cite-status" data-tone="muted">
        <InfoMark /> Not checked (offline)
      </span>
    );
  return (
    <span className="cite-status" data-tone="muted" title={status === "not_found" ? NOT_FOUND_HELP : undefined}>
      <InfoMark /> {CITE_LABEL[status]}
    </span>
  );
}
