import type { Paper, SearchScope } from "./index";
import type { ChatContextInfo } from "./chat-context";
import type { ThinkLine } from "./think";
import type { Lang, RouteHow, RouteMode as ChatMode } from "./route";
import { ABSTRACT_READ_CHARS } from "./sentences";
import type { Reading } from "./reading";

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
  /** How many claims were cut down to what their sentences say (the shorter claim adds nothing and a second reading calls it fully supported). */
  rewritten?: number;
  /** True when the answer was read again by the strict check (a slower, stronger model; asked for by the reader). */
  strict?: boolean;
};

/**
 * Why a message has papers but no written answer. `urgent` and `safety` are the safety lane's replies (docs/design/intent-and-state.md, 4.5): the page answered a message that describes an emergency
 * (`urgent`), or one that says the person may hurt themselves or plainly asks for help (`safety`), with a fixed text and no search; they carry no papers. `decision` is a message that asks what the person
 * should take: the papers of the topic are shown, and no answer is written, because the papers are about the topic and not about the person's case.
 */
export type ChatNoAnswer = "sign_in" | "no_abstracts" | "not_answered" | "not_grounded" | "quota" | "unavailable" | "stopped" | "routed" | "too_long" | "small_talk" | "urgent" | "safety" | "decision" | "clarify";

/**
 * M4/M5 (design PDF "Sodhsetu understanding, follow-ups and MCP", pages 3 to 6): what the Understand step said about a message, when IT decided (CHAT_UNDERSTAND "on"). Optional fields of the `understood`
 * event, so that a page that does not know them ignores them: absent whenever the rules decided, so every stream of the switch's off and shadow positions is byte for byte what it was.
 *  - `intent`: the intent that acts (the ledger's intent of the turn is this when present).
 *  - `statusLine`: the one line the model wrote about what it understood, in the person's language, shown with the label "I understood". The only model-written words of the line; checked on the server
 *    (no citation, no link, nothing of a paper).
 *  - `confirm`: the reading was between 0.45 and 0.75 sure, or the rules decided because the model could not: "Did you want this? Change" is shown prominently.
 *  - `fallback`: the model could not be used and the rules decided ("I could not understand this well, so I searched for papers").
 *  - `clarify`: the reply is one question with 2 or 3 choices (the page adds "Search anyway"); the reply ends with reason `clarify` and nothing is searched.
 *  - `offer`: another tool that has no route mode of its own, offered as a card and never started: `litscan` (the literature scan).
 */
export type UnderstoodByModel = {
  intent?: "chat" | "search" | "refine_search" | "ask_results" | "ask_paper" | "offer_tool" | "clarify";
  statusLine?: string;
  confirm?: true;
  fallback?: true;
  clarify?: { question: string; choices: string[] };
  offer?: "litscan";
};

/** What the page asks the server once (GET /api/v1/chat/config): whether to send the turn ledger with a message (only while the Understand step reads it: CHAT_UNDERSTAND shadow or on). */
export type ChatConfig = { ledger: boolean };

/**
 * `abstracts` (M5): a reply about papers already shown in the chat ("what dataset did the second paper use?") was answered from those papers' abstracts, with no new search; the line says so and where the
 * full text can be asked. Only with CHAT_UNDERSTAND on.
 */
export const ABSTRACTS_NOTICE = "Answered from the abstracts of papers already in this chat, with no new search. For a paper's full text, use Ask this paper on its card.";

/**
 * The four lines of the safety lane (one kind for each, because the reducer keeps one notice of a kind): the crisis line, the urgent line (also for a plain call for help), the line for a personal
 * medicine decision, and the care line (a health or distress story with a research question). They are drawn under the Understood line, above the offer, the answer and the papers.
 */
export const SAFETY_NOTICE_KINDS = ["safety_crisis", "safety_urgent", "safety_decision", "safety_care"] as const;
export type SafetyNoticeKind = (typeof SAFETY_NOTICE_KINDS)[number];

