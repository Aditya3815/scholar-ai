import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, m } from "motion/react";
import { ArrowUp, Check, Copy, CornerDownRight, FileStack, RefreshCw, SearchX, ShieldAlert, ShieldCheck, Square, TriangleAlert, X } from "lucide-react";
import { Fragment, useEffect, useId, useRef, useState } from "react";
import { MAX_QUESTION_CHARS, OA_UNREADABLE_TEXT, type Answer, type Citation, type OaPaperEvent } from "@scholar/shared";
import { askPaper, closeOaAsk, isAsking, keyOf, restoreFocus, stopAsking, useOaAsk, type OaTurn } from "../../lib/oa-ask";
import { useAuth } from "../../lib/auth";
import { easeOut, spring } from "../../lib/motion";
import { PAPERS_NAME } from "../../lib/workspace";
import { SignInDialog } from "../SignInDialog";
import { StreamingText } from "../papers/AskPanel";

const SUGGESTIONS = ["What is the main finding?", "How was the study done?", "What are the limitations?"];

const LICENSE: Record<string, string> = { cc0: "CC0", "cc-by": "CC BY", "cc-by-sa": "CC BY-SA", "cc-by-nc": "CC BY-NC", "cc-by-nd": "CC BY-ND", "cc-by-nc-sa": "CC BY-NC-SA", "cc-by-nc-nd": "CC BY-NC-ND" };

const STAGE_SAY: Record<string, string> = {
  retrieving: "Finding the right passages",
  thinking: "Thinking it through",
  writing: "Writing the answer",
  checking: "Checking every quote against the paper",
};
const INGEST_SAY: Record<string, string> = {
  queued: "Waiting its turn",
  fetching: "Finding the paper",
  reading: "Reading the text",
  embedding: "Getting it ready for questions",
};

/** Where in the paper: "p. 3" for a PDF, the section for XML ("Methods > Participants"). */
const placeOf = (c: Citation) => (c.section ? c.section : `p. ${c.page}`);
const chipOf = (c: Citation) => (c.section ? `§ ${c.section.split(" > ")[0]!.slice(0, 14)}` : `p.${c.page}`);

/** What the answer is made from, said plainly. */
function Basis({ paper, onPapers }: { paper: OaPaperEvent; onPapers: () => void }) {
  if (paper.source === "abstract") {
    return (
      <p className="oa-basis" data-kind="abstract" role="note">
        <TriangleAlert size={15} aria-hidden="true" />
        <span>
          <b>Based on the abstract only.</b> {paper.reason ? OA_UNREADABLE_TEXT[paper.reason] : ""} If you have the PDF, upload it to {PAPERS_NAME} to ask the whole paper.{" "}
          <button type="button" className="link-btn" onClick={onPapers}>Open {PAPERS_NAME}</button>
        </span>
      </p>
    );
  }
  const from = paper.source === "europepmc" ? "Europe PMC" : paper.source === "arxiv" ? "arXiv" : "a free PDF";
  const lic = paper.license && LICENSE[paper.license] ? ` · ${LICENSE[paper.license]}` : "";
  return (
    <p className="oa-basis" data-kind="full">
      <FileStack size={15} aria-hidden="true" />
      <span>Full text from {from}{lic}</span>
    </p>
  );
}

/** The first time a paper is asked it is read for everyone; this is how far that has got. */
function Reading({ turn }: { turn: OaTurn }) {
  const i = turn.ingest;
  if (!i || i.status === "ready" || i.status === "unreadable" || i.status === "failed") return null;
  const pct = Math.round(i.progress * 100);
  return (
    <div className="oa-reading" aria-live="polite">
      <div className="oa-bar" role="progressbar" aria-label="Reading the paper" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <m.span animate={{ width: `${pct}%` }} transition={{ duration: 0.4, ease: easeOut }} />
      </div>
      <p>
        <b>{INGEST_SAY[i.status] ?? "Reading the paper"}…</b> {i.started === false ? "Someone asked for this paper a moment ago, so you are joining that. " : ""}
        The first time takes up to a minute. The paper is then kept for everyone, so the next question is quick. You can close this: it keeps going.
      </p>
    </div>
  );
}

