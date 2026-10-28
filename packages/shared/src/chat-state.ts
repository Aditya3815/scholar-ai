import type { Paper, SearchScope } from "./index";
import { MAX_TIGHTEN_PAPERS, MAX_TIGHTEN_TEXT, type ChatAnswer, type ChatEvent, type ChatMode, type ChatNoAnswer, type ChatStep, type GeneralKind, type TightenRequest, type TightenResponse } from "./chat";
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
  /** Where the search looked when it was not the regular sources ("india": only Indian sources, which the reader turned on). Kept so "Search again" looks in the same place. */
  scope?: SearchScope;
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
  /** The strict check the reader asked for on this answer: running, done (what it changed), or failed. Never kept while running. */
  strict?: { status: "working" | "done" | "failed"; note?: string };
  /** Background from general knowledge, written only when the papers did not answer: its words so far (provisional), and the final text with what kind it is. Absent in chats kept before W5. */
  generalLive?: string;
  general?: { kind: GeneralKind; text: string } | null;
  reason?: ChatNoAnswer;
  error?: string;
  tookMs?: number;
  at: number;
};
/**
 * An Idea Check started in the conversation (W5). Only the idea's text is kept: the plan, the papers and the report are not (nothing about an idea is stored), so a conversation
 * opened later shows this as "run it again". The workspace itself lives in the page while the conversation is open.
 */
export type IdeaMsg = { id: string; role: "idea"; text: string; at: number };
export type ChatMsg = UserMsg | AssistantMsg | IdeaMsg;

const STEP_ORDER: ChatStep[] = ["route", "search", "read", "write", "check", "general"];
/** "route" and "general" are steps only when they really happened. */
const happened = (m: AssistantMsg, s: ChatStep, now: ChatStep | null) => s !== "route" && s !== "general" ? true : m.step === s || m.stepsDone.includes(s) || now === s;

/** A reply that has just been asked for. `auto` is whether the router will choose the tool (the reader left the choice to it); then the first step is understanding the message. */
export const startAssistant = (id: string, query: string, at: number, auto = false, scope?: SearchScope): AssistantMsg => ({
  id, role: "assistant", mode: "search", query, language: "en", auto, understood: !auto, how: auto ? "rules" : "chosen", confidence: 1, status: "working", step: auto ? "route" : "search", stepsDone: [], papers: [], papersFinal: false, notices: [], live: "", answer: null, generalLive: "", general: null, at,
  ...(scope && scope !== "all" ? { scope } : {}),
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
      return { ...m, step: e.step, stepsDone: STEP_ORDER.filter((s) => STEP_ORDER.indexOf(s) < at && happened(m, s, null)) };
    }
    case "papers":
      return { ...m, papers: e.results, papersFinal: e.final };
    case "notice":
      return m.notices.some((n) => n.kind === e.kind) ? m : { ...m, notices: [...m.notices, { kind: e.kind, text: e.text }] };
    case "token":
      return { ...m, live: m.live + e.text };
    case "answer":
      return { ...m, answer: e.answer, live: "" };
    case "general_token":
      return { ...m, generalLive: (m.generalLive ?? "") + e.text };
    case "general":
      return { ...m, general: { kind: e.kind, text: e.text }, generalLive: "" };
    case "done":
      return { ...m, status: "done", step: null, stepsDone: STEP_ORDER.filter((s) => happened(m, s, null)), live: "", generalLive: "", tookMs: e.tookMs, reason: e.reason, papersFinal: true };
    case "error":
      return { ...m, status: "error", step: null, live: "", generalLive: "", error: e.title };
  }
}

/** The reader pressed Stop: what has arrived stays (the papers), the half-written answer goes. */
export const stopAssistant = (m: AssistantMsg): AssistantMsg => (m.status === "working" ? { ...m, status: "stopped", step: null, live: "", generalLive: "", reason: "stopped", papersFinal: true } : m);
/** A reply found "working" in storage belongs to a page that was closed or reloaded part way: it will never finish. */
export const interruptAssistant = (m: AssistantMsg): AssistantMsg => (m.status === "working" ? { ...m, status: "interrupted", step: null, live: "", generalLive: "", papersFinal: true } : m);

