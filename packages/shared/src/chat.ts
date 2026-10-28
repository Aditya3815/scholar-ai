import type { Paper, SearchScope } from "./index";
import type { Lang, RouteHow, RouteMode as ChatMode } from "./route";

/**
 * The prompt box of the new home (W2): what the browser sends to `POST /api/v1/chat` and what comes back as server-sent events.
 * Only the "search" mode exists so far: the papers found, and a short answer written from them whose every claim points at a sentence of a paper's abstract.
 */
export type { RouteMode as ChatMode } from "./route";
/** What the browser may ask for: "search" (the reader chose Search papers) or "auto" (the router chooses the tool). The other tools open their own pages. */
export const CHAT_REQUEST_MODES = ["search", "auto"] as const;
export type ChatRequestMode = (typeof CHAT_REQUEST_MODES)[number];

/** The shortest and longest message. A search question is short; a longer text is something else (a reference list, an idea) and belongs to another mode. */
export const MIN_CHAT_CHARS = 2;
export const MAX_CHAT_CHARS = 300;

/** `route` is only there when the router's model had to look at the message. */
export type ChatStep = "route" | "search" | "read" | "write" | "check" | "general";

/**
 * Answers that are not from a paper (W5). Papers first: the answer is written from the papers found, every claim tied to a sentence. Only when the papers do not answer (or none
 * was found) is a short answer from general knowledge given, and then **always under this label, never with a citation, never mixed with the checked answer**. `unsure` means the
 * model would not say anything useful (the screen says nothing more than "the papers do not answer this"); `not_research` is a greeting or a message that is not a research question
 * (the screen says what the box is for).
 */
export const GENERAL_LABEL = "General background, not from a paper in your results";
export const GENERAL_KINDS = ["background", "unsure", "not_research"] as const;
export type GeneralKind = (typeof GENERAL_KINDS)[number];

/** A claim's evidence: the sentence (by its number in the abstract) of paper number `n` of the list. `sentence` is that sentence, word for word, taken from the abstract by the server. */
export type ChatCitation = { n: number; paperId: string; sentenceNo: number; sentence: string };

/**
 * The checked answer. `text` carries markers [n] that are exactly the papers of the citations (a paper can have up to three sentences); markers that point at nothing checked are removed. When `grounded` is false the
 * text is empty: the papers are shown, and no sentence of the model's is passed off as something a paper said.
 */
export type ChatAnswer = {
  text: string;
  citations: ChatCitation[];
  grounded: boolean;
  /** True when a second reading (the support judge) found, for every claim that cites a paper, the sentences that support it; false when that reading could not be done. Absent in answers made before it existed. */
  checked?: boolean;
  /** How many claims were taken out because the sentences they cite do not support them. */
  leftOut?: number;
};

/** Why a message has papers but no written answer. */
export type ChatNoAnswer = "sign_in" | "no_abstracts" | "not_answered" | "not_grounded" | "quota" | "unavailable" | "stopped" | "routed" | "too_long";

export type ChatEvent =
  /**
   * What the message was taken to be. `query` is the message as written (a long one is cut); `searchQuery` is what the search indexes are asked when that is not the words as
   * written (a translation). `auto` is true when the router chose, `how` says by what, `confidence` how sure it was. `scope` is there when the reader chose where to
   * look ("india": only Indian sources).
   */
  | { type: "understood"; mode: ChatMode; query: string; language: Lang; auto: boolean; how: RouteHow; confidence: number; searchQuery?: string; scope?: SearchScope }
  | { type: "step"; step: ChatStep }
  /** The papers so far (a snapshot, in rank order); `final` once every source has answered and the checks are done. */
  | { type: "papers"; results: Paper[]; final: boolean }
  | { type: "notice"; kind: "partial" | "nothing" | "retracted"; text: string }
  /** A piece of the answer as it is written. Provisional: only the `answer` event has been checked. */
  | { type: "token"; text: string }
  | { type: "answer"; answer: ChatAnswer }
  /** A piece of the general background as it is written. Provisional: only the `general` event is final. */
  | { type: "general_token"; text: string }
  /** The general background, final: `text` is empty unless `kind` is "background" or "not_research". */
  | { type: "general"; kind: GeneralKind; text: string }
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

/**
 * The list of papers is sent as a full snapshot each time a source answers (so a lost or repeated event cannot corrupt it), and measured on a real search it was 82 to 87% of
 * the stream: the same twenty abstracts, five times. Until the final list, each paper carries only the start of its abstract (about what a card shows folded); the final
 * list has all of it.
 */
export const INTERIM_ABSTRACT_CHARS = 280;
export function slimForInterim(papers: readonly Paper[]): Paper[] {
  return papers.map((p) => {
    if (!p.abstract || p.abstract.length <= INTERIM_ABSTRACT_CHARS) return p;
    const cut = p.abstract.slice(0, INTERIM_ABSTRACT_CHARS);
    const at = cut.lastIndexOf(" ");
    return { ...p, abstract: `${(at > INTERIM_ABSTRACT_CHARS * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:.]+$/, "")}…` };
  });
}
