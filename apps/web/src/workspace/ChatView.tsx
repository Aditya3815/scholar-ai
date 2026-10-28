import { AnimatePresence, m } from "motion/react";
import { ArrowRight, ChevronDown, FileStack, Info, Lightbulb, ListChecks, RefreshCw, Search, ShieldCheck, TriangleAlert } from "lucide-react";
import { Fragment, Suspense, lazy, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { GENERAL_LABEL, INDIA_SCOPE_LABEL, MAX_CHAT_CHARS, ROUTE_NAMES, canTighten, type AssistantMsg, type ChatMsg, type IdeaMsg, type ChatNoAnswer, type RouteMode } from "@scholar/shared";
import { SignInDialog } from "../components/AccountMenu";
import { Pop } from "../components/Pop";
import { ResultCard, SkeletonCard } from "../components/ResultCard";
import { StreamingText } from "../components/papers/AskPanel";
import { cancelTighten, tightenReply } from "../lib/chat";
import { openPreview } from "../lib/preview";
import { easeOut, spring } from "../lib/motion";
import { PAPERS_NAME } from "../lib/workspace";
// the Idea Check workspace is a chunk of its own, fetched when an idea is checked here (the first load has a size budget)
const IdeaWorkspace = lazy(() => import("../components/idea/IdeaPage").then((m) => ({ default: m.IdeaWorkspace })));

/** What is said when a reply has papers but no written answer. Plain words, and never a sentence the model could not back. */
const WHY: Record<ChatNoAnswer, string> = {
  sign_in: "Sign in to get a short written answer with its sources checked. The papers are below.",
  no_abstracts: "None of these papers has an abstract to read, so no answer is written. The papers are below.",
  not_answered: "The papers found do not seem to answer this directly. They are listed below.",
  not_grounded: "An answer could not be checked against these papers, so none is shown. The papers are below.",
  quota: "You have used today's AI allowance, which comes back tomorrow. The papers are below.",
  unavailable: "Writing an answer is not available right now. The papers are below.",
  stopped: "Stopped.",
  routed: "",
  too_long: `This is too long for a search (${MAX_CHAT_CHARS} characters at most). Choose Check references or Idea Check, or write a shorter question.`,
};

/** The tools, as the Change menu offers them. Each opens on its own page, except Search papers, which runs here with the reader's exact words. */
const TOOL_ROWS: { id: RouteMode; name: string; hint: string; Icon: typeof Search }[] = [
  { id: "search", name: ROUTE_NAMES.search, hint: "Search these exact words", Icon: Search },
  { id: "verify", name: ROUTE_NAMES.verify, hint: "Treat the text as a list of references", Icon: ListChecks },
  { id: "idea", name: ROUTE_NAMES.idea, hint: "Treat the text as an idea to test", Icon: Lightbulb },
  { id: "paper", name: ROUTE_NAMES.paper, hint: "Ask one of your own papers", Icon: FileStack },
];
/** What is said when Auto took the message for another tool: it is offered, never started (Idea Check least of all). */
const OFFER: Record<Exclude<RouteMode, "search">, { text: string; open: string }> = {
  verify: { text: "This looks like a list of references to check.", open: "Open Check references" },
  idea: { text: "This looks like an idea to test against the literature. Idea Check starts only when you ask for it, and searches only after you have seen and approved the search plan.", open: "Open the Idea Check page" },
  paper: { text: "This looks like a question about one of your own papers.", open: `Open ${PAPERS_NAME}` },
};

/** After this long without a single event from the server (the model can think for 9 to 12 s before its first word), the reply says it is still working. A test can shorten it with sessionStorage "scholar.quiet.ms". */
const quietMs = () => {
  try {
    const v = Number(sessionStorage.getItem("scholar.quiet.ms"));
    return Number.isFinite(v) && v >= 500 ? v : 15_000;
  } catch {
    return 15_000;
  }
};
/** True once a working reply has been silent for `quietMs()`. Every event gives the reply a new identity, which starts the wait again. */
function useQuiet(msg: AssistantMsg): boolean {
  const [quiet, setQuiet] = useState(false);
  const working = msg.status === "working";
  useEffect(() => {
    setQuiet(false);
    if (!working) return;
    const t = window.setTimeout(() => setQuiet(true), quietMs());
    return () => window.clearTimeout(t);
  }, [msg, working]);
  return quiet && working;
}

const STEPS = [
  { id: "route", label: "Understanding" },
  { id: "search", label: "Searching" },
  { id: "read", label: "Reading the papers" },
  { id: "write", label: "Writing" },
  { id: "check", label: "Reading each claim against its sentences" },
  { id: "general", label: "Writing background" },
] as const;

function Progress({ m: msg, signedIn }: { m: AssistantMsg; signedIn: boolean }) {
  // a person who is not signed in gets no written answer, so only the search is shown for them; "Understanding" is there only when Auto is choosing the tool
  // while the background is written, only what led to it is listed: the search, and (when it happened) the reading
  const steps = STEPS.filter((s) => (s.id === "route" ? msg.auto : s.id === "general" ? msg.step === "general" : msg.step === "general" ? s.id === "search" : signedIn || s.id === "search"));
  return (
    <ol className="chat-steps" aria-label="Progress">
      {steps.map((s) => {
        const state = msgDone(msg, s.id) ? "done" : msg.step === s.id ? "now" : "todo";
        return (
          <li key={s.id} data-state={state}>
            <span className="ask-step-dot" aria-hidden="true">{state === "now" ? <span className="pulse-dot" /> : state === "done" ? "✓" : null}</span>
            <span>{s.label}{s.id === "read" && state === "now" ? <span className="chat-step-hint"> · about 10 to 20 seconds (it reads every abstract before it writes)</span> : null}</span>
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

type ChangeTool = (to: RouteMode, replyId: string, text: string) => void;

/**
 * Background from general knowledge (W5), when the papers did not answer: always under its label, apart from the checked answer, with no source marks and no citations.
 * While it is being written it is dimmed like any unchecked text. A subject the model would not speak about shows nothing here.
 */
function Background({ msg, question, onRefine }: { msg: AssistantMsg; question: string; onRefine: (text: string) => void }) {
  const g = msg.general;
  const live = msg.generalLive ?? "";
  if (g?.kind === "not_research" && g.text) return <p className="chat-why" role="note">{g.text}</p>;
  if (g?.kind !== "background" && !(msg.status === "working" && live)) return null;
  return (
    <section className="chat-general" aria-label={GENERAL_LABEL}>
      <p className="chat-general-label"><Info size={15} aria-hidden="true" /> <b>{GENERAL_LABEL}</b></p>
      {g?.kind === "background" ? <p className="reading chat-text">{g.text}</p> : <StreamingText text={live} writing />}
      {g?.kind === "background" && (
        <p className="chat-general-note">
          No paper is cited here, so check it before you rely on it.{" "}
          <button type="button" className="link-btn" onClick={() => onRefine(question)}>Edit the question and search again</button>
        </p>
      )}
    </section>
  );
}

/**
 * "I understood this as … · Change": which tool the message was taken for, and, when Auto searched with English words that are not the reader's own, those words
 * ("I searched for: …") with a way back to the exact words. A search that was chosen by hand says so; a guess that fell back to a search says it was a guess.
 */
function Understood({ msg, text, working, onChange, onExact }: { msg: AssistantMsg; text: string; working: boolean; onChange: ChangeTool; onExact: () => void }) {
  const line =
    msg.how === "chosen" ? (
      <>Searching papers, as you chose.</>
    ) : msg.how === "fallback" ? (
      <>{msg.reason === "too_long" ? "I was not sure what to do with this." : "I was not sure what you wanted, so I searched for papers."}</>
    ) : (
      <>I understood this as <b>{ROUTE_NAMES[msg.mode]}</b>.</>
    );
  const others = TOOL_ROWS.filter((t) => t.id !== msg.mode);
  const exact = msg.mode === "search" && !!msg.searchQuery && !working && text.length <= MAX_CHAT_CHARS;
  return (
    <>
      <p className="chat-und">
        {line}{" "}
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
              {others.map((t) => (
                <button key={t.id} type="button" role="menuitem" className="hm-menu-item" disabled={working} onClick={() => { close(); onChange(t.id, msg.id, text); }}>
                  <span className="hm-menu-ico"><t.Icon size={16} aria-hidden="true" /></span>
                  <span className="hm-menu-txt"><b>{t.name}</b><small>{t.hint}</small></span>
                </button>
              ))}
            </div>
          )}
        </Pop>
      </p>
      {msg.mode === "search" && msg.searchQuery && (
        <p className="chat-und chat-searched">
          I searched for: <b lang="en">{msg.searchQuery}</b>
          {exact && (
            <>
              {" · "}
              <button type="button" className="link-btn" onClick={onExact}>Use my exact words</button>
            </>
          )}
        </p>
      )}
      {msg.mode === "search" && msg.scope === "india" && (
        <p className="chat-und chat-searched">
          Searched only <b>{INDIA_SCOPE_LABEL}</b>: journals published in India, theses on Shodhganga, and papers by authors at Indian institutions.
        </p>
      )}
    </>
  );
}

/**
 * "Check strictly": a slower, stronger second reading of the answer, asked for by the reader (docs/design/claim-support.md). Shown only for an answer that was read claim by claim and
 * whose papers still have the abstracts it was made from; while it runs the reader can cancel, and the answer stays as it was until the new one comes back whole.
 */
function Strict({ msg, signedIn }: { msg: AssistantMsg; signedIn: boolean }) {
  const s = msg.strict;
  if (s?.status === "working") {
    return (
      <p className="chat-strict" role="status">
        <span className="pulse-dot" aria-hidden="true" /> Reading every claim again with a stronger check. This takes 20 to 45 seconds.{" "}
        <button type="button" className="link-btn" onClick={() => cancelTighten(msg.id)}>Cancel</button>
      </p>
    );
  }
  if (msg.answer?.strict) {
    return s?.note === "unchanged" ? <p className="chat-strict" role="status">The stronger check found nothing to change.</p> : null;
  }
  if (!signedIn || !canTighten(msg)) return null;
  return (
    <div className="chat-strict">
      {s?.status === "failed" && <p className="chat-strict-err" role="alert"><TriangleAlert size={14} aria-hidden="true" /> {s.note ?? "The strict check could not be done."}</p>}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void tightenReply(msg.id)} aria-describedby={`${msg.id}-strict-h`}>
        <ShieldCheck size={14} aria-hidden="true" />
        <span>Check strictly</span>
      </button>
      <span className="chat-strict-h" id={`${msg.id}-strict-h`}>A slower, stronger second reading. It can leave out or shorten statements that say more than their sentences. About 5,000 tokens of today&apos;s allowance.</span>
    </div>
  );
}

function AssistantTurn({ msg, text, signedIn, flash, onCite, onRetry, onChange, onRefine, onOpenPage }: { msg: AssistantMsg; text: string; signedIn: boolean; flash: { msgId: string; n: number } | null; onCite: (msgId: string, n: number) => void; onRetry: (id: string, as?: "search") => void; onChange: ChangeTool; onRefine: (text: string) => void; onOpenPage: (to: "idea", text: string) => void }) {
  const working = msg.status === "working";
  const byN = (n: number) => msg.papers[n - 1];
  const answer = msg.answer?.grounded ? msg.answer : null;
  const titleOf = (n: number) => byN(n)?.title ?? `paper ${n}`;
  const routed = msg.status === "done" && msg.reason === "routed" && msg.mode !== "search";
  const quiet = useQuiet(msg);
  const announce = working ? "" : msg.status === "done" ? (routed ? "Understood. A tool can be opened." : `${answer ? "Answer ready" : "Papers ready"}, ${msg.papers.length} ${msg.papers.length === 1 ? "paper" : "papers"}.`) : msg.status === "stopped" ? "Stopped." : msg.error ?? "This answer was interrupted.";

  return (
    <div className="chat-turn" data-status={msg.status}>
      {/* while Auto is still reading the message the step list says so; the line comes once the tool is known (and not at all if the reply failed before that) */}
      {msg.understood !== false && <Understood msg={msg} text={text} working={working} onChange={onChange} onExact={() => onRetry(msg.id, "search")} />}

      {routed && msg.mode !== "search" && (
        <div className="chat-offer" role="group" aria-label="Open the tool">
          <p>{OFFER[msg.mode].text}</p>
          <span className="chat-offer-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onChange(msg.mode, msg.id, text)}>
              <span>{msg.mode === "idea" ? "Check it here" : OFFER[msg.mode].open}</span>
              <ArrowRight size={15} aria-hidden="true" />
            </button>
            {msg.mode === "idea" && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenPage("idea", text)}>
                <span>{OFFER.idea.open}</span>
              </button>
            )}
          </span>
        </div>
      )}

      {working && <Progress m={msg} signedIn={signedIn} />}
      {quiet && <p className="chat-quiet" role="status">Still working… this is taking longer than usual. You can press Stop and try again.</p>}

      {answer ? (
        <m.div className="chat-answer" initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
          <span className="ask-status" data-tone={answer.checked === false ? "warn" : "ok"}>
            <ShieldCheck size={15} aria-hidden="true" /> {answer.strict ? "Each claim was read strictly against the sentences it cites" : answer.checked ? "Each claim was read against the sentences it cites" : answer.checked === false ? "Every mark points at a sentence of an abstract. The claims were not read against them this time" : "Every mark points at a sentence of an abstract"}
          </span>
          {!!answer.leftOut && <p className="chat-left-out" role="note">{answer.leftOut === 1 ? "One statement was left out: the sentences it cited do not support it." : `${answer.leftOut} statements were left out: the sentences they cited do not support them.`}</p>}
          {!!answer.rewritten && <p className="chat-left-out" role="note">{answer.rewritten === 1 ? "One statement was shortened to what its sentences say." : `${answer.rewritten} statements were shortened to what their sentences say.`}</p>}
          <AnswerText text={answer.text} onCite={(n) => onCite(msg.id, n)} label={(n) => `Source ${n}: ${titleOf(n)}. Show the paper`} />
          <details className="chat-evidence">
            <summary>The sentences behind it</summary>
            <ul>
              {[...new Set(answer.citations.map((c) => c.n))].map((n) => (
                <li key={n}>
                  <button type="button" className="chat-ev" onClick={() => onCite(msg.id, n)}>
                    <span className="chat-ev-n">{n}</span>
                    <span>
                      <span className="chat-ev-t">{titleOf(n)}{byN(n)?.year ? ` (${byN(n)!.year})` : ""}</span>
                      {answer.citations.filter((c) => c.n === n).map((c) => <span key={c.sentenceNo} className="chat-ev-q">“{c.sentence}”</span>)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
          <Strict msg={msg} signedIn={signedIn} />
        </m.div>
      ) : working && msg.live ? (
        <StreamingText text={msg.live} writing={msg.step === "write"} />
      ) : null}

      {!working && !answer && msg.status === "done" && msg.reason && msg.reason !== "routed" && (
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
      <Background msg={msg} question={text} onRefine={onRefine} />
      {msg.status === "stopped" && <p className="chat-why" role="note">Stopped. The papers found so far are below.</p>}
      {(msg.status === "error" || msg.status === "interrupted") && (
        <div className="ask-error" role="alert">
          <TriangleAlert size={16} aria-hidden="true" />
          <span>{msg.status === "interrupted" ? "This answer was interrupted when the page was closed." : msg.error}</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRetry(msg.id)}>
            <RefreshCw size={14} aria-hidden="true" />
            <span>{msg.auto ? "Try again" : "Search again"}</span>
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

      {working && msg.papers.length === 0 && !msg.papersFinal && msg.step !== "route" ? (
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

/** A long message (a pasted list of references) is shown by its start. */
const SHOWN = 400;

/** The conversation: what was asked, and under each question the reply (steps while it works, the answer, the papers). */
/**
 * An Idea Check in the conversation. While it runs here it is the Idea Check workspace itself: it reads the idea and proposes a search plan, which the person edits and approves
 * before anything is searched, then shows the closest papers and the comparison. After a reload only the idea's text is left (nothing about an idea is stored).
 */
function IdeaTurn({ msg, live, onAgain }: { msg: IdeaMsg; live: boolean; onAgain: (id: string) => void }) {
  return (
    <section className="chat-idea" aria-label="Idea Check">
      <p className="chat-idea-kicker"><Lightbulb size={15} aria-hidden="true" /> <b>Idea Check</b></p>
      {live ? (
        <Suspense fallback={<p className="chat-why" role="status">Opening Idea Check…</p>}>
          <IdeaWorkspace initialText={msg.text} autoPlan embedded />
        </Suspense>
      ) : (
        <p className="chat-why" role="note">
          <span className="chat-why-row">
            <span>This Idea Check was run in an earlier visit. Its search plan and papers are not kept: nothing about an idea is stored.</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onAgain(msg.id)}>
              <RefreshCw size={14} aria-hidden="true" />
              <span>Run it again</span>
            </button>
          </span>
        </p>
      )}
    </section>
  );
}

export function ChatView({ messages, signedIn, liveIdeas, onRetry, onChange, onRefine, onOpenPage, onIdeaAgain }: { messages: ChatMsg[]; signedIn: boolean; liveIdeas: ReadonlySet<string>; onRetry: (id: string, as?: "search") => void; onChange: ChangeTool; onRefine: (text: string) => void; onOpenPage: (to: "idea", text: string) => void; onIdeaAgain: (id: string) => void }) {
  const [flash, setFlash] = useState<{ msgId: string; n: number } | null>(null);
  const list = useRef<HTMLOListElement>(null);

  // a new question: bring it to the top of the window, so the answer that is written under it is what the reader sees (the papers come below it); nothing scrolls after that
  const count = messages.length;
  useLayoutEffect(() => {
    if (count === 0) return;
    // a question goes to the top of the window; an Idea Check that was just opened (from the offer under an earlier question) does too
    const last = messages[messages.length - 1];
    const selector = last?.role === "idea" && messages[messages.length - 2]?.role !== "user" ? ".chat-idea-li" : ".chat-u";
    const targets = list.current?.querySelectorAll<HTMLElement>(selector);
    targets?.[targets.length - 1]?.scrollIntoView({ block: "start", behavior: "auto" });
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
        {messages.map((msg, at) => {
          const before = messages[at - 1];
          return (
            <li key={msg.id} className={msg.role === "user" ? "chat-u" : msg.role === "idea" ? "chat-a chat-idea-li" : "chat-a"}>
              {msg.role === "idea" ? (
                <IdeaTurn msg={msg} live={liveIdeas.has(msg.id)} onAgain={onIdeaAgain} />
              ) : msg.role === "user" ? (
                <m.p className="chat-bubble" initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring}>
                  <Search size={13} aria-hidden="true" /> {msg.text.length > SHOWN ? `${msg.text.slice(0, SHOWN)}…` : msg.text}
                  {msg.text.length > SHOWN && <small className="chat-long"> {msg.text.length.toLocaleString("en-US")} characters, the start is shown</small>}
                </m.p>
              ) : (
                <m.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: easeOut }}>
                  <AssistantTurn msg={msg} text={before?.role === "user" ? before.text : msg.query} signedIn={signedIn} flash={flash} onCite={cite} onRetry={onRetry} onChange={onChange} onRefine={onRefine} onOpenPage={onOpenPage} />
                </m.div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
