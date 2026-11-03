import type { Paper, SearchScope } from "./index";
import { MAX_CHAT_CHARS, MAX_TIGHTEN_PAPERS, MAX_TIGHTEN_TEXT, cleanChatMessage, type ChatAnswer, type ChatEvent, type ChatMode, type ChatNoAnswer, type ChatRequestMode, type ChatStep, type GeneralKind, type NoticeKind, type TightenRequest, type TightenResponse } from "./chat";
import { MAX_FILTER_YEAR, MAX_HISTORY_ANSWER_CHARS, MAX_HISTORY_CHARS, MAX_HISTORY_ENTRIES, MAX_HISTORY_PAPERS, MAX_HISTORY_TITLE_CHARS, MIN_FILTER_YEAR, type ChatContextInfo, type EarlierQuestion, type HistoryEntry, type HistoryPaper } from "./chat-context";
import { MAX_AUTO_CHARS, type Lang, type RouteHow } from "./route";
import { abstractRead } from "./sentences";

/* The conversation as the browser keeps it: a reply is built event by event while it streams, and kept as it is when it is done. All of it is pure, so it is tested without a browser. */

/**
 * One of the versions of a message that was edited (docs/design/chat-actions-context.md, section 4): its words, when it was written, and the messages that came after it (its reply and every
 * later turn, which may themselves have versions). `tail` is empty for the version being read: its messages are the live ones, after the user message in the list.
 */
export type UserVersion = { text: string; at: number; tail: ChatMsg[] };
/**
 * `versions` and `ver` are there only once a message has been edited, and are optional so that a conversation kept before editing existed opens as it was (no migration, no new store, no new role).
 * `versions` has every version in the order it was made, `ver` the one being read; `text` and `at` are always those of that one.
 */
export type UserMsg = { id: string; role: "user"; text: string; at: number; versions?: UserVersion[]; ver?: number };
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
  /** What the server read of the earlier turns of the conversation to understand this message (a follow-up: "only after 2020"), when a model read them. Absent for a message nothing was read for. */
  context?: ChatContextInfo;
  /**
   * The questions of other chats this message was sent with (at most three, as the page built them from the person's own earlier chats: docs/design/chat-actions-context.md, section 6), so that the reply can
   * say what it used (`earlierUsed`) and the person can take one away and ask again. They are kept with the reply that used them and go with it when that chat is deleted.
   */
  earlier?: EarlierQuestion[];
  /** True once the person took one of `earlier` away: asking this reply again sends exactly what is left (nothing more is chosen for it). */
  earlierSet?: true;
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
  notices: { kind: NoticeKind; text: string }[];
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
      return { ...m, understood: true, query: e.query, mode: e.mode, language: e.language, auto: e.auto, how: e.how, confidence: e.confidence, searchQuery: e.searchQuery, ...(e.context ? { context: e.context } : {}) };
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

/* ---------------------------------------------------------------- the store's small decisions */

/** An entry of the list of conversations (the rail, and what another tab hears of a change). It may have more fields than these. */
export type IndexEntry = { id: string; title: string; updatedAt: number };

/**
 * A conversation was touched: its entry goes to the front, with the title it is given, else the one it has, else "Chat"; what is past `max` is handed back so its record can be deleted.
 * The old entry is spread and not rebuilt from three fields: a field an entry has gained (a later feature's, or a newer build's in another tab) must survive the conversation being touched.
 * `patch` is what the entry is to say now (who the chat belongs to, the words it is found by): put over the old entry, and a field it names as `undefined` is taken away.
 */
export function touchIndex<E extends IndexEntry>(index: readonly E[], id: string, title: string | undefined, now: number, max: number, patch?: Partial<E>): { kept: E[]; dropped: E[] } {
  const old = index.find((e) => e.id === id);
  const entry = { ...old, ...patch, id, title: title ?? old?.title ?? "Chat", updatedAt: now } as E;
  const all = [entry, ...index.filter((e) => e.id !== id)];
  return { kept: all.slice(0, max), dropped: all.slice(max) };
}

