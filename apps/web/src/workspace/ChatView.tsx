import { AnimatePresence, m } from "motion/react";
import { ChevronDown, ListChecks, Lightbulb, RefreshCw, Search, ShieldCheck, TriangleAlert } from "lucide-react";
import { Fragment, useCallback, useLayoutEffect, useRef, useState } from "react";
import { type AssistantMsg, type ChatMsg, type ChatNoAnswer } from "@scholar/shared";
import { SignInDialog } from "../components/AccountMenu";
import { Pop } from "../components/Pop";
import { ResultCard, SkeletonCard } from "../components/ResultCard";
import { StreamingText } from "../components/papers/AskPanel";
import { openPreview } from "../lib/preview";
import { easeOut, spring } from "../lib/motion";

/** What is said when a reply has papers but no written answer. Plain words, and never a sentence the model could not back. */
const WHY: Record<ChatNoAnswer, string> = {
  sign_in: "Sign in to get a short written answer with its sources checked. The papers are below.",
  no_abstracts: "None of these papers has an abstract to read, so no answer is written. The papers are below.",
  not_answered: "The papers found do not seem to answer this directly. They are listed below.",
  not_grounded: "An answer could not be checked against these papers, so none is shown. The papers are below.",
  quota: "You have used today's AI allowance, which comes back tomorrow. The papers are below.",
  unavailable: "Writing an answer is not available right now. The papers are below.",
  stopped: "Stopped.",
};

const STEPS = [
  { id: "search", label: "Searching" },
  { id: "read", label: "Reading the papers" },
  { id: "write", label: "Writing" },
  { id: "check", label: "Checking the sources" },
] as const;

