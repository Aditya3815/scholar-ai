import { useSyncExternalStore } from "react";
import {
  applyChatEvent, applyTighten, buildLedger, busyReason, canStartNewTopic, chatRequestBody, chatTitle, citedPaperIds, cleanAutoMessage, cleanChatMessage, contextBefore, didNotFinishText, editInfo, editUserMessage, failTighten, goneFromIndex, interruptMessages, lastReplyDidNotFinish, leavesNoTrace, MAX_CHAT_CHARS, MAX_IDEA_CHARS, MIN_IDEA_CHARS, ownedBy,
  ledgerBefore, ledgerForSend, parseIndex, releaseRun, retryText, startAssistant, startTighten, stopAssistant, switchVersion, tightenRequestFor, titleAfterEdit, touchIndex, trimMessagesForStorage, usesEarlierTurns, withHeld,
  type AssistantMsg, type ChatConfig, type ChatEvent, type ChatMsg, type HistoryEntry, type IdeaMsg, type LedgerTurn, type MemoryEntry, type SearchScope, type TightenResponse, type UserMsg,
} from "@scholar/shared";
import { idbClear, idbDelete, idbRead, idbSwap } from "./idb";
import { showNotice } from "./notice";
import { readSse } from "./sse";

/**
 * The conversations of the prompt box. They live in this browser and nowhere else: the list in localStorage (so the rail can show it at once, and another tab hears of a change),
 * each conversation in IndexedDB (a list of papers is too big for localStorage). If the browser will not keep them, the conversation works for this visit and a notice says so.
 * Each tab has its own current conversation (sessionStorage); a conversation found part way through an answer (the page was closed or reloaded) is marked "interrupted".
 *
 * Whose they are (docs/design/chat-actions-context.md, section 6): each entry of the list is stamped with the id of the signed-in person who made the chat (`owner`), and a chat of ANOTHER signed-in person is
 * ignored and removed as soon as the page knows who is here (`setChatOwner`, from `refreshAuth`): that is the shared-computer protection. A session that merely RUNS OUT (the cookie lasts 30 days and is
 * never renewed) is not that: while nobody is signed in the owned chats are neither shown nor used, but they are KEPT, and come back when the same person signs in; only an explicit sign-out (`beginWipe`,
 * `clearChats`) and "Delete all" remove them without another person to compare with. A message leans only on its own chat: nothing of another chat is ever sent (the earlier-chats feature, with its
 * words on each entry and its "do not use as memory" mark, was removed on 6 Nov 2026; `parseIndex` drops what it left in the list).
 *
 * Two tabs: the list is written back whole from what is stored NOW (what this page cannot see is kept: `writeIndex`), and each record carries a revision, so a tab that was left behind cannot write its old
 * copy over what another tab saved (`write`, `idbSwap`): it takes the other copy up and says so.
 */
type Entry = MemoryEntry;
/**
 * `liveIdeas`: the Idea Checks of the conversations open in this tab that are running here (their plan and papers are in the page, not kept); one that is not in the set was kept from an earlier visit and shows "run it again".
 * `privateChats`: conversations that are not kept and not used (they have no place in the list and no record; `pendingPrivate`: the next new chat will be one). Both are of this page only and are not stored.
 * `newTopic`: the conversations in which the person pressed "New topic" and has not yet sent the next message (R22, docs/design/intent-and-state.md, 4.19): that message is marked and goes out with no earlier turn. By chat id; kept in this tab's
 * sessionStorage (`TOPIC_KEY`), which is not a store of chats (ids only): a reload must not bring the earlier messages back for the next message after the person said not to use them.
 */
type State = { index: Entry[]; active: string | null; chats: ReadonlyMap<string, ChatMsg[]>; running: ReadonlySet<string>; liveIdeas: ReadonlySet<string>; kept: boolean; privateChats: ReadonlySet<string>; pendingPrivate: boolean; newTopic: ReadonlySet<string> };

const INDEX_KEY = "scholar.chats.v1";
const ACTIVE_KEY = "scholar.chat.active";
/** The device's choice of the removed "Use my earlier chats" switch (it held the account id of the person who turned it on): taken out of the browser once, when this file loads. */
const RETIRED_EARLIER_KEY = "scholar.earlier";
/** Set when a sign-out begins and removed when its clearing of the chats is done: a page that finds it set finishes the job (the tab was closed part way). */
const WIPE_KEY = "scholar.wipe";
const MAX_CHATS = 30;

/**
 * Who is here: the id of the signed-in person, `null` when nobody is (checked, not just unknown), `undefined` until the page has asked. Chats of another person are not shown, used or kept, and while
 * nobody is signed in the chats of any person are held back, not shown (`ownedBy`). Set only by `setChatOwner`, which the sign-in check (`refreshAuth`) calls once it has a real answer; a failed check does
 * not call it, so a lost connection never removes anybody's chats. Only a string means a person is signed in: it is what decides that earlier messages may leave the device.
 */
let owner: string | null | undefined;

/** Every entry of the list in storage, whoever's it is (what this page shows is `readIndex`). */
const readStored = (): Entry[] => {
  try {
    return parseIndex(JSON.parse(localStorage.getItem(INDEX_KEY) ?? "[]") as unknown, MAX_CHATS);
  } catch {
    return [];
  }
};
const readIndex = (): Entry[] => ownedBy(readStored(), owner).kept;
const readActive = (): string | null => {
  try {
    return sessionStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
};

const TOPIC_KEY = "scholar.chat.topic";
const readNewTopic = (): Set<string> => {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(TOPIC_KEY) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, MAX_CHATS) : []);
  } catch {
    return new Set();
  }
};
const keepNewTopic = (ids: ReadonlySet<string>) => {
  try {
    if (ids.size > 0) sessionStorage.setItem(TOPIC_KEY, JSON.stringify([...ids]));
    else sessionStorage.removeItem(TOPIC_KEY);
  } catch {
    /* the press is then not remembered across a reload: it still holds for this visit */
  }
};