/**
 * One answer is written at a time in a conversation, and the run that writes it is registered under the conversation's id. A run that was stopped ends a moment after Stop, so it can end after
 * a new run has begun for the same conversation: it may remove only its own registration, found by the controller it started with. Returns whether it removed one.
 */
export function releaseRun<R extends { ctl: unknown }>(runs: Map<string, R>, chatId: string, ctl: unknown): boolean {
  if (runs.get(chatId)?.ctl !== ctl) return false;
  runs.delete(chatId);
  return true;
}

/**
 * Why a conversation cannot be edited or switched to another version right now: a reply is being written, or a strict check is running on one (both would write into messages that are about to
 * be put away). Pure, so that the screen and the store ask the same question.
 */
export function busyReason(msgs: readonly ChatMsg[]): "reply" | "strict" | null {
  let strict = false;
  for (const m of msgs) {
    if (m.role !== "assistant") continue;
    if (m.status === "working") return "reply";
    if (m.strict?.status === "working") strict = true;
  }
  return strict ? "strict" : null;
}

/**
 * When the page brings a question to the top of the window (so that the answer written under it is what the reader sees): when a conversation is opened, and when a question or an Idea Check is
 * added at the end of the one on screen. Never for what only changes in place (a reply written again, a strict check), nor for another version of a message coming in (the same first message and
 * a different tail: the reader pressed the pager and must stay where they are), nor for a list that got shorter. "question" or "idea" says which element to bring up. Pure.
 */
export function turnToShow(prev: readonly ChatMsg[] | null, next: readonly ChatMsg[]): "question" | "idea" | null {
  const last = next[next.length - 1];
  if (!last) return null;
  if (prev && prev.length > 0 && prev[0]!.id === next[0]!.id) {
    const added = next.length > prev.length && prev.every((m, i) => next[i]!.id === m.id) ? next.slice(prev.length) : [];
    if (!added.some((m) => m.role === "user" || m.role === "idea")) return null;
  }
  // an Idea Check that was added alone (Change to Idea Check, under an earlier reply) is brought up itself; with the text echoed before it, it is that text
  return last.role === "idea" && next[next.length - 2]?.role !== "user" ? "idea" : "question";
}

/* ---------------------------------------------------------------- editing a message, and the versions it keeps */

/**
 * At most this many versions of one message are kept, the oldest of them first to go: every version carries its replies with their papers, in a browser that keeps thirty conversations, and
 * the person has no way to say which they want. The version being read is never dropped.
 */
export const MAX_VERSIONS = 5;

/** The versions of a message when it has more than one and they are well formed. They come out of the browser's storage (or another tab's build), so anything else reads as "no versions" and the message is shown as it is. */
function keptVersions(m: UserMsg): { versions: UserVersion[]; ver: number } | null {
  const v = m.versions;
  const ver = m.ver;
  if (!Array.isArray(v) || v.length < 2 || typeof ver !== "number" || !Number.isInteger(ver) || ver < 0 || ver >= v.length) return null;
  return v.every((x) => !!x && typeof x.text === "string" && typeof x.at === "number" && Array.isArray(x.tail)) ? { versions: v, ver } : null;
}

/** Which version of a message is being read, and of how many. `number` counts from 1, in the order the versions were made. */
export function versionInfo(m: UserMsg): { count: number; number: number; hasPrev: boolean; hasNext: boolean } {
  const k = keptVersions(m);
  if (!k) return { count: 1, number: 1, hasPrev: false, hasNext: false };
  return { count: k.versions.length, number: k.ver + 1, hasPrev: k.ver > 0, hasNext: k.ver < k.versions.length - 1 };
}

/** A message that is put away with its version is not going to change any more: a reply still "working" will never finish (interrupted), and a strict check that was running is not kept as running. */
const settle = (m: ChatMsg): ChatMsg => (m.role === "assistant" ? interruptAssistant(m.strict?.status === "working" ? { ...m, strict: undefined } : m) : m);