function Progress({ m: msg, signedIn }: { m: AssistantMsg; signedIn: boolean }) {
  // a person who is not signed in gets no written answer, so only the search is shown for them
  const steps = signedIn ? STEPS : STEPS.slice(0, 1);
  return (
    <ol className="chat-steps" aria-label="Progress">
      {steps.map((s) => {
        const state = msgDone(msg, s.id) ? "done" : msg.step === s.id ? "now" : "todo";
        return (
          <li key={s.id} data-state={state}>
            <span className="ask-step-dot" aria-hidden="true">{state === "now" ? <span className="pulse-dot" /> : state === "done" ? "✓" : null}</span>
            <span>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
const msgDone = (msg: AssistantMsg, step: string) => msg.stepsDone.includes(step as never);

/** The answer text with [n] marks as buttons that point at paper n of the list below. */
function AnswerText({ text, onCite, label }: { text: string; onCite: (n: number) => void; label: (n: number) => string }) {
  return (
    <p className="reading chat-text">
      {text.split(/(\[\d{1,2}\])/g).map((part, i) => {
        const n = /^\[(\d{1,2})\]$/.exec(part)?.[1];
        return n ? (
          <button key={i} type="button" className="cite-chip" aria-label={label(Number(n))} onClick={() => onCite(Number(n))}>
            {n}
          </button>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        );
      })}
    </p>
  );
}

function AssistantTurn({ msg, signedIn, flash, onCite, onRetry, onChange }: { msg: AssistantMsg; signedIn: boolean; flash: { msgId: string; n: number } | null; onCite: (msgId: string, n: number) => void; onRetry: (id: string) => void; onChange: (tool: "verify" | "idea", text: string) => void }) {
  const working = msg.status === "working";
  const byN = (n: number) => msg.papers[n - 1];
  const answer = msg.answer?.grounded ? msg.answer : null;
  const titleOf = (n: number) => byN(n)?.title ?? `paper ${n}`;
  const announce = working ? "" : msg.status === "done" ? `${answer ? "Answer ready" : "Papers ready"}, ${msg.papers.length} ${msg.papers.length === 1 ? "paper" : "papers"}.` : msg.status === "stopped" ? "Stopped." : msg.error ?? "This answer was interrupted.";

  return (
    <div className="chat-turn" data-status={msg.status}>
      <p className="chat-und">
        I understood this as <b>Search papers</b>.{" "}
        <Pop
          label="Use another tool for this"
          align="start"
          trigger={() => (
            <button type="button" className="link-btn chat-change">
              Change <ChevronDown size={12} aria-hidden="true" />
            </button>
          )}
        >
          {(close) => (
            <div className="chat-change-menu" role="menu" aria-label="Use another tool for this">
              <button type="button" role="menuitem" className="hm-menu-item" onClick={() => { close(); onChange("verify", msg.query); }}>
                <span className="hm-menu-ico"><ListChecks size={16} aria-hidden="true" /></span>
                <span className="hm-menu-txt"><b>Check references</b><small>Treat the text as a list of references</small></span>
              </button>
              <button type="button" role="menuitem" className="hm-menu-item" onClick={() => { close(); onChange("idea", msg.query); }}>
                <span className="hm-menu-ico"><Lightbulb size={16} aria-hidden="true" /></span>
                <span className="hm-menu-txt"><b>Idea Check</b><small>Treat the text as an idea to test</small></span>
              </button>
            </div>
          )}
        </Pop>
      </p>

      {working && <Progress m={msg} signedIn={signedIn} />}

      {answer ? (
        <m.div className="chat-answer" initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
          <span className="ask-status" data-tone="ok"><ShieldCheck size={15} aria-hidden="true" /> Every claim points at a sentence of an abstract</span>
          <AnswerText text={answer.text} onCite={(n) => onCite(msg.id, n)} label={(n) => `Source ${n}: ${titleOf(n)}. Show the paper`} />
          <details className="chat-evidence">
            <summary>The sentences behind it</summary>
            <ul>
              {answer.citations.map((c) => (
                <li key={c.n}>
                  <button type="button" className="chat-ev" onClick={() => onCite(msg.id, c.n)}>
                    <span className="chat-ev-n">{c.n}</span>
                    <span>
                      <span className="chat-ev-t">{titleOf(c.n)}{byN(c.n)?.year ? ` (${byN(c.n)!.year})` : ""}</span>
                      <span className="chat-ev-q">“{c.sentence}”</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </m.div>
      ) : working && msg.live ? (
        <StreamingText text={msg.live} writing={msg.step === "write"} />
      ) : null}

      {!working && !answer && msg.status === "done" && msg.reason && (
        <p className="chat-why" role="note">
          {msg.reason === "sign_in" ? (
            <span className="chat-why-row">
              <span>{WHY.sign_in}</span>
              <SignInDialog />
            </span>
          ) : (
            WHY[msg.reason]
          )}
        </p>
      )}
      {msg.status === "stopped" && <p className="chat-why" role="note">Stopped. The papers found so far are below.</p>}
      {(msg.status === "error" || msg.status === "interrupted") && (
        <div className="ask-error" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{msg.status === "interrupted" ? "This answer was interrupted when the page was closed." : msg.error}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRetry(msg.id)}>
            <RefreshCw size={14} aria-hidden="true" />
            <span>Search again</span>
          </button>
        </div>
      )}

      {msg.notices.map((n) => (
        <p key={n.kind} className="chat-note" data-kind={n.kind} role="note">
          <TriangleAlert size={14} aria-hidden="true" />
          <span>{n.text}</span>
          {n.kind === "partial" && msg.status !== "working" && (
            <button type="button" className="link-btn" onClick={() => onRetry(msg.id)}>Search again</button>
          )}
        </p>
      ))}

      {working && msg.papers.length === 0 ? (
        <ul className="chat-papers" aria-hidden="true">
          <SkeletonCard />
          <SkeletonCard />
        </ul>
      ) : msg.papers.length > 0 ? (
        <ol className="chat-papers" aria-label={`${msg.papers.length} papers found`}>
          <AnimatePresence initial={false}>
            {msg.papers.map((p, i) => (
              <ResultCard key={p.id} paper={p} index={Math.min(i, 5)} onPreview={(paper) => openPreview(paper, msg.papers)} anchor={{ id: `p-${msg.id}-${i + 1}`, number: i + 1, flash: flash?.msgId === msg.id && flash.n === i + 1 }} />
            ))}
          </AnimatePresence>
        </ol>
      ) : null}

      {/* One polite message when the reply is ready: not the words one by one. */}
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
    </div>
  );
}

/** The conversation: what was asked, and under each question the reply (steps while it works, the answer, the papers). */
export function ChatView({ messages, signedIn, onRetry, onChange }: { messages: ChatMsg[]; signedIn: boolean; onRetry: (id: string) => void; onChange: (tool: "verify" | "idea", text: string) => void }) {
  const [flash, setFlash] = useState<{ msgId: string; n: number } | null>(null);
  const list = useRef<HTMLOListElement>(null);

  // a new question: bring it to the top of the window, so the answer that is written under it is what the reader sees (the papers come below it); nothing scrolls after that
  const count = messages.length;
  useLayoutEffect(() => {
    if (count === 0) return;
    const users = list.current?.querySelectorAll<HTMLElement>(".chat-u");
    users?.[users.length - 1]?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [count]);

  const cite = useCallback((msgId: string, n: number) => {
    const el = document.getElementById(`p-${msgId}-${n}`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setFlash({ msgId, n });
    window.setTimeout(() => setFlash((f) => (f?.msgId === msgId && f.n === n ? null : f)), 1800);
  }, []);

  return (
    <div className="chat">
      <ol ref={list} className="chat-list" aria-label="Conversation">
        {messages.map((msg) => (
          <li key={msg.id} className={msg.role === "user" ? "chat-u" : "chat-a"}>
            {msg.role === "user" ? (
              <m.p className="chat-bubble" initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring}>
                <Search size={13} aria-hidden="true" /> {msg.text}
              </m.p>
            ) : (
              <m.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: easeOut }}>
                <AssistantTurn msg={msg} signedIn={signedIn} flash={flash} onCite={cite} onRetry={onRetry} onChange={onChange} />
              </m.div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
