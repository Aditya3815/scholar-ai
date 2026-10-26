import { useSyncExternalStore } from "react";
import {
  applyChatEvent, chatTitle, cleanChatMessage, interruptAssistant, startAssistant, stopAssistant, trimForStorage,
  type AssistantMsg, type ChatEvent, type ChatMsg,
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
type State = { index: Entry[]; active: string | null; chats: ReadonlyMap<string, ChatMsg[]>; running: ReadonlySet<string>; kept: boolean };

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

let state: State = { index: typeof localStorage === "undefined" ? [] : readIndex(), active: typeof sessionStorage === "undefined" ? null : readActive(), chats: new Map(), running: new Set(), kept: true };
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

const runs = new Map<string, { ctl: AbortController; assistantId: string }>();

export type SendResult = "sent" | "busy" | "invalid";

/** Send a message in the current conversation (starting one if there is none). A second message while one is being answered is not sent: it waits for the answer or for Stop. */
export function sendMessage(raw: string): SendResult {
  const text = cleanChatMessage(raw);
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
  const reply = startAssistant(newId(), text, now);
  setChat(id, [...(state.chats.get(id) ?? []), user, reply]);
  touch(id, state.index.find((e) => e.id === id)?.title ?? chatTitle(text));
  persist(id, true);
  void run(id, reply.id, text);
  return "sent";
}

/** "Search again" on a reply: the same question asked again, in the same place. */
export function retryReply(assistantId: string): SendResult {
  const id = state.active;
  if (!id || runs.has(id)) return "busy";
  const msgs = state.chats.get(id);
  const at = msgs?.findIndex((m) => m.id === assistantId) ?? -1;
  const old = msgs?.[at];
  if (!msgs || !old || old.role !== "assistant") return "invalid";
  const reply = startAssistant(assistantId, old.query, Date.now());
  setChat(id, msgs.map((m, i) => (i === at ? reply : m)));
  persist(id, true);
  void run(id, assistantId, old.query);
  return "sent";
}

/** Stop the answer being written in the current conversation. */
export function stopReply() {
  const r = state.active ? runs.get(state.active) : undefined;
  r?.ctl.abort();
}

async function run(chatId: string, assistantId: string, query: string) {
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
    const res = await fetch("/api/v1/chat", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ mode: "search", message: query }), signal: ctl.signal });
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

export function deleteChat(id: string) {
  runs.get(id)?.ctl.abort();
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
  for (const t of timers.values()) window.clearTimeout(t);
  set({ index: [], chats: new Map(), kept: true });
  try {
    localStorage.removeItem(INDEX_KEY);
  } catch {
    /* ignore */
  }
  setActive(null);
  await idbClear("chats");
}
