import { useSyncExternalStore } from "react";
import {
  applyChatEvent, applyTighten, chatTitle, cleanAutoMessage, cleanChatMessage, failTighten, interruptAssistant, MAX_CHAT_CHARS, MAX_IDEA_CHARS, MIN_IDEA_CHARS, startAssistant, startTighten, stopAssistant, tightenRequestFor, trimForStorage,
  type AssistantMsg, type ChatEvent, type ChatMsg, type IdeaMsg, type SearchScope, type TightenResponse,
} from "@scholar/shared";
import { idbClear, idbDelete, idbGet, idbSet } from "./idb";
import { showNotice } from "./notice";
import { readSse } from "./sse";

/**
 * The conversations of the prompt box. They live in this browser and nowhere else: the list in localStorage (so the rail can show it at once, and another tab hears of a change),
 * each conversation in IndexedDB (a list of papers is too big for localStorage). If the browser will not keep them, the conversation works for this visit and a notice says so.
 * Each tab has its own current conversation (sessionStorage); a conversation found part way through an answer (the page was closed or reloaded) is marked "interrupted".
 */
type Entry = { id: string; title: string; updatedAt: number };
/** `liveIdeas`: the Idea Checks of the conversations open in this tab that are running here (their plan and papers are in the page, not kept); one that is not in the set was kept from an earlier visit and shows "run it again". */
type State = { index: Entry[]; active: string | null; chats: ReadonlyMap<string, ChatMsg[]>; running: ReadonlySet<string>; liveIdeas: ReadonlySet<string>; kept: boolean };

const INDEX_KEY = "scholar.chats.v1";
const ACTIVE_KEY = "scholar.chat.active";
const MAX_CHATS = 30;

const readIndex = (): Entry[] => {
  try {
    const v = JSON.parse(localStorage.getItem(INDEX_KEY) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((e): e is Entry => !!e && typeof (e as Entry).id === "string" && typeof (e as Entry).title === "string" && typeof (e as Entry).updatedAt === "number").slice(0, MAX_CHATS) : [];
  } catch {
    return [];
  }
};
const readActive = (): string | null => {
  try {
    return sessionStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
};

let state: State = { index: typeof localStorage === "undefined" ? [] : readIndex(), active: typeof sessionStorage === "undefined" ? null : readActive(), chats: new Map(), running: new Set(), liveIdeas: new Set(), kept: true };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};
const setChat = (id: string, msgs: ChatMsg[]) => set({ chats: new Map(state.chats).set(id, msgs) });

export const useChatState = (): State =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 20) : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

/* ---------------------------------------------------------------- keeping them */

let warned = false;
const timers = new Map<string, number>();
function writeIndex(index: Entry[]) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    keptFailed();
  }
}
function keptFailed() {
  if (state.kept) set({ kept: false });
  if (!warned) {
    warned = true;
    showNotice("This browser would not keep your chats, so they will be gone when you close the page.");
  }
}
/** Save a conversation a moment after its last change (words arrive many times a second), and at once when `now`. */
function persist(id: string, now = false) {
  const save = async () => {
    const msgs = state.chats.get(id);
    if (!msgs) return;
    const ok = await idbSet(id, { id, messages: msgs.map((m) => (m.role === "assistant" ? trimForStorage(m) : m)) }, "chats");
    if (!ok) keptFailed();
  };
  // saved at most once in 800 ms while words are arriving (a delay that restarted at every word would never fire), and at once when asked
  if (now) {
    window.clearTimeout(timers.get(id));
    timers.delete(id);
    void save();
  } else if (!timers.has(id)) {
    timers.set(id, window.setTimeout(() => {
      timers.delete(id);
      void save();
    }, 800));
  }
}
const touch = (id: string, title?: string) => {
  const old = state.index.find((e) => e.id === id);
  const entry: Entry = { id, title: title ?? old?.title ?? "Chat", updatedAt: Date.now() };
  const index = [entry, ...state.index.filter((e) => e.id !== id)];
  const dropped = index.slice(MAX_CHATS);
  for (const d of dropped) void idbDelete(d.id, "chats");
  const kept = index.slice(0, MAX_CHATS);
  set({ index: kept });
  writeIndex(kept);
};

