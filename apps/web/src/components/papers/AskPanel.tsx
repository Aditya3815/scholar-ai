import { AnimatePresence, m } from "motion/react";
import { ArrowUp, BadgeCheck, Check, Copy, CornerDownRight, Loader2, RefreshCw, SearchX, ShieldCheck, Sparkles, Square, TriangleAlert } from "lucide-react";
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MAX_QUESTION_CHARS, type Answer, type AskStage, type Citation, type DocumentInfo } from "@scholar/shared";
import { ApiError, askDocumentStream } from "../../lib/documents";
import { easeOut, spring, springPop } from "../../lib/motion";
import { CountUp } from "../ResultCard";

const SUGGESTIONS = [
  "Summarise this paper in a few sentences",
  "What research question does it ask?",
  "What methods or data were used?",
  "What are the main findings?",
  "What limitations do the authors mention?",
];

/** Where an answer is while it is being produced. `text` is provisional until the checked answer arrives. */
type Live = { stage: AskStage; pages: number[]; text: string };
type Turn = { key: string; question: string; answer?: Answer; error?: string; live?: Live };

const STEPS: { id: AskStage; label: string; say: string }[] = [
  { id: "retrieving", label: "Find", say: "Finding the right passages" },
  { id: "thinking", label: "Think", say: "Thinking it through" },
  { id: "writing", label: "Write", say: "Writing the answer" },
  { id: "checking", label: "Check", say: "Checking every source against the paper" },
];
const stepIndex = (s: AskStage) => STEPS.findIndex((x) => x.id === s);

/** "[1]" and "[2][3]" in a finished answer become buttons that jump to (and highlight) the quoted passage in the PDF. */
function AnswerText({ text, citations, onCite }: { text: string; citations: Citation[]; onCite: (c: Citation) => void }) {
  return (
    <p className="reading ask-text">
      {text.split(/(\[\d{1,2}\])/g).map((part, i) => {
        const n = /^\[(\d{1,2})\]$/.exec(part)?.[1];
        const c = n ? citations.find((x) => x.n === Number(n)) : undefined;
        return c ? (
          <button key={i} type="button" className="cite-chip" aria-label={`Source ${c.n}, page ${c.page}. Show it in the paper`} onClick={() => onCite(c)}>
            p.{c.page}
          </button>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        );
      })}
    </p>
  );
}

/** One word, fading in the moment it arrives. Memoised so the words already on screen are never touched again. */
const Word = memo(function Word({ w }: { w: string }) {
  return (
    <m.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22, ease: easeOut }}>
      {w}
    </m.span>
  );
});

/**
 * The answer as it is being written. It is provisional (the sources have not been checked yet), so it is dimmed and the
 * citation markers are hidden until the checked answer replaces it.
 */
function StreamingText({ text, writing }: { text: string; writing: boolean }) {
  const shown = text.replace(/\s*\[\d{1,2}\]/g, "").replace(/\s*\[\d{0,2}$/, "");
  const parts = shown.split(/(\s+)/);
  return (
    <p className="reading ask-text ask-text-live" aria-hidden="true">
      {parts.map((w, i) => (/^\s+$/.test(w) ? w : <Word key={i} w={w} />))}
      {writing && <span className="ask-caret" />}
    </p>
  );
}

function Tick() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <m.path d="M5 12.5l4.5 4.5L19 7.5" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.28, ease: easeOut }} />
    </svg>
  );
}

/** Real progress, not a fake spinner: each step turns on when the server reports it. */
function LiveAnswer({ live, onPage }: { live: Live; onPage: (page: number) => void }) {
  const at = stepIndex(live.stage);
  return (
    <div className="ask-live" aria-busy="true">
      <ol className="ask-steps" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s.id} data-state={i < at ? "done" : i === at ? "now" : "todo"}>
            <span className="ask-step-dot" aria-hidden="true">
              {i < at ? <Tick /> : i === at ? <span className="pulse-dot" /> : null}
            </span>
            <span className="ask-step-label">{s.label}</span>
          </li>
        ))}
      </ol>

      {live.pages.length > 0 && (
        <div className="ask-pages">
          <span className="ask-pages-label">Reading</span>
          {live.pages.map((p, i) => (
            <m.button
              key={p}
              type="button"
              className="ask-page-chip"
              aria-label={`Open page ${p} while the answer is written`}
              initial={{ opacity: 0, scale: 0.6, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ ...springPop, delay: i * 0.06 }}
              onClick={() => onPage(p)}
            >
              p.{p}
            </m.button>
          ))}
        </div>
      )}

      {live.text ? <StreamingText text={live.text} writing={live.stage === "writing"} /> : <span className="ask-wait" aria-hidden="true"><span className="sk sk-body" /><span className="sk sk-body sk-short" /></span>}
    </div>
  );
}

