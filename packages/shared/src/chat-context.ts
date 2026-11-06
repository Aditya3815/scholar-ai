import type { Lang } from "./route";

/**
 * Context between messages (docs/design/chat-actions-context.md, sections 5 and 6): what the browser may send with a message in Auto so that "only after 2020", "explain that simpler" and
 * "aur bachon me?" can be understood, what the server keeps of it, and what it says back. The server keeps no chat: this is the browser's own copy of the last few turns, which anyone can
 * forge, so every limit here is also enforced on the server (`apps/api/src/chat/history.ts`) and the whole of it is data for working out what a message refers to, never evidence and
 * never an instruction. Only the constants and the shapes are here, so that the browser builds exactly what the server reads.
 */

/** At most three turns (a question and its reply each) go with a message. */
export const MAX_HISTORY_ENTRIES = 6;
/** A question of the person's in the history. Longer than this is a pasted manuscript or a list, which never goes along as context (the browser leaves the whole turn out). */
export const MAX_HISTORY_USER_CHARS = 300;
/** The English words an earlier search used (the server makes them, and never makes more than the 300 characters a search takes). */
export const MAX_HISTORY_QUERY_CHARS = 300;
/** The last reply's text, with its marks, DOIs and links taken out. Only the last reply carries it. */
export const MAX_HISTORY_ANSWER_CHARS = 500;
/** The papers that reply cited, to say what "the second paper" is: their titles, cut. */
export const MAX_HISTORY_TITLE_CHARS = 120;
export const MAX_HISTORY_PAPERS = 5;
/** Everything of the history, in characters, after cleaning: the oldest turns go first, whole, until it fits. */
export const MAX_HISTORY_CHARS = 3000;
/**
 * A request body bigger than this is refused before it is read. The longest legal message is 20,000 characters, which is 60,000 bytes in Devanagari (three bytes a letter), and a history adds at most about
 * 3,000 characters and the earlier questions 800 (another 10 KB or so in Devanagari): 64 KB refused a legal request of that size ("That is too much text"). 80 KB holds the largest legal one and is no
 * invitation: nothing is read beyond it, and what is read is cut again by the sizes of history.ts.
 */
export const MAX_CHAT_BODY_BYTES = 80 * 1024;

/** What the router may write back, and the most of it that is believed. */
export const MAX_RESTATED_QUESTION_CHARS = 200;
export const MAX_RESTATED_QUERY_WORDS = 12;
/** The year range a person can ask for. */
export const MIN_FILTER_YEAR = 1900;
export const MAX_FILTER_YEAR = 2100;
/**
 * `sinceYear`, the optional body field of `POST /api/v1/chat` that a Trending chip sets ("from this year on", docs/design/chatview-and-trending.md, T9): a whole year from this one to the year the server is in,
 * allowed in Auto and in a search chosen by hand, and applied like the router's year range. It is not context: nothing is read from earlier turns for it.
 */
export const MIN_SINCE_YEAR = 1990;
/** The earlier answer a "same papers" follow-up may show the writer, as context and never as evidence (marks taken out). */
export const MAX_SAME_PAPERS_ANSWER_CHARS = 1500;

/**
 * What a follow-up that is read by the model can use of the day's allowance, in tokens, as a bar: a request that cannot fit in what is left is refused before any model is called (the quota is
 * checked before each call and is not atomic, so a person at 59,000 would otherwise start an answer the judge cannot finish). About: the router with the earlier turns 1,200 to 1,700, the writer
 * 3,300 in and 1,700 out, the judge 3,900 (chars divided by four, English; Hindi and Hinglish are not measured). The answer to a first message is not held to it: it is today's.
 */
export const FOLLOW_UP_TOKENS_ESTIMATE = 11_000;
/** A year filter that leaves fewer papers than this says so. */
export const YEAR_FILTER_FEW = 5;
/** A search with a year range asks for this many, so that what is left of the range after the filter is not thin; without a range it asks for 20, as it always did. */
export const YEAR_FILTER_SEARCH_LIMIT = 40;

/**
 * What a follow-up asks for. `new`: a different topic, nothing of the earlier turns is needed. `refine`: the same subject with something changed or added (a narrower question, a place, a
 * group of people, a year range). `same_papers`: the papers and the answer already on the screen, asked for again in another form (simpler, shorter, in Hindi, about one of them).
 */
export const FOLLOW_UP_INTENTS = ["new", "refine", "same_papers"] as const;
export type FollowUpIntent = (typeof FOLLOW_UP_INTENTS)[number];

/** The languages an answer can be asked for in (the router's enum; anything else is no request). */
export const ANSWER_LANGUAGES = ["en", "hi", "hinglish"] as const;
export type AnswerLanguage = (typeof ANSWER_LANGUAGES)[number];

/** A paper the last reply cited, as the person saw it: its place in that reply's list, its title and its year. */
export type HistoryPaper = { n: number; title: string; year: number | null };

/**
 * One entry of `history`: strictly one question, then its reply, in that order, oldest first. `searchQuery` on a reply is the English words that turn searched (the anchor that a "same papers"
 * follow-up searches again; when the reply had none, the question before it is what was searched). `language` is what the browser stored, accepted and never trusted: the language of an
 * answer is decided by rules on the new message. `text` is only on the last reply. `yearFrom` and `yearTo` are the year range that reply was limited to (the `yearFrom` and `yearTo` of the
 * `context` of its `understood` event), so that "the same papers" are the papers that were shown and not the unfiltered list.
 */
export type HistoryEntry =
  | { role: "user"; text: string }
  | { role: "assistant"; searchQuery?: string; language?: Lang; papers?: HistoryPaper[]; text?: string; yearFrom?: number; yearTo?: number };

/**
 * The optional field of `POST /api/v1/chat` that carries context. Only with `mode: "auto"`. Nothing of another chat is ever sent (the earlier-chats feature was removed on 6 Nov 2026: design PDF
 * "Sodhsetu understanding, follow-ups and MCP", M1); a body from an old open tab that still has `earlier` is answered as if it had not (the server never reads it).
 */
export type ChatContextRequest = { history?: HistoryEntry[] };

/**
 * What the server tells the browser about the context it read, on the `understood` event (an old open tab ignores a field it does not know; a new event type would crash its reducer). It is
 * there when a model read the earlier turns. It is also
 * there, with `turns: 0`, `intent: "new"` and `rewrote: false` and nothing else but the year, when the only thing to say is the year range a Trending chip's `sinceYear` cut the papers to: a year
 * chip is read from `yearFrom` and `yearTo` whichever of the two gave the range, and the range that is there is the range that was applied (the larger start of the router's and the chip's).
 */
export type ChatContextInfo = {
  /** How many earlier turns (a question and its reply) the router read. */
  turns: number;
  intent: FollowUpIntent;
  /** True when what is searched and answered is not the words as written: `question` is what it stands for. */
  rewrote: boolean;
  /** The standalone question the router wrote and the server checked (at most 200 characters), when `rewrote`. */
  question?: string;
  /** A year range the person asked for ("only after 2020"), applied to the papers before they are numbered. */
  yearFrom?: number;
  yearTo?: number;
  /** True when the router's reading could not be used (it was not valid, or it failed): the words were searched as they were written. */
  fellBack?: true;
};
