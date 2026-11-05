import type { Paper } from "./index";
import { cleanChatMessage } from "./chat";
import { MAX_HISTORY_ANSWER_CHARS, type AnswerLanguage } from "./chat-context";
import { activePath, answerWords, cutWhole, oneLine, scanTurns, topicStart, type ChatMsg, type FinishedTurn } from "./chat-state";

/**
 * The state of a conversation as a pure fold of the messages of the version being read (docs/design/intent-and-state.md, 4.19 R19 and 7.3). Nobody updates it: it is a function, recomputed from `activePath(msgs)`
 * when a message is sent and for finished replies only, so an edit, a version switch, a retry, a reload and a second tab come out right by construction (the text of an edited message that was put away is not on
 * the path, so it cannot be in the state).
 *
 * It holds the person's own words, the words the search used, the language of a reply, a year range, the place searched, a short code for each paper of the last list, whether the last reply was answered, the start
 * of its checked answer and how many replies did not finish: and nothing a stranger wrote. No title, no `Paper.id` (for a record with neither a DOI nor a PubMed number it is made from the title), no abstract, no
 * author, no Idea Check, no pasted list (a message over 300 characters is not a turn), no model-written summary or standalone question.
 *
 * R19 builds it and nothing sends or shows it: the browser sends `state` from R21 on. `contextBefore` (chat-state.ts), which builds the history that is sent today, is not changed, and a property test proves the two
 * agree on every field they share (apps/api/src/chat/chat-fold-walk.test.ts). The module has no side effect at the top and is used by no page code yet, so it is not in the first-load script.
 */

/** The wire budget in characters of `JSON.stringify(state)`, kept by `fitState` in a fixed order of what goes first. */
export const MAX_STATE_CHARS = 2200;
/** Finished searches counted, at most. */
export const MAX_STATE_TURNS = 99;
/** The person's own words of a search, and the words searched, as the state keeps them. */
export const MAX_STATE_ASKED = 200;
export const MAX_STATE_TOPIC = 120;
/** Codes of the papers of the last list, at most. */
export const MAX_STATE_LIST = 10;

export type StateLang = "en" | "hi" | "hinglish";
export type ConversationState = {
  v: 1;
  /** Finished searches on the active path, at most 99. */
  turns: number;
  current: null | {
    /** The person's own words of the last finished search, at most 200 characters. */
    asked: string;
    /** The words that search used (the Reading's topic when it had one), at most 120. */
    topic: string;
    lang: StateLang;
    /** The range that reply was limited to. */
    years: null | { from?: number; to?: number };
    scope: "all" | "india";
    /** `stateCode` of each paper of the list shown, in order, at most 10: never `Paper.id`, never a title. */
    listIds: string[];
    answered: boolean;
  };
  /** The two finished searches before it, oldest first (the same three turns the history has today). */
  before: { asked: string; topic: string }[];
  /** A preference the person asked for in words. Empty: it is off until the owner says yes (O-13). */
  prefs: { answerLanguage?: AnswerLanguage };
  /** The last user message was sent after "New topic" (R22); the turns above are then the ones from that message on, and none of those before it. */
  newTopic: boolean;
  /** Replies that were stopped, failed or interrupted since the last finished search, at most 2: for the honest line only, never their content. */
  unfinished: 0 | 1 | 2;
  /** The start of the latest checked answer, at most 500 characters, marks, links and DOIs removed: what the history carries today, for the writer only and only for the same papers. */
  lastAnswer?: string;
};

/* ---------------------------------------------------------------- state codes */

/**
 * A short code for a paper, which the browser and the server compute the same way: `p:` and the digits for a PubMed number, and for everything else `d:` and 8 hex characters of a 32-bit FNV-1a hash of `Paper.id`.
 * `Paper.id` is `doi:...`, `pmid:...` or, for a record with neither, built from the TITLE (`t:<title>|<year>`, apps/api/src/search/merge.ts), so it can carry a stranger's words: the hash cannot. Null for something
 * that is not a record (no PubMed number and no id). The hash is over UTF-16 code units, so no text decoder is needed, and it is pinned by a test against a reference written apart from this one.
 */
export function stateCode(p: unknown): string | null {
  if (typeof p !== "object" || p === null) return null;
  const { id, pmid } = p as { id?: unknown; pmid?: unknown };
  if (typeof pmid === "string" && /^\d{1,10}$/.test(pmid)) return `p:${pmid}`;
  if (typeof id !== "string" || id === "") return null;
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `d:${(h >>> 0).toString(16).padStart(8, "0")}`;
}

/** The codes of the first papers of a list, in order, up to the first that cannot have one (so a position in the list is never wrong). */
function listCodes(papers: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(papers)) return out;
  for (let i = 0; i < papers.length && out.length < MAX_STATE_LIST; i++) {
    const c = stateCode(papers[i] as Paper);
    if (c === null) break;
    out.push(c);
  }
  return out;
}

/* ---------------------------------------------------------------- text kept in the state */

