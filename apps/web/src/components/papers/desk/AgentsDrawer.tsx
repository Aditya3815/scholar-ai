import { Sparkles, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { READER_AGENTS, READER_AGENT_LABEL, answerMarkdown, citedPages, type Answer, type Citation, type DocNote, type DocumentInfo, type NotesDraft, type ReaderAgent, type ScanInfo } from "@scholar/shared";
import { AskPanel } from "../AskPanel";
import { CritiqueView, ExplainView, NotesView, type AgentNote, type ExplainRequest, type MeaningNames } from "./AgentViews";
import "./agents.css";

/**
 * The Agents drawer of the new Paper Reader (docs/design/paper-reader.md, sections 9.2 and 23), a chunk of its own ("agents"), fetched the first time the button is pressed.
 * Its agents: Ask (today's Ask panel), Explain, Critique and the Note-taker (Related comes with phase 4). Top to bottom: the agent chips, one line saying what the chosen agent does, its view
 * (prompt chips, conversation, the selection Explain is given, the question box), and the standing line about pages.
 *
 *   wide:  a sheet from the right, 26rem, over the panel's side; NOT modal (role="complementary", labelled "Agents"): the paper stays usable. The focus moves in when it opens; Esc gives it back to the button.
 *   phone: a bottom sheet of 88 % of the height, modal (role="dialog"): the focus is kept inside, the page behind it is inert, a swipe down on its top closes it.
 *
 * It stays mounted once opened (hidden while closed), and so does each agent's view once chosen, so an answer being written, and the answers that live only in this visit, are not lost by closing
 * it or by choosing another agent.
 * Roles (docs/design/paper-share.md): a Viewer has no drawer; a Commenter has Ask, Explain and Critique; the Note-taker and "+ Add to notes" need the notes to be theirs to write (`canWrite`).
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
  /** The agent shown, and choosing another (the reader holds it: Explain from the pop-up opens the drawer on Explain). */
  agent: ReaderAgent;
  onAgent: (a: ReaderAgent) => void;
  /** Explain from the pop-up: the selection and its page (each new `tick` explains it). */
  explain: ExplainRequest | null;
  /** The notes can be written (the owner, an Editor): the Note-taker and "+ Add to notes" are offered. */
  canWrite: boolean;
  /** "+ Add to notes": an agent's answer onto the open page; true once it is there. */
  onAddToNotes: (n: AgentNote) => Promise<boolean>;
  /** "Add as a new page": the Note-taker's draft; the page's title once it is made, or null. */
  onAcceptDraft: (d: NotesDraft) => Promise<string | null>;
  /** The meanings' names and letters (handed in, so this chunk does not import them). */
  meanings: MeaningNames;
  /** On a wide screen: where the sheet starts, in the window (below the paper's header while that is in sight, so the view switch and the theme stay reachable). */
  top?: number;
};

const WHAT: Record<ReaderAgent, string> = {
  ask: "Questions about this paper, or about your highlights.",
  explain: "Explains a passage you select, or an idea you name, in plain words.",
  critique: "Looks for weak points: thin evidence, missing baselines, claims larger than the results, limitations.",
  notes: "Turns your highlights and their notes into a draft page of notes.",
};

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function AgentsDrawer({ open, wide, onClose, doc, history, notes, scan, onCite, onGoToPage, onReindex, reindexing, agent, onAgent, explain, canWrite, onAddToNotes, onAcceptDraft, meanings, top }: AgentsDrawerProps) {
  const box = useRef<HTMLElement>(null);
  const swipe = useRef<{ y: number; dy: number } | null>(null);
  const modal = open && !wide;
  const agents = READER_AGENTS.filter((a) => a !== "notes" || canWrite);
  const shown = agents.includes(agent) ? agent : "ask";
  // a view is made the first time it is chosen, and kept
  const [made, setMade] = useState<Set<ReaderAgent>>(() => new Set([shown]));
  useEffect(() => setMade((s) => (s.has(shown) ? s : new Set(s).add(shown))), [shown]);

  // the focus goes in when it opens (and when Explain is asked from the pop-up): to the shown agent's question box when it can take one, else to the first thing that can be pressed
  useLayoutEffect(() => {
    if (!open) return;
    const el = box.current;
    if (!el || el.contains(document.activeElement)) return;
    const input = el.querySelector<HTMLTextAreaElement>(".desk-agent-view:not([hidden]) textarea");
    (input && !input.disabled ? input : el.querySelector<HTMLElement>(FOCUSABLE))?.focus({ preventScroll: true });
  }, [open, explain?.tick, made]);

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
      // a question box's own Esc stops an answer being written; a second Esc closes the drawer
      if ((e.target as HTMLElement).closest("form")?.querySelector('.ask-send[data-busy="true"]')) return;
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

  // the agent chips are a radio group: the arrows move the choice
  const onChipKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = agents[(agents.indexOf(shown) + step + agents.length) % agents.length]!;
    onAgent(next);
    box.current?.querySelector<HTMLButtonElement>(`[data-agent-chip="${next}"]`)?.focus();
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

  const addAsk = canWrite ? (a: Answer) => onAddToNotes({ agent: "ask", ask: a.question.slice(0, 600), md: answerMarkdown(a.answer, a.citations), pages: citedPages(a.citations) }) : undefined;
  const add = canWrite ? onAddToNotes : undefined;

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
          <div className="desk-agents-pick" role="radiogroup" aria-label="Agent" onKeyDown={onChipKey}>
            {agents.map((a) => (
              <button key={a} type="button" role="radio" aria-checked={shown === a} tabIndex={shown === a ? 0 : -1} className="desk-agent-chip" data-on={shown === a} data-agent-chip={a} onClick={() => onAgent(a)}>
                {READER_AGENT_LABEL[a]}
              </button>
            ))}
          </div>
          <p className="desk-agents-what">{WHAT[shown]}</p>
        </header>
        <div className="desk-agents-body">
          {made.has("ask") && (
            <div className="desk-agent-view" hidden={shown !== "ask"}>
              <AskPanel doc={doc} history={history} notes={notes} scan={scan} onCite={onCite} onGoToPage={onGoToPage} onReindex={onReindex} onAddToNotes={addAsk} embedded />
            </div>
          )}
          {made.has("explain") && (
            <div className="desk-agent-view" hidden={shown !== "explain"}>
              <ExplainView doc={doc} request={explain} onCite={onCite} onGoToPage={onGoToPage} onReindex={onReindex} onAdd={add} />
            </div>
          )}
          {made.has("critique") && (
            <div className="desk-agent-view" hidden={shown !== "critique"}>
              <CritiqueView doc={doc} onCite={onCite} onGoToPage={onGoToPage} onReindex={onReindex} onAdd={add} />
            </div>
          )}
          {made.has("notes") && canWrite && (
            <div className="desk-agent-view" hidden={shown !== "notes"}>
              <NotesView doc={doc} notes={notes} meanings={meanings} onReindex={onReindex} onAccept={onAcceptDraft} />
            </div>
          )}
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