let state: State = { index: typeof localStorage === "undefined" ? [] : readIndex(), active: typeof sessionStorage === "undefined" ? null : readActive(), chats: new Map(), running: new Set(), liveIdeas: new Set(), kept: true, privateChats: new Set(), pendingPrivate: false, newTopic: typeof sessionStorage === "undefined" ? new Set() : readNewTopic() };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};
const setChat = (id: string, msgs: ChatMsg[]) => set({ chats: new Map(state.chats).set(id, msgs) });
/** A change to some of a conversation's messages: the conversation is replaced only if one of them really changed (a late event for a reply that is no longer there leaves the very same list, which has nothing new to be saved). */
const changeReply = (id: string, msgs: ChatMsg[], fn: (m: ChatMsg) => ChatMsg) => {
  const next = msgs.map(fn);
  if (next.some((m, i) => m !== msgs[i])) setChat(id, next);
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useChatState = (): State => useSyncExternalStore(subscribe, () => state, () => state);
/** The state as it is now, for an event handler that has to look at it without drawing again for every change of it. */
export const currentChatState = (): State => state;

const isConversing = () => !!state.active && (state.chats.get(state.active)?.length ?? 0) > 0;
/** Whether this tab has a conversation on screen. A boolean snapshot: what uses it renders again only when it flips, not on every event of a streaming reply. */
export const useConversing = (): boolean => useSyncExternalStore(subscribe, isConversing, isConversing);

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "").slice(0, 20) : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

/* ---------------------------------------------------------------- keeping them */

let warned = false;
const timers = new Map<string, number>();
/** The revision of each conversation's record as this page last read or wrote it (none: 0, which a record kept before revisions also has). */
const revs = new Map<string, number>();
/**
 * What each conversation was when it was last read from or written to the browser's storage, by identity: a conversation is never changed in place (every change is a new list), so a page whose list is still
 * that one has nothing that is not kept, and a save has nothing to write.
 */
const synced = new Map<string, ChatMsg[]>();
/** The saves of each conversation that are queued or being made, one after the other: each one starts from the revision the one before it left. */
const saving = new Map<string, Promise<void>>();
function storeIndex(list: Entry[]) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch {
    keptFailed();
  }
}
/**
 * Write the list of the chats this page shows. What it does NOT show (the chats of a person who is not here, those of another person that a tab with an old idea of who is here cannot see) is read from
 * storage as it is now and written back with it, so that this page's own change never deletes them from the browser; when there is no room for all of it those chats go first, with their records.
 */