/** A reply as it is kept: abstracts cut to 600 characters (the list shows a few lines of them), nothing provisional. */
export const trimForStorage = (m: AssistantMsg): AssistantMsg => ({
  ...m,
  strict: m.strict?.status === "done" ? m.strict : undefined,
  live: "",
  generalLive: "",
  papers: m.papers.map((p) => (p.abstract && p.abstract.length > 600 ? { ...p, abstract: `${p.abstract.slice(0, 600).replace(/\s+\S*$/, "")}…` } : p)),
});

/** The title of a conversation: its first message, cut at a word. */
export function chatTitle(firstMessage: string): string {
  const t = firstMessage.replace(/\s+/g, " ").trim();
  if (t.length <= 60) return t;
  const cut = t.lastIndexOf(" ", 60);
  return `${t.slice(0, cut > 30 ? cut : 60)}…`;
}

/* ---------------------------------------------------------------- "Check strictly" */

/** A paper's abstract as the search found it: a reply that was kept and reopened has its abstracts cut at 600 characters with "…" (`trimForStorage`), and those are not what the answer was made from. */
const looksCut = (abstract: string): boolean => abstract.length <= 601 && abstract.endsWith("…");

/**
 * Can this reply be checked strictly? Only an answer that was made from papers and read claim by claim, not yet checked strictly, whose cited papers still have the abstracts the answer
 * was made from (in this visit: after a reload they are cut, and a stronger reading of a cut abstract would wrongly drop good claims). Pure.
 */
export function canTighten(m: AssistantMsg): boolean {
  const a = m.answer;
  if (m.status !== "done" || !a || !a.grounded || a.strict || a.checked !== true || m.strict?.status === "working") return false;
  if (a.text.length > MAX_TIGHTEN_TEXT) return false;
  const cited = [...new Set(a.citations.map((c) => c.n))];
  if (cited.length === 0 || cited.length > MAX_TIGHTEN_PAPERS) return false;
  return cited.every((n) => {
    const p = m.papers[n - 1];
    return !!p && p.abstract != null && p.abstract.trim() !== "" && !looksCut(p.abstract) && a.citations.filter((c) => c.n === n).every((c) => c.paperId === p.id);
  });
}

/** What the browser sends to `POST /api/v1/chat/tighten`, or null when `canTighten` is false. */
export function tightenRequestFor(m: AssistantMsg): TightenRequest | null {
  if (!canTighten(m)) return null;
  const a = m.answer!;
  const cited = [...new Set(a.citations.map((c) => c.n))].sort((x, y) => x - y);
  return {
    text: a.text,
    papers: cited.map((n) => ({ n, title: m.papers[n - 1]!.title, year: m.papers[n - 1]!.year, abstract: m.papers[n - 1]!.abstract!.slice(0, 1500) })),
    citations: a.citations.map((c) => ({ n: c.n, sentenceNo: c.sentenceNo })),
  };
}

export const startTighten = (m: AssistantMsg): AssistantMsg => ({ ...m, strict: { status: "working" } });
export const failTighten = (m: AssistantMsg, note: string): AssistantMsg => ({ ...m, strict: { status: "failed", note } });

/**
 * The strict check's answer taken into the reply. The papers of the new answer are the ones of the old (the server only keeps or removes claims), so a citation that points at a paper
 * this reply does not have is refused and the reply is left as it was. `paperId`s are the page's own, not the request's placeholders.
 */
export function applyTighten(m: AssistantMsg, res: TightenResponse): AssistantMsg {
  const a = res?.answer;
  if (!a || typeof a.text !== "string" || !Array.isArray(a.citations)) return failTighten(m, "The check sent back something that could not be read.");
  const citations = [];
  for (const c of a.citations) {
    const p = m.papers[c.n - 1];
    if (!p || !Number.isInteger(c.n) || typeof c.sentence !== "string") return failTighten(m, "The check sent back something that could not be read.");
    citations.push({ n: c.n, paperId: p.id, sentenceNo: c.sentenceNo, sentence: c.sentence });
  }
  const answer: ChatAnswer = { ...a, citations, strict: true };
  return { ...m, answer, strict: { status: "done", note: res.changed ? undefined : "unchanged" } };
}