function CopyButton({ answer }: { answer: Answer }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const t = window.setTimeout(() => setDone(false), 1500);
    return () => window.clearTimeout(t);
  }, [done]);
  const text = `${answer.answer}\n\n${answer.citations.map((c) => `[${c.n}] ${placeOf(c)}: “${c.quote}”`).join("\n")}`;
  return (
    <button type="button" className="icon-btn" aria-label={done ? "Copied" : "Copy the answer with its quotes"} title="Copy the answer with its quotes" onClick={() => navigator.clipboard?.writeText(text).then(() => setDone(true), () => {})}>
      {done ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
    </button>
  );
}

function AnswerCard({ turn }: { turn: OaTurn }) {
  const a = turn.answer!;
  const prefix = `oa-${turn.id}`;
  const [flash, setFlash] = useState<number | null>(null);
  const cite = (n: number) => {
    const el = document.getElementById(`${prefix}-${n}`);
    el?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setFlash(n);
    window.setTimeout(() => setFlash((f) => (f === n ? null : f)), 1600);
  };
  const against = turn.paper?.source === "abstract" ? "the abstract" : "the paper";
  const status = !a.found ? { Icon: SearchX, label: turn.paper?.source === "abstract" ? "Not in the abstract" : "Not in this paper", tone: "muted" } : a.verified ? { Icon: ShieldCheck, label: `Every quote checked against ${against}`, tone: "ok" } : { Icon: TriangleAlert, label: "Could not verify the source", tone: "warn" };
  return (
    <m.div className="ask-answer oa-answer" data-tone={status.tone} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
      <div className="ask-answer-head">
        <span className="ask-status" data-tone={status.tone}>
          <status.Icon size={15} aria-hidden="true" /> {status.label}
        </span>
        <span className="ask-tools">{a.found && <CopyButton answer={a} />}</span>
      </div>
      <p className="reading ask-text">
        {a.answer.split(/(\[\d{1,2}\])/g).map((part, i) => {
          const n = /^\[(\d{1,2})\]$/.exec(part)?.[1];
          const c = n ? a.citations.find((x) => x.n === Number(n)) : undefined;
          return c ? (
            <button key={i} type="button" className="cite-chip" aria-label={`Source ${c.n}: ${placeOf(c)}. Show the quote`} onClick={() => cite(c.n)}>
              {chipOf(c)}
            </button>
          ) : (
            <Fragment key={i}>{part}</Fragment>
          );
        })}
      </p>
      {a.found && !a.verified && (
        <p className="ask-warn" role="note">
          <TriangleAlert size={15} aria-hidden="true" />
          <span>The quoted evidence was not found in the text. Treat this answer with care.</span>
        </p>
      )}
      {!a.found && <p className="ask-hint">Try rephrasing, or ask about a different part of the paper.</p>}
      {a.citations.length > 0 && (
        <ul className="ask-sources" aria-label="Quotes from the paper">
          {a.citations.map((c) => (
            <li key={c.n} id={`${prefix}-${c.n}`} className="oa-source" data-flash={flash === c.n || undefined}>
              <span className="ask-source oa-quote">
                <span className="ask-source-page">{placeOf(c)}</span>
                <span className="ask-source-quote">“{c.quote}”</span>
                <CornerDownRight className="ask-source-go" size={15} aria-hidden="true" />
              </span>
            </li>
          ))}
        </ul>
      )}
    </m.div>
  );
}

const ERROR_HELP: Record<string, string> = {
  still_reading: "It keeps going without you.",
  quota: "It comes back tomorrow.",
};

function Turn({ turn, paperKey, onRetry, onPapers }: { turn: OaTurn; paperKey: string; onRetry: (t: OaTurn) => void; onPapers: () => void }) {
  void paperKey;
  const working = turn.status === "working";
  return (
    <li className="oa-turn" data-status={turn.status}>
      <p className="oa-q">{turn.question}</p>
      {turn.paper && <Basis paper={turn.paper} onPapers={onPapers} />}
      {working && <Reading turn={turn} />}
      {working && turn.stage && !turn.live && <p className="oa-stage" aria-live="polite">{STAGE_SAY[turn.stage]}…</p>}
      {working && turn.live && <StreamingText text={turn.live} writing={turn.stage === "writing"} />}
      {turn.answer && <AnswerCard turn={turn} />}
      {turn.status === "stopped" && <p className="chat-why" role="note">Stopped.</p>}
      {turn.status === "error" && turn.error && (
        <div className="ask-error" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>
            {turn.error.title}.{turn.error.detail ? ` ${turn.error.detail}` : ERROR_HELP[turn.error.code] ? ` ${ERROR_HELP[turn.error.code]}` : ""}
          </span>
          {turn.error.code === "sign_in" ? (
            <SignInDialog />
          ) : turn.error.code !== "no_text" && turn.error.code !== "quota" ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRetry(turn)}>
              <RefreshCw size={14} aria-hidden="true" />
              <span>Ask again</span>
            </button>
          ) : null}
        </div>
      )}
    </li>
  );
}

