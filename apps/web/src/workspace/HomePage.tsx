import { m } from "motion/react";
import { ArrowUp, Bookmark, Check, ChevronDown, EyeOff, FileStack, Landmark, Lightbulb, ListChecks, MessageSquare, MoreHorizontal, Plus, RefreshCw, Search, Sparkles, Square, TriangleAlert, X } from "lucide-react";
import { Component, Suspense, lazy, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type Dispatch, type KeyboardEvent, type ReactNode, type RefObject, type SetStateAction } from "react";
import { INDIA_SCOPE_HELP, INDIA_SCOPE_LABEL, MAX_CHAT_CHARS, MIN_IDEA_CHARS, textAttrs, yearRangeWords, type MemoryEntry, type RouteMode, type SearchScope } from "@scholar/shared";
import { useAuth } from "../lib/auth";
import { useGrowingField } from "../lib/autogrow";
import { reportError } from "../lib/monitoring";
import { coverUrl, loadDocs, useDocs } from "../lib/documents";
import { useLibrary } from "../lib/library";
import { easeOut, springPop, stagger } from "../lib/motion";
import { PAPERS_NAME, putHandoff } from "../lib/workspace";
import { Pop } from "../components/Pop";
import { ContinueReading, RememberThis } from "./HomeExtras";
import type { ChatView as ChatViewType } from "./ChatView";
import { continueFromChat, continuedFrom, deleteChat, isPrivateChat, resumeChat, retryReply, reviveIdea, sendMessage, startIdeaCheck, startNewChat, startPrivateChat, stopContinuing, stopReply, useChatState, useConversing } from "../lib/chat";
import { startersFor, starterMode } from "./starters";
import { menuKeys } from "./menuKeys";
import { TrendingChips, TryChips } from "./HomeChips";
import { Announcer, announce } from "./announcer";
import { askForTrending, currentTrending } from "../lib/trending";
import { fillChip, putBack, reconcileDraft, trendingRow, type Draft, type ShownChip } from "@scholar/shared/src/trending-row";

// The conversation (the answers, the paper cards, the message actions) is a chunk of its own: the first load has a size budget (apps/web/scripts/budget.mjs) and a visitor's first
// screen is the empty box, which does not need it. It is asked for as soon as the first screen is drawn and the browser has nothing else to do, and at once when the box is focused, so that by the
// time a question is sent it is here; a question sent before that is drawn the moment the chunk arrives (the message is already in the state, so nothing is lost). While it is awaited only a screen
// reader is told ("Loading the conversation…"): a visible line moved the help line under the box (layout shift 0.035 on a phone that reloaded with a conversation in it, measured 3 Nov 2026).
type ChatViewProps = ComponentProps<typeof ChatViewType>;
let chatViewLoaded: typeof ChatViewType | null = null;
/** The error of a chunk that could not be fetched, while it stands (a retry clears it): what tells a failed fetch from a bug in the conversation's own drawing. */
let chatViewFailure: unknown = null;
const loadChatView = () =>
  import("./ChatView").then(
    (m) => ((chatViewLoaded = m.ChatView), m),
    (e: unknown) => {
      chatViewFailure = e;
      throw e;
    },
  );
// `let`: React.lazy keeps a rejected import for good, so a retry needs a new one
const makeLazy = () => lazy(() => loadChatView().then((m) => ({ default: m.ChatView })));
let LazyChatView = makeLazy();
const warmChatView = () => void loadChatView().catch(() => undefined);

/**
 * The conversation's place when its chunk cannot be fetched (the network went away between the page and the chunk, or a deploy replaced the file under a tab that was opened before it): it says so, in the place of
 * the conversation, with a way to try again. Before this the failure went to the one boundary of the whole app, which replaced the rail, the box and every page with "Something went wrong". Anything else that
 * throws while the conversation is drawn is not this and goes on to that boundary as before.
 */
class ChatViewBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { error: unknown }> {
  state: { error: unknown } = { error: null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  componentDidCatch(error: unknown) {
    reportError(error);
  }
  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (error !== chatViewFailure) throw error;
    return (
      <div className="ask-error" role="alert">
        <TriangleAlert size={16} aria-hidden="true" />
        <span>The conversation could not be loaded. Check your connection, then try again. What you asked is kept.</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={this.props.onRetry}>
          <RefreshCw size={14} aria-hidden="true" />
          <span>Try again</span>
        </button>
      </div>
    );
  }
}

