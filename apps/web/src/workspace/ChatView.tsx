import { AnimatePresence, m } from "motion/react";
import { ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, FileStack, Info, Lightbulb, ListChecks, Pencil, RefreshCw, Search, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { Fragment, Suspense, lazy, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { GENERAL_LABEL, INDIA_SCOPE_LABEL, MAX_CHAT_CHARS, MAX_VERSIONS, ROUTE_NAMES, answerCopy, busyReason, canTighten, earlierUsed, editInfo, followUpNote, noticeOffersRetry, turnToShow, unfilteredWords, versionInfo, type AssistantMsg, type ChatMsg, type EditInfo, type IdeaMsg, type ChatNoAnswer, type RouteMode, type UserMsg } from "@scholar/shared";
import { SignInDialog } from "../components/SignInDialog";
import { Pop } from "../components/Pop";
import { ResultCard, SkeletonCard } from "../components/ResultCard";
import { StreamingText } from "../components/papers/AskPanel";
import { cancelTighten, editMessage, retryReply, sendMessage, showVersion, tightenReply, type EditResult } from "../lib/chat";
import { useCopy } from "../lib/copy";
import { STARTERS } from "./starters";
import { menuKeys } from "./menuKeys";
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
  small_talk: "",
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
 * A follow-up that was read with the turns before it says what it was read as ("Using your earlier question: …", with a way to search exactly that), and a year range that cut the papers is a chip with a
 * remove button (`followUpNote`); a follow-up that was left as it was says nothing more. A search made from other words than the bubble above it (the question as written, the topic without its years) shows them.
 * `onWords` searches words as written, as a search chosen by hand: the earlier turns cannot be leaned on there, which is why it is given the words that stand alone.
 */
function Understood({ msg, text, working, onChange, onExact, onWords }: { msg: AssistantMsg; text: string; working: boolean; onChange: ChangeTool; onExact: () => void; onWords: (words: string) => void }) {
  const line =
    msg.how === "chosen" ? (
      <>Searching papers, as you chose.</>
    ) : msg.how === "fallback" ? (
      <>{msg.reason === "too_long" ? "I was not sure what to do with this." : "I was not sure what you wanted, so I searched for papers."}</>
    ) : (
      <>I understood this as <b>{ROUTE_NAMES[msg.mode]}</b>.</>
    );
  const others = TOOL_ROWS.filter((t) => t.id !== msg.mode);
  const note = msg.mode === "search" ? followUpNote(msg) : null;
  const used = earlierUsed(msg);
  // the person's own words are not searched on their own when the line above them is the question they were read as: a follow-up's words mean nothing alone
  const exact = msg.mode === "search" && !!msg.searchQuery && !working && text.length <= MAX_CHAT_CHARS && !note?.question;
  const unfiltered = note?.years ? unfilteredWords(msg, text) : null;
  const tidy = (s: string) => s.replace(/\s+/g, " ").trim();
  const searchedAs = msg.how === "chosen" && msg.query.trim() !== "" && tidy(msg.query) !== tidy(text).slice(0, 300) ? msg.query : null;
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
            <div className="chat-change-menu" role="menu" aria-label="Use another tool for this" onKeyDown={menuKeys}>
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
      {note?.question && (
        <p className="chat-und chat-searched chat-ctx">
          Using your earlier question: <b lang={msg.language === "hi" ? "hi" : undefined}>{note.question}</b>
          {note.exact && !working && (
            <>
              {" · "}
              <button type="button" className="link-btn" onClick={() => onWords(note.exact!)}>Use these exact words</button>
            </>
          )}
        </p>
      )}
      {msg.mode === "search" && used.map((q, i) => (
        // a question of another chat that a model read to understand this message (the chat chosen to continue from, or what "Use my earlier chats" found): always said, each with its own way to take it away
        <p key={i} className="chat-und chat-searched chat-earlier">
          Used from your earlier chat: <b>{q.question}</b>
          {!working && (
            <>
              {" · "}
              <button type="button" className="link-btn" aria-label={`Do not use it and search again: remove the earlier question “${q.question}”`} onClick={() => void retryReply(msg.id, undefined, undefined, (msg.earlier ?? []).filter((x) => x !== q))}>Do not use it and search again</button>
            </>
          )}
        </p>
      ))}
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
      {searchedAs && (
        <p className="chat-und chat-searched">
          I searched for: <b>{searchedAs}</b>
        </p>
      )}
      {note?.years && (
        <p className="chat-und chat-searched">
          <span className="chat-chip">
            <span>Papers from {note.years.words}</span>
            {unfiltered && !working && (
              <button type="button" className="chat-chip-x" aria-label={`Remove the year filter (papers from ${note.years.words}) and search again`} title="Remove the year filter and search again" onClick={() => onWords(unfiltered)}>
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </span>
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

/** True for `ms` after `start()`: a state that lasts a moment (the row of actions stays shown for a moment after a copy). The timer goes with the row. */
function useBrief(ms: number): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const start = useCallback(() => {
    setOn(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOn(false), ms);
  }, [ms]);
  return [on, start];
}

/**
 * The words of one polite status line ("Message copied", "Version 2 of 3"). The line is always in the page, empty, because a line that arrives together with its words is not reliably read.
 * The same words said twice are not read again, so a new message empties the line first and writes it a moment later, and the line is emptied again after `keepMs`.
 */
function useSaid(): [string, (words: string, keepMs?: number) => void] {
  const [words, setWords] = useState("");
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const say = useCallback((next: string, keepMs = 4000) => {
    timers.current.forEach((t) => window.clearTimeout(t));
    setWords("");
    timers.current = [window.setTimeout(() => setWords(next), 100), window.setTimeout(() => setWords(""), 100 + keepMs)];
  }, []);
  return [words, say];
}

const COULD_NOT_COPY = "Could not copy. Select the text and copy it.";

/**
 * What a finished search can do: copy the answer (or the papers, for a reply that has no written answer) and search again. Always shown, not on hover, like the other buttons of a reply. The text
 * to copy is built from the reply before the press (`answerCopy`: the checked answer with its marks and the papers it cites, never the words that were still arriving), so the press only writes it.
 */
function ReplyActions({ msg, onRetry }: { msg: AssistantMsg; onRetry: (id: string) => void }) {
  const what = useMemo(() => answerCopy(msg), [msg]);
  const copy = useCopy();
  const [said, say] = useSaid();
  useEffect(() => {
    if (copy.tick > 0) say(copy.state === "copied" ? (what?.what === "papers" ? "Papers copied" : "Answer copied") : COULD_NOT_COPY, 1800);
  }, [copy.tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="chat-acts" role="group" aria-label="What to do with this reply">
      {what && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy.copy(what.text)}>
          {copy.state === "copied" ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          <span>{what.what === "answer" ? "Copy the answer" : "Copy the papers"}</span>
        </button>
      )}
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => onRetry(msg.id)}>
        <RefreshCw size={14} aria-hidden="true" />
        <span>Search again</span>
      </button>
      {copy.state === "failed" && <span className="chat-act-note" role="note">{COULD_NOT_COPY}</span>}
      <p className="sr-only" role="status" aria-live="polite">{said}</p>
    </div>
  );
}

function AssistantTurn({ msg, text, signedIn, flash, onCite, onRetry, onChange, onRefine, onOpenPage }: { msg: AssistantMsg; text: string; signedIn: boolean; flash: { msgId: string; n: number } | null; onCite: (msgId: string, n: number) => void; onRetry: (id: string, as?: "search" | "anyway") => void; onChange: ChangeTool; onRefine: (text: string) => void; onOpenPage: (to: "idea", text: string) => void }) {
  const working = msg.status === "working";
  const byN = (n: number) => msg.papers[n - 1];
  const answer = msg.answer?.grounded ? msg.answer : null;
  const titleOf = (n: number) => byN(n)?.title ?? `paper ${n}`;
  const routed = msg.status === "done" && msg.reason === "routed" && msg.mode !== "search";
  const quiet = useQuiet(msg);
  // A button of this reply was pressed (Search again, Try again, Use these exact words, the year chip's X, an earlier question taken away) and the reply began again in its place: the button was shown only
  // while the reply was not working, so it is gone from the page and the focus has dropped to the page's body (a keyboard user loses their place, a screen reader says nothing). The focus goes to the reply
  // itself, which has a name and stays, whatever the reply does next (it is not the list of steps, which goes when the answer is ready). Only when the focus has nowhere else to be: a press on the box or
  // on a menu that has its own button to return to is left alone.
  const turn = useRef<HTMLDivElement>(null);
  const wasWorking = useRef(working);
  useLayoutEffect(() => {
    if (working && !wasWorking.current && (!document.activeElement || document.activeElement === document.body)) turn.current?.focus({ preventScroll: true });
    wasWorking.current = working;
  }, [working]);
  const announce = working ? "" : msg.status === "done" ? (msg.reason === "small_talk" ? "Reply ready." : routed ? "Understood. A tool can be opened." : `${answer ? "Answer ready" : "Papers ready"}, ${msg.papers.length} ${msg.papers.length === 1 ? "paper" : "papers"}.`) : msg.status === "stopped" ? "Stopped." : msg.error ?? "This answer was interrupted.";

  return (
    <div ref={turn} className="chat-turn" data-status={msg.status} role="group" aria-label={working ? "Reply, being written" : "Reply"} tabIndex={-1}>
      {/* while Auto is still reading the message the step list says so; the line comes once the tool is known (and not at all if the reply failed before that) */}
      {msg.understood !== false && msg.reason !== "small_talk" && <Understood msg={msg} text={text} working={working} onChange={onChange} onExact={() => onRetry(msg.id, "search")} onWords={(words) => void retryReply(msg.id, "search", words)} />}

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

      {!working && !answer && msg.status === "done" && msg.reason && msg.reason !== "routed" && msg.reason !== "small_talk" && (
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
      {msg.status === "done" && msg.reason === "small_talk" && (
        <div className="chat-talk">
          <div className="hm-starters" role="group" aria-label="Example searches">
            <span className="hm-try">Try</span>
            {STARTERS.map((s) => (
              <button key={s} type="button" className="chip-btn" onClick={() => sendMessage(s, "search")}>{s}</button>
            ))}
          </div>
          <p className="chat-talk-any">
            Not small talk? <button type="button" className="link-btn" onClick={() => onRetry(msg.id, "anyway")}>Search for these words anyway</button>
          </p>
        </div>
      )}
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

      {/* a finished search has its own row of actions (not a greeting, and not the offer of another tool, which has its own buttons) */}
      {msg.status === "done" && !routed && msg.reason !== "small_talk" && msg.reason !== "too_long" && <ReplyActions msg={msg} onRetry={onRetry} />}

      {msg.notices.map((n) => (
        <p key={n.kind} className="chat-note" data-kind={n.kind} role="note">
          <TriangleAlert size={14} aria-hidden="true" />
          <span>{n.text}</span>
          {noticeOffersRetry(msg, n) && (
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

/**
 * Calls `onShown` once, when it first appears: placed beside something that loads late, inside the same Suspense, it appears when that does.
 * The effect must return nothing: React takes a returned value for the clean-up, and `scrollIntoView` returns a Promise in current browsers.
 */
function WhenShown({ onShown }: { onShown: () => void }) {
  useEffect(() => {
    onShown();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** A long message (a pasted list of references) is shown by its start. */
const SHOWN = 400;

/** The conversation: what was asked, and under each question the reply (steps while it works, the answer, the papers). */
/**
 * An Idea Check in the conversation. While it runs here it is the Idea Check workspace itself: it reads the idea and proposes a search plan, which the person edits and approves
 * before anything is searched, then shows the closest papers and the comparison. After a reload only the idea's text is left (nothing about an idea is stored).
 */
function IdeaTurn({ msg, live, last, onAgain }: { msg: IdeaMsg; live: boolean; last: boolean; onAgain: (id: string) => void }) {
  const section = useRef<HTMLElement>(null);
  return (
    <section ref={section} className="chat-idea" aria-label="Idea Check">
      <p className="chat-idea-kicker"><Lightbulb size={15} aria-hidden="true" /> <b>Idea Check</b></p>
      {live ? (
        <Suspense fallback={<p className="chat-why" role="status">Opening Idea Check…</p>}>
          <IdeaWorkspace initialText={msg.text} autoPlan embedded />
          {/* the workspace arrives after the section was first scrolled to (the page below it was short then): once it is here, the section goes to the top of the window again, so what the reader has to act on is not under the box */}
          {last && <WhenShown onShown={() => { section.current?.scrollIntoView({ block: "start", behavior: "auto" }); }} />}
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

/** What the editor says when a save is refused. The text stays in the editor; this is the reason, in plain words. */
function whyNot(r: Exclude<EditResult, "sent">, info: EditInfo, length: number, busy: "reply" | "strict" | null): string {
  if (r === "unchanged") return "Nothing has changed. Change the words, or press Cancel.";
  if (r === "invalid") {
    if (length <= info.limit) return "Write at least two letters or numbers.";
    return info.mode === "search" ? `A search is at most ${MAX_CHAT_CHARS} characters (this is ${length}). Shorten it, or press Cancel.` : `This is longer than ${info.limit.toLocaleString("en-US")} characters (it is ${length.toLocaleString("en-US")}).`;
  }
  if (r === "busy") return busy === "strict" ? "A strict check is running. Wait for it, or cancel it, then save again." : busy === "reply" ? "An answer is being written. Wait for it, or press Stop, then save again." : "Please try again in a moment.";
  return "This message can no longer be edited.";
}

/**
 * Editing a message you sent, in place of its bubble: the whole stored text (the bubble shows only its start), its counter, and Cancel and one button that saves and asks again. Enter saves (not
 * with Shift, not while an input method is composing: Hindi is typed that way), Escape cancels. The draft lives here and nowhere else: it is never kept, and never sent unless the person saves.
 * A refusal is said in an alert and the text stays. Before saving it says what the edit puts away (the later messages are kept as a version, an open Idea Check is not).
 */
function Editor({ msg, n, info, busy, ideas, versions, onCancel, onSave }: { msg: UserMsg; n: number; info: EditInfo; busy: "reply" | "strict" | null; ideas: number; versions: number; onCancel: () => void; onSave: (text: string) => EditResult }) {
  const uid = useId();
  const [text, setText] = useState(msg.text);
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const length = text.length;
  const over = length > info.limit;

  // in with the caret at the end, and the buttons clear of the box that sticks to the bottom of the window (the box's margin rule reaches an element with an id)
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
    box.current?.scrollIntoView({ block: "nearest" });
  }, []);
  // as high as its text (up to a limit); a field that is made short for a moment can shorten the page and the browser would move the reader, so the place is put back
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    const y = window.scrollY;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 288)}px`;
    if (window.scrollY !== y) window.scrollTo(0, y);
  }, [text]);

  const save = () => {
    const r = onSave(text);
    if (r !== "sent") setProblem(whyNot(r, info, text.replace(/\s+/g, " ").trim().length, busy));
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div ref={box} id={`${uid}-edit`} className="chat-edit" role="group" aria-label={`Editing your message ${n}`}>
      <label className="sr-only" htmlFor={`${uid}-ta`}>Edit your message {n}</label>
      <textarea
        id={`${uid}-ta`}
        ref={field}
        className="chat-edit-ta"
        rows={2}
        maxLength={20000}
        value={text}
        aria-invalid={over || !!problem ? true : undefined}
        aria-describedby={`${uid}-hint ${uid}-count`}
        onChange={(e) => {
          setText(e.target.value);
          setProblem(null);
        }}
        onKeyDown={onKey}
      />
      <div id={`${uid}-hint`} className="chat-edit-hint">
        <p className="chat-edit-keys">Enter saves and asks again. Shift+Enter adds a line. Escape cancels.</p>
        {info.later > 0 && <p>This replaces {info.later} later {info.later === 1 ? "message" : "messages"}. You can go back to the earlier version.</p>}
        {ideas > 0 && <p>An Idea Check that is open in them will close. Its plan and papers are not kept, so it will offer to run again when you come back to it.</p>}
        {busy === "strict" && <p>A strict check is running. Cancel it, or wait for it, before you save.</p>}
        {versions >= MAX_VERSIONS && <p>Only the {MAX_VERSIONS} latest versions are kept, so saving drops the oldest.</p>}
      </div>
      {problem && <p className="hm-problem" role="alert">{problem}</p>}
      <div className="chat-edit-bar">
        <span id={`${uid}-count`} className="chat-edit-count" data-over={over}>{length.toLocaleString("en-US")} / {info.limit.toLocaleString("en-US")}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
        <button type="button" className="btn btn-primary btn-sm" onClick={save}>Save and resend</button>
      </div>
    </div>
  );
}

const WAIT = { reply: "Wait for the answer, or press Stop.", strict: "Wait for the strict check to finish, or cancel it." } as const;
/** Why Edit and the pager wait while an editor is open on another message: its draft would be lost (a version switch can put that message away), and a draft is never kept anywhere else. */
const HELD = "Another message is being edited. Save it, or press Cancel, first.";

/**
 * A message you sent: its bubble, and under it (outside the bubble, so that a focus ring is not accent on accent) a labelled group with the version pager (only once it has been edited), Copy and
 * Edit. Copy writes the whole stored text, never the start the bubble shows. Edit is not offered for the text echoed with an Idea Check (it has no reply to ask again), and is `aria-disabled` and
 * not `disabled` while an answer is being written or another message is being edited (so that a draft is not lost), with the reason described: a disabled button that has the focus drops out of
 * the tab order. On a pointer that can hover the row is shown
 * by hovering the whole message or focusing a button with the keyboard, and stays shown for a moment after a copy; with more than one version it is always shown (a hidden pager looks like lost data).
 * One polite status line says what happened ("Message copied", "Version 2 of 3. The answers below are from this version.").
 */
function UserTurn({ msg, n, info, busy, held, ideas, editing, onEdit, onClose, onSent, onAnchor }: { msg: UserMsg; n: number; info: EditInfo | null; busy: "reply" | "strict" | null; held: boolean; ideas: number; editing: boolean; onEdit: () => void; onClose: () => void; onSent: () => void; onAnchor: (on: boolean) => void }) {
  const v = versionInfo(msg);
  const uid = useId();
  const [said, say] = useSaid();
  const copy = useCopy();
  const [reopened, reopen] = useBrief(1800);
  const [refused, refuse] = useBrief(4000);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);
  const seen = useRef(false);
  useEffect(() => {
    seen.current = true;
  }, []);
  // the editor closed (Cancel, Escape or a save): the focus goes back to this message's Edit button, and the row stays shown a moment so that the focused button is not out of sight
  useEffect(() => {
    if (wasEditing.current && !editing) {
      editButton.current?.focus({ preventScroll: true });
      reopen();
    }
    wasEditing.current = editing;
  }, [editing, reopen]);
  useEffect(() => {
    if (copy.tick > 0) say(copy.state === "copied" ? "Message copied" : COULD_NOT_COPY, 1800);
  }, [copy.tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const why = busy ? WAIT[busy] : held ? HELD : null; // why the buttons that change the conversation do not act now
  // a press on one of them while it waits: the reason is said where the person looks (a line beside the buttons, for a while) and to a screen reader, not only described to it when the button has the focus
  const decline = () => {
    refuse();
    say(why ?? "", 4000);
  };
  const go = (to: number) => {
    onAnchor(true);
    if (showVersion(msg.id, to) === "switched") say(`Version ${to + 1} of ${v.count}. The answers below are from this version.`);
    else onAnchor(false);
  };
  const save = (text: string): EditResult => {
    const r = editMessage(msg.id, text);
    if (r === "sent") {
      onSent();
      say("Message sent. A new answer is being written.");
    }
    return r;
  };
  const waitId = `${uid}-wait`;
  const wait = why ? waitId : undefined;

  return (
    <>
      {editing && info ? (
        <Editor msg={msg} n={n} info={info} busy={busy} ideas={ideas} versions={v.count} onCancel={onClose} onSave={save} />
      ) : (
        <>
          <m.p className="chat-bubble" initial={seen.current ? false : { opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={spring}>
            <Search size={13} aria-hidden="true" /> {msg.text.length > SHOWN ? `${msg.text.slice(0, SHOWN)}…` : msg.text}
            {msg.text.length > SHOWN && <small className="chat-long"> {msg.text.length.toLocaleString("en-US")} characters, the start is shown</small>}
          </m.p>
          <div className="chat-u-actions" role="group" aria-label={`Your message ${n}`} data-hide={v.count > 1 ? "false" : "true"} data-pin={copy.state !== "idle" || reopened || (refused && !!why) ? "true" : "false"}>
            {v.count > 1 && (
              <div className="chat-ver" role="group" aria-label="Versions of your message">
                <button type="button" className="chat-act" aria-label="Previous version" title={why ?? "Previous version"} aria-disabled={!v.hasPrev || !!why} aria-describedby={wait} onClick={() => (why ? decline() : v.hasPrev && go(v.number - 2))}>
                  <ChevronLeft size={16} aria-hidden="true" />
                </button>
                <span className="chat-ver-n" aria-hidden="true">{v.number} / {v.count}</span>
                <span className="sr-only">Version {v.number} of {v.count}</span>
                <button type="button" className="chat-act" aria-label="Next version" title={why ?? "Next version"} aria-disabled={!v.hasNext || !!why} aria-describedby={wait} onClick={() => (why ? decline() : v.hasNext && go(v.number))}>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </div>
            )}
            <button type="button" className="chat-act" aria-label="Copy your message" title="Copy your message" onClick={() => copy.copy(msg.text)}>
              {copy.state === "copied" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            </button>
            {info && (
              <button ref={editButton} type="button" className="chat-act" aria-label="Edit your message" title={why ?? "Edit your message"} aria-disabled={!!why} aria-describedby={wait} onClick={() => (why ? decline() : onEdit())}>
                <Pencil size={16} aria-hidden="true" />
              </button>
            )}
            {copy.state === "failed" && <span className="chat-act-note" role="note">{COULD_NOT_COPY}</span>}
            {refused && why && <span className="chat-act-note" data-tone="info" role="note">{why}</span>}
          </div>
        </>
      )}
      <p className="sr-only" role="status" aria-live="polite">{said}</p>
      {/* described to the buttons by id, and not in the page's flow: with every message of a long conversation carrying it, a screen reader in browse mode would read the same sentence under each of them */}
      {why && <span id={waitId} hidden>{why}</span>}
    </>
  );
}

export function ChatView({ messages, signedIn, liveIdeas, onRetry, onChange, onRefine, onOpenPage, onIdeaAgain }: { messages: ChatMsg[]; signedIn: boolean; liveIdeas: ReadonlySet<string>; onRetry: (id: string, as?: "search" | "anyway") => void; onChange: ChangeTool; onRefine: (text: string) => void; onOpenPage: (to: "idea", text: string) => void; onIdeaAgain: (id: string) => void }) {
  const [flash, setFlash] = useState<{ msgId: string; n: number } | null>(null);
  const list = useRef<HTMLOListElement>(null);
  /** The message whose editor is open (one at a time), and the one whose edit was just sent. */
  const [editing, setEditing] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  /** Where the row of buttons of a message was when its pager was pressed, so that another version of the messages below it does not move what the reader is looking at. */
  const anchor = useRef<{ id: string; top: number } | null>(null);
  const shown = useRef<readonly ChatMsg[] | null>(null);
  const busy = busyReason(messages);
  const rowOf = (id: string) => list.current?.querySelector<HTMLElement>(`[data-msg="${id}"]`) ?? null;
  /** The top of a message's row of buttons: the thing the reader pressed, which must stay where their pointer is (the bubble above it can be taller or shorter in another version). */
  const buttonsTop = (id: string) => rowOf(id)?.querySelector(".chat-u-actions")?.getBoundingClientRect().top;

  // another version of a message was brought back: the messages below it are others, and the page keeps the pager where it was (the browser cannot tell that it is the same thing)
  useLayoutEffect(() => {
    const a = anchor.current;
    if (!a) return;
    anchor.current = null;
    const top = buttonsTop(a.id);
    if (top !== undefined && Math.abs(top - a.top) > 1) window.scrollBy(0, top - a.top);
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // a new question: bring it to the top of the window, so the answer that is written under it is what the reader sees (the papers come below it); nothing scrolls after that.
  // It is a question or an Idea Check ADDED at the end (or a conversation opened), not any change of the list: another version of a message, a reply written again or an edit must not move the page.
  useLayoutEffect(() => {
    const what = turnToShow(shown.current, messages);
    shown.current = messages;
    if (!what) return;
    const targets = list.current?.querySelectorAll<HTMLElement>(what === "idea" ? ".chat-idea-li" : ".chat-u");
    targets?.[targets.length - 1]?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [messages]);

  // an edit that was sent: the edited question goes to the top of the window, with its new answer written under it (the list did not grow, so the effect above does not take it there)
  useLayoutEffect(() => {
    if (!sent) return;
    rowOf(sent)?.scrollIntoView({ block: "start", behavior: "auto" });
    setSent(null);
  }, [sent]); // eslint-disable-line react-hooks/exhaustive-deps

  // an editor whose message is gone (another conversation was opened) is closed
  useEffect(() => {
    if (editing && !messages.some((x) => x.id === editing)) setEditing(null);
  }, [messages, editing]);

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
            // the item is keyed by the message's id, which an edited message keeps: it is the same place whichever version is being read, so a focused pager button is not lost when another version comes in
            <li key={msg.id} data-msg={msg.id} className={msg.role === "user" ? "chat-u" : msg.role === "idea" ? "chat-a chat-idea-li" : "chat-a"}>
              {msg.role === "idea" ? (
                <IdeaTurn msg={msg} live={liveIdeas.has(msg.id)} last={at === messages.length - 1} onAgain={onIdeaAgain} />
              ) : msg.role === "user" ? (
                <UserTurn
                  msg={msg}
                  n={messages.slice(0, at + 1).filter((x) => x.role === "user").length}
                  info={editInfo(messages, msg.id)}
                  busy={busy}
                  held={editing !== null && editing !== msg.id}
                  ideas={editing === msg.id ? messages.slice(at + 1).filter((x) => x.role === "idea" && liveIdeas.has(x.id)).length : 0}
                  editing={editing === msg.id}
                  onEdit={() => setEditing(msg.id)}
                  onClose={() => setEditing(null)}
                  onSent={() => {
                    setEditing(null);
                    setSent(msg.id);
                  }}
                  onAnchor={(on) => {
                    const top = on ? buttonsTop(msg.id) : undefined;
                    anchor.current = top === undefined ? null : { id: msg.id, top };
                  }}
                />
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