export const NOTICE_KINDS = ["partial", "nothing", "retracted", "years", "weak", "unfinished", "abstracts", ...SAFETY_NOTICE_KINDS] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export type ChatEvent =
  /**
   * What the message was taken to be. `query` is the message as written (a long one is cut); `searchQuery` is what the search indexes are asked when that is not the words as
   * written (a translation). `auto` is true when the router chose, `how` says by what, `confidence` how sure it was. `scope` is there when the reader chose where to
   * look ("india": only Indian sources). `context` is there only when a model read the earlier turns of the conversation to understand the message (chat-context.ts): an old open tab
   * ignores a field it does not know, where a new event type would crash its reducer. `reading` is there only when the request-frame cleaner (R8, docs/design/intent-and-state.md, 4.8) had something to say:
   * what it left out of the words and what the box could not do with it; `searchQuery` is then the words it left (the topic).
   */
  | ({ type: "understood"; mode: ChatMode; query: string; language: Lang; auto: boolean; how: RouteHow; confidence: number; searchQuery?: string; scope?: SearchScope; context?: ChatContextInfo; reading?: Reading } & UnderstoodByModel)
  | { type: "step"; step: ChatStep }
  /** The papers so far (a snapshot, in rank order); `final` once every source has answered and the checks are done. */
  | { type: "papers"; results: Paper[]; final: boolean }
  /**
   * A plain line about the list. `partial`: a source did not answer (the one kind that has "Search again" beside it). `nothing`: no paper was found. `retracted`: a paper in the list was retracted.
   * `years`: what a year range did to the list ("Only 3 of the papers found are from 2020 or later", "No paper from 2030 was found"): asking again would give the same list, so it has no retry.
   * `weak`: the list is weak, or something was left undone because the message could not be read well enough (`FOLLOWUP_UNREAD_NOTICE`: a follow-up whose router call failed was searched as written and
   * no answer was written; docs/design/intent-and-state.md, 4.6). It has no retry either. The reducer keeps one notice of each kind, so a release that adds a second line of this kind must fold the two into one.
   * A page that does not know a kind shows its text as it is and offers nothing (an old tab meeting a newer server).
   */
  | { type: "notice"; kind: NoticeKind; text: string }
  /** A piece of the answer as it is written. Provisional: only the `answer` event has been checked. */
  | { type: "token"; text: string }
  | { type: "answer"; answer: ChatAnswer }
  /** A piece of the general background as it is written. Provisional: only the `general` event is final. */
  | { type: "general_token"; text: string }
  /** The general background, final: `text` is empty unless `kind` is "background" or "not_research". */
  | { type: "general"; kind: GeneralKind; text: string }
  | { type: "done"; answered: boolean; reason?: ChatNoAnswer; tookMs: number }
  | { type: "error"; code: string; title: string; detail?: string }
  /**
   * One line of the Thinking block (M2, think.ts): what a stage did, from its real counts. Sent only while CHAT_THINK is "on"; the same `id` again replaces the line. A reducer that does not know an event
   * keeps the reply as it was (`applyChatEvent`'s default), so a page always survives a newer server.
   */
  | ({ type: "think" } & ThinkLine);

/** The plain sentence shown when some of the places searched did not answer. No place is named. */
export const PARTIAL_NOTICE = "Some of the places we search did not answer, so this list may be incomplete. Search again";
export const NOTHING_NOTICE = "Nothing was found for that. Try fewer or different words.";
/** A follow-up that the router could not read (its call failed): the words were searched on their own, the papers are shown, and no answer was written (the notice kind `weak`). */
export const FOLLOWUP_UNREAD_NOTICE = "I could not tell what this refers to, so I searched your words on their own and wrote no answer.";

/**
 * The line of the notice kind `unfinished` (R22, docs/design/intent-and-state.md, 5.4, S-DID-NOT-FINISH). The page adds it to the reply to a message that was read as a follow-up of the turns before it when the reply right
 * before the message did not finish (a stopped, failed or interrupted reply is never carried, so the follow-up leans on the search before it): the person is told, and not left to find out. The server never
 * sends this kind; the page makes the line itself, from what it knows (the history it sent and what the server said it read). English, and Hinglish for a message in Hinglish: the plan has no Hindi sentence for it yet.
 */
export const DID_NOT_FINISH_NOTICE = "Your last message did not finish, so this follows the one before it.";
export const DID_NOT_FINISH_NOTICE_HINGLISH = "Aapka pichhla message poora nahi hua, isliye ye usse pehle ke message ke hisaab se hai.";
export const didNotFinishText = (language: Lang): string => (language === "hinglish" ? DID_NOT_FINISH_NOTICE_HINGLISH : DID_NOT_FINISH_NOTICE);

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

/**
 * "Check strictly" (docs/design/claim-support.md): the reader asks for a slower, stronger second reading of a finished answer. The browser sends the answer's words and the papers it was
 * made from (their abstracts, as the search found them) and which sentence of each was shown; the server judges the claims again with the stronger model, cuts down the statements that
 * say more than their sentences, and sends back the answer. It takes the words of the abstracts from the request, so the answer it returns is only as true as those; it is shown to the
 * person who asked, and kept nowhere else.
 */
export const MAX_TIGHTEN_TEXT = 2000;
export const MAX_TIGHTEN_PAPERS = 12;
export const MAX_TIGHTEN_ABSTRACT = ABSTRACT_READ_CHARS;
export type TightenRequest = { text: string; papers: { n: number; title: string; year: number | null; abstract: string }[]; citations: { n: number; sentenceNo: number }[] };
export type TightenResponse = { answer: ChatAnswer; changed: boolean };
