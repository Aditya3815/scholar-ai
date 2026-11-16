import { m } from "motion/react";
import { ArrowUp, CornerDownRight, Loader2, RefreshCw, SearchX, ShieldCheck, Square, TriangleAlert, X } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  CRITIQUE_KIND_LABEL,
  CRITIQUE_POINT_LABEL,
  MAX_QUESTION_CHARS,
  answerMarkdown,
  citedPages,
  critiqueMarkdown,
  type Answer,
  type AskStreamEvent,
  type Citation,
  type Critique,
  type DocNote,
  type DocumentInfo,
  type NoteColor,
  type NotebookAgent,
  type NotesDraft,
} from "@scholar/shared";
import { ApiError } from "../../../lib/api/client";
import { askAgentStream, draftNotes, type AgentAsk } from "../../../lib/agents-api";
import { useGrowingField } from "../../../lib/autogrow";
import { useLegend } from "../../../lib/legend";
import { easeOut } from "../../../lib/motion";
import { AddToNotes, AnswerText, LiveAnswer, STEPS, type Live } from "../AskPanel";

/**
 * The agents of the drawer besides Ask (docs/design/paper-reader.md, 9.3 and 23): Explain, Critique and the Note-taker, each a view of its own with its prompt chips, its conversation (kept for
 * this visit, never saved), and, for Explain, the selection it explains. They live in the drawer's chunk ("agents"). Each says what it is doing in a polite live region (the stages and the
 * result, never the words as they arrive), and each answer can be added to the notes when the person can write them.
 */

/** What an answer kept in the notes is made of (the drawer adds the time and the block's id). */
export type AgentNote = { agent: NotebookAgent; ask: string; md: string; pages: number[] };
export type MeaningNames = Record<NoteColor, { name: string; letter: string }>;

const errorText = (e: unknown) => {
  if (e instanceof DOMException && e.name === "AbortError") return "Stopped. Ask again whenever you like.";
  if (e instanceof ApiError) return e.status === 429 ? "You have used today's AI allowance. It comes back tomorrow." : e.message;
  return "The connection was lost. Please try again.";
};

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** The line a view shows when the paper cannot be read by an agent yet (no index). */
export function NoIndex({ doc, what, onReindex }: { doc: DocumentInfo; what: string; onReindex: () => void }) {
  return (
    <div className="agent-noindex" role="note">
      <p>
        <TriangleAlert size={15} aria-hidden="true" /> This paper has no index yet, so {what} cannot read it. {doc.status === "failed" ? doc.error ?? "Indexing failed." : doc.scanned ? "Its scanned pages are still being read." : "It is still being indexed."}
      </p>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onReindex}>
        <RefreshCw size={15} aria-hidden="true" />
        <span>{doc.scanned ? "Continue reading" : "Index again"}</span>
      </button>
    </div>
  );
}

/** The question box of a view: a growing field, Enter sends, Esc (while working) stops; the button is Send or Stop. */
function AskBox({ id, label, placeholder, value, onChange, onSend, onStop, busy, disabled, canSendEmpty = false, children }: { id: string; label: string; placeholder: string; value: string; onChange: (s: string) => void; onSend: () => void; onStop: () => void; busy: boolean; disabled: boolean; canSendEmpty?: boolean; children?: ReactNode }) {
  const input = useRef<HTMLTextAreaElement>(null);
  useGrowingField(input, value, 150);
  const can = canSendEmpty || value.trim().length >= 3;
  return (
    <form
      className="ask-form agent-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (busy) onStop();
        else if (can) onSend();
      }}
    >
      {children}
      <label className="sr-only" htmlFor={id}>{label}</label>
      <textarea
        id={id}
        ref={input}
        rows={1}
        value={value}
        maxLength={MAX_QUESTION_CHARS}
        disabled={disabled}
        placeholder={placeholder}
        data-agent-input
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (!busy && can) onSend();
          }
          if (e.key === "Escape" && busy) onStop();
        }}
      />
      <button type="submit" className="ask-send" data-busy={busy} aria-label={busy ? "Stop" : "Send"} disabled={disabled || (!busy && !can)}>
        {busy ? <Square size={15} fill="currentColor" aria-hidden="true" /> : <ArrowUp size={18} aria-hidden="true" />}
      </button>
    </form>
  );
}