function writeIndex(visible: Entry[]) {
  const shown = new Set(visible.map((e) => e.id));
  const { held, dropped: others } = ownedBy(readStored(), owner);
  const { list, dropped } = withHeld(visible, [...held, ...others].filter((e) => !shown.has(e.id)), MAX_CHATS);
  for (const d of dropped) void idbDelete(d.id, "chats");
  storeIndex(list);
}
function keptFailed() {
  if (state.kept) set({ kept: false });
  if (!warned) {
    warned = true;
    showNotice("This browser would not keep your chats, so they will be gone when you close the page.");
  }
}
/** Save a conversation a moment after its last change (words arrive many times a second), and at once when `now`. A private conversation is never saved. */
function persist(id: string, now = false) {
  if (state.privateChats.has(id)) return;
  // saves of one conversation go one after the other: each is made against the revision the one before it left
  const save = () => {
    const next: Promise<void> = (saving.get(id) ?? Promise.resolve()).then(() => write(id)).finally(() => {
      if (saving.get(id) === next) saving.delete(id);
    });
    saving.set(id, next);
    return next;
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
/**
 * One save: the conversation as this page holds it, written only if its record is still the one this page read or wrote last (`idbSwap`: the revision is compared in the same transaction). When another
 * tab has saved it since, nothing is written: that tab's copy is kept (`changedElsewhere`).
 */
async function write(id: string) {
  try {
    const msgs = state.chats.get(id);
    if (!msgs || synced.get(id) === msgs) return;
    // the replies in the versions of an edited message are cut for keeping too (a version is stored inside its message, so deleting the chat deletes them)
    const kept = trimMessagesForStorage(msgs);
    // the turn ledger (M2) is kept with the chat: built from these same messages, so it is what they say, from the last "New topic" on, along the versions being read
    const r = await idbSwap(id, (rev) => ({ id, messages: kept, rev, ledger: buildLedger(kept) }), revs.get(id) ?? 0, "chats");
    if (r.status === "saved") {
      revs.set(id, r.rev);
      synced.set(id, msgs);
    } else if (r.status === "failed") keptFailed();
    else await changedElsewhere(id);
  } catch {
    keptFailed();
  }
}
/**
 * Another tab saved this conversation after this page read it, so this page's copy is the older one. What is kept is not touched: this page takes that copy up (a reply being written here for the old copy is
 * stopped, and what this page had that was not yet kept is let go) and says so. Not told in words that sound like a failure: nothing that was kept is lost.
 */
async function changedElsewhere(id: string) {
  const r = await idbRead<{ messages: ChatMsg[]; rev?: number }>(id, "chats");
  // not readable now, or deleted by the other tab (which has taken it out of the list: the storage event lets it go here): nothing is written, and nothing is recreated
  if (!r.ok || !r.value) return;
  runs.get(id)?.ctl.abort();
  window.clearTimeout(timers.get(id));
  timers.delete(id);
  revs.set(id, typeof r.value.rev === "number" ? r.value.rev : 0);
  takeUp(id, r.value.messages);
  showNotice("This chat was changed in another tab, so it was reloaded here. Anything you had added here that was not saved yet is not kept.");
}
/**
 * A conversation this page holds is looked at again against what is kept: when another tab has saved it since (a tab that was left in the background, a chat opened again after another tab edited it) this page
 * takes that copy up without a word. Not while this page has changes of its own that are not kept yet, a reply being written or a strict check running: its copy is then the newer one.
 */
async function refreshChat(id: string) {
  const quiet = () => !state.privateChats.has(id) && !runs.has(id) && !timers.has(id) && !saving.has(id) && !(state.chats.get(id) ?? []).some((m) => tightening.has(m.id));
  if (!state.chats.has(id) || !quiet()) return;
  const r = await idbRead<{ messages: ChatMsg[]; rev?: number }>(id, "chats");
  if (!r.ok || !r.value || !state.chats.has(id) || !quiet()) return;
  const rev = typeof r.value.rev === "number" ? r.value.rev : 0;
  if (rev === (revs.get(id) ?? 0)) return;
  revs.set(id, rev);
  takeUp(id, r.value.messages);
}
/** The copy that is kept becomes the one this page holds (a reply that was still working in it belongs to a page that is gone). It is what is kept, so there is nothing of it to save. */
function takeUp(id: string, kept: ChatMsg[]) {
  if (!state.chats.has(id)) return;
  const msgs = interruptMessages(kept);
  setChat(id, msgs);
  synced.set(id, msgs);
}
/**
 * What the entry of a conversation says besides its title, as of now: who it belongs to (the person signed in; a chat kept before chats had an owner, or by a visitor, is adopted by the first signed-in person
 * who touches or opens it).
 */
const entryFacts = (): Partial<Entry> => (typeof owner === "string" ? { owner } : {});
const touch = (id: string, title?: string) => {
  // a private conversation is not kept: it has no entry
  if (state.privateChats.has(id)) return;
  // the old entry is spread, not rebuilt from three fields: what an entry has gained must survive the conversation being touched
  const { kept, dropped } = touchIndex(state.index, id, title, Date.now(), MAX_CHATS, entryFacts());
  for (const d of dropped) void idbDelete(d.id, "chats");
  set({ index: kept });
  writeIndex(kept);
};
/** A change to an entry that is not a reason to bring the conversation to the top of the list (an owner is stamped on it). */
function patchEntry(id: string, patch: Partial<Entry>) {
  if (!state.index.some((e) => e.id === id)) return;
  const index = state.index.map((e) => (e.id === id ? { ...e, ...patch } : e));
  set({ index });
  writeIndex(index);
}

function setActive(id: string | null) {
  const left = state.active;
  try {
    if (id) sessionStorage.setItem(ACTIVE_KEY, id);
    else sessionStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* the current chat is then not remembered across a reload */
  }
  set({ active: id });
  // a private conversation is gone when it is left: it was not kept, and there is no list to come back to it from
  if (left && left !== id && state.privateChats.has(left)) forget([left], false);
}

/**
 * Let go of conversations this page holds: stop what is running in them, forget what waits to be saved, take them out of memory. `fromStorage`: also delete their
 * records (this tab is the one that took them out of the list; when another tab did, it has deleted them already, and a second delete could meet a chat that was made since).
 */
function forget(ids: readonly string[], fromStorage: boolean) {
  if (ids.length === 0) return;
  const gone = new Set(ids);
  for (const id of gone) {
    runs.get(id)?.ctl.abort();
    for (const m of state.chats.get(id) ?? []) tightening.get(m.id)?.abort();
    window.clearTimeout(timers.get(id));
    timers.delete(id);
    revs.delete(id);
    synced.delete(id);
    if (fromStorage) void idbDelete(id, "chats");
  }
  set({
    chats: new Map([...state.chats].filter(([id]) => !gone.has(id))),
    privateChats: new Set([...state.privateChats].filter((id) => !gone.has(id))),
    newTopic: new Set([...state.newTopic].filter((id) => !gone.has(id))),
  });
  keepNewTopic(state.newTopic);
  if (state.active && gone.has(state.active)) setActive(null);
}

/**
 * The page now knows who is here (`null`: nobody is signed in). Called by `refreshAuth` with a real answer only. The list is read from storage and divided by `ownedBy`:
 * - the chats of ANOTHER signed-in person are removed (from the list, from the browser's storage and from this page's memory): somebody else is at this browser;
 * - while nobody is signed in the chats of any person are held: gone from the page (not shown, not used, not saved back) but left in storage, and back when the same person signs in. A cookie that ran out
 *   must not delete a person's chats (before chats had an owner, expiry kept them); only an explicit sign-out does that;
 * - the one the person is looking at, if it has no owner yet, becomes theirs.
 */
export function setChatOwner(next: string | null) {
  owner = next;
  const { kept, dropped, held } = ownedBy(readStored(), next);
  if (dropped.length > 0) storeIndex([...kept, ...held]);
  set({ index: kept });
  forget(held.map((e) => e.id), false);
  forget(dropped.map((e) => e.id), true);
  const open = state.active ? state.index.find((e) => e.id === state.active) : undefined;
  if (typeof next === "string" && open && open.owner === undefined) patchEntry(open.id, { owner: next });
}

/** A sign-out begins: if the tab is closed before it has cleared the chats, the next page that loads finishes it (`clearChats` takes the mark away when it is done). */
export function beginWipe() {
  try {
    localStorage.setItem(WIPE_KEY, "1");
  } catch {
    /* storage blocked: there is then no list to leave behind either */
  }
}

if (typeof window !== "undefined") {
  // a page that is closed or put away with a save still waiting (words arrive faster than the 800 ms save) starts that save now, while it can
  const saveWaiting = () => {
    for (const id of [...timers.keys()]) persist(id, true);
  };
  window.addEventListener("pagehide", saveWaiting);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveWaiting();
    // a tab that was in the background may have missed what another tab saved: its conversation is looked at again against what is kept before the person acts in it
    else if (state.active) void refreshChat(state.active);
  });
  // (a window that is clicked into again does not always say that it became visible: it says that it has the focus)
  window.addEventListener("focus", () => {
    if (state.active) void refreshChat(state.active);
  });
  // Another tab changed the list: take it up. A conversation this page holds that the list no longer has (that tab deleted it, cleared the chats, or signed out) is let go, so that this page cannot save it
  // back (and a person who signed out in one tab does not leave the last chats on screen in another). The current conversation of this tab stays unless it is one of those; one being answered here stays.
  window.addEventListener("storage", (e) => {
    if (e.key !== null && e.key !== INDEX_KEY) return;
    const index = readIndex();
    const gone = goneFromIndex(state.chats.keys(), index, new Set([...runs.keys(), ...state.privateChats]));
    set({ index });
    forget(gone, false);
  });
}

