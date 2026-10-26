import type { Paper } from "./index";

/**
 * The prompt box of the new home (W2): what the browser sends to `POST /api/v1/chat` and what comes back as server-sent events.
 * Only the "search" mode exists so far: the papers found, and a short answer written from them whose every claim points at a sentence of a paper's abstract.
 */
export const CHAT_MODES = ["search"] as const;
export type ChatMode = (typeof CHAT_MODES)[number];

/** The shortest and longest message. A search question is short; a longer text is something else (a reference list, an idea) and belongs to another mode. */
export const MIN_CHAT_CHARS = 2;
export const MAX_CHAT_CHARS = 300;

export type ChatStep = "search" | "read" | "write" | "check";

/** A claim's evidence: the sentence (by its number in the abstract) of paper number `n` of the list. `sentence` is that sentence, word for word, taken from the abstract by the server. */
export type ChatCitation = { n: number; paperId: string; sentenceNo: number; sentence: string };

/**
 * The checked answer. `text` carries markers [n] that are exactly the citations; markers that point at nothing checked are removed. When `grounded` is false the
 * text is empty: the papers are shown, and no sentence of the model's is passed off as something a paper said.
 */
export type ChatAnswer = { text: string; citations: ChatCitation[]; grounded: boolean };

/** Why a message has papers but no written answer. */
export type ChatNoAnswer = "sign_in" | "no_abstracts" | "not_answered" | "not_grounded" | "quota" | "unavailable" | "stopped";

export type ChatEvent =
  | { type: "understood"; mode: ChatMode; query: string }
  | { type: "step"; step: ChatStep }
  /** The papers so far (a snapshot, in rank order); `final` once every source has answered and the checks are done. */
  | { type: "papers"; results: Paper[]; final: boolean }
  | { type: "notice"; kind: "partial" | "nothing" | "retracted"; text: string }
  /** A piece of the answer as it is written. Provisional: only the `answer` event has been checked. */
  | { type: "token"; text: string }
  | { type: "answer"; answer: ChatAnswer }
  | { type: "done"; answered: boolean; reason?: ChatNoAnswer; tookMs: number }
  | { type: "error"; code: string; title: string; detail?: string };

/** The plain sentence shown when some of the places searched did not answer. No place is named. */
export const PARTIAL_NOTICE = "Some of the places we search did not answer, so this list may be incomplete. Search again";
export const NOTHING_NOTICE = "Nothing was found for that. Try fewer or different words.";

/** A message that can be sent, as the browser checks it before sending and the server checks again: whitespace tidied, then 2 to 300 characters. Null if it cannot be sent. */
export function cleanChatMessage(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return t.length >= MIN_CHAT_CHARS && t.length <= MAX_CHAT_CHARS && /[\p{L}\p{N}]/u.test(t) ? t : null;
}