/** What an edit of a user message is, read from the reply it is paired with (the user message itself stores no tool, scope or limit). */
export type EditInfo = {
  /** Where the user message is in the list. */
  at: number;
  /** The reply under it. */
  reply: AssistantMsg;
  /** "auto": the router chooses the tool again; "search": the words are searched as written (the reader chose Search papers). Both as `retryReply` reads them. */
  mode: "search" | "auto";
  /** Where the search looked (the Indian sources stay on for a message that was searched there). */
  scope: SearchScope;
  /** The longest the edited text may be: the box's own limit for that tool. */
  limit: number;
  /** How many messages come after the reply: the later turns an edit would put away. */
  later: number;
};

/**
 * Whether a user message can be edited, and how: only one that has a reply under it. The text echoed before an Idea Check has none (its words are the idea's, which is not edited here), and
 * neither has a question whose reply is missing. Null otherwise.
 */
export function editInfo(msgs: readonly ChatMsg[], userId: string): EditInfo | null {
  const at = msgs.findIndex((m) => m.id === userId);
  const user = msgs[at];
  const reply = msgs[at + 1];
  if (!user || user.role !== "user" || reply?.role !== "assistant") return null;
  const auto = reply.auto === true;
  return { at, reply, mode: auto ? "auto" : "search", scope: reply.scope ?? "all", limit: auto ? MAX_AUTO_CHARS : MAX_CHAT_CHARS, later: msgs.length - at - 2 };
}

/**
 * A user message edited: its words are replaced, and the old words with every message after them are kept as a version (docs/design/chat-actions-context.md, section 4); under the new words
 * there is only `newReply`, which the caller made with a new id (an old run that ends late must not reach it). The message keeps its id, so the screen keeps the same place for it. The list
 * stays the flat list of the version being read. At most `MAX_VERSIONS` are kept: the oldest of the ones kept before goes, but not the one just put away (the screen promises "you can go back
 * to the earlier version"). Null when `userId` is not a user message. Pure.
 */
export function editUserMessage(msgs: readonly ChatMsg[], userId: string, text: string, newReply: AssistantMsg): ChatMsg[] | null {
  const at = msgs.findIndex((m) => m.id === userId);
  const user = msgs[at];
  if (!user || user.role !== "user") return null;
  const kept = keptVersions(user);
  const left = kept ? kept.ver : 0;
  const away: UserVersion = { text: user.text, at: user.at, tail: msgs.slice(at + 1).map(settle) };
  const versions: UserVersion[] = kept ? kept.versions.map((v, i) => (i === left ? away : v)) : [away];
  versions.push({ text, at: newReply.at, tail: [] });
  const drop = new Set<number>();
  for (let i = 0; i < versions.length - 1 && versions.length - drop.size > MAX_VERSIONS; i++) if (i !== left) drop.add(i);
  const out = versions.filter((_, i) => !drop.has(i));
  return [...msgs.slice(0, at), { ...user, text, at: newReply.at, versions: out, ver: out.length - 1 }, newReply];
}

/**
 * Another version of a message brought back: the one being read goes away with the messages after it, and the one asked for comes in with its own. Going there and back gives what it was.
 * Null when `to` is not another version of that message. Pure.
 */
export function switchVersion(msgs: readonly ChatMsg[], userId: string, to: number): ChatMsg[] | null {
  const at = msgs.findIndex((m) => m.id === userId);
  const user = msgs[at];
  if (!user || user.role !== "user") return null;
  const kept = keptVersions(user);
  if (!kept || !Number.isInteger(to) || to < 0 || to >= kept.versions.length || to === kept.ver) return null;
  const target = kept.versions[to]!;
  const versions = kept.versions.map((v, i) => (i === kept.ver ? { text: user.text, at: user.at, tail: msgs.slice(at + 1).map(settle) } : i === to ? { text: v.text, at: v.at, tail: [] } : v));
  return [...msgs.slice(0, at), { ...user, text: target.text, at: target.at, versions, ver: to }, ...target.tail];
}

/**
 * The conversation as something that reads it (the context that a follow-up sends, an export) may see it: the messages of the version being read, with every kept version taken off the user
 * messages. A replaced text, and the replies that went with it, cannot reach code that walks this list or writes it out: they are not in it. Pure; the list it is given is not changed.
 */