/* ---------------------------------------------------------------- using them */

/**
 * Open a conversation (reading it from the browser's storage the first time; one this page already holds is looked at again against what is kept, in case another tab saved it since). What was chosen for
 * the NEXT new chat (a private chat) is dropped: it was for a chat that does not exist yet, and would otherwise come back, to be applied to a later chat, when the one opened
 * here is deleted. A read that FAILS (the browser said no, not "there is no such record") opens nothing: an empty chat in its place would be written back by the next message and delete what is kept.
 */
export async function openChat(id: string): Promise<void> {
  const before = state.active;
  setActive(id);
  if (state.pendingPrivate) set({ pendingPrivate: false });
  // opening a chat kept before chats had an owner (or made by a visitor) makes it the signed-in person's own
  const entry = state.index.find((e) => e.id === id);
  if (entry && entry.owner === undefined && typeof owner === "string") patchEntry(id, { owner });
  if (state.chats.has(id)) {
    void refreshChat(id);
    return;
  }
  const read = await idbRead<{ messages: ChatMsg[]; rev?: number }>(id, "chats");
  if (!read.ok) {
    // back to what was on screen before the press, if that is still a conversation this page holds; the next press on this one reads it again
    if (state.active === id) setActive(before && before !== id && state.chats.has(before) ? before : null);
    showNotice("This chat could not be read right now. Nothing was changed: try opening it again.");
    return;
  }
  const saved = read.value;
  revs.set(id, typeof saved?.rev === "number" ? saved.rev : 0);
  // a reply that was working belongs to a page that is gone (one in a version that was put away too)
  const msgs = interruptMessages(saved?.messages ?? []);
  if (state.active === id && !state.chats.has(id)) {
    setChat(id, msgs);
    synced.set(id, msgs);
  }
}

/** A new, empty conversation: it is created when its first message is sent. A private choice made for the one that did not exist yet is dropped with it. */
export function startNewChat() {
  if (state.pendingPrivate) set({ pendingPrivate: false });
  setActive(null);
}

/**
 * "New topic" (R22, docs/design/intent-and-state.md, 4.19, 7.2 and 7.7): the person stops this chat's earlier messages from being used for the next message, without leaving the chat. The next message is marked (`newTopic`)
 * and goes out with no earlier turn; the earlier messages stay on the page and in the record and are simply not carried. Only in a chat that has a finished search (`canStartNewTopic`) and not twice. True when it was set.
 * D1 stands: context stays automatic inside a chat, and this is the per-chat way to stop it; there is no switch for "never use earlier messages".
 */
export function startNewTopic(): boolean {
  const id = state.active;
  const msgs = id ? state.chats.get(id) : undefined;
  if (!id || !msgs || state.newTopic.has(id) || !canStartNewTopic(msgs)) return false;
  setNewTopic(new Set(state.newTopic).add(id));
  return true;
}

/** The chip's remove button: the earlier messages of this chat are used again for the next message. */
export function cancelNewTopic() {
  const id = state.active;
  if (id && state.newTopic.has(id)) setNewTopic(new Set([...state.newTopic].filter((x) => x !== id)));
}

/** Whether the conversation on screen has "New topic" pressed and waiting for its next message. */
export const topicPending = (s: State): boolean => !!s.active && s.newTopic.has(s.active);

function setNewTopic(ids: ReadonlySet<string>) {
  set({ newTopic: ids });
  keepNewTopic(ids);
}

/** Whether the conversation on screen (or the one about to start) is private: not kept, not used, and gone when it is left. */
export const isPrivateChat = (s: State): boolean => (s.active ? s.privateChats.has(s.active) : s.pendingPrivate);

/** A new conversation that is not kept: it is not saved, has no place in the list, and is gone when it is left or the page is closed. */
export function startPrivateChat() {
  startNewChat();
  set({ pendingPrivate: true });
}

/**
 * The conversation a new message goes to: the open one, or a new one made now (a conversation is created by its first message). A new one takes on what was chosen for it before it existed: being private.
 */