function setActive(id: string | null) {
  try {
    if (id) sessionStorage.setItem(ACTIVE_KEY, id);
    else sessionStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* the current chat is then not remembered across a reload */
  }
  set({ active: id });
}

/** Another tab changed the list: take it up (the current conversation of this tab stays). */
if (typeof window !== "undefined") {
  // a page that is closed or put away with a save still waiting (words arrive faster than the 800 ms save) starts that save now, while it can
  const saveWaiting = () => {
    for (const id of [...timers.keys()]) persist(id, true);
  };
  window.addEventListener("pagehide", saveWaiting);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveWaiting();
  });
  window.addEventListener("storage", (e) => {
    if (e.key === INDEX_KEY) set({ index: readIndex() });
  });
}

/* ---------------------------------------------------------------- using them */

/** Open a conversation (reading it from the browser's storage the first time). */
export async function openChat(id: string): Promise<void> {
  setActive(id);
  if (state.chats.has(id)) return;
  const saved = await idbGet<{ messages: ChatMsg[] }>(id, "chats");
  // a reply that was working belongs to a page that is gone
  const msgs = (saved?.messages ?? []).map((m) => (m.role === "assistant" ? interruptAssistant(m) : m));
  if (state.active === id && !state.chats.has(id)) setChat(id, msgs);
}

/** A new, empty conversation: it is created when its first message is sent. */
export function startNewChat() {
  setActive(null);
}

/** Restore the current conversation of this tab when the page loads. */
export function resumeChat() {
  if (state.active && state.index.some((e) => e.id === state.active)) void openChat(state.active);
  else if (state.active) setActive(null);
}

/**
 * An Idea Check in the conversation: the idea's text is added (with the person's own message first when it came from the box), and the workspace opens under it. The click that
 * asked for it is the person's consent to read the idea; the search itself waits for their approval inside the workspace. Only the text is kept with the conversation.
 */
export function startIdeaCheck(raw: string, opts: { echo?: boolean } = {}): "sent" | "busy" | "invalid" {
  const text = raw.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < MIN_IDEA_CHARS || text.length > MAX_IDEA_CHARS) return "invalid";
  let id = state.active;
  if (id && state.index.some((e) => e.id === id) && !state.chats.has(id)) return "busy"; // still being opened
  if (!id || !state.index.some((e) => e.id === id)) {
    id = newId();
    setActive(id);
  }
  const now = Date.now();
  const idea: IdeaMsg = { id: newId(), role: "idea", text, at: now + 1 };
  const user: ChatMsg[] = opts.echo ? [{ id: newId(), role: "user", text, at: now }] : [];
  setChat(id, [...(state.chats.get(id) ?? []), ...user, idea]);
  set({ liveIdeas: new Set(state.liveIdeas).add(idea.id) });
  touch(id, state.index.find((e) => e.id === id)?.title ?? chatTitle(text));
  persist(id, true);
  return "sent";
}

/** "Run it again" on an Idea Check kept from an earlier visit: its workspace opens afresh under the same text. */
export const reviveIdea = (messageId: string) => set({ liveIdeas: new Set(state.liveIdeas).add(messageId) });

const runs = new Map<string, { ctl: AbortController; assistantId: string }>();

export type SendResult = "sent" | "busy" | "invalid";
/** "search": the words are searched as written (the reader chose it). "auto": the router chooses the tool. */
export type SendMode = "search" | "auto";

/**
 * Send a message in the current conversation (starting one if there is none). A second message while one is being answered is not sent: it waits for the answer or for Stop.
 * `scope` "india" searches only Indian sources (the reader's switch under the box); it applies when the message is a search.
 */