/** The prompt chips of a view, shown while its conversation is empty. */
function Chips({ items, onPick, disabled, row = false }: { items: { label: string; run: () => void }[]; onPick?: () => void; disabled?: boolean; /** under a conversation: one line that scrolls sideways */ row?: boolean }) {
  return (
    <ul className="ask-suggest agent-chips" data-row={row || undefined} aria-label="Suggestions">
      {items.map((c, i) => (
        <m.li key={c.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: easeOut, delay: 0.05 + i * 0.05 }}>
          <button type="button" className="chip-btn ask-chip" disabled={disabled} onClick={() => (onPick?.(), c.run())}>
            {c.label}
          </button>
        </m.li>
      ))}
    </ul>
  );
}

/** Follows the newest turn, unless the reader scrolled up to read an earlier one. */
function useStick(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, [dep]);
  const onScroll = () => {
    const el = ref.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  return { ref, onScroll, follow: () => (stick.current = true) };
}

/** Runs one streamed agent request, reporting the stages, the pages, the text (painted once a frame) and the end; returns what it ended with. */
function useAgentRun(docId: string, setAnnounce: (s: string) => void) {
  const abort = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => abort.current?.abort(), []);
  const run = async (ask: AgentAsk, onLive: (change: (l: Live) => Live) => void) => {
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    let pending = "";
    let raf = 0;
    const flush = () => {
      raf = 0;
      const add = pending;
      pending = "";
      if (add) onLive((l) => ({ ...l, text: l.text + add }));
    };
    try {
      return await askAgentStream(
        docId,
        ask,
        (e: AskStreamEvent) => {
          if (e.type === "stage") {
            onLive((l) => ({ ...l, stage: e.stage }));
            setAnnounce(STEPS.find((s) => s.id === e.stage)?.say ?? "");
          } else if (e.type === "sources") onLive((l) => ({ ...l, pages: e.pages }));
          else if (e.type === "delta") {
            pending += e.text;
            if (!raf) raf = requestAnimationFrame(flush);
          }
        },
        ctl.signal,
      );
    } finally {
      if (raf) cancelAnimationFrame(raf);
      abort.current = null;
      setBusy(false);
    }
  };
  return { run, busy, stop: () => abort.current?.abort() };
}

/* ---------------------------------------------------------------- Explain */

type ExplainTurn = { key: string; selection: string; page: number | null; idea: string; live?: Live; answer?: Answer; error?: string };
const START: Live = { stage: "retrieving", pages: [], text: "" };

export type ExplainRequest = { selection: string; page: number; tick: number };