function chatForMessage(): string {
  const open = state.active;
  if (open && (state.index.some((e) => e.id === open) || state.privateChats.has(open))) return open;
  const id = newId();
  setActive(id);
  if (state.pendingPrivate) set({ privateChats: new Set(state.privateChats).add(id), pendingPrivate: false });
  return id;
}

/**
 * Restore the current conversation of this tab when Home appears (after a load, and after any other page: Home is not kept mounted). A private conversation is held by this page, not by the list, and going
 * to Library, Settings or Papers and back is not leaving it: it stays, with an answer that is still being written. After a reload nothing holds it, and the id left in sessionStorage is dropped.
 */
export function resumeChat() {
  const id = state.active;
  if (!id || state.privateChats.has(id)) return;
  if (state.index.some((e) => e.id === id)) void openChat(id);
  else setActive(null);
}

/**
 * An Idea Check in the conversation: the idea's text is added (with the person's own message first when it came from the box), and the workspace opens under it. The click that
 * asked for it is the person's consent to read the idea; the search itself waits for their approval inside the workspace. Only the text is kept with the conversation.
 */
export function startIdeaCheck(raw: string, opts: { echo?: boolean } = {}): "sent" | "busy" | "invalid" {
  const text = raw.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < MIN_IDEA_CHARS || text.length > MAX_IDEA_CHARS) return "invalid";
  const open = state.active;
  if (open && state.index.some((e) => e.id === open) && !state.chats.has(open)) return "busy"; // still being opened
  const id = chatForMessage();
  const now = Date.now();
  const idea: IdeaMsg = { id: newId(), role: "idea", text, at: now + 1 };
  // the text echoed with an Idea Check is the message sent next, so it takes the marker of "New topic" when it is pressed
  const marked = opts.echo === true && state.newTopic.has(id);
  const user: ChatMsg[] = opts.echo ? [{ id: newId(), role: "user", text, at: now, ...(marked ? { newTopic: true as const } : {}) }] : [];
  setChat(id, [...(state.chats.get(id) ?? []), ...user, idea]);
  if (marked) setNewTopic(new Set([...state.newTopic].filter((x) => x !== id)));
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
 * `scope` "india" searches only Indian sources (the reader's switch under the box); it applies when the message is a search. In Auto it goes with the last few finished searches of the conversation
 * (`contextBefore`), so that "only after 2020" can be understood; a search chosen by hand and the first message of a chat go with nothing.
 */
export function sendMessage(raw: string, mode: SendMode = "search", scope: SearchScope = "all", sinceYear?: number | null): SendResult {
  const text = mode === "auto" ? cleanAutoMessage(raw) : cleanChatMessage(raw);
  if (!text) return "invalid";
  const open = state.active;
  if (open && (runs.has(open) || (state.index.some((e) => e.id === open) && !state.chats.has(open)))) return "busy"; // answering, or still being opened
  const id = chatForMessage();
  const now = Date.now();
  // "New topic" was pressed in this chat: this message carries the marker, whatever tool it is sent in, and leans on nothing (R22)
  const marked = state.newTopic.has(id);
  const user: UserMsg = { id: newId(), role: "user", text, at: now, ...(marked ? { newTopic: true as const } : {}) };
  const reply = startAssistant(newId(), text.replace(/\s+/g, " ").slice(0, 300), now, mode === "auto", scope, sinceYear ?? undefined);
  const before = state.chats.get(id) ?? [];
  const history = mode === "auto" ? contextBefore([...before, user], before.length) : [];
  // the line "did not finish": only when there are turns to lean on, and the reply right before this message is the one that did not finish
  const unfinished = history.length > 0 && lastReplyDidNotFinish(before, before.length);
  // M4: the turn ledger of this chat up to the message (none after "New topic"); it is sent only if the server says the Understand step reads it (`run`)
  const ledger = mode === "auto" ? ledgerBefore([...before, user], before.length) : [];
  setChat(id, [...before, user, reply]);
  if (marked) setNewTopic(new Set([...state.newTopic].filter((x) => x !== id)));
  touch(id, state.index.find((e) => e.id === id)?.title ?? chatTitle(text));
  persist(id, true);
  void run(id, reply.id, text, mode, scope, false, history, reply.sinceYear, unfinished, ledger);
  return "sent";
}

/** The words the reader wrote for a reply: the message just before it (the reply itself keeps only a tidied start of them). */
function askedFor(msgs: ChatMsg[], at: number): string | null {
  const before = msgs[at - 1];
  return before?.role === "user" ? before.text : null;
}

/**
 * "Search again" on a reply: the same question asked again, in the same place, the same way (Auto chooses again; a search chosen by hand is searched as written).
 * With `as: "search"` ("Use my exact words", or Change to Search papers) it is asked as an explicit search whatever the router did before. With `as: "anyway"` ("Search for these words anyway",
 * under the reply to small talk) it is a search of the words as written that the box does not take for small talk.
 * A reply that is asked again in Auto goes with the turns that came before ITS question (`contextBefore`: not the later ones), which is what makes a follow-up's own words mean something again.
 * A search as written has no earlier turns to lean on, so for one whose own words cannot stand alone ("only after 2020") `words` is what to search instead: the standalone question, or the topic
 * without its year range. It is used only with `as: "search"`. What is asked again is decided by `retryText`: a search that was made from such words asks THEM again, not the bubble above it.
 * A strict check that is running on the reply is stopped first: the reply is about to be replaced by another under the same id, and the check's answer must not be bound to its papers.
 */
export function retryReply(assistantId: string, as?: "search" | "anyway", words?: string): SendResult {
  const id = state.active;
  if (!id || runs.has(id)) return "busy";
  const msgs = state.chats.get(id);
  const at = msgs?.findIndex((m) => m.id === assistantId) ?? -1;
  const old = msgs?.[at];
  if (!msgs || !old || old.role !== "assistant") return "invalid";
  const mode: SendMode = as === "search" || as === "anyway" || !old.auto ? "search" : "auto";
  const written = askedFor(msgs, at);
  const again = retryText(old, written, as, words);
  const text = mode === "auto" ? cleanAutoMessage(again) : cleanChatMessage(again);
  if (!text) {
    showNotice(`A search is at most ${MAX_CHAT_CHARS} characters. For a longer text, use Check references or Idea Check.`);
    return "invalid";
  }
  // it looks in the same place as before (the Indian sources stay on for a reply that was searched there)
  const scope = old.scope ?? "all";
  // the year a Trending chip started the papers from is asked for again with the same words (Search again, Use my exact words); not with other words (the year chip's X, "Use these exact words" under a follow-up), and not for "anyway" (small talk)
  const since = words === undefined && as !== "anyway" ? old.sinceYear : undefined;
  const reply = startAssistant(assistantId, text.replace(/\s+/g, " ").slice(0, 300), Date.now(), mode === "auto", scope, since);
  tightening.get(assistantId)?.abort();
  tightening.delete(assistantId);
  setChat(id, msgs.map((m, i) => (i === at ? reply : m)));
  persist(id, true);
  const upTo = written === null ? at : at - 1;
  const history = mode === "auto" ? contextBefore(msgs, upTo) : [];
  const ledger = mode === "auto" && as !== "anyway" ? ledgerBefore(msgs, upTo) : [];
  void run(id, assistantId, text, mode, scope, as === "anyway", history, reply.sinceYear, history.length > 0 && lastReplyDidNotFinish(msgs, upTo), ledger);
  return "sent";
}

/** Why a message was not edited. "busy": a reply is being written or a strict check is running (or the conversation is still being opened); "invalid": the new words cannot be sent (too short, too long for that tool); "unchanged": the same words; "unavailable": there is no such message to edit. */
export type EditResult = "sent" | "busy" | "invalid" | "unchanged" | "unavailable";

/** The messages that an edit or a switch puts away no longer have a live Idea Check: its plan and papers were never kept, so coming back to it offers "Run it again" and does not start a search by itself. */
function dropLiveIdeas(away: readonly ChatMsg[]) {
  const gone = away.filter((m) => m.role === "idea" && state.liveIdeas.has(m.id)).map((m) => m.id);
  if (gone.length) set({ liveIdeas: new Set([...state.liveIdeas].filter((i) => !gone.includes(i))) });
}

/**
 * Edit a message you sent and ask again (docs/design/chat-actions-context.md, section 4). The words are replaced and a new reply is written under them; the old words and every message after
 * them are kept as a version of that message, one press away (`showVersion`). Like "Search again" it keeps the tool and the place of the reply it replaces (Auto chooses again, a search chosen by hand is
 * searched as written), and the new words must pass what the box passes for that tool. The new reply has a NEW id: a reply that is stopped or running under the old id must not be reached by it.
 * Refused while an answer is being written or a strict check is running, so that nothing writes into the messages that are put away.
 */
export function editMessage(userId: string, raw: string): EditResult {
  const id = state.active;
  if (!id) return "unavailable";
  const msgs = state.chats.get(id);
  if (!msgs) return "busy"; // still being opened
  if (runs.has(id) || busyReason(msgs) || msgs.some((m) => tightening.has(m.id))) return "busy";
  const info = editInfo(msgs, userId);
  if (!info) return "unavailable";
  const text = info.mode === "auto" ? cleanAutoMessage(raw) : cleanChatMessage(raw);
  if (!text) return "invalid";
  if (text === (msgs[info.at] as UserMsg).text) return "unchanged";
  const reply = startAssistant(newId(), text.replace(/\s+/g, " ").slice(0, 300), Date.now(), info.mode === "auto", info.scope, info.sinceYear);
  const next = editUserMessage(msgs, userId, text, reply);
  if (!next) return "unavailable";
  // the turns before the edited message are not changed by the edit (everything from it on is put away): they are the context it is sent with, and nothing at or after it ever is
  const history = info.mode === "auto" ? contextBefore(msgs, info.at) : [];
  const unfinished = history.length > 0 && lastReplyDidNotFinish(msgs, info.at);
  const ledger = info.mode === "auto" ? ledgerBefore(msgs, info.at) : [];
  const away = msgs.slice(info.at + 1);
  for (const m of away) tightening.get(m.id)?.abort(); // none is running (refused above); a check that began in this very turn is stopped
  dropLiveIdeas(away);
  setChat(id, next);
  touch(id, titleAfterEdit(msgs, userId, text, state.index.find((e) => e.id === id)?.title ?? chatTitle(text)));
  persist(id, true);
  void run(id, reply.id, text, info.mode, info.scope, false, history, reply.sinceYear, unfinished, ledger);
  return "sent";
}

/** Bring another version of an edited message back: its words and its messages replace the ones on screen, which are kept in turn. Refused while an answer is being written or a strict check is running. */
export function showVersion(userId: string, to: number): "switched" | "busy" | "invalid" {
  const id = state.active;
  const msgs = id ? state.chats.get(id) : undefined;
  if (!id || !msgs) return "invalid";
  if (runs.has(id) || busyReason(msgs) || msgs.some((m) => tightening.has(m.id))) return "busy";
  const next = switchVersion(msgs, userId, to);
  const at = msgs.findIndex((m) => m.id === userId);
  const shown = next?.[at];
  if (!next || shown?.role !== "user") return "invalid";
  dropLiveIdeas(msgs.slice(at + 1));
  setChat(id, next);
  // the title is the first message's words, so another version of the first message brings its title with it
  const current = state.index.find((e) => e.id === id)?.title;
  const title = current === undefined ? undefined : titleAfterEdit(msgs, userId, shown.text, current);
  if (title !== undefined && title !== current) touch(id, title);
  persist(id, true);
  return "switched";
}

/** Stop the answer being written in the current conversation. */
export function stopReply() {
  const r = state.active ? runs.get(state.active) : undefined;
  r?.ctl.abort();
}

/**
 * M4: whether the server wants the turn ledger with a message (GET /api/v1/chat/config: only while the Understand step reads it for this person). Asked once and kept for five minutes per person (signed in or
 * not); while it is not known yet the page waits at most 1.5 s, and a page that could not ask sends no ledger: nothing leaves the browser unless the server said it is read.
 */
const CONFIG_MS = 5 * 60_000;
let chatConfig: { who: string; at: number; value: ChatConfig } | null = null;
async function ledgerWanted(signedIn: boolean): Promise<boolean> {
  const who = signedIn && typeof owner === "string" ? owner : "visitor";
  if (chatConfig && chatConfig.who === who && Date.now() - chatConfig.at < CONFIG_MS) return chatConfig.value.ledger;
  try {
    const res = await fetch("/api/v1/chat/config", { credentials: "same-origin", signal: AbortSignal.timeout(1500) });
    const j = res.ok ? ((await res.json()) as Partial<ChatConfig>) : null;
    const value: ChatConfig = { ledger: j?.ledger === true };
    chatConfig = { who, at: Date.now(), value };
    return value.ledger;
  } catch {
    return false;
  }
}

/**
 * Write one reply. `history` is what the message may lean on (`contextBefore`, only in Auto; empty means nothing is sent, and the body is what it was before there was any). The server reads it
 * strictly and refuses a body it could not have been sent (400 `invalid_history`), which would end every follow-up of the conversation in an error the person cannot mend: the message itself
 * is good, so in that one case it is sent again, once, without them (it is read as a first message; nothing more is sent than was).
 * `unfinished`: the reply right before this message did not finish, so the turns it leans on are those before it (R22): when the server then says it read them and took the message for a follow-up of them, the reply
 * gets the line `didNotFinishText` (the notice kind "unfinished", made here and never sent by the server). Said only for a reply that was sent with turns, so never for a visitor, a search chosen by hand or a first message.
 */
async function run(chatId: string, assistantId: string, text: string, mode: SendMode, scope: SearchScope, anyway = false, history: HistoryEntry[] = [], sinceYear?: number, unfinished = false, ledgerTurns: LedgerTurn[] = []) {
  const ctl = new AbortController();
  runs.set(chatId, { ctl, assistantId });
  set({ running: new Set(runs.keys()) });
  // earlier messages leave the device only for a person who is known to be signed in (the server ignores them for anybody else; they must not be sent at all). Not yet known is not signed in.
  const signedIn = typeof owner === "string";
  if (!signedIn) history = [];
  const mayNote = unfinished && history.length > 0;
  const patch = (fn: (m: AssistantMsg) => AssistantMsg) => {
    const msgs = state.chats.get(chatId);
    if (msgs) changeReply(chatId, msgs, (m) => (m.id === assistantId && m.role === "assistant" ? fn(m) : m));
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
    // M4: the turn ledger goes only when the server said the Understand step reads it (GET /chat/config), and only in Auto; a page that could not ask sends none
    const ledger = mode === "auto" && !anyway && ledgerTurns.length > 0 && (await ledgerWanted(signedIn)) ? ledgerForSend(ledgerTurns, { signedIn }) : [];
    const post = (turns: HistoryEntry[], led: readonly unknown[]) =>
      fetch("/api/v1/chat", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(chatRequestBody({ signedIn, mode, message: text, scope, anyway, history: turns, sinceYear, ledger: led })), signal: ctl.signal });
    let res = await post(history, ledger);
    const refused = res.status === 400 ? ((await res.clone().json().catch(() => null)) as { type?: string } | null)?.type : undefined;
    if (refused === "invalid_history" && history.length > 0) {
      console.warn("The earlier messages were not accepted, so this message was sent without them.");
      res = await post([], []);
    } else if (refused === "invalid_ledger" && ledger.length > 0) {
      console.warn("The record of this chat was not accepted, so this message was sent without it.");
      res = await post(history, []);
    }
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { title?: string; detail?: string } | null;
      throw new Error(res.status === 429 ? "Too many searches just now. Please wait a minute and try again." : (j?.title ?? "That could not be sent. Please try again."));
    }
    await readSse<ChatEvent>(
      res,
      (e) => {
        queue.push(e);
        // the reply followed the search before the one that did not finish: it says so (the reducer keeps one notice of a kind, and this kind is the page's own)
        if (mayNote && e.type === "understood" && usesEarlierTurns(e.context)) queue.push({ type: "notice", kind: "unfinished", text: didNotFinishText(e.language) });
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
    // only this run's own registration: a run that was stopped ends after a new one began, and must not unregister it (the box would take the new run's reply for finished)
    releaseRun(runs, chatId, ctl);
    set({ running: new Set(runs.keys()) });
    // the safety lane (R4): a reply that was an emergency or a crisis leaves nothing of the words behind, before the saves below can put them back
    settleSafety(chatId, assistantId);
    // a conversation deleted while it was being answered stays deleted; and one that was replaced by what another tab saved (`changedElsewhere`) no longer has this reply: writing it back would only
    // make this page's copy of the other tab's work the newest, and the other tab the one that is behind
    if (state.index.some((e) => e.id === chatId) && state.chats.get(chatId)?.some((m) => m.id === assistantId)) {
      touch(chatId);
      persist(chatId, true);
    }
  }
}

/**
 * The store rule of the safety lane (docs/design/intent-and-state.md, 4.5, "What the chat remembers of it"). A finished reply that is the lane's urgent or safety reply, or carries its crisis or urgent line
 * (`leavesNoTrace`), must not leave the words of the message on this device as a title in the rail or a word the chat is found by (a shared family or café computer would show them). The server decides it, so the
 * message was already put in the list when it was sent; this takes it out again once the reply is known:
 *  - a chat of one message pair is made private at once, as a chat the person started as private is: its place in the list and its record are taken away, nothing is listed, it is not saved again, and it is gone
 *    when it is left (the messages stay on the screen until then, with the card and its "Delete this chat");
 *  - in a longer chat the title stays what it was (it is the FIRST message's words) and the words of the message are left out of the words the chat is found by: `historyTurn` makes no turn of such a reply, and
 *    the words are made from the turns (`keywordsFor`), so there is nothing to take out here.
 * A page closed before the reply is known still holds the message (the lane is the server's, and nothing here may read the words to guess).
 */
function settleSafety(chatId: string, assistantId: string) {
  const msgs = state.chats.get(chatId);
  const reply = msgs?.find((m): m is AssistantMsg => m.role === "assistant" && m.id === assistantId);
  if (!msgs || !reply || !leavesNoTrace(reply) || state.privateChats.has(chatId)) return;
  if (msgs.length === 2 && state.index.some((e) => e.id === chatId)) void leaveNoTrace(chatId);
}
async function leaveNoTrace(id: string) {
  window.clearTimeout(timers.get(id));
  timers.delete(id);
  const index = state.index.filter((e) => e.id !== id);
  set({ index, privateChats: new Set(state.privateChats).add(id) });
  writeIndex(index);
  // a save that is under way finishes first, and then its record goes
  await saving.get(id)?.catch(() => undefined);
  revs.delete(id);
  synced.delete(id);
  await idbDelete(id, "chats");
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
  // what the check is made from: the answer this reply has now and the paper at each place it cited. The result is taken only into that same answer: a reply that was asked again under the same id while
  // the check ran (Search again, Use these exact words, a chip removed) is another reply, and the old sentences must not be bound to its papers, nor its state changed.
  const base = msg.answer;
  const asked = citedPaperIds(msg);
  const same = (m: AssistantMsg) => m.answer === base && m.status === "done";
  const patch = (fn: (m: AssistantMsg) => AssistantMsg) => {
    const msgs = state.chats.get(chatId);
    if (msgs) changeReply(chatId, msgs, (m) => (m.id === assistantId && m.role === "assistant" && same(m) ? fn(m) : m));
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
    patch((m) => applyTighten(m, out as TightenResponse, asked));
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") patch((m) => ({ ...m, strict: undefined }));
    else patch((m) => failTighten(m, e instanceof TypeError ? "The connection was lost. Check your internet and try again." : e instanceof Error ? e.message : "The strict check could not be done."));
  } finally {
    // only its own registration: a reply asked again begins by stopping this check and may have started another since
    if (tightening.get(assistantId) === ctl) tightening.delete(assistantId);
    persist(chatId, true);
  }
}

/** Cancel a strict check that is running: the reply stays as it was. */
export function cancelTighten(assistantId: string) {
  tightening.get(assistantId)?.abort();
}

/** A conversation goes, with its entry in the list, its record and anything running in it. */
export function deleteChat(id: string) {
  const index = state.index.filter((e) => e.id !== id);
  set({ index });
  writeIndex(index);
  forget([id], true);
}

/**
 * Every conversation goes: at sign-out (a shared computer must not show the last person's questions) and from Settings. The list goes with its owners, and so do the private conversations of this page.
 */
export async function clearChats(): Promise<void> {
  for (const r of runs.values()) r.ctl.abort();
  for (const t of tightening.values()) t.abort();
  for (const t of timers.values()) window.clearTimeout(t);
  set({ index: [], chats: new Map(), liveIdeas: new Set(), kept: true, privateChats: new Set(), pendingPrivate: false, newTopic: new Set() });
  keepNewTopic(state.newTopic);
  revs.clear();
  synced.clear();
  try {
    localStorage.removeItem(INDEX_KEY);
  } catch {
    /* ignore */
  }
  setActive(null);
  await idbClear("chats");
  // the clearing that a sign-out began is done
  try {
    localStorage.removeItem(WIPE_KEY);
  } catch {
    /* ignore */
  }
}

// a sign-out whose tab was closed before the chats were cleared: this page finishes it (everything above is defined by now)
try {
  if (typeof localStorage !== "undefined" && localStorage.getItem(WIPE_KEY) !== null) void clearChats();
} catch {
  /* storage blocked */
}

// The removed "Use my earlier chats" switch: its stored choice (the account id of the person who had turned it on) is taken out of this browser once. The words (`kw`) and the "do not use as memory" mark
// (`nomem`) it kept on the entries of the list are dropped by `parseIndex`; a list that still has them is written back now, so they do not wait for the next message to leave the browser.
try {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(RETIRED_EARLIER_KEY);
    const raw = localStorage.getItem(INDEX_KEY);
    if (raw !== null && /"(?:kw|nomem)"\s*:/.test(raw)) storeIndex(readStored());
  }
} catch {
  /* storage blocked: there is then nothing kept to remove */
}