/**
 * The conversation. Once its chunk is here it is drawn in the very commit that shows the conversation, as it was when it was part of the page: a lazy component always takes one more turn, and a
 * question sent in that turn was scrolled to when the page was already full of the answer (the stand-in server answers at once), not when it held only the question. A conversation that is shown
 * before the chunk has come waits for it (and keeps the lazy one for as long as it is shown, so that nothing is drawn again when the chunk arrives).
 */
function ChatViewSlot(props: ChatViewProps) {
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    chatViewFailure = null;
    LazyChatView = makeLazy();
    setAttempt((n) => n + 1);
  };
  return (
    <ChatViewBoundary key={attempt} onRetry={retry}>
      <ChatViewIn {...props} />
    </ChatViewBoundary>
  );
}
function ChatViewIn(props: ChatViewProps) {
  const [Chosen] = useState(() => chatViewLoaded ?? LazyChatView);
  return Chosen === LazyChatView ? (
    <Suspense fallback={<p className="sr-only" role="status">Loading the conversation…</p>}>
      <LazyChatView {...props} />
    </Suspense>
  ) : (
    <Chosen {...props} />
  );
}

/**
 * Auto, and the four tools. With Auto (the default) the router reads the message and chooses (W3); a tool chosen by hand is never overridden.
 * Search papers runs in this screen; the others open the page that does the work, with what was written.
 */
export type Tool = "auto" | RouteMode;
const TOOLS: { id: Tool; name: string; short: string; help: string; placeholder: string; Icon: typeof Search }[] = [
  { id: "auto", name: "Auto", short: "Auto", help: "I choose the right tool from what you write, and say what I chose. You can change it.", placeholder: "Ask a question, paste references, or describe an idea…", Icon: Sparkles },
  { id: "search", name: "Search papers", short: "Search", help: "Real records with a checked DOI, retractions flagged.", placeholder: "Ask about a topic, or paste a DOI…", Icon: Search },
  { id: "verify", name: "Check references", short: "References", help: "Paste a bibliography: does each reference exist, and does it say what you cited?", placeholder: "Paste your references, one per line…", Icon: ListChecks },
  { id: "idea", name: "Idea Check", short: "Idea", help: "Closest papers, part by part, and the gaps. Never a verdict on novelty.", placeholder: "Describe your idea in a few sentences…", Icon: Lightbulb },
  { id: "paper", name: "Ask a paper", short: "Papers", help: "Answers from your own papers, with the page and the exact quote.", placeholder: "Open My Workspace to ask one of your papers…", Icon: FileStack },
];

/** The "Indian sources" switch is remembered on this device (a convenience: without storage it simply starts off). */
const SCOPE_KEY = "scholar.scope";
const readScope = (): SearchScope => {
  try {
    return localStorage.getItem(SCOPE_KEY) === "india" ? "india" : "all";
  } catch {
    return "all";
  }
};
const keepScope = (s: SearchScope) => {
  try {
    if (s === "india") localStorage.setItem(SCOPE_KEY, s);
    else localStorage.removeItem(SCOPE_KEY);
  } catch {
    /* nothing to keep it in */
  }
};

/** Whether this device was signed in last time (the page's own note, written when who is here becomes known): so that the Try chips are the same ones at the first paint and after the check. */
const signedHint = (): boolean => {
  try {
    return localStorage.getItem("scholar.signedin") === "1";
  } catch {
    return false;
  }
};

/**
 * The two rows of chips under the box. Try: the owner's example searches, always; a click sends one. Trending: only when a fresh list is in hand when Home is drawn (the answer of an earlier visit, kept by
 * `lib/trending.ts`) and it still is; a click FILLS the box and sends nothing. The list is read once, when this is drawn, and not again while it is shown (an answer that arrives later is for the next time
 * Home is drawn), so nothing here ever changes under a reader; when the list runs out while the page is open the row goes (a stale list is never called trending).
 */