export function activePath(msgs: readonly ChatMsg[]): ChatMsg[] {
  return msgs.map((m) => {
    if (m.role !== "user" || (m.versions === undefined && m.ver === undefined)) return m;
    const { versions: _versions, ver: _ver, ...rest } = m;
    return rest;
  });
}

/**
 * The title of a conversation after the message with `userId` got new words (an edit, or another version brought back): the title is the first message's, so it follows it, but only when it
 * still is made of that message's words (a title that was set some other way is not ours to replace).
 */
export function titleAfterEdit(msgs: readonly ChatMsg[], userId: string, newText: string, current: string): string {
  const first = msgs[0];
  if (!first || first.role !== "user" || first.id !== userId) return current;
  return current === chatTitle(first.text) ? chatTitle(newText) : current;
}

/** `f` applied to every reply of a list, including those in the kept versions of a user message, however deep: a version put away is stored like the rest and opened like the rest. */
function mapReplies(msgs: readonly ChatMsg[], f: (m: AssistantMsg) => AssistantMsg): ChatMsg[] {
  return msgs.map((m) => {
    if (m.role === "assistant") return f(m);
    if (m.role !== "user" || !Array.isArray(m.versions)) return m;
    return { ...m, versions: m.versions.map((v) => (v && Array.isArray(v.tail) ? { ...v, tail: mapReplies(v.tail, f) } : v)) };
  });
}
/** A conversation as it is kept: every reply cut for keeping (`trimForStorage`), those in kept versions too. A message with no versions is the same object. */
export const trimMessagesForStorage = (msgs: readonly ChatMsg[]): ChatMsg[] => mapReplies(msgs, trimForStorage);
/** A conversation as it is opened: a reply found "working" in storage (the page was closed or reloaded part way) is interrupted, in the kept versions too. */
export const interruptMessages = (msgs: readonly ChatMsg[]): ChatMsg[] => mapReplies(msgs, interruptAssistant);

/* ---------------------------------------------------------------- context between messages */

const cp = (c: number) => String.fromCodePoint(c);
/**
 * Text that shows nothing: the bidi controls, the zero-width space, the word joiner and the invisible operators, the byte-order mark, the tag characters. The list is the server's (apps/api/src/chat/history.ts)
 * and a few more, built from code points so that no invisible character is typed into this file: what the browser sends is then already what the server would make of it, and it never sends a
 * question that the server reads as shorter than it is and refuses (a refusal is of the whole message). U+200C and U+200D are NOT in it: Hindi is written with them.
 */
const INVISIBLE = new RegExp(`[${[0x061c, 0x200b, 0x200e, 0x200f, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0xfeff].map(cp).join("")}${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}${cp(0xe0000)}-${cp(0xe007f)}]`, "gu");
const CONTROLS = new RegExp(`[${cp(0)}-${cp(0x1f)}${cp(0x7f)}]`, "g");
/** A text as one line: nothing invisible, no control character, no line break. A title or an answer is data from outside, and one that held a line break and "[2] ..." could otherwise start a line of its own. */
export const oneLine = (s: string): string => s.replace(INVISIBLE, "").replace(CONTROLS, " ").replace(/\s+/g, " ").trim();
/** Words that can be sent as a search or as a question (2 to 300 characters with a letter or a number in it) once the invisible characters are out, or nothing. */
const askable = (s: unknown): string | undefined => (typeof s === "string" ? (cleanChatMessage(s.replace(INVISIBLE, "")) ?? undefined) : undefined);

/** At most `max` characters, cut where a whole character ends: never between the halves of a character outside the basic plane, and, where the browser can tell, never inside a Hindi conjunct. */
export function cutWhole(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max + 16);
  const parts = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(head), (x) => x.segment) : Array.from(head);
  let out = "";
  for (const part of parts) {
    if (out.length + part.length > max) break;
    out += part;
  }
  return out;
}

