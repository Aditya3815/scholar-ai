import {
  MAX_EARLIER_CHARS,
  MAX_EARLIER_ENTRIES,
  MAX_EARLIER_QUERY_CHARS,
  MAX_EARLIER_QUESTION_CHARS,
  MAX_FILTER_YEAR,
  MAX_HISTORY_ANSWER_CHARS,
  MAX_HISTORY_CHARS,
  MAX_HISTORY_ENTRIES,
  MAX_HISTORY_PAPERS,
  MAX_HISTORY_TITLE_CHARS,
  MIN_FILTER_YEAR,
  cleanChatMessage,
  type EarlierQuestion,
  type HistoryEntry,
  type HistoryPaper,
  type Lang,
} from "@scholar/shared";

/**
 * The earlier messages of a conversation, as the server reads them (docs/design/chat-actions-context.md, sections 5 and 6). The browser keeps the chat and sends the last few turns with a
 * message in Auto; the server keeps nothing, so what arrives can be anything: forged roles, an invented reply that "says" something, a pasted manuscript, text hidden in characters nobody
 * can see. It is therefore read once, here, by functions that never throw, and what comes out is only what the browser could have built, in the sizes it is allowed:
 *   - the shape is judged and never repaired: a wrong role, order or type is a plain refusal (`invalid_history`), because a body the browser could not have built is a bug or an attack, and
 *     quietly mending it would hide both. Fields the server does not know are ignored and never copied (a newer browser may send more);
 *   - sizes are bounded, not judged: a title, an answer or the search words are cut on a character that is whole (never in the middle of a code unit or a Hindi conjunct), and whole turns,
 *     oldest first, go until the count and the total fit. A text is never cut in the middle of an entry to make the sum fit;
 *   - a question of the person's longer than a question can be (300 characters) is refused, not clipped: it is a pasted manuscript or a list, and the browser never sends one as context;
 *   - invisible characters that carry no text are taken out, but not the two joiners that Hindi is written with (U+200C and U+200D).
 * Nothing here is evidence and nothing is an instruction: it is only for working out what a new message refers to, and it reaches a model only in the router's fenced block (router.ts).
 */

/** Why a history or an earlier-chat list was not accepted, in a plain sentence for the person or the developer who sent it. */
export type Refusal = { ok: false; detail: string };

/** Where a "same papers" follow-up searches again: the words the last reply searched, and the year range it was limited to. */
export type HistoryAnchor = { query: string; yearFrom?: number; yearTo?: number };

export type ChatHistory = {
  /** What is kept, oldest first: a question, then its reply, and so on. */
  entries: HistoryEntry[];
  /** How many questions of the person's are in `entries`. */
  turns: number;
  /** The search the last reply came from, or null when no reply is in `entries`. */
  anchor: HistoryAnchor | null;
  /** The text of the last reply (marks, DOIs and links taken out), or null. */
  lastAnswer: string | null;
  /** How many entries were left out to keep to the count and the total. */
  dropped: number;
};

const LANGS: readonly Lang[] = ["en", "hi", "hinglish", "other"];

/**
 * Text that shows nothing. Bidi controls (U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069) can make text read other than it is; the zero-width space, the byte-order mark and the word joiner
 * hide words from a person; the tag characters (U+E0000 to U+E007F) mirror ASCII and are a known way to smuggle an instruction past a reader. U+200C and U+200D are NOT here: they are part of
 * Hindi and other Indian scripts (a conjunct with and without a joiner is not the same word), so a blanket "strip every format character" would corrupt Devanagari.
 */
const INVISIBLE = /[\u061C\u200B\u200E\u200F\u2060\u202A-\u202E\u2066-\u2069\uFEFF\u{E0000}-\u{E007F}]/gu;
export const stripInvisible = (s: string): string => s.replace(INVISIBLE, "");

/** A text as one line: invisible characters out, control characters and line breaks as single spaces. */
const flat = (s: string): string => stripInvisible(s).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

const graphemes: Intl.Segmenter | null = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/**
 * At most `max` characters (UTF-16 units, as every limit here is counted), cut where a whole character ends: never between the two halves of a character outside the basic plane, and, where
 * the platform can tell, never in the middle of a Hindi conjunct or a letter with its marks.
 */