function CopyAnswer({ answer }: { answer: Answer }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(false), 1600);
    return () => window.clearTimeout(t);
  }, [done]);
  const pages = [...new Set(answer.citations.map((c) => c.page))].sort((a, b) => a - b);
  const text = `${answer.answer.replace(/\s*\[\d{1,2}\]/g, "")}${pages.length ? ` (pages ${pages.join(", ")})` : ""}`;
  return (
    <button type="button" className="ask-copy" aria-label={done ? "Copied" : "Copy this answer"} title="Copy answer" onClick={() => navigator.clipboard?.writeText(text).then(() => setDone(true), () => {})}>
      <AnimatePresence mode="wait" initial={false}>
        <m.span key={String(done)} className="btn-ico" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={springPop}>
          {done ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
        </m.span>
      </AnimatePresence>
    </button>
  );
}

function AnswerCard({ answer, onCite }: { answer: Answer; onCite: (c: Citation) => void }) {
  const status = !answer.found
    ? { Icon: SearchX, label: "Not in this paper", tone: "muted" }
    : answer.verified
      ? { Icon: ShieldCheck, label: "Every source checked against the paper", tone: "ok" }
      : { Icon: TriangleAlert, label: "Could not verify the source", tone: "warn" };
  return (
    <m.div className="ask-answer" data-tone={status.tone} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
      <div className="ask-answer-head">
        <span className="ask-status" data-tone={status.tone}>
          <m.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...springPop, delay: 0.05 }} className="btn-ico">
            <status.Icon size={15} aria-hidden="true" />
          </m.span>
          {status.label}
        </span>
        {answer.found && <CopyAnswer answer={answer} />}
      </div>

      <AnswerText text={answer.answer} citations={answer.citations} onCite={onCite} />

      {answer.found && !answer.verified && (
        <p className="ask-warn" role="note">
          <TriangleAlert size={15} aria-hidden="true" />
          <span>The quoted evidence was not found in the paper. Treat this answer with care and check the paper yourself.</span>
        </p>
      )}
      {!answer.found && <p className="ask-hint">Try rephrasing, or ask about a different part of the paper.</p>}

      {answer.citations.length > 0 && (
        <ul className="ask-sources" aria-label="Sources in the paper">
          {answer.citations.map((c, i) => (
            <m.li key={c.n} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: easeOut, delay: 0.12 + i * 0.07 }}>
              <button type="button" className="ask-source" onClick={() => onCite(c)}>
                <span className="ask-source-page">p. {c.page}</span>
                <span className="ask-source-quote">“{c.quote}”</span>
                <CornerDownRight className="ask-source-go" size={15} aria-hidden="true" />
              </button>
            </m.li>
          ))}
        </ul>
      )}
    </m.div>
  );
}

