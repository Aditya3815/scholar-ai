import { Sparkles, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import type { Answer, Citation, DocNote, DocumentInfo, ScanInfo } from "@scholar/shared";
import { AskPanel } from "../AskPanel";
import "./agents.css";

/**
 * The Agents drawer of the new Paper Reader (docs/design/paper-reader.md, section 9.2), a chunk of its own ("agents"), fetched the first time the button is pressed.
 * Phase 1 has one agent, Ask: today's Ask panel moved in, with all of what it does. The others (Explain, Critique, Note-taker, Related) are not shown until they work.
 *
 *   wide:  a sheet from the right, 26rem, over the panel's side; NOT modal (role="complementary", labelled "Agents"): the paper stays usable. The focus moves in when it opens; Esc gives it back to the button.
 *   phone: a bottom sheet of 88 % of the height, modal (role="dialog"): the focus is kept inside, the page behind it is inert, a swipe down on its top closes it.
 *
 * It stays mounted once opened (hidden while closed), so a question being answered, and the answers from the highlights that live only in this visit, are not lost by closing it.
 */
export type AgentsDrawerProps = {
  open: boolean;
  wide: boolean;
  onClose: () => void;
  doc: DocumentInfo;
  history: Answer[];
  notes: DocNote[];
  scan: ScanInfo | null;
  onCite: (c: Citation) => void;
  onGoToPage: (page: number) => void;
  onReindex: () => void;
  reindexing: boolean;
  prefill: { text: string; tick: number };
  /** On a wide screen: where the sheet starts, in the window (below the paper's header while that is in sight, so the view switch and the theme stay reachable). */
  top?: number;
};

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function AgentsDrawer({ open, wide, onClose, doc, history, notes, scan, onCite, onGoToPage, onReindex, reindexing, prefill, top }: AgentsDrawerProps) {
  const box = useRef<HTMLElement>(null);
  const swipe = useRef<{ y: number; dy: number } | null>(null);
  const modal = open && !wide;

  // the focus goes in when it opens: to the question box when it can take a question, else to the first thing that can be pressed
  useLayoutEffect(() => {
    if (!open) return;
    const el = box.current;
    if (!el || el.contains(document.activeElement)) return;
    const input = el.querySelector<HTMLTextAreaElement>("#ask-input");
    (input && !input.disabled ? input : el.querySelector<HTMLElement>(FOCUSABLE))?.focus({ preventScroll: true });
  }, [open]);

  // the phone's sheet is modal: everything behind it is inert while it is open
  useEffect(() => {
    if (!modal) return;
    const root = document.getElementById("root");
    if (!root) return;
    root.inert = true;
    return () => {
      root.inert = false;
    };
  }, [modal]);

  const onKey = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      // the question box's own Esc stops an answer being written; a second Esc closes the drawer
      if ((e.target as HTMLElement).id === "ask-input" && box.current?.querySelector('.ask-send[data-busy="true"]')) return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !modal) return;
    const items = [...(box.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((x) => x.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // a swipe down on the sheet's top (the grab bar and the heading) closes it on a phone
  const down = (e: PointerEvent<HTMLElement>) => {
    if (wide || (e.target as HTMLElement).closest("button")) return;
    swipe.current = { y: e.clientY, dy: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const s = swipe.current;
    if (!s || !box.current) return;
    s.dy = Math.max(0, e.clientY - s.y);
    box.current.style.transform = `translateY(${s.dy}px)`;
  };
  const up = () => {
    const s = swipe.current;
    swipe.current = null;
    if (!s || !box.current) return;
    box.current.style.transform = "";
    if (s.dy > 80) onClose();
  };

  return createPortal(
    <>
      {modal && <div className="desk-sheet-backdrop" aria-hidden="true" onClick={onClose} />}
      <section
        ref={box}
        id="desk-agents"
        className="desk-agents"
        data-wide={wide}
        hidden={!open}
        role={wide ? "complementary" : "dialog"}
        aria-modal={modal ? true : undefined}
        aria-label="Agents"
        style={wide && top !== undefined ? { top } : undefined}
        onKeyDown={onKey}
      >
        <header className="desk-agents-head" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          {!wide && <span className="desk-grab" aria-hidden="true" />}
          <div className="desk-agents-title">
            <h2>
              <Sparkles size={16} aria-hidden="true" /> Agents
            </h2>
            <button type="button" className="icon-btn icon-btn-sm desk-agents-x" aria-label="Close the agents" title="Close (Esc)" onClick={onClose}>
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <p className="desk-agents-pick">
            <span className="desk-agent-chip" data-on="true">Ask</span>
            <span className="desk-agents-what">Questions about this paper, or about your highlights.</span>
          </p>
        </header>
        <div className="desk-agents-body">
          <AskPanel doc={doc} history={history} notes={notes} scan={scan} onCite={onCite} onGoToPage={onGoToPage} onReindex={onReindex} prefill={prefill} />
          {reindexing && (
            <p className="ask-fine" role="status">
              Indexing again…
            </p>
          )}
        </div>
        <p className="desk-agents-fine">Answers cite pages. Check the passage before you rely on an answer.</p>
      </section>
    </>,
    document.body,
  );
}