const LONE_REPLACEMENT = String.fromCharCode(0xfffd);
/** Text as the state keeps it: one line, nothing invisible, and no lone half of a character (which JSON would write as six characters of escape). */
function line(s: string): string {
  const t = oneLine(s);
  let out = "";
  let changed = false;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    const next = t.charCodeAt(i + 1);
    if (c >= 0xd800 && c <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      out += t[i]! + t[i + 1]!;
      i++;
    } else if (c >= 0xd800 && c <= 0xdfff) {
      out += LONE_REPLACEMENT;
      changed = true;
    } else out += t[i]!;
  }
  return changed ? out : t;
}
/** Words that can be a search (2 to 300 characters with a letter or a number in them), as one clean line, or nothing. */
const words = (x: unknown): string | null => (typeof x === "string" ? cleanChatMessage(line(x)) : null);

/** The words a finished search used: the Reading's topic, else the reply's search words (or what the reply was made from), else the person's own words. */
function topicOf(t: FinishedTurn): string {
  const reading = t.from.reading as { topic?: unknown } | null | undefined;
  return words(reading?.topic) ?? words(t.reply.searchQuery) ?? line(t.asked.text);
}

/* ---------------------------------------------------------------- the fold */

/**
 * The state of a conversation. `path` is the messages before the one that is about to be sent (or, to look at an earlier point, the first k of them); the versions of an edited message are not read. Pure, total (a
 * damaged record is skipped, a path that is not a list is an empty one) and fast: one pass over the path.
 */
export function foldState(path: readonly ChatMsg[]): ConversationState {
  // a record that is not an object is put where it stood as one that is not a message, so that it breaks the pairing of a question with its reply and is never read
  const damaged = { id: "", role: "idea", text: "", at: 0 } as ChatMsg;
  const msgs = Array.isArray(path) ? path.map((m) => (typeof m === "object" && m !== null ? m : damaged)) : [];
  const all = activePath(msgs);
  // R22: the state starts at the message that was sent after "New topic" (the marked message is the first message of the new topic), and says when the last user message is that one
  const { turns, unfinished } = scanTurns(all.slice(topicStart(all)));
  let lastUser: ChatMsg | undefined;
  for (let i = all.length - 1; i >= 0 && !lastUser; i--) if (all[i]?.role === "user") lastUser = all[i];
  const last = turns.at(-1);
  const state: ConversationState = { v: 1, turns: Math.min(turns.length, MAX_STATE_TURNS), current: null, before: [], prefs: {}, newTopic: lastUser?.role === "user" && lastUser.newTopic === true, unfinished };
  if (!last) return fitState(state);
  const years = last.reply.yearFrom !== undefined || last.reply.yearTo !== undefined ? { ...(last.reply.yearFrom === undefined ? {} : { from: last.reply.yearFrom }), ...(last.reply.yearTo === undefined ? {} : { to: last.reply.yearTo }) } : null;
  const answer = answerWords(last.from);
  state.current = {
    asked: cutWhole(line(last.asked.text), MAX_STATE_ASKED),
    topic: cutWhole(topicOf(last), MAX_STATE_TOPIC),
    lang: last.reply.language === "hi" || last.reply.language === "hinglish" ? last.reply.language : "en",
    years,
    scope: last.from.scope === "india" ? "india" : "all",
    listIds: listCodes(last.from.papers),
    answered: answer !== undefined,
  };
  state.before = turns.slice(-3, -1).map((t) => ({ asked: cutWhole(line(t.asked.text), MAX_STATE_ASKED), topic: cutWhole(topicOf(t), MAX_STATE_TOPIC) }));
  if (answer !== undefined) state.lastAnswer = cutWhole(line(answer), MAX_HISTORY_ANSWER_CHARS);
  return fitState(state);
}

/* ---------------------------------------------------------------- the wire budget */

/** The size of a state on the wire, in characters of its JSON. */
export const stateChars = (s: ConversationState): number => JSON.stringify(s).length;

/**
 * The state cut to `max` characters of JSON (the wire budget, 2,200), by a fixed order of what goes first: the list of codes (to 10, which `foldState` already keeps to, and then to none), then the two turns before,
 * then `asked` to 120 characters, then the start of the answer, as much of it as must go. `current.topic` is never cut below its own limit and never dropped: it is what the search was. Pure; the state it is given
 * is not changed, and one that already fits is returned as it is. A budget too small for even the rest is not met (the rest is the least a state can be).
 */
export function fitState(state: ConversationState, max = MAX_STATE_CHARS): ConversationState {
  let s = state;
  if (stateChars(s) <= max) return s;
  const cur = (change: Partial<NonNullable<ConversationState["current"]>>): ConversationState => ({ ...s, current: { ...s.current!, ...change } });
  if (s.current && s.current.listIds.length > MAX_STATE_LIST) s = cur({ listIds: s.current.listIds.slice(0, MAX_STATE_LIST) });
  if (stateChars(s) <= max) return s;
  if (s.current && s.current.listIds.length > 0) s = cur({ listIds: [] });
  if (stateChars(s) <= max) return s;
  if (s.before.length > 0) s = { ...s, before: [] };
  if (stateChars(s) <= max) return s;
  if (s.current && s.current.asked.length > 120) s = cur({ asked: cutWhole(s.current.asked, 120) });
  // the answer's start goes last, by what is over, and the last of it only when nothing is left to cut
  for (let over = stateChars(s) - max; over > 0 && s.lastAnswer !== undefined; over = stateChars(s) - max) {
    const keep = s.lastAnswer.length - over;
    if (keep <= 0) {
      const { lastAnswer: _gone, ...rest } = s;
      s = rest;
    } else s = { ...s, lastAnswer: cutWhole(s.lastAnswer, keep) };
  }
  return s;
}