export function AskPanel({ doc, history, onCite, onGoToPage, onReindex }: { doc: DocumentInfo; history: Answer[]; onCite: (c: Citation) => void; onGoToPage: (page: number) => void; onReindex: () => void }) {
  const [turns, setTurns] = useState<Turn[]>(() => history.map((a) => ({ key: a.id, question: a.question, answer: a })));
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [announce, setAnnounce] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const abort = useRef<AbortController | null>(null);
  const stick = useRef(true);
  const ready = doc.status === "ready";

  useEffect(() => {
    setTurns(history.map((a) => ({ key: a.id, question: a.question, answer: a })));
  }, [history]);
  useEffect(() => () => abort.current?.abort(), []);

  // Grow the box with the text (up to a limit).
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [q]);

  // Follow the newest text, but only while the reader has not scrolled up to read something earlier.
  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
  }, [turns, busy]);

  const patchTurn = useCallback((key: string, change: (t: Turn) => Turn) => setTurns((all) => all.map((t) => (t.key === key ? change(t) : t))), []);

  async function ask(question: string, retryKey?: string) {
    const text = question.trim();
    if (text.length < 3 || busy || !ready) return;
    const key = retryKey ?? `t-${Date.now()}`;
    const start: Live = { stage: "retrieving", pages: [], text: "" };
    const ctl = new AbortController();
    abort.current = ctl;
    stick.current = true;
    setBusy(true);
    setQ("");
    setTurns((t) => (retryKey ? t.map((x) => (x.key === key ? { ...x, error: undefined, live: start } : x)) : [...t, { key, question: text, live: start }]));

    // Words can arrive many times a second; paint them at most once per frame.
    let pendingText = "";
    let raf = 0;
    const flush = () => {
      raf = 0;
      const add = pendingText;
      pendingText = "";
      if (add) patchTurn(key, (t) => (t.live ? { ...t, live: { ...t.live, text: t.live.text + add } } : t));
    };

    try {
      const answer = await askDocumentStream(
        doc.id,
        text,
        (e) => {
          if (e.type === "stage") {
            patchTurn(key, (t) => (t.live ? { ...t, live: { ...t.live, stage: e.stage } } : t));
            setAnnounce(STEPS.find((s) => s.id === e.stage)?.say ?? "");
          } else if (e.type === "sources") patchTurn(key, (t) => (t.live ? { ...t, live: { ...t.live, pages: e.pages } } : t));
          else if (e.type === "delta") {
            pendingText += e.text;
            if (!raf) raf = requestAnimationFrame(flush);
          }
        },
        ctl.signal,
      );
      if (raf) cancelAnimationFrame(raf);
      patchTurn(key, (t) => ({ ...t, live: undefined, answer }));
      setAnnounce(!answer.found ? "The paper does not cover this." : answer.verified ? "Answer ready. Every source was checked against the paper." : "Answer ready, but the source could not be verified.");
    } catch (e) {
      if (raf) cancelAnimationFrame(raf);
      const stopped = e instanceof DOMException && e.name === "AbortError";
      const message = stopped ? "Stopped. Ask again whenever you like." : e instanceof ApiError ? e.message : "The connection was lost. Please try again.";
      patchTurn(key, (t) => ({ ...t, live: undefined, error: message }));
      setAnnounce(message);
    } finally {
      abort.current = null;
      setBusy(false);
      input.current?.focus();
    }
  }

  return (
    <section className="ask" aria-label="Ask this paper">
      <header className="ask-head">
        <h2 className="ask-title">
          <Sparkles size={16} aria-hidden="true" /> Ask this paper
        </h2>
        <p className="ask-sub">
          {ready ? (
            <>
              <BadgeCheck size={14} aria-hidden="true" /> <CountUp value={doc.chunkCount} /> passages indexed. Answers use only this paper and each source is checked against its text.
            </>
          ) : doc.status === "failed" ? (
            <>
              <TriangleAlert size={14} aria-hidden="true" /> {doc.error ?? "This paper could not be indexed."}
            </>
          ) : (
            <>
              <Loader2 className="spin" size={14} aria-hidden="true" /> This paper is still being indexed.
            </>
          )}
        </p>
        {!ready && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onReindex}>
            <RefreshCw size={15} aria-hidden="true" />
            <span>Index again</span>
          </button>
        )}
      </header>

      <div ref={scroller} className="ask-scroll" onScroll={onScroll}>
        {turns.length === 0 && ready && (
          <m.div className="ask-empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: easeOut }}>
            <p className="ask-empty-title">What would you like to know?</p>
            <ul className="ask-suggest">
              {SUGGESTIONS.map((s, i) => (
                <m.li key={s} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: easeOut, delay: 0.1 + i * 0.06 }}>
                  <button type="button" className="chip-btn ask-chip" onClick={() => void ask(s)}>
                    {s}
                  </button>
                </m.li>
              ))}
            </ul>
          </m.div>
        )}

        <ol className="ask-turns">
          {turns.map((t) => (
            <Fragment key={t.key}>
              <m.li className="ask-q" initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring}>
                {t.question}
              </m.li>
              <li className="ask-a">
                {t.answer ? (
                  <AnswerCard answer={t.answer} onCite={onCite} />
                ) : t.error ? (
                  <div className="ask-error" role="alert">
                    <TriangleAlert size={16} aria-hidden="true" />
                    <span>{t.error}</span>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => void ask(t.question, t.key)} disabled={busy}>
                      <RefreshCw size={14} aria-hidden="true" />
                      <span>Try again</span>
                    </button>
                  </div>
                ) : t.live ? (
                  <m.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: easeOut }}>
                    <LiveAnswer live={t.live} onPage={onGoToPage} />
                  </m.div>
                ) : null}
              </li>
            </Fragment>
          ))}
        </ol>
        {/* Announces the stage and the result, never the text as it is typed (that would be read out word by word). */}
        <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      </div>

      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) abort.current?.abort();
          else void ask(q);
        }}
      >
        <label className="sr-only" htmlFor="ask-input">Ask a question about this paper</label>
        <textarea
          id="ask-input"
          ref={input}
          rows={1}
          value={q}
          maxLength={MAX_QUESTION_CHARS}
          disabled={!ready}
          placeholder={ready ? "Ask about the methods, results, limitations…" : "Waiting for the paper to be indexed"}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void ask(q);
            }
            if (e.key === "Escape" && busy) abort.current?.abort();
          }}
        />
        <button type="submit" className="ask-send" data-busy={busy} aria-label={busy ? "Stop answering" : "Send question"} disabled={!ready || (!busy && q.trim().length < 3)}>
          <AnimatePresence mode="wait" initial={false}>
            <m.span key={busy ? "stop" : "send"} className="btn-ico" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={springPop}>
              {busy ? <Square size={15} fill="currentColor" aria-hidden="true" /> : <ArrowUp size={18} aria-hidden="true" />}
            </m.span>
          </AnimatePresence>
        </button>
        {q.length > MAX_QUESTION_CHARS - 80 && <span className="ask-count" aria-live="polite">{MAX_QUESTION_CHARS - q.length} left</span>}
      </form>
      <p className="ask-fine">AI can misread a paper. Check the highlighted passage before you rely on an answer.</p>
    </section>
  );
}