/** The year range a person can ask for (the same as the server's reader), or nothing: both ends whole numbers in range, at least one of them, in order. `null` is no end, as it is on the wire. */
function yearRange(from: unknown, to: unknown): { from?: number; to?: number } | null {
  const f = from ?? undefined;
  const t = to ?? undefined;
  const fine = (y: unknown): y is number | undefined => y === undefined || (typeof y === "number" && Number.isInteger(y) && y >= MIN_FILTER_YEAR && y <= MAX_FILTER_YEAR);
  if (!fine(f) || !fine(t) || (f === undefined && t === undefined) || (f !== undefined && t !== undefined && f > t)) return null;
  return { ...(f === undefined ? {} : { from: f }), ...(t === undefined ? {} : { to: t }) };
}

/** "2020 or later", "2015 or earlier", "2019", "2018 to 2020": a year range in words (the server says it in the same words when it leaves few papers). Nothing for a range that is not one. */
export function yearRangeWords(from?: number, to?: number): string | null {
  const r = yearRange(from, to);
  if (!r) return null;
  return r.from !== undefined && r.to !== undefined ? (r.from === r.to ? `${r.from}` : `${r.from} to ${r.to}`) : r.from !== undefined ? `${r.from} or later` : `${r.to} or earlier`;
}

const LANGS: readonly Lang[] = ["en", "hi", "hinglish", "other"];
type AskedEntry = Extract<HistoryEntry, { role: "user" }>;
type ReplyEntry = Extract<HistoryEntry, { role: "assistant" }>;

/** The papers an answer cites, as the person saw them: only those that this reply can stand behind (the mark is in the list, the paper is in that place and is the one the citation names), titles as one line and cut, at most five. */
function citedPapers(a: AssistantMsg): HistoryPaper[] {
  const ans = a.answer;
  if (!ans || !ans.grounded || !Array.isArray(ans.citations) || !Array.isArray(a.papers)) return [];
  const backed = new Set<number>();
  for (const c of ans.citations) {
    const p = Number.isInteger(c.n) && c.n >= 1 && c.n <= 99 ? a.papers[c.n - 1] : undefined;
    if (p && p.id === c.paperId) backed.add(c.n);
  }
  const out: HistoryPaper[] = [];
  for (const n of [...backed].sort((x, y) => x - y)) {
    const p = a.papers[n - 1]!;
    const title = typeof p.title === "string" ? cutWhole(oneLine(p.title), MAX_HISTORY_TITLE_CHARS).trim() : "";
    if (!/[\p{L}\p{N}]/u.test(title)) continue;
    out.push({ n, title, year: typeof p.year === "number" && Number.isInteger(p.year) && p.year >= 1000 && p.year <= 2999 ? p.year : null });
    if (out.length === MAX_HISTORY_PAPERS) break;
  }
  return out;
}

/** The checked answer's words, as one line without its marks (they point into a list that is not the next reply's), cut: only for the last reply. Nothing for a reply with no written, checked answer; never the words that were still arriving. */
function answerWords(a: AssistantMsg): string | undefined {
  const ans = a.answer;
  if (!ans || !ans.grounded || typeof ans.text !== "string") return undefined;
  const t = cutWhole(oneLine(ans.text).replace(/\s*\[\d{1,2}\]/g, "").trim(), MAX_HISTORY_ANSWER_CHARS).trim();
  return t || undefined;
}

/**
 * One question of the person's and the reply under it, as context, or null when they may not be: a reply that is not a finished search (stopped, failed, interrupted, still being written; another
 * tool's, which is offered and never run here; small talk; one that was too long for a search; one that said the message is not research), and a question that cannot be sent (more than 300
 * characters is a pasted manuscript or a list, which never goes along as context; too short once the invisible characters are out). The background from general knowledge is never in it.
 */