export function sendMessage(raw: string, mode: SendMode = "search", scope: SearchScope = "all"): SendResult {
  const text = mode === "auto" ? cleanAutoMessage(raw) : cleanChatMessage(raw);
  if (!text) return "invalid";
  let id = state.active;
  if (id && (runs.has(id) || (state.index.some((e) => e.id === id) && !state.chats.has(id)))) return "busy"; // answering, or still being opened
  const isNew = !id || !state.index.some((e) => e.id === id);
  if (!id || isNew) {
    id = newId();
    setActive(id);
  }
  const now = Date.now();
  const user: ChatMsg = { id: newId(), role: "user", text, at: now };
  const reply = startAssistant(newId(), text.replace(/\s+/g, " ").slice(0, 300), now, mode === "auto", scope);
  setChat(id, [...(state.chats.get(id) ?? []), user, reply]);
  touch(id, state.index.find((e) => e.id === id)?.title ?? chatTitle(text));
  persist(id, true);
  void run(id, reply.id, text, mode, scope);
  return "sent";
}

/** The words the reader wrote for a reply: the message just before it (the reply itself keeps only a tidied start of them). */
function askedFor(msgs: ChatMsg[], at: number): string | null {
  const before = msgs[at - 1];
  return before?.role === "user" ? before.text : null;
}

/**
 * "Search again" on a reply: the same question asked again, in the same place, the same way (Auto chooses again; a search chosen by hand is searched as written).
 * With `as: "search"` ("Use my exact words", or Change to Search papers) it is asked as an explicit search whatever the router did before.
 */
export function retryReply(assistantId: string, as?: "search"): SendResult {
  const id = state.active;
  if (!id || runs.has(id)) return "busy";
  const msgs = state.chats.get(id);
  const at = msgs?.findIndex((m) => m.id === assistantId) ?? -1;
  const old = msgs?.[at];
  if (!msgs || !old || old.role !== "assistant") return "invalid";
  const mode: SendMode = as === "search" || !old.auto ? "search" : "auto";
  const written = askedFor(msgs, at);
  const text = mode === "auto" ? cleanAutoMessage(written) : cleanChatMessage(written ?? old.query);
  if (!text) {
    showNotice(`A search is at most ${MAX_CHAT_CHARS} characters. For a longer text, use Check references or Idea Check.`);
    return "invalid";
  }
  // it looks in the same place as before (the Indian sources stay on for a reply that was searched there)
  const scope = old.scope ?? "all";
  const reply = startAssistant(assistantId, text.replace(/\s+/g, " ").slice(0, 300), Date.now(), mode === "auto", scope);
  setChat(id, msgs.map((m, i) => (i === at ? reply : m)));
  persist(id, true);
  void run(id, assistantId, text, mode, scope);
  return "sent";
}

/** Stop the answer being written in the current conversation. */
export function stopReply() {
  const r = state.active ? runs.get(state.active) : undefined;
  r?.ctl.abort();
}

async function run(chatId: string, assistantId: string, text: string, mode: SendMode, scope: SearchScope) {
  const ctl = new AbortController();
  runs.set(chatId, { ctl, assistantId });
  set({ running: new Set(runs.keys()) });
  const patch = (fn: (m: AssistantMsg) => AssistantMsg) => {
    const msgs = state.chats.get(chatId);
    if (msgs) setChat(chatId, msgs.map((m) => (m.id === assistantId && m.role === "assistant" ? fn(m) : m)));
  };
  // events arrive many times a second: they are applied together once per frame
  let queue: ChatEvent[] = [];
  let raf = 0;
  const flush = () => {
    raf = 0;
    const batch = queue;
    queue = [];
    if (batch.length) {
      patch((m) => batch.reduce(applyChatEvent, m));
      persist(chatId); // a moment later: so a page closed part way keeps the papers found so far
    }
  };
  try {
    const res = await fetch("/api/v1/chat", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ mode, message: text, ...(scope !== "all" ? { scope } : {}) }), signal: ctl.signal });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { title?: string; detail?: string } | null;
      throw new Error(res.status === 429 ? "Too many searches just now. Please wait a minute and try again." : (j?.title ?? "That could not be sent. Please try again."));
    }
    await readSse<ChatEvent>(
      res,
      (e) => {
        queue.push(e);
        if (!raf) raf = requestAnimationFrame(flush);
      },
      ctl.signal,
    );
    if (raf) cancelAnimationFrame(raf);
    flush();
    // a stream that ended without saying it was done was cut off
    patch((m) => (m.status === "working" ? applyChatEvent(m, { type: "error", code: "cut_off", title: "The answer was cut off. Search again." }) : m));
  } catch (e) {
    if (raf) cancelAnimationFrame(raf);
    flush();
    if (e instanceof DOMException && e.name === "AbortError") patch(stopAssistant);
    else patch((m) => (m.status === "working" ? applyChatEvent(m, { type: "error", code: "network", title: e instanceof TypeError ? "The connection was lost. Check your internet and search again." : e instanceof Error ? e.message : "Something went wrong." }) : m));
  } finally {
    runs.delete(chatId);
    set({ running: new Set(runs.keys()) });
    // a conversation deleted while it was being answered stays deleted
    if (state.chats.has(chatId) && state.index.some((e) => e.id === chatId)) {
      touch(chatId);
      persist(chatId, true);
    }
  }
}