export function cutChars(s: string, max: number): string {
  if (max <= 0) return "";
  if (s.length <= max) return s;
  let out = "";
  // lazily: a text of 60 KB that is cut to 500 characters is not segmented to its end first
  for (const part of graphemes ? (function* () { for (const x of graphemes.segment(s)) yield x.segment; })() : s) {
    if (out.length + part.length > max) break;
    out += part;
  }
  return out;
}

/**
 * The delimiters of a prompt, made harmless in a text that is put inside one: a run of three quotes (which closes a message block) and of three angle brackets (which would close or open a
 * fence). The same text always gives the same result, so prompts stay stable and tests can pin them.
 */
export const neutralise = (s: string): string => s.replace(/"{3,}/g, "'''").replace(/<{3,}/g, "<<").replace(/>{3,}/g, ">>");

/**
 * What kind of failure a provider reported, as one of five words, for a log line about a message that came with earlier turns: a provider's own error text can echo what it was sent (a rejected
 * prompt, a schema that did not fit), so nothing of it is logged for such a message, only this.
 */
export const errorKind = (message?: string): "timeout" | "malformed" | "quota" | "unavailable" | "error" =>
  !message ? "error" : /time(?:d)? ?out|abort/i.test(message) ? "timeout" : /json|unterminated|parse/i.test(message) ? "malformed" : /quota/i.test(message) ? "quota" : /unavailable|overload|rate|5\d\d/i.test(message) ? "unavailable" : "error";

const MARKS = /\s*(?:\[\s*\d{1,3}(?:\s*[,;–-]\s*\d{1,3})*\s*\]|【[^】]{0,40}】)/g;
const DOI = /\b(?:doi:\s*)?10\.\d{4,9}\/[^\s,;)\]]*[^\s,;)\].:!?]/gi;
const LINK = /\b(?:https?:\/\/|www\.)[^\s)\]]*[^\s)\].,;:!?]/gi;
// a name is at most 40 letters long: without the bound `[\p{L}'’-]+` scans to the end of the text from every start of a word, and a text of "A-" repeated to 60 KB took 1.9 seconds
const AUTHOR_YEAR = /\(\s*\p{Lu}[\p{L}'’-]{1,40}(?:\s+(?:and|&)\s+\p{Lu}[\p{L}'’-]{1,40})?(?:\s+et al\.?)?,?\s+(?:19|20)\d{2}[a-z]?\s*\)/gu;
const ET_AL = /\b\p{Lu}[\p{L}'’-]{1,40}(?:\s+(?:and|&)\s+\p{Lu}[\p{L}'’-]{1,40})?\s+et al\.?(?:,?\s*\(?(?:19|20)\d{2}[a-z]?\)?)?/gu;
const BARE_ET_AL = /\bet al\.?/gi;

/**
 * An earlier answer as plain words: the marks [n] (which point into a list that is not this reply's), DOIs, links and author-and-year citations taken out, on one line. What is left is
 * no evidence of anything: it is the wording of a reply, kept only so that "explain that simpler" has something to refer to.
 */
export function plainAnswer(raw: string): string {
  return flat(raw)
    .replace(MARKS, "")
    .replace(AUTHOR_YEAR, "")
    .replace(ET_AL, "")
    .replace(BARE_ET_AL, "")
    .replace(DOI, "")
    .replace(LINK, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

/**
 * The start of a reply's text, as much as can matter: the clean-up of an answer takes out marks, links and citations and then keeps `MAX_HISTORY_ANSWER_CHARS` characters, so a text of 60 KB is not
 * cleaned to its end first (the body of a request is read before anybody is signed in). Cut on a whole character.
 */
const READ_ANSWER_CHARS = MAX_HISTORY_ANSWER_CHARS * 4;
function startOf(text: string): string {
  if (text.length <= READ_ANSWER_CHARS) return text;
  const head = text.slice(0, READ_ANSWER_CHARS);
  const last = head.charCodeAt(head.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const absent = (v: unknown): boolean => v === undefined || v === null;
const hasWord = (s: string): boolean => /[\p{L}\p{N}]/u.test(s);
const bad = (detail: string): Refusal => ({ ok: false, detail });

const emptyHistory = (): ChatHistory => ({ entries: [], turns: 0, anchor: null, lastAnswer: null, dropped: 0 });

/** The characters of an entry that count towards the total: every text that can reach a model. */
const sizeOf = (e: HistoryEntry): number => (e.role === "user" ? e.text.length : (e.searchQuery?.length ?? 0) + (e.text?.length ?? 0) + (e.papers ?? []).reduce((n, p) => n + p.title.length, 0));

function readPapers(raw: unknown, at: number): HistoryPaper[] | Refusal {
  if (!Array.isArray(raw)) return bad(`The papers of entry ${at} must be a list.`);
  const out: HistoryPaper[] = [];
  for (const p of raw) {
    if (!isObject(p)) return bad(`A paper of entry ${at} is not an object.`);
    if (!isInt(p.n) || p.n < 1 || p.n > 99) return bad(`Each paper of entry ${at} needs a number from 1 to 99.`);
    const title = typeof p.title === "string" ? cutChars(flat(p.title), MAX_HISTORY_TITLE_CHARS) : "";
    if (!title || !hasWord(title)) return bad(`Each paper of entry ${at} needs a title.`);
    if (!absent(p.year) && (!isInt(p.year) || p.year < 1000 || p.year > 2999)) return bad(`A paper of entry ${at} has a year that is not a year.`);
    if (out.length < MAX_HISTORY_PAPERS) out.push({ n: p.n, title, year: isInt(p.year) ? p.year : null });
  }
  return out;
}

function readYear(raw: unknown, name: string, at: number): number | undefined | Refusal {
  if (absent(raw)) return undefined;
  if (!isInt(raw) || raw < MIN_FILTER_YEAR || raw > MAX_FILTER_YEAR) return bad(`The ${name} of entry ${at} must be a year from ${MIN_FILTER_YEAR} to ${MAX_FILTER_YEAR}.`);
  return raw;
}

function read(raw: unknown): { ok: true; history: ChatHistory } | Refusal {
  if (absent(raw)) return { ok: true, history: emptyHistory() };
  if (!Array.isArray(raw)) return bad("The earlier messages must be a list.");
  // the text of a reply is only for the last one: find it before the entries are read
  let lastReply = -1;
  raw.forEach((e, i) => {
    if (isObject(e) && e.role === "assistant") lastReply = i;
  });
  const entries: HistoryEntry[] = [];
  for (let i = 0; i < raw.length; i++) {
    const e: unknown = raw[i];
    const at = i + 1;
    if (!isObject(e)) return bad(`Entry ${at} is not an object.`);
    if (e.role !== "user" && e.role !== "assistant") return bad(`Entry ${at} has a role that is not user or assistant.`);
    if (e.role !== (i % 2 === 0 ? "user" : "assistant")) return bad("The order of the earlier messages must be a question, then its reply, from the oldest.");
    if (e.role === "user") {
      const text = typeof e.text === "string" ? cleanChatMessage(stripInvisible(e.text)) : null;
      if (!text) return bad(`The question of entry ${at} must be 2 to 300 characters with a letter or a number in it.`);
      entries.push({ role: "user", text });
      continue;
    }
    const out: Extract<HistoryEntry, { role: "assistant" }> = { role: "assistant" };
    if (!absent(e.searchQuery)) {
      if (typeof e.searchQuery !== "string") return bad(`The search words of entry ${at} must be text.`);
      const line = flat(e.searchQuery);
      if (line) {
        const q = cleanChatMessage(line);
        if (!q) return bad(`The search words of entry ${at} are not valid search words (2 to 300 characters).`);
        out.searchQuery = q;
      }
    }
    if (!absent(e.language)) {
      const language = LANGS.find((l) => l === e.language);
      if (!language) return bad(`The language of entry ${at} is not one that is known.`);
      out.language = language;
    }
    if (!absent(e.papers)) {
      const papers = readPapers(e.papers, at);
      if ("ok" in papers) return papers;
      if (papers.length > 0) out.papers = papers;
    }
    if (!absent(e.text)) {
      if (typeof e.text !== "string") return bad(`The text of entry ${at} must be text.`);
      if (i !== lastReply) return bad("Only the last reply may carry its text.");
      const text = cutChars(plainAnswer(startOf(e.text)), MAX_HISTORY_ANSWER_CHARS).trim();
      if (text) out.text = text;
    }
    const from = readYear(e.yearFrom, "first year", at);
    if (typeof from === "object") return from;
    const to = readYear(e.yearTo, "last year", at);
    if (typeof to === "object") return to;
    if (from !== undefined && to !== undefined && from > to) return bad(`The years of entry ${at} are the wrong way round.`);
    if (from !== undefined) out.yearFrom = from;
    if (to !== undefined) out.yearTo = to;
    entries.push(out);
  }
  // the count and the total: whole turns go, oldest first (two entries at a time, so that what is left still starts with a question), and the last turn always stays
  let drop = 0;
  const kept = () => entries.slice(drop);
  while (entries.length - drop > 2 && (entries.length - drop > MAX_HISTORY_ENTRIES || kept().reduce((n, x) => n + sizeOf(x), 0) > MAX_HISTORY_CHARS)) drop += 2;
  const left = kept();
  const lastAt = left.map((x) => x.role).lastIndexOf("assistant");
  const last = lastAt >= 0 ? left[lastAt] : undefined;
  const before = lastAt > 0 ? left[lastAt - 1] : undefined;
  const anchorQuery = last?.role === "assistant" ? (last.searchQuery ?? (before?.role === "user" ? before.text : undefined)) : undefined;
  return {
    ok: true,
    history: {
      entries: left,
      turns: left.filter((x) => x.role === "user").length,
      anchor: last?.role === "assistant" && anchorQuery ? { query: anchorQuery, ...(last.yearFrom === undefined ? {} : { yearFrom: last.yearFrom }), ...(last.yearTo === undefined ? {} : { yearTo: last.yearTo }) } : null,
      lastAnswer: last?.role === "assistant" ? (last.text ?? null) : null,
      dropped: drop,
    },
  };
}

/** The earlier messages of the request as a history, or the plain reason they are not one. Absent, null and empty are no history. Never throws. */
export function readHistory(raw: unknown): { ok: true; history: ChatHistory } | Refusal {
  try {
    return read(raw);
  } catch {
    return bad("The earlier messages could not be read.");
  }
}

function readEarlierList(raw: unknown): { ok: true; earlier: EarlierQuestion[] } | Refusal {
  if (absent(raw)) return { ok: true, earlier: [] };
  if (!Array.isArray(raw)) return bad("The earlier questions must be a list.");
  const all: EarlierQuestion[] = [];
  for (let i = 0; i < raw.length; i++) {
    const e: unknown = raw[i];
    if (!isObject(e)) return bad(`Earlier question ${i + 1} is not an object.`);
    const question = typeof e.question === "string" ? cutChars(flat(e.question), MAX_EARLIER_QUESTION_CHARS) : "";
    if (question.length < 2 || !hasWord(question)) return bad(`Earlier question ${i + 1} needs some words.`);
    if (!absent(e.searchQuery) && typeof e.searchQuery !== "string") return bad(`The search words of earlier question ${i + 1} must be text.`);
    const searchQuery = typeof e.searchQuery === "string" ? cutChars(flat(e.searchQuery), MAX_EARLIER_QUERY_CHARS) : "";
    all.push({ question, ...(searchQuery && hasWord(searchQuery) ? { searchQuery } : {}) });
  }
  // the best come first (the browser chose them): the last whole entries go until the count and the total fit
  const earlier = all.slice(0, MAX_EARLIER_ENTRIES);
  const size = (xs: readonly EarlierQuestion[]) => xs.reduce((n, x) => n + x.question.length + (x.searchQuery?.length ?? 0), 0);
  while (earlier.length > 1 && size(earlier) > MAX_EARLIER_CHARS) earlier.pop();
  return { ok: true, earlier };
}

/** The questions of earlier chats (section 6) as a list, or the plain reason they are not one. Absent, null and empty are none. Never throws. */
export function readEarlier(raw: unknown): { ok: true; earlier: EarlierQuestion[] } | Refusal {
  try {
    return readEarlierList(raw);
  } catch {
    return bad("The earlier questions could not be read.");
  }
}