function historyTurn(u: UserMsg, a: AssistantMsg): { asked: AskedEntry; reply: ReplyEntry; from: AssistantMsg } | null {
  if (a.status !== "done" || a.mode !== "search" || a.reason === "routed" || a.reason === "small_talk" || a.reason === "too_long" || a.reason === "stopped" || a.general?.kind === "not_research") return null;
  const text = askable(u.text);
  if (!text) return null;
  // what the indexes were asked: the words the reply says it searched; else, for a reply made from other words than the person wrote (searched again as written, with the year filter taken off), the words it was made from
  const own = askable(a.query);
  const searched = askable(a.searchQuery) ?? (own && own !== text ? own : undefined);
  const reply: ReplyEntry = { role: "assistant" };
  if (searched) reply.searchQuery = searched;
  if (LANGS.includes(a.language)) reply.language = a.language;
  const papers = citedPapers(a);
  if (papers.length > 0) reply.papers = papers;
  const years = yearRange(a.context?.yearFrom, a.context?.yearTo);
  if (years?.from !== undefined) reply.yearFrom = years.from;
  if (years?.to !== undefined) reply.yearTo = years.to;
  return { asked: { role: "user", text }, reply, from: a };
}

/** The characters of an entry that count towards the total the server reads (every text of it that can reach a model). */
const sizeOf = (e: HistoryEntry): number => (e.role === "user" ? e.text.length : (e.searchQuery?.length ?? 0) + (e.text?.length ?? 0) + (e.papers ?? []).reduce((n, p) => n + p.title.length, 0));

/**
 * The finished searches of a list of messages, oldest first, each as `historyTurn` reads it. The one place that decides which turns of a conversation may be carried on: to the next message of the same
 * conversation (`contextBefore`) and to another conversation (`askedTurns`, which the index words and the questions of an earlier chat are made from).
 */
function finishedTurns(path: readonly ChatMsg[]): NonNullable<ReturnType<typeof historyTurn>>[] {
  const turns: NonNullable<ReturnType<typeof historyTurn>>[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const u = path[i];
    const a = path[i + 1];
    if (u?.role !== "user" || a?.role !== "assistant") continue;
    const t = historyTurn(u, a);
    if (t) turns.push(t);
    i++; // the reply belongs to this question, whether or not they are kept
  }
  return turns;
}

/**
 * What a conversation may say to ANOTHER one (docs/design/chat-actions-context.md, section 6): its finished searches as the person's own words, oldest first, each the question (2 to 300 characters,
 * nothing invisible in it) and the English words its search used when it had some. Never an answer, an Idea Check or the text echoed with one, a pasted list (a question over 300 characters), small talk,
 * background from general knowledge, or a reply that did not finish. Read through `activePath`, so a version of a message that was replaced is not in it. Pure.
 */
export function askedTurns(msgs: readonly ChatMsg[]): EarlierQuestion[] {
  return finishedTurns(activePath(msgs)).map((t) => ({ question: t.asked.text, ...(t.reply.searchQuery ? { searchQuery: t.reply.searchQuery } : {}) }));
}

/**
 * What a message in Auto is sent with so that it can lean on what came before ("only after 2020", "explain that simpler"): the last three finished searches of the conversation that is on the
 * screen, as a question and its reply each, oldest first (docs/design/chat-actions-context.md, section 5). `upTo` is where the message is (or was) in the list: only what comes BEFORE it counts, so an
 * edit of an earlier message, and Search again on an old reply, are sent with the turns that existed then and never with the later ones. Read through `activePath`: the words and replies of a version that
 * was replaced are not in what it looks at. Only a reply's words are the answer's, and only the last reply carries them. The total is cut like the server's (whole turns, oldest first, the last stays), so
 * what is sent is what is read. Pure; empty when there is nothing the next message may lean on, and then nothing is sent at all.
 */
export function contextBefore(msgs: readonly ChatMsg[], upTo: number): HistoryEntry[] {
  const end = Number.isInteger(upTo) ? Math.max(0, Math.min(upTo, msgs.length)) : 0;
  const turns = finishedTurns(activePath(msgs.slice(0, end)));
  const build = (kept: typeof turns): HistoryEntry[] =>
    kept.flatMap((t, i): HistoryEntry[] => {
      const text = i === kept.length - 1 ? answerWords(t.from) : undefined;
      return [t.asked, text ? { ...t.reply, text } : t.reply];
    });
  let kept = turns.slice(-(MAX_HISTORY_ENTRIES / 2));
  while (kept.length > 1 && build(kept).reduce((n, e) => n + sizeOf(e), 0) > MAX_HISTORY_CHARS) kept = kept.slice(1);
  return build(kept);
}

