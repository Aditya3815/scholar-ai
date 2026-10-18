import { AnimatePresence, m } from "motion/react";
import { ArrowUp, BadgeCheck, Check, Copy, CornerDownRight, Loader2, RefreshCw, SearchX, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MAX_QUESTION_CHARS, type Answer, type Citation, type DocumentInfo } from "@scholar/shared";
import { ApiError, askDocument } from "../../lib/documents";
import { easeOut, spring, springPop } from "../../lib/motion";
import { CountUp } from "../ResultCard";

const SUGGESTIONS = [
  "Summarise this paper in a few sentences",
  "What research question does it ask?",
  "What methods or data were used?",
  "What are the main findings?",
  "What limitations do the authors mention?",
];

type Turn = { key: string; question: string; answer?: Answer; error?: string };

/** "[1]" and "[2][3]" in the answer become buttons that jump to (and highlight) the quoted passage in the PDF. */
function AnswerText({ text, citations, onCite }: { text: string; citations: Citation[]; onCite: (c: Citation) => void }) {
  const parts = text.split(/(\[\d{1,2}\])/g);
  const sentences = parts.length;
  return (
    <p className="reading ask-text">
      {parts.map((part, i) => {
        const n = /^\[(\d{1,2})\]$/.exec(part)?.[1];
        const c = n ? citations.find((x) => x.n === Number(n)) : undefined;
        if (c) {
          return (
            <button key={i} type="button" className="cite-chip" aria-label={`Source ${c.n}, page ${c.page}. Show it in the paper`} onClick={() => onCite(c)}>
              p.{c.page}
            </button>
          );
        }
        return (
          <m.span key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.35, delay: Math.min(i, 12) * (0.5 / Math.max(sentences, 6)) }}>
            {part}
          </m.span>
        );
      })}
    </p>
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
    <div className="ask-answer" data-tone={status.tone}>
      <div className="ask-answer-head">
        <span className="ask-status" data-tone={status.tone}>
          <m.span initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ ...springPop, delay: 0.1 }} className="btn-ico">
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
            <m.li key={c.n} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: easeOut, delay: 0.25 + i * 0.07 }}>
              <button type="button" className="ask-source" onClick={() => onCite(c)}>
                <span className="ask-source-page">p. {c.page}</span>
                <span className="ask-source-quote">“{c.quote}”</span>
                <CornerDownRight className="ask-source-go" size={15} aria-hidden="true" />
              </button>
            </m.li>
          ))}
        </ul>
      )}
    </div>
  );
}

const STAGES = ["Reading the paper", "Finding the right passages", "Checking every citation"];

function Thinking() {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const t1 = window.setTimeout(() => setStage(1), 1400);
    const t2 = window.setTimeout(() => setStage(2), 3600);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);
  return (
    <div className="ask-thinking" role="status" aria-live="polite">
      <span className="ask-dots" aria-hidden="true">
        <i /><i /><i />
      </span>
      <AnimatePresence mode="wait" initial={false}>
        <m.span key={stage} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.22 }}>
          {STAGES[stage]}…
        </m.span>
      </AnimatePresence>
    </div>
  );
}

export function AskPanel({ doc, history, onCite, onReindex }: { doc: DocumentInfo; history: Answer[]; onCite: (c: Citation) => void; onReindex: () => void }) {
  const [turns, setTurns] = useState<Turn[]>(() => history.map((a) => ({ key: a.id, question: a.question, answer: a })));
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const ready = doc.status === "ready";

  useEffect(() => {
    setTurns(history.map((a) => ({ key: a.id, question: a.question, answer: a })));
  }, [history]);

  // Grow the box with the text (up to a limit) and keep the newest turn in view.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 150)}px`;
  }, [q]);
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [turns.length, busy]);

  async function ask(question: string, retryKey?: string) {
    const text = question.trim();
    if (text.length < 3 || busy || !ready) return;
    const key = retryKey ?? `t-${Date.now()}`;
    setBusy(true);
    setQ("");
    setTurns((t) => (retryKey ? t.map((x) => (x.key === key ? { ...x, error: undefined } : x)) : [...t, { key, question: text }]));
    try {
      const answer = await askDocument(doc.id, text);
      setTurns((t) => t.map((x) => (x.key === key ? { ...x, answer } : x)));
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "The connection was lost. Please try again.";
      setTurns((t) => t.map((x) => (x.key === key ? { ...x, error: message } : x)));
    } finally {
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

      <div ref={scroller} className="ask-scroll" aria-live="off">
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
              <m.li className="ask-a" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: easeOut }}>
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
                ) : (
                  <Thinking />
                )}
              </m.li>
            </Fragment>
          ))}
        </ol>
      </div>

      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(q);
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
          }}
        />
        <button type="submit" className="ask-send" aria-label="Send question" disabled={!ready || busy || q.trim().length < 3}>
          <AnimatePresence mode="wait" initial={false}>
            <m.span key={busy ? "busy" : "idle"} className="btn-ico" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} transition={springPop}>
              {busy ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <ArrowUp size={18} aria-hidden="true" />}
            </m.span>
          </AnimatePresence>
        </button>
        {q.length > MAX_QUESTION_CHARS - 80 && <span className="ask-count" aria-live="polite">{MAX_QUESTION_CHARS - q.length} left</span>}
      </form>
      <p className="ask-fine">AI can misread a paper. Check the highlighted passage before you rely on an answer.</p>
    </section>
  );
}