function HomeChips({ signedIn, india, busy, onTry, onFill }: { signedIn: boolean; india: boolean; busy: boolean; onTry: (text: string) => void; onFill: (chip: ShownChip, viaKeyboard: boolean) => void }) {
  const [payload] = useState(currentTrending);
  const [out, setOut] = useState(false);
  useEffect(() => {
    // after the first screen is drawn and the browser is idle: ask for the list, for the NEXT time Home is drawn
    return askForTrending();
  }, []);
  useEffect(() => {
    if (!payload) return;
    const left = Date.parse(payload.validUntil) - Date.now();
    if (!(left > 0)) return setOut(true);
    const t = window.setTimeout(() => setOut(true), Math.min(left, 2 ** 31 - 1));
    return () => window.clearTimeout(t);
  }, [payload]);
  const row = useMemo(() => (out ? null : trendingRow(payload, Date.now(), india)), [payload, india, out]);
  return (
    <>
      <TryChips chips={startersFor(signedIn)} onPick={onTry} disabled={busy} />
      {row && <TrendingChips row={row} onFill={onFill} />}
    </>
  );
}

/** The year filter in the words the reply uses for the same filter (ChatView: "Papers from 2025 or later"): one filter, one wording before the search and after it. */
const yearWords = (year: number): string => yearRangeWords(year) ?? `${year} or later`;

const greeting = (name: string | null) => {
  const h = new Date().getHours();
  const part = h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
};