/**
 * The body of `POST /api/v1/chat`. The earlier turns go only in Auto: a search the reader chose is searched as written, and the server refuses them there (and with "anyway"). Without them the body is
 * exactly what it was before there were any (same keys, same order), so what is sent for a first message, a search by hand and a retry has not changed. `earlier` (questions of other chats, section 6)
 * goes by the same rule, after `history`. Only for a person who is signed in (`signedIn`, required so that no caller can forget it): the server ignores both for anybody else, but they would still have left
 * the device, and the privacy page says earlier questions are sent "when you are signed in".
 */
export function chatRequestBody(o: { mode: ChatRequestMode; message: string; scope?: SearchScope; anyway?: boolean; history?: readonly HistoryEntry[]; earlier?: readonly EarlierQuestion[]; signedIn: boolean }): Record<string, unknown> {
  const auto = o.mode === "auto" && !o.anyway && o.signedIn;
  return {
    mode: o.mode,
    message: o.message,
    ...(o.scope && o.scope !== "all" ? { scope: o.scope } : {}),
    ...(o.anyway ? { anyway: true } : {}),
    ...(auto && o.history && o.history.length > 0 ? { history: o.history } : {}),
    ...(auto && o.earlier && o.earlier.length > 0 ? { earlier: o.earlier } : {}),
  };
}

/** What the screen says about the earlier turns a model read for a reply. `question`: the standalone question the message was read as ("Using your earlier question: ..."). `exact`: that question as a search to be made as written, offered when searching it makes sense. `years`: the range that cut the papers (a chip). */
export type FollowUpNote = { question?: string; exact?: string; years?: { from?: number; to?: number; words: string } };

/**
 * What a reply says about the context it was read with, or null when it says nothing: a message that no model read, one that was read and left as it was (and cut no years), one whose reading could
 * not be used (the reply already says it was not sure, and nothing of it was applied). The question is shown only when the words were rewritten. A message about the same papers shows its question but
 * is not offered as a search to be made as written: it is an instruction ("explain that simpler"), and searched as it stands it finds nothing. Defensive about what came off the wire.
 */
export function followUpNote(m: AssistantMsg): FollowUpNote | null {
  const c = m.context;
  if (!c || typeof c !== "object" || c.fellBack) return null;
  const question = c.rewrote === true && typeof c.question === "string" ? c.question.trim() : "";
  const range = yearRange(c.yearFrom, c.yearTo);
  if (!question && !range) return null;
  const exact = question && c.intent !== "same_papers" ? askable(question) : undefined;
  return { ...(question ? { question } : {}), ...(exact ? { exact } : {}), ...(range ? { years: { ...range, words: yearRangeWords(range.from, range.to)! } } : {}) };
}

/**
 * The words "Search again" asks again for a reply, before they are tidied for the tool: `written` is the message above the reply (null when there is none). In Auto, the person's own words (read again
 * with the turns before them). A search chosen by hand asks again what it searched (`query`), which is the message above it unless it was made from other words: the question a follow-up was read as, or
 * the topic with its year range taken off. "Use my exact words" and "Search for these words anyway" are the person's own words, whatever the reply was; `words` replaces them for a search as written, and
 * is used only then. Null when there is nothing to ask. Pure.
 */
export function retryText(old: AssistantMsg, written: string | null, as?: "search" | "anyway", words?: string): string | null {
  if (as === "search" && words !== undefined) return words;
  if (as === undefined) return old.auto ? written : old.query;
  return written ?? old.query;
}

/**
 * Whether a notice of a reply has "Search again" beside it. Only "partial" does: some of the places searched did not answer, and asking again may reach them. The line that says what a year range
 * did to the list has a kind of its own ("years"): asking again would give the same list, so for that line the way out is to take the year filter off (the chip). A kind this page does not know
 * (an old tab meeting a newer server) offers nothing.
 */