/** "Ask this paper" for any paper of a search: a side sheet with the questions about it, each answered from the text of the paper or, when that cannot be read, from its abstract. */
export function OaAskSheet({ onOpenPapers }: { onOpenPapers: () => void }) {
  const { open, paper, turns } = useOaAsk();
  const { user } = useAuth();
  const key = paper ? keyOf(paper) : null;
  const list = key ? turns.get(key) ?? [] : [];
  const busy = list.some((t) => t.status === "working");
  const [q, setQ] = useState("");
  const id = useId();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => setQ(""), [key]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end", behavior: "auto" });
  }, [list.length]);

  const send = (text = q) => {
    if (!paper || busy) return;
    void askPaper(paper, text).then((r) => r === "sent" && setQ(""));
  };
  const retry = (t: OaTurn) => paper && void askPaper(paper, t.question, t.id);
  const papers = () => {
    closeOaAsk();
    onOpenPapers();
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && closeOaAsk()}>
      <AnimatePresence>
        {open && paper && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild forceMount>
              <m.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease: easeOut }} />
            </Dialog.Overlay>
            <Dialog.Content asChild forceMount aria-describedby={`${id}-d`} onCloseAutoFocus={(e) => { e.preventDefault(); restoreFocus(); }}>
              <m.aside className="drawer pv-sheet oa-sheet" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%", transition: { duration: 0.2 } }} transition={spring}>
                <header className="pv-head">
                  <Dialog.Title className="pv-kicker">Ask this paper</Dialog.Title>
                  <div className="pv-nav">
                    <Dialog.Close className="icon-btn" aria-label="Close">
                      <X size={18} aria-hidden="true" />
                    </Dialog.Close>
                  </div>
                </header>
                <div className="pv-scroll oa-scroll">
                  <h2 className="oa-title">{paper.title}</h2>
                  {(paper.retracted || list.some((t) => t.paper?.retracted)) && (
                    <p className="retract" role="alert">
                      <ShieldAlert size={18} aria-hidden="true" />
                      <span>
                        <strong>This paper has been retracted.</strong> Anything it says may be wrong. Read the retraction notice before you rely on an answer.
                      </span>
                    </p>
                  )}
                  <p className="pv-muted" id={`${id}-d`}>
                    {paper.year ? `${paper.year} · ` : ""}Answers come from the text of the paper, and every claim has a quote that is checked against it. If the text cannot be read, the abstract is used and you are told.
                  </p>
                  {!user ? (
                    <div className="oa-signin">
                      <p>Sign in to ask this paper.</p>
                      <SignInDialog />
                    </div>
                  ) : (
                    <>
                      {list.length === 0 && (
                        <div className="oa-suggest" role="group" aria-label="Example questions">
                          {SUGGESTIONS.map((s) => (
                            <button key={s} type="button" className="chip-btn" onClick={() => send(s)}>{s}</button>
                          ))}
                        </div>
                      )}
                      <ol className="oa-turns" aria-label="Questions about this paper">
                        {list.map((t) => (
                          <Turn key={t.id} turn={t} paperKey={key!} onRetry={retry} onPapers={papers} />
                        ))}
                      </ol>
                      <div ref={end} />
                    </>
                  )}
                </div>
                {user && (
                  <form className="oa-form" onSubmit={(e) => { e.preventDefault(); if (busy) stopAsking(key); else send(); }}>
                    <label className="sr-only" htmlFor={`${id}-q`}>Your question about this paper</label>
                    <textarea
                      id={`${id}-q`}
                      className="oa-input"
                      rows={2}
                      maxLength={MAX_QUESTION_CHARS}
                      value={q}
                      placeholder="Ask a question about this paper, in English, Hindi or Hinglish…"
                      onChange={(e) => setQ(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          if (!busy) send();
                        }
                      }}
                    />
                    <button type="submit" className="hm-send" aria-label={busy ? "Stop answering" : "Ask"} data-busy={busy} disabled={!busy && q.trim().length < 3}>
                      {busy || isAsking(key) ? <Square size={15} fill="currentColor" aria-hidden="true" /> : <ArrowUp size={18} aria-hidden="true" />}
                    </button>
                  </form>
                )}
              </m.aside>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