export function ExplainView({ doc, request, onCite, onGoToPage, onReindex, onAdd }: { doc: DocumentInfo; request: ExplainRequest | null; onCite: (c: Citation) => void; onGoToPage: (page: number) => void; onReindex: () => void; onAdd?: (n: AgentNote) => Promise<boolean> }) {
  const [turns, setTurns] = useState<ExplainTurn[]>([]);
  const [sel, setSel] = useState<{ text: string; page: number } | null>(null);
  const [q, setQ] = useState("");
  const [announce, setAnnounce] = useState("");
  const { run, busy, stop } = useAgentRun(doc.id, setAnnounce);
  const scroll = useStick(turns);
  const ready = doc.status === "ready";

  const patch = (key: string, change: (t: ExplainTurn) => ExplainTurn) => setTurns((all) => all.map((t) => (t.key === key ? change(t) : t)));
  async function explain(selection: string, page: number | null, idea: string, retryKey?: string) {
    if (busy || !ready) return;
    const key = retryKey ?? `e-${Date.now()}`;
    scroll.follow();
    setQ("");
    setTurns((all) => (retryKey ? all.map((t) => (t.key === key ? { ...t, error: undefined, live: START } : t)) : [...all, { key, selection, page, idea, live: START }]));
    try {
      const r = await run({ mode: "explain", selection, page, question: idea }, (change) => patch(key, (t) => (t.live ? { ...t, live: change(t.live) } : t)));
      if (!("answer" in r)) throw new TypeError("The answer was cut off. Please try again.");
      const a = r.answer;
      patch(key, (t) => ({ ...t, live: undefined, answer: a }));
      setAnnounce(!a.found ? "The paper does not explain this." : a.verified ? "Explained. Every source was checked against the paper." : "Explained, but a source could not be verified.");
    } catch (e) {
      const message = errorText(e);
      patch(key, (t) => ({ ...t, live: undefined, error: message }));
      setAnnounce(message);
    }
  }

  // Explain from the pop-up: the selection becomes this view's chip and the question box is ready; nothing is asked until the person presses Send (the owner's choice, 20 Nov 2026)
  useEffect(() => {
    if (!request || request.tick === 0) return;
    setSel({ text: request.selection, page: request.page });
    setAnnounce(`The selection from page ${request.page} is ready to explain. Press Send, or ask something about it.`);
  }, [request?.tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const chips = sel
    ? [
        { label: "Explain this in simpler words", run: () => void explain(sel.text, sel.page, "Explain it in even simpler words.") },
        { label: "Give an example from the paper", run: () => void explain(sel.text, sel.page, "Give an example of it from this paper.") },
        { label: "Why does it matter here?", run: () => void explain(sel.text, sel.page, "Why does it matter in this paper?") },
      ]
    : [
        { label: "Explain the main idea", run: () => void explain("", null, "the main idea of this paper") },
        { label: "Explain the method", run: () => void explain("", null, "the method this paper uses") },
        { label: "Explain the main result", run: () => void explain("", null, "the main result of this paper") },
      ];

  if (!ready) return <NoIndex doc={doc} what="Explain" onReindex={onReindex} />;
  return (
    <div className="agent-view" data-agent="explain">
      <div ref={scroll.ref} className="ask-scroll" onScroll={scroll.onScroll}>
        {turns.length === 0 && (
          <div className="ask-empty agent-empty">
            <p className="agent-empty-hint">{sel ? "Explain the selection, or ask something about it." : "Select a passage in the paper and choose Explain, or name an idea below."}</p>
            <Chips items={chips} disabled={busy} />
          </div>
        )}
        <ol className="ask-turns">
          {turns.map((t) => (
            <Fragment key={t.key}>
              <li className="ask-q agent-q">
                {t.selection ? (
                  <>
                    <span className="agent-q-kind">Explain{t.page ? ` · p. ${t.page}` : ""}</span> “{clip(t.selection, 220)}”{t.idea ? <span className="agent-q-idea">{t.idea}</span> : null}
                  </>
                ) : (
                  <>
                    <span className="agent-q-kind">Explain</span> {t.idea}
                  </>
                )}
              </li>
              <li className="ask-a">
                {t.answer ? (
                  <ExplainAnswer answer={t.answer} onCite={onCite} onAdd={onAdd ? () => onAdd({ agent: "explain", ask: (t.selection || t.idea).slice(0, 600), md: answerMarkdown(t.answer!.answer, t.answer!.citations), pages: citedPages(t.answer!.citations) }) : undefined} />
                ) : t.error ? (
                  <div className="ask-error" role="alert">
                    <TriangleAlert size={16} aria-hidden="true" />
                    <span>{t.error}</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void explain(t.selection, t.page, t.idea, t.key)} disabled={busy}>
                      <RefreshCw size={14} aria-hidden="true" />
                      <span>Try again</span>
                    </button>
                  </div>
                ) : t.live ? (
                  <LiveAnswer live={t.live} onPage={onGoToPage} />
                ) : null}
              </li>
            </Fragment>
          ))}
        </ol>
        <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      </div>
      {turns.length > 0 && <Chips items={chips} disabled={busy} row />}
      <AskBox
        id="agent-input-explain"
        label={sel ? "Ask something about the selection, or send to explain it" : "Name an idea of this paper to explain"}
        placeholder={sel ? "Ask about the selection, or press Enter to explain it…" : "Name an idea to explain, e.g. “the loss function”…"}
        value={q}
        onChange={setQ}
        onSend={() => void explain(sel?.text ?? "", sel?.page ?? null, q.trim())}
        onStop={stop}
        busy={busy}
        disabled={!ready}
        canSendEmpty={!!sel}
      >
        {sel && (
          <p className="agent-sel">
            <span className="agent-sel-label">
              <span className="agent-sel-word">Selection</span>
              {sel.page ? ` · p. ${sel.page}` : ""}
            </span>
            <span className="agent-sel-text">“{clip(sel.text, 120)}”</span>
            <button type="button" className="icon-btn icon-btn-sm agent-sel-x" aria-label="Take the selection away" title="Take the selection away" onClick={() => setSel(null)}>
              <X size={14} aria-hidden="true" />
            </button>
          </p>
        )}
      </AskBox>
    </div>
  );
}

function ExplainAnswer({ answer, onCite, onAdd }: { answer: Answer; onCite: (c: Citation) => void; onAdd?: () => Promise<boolean> }) {
  const tone = !answer.found ? "muted" : answer.verified ? "ok" : "warn";
  return (
    <m.div className="ask-answer" data-tone={tone} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
      <div className="ask-answer-head">
        <span className="ask-status" data-tone={tone}>
          {!answer.found ? <SearchX size={15} aria-hidden="true" /> : answer.verified ? <ShieldCheck size={15} aria-hidden="true" /> : <TriangleAlert size={15} aria-hidden="true" />}
          {!answer.found ? "The paper does not explain this" : answer.verified ? "Every source checked against the paper" : "Could not verify the source"}
        </span>
        <span className="ask-tools">{answer.found && onAdd && <AddToNotes onAdd={onAdd} what="this explanation" />}</span>
      </div>
      <AnswerText text={answer.answer} citations={answer.citations} onCite={onCite} />
      {answer.found && !answer.verified && (
        <p className="ask-warn" role="note">
          <TriangleAlert size={15} aria-hidden="true" />
          <span>The quoted evidence was not found in the paper. Treat this explanation with care and check the paper yourself.</span>
        </p>
      )}
      {answer.citations.length > 0 && (
        <ul className="ask-sources" aria-label="Sources in the paper">
          {answer.citations.map((c) => (
            <li key={c.n}>
              <button type="button" className="ask-source" onClick={() => onCite(c)}>
                <span className="ask-source-page">p. {c.page}</span>
                <span className="ask-source-quote">“{c.quote}”</span>
                <CornerDownRight className="ask-source-go" size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </m.div>
  );
}

/* ---------------------------------------------------------------- Critique */

type CritiqueTurn = { key: string; focus: string; live?: Live; critique?: Critique; error?: string };

export function CritiqueView({ doc, onCite, onGoToPage, onReindex, onAdd }: { doc: DocumentInfo; onCite: (c: Citation) => void; onGoToPage: (page: number) => void; onReindex: () => void; onAdd?: (n: AgentNote) => Promise<boolean> }) {
  const [turns, setTurns] = useState<CritiqueTurn[]>([]);
  const [q, setQ] = useState("");
  const [announce, setAnnounce] = useState("");
  const { run, busy, stop } = useAgentRun(doc.id, setAnnounce);
  const scroll = useStick(turns);
  const ready = doc.status === "ready";
  const patch = (key: string, change: (t: CritiqueTurn) => CritiqueTurn) => setTurns((all) => all.map((t) => (t.key === key ? change(t) : t)));

  async function critique(focus: string, retryKey?: string) {
    if (busy || !ready) return;
    const key = retryKey ?? `c-${Date.now()}`;
    scroll.follow();
    setQ("");
    setTurns((all) => (retryKey ? all.map((t) => (t.key === key ? { ...t, error: undefined, live: START } : t)) : [...all, { key, focus, live: START }]));
    try {
      const r = await run({ mode: "critique", question: focus }, (change) => patch(key, (t) => (t.live ? { ...t, live: change(t.live) } : t)));
      if (!("critique" in r)) throw new TypeError("The critique was cut off. Please try again.");
      const c = r.critique;
      patch(key, (t) => ({ ...t, live: undefined, critique: c }));
      setAnnounce(c.points.length ? `${c.points.length} ${c.points.length === 1 ? "point" : "points"}, each with a passage checked against the paper.` : "No weak point with a checked passage was found.");
    } catch (e) {
      const message = errorText(e);
      patch(key, (t) => ({ ...t, live: undefined, error: message }));
      setAnnounce(message);
    }
  }

  const chips = [
    { label: "Critique the whole paper", run: () => void critique("") },
    { label: "Critique the methods", run: () => void critique("the methods and the data") },
    { label: "Critique the results and claims", run: () => void critique("the results and the claims made from them") },
    { label: "Critique the evaluation", run: () => void critique("the evaluation, its baselines and comparisons") },
  ];

  if (!ready) return <NoIndex doc={doc} what="Critique" onReindex={onReindex} />;
  return (
    <div className="agent-view" data-agent="critique">
      <div ref={scroll.ref} className="ask-scroll" onScroll={scroll.onScroll}>
        {turns.length === 0 && (
          <div className="ask-empty agent-empty">
            <p className="agent-empty-hint">Each point quotes the passage it is about. A point is a reading of the paper, not a fact: check it against the passage.</p>
            <Chips items={chips} disabled={busy} />
          </div>
        )}
        <ol className="ask-turns">
          {turns.map((t) => (
            <Fragment key={t.key}>
              <li className="ask-q agent-q">
                <span className="agent-q-kind">Critique</span> {t.focus || "the whole paper"}
              </li>
              <li className="ask-a">
                {t.critique ? (
                  <CritiqueCard c={t.critique} onCite={onCite} onAdd={onAdd ? () => onAdd({ agent: "critique", ask: t.focus, md: critiqueMarkdown(t.critique!), pages: [...new Set(t.critique!.points.map((p) => p.page))].sort((a, b) => a - b) }) : undefined} />
                ) : t.error ? (
                  <div className="ask-error" role="alert">
                    <TriangleAlert size={16} aria-hidden="true" />
                    <span>{t.error}</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void critique(t.focus, t.key)} disabled={busy}>
                      <RefreshCw size={14} aria-hidden="true" />
                      <span>Try again</span>
                    </button>
                  </div>
                ) : t.live ? (
                  <LiveAnswer live={t.live} onPage={onGoToPage} />
                ) : null}
              </li>
            </Fragment>
          ))}
        </ol>
        <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      </div>
      {turns.length > 0 && <Chips items={chips} disabled={busy} row />}
      <AskBox id="agent-input-critique" label="A part of the paper to critique (optional)" placeholder="Name a part to critique, or press Enter for the whole paper…" value={q} onChange={setQ} onSend={() => void critique(q.trim())} onStop={stop} busy={busy} disabled={!ready} canSendEmpty />
    </div>
  );
}

function CritiqueCard({ c, onCite, onAdd }: { c: Critique; onCite: (c: Citation) => void; onAdd?: () => Promise<boolean> }) {
  return (
    <m.div className="ask-answer crit" data-tone={c.points.length ? "ok" : "muted"} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
      <div className="ask-answer-head">
        <span className="ask-status" data-tone={c.points.length ? "ok" : "muted"}>
          {c.points.length ? <ShieldCheck size={15} aria-hidden="true" /> : <SearchX size={15} aria-hidden="true" />}
          {c.points.length ? `${c.points.length} ${c.points.length === 1 ? "point" : "points"}, each passage checked against the paper` : "No point with a checked passage"}
        </span>
        <span className="ask-tools">{c.points.length > 0 && onAdd && <AddToNotes onAdd={onAdd} what="this critique" />}</span>
      </div>
      {c.points.length > 0 ? (
        <ol className="crit-points">
          {c.points.map((p, i) => (
            <li key={i} className="crit-point" data-kind={p.kind}>
              <p className="crit-head">
                <b>{CRITIQUE_KIND_LABEL[p.kind]}</b>
                <span className="crit-label">{CRITIQUE_POINT_LABEL}</span>
              </p>
              <p className="crit-text">{p.text}</p>
              <button type="button" className="ask-source crit-quote" onClick={() => onCite({ n: i + 1, page: p.page, idx: p.idx, quote: p.quote, ...(p.section ? { section: p.section } : {}) })} aria-label={`The passage on page ${p.page}: ${p.quote}. Show it in the paper`}>
                <span className="ask-source-page">p. {p.page}</span>
                <span className="ask-source-quote">“{p.quote}”</span>
                <CornerDownRight className="ask-source-go" size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="reading ask-text">The passages read show no weak point that could be tied to a quote of the paper. Try a narrower part, such as the methods.</p>
      )}
      {c.dropped > 0 && (
        <p className="ask-hint crit-dropped">
          {c.dropped} {c.dropped === 1 ? "point was" : "points were"} left out: {c.dropped === 1 ? "its quote was" : "their quotes were"} not found in the paper.
        </p>
      )}
    </m.div>
  );
}

/* ---------------------------------------------------------------- the Note-taker */

export function NotesView({ doc, notes, meanings, onReindex, onAccept }: { doc: DocumentInfo; notes: DocNote[]; meanings: MeaningNames; onReindex: () => void; onAccept: (d: NotesDraft) => Promise<string | null> }) {
  const legend = useLegend();
  const [state, setState] = useState<{ status: "idle" | "working" | "draft" | "added" | "error"; draft?: NotesDraft; used?: number; total?: number; dropped?: number; error?: string; title?: string }>({ status: "idle" });
  const [announce, setAnnounce] = useState("");
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const ready = doc.status === "ready";

  async function draft() {
    const ctl = new AbortController();
    abort.current = ctl;
    setState({ status: "working" });
    setAnnounce("Reading your highlights");
    try {
      const r = await draftNotes(doc.id, legend, ctl.signal);
      setState({ status: "draft", draft: r.draft, used: r.used, total: r.total, dropped: r.dropped });
      setAnnounce("A draft page is ready. Add it as a new page, or discard it.");
    } catch (e) {
      const message = errorText(e);
      setState({ status: "error", error: message });
      setAnnounce(message);
    } finally {
      abort.current = null;
    }
  }

  if (!ready) return <NoIndex doc={doc} what="the Note-taker" onReindex={onReindex} />;
  return (
    <div className="agent-view" data-agent="notes">
      <div className="ask-scroll">
        {notes.length === 0 ? (
          <p className="agent-empty-hint">You have not highlighted anything in this paper yet. Select text in the paper to highlight it, then come back: the Note-taker makes a page of notes from your highlights.</p>
        ) : state.status === "idle" || state.status === "error" ? (
          <div className="ask-empty agent-empty">
            <p className="agent-empty-hint">
              It reads your {notes.length} {notes.length === 1 ? "highlight" : "highlights"} and their notes, and writes a draft page: headings by meaning, bullets that keep their pages. Nothing is kept until you add it.
            </p>
            <Chips items={[{ label: `Draft a page from my ${notes.length === 1 ? "highlight" : `${notes.length} highlights`}`, run: () => void draft() }]} />
            {state.status === "error" && (
              <div className="ask-error" role="alert">
                <TriangleAlert size={16} aria-hidden="true" />
                <span>{state.error}</span>
              </div>
            )}
          </div>
        ) : state.status === "working" ? (
          <p className="ask-from" aria-busy="true">
            <Loader2 className="spin" size={14} aria-hidden="true" /> Reading your highlights…{" "}
            <button type="button" className="link-btn" onClick={() => abort.current?.abort()}>Stop</button>
          </p>
        ) : state.status === "added" ? (
          <div className="ask-empty agent-empty">
            <p className="agent-empty-hint">
              <ShieldCheck size={15} aria-hidden="true" /> Added as a new page, “{state.title}”, in your notes.
            </p>
            <Chips items={[{ label: "Draft another page", run: () => void draft() }]} />
          </div>
        ) : state.draft ? (
          <section className="nt-draft" aria-label="Draft page">
            <p className="nt-draft-kicker">Draft · not saved yet</p>
            <h3 className="nt-draft-title">{state.draft.title}</h3>
            <DraftBlocks draft={state.draft} meanings={meanings} />
            <p className="ask-hint">
              From {state.used === state.total ? `your ${state.total} ${state.total === 1 ? "highlight" : "highlights"}` : `the ${state.used} highlights that fit, of ${state.total}`}
              {state.dropped ? `; ${state.dropped} ${state.dropped === 1 ? "line" : "lines"} that named no highlight ${state.dropped === 1 ? "was" : "were"} left out` : ""}.
            </p>
            <div className="nt-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  const d = state.draft!;
                  void onAccept(d).then((title) => {
                    if (!title) return;
                    setState({ status: "added", title });
                    setAnnounce(`Added as a new page, ${title}.`);
                  });
                }}
              >
                Add as a new page
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setState({ status: "idle" });
                  setAnnounce("The draft was discarded.");
                }}
              >
                Discard
              </button>
            </div>
          </section>
        ) : null}
        <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      </div>
    </div>
  );
}

/** The draft drawn as it will be: its headings, bullets with their pages, and the highlights it quotes (their meaning by name and letter, never by colour alone). */
function DraftBlocks({ draft, meanings }: { draft: NotesDraft; meanings: MeaningNames }) {
  return (
    <div className="nt-blocks">
      {draft.blocks.map((b) =>
        b.kind === "quote" ? (
          <figure key={b.id} className="nb-quote" data-color={b.color} aria-label={`${meanings[b.color].name}, page ${b.page}`}>
            <span aria-hidden="true">
              <span className="desk-dot" data-color={b.color}>{meanings[b.color].letter}</span>
            </span>
            <blockquote>“{b.quote}”</blockquote>
            <figcaption>
              <b>{meanings[b.color].name}</b> · p. {b.page}
            </figcaption>
          </figure>
        ) : (
          <div key={b.id} className="nt-text">
            {draftLines(b.md)}
          </div>
        ),
      )}
    </div>
  );
}

/** A draft's text block is made by the draft builder: "## Heading" lines and "- bullet" lines. */
function draftLines(md: string): ReactNode[] {
  const out: ReactNode[] = [];
  let items: string[] = [];
  const flush = () => {
    if (items.length) out.push(<ul key={`u${out.length}`}>{items.map((t, i) => <li key={i}>{t}</li>)}</ul>);
    items = [];
  };
  for (const line of md.split("\n")) {
    if (line.startsWith("## ")) {
      flush();
      out.push(<h4 key={`h${out.length}`}>{line.slice(3)}</h4>);
    } else if (line.startsWith("- ")) items.push(line.slice(2));
    else if (line.trim()) {
      flush();
      out.push(<p key={`p${out.length}`}>{line}</p>);
    }
  }
  flush();
  return out;
}