function ModeMenu({ tool, onChange }: { tool: Tool; onChange: (t: Tool) => void }) {
  const current = TOOLS.find((t) => t.id === tool)!;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = refs.current.findIndex((b) => b === document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); refs.current[(i + 1) % TOOLS.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); refs.current[(i - 1 + TOOLS.length) % TOOLS.length]?.focus(); }
  };
  return (
    <Pop
      label="What should I do?"
      align="start"
      trigger={(open) => (
        <button type="button" className="hm-mode" aria-haspopup="menu" aria-expanded={open}>
          <current.Icon size={16} aria-hidden="true" />
          <span>{current.name}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </button>
      )}
    >
      {(close) => (
        <div role="menu" aria-label="What should I do?" className="hm-menu" onKeyDown={onKey}>
          {TOOLS.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => { refs.current[i] = el; }}
              type="button"
              role="menuitemradio"
              aria-checked={t.id === tool}
              className="hm-menu-item"
              autoFocus={t.id === tool}
              onClick={() => { onChange(t.id); close(); }}
            >
              <span className="hm-menu-ico"><t.Icon size={16} aria-hidden="true" /></span>
              <span className="hm-menu-txt"><b>{t.name}</b><small>{t.help}</small></span>
              <Check size={16} className="hm-tick" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </Pop>
  );
}

/**
 * The box's other choices (docs/design/chat-actions-context.md, section 6), in a menu of their own: start a private chat (not kept, not used as memory), and, for a signed-in person, continue from an
 * earlier chat (a new chat that carries that chat's last three questions until the chip is removed). Both are plain buttons in a menu, so the keyboard reaches them with the arrow keys as in the tool menu.
 */
function ChatMenu({ chats, signedIn, onContinue, onPrivate }: { chats: readonly MemoryEntry[]; signedIn: boolean; onContinue: (id: string) => void; onPrivate: () => void }) {
  return (
    <Pop
      label="Chat options"
      align="start"
      trigger={(open) => (
        <button type="button" className="icon-btn hm-more" aria-label="Chat options" title="Continue from an earlier chat, or start a private chat" aria-haspopup="menu" aria-expanded={open}>
          <MoreHorizontal size={18} aria-hidden="true" />
        </button>
      )}
    >
      {(close) => (
        <div role="menu" aria-label="Chat options" className="hm-menu" onKeyDown={menuKeys}>
          <button type="button" role="menuitem" className="hm-menu-item" autoFocus onClick={() => { onPrivate(); close(); }}>
            <span className="hm-menu-ico"><EyeOff size={16} aria-hidden="true" /></span>
            <span className="hm-menu-txt"><b>Private chat</b><small>Not kept, and not used as memory. It is gone when you leave it.</small></span>
          </button>
          {signedIn && (
            <div role="group" aria-labelledby="hm-continue-h">
              <p className="ws-nav-h" id="hm-continue-h">Continue from an earlier chat</p>
              {chats.length === 0 && <p className="hm-fine">No earlier chat is kept in this browser.</p>}
              <div className="hm-menu-list">
                {chats.map((e) => (
                  <button key={e.id} type="button" role="menuitem" className="hm-menu-item" onClick={() => { onContinue(e.id); close(); }}>
                    <span className="hm-menu-ico"><MessageSquare size={16} aria-hidden="true" /></span>
                    <span className="hm-menu-txt"><b>{e.title}</b></span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Pop>
  );
}

/**
 * The home screen: one prompt box. With Auto the router chooses the tool from what you write; with the menu or the pills you choose it yourself.
 * A search is answered in this screen (the conversation below the box); the other tools open on their own page with your text.
 */
export function HomePage({ query, onQuery, kept, setDraft, onOpenTool, onOpenPaper, inputRef }: { query: string; onQuery: (v: string) => void; /** what belongs to the text in the box besides the text (the Trending chip's year filter, the words it replaced): kept by the page above, next to `query`, so that both outlive this screen */ kept: Draft; setDraft: Dispatch<SetStateAction<Draft>>; onOpenTool: (t: "verify" | "idea" | "papers") => void; onOpenPaper: (id: string) => void; inputRef: RefObject<HTMLTextAreaElement | null> }) {
  const { user, status } = useAuth();
  const docs = useDocs();
  const saved = useLibrary().length;
  const [tool, setTool] = useState<Tool>("auto");
  // only searches use it: Auto (when it searches) and Search papers
  const [scope, setScope] = useState<SearchScope>(readScope);
  const scoped = tool === "auto" || tool === "search";
  const india = scoped && scope === "india";
  const toggleScope = () => {
    const next: SearchScope = scope === "india" ? "all" : "india";
    setScope(next);
    keepScope(next);
    inputRef.current?.focus();
  };
  const id = useId();
  const current = TOOLS.find((t) => t.id === tool)!;
  // the conversation of this tab: the box glides to the bottom once there is one
  const chat = useChatState();
  const messages = chat.active ? chat.chats.get(chat.active) ?? [] : [];
  const conversing = useConversing();
  const busy = !!chat.active && chat.running.has(chat.active);
  const priv = isPrivateChat(chat);
  // A conversation that is being read from the browser's storage (a reload, or a chat opened from the rail) has its frame, the title and the box, from the first frame: the page does not draw the greeting for a
  // moment and then change into a conversation. Its messages come when they are read and the chunk of the conversation has arrived (a layout shift of 0.15 on a desktop that reloaded with a conversation in it, measured 3 Nov 2026).
  const resuming = !conversing && !!chat.active && !priv && !chat.chats.has(chat.active) && chat.index.some((e) => e.id === chat.active);
  const framed = conversing || resuming;
  // the box's position is measured (and glides) only when the page changes between the empty Home and a conversation, not for every message and every word of a reply: the box sticks to the bottom of the window by itself, and
  // the measurement took the box's place in the DOCUMENT, so a page that scrolled from the top of a long chat to its end to show the new question made the box fly in from tens of thousands of pixels away (the page followed the caret into it)
  const glide = useMemo(() => ({}), [framed]);
  const from = continuedFrom(chat);
  const title = priv ? "Private chat" : chat.index.find((e) => e.id === chat.active)?.title ?? "New chat";
  const [problem, setProblem] = useState<string | null>(null);
  // What a Trending chip adds to the box: the year filter, the text it replaced (so that it can be put back) and what it put there (docs/design/chatview-and-trending.md, T9; the rules are `fillChip` and
  // `reconcileDraft`, which are tested). The filter belongs to the box: it is shown beside it, goes with the text when the box is emptied, and is sent only with a search (Auto and Search papers). It lives in
  // `App` next to the text (`kept`, `setDraft`): the text outlives this screen (a page was opened from Home and the browser's Back button came back), and a filter that did not would leave the words of a chip
  // in the box without the filter that makes them a search of recent papers, and the person's own words gone for good.
  const [filledAt, setFilledAt] = useState(0);
  // how the last fill is to leave the box: "pointer" (a finger or a mouse: on a touch screen no keyboard is raised) or "focus" (the keyboard pressed the chip, or Put back what I wrote: the person is typing)
  const fill = useRef<"pointer" | "focus">("pointer");
  const boxRef = useRef<HTMLFormElement>(null);
  // the anchor on the box's top edge that the arrow to the latest message is drawn into (ChatView.tsx): a conversation has it
  const [jumpSlot, setJumpSlot] = useState<HTMLElement | null>(null);
  // an emptied box has no filter, in the very render in which it is emptied (the state follows)
  const draft = useMemo(() => reconcileDraft(query, kept), [query, kept]);
  useEffect(() => {
    if (draft !== kept) setDraft(draft);
  }, [draft, kept]);
  const yearChip = scoped && draft.since !== null ? draft.since : null;
  const signedIn = status === "ready" ? !!user : signedHint();
  useEffect(() => resumeChat(), []);
  // a conversation is being opened: its chunk is asked for now, not when its messages have been read
  useEffect(() => {
    if (resuming) warmChatView();
  }, [resuming]);
  useEffect(() => {
    // once the first screen is drawn and the browser is idle: the chunk of the conversation (a browser without requestIdleCallback waits a moment instead)
    if (typeof window.requestIdleCallback === "function") {
      const h = window.requestIdleCallback(warmChatView, { timeout: 3000 });
      return () => window.cancelIdleCallback(h);
    }
    const t = window.setTimeout(warmChatView, 1500);
    return () => window.clearTimeout(t);
  }, []);
  // A note of what is wrong with the text is taken away when the text or the tool changes. The setter is called only when there IS a note: called on every key (as it was, `setProblem(null)` with nothing to clear) it
  // leaves an update waiting after each key's render (React does not skip it: the shortcut for "the same value" does not hold while the component has work pending), and React counts the renders that end with an
  // update waiting: fifty keys that arrive with no frame between them (a held key after a long task, a tool that types for a person) ended in "Maximum update depth exceeded" (error 185) and the error page.
  useEffect(() => {
    if (problem !== null) setProblem(null);
  }, [query, tool]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (status === "ready" && user) void loadDocs();
  }, [status, user?.id]);

  // the box is as high as its text up to 220 px, then it scrolls (with no scroll bar of the browser's)
  useGrowingField(inputRef, query, 220, true, true);

  const ready = query.trim().length >= (tool === "auto" || tool === "search" ? 2 : 1) && tool !== "paper";
  const send = () => {
    const text = query.trim();
    if (tool === "paper") return onOpenTool("papers");
    if (!text) return;
    if (tool === "auto" || tool === "search") {
      if (busy) return;
      if (tool === "search" && text.length > MAX_CHAT_CHARS) return setProblem(`A search is at most ${MAX_CHAT_CHARS} characters (this is ${text.length}). For a longer text, choose Auto, Check references or Idea Check.`);
      const r = sendMessage(text, tool, india ? "india" : "all", scoped ? draft.since : null);
      if (r === "sent") onQuery("");
      else if (r === "invalid") setProblem("Write at least two letters or numbers.");
      return;
    }
    if (tool === "idea") {
      // Idea Check works inside the conversation: the idea goes in as a message, and the workspace opens under it (the search waits for approval there)
      const r = startIdeaCheck(text, { echo: true });
      if (r === "sent") onQuery("");
      else if (r === "invalid") setProblem(`Write a few sentences about your idea (at least ${MIN_IDEA_CHARS} characters).`);
      return;
    }
    putHandoff(tool, text);
    onOpenTool(tool);
  };
  /** "I understood this as … Change": the same text, given to the tool the reader chose instead. Search papers runs here, with the exact words; the others open on their own page. */
  const changeMode = (to: RouteMode, replyId: string, text: string) => {
    if (to === "search") return void retryReply(replyId, "search");
    if (to === "paper") return onOpenTool("papers");
    if (to === "idea") {
      if (startIdeaCheck(text) === "invalid") setProblem(`Write a few sentences about your idea (at least ${MIN_IDEA_CHARS} characters).`);
      return;
    }
    putHandoff(to, text);
    onOpenTool(to);
  };
  /** The same text on the tool's own page (the offer card's second button). */
  const openPage = (to: "idea", text: string) => {
    putHandoff(to, text);
    onOpenTool(to);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!busy) send();
    }
  };

  /** A Try chip: sent at once, as an English chip always was (a search chosen by hand) or, for a Hinglish one, through Auto; in the place the switch under the box says; not while a reply is being written. */
  const tryStarter = (text: string) => {
    if (busy) return;
    sendMessage(text, starterMode(text), india ? "india" : "all");
  };
  /**
   * A Trending chip: its exact words go into the box and nothing is sent. A phrase is a search, so a tool that is not one (Check references, Idea Check, a paper) gives way to Auto. `viaKeyboard`: the chip was
   * pressed with Enter or Space (a click with no pointer behind it, `detail` 0): a hardware keyboard is in use, so the focus goes to the box whatever the primary pointer is (a tablet with a keyboard is a
   * touch device by `(pointer: coarse)`, which says nothing about this press).
   */
  const fillFromChip = (chip: ShownChip, viaKeyboard = false) => {
    const r = fillChip(query, draft, chip);
    setDraft(r.draft);
    if (!scoped) setTool("auto");
    fill.current = viaKeyboard ? "focus" : "pointer";
    onQuery(r.text);
    setFilledAt((n) => n + 1);
    announce(`“${r.text}” is in the box, for papers from ${yearWords(chip.sinceYear)}. Change the words if you like, then press search.`);
  };
  // the box has its new words, and the box is brought into view whatever pointer pressed (the Trending row is far below it: on a phone about 980 px, so the box is usually above the window, and a fill that
  // changed nothing on the screen was a fill nobody could see; `scroll-margin-top` on the box keeps it clear of the bar of the window). The caret goes to the end of the words, ready to type. The box takes the
  // focus unless a finger pressed on a touch screen: there the keyboard is NOT raised (the person may want to read what the chip put there first; how the keyboard sits against the box has not been tried on a
  // real phone)
  useLayoutEffect(() => {
    if (!filledAt) return;
    const el = inputRef.current;
    if (!el) return;
    const end = el.value.length;
    try {
      boxRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
      if (fill.current === "pointer" && window.matchMedia("(pointer: coarse)").matches) {
        el.setSelectionRange(end, end);
      } else {
        el.focus({ preventScroll: true });
        el.setSelectionRange(end, end);
      }
    } catch {
      /* a field that cannot take a caret */
    }
  }, [filledAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const removeYear = () => {
    setDraft((d) => ({ ...d, since: null }));
    inputRef.current?.focus();
  };
  const putTextBack = () => {
    const r = putBack(draft);
    if (!r) return;
    setDraft(r.draft);
    fill.current = "focus"; // the button that was pressed is gone from the page: the focus is put in the box, as the other buttons of this bar (the year's X, Continuing from) do
    onQuery(r.text);
    setFilledAt((n) => n + 1);
    announce("Your own words are back in the box.");
  };

  const covers = useMemo(() => docs.items.filter((d) => d.hasCover).slice(0, 3), [docs.items]);
  const rise = (i: number) => ({ initial: { opacity: 0, y: 16 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.6, ease: easeOut, delay: 0.06 + stagger(i, 0.08) } });

  return (
    <section className="hm" data-chat={framed} aria-labelledby="hm-h">
      {framed ? (
        <header className="chat-head">
          <h1 id="hm-h" className="chat-title" {...textAttrs(title, true)}>{title}</h1>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { startNewChat(); onQuery(""); window.setTimeout(() => inputRef.current?.focus(), 0); }}>
            <Plus size={15} aria-hidden="true" />
            <span>New chat</span>
          </button>
        </header>
      ) : (
        <>
      <div className="orbs" aria-hidden="true">
        <span className="orb orb-1" />
        <span className="orb orb-2" />
      </div>
      <m.p className="hm-greet" {...rise(0)}><i aria-hidden="true" />{greeting(user?.name ?? null)}</m.p>
      <m.h1 id="hm-h" className="hm-title" {...rise(1)}>
        What would you like to{" "}
        <span className="hero-em">
          look into
          <svg className="hero-underline" viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden="true">
            <m.path d="M3 8c22-6 48-7 62-4s34 3 52-1" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: easeOut, delay: 0.6 }} />
          </svg>
        </span>
        ?
      </m.h1>
      <m.p className="hm-sub" {...rise(2)}>Search real papers, check a bibliography, test an idea against the literature, or open one of your own papers.</m.p>
        </>
      )}

      {conversing && priv && <p className="chat-und" role="note">Private chat: it is not kept, and not used as memory. It is gone when you leave it.</p>}
      {resuming && <p className="sr-only" role="status">Loading the conversation…</p>}
      {conversing && (
        <ChatViewSlot jumpSlot={jumpSlot} messages={messages} signedIn={!!user} onRetry={(rid, as) => void retryReply(rid, as)} liveIdeas={chat.liveIdeas} onOpenPage={openPage} onIdeaAgain={reviveIdea} onChange={changeMode} onRefine={(t) => { onQuery(t); window.setTimeout(() => inputRef.current?.focus(), 0); }} onDelete={() => { if (chat.active) deleteChat(chat.active); }} />
      )}

      {/* the box's layout is measured when the conversation changes (the glide to the bottom, then as the answer grows the page) and not on every letter typed: measured on every render, which is the
          default, a long question typed after a search ended in React's limit of 50 nested updates ("Maximum update depth exceeded", error 185) */}
      <m.form ref={boxRef} className="hm-box" layout="position" layoutDependency={glide} transition={{ type: "spring", stiffness: 260, damping: 30 }} onSubmit={(e) => { e.preventDefault(); if (busy) stopReply(); else send(); }} {...(framed ? {} : rise(3))}>
        {framed && <div ref={setJumpSlot} className="hm-jump" />}
        {(from || (priv && !conversing) || yearChip !== null || draft.undo) && (
          // what the next message is sent with, or not kept: always in view, each with its own button to take it away (the two choices of a chat replace each other; the year of a Trending chip is a third thing, and so is
          // the way back to the words a chip replaced)
          <div className="hm-bar hm-bar-top">
            {(from || (priv && !conversing)) && (
              <span className="chat-chip">
                <span id={`${id}-chip`}>{from ? <>Continuing from: <b>{from.title}</b>{tool === "auto" ? "" : " (used in Auto only)"}</> : "Private chat: not kept, not used as memory"}</span>
                <button type="button" className="chat-chip-x" aria-label={from ? `Stop continuing from ${from.title}` : "Make this a normal chat again"} onClick={() => { if (from) stopContinuing(); else startNewChat(); inputRef.current?.focus(); }}>
                  <X size={14} aria-hidden="true" />
                </button>
              </span>
            )}
            {yearChip !== null && (
              <span className="chat-chip" data-kind="since">
                <span id={`${id}-since`}>Papers from {yearWords(yearChip)}</span>
                <button type="button" className="chat-chip-x" aria-label={`Remove the year filter (papers from ${yearWords(yearChip)})`} onClick={removeYear}>
                  <X size={14} aria-hidden="true" />
                </button>
              </span>
            )}
            {draft.undo && (
              <button type="button" className="link-btn hm-putback" onClick={putTextBack}>Put back what I wrote</button>
            )}
          </div>
        )}
        <label className="sr-only" htmlFor={`${id}-in`}>Your question or text</label>
        <textarea
          id={`${id}-in`}
          ref={inputRef}
          className="hm-input"
          dir="auto"
          rows={1}
          value={query}
          placeholder={current.placeholder}
          disabled={tool === "paper"}
          aria-invalid={problem ? true : undefined}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onKey}
          onFocus={warmChatView}
          aria-describedby={[from || (priv && !conversing) ? `${id}-chip` : "", yearChip !== null ? `${id}-since` : "", `${id}-help`].filter(Boolean).join(" ")}
          maxLength={20000}
        />
        <div className="hm-bar">
          <ModeMenu tool={tool} onChange={setTool} />
          <ChatMenu
            signedIn={!!user}
            chats={chat.index.filter((e) => e.id !== chat.active)}
            // what was typed stays in the box: these two are a setting for the NEXT message (often the one just written, which is why the person chose "private" after typing it), not a start over
            onContinue={(sid) => { if (continueFromChat(sid)) window.setTimeout(() => inputRef.current?.focus(), 0); }}
            onPrivate={() => { startPrivateChat(); window.setTimeout(() => inputRef.current?.focus(), 0); }}
          />
          {scoped && (
            <button type="button" className="hm-scope" aria-pressed={scope === "india"} onClick={toggleScope} title={INDIA_SCOPE_HELP}>
              <Landmark size={15} aria-hidden="true" />
              <span>{INDIA_SCOPE_LABEL}</span>
            </button>
          )}
          <m.button type="submit" className="hm-send" data-busy={busy} aria-label={busy ? "Stop answering" : tool === "paper" ? `Open ${PAPERS_NAME}` : `${current.name}: send`} disabled={!busy && tool !== "paper" && !ready} whileTap={{ scale: 0.92 }} transition={springPop}>
            {busy ? <Square size={15} fill="currentColor" aria-hidden="true" /> : <ArrowUp size={18} aria-hidden="true" />}
          </m.button>
        </div>
      </m.form>
      {problem && <p className="hm-problem" role="alert">{problem}</p>}
      <p className="hm-fine" id={`${id}-help`}>{india ? `${INDIA_SCOPE_LABEL} is on: ${INDIA_SCOPE_HELP.charAt(0).toLowerCase()}${INDIA_SCOPE_HELP.slice(1)}` : current.help} AI can misread a paper; every paper listed is a real record.</p>

      {!framed && (
        <>

      {/* the chips come right under the box (they were the last thing on the page, a screen below it on a phone): Try, then Trending when there is a fresh list */}
      <m.div className="hm-chips" {...rise(4)}>
        <HomeChips signedIn={signedIn} india={india} busy={busy} onTry={tryStarter} onFill={fillFromChip} />
      </m.div>
      <Announcer />

      <m.div className="hm-pills" role="group" aria-label="Choose a tool" {...rise(5)}>
        {TOOLS.filter((t) => t.id !== "auto").map((t) => (
          // a second press on the tool that is already chosen gives the choice back to Auto
          <button key={t.id} type="button" className="hm-pill" aria-pressed={tool === t.id} onClick={() => { setTool(tool === t.id ? "auto" : t.id); inputRef.current?.focus(); }}>
            <span className="hm-pill-ico"><t.Icon size={15} aria-hidden="true" /></span>
            {t.name}
          </button>
        ))}
      </m.div>

      <m.div className="hm-cards" {...rise(6)}>
        {user ? (
          <button type="button" className="hm-card" onClick={() => onOpenTool("papers")}>
            <span className="hm-k">{PAPERS_NAME}</span>
            <strong>{docs.items.length > 0 ? `${docs.items.length} ${docs.items.length === 1 ? "paper" : "papers"} to read and ask` : "Upload a paper and ask it questions"}</strong>
            {covers.length > 0 ? (
              <span className="hm-stack" aria-hidden="true">
                {covers.map((d, i) => <img key={d.id} src={coverUrl(d)} alt="" loading="lazy" decoding="async" style={{ ["--r" as string]: `${[-6, 2, 8][i]}deg` }} />)}
              </span>
            ) : (
              <span className="hm-meta">PDFs, Word and scans are read in your browser</span>
            )}
          </button>
        ) : (
          <button type="button" className="hm-card" onClick={() => onOpenTool("papers")}>
            <span className="hm-k">{PAPERS_NAME}</span>
            <strong>Sign in to upload papers and ask them questions</strong>
            <span className="hm-meta">Private to your account</span>
          </button>
        )}
        <button type="button" className="hm-card" onClick={() => { setTool("idea"); inputRef.current?.focus(); }}>
          <span className="hm-k">Idea Check</span>
          <strong>See what is already written about your idea</strong>
          <span className="hm-meta">You approve the search first</span>
        </button>
        <button type="button" className="hm-card" onClick={() => { setTool("verify"); inputRef.current?.focus(); }}>
          <span className="hm-k">References</span>
          <strong>Find out which references do not exist</strong>
          <span className="hm-meta">{saved > 0 ? `${saved} saved in your library` : "Paste a bibliography"}</span>
          {saved > 0 && <Bookmark className="hm-card-ico" size={16} aria-hidden="true" />}
        </button>
      </m.div>

      {user && (
        <div className="hm-extras">
          <ContinueReading onOpen={onOpenPaper} />
          <RememberThis onOpen={onOpenPaper} />
        </div>
      )}
        </>
      )}
    </section>
  );
}
