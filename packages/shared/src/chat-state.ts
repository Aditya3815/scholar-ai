import type { Paper } from "./index";
import type { ChatAnswer, ChatEvent, ChatMode, ChatNoAnswer, ChatStep } from "./chat";
import type { Lang, RouteHow } from "./route";

/* The conversation as the browser keeps it: a reply is built event by event while it streams, and kept as it is when it is done. All of it is pure, so it is tested without a browser. */

export type UserMsg = { id: string; role: "user"; text: string; at: number };
export type AssistantStatus = "working" | "done" | "stopped" | "error" | "interrupted";
export type AssistantMsg = {
  id: string;
  role: "assistant";
  mode: ChatMode;
  /** What was asked, as the server understood it (the message, tidied; a long one is cut). */
  query: string;
  /** How the message was understood: the language, whether the router chose (`auto`), by what, how surely, and the English words the indexes were asked when they are not the message. */
  language: Lang;
  auto: boolean;
  how: RouteHow;
  confidence: number;
  searchQuery?: string;
  /** False while Auto is still reading the message (no `understood` event yet); absent in chats kept before Auto existed, which count as understood. */
  understood?: boolean;
  status: AssistantStatus;
  /** The step it is on, and those it has finished. */
  step: ChatStep | null;
  stepsDone: ChatStep[];
  papers: Paper[];
  papersFinal: boolean;
  notices: { kind: "partial" | "nothing" | "retracted"; text: string }[];
  /** The answer as it is being written: provisional, shown while `answer` is null, and never kept. */
  live: string;
  answer: ChatAnswer | null;
  reason?: ChatNoAnswer;
  error?: string;
  tookMs?: number;
  at: number;
};
export type ChatMsg = UserMsg | AssistantMsg;

const STEP_ORDER: ChatStep[] = ["route", "search", "read", "write", "check"];

/** A reply that has just been asked for. `auto` is whether the router will choose the tool (the reader left the choice to it); then the first step is understanding the message. */
export const startAssistant = (id: string, query: string, at: number, auto = false): AssistantMsg => ({
  id, role: "assistant", mode: "search", query, language: "en", auto, understood: !auto, how: auto ? "rules" : "chosen", confidence: 1, status: "working", step: auto ? "route" : "search", stepsDone: [], papers: [], papersFinal: false, notices: [], live: "", answer: null, at,
});

/** One event applied to a reply. Pure: the same events always give the same reply. Events that arrive after the reply has ended are ignored. */
export function applyChatEvent(m: AssistantMsg, e: ChatEvent): AssistantMsg {
  if (m.status !== "working") return m;
  switch (e.type) {
    case "understood":
      return { ...m, understood: true, query: e.query, mode: e.mode, language: e.language, auto: e.auto, how: e.how, confidence: e.confidence, searchQuery: e.searchQuery };
    case "step": {
      const at = STEP_ORDER.indexOf(e.step);
      // "route" is only a step when the router really had to look (a message sent to Auto that the rules could not settle)
      const routed = m.step === "route" || m.stepsDone.includes("route");
      return { ...m, step: e.step, stepsDone: STEP_ORDER.filter((s) => STEP_ORDER.indexOf(s) < at && (s !== "route" || routed)) };
    }
    case "papers":
      return { ...m, papers: e.results, papersFinal: e.final };
    case "notice":
      return m.notices.some((n) => n.kind === e.kind) ? m : { ...m, notices: [...m.notices, { kind: e.kind, text: e.text }] };
    case "token":
      return { ...m, live: m.live + e.text };
    case "answer":
      return { ...m, answer: e.answer, live: "" };
    case "done":
      return { ...m, status: "done", step: null, stepsDone: STEP_ORDER.filter((s) => s !== "route" || m.step === "route" || m.stepsDone.includes("route")), live: "", tookMs: e.tookMs, reason: e.reason, papersFinal: true };
    case "error":
      return { ...m, status: "error", step: null, live: "", error: e.title };
  }
}

/** The reader pressed Stop: what has arrived stays (the papers), the half-written answer goes. */
export const stopAssistant = (m: AssistantMsg): AssistantMsg => (m.status === "working" ? { ...m, status: "stopped", step: null, live: "", reason: "stopped", papersFinal: true } : m);
/** A reply found "working" in storage belongs to a page that was closed or reloaded part way: it will never finish. */
export const interruptAssistant = (m: AssistantMsg): AssistantMsg => (m.status === "working" ? { ...m, status: "interrupted", step: null, live: "", papersFinal: true } : m);

/** A reply as it is kept: abstracts cut to 600 characters (the list shows a few lines of them), nothing provisional. */
export const trimForStorage = (m: AssistantMsg): AssistantMsg => ({
  ...m,
  live: "",
  papers: m.papers.map((p) => (p.abstract && p.abstract.length > 600 ? { ...p, abstract: `${p.abstract.slice(0, 600).replace(/\s+\S*$/, "")}…` } : p)),
});

/** The title of a conversation: its first message, cut at a word. */
export function chatTitle(firstMessage: string): string {
  const t = firstMessage.replace(/\s+/g, " ").trim();
  if (t.length <= 60) return t;
  const cut = t.lastIndexOf(" ", 60);
  return `${t.slice(0, cut > 30 ? cut : 60)}…`;
}