/** The strict checks that are running (by reply), so that Cancel, deleting the chat and signing out can stop them. */
const tightening = new Map<string, AbortController>();

/**
 * "Check strictly" on a reply (docs/design/claim-support.md): the answer and the abstracts it was made from go to the server, a stronger model reads every claim again, and the answer
 * that comes back takes the place of the old one. Nothing is changed unless the answer comes back whole; a failure leaves the reply as it was and says so.
 */
export async function tightenReply(assistantId: string): Promise<void> {
  const chatId = [...state.chats].find(([, msgs]) => msgs.some((m) => m.id === assistantId))?.[0];
  const msg = chatId ? state.chats.get(chatId)?.find((m): m is AssistantMsg => m.id === assistantId && m.role === "assistant") : undefined;
  if (!chatId || !msg || tightening.has(assistantId)) return;
  const body = tightenRequestFor(msg);
  if (!body) return;
  const patch = (fn: (m: AssistantMsg) => AssistantMsg) => {
    const msgs = state.chats.get(chatId);
    if (msgs) setChat(chatId, msgs.map((m) => (m.id === assistantId && m.role === "assistant" ? fn(m) : m)));
  };
  const ctl = new AbortController();
  tightening.set(assistantId, ctl);
  patch(startTighten);
  try {
    const res = await fetch("/api/v1/chat/tighten", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { title?: string; detail?: string } | null;
      throw new Error(res.status === 429 ? `${j?.title ?? "Too many requests."}${j?.detail ? ` ${j.detail}` : ""}` : res.status === 403 ? "Sign in again to check an answer strictly." : (j?.title ?? "The strict check could not be done.") + (j?.detail && res.status !== 400 ? ` ${j.detail}` : ""));
    }
    const out = (await res.json().catch(() => null)) as TightenResponse | null;
    patch((m) => applyTighten(m, out as TightenResponse));
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") patch((m) => ({ ...m, strict: undefined }));
    else patch((m) => failTighten(m, e instanceof TypeError ? "The connection was lost. Check your internet and try again." : e instanceof Error ? e.message : "The strict check could not be done."));
  } finally {
    tightening.delete(assistantId);
    persist(chatId, true);
  }
}

/** Cancel a strict check that is running: the reply stays as it was. */
export function cancelTighten(assistantId: string) {
  tightening.get(assistantId)?.abort();
}

export function deleteChat(id: string) {
  runs.get(id)?.ctl.abort();
  for (const m of state.chats.get(id) ?? []) tightening.get(m.id)?.abort();
  window.clearTimeout(timers.get(id));
  const index = state.index.filter((e) => e.id !== id);
  const chats = new Map(state.chats);
  chats.delete(id);
  set({ index, chats });
  writeIndex(index);
  void idbDelete(id, "chats");
  if (state.active === id) setActive(null);
}

/** Every conversation goes: at sign-out (a shared computer must not show the last person's questions) and from Settings. */
export async function clearChats(): Promise<void> {
  for (const r of runs.values()) r.ctl.abort();
  for (const t of tightening.values()) t.abort();
  for (const t of timers.values()) window.clearTimeout(t);
  set({ index: [], chats: new Map(), liveIdeas: new Set(), kept: true });
  try {
    localStorage.removeItem(INDEX_KEY);
  } catch {
    /* ignore */
  }
  setActive(null);
  await idbClear("chats");
}