export function noticeOffersRetry(m: AssistantMsg, n: { kind: string; text?: string }): boolean {
  return n.kind === "partial" && m.status !== "working";
}

/**
 * The words to search, as written, when the year filter of a reply is taken off: what the indexes were asked (the topic, which carries no range), else the standalone question, else the person's own
 * words; the first that can be sent as a search. Nothing when none can. The search is made as a search chosen by hand (no model reads it, no range can be applied to it).
 */
export function unfilteredWords(m: AssistantMsg, written: string): string | null {
  return askable(m.searchQuery) ?? askable(m.context?.question) ?? askable(written) ?? null;
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
    papers: cited.map((n) => ({ n, title: m.papers[n - 1]!.title, year: m.papers[n - 1]!.year, abstract: abstractRead(m.papers[n - 1]!.abstract) })),
    citations: a.citations.map((c) => ({ n: c.n, sentenceNo: c.sentenceNo })),
  };
}

export const startTighten = (m: AssistantMsg): AssistantMsg => ({ ...m, strict: { status: "working" } });
export const failTighten = (m: AssistantMsg, note: string): AssistantMsg => ({ ...m, strict: { status: "failed", note } });

/** The id of the paper at each place an answer cited, by place (`n`): what a strict check is made from, to be compared with the reply it comes back to. Empty for a reply with no answer. */
export function citedPaperIds(m: AssistantMsg): Record<number, string> {
  const out: Record<number, string> = {};
  for (const c of m.answer?.citations ?? []) {
    const p = m.papers[c.n - 1];
    if (p) out[c.n] = p.id;
  }
  return out;
}

/**
 * The strict check's answer taken into the reply. The papers of the new answer are the ones of the old (the server only keeps or removes claims), so a citation that points at a paper
 * this reply does not have is refused and the reply is left as it was. `paperId`s are the page's own, not the request's placeholders.
 * `asked` (`citedPaperIds` of the reply the check was made from) says which paper was at each place then: a reply that was written again under the same id while the check ran has other papers at those
 * places, and the old sentences must not be bound to them ("each claim was read strictly against the sentences it cites" would be said over a sentence that is not in that paper). Such a result is not
 * taken: the reply is returned as it is, except that one still waiting for this check stops waiting.
 */
export function applyTighten(m: AssistantMsg, res: TightenResponse, asked?: Readonly<Record<number, string>>): AssistantMsg {
  const a = res?.answer;
  if (asked) {
    for (const [n, id] of Object.entries(asked)) {
      if (m.papers[Number(n) - 1]?.id !== id) return m.strict?.status === "working" ? failTighten(m, "The answer changed while it was being checked, so the result was not used.") : m;
    }
  }
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

/* ---------------------------------------------------------------- the owner's counts */

/**
 * How the prompt box's answers went, for the line at the top of /admin: of the questions that the papers could have answered (the model was asked), how many it answered and how many answers our own
 * check refused. A message that came with the turns before it is booked by the server under `followup_answered` and `followup_not_grounded` (src/outcomes.ts), and they count here exactly as
 * `answered` and `not_grounded` do: left out, the line would cover only the first message of every chat. `followup_rewrite_failed` and `followup_context_ignored` take both endings under one name, so how
 * many of those were refused cannot be said: they are counted apart (`unsplit`) and are not guessed into either number. Counts only; no text, no person.
 */
export function chatRefusalShare(rows: readonly { feature: string; outcome: string; n: number }[]): { attempted: number; refused: number; unsplit: number } {
  let attempted = 0;
  let refused = 0;
  let unsplit = 0;
  for (const r of rows) {
    if (r.feature !== "chat") continue;
    if (r.outcome === "not_grounded" || r.outcome === "followup_not_grounded") {
      attempted += r.n;
      refused += r.n;
    } else if (r.outcome === "answered" || r.outcome === "not_answered" || r.outcome === "followup_answered") attempted += r.n;
    else if (r.outcome === "followup_rewrite_failed" || r.outcome === "followup_context_ignored") unsplit += r.n;
  }
  return { attempted, refused, unsplit };
}
