import { activePath, cutWhole, oneLine, topicStart, type AssistantMsg, type ChatMsg, type UserMsg } from "./chat-state";

/**
 * The turn ledger (design PDF "Sodhsetu understanding, follow-ups and MCP", section "Follow-ups: sirf usi chat se", milestone M2): a compact record of each turn of ONE chat, built in the browser from the
 * chat's own messages and kept with the chat in IndexedDB. Nothing of it leaves the browser yet (M2): the request still carries `history` as before. M4 (the Understand step) is what will send it, through
 * `ledgerForSend`, with the caps the design asks for; until then the builder and the cap are tested here so that M4 only has to wire them.
 *
 * What is in it, and what is never:
 *  - only the chat's own turns, from its last "New topic" on (the turns before it stay on the page and are not in the ledger), along the version of each message being read (an edited message's replaced
 *    words and the turns after them are not in it: `activePath`);
 *  - the person's words (one line, at most 300 characters), what the reply was (an intent read from what the server already said: no model), the standalone question when the server rewrote a follow-up,
 *    the first 300 characters of the reply's checked answer or background (null for a reply that was stopped, failed or cut off), and the reply's first ten papers, numbered as the cards are numbered;
 *  - never a reply of the safety lane (an emergency, self-harm, a question about what to take) or a turn that carries its crisis or urgent line: those never ride along (as `contextBefore` already rules);
 *  - never a reply that is still being written.
 * It is DATA for working out what a message refers to. The server must treat it as untrusted (its papers are resolved again there, M4), and the writer and the judge are never given it.
 */

export const LEDGER_INTENTS = ["chat", "search", "refine_search", "ask_results", "ask_paper", "offer_tool", "clarify"] as const;
export type LedgerIntent = (typeof LEDGER_INTENTS)[number];

/** A paper of a turn, numbered as its card was: "the second one" is `n: 2`. `first_author` is the family name of the first author as the record has it. */
export type LedgerPaper = { n: number; id: string; doi: string | null; title: string; year: number | null; first_author: string | null };
export type LedgerTurn = { turn: number; user: string; intent: LedgerIntent; standalone: string; reply: string | null; papers: LedgerPaper[] };
/** An older turn, as it is sent once the six latest are sent whole: only what it was about. */
export type LedgerTurnShort = { turn: number; standalone: string };

/** The most characters of the person's words and of a reply that a turn keeps, and the papers of a turn. */
export const LEDGER_USER_CHARS = 300;
export const LEDGER_REPLY_CHARS = 300;
export const LEDGER_PAPERS = 10;
const LEDGER_TITLE_CHARS = 200;
/** What is sent (M4): the six latest turns whole, older ones only as their standalone question; about 3,000 tokens at most, the oldest going first; a visitor's ledger is only the three latest. */
export const LEDGER_FULL_TURNS = 6;
export const LEDGER_VISITOR_TURNS = 3;
export const LEDGER_TOKEN_CAP = 3000;

/** A rough count of tokens (characters over four, the same estimate the follow-up allowance uses). */
export const ledgerTokens = (x: unknown): number => Math.ceil(JSON.stringify(x).length / 4);

/** The safety lane's replies, and a turn that carries its crisis or urgent line, are never in a ledger. */
const isLane = (a: AssistantMsg): boolean => a.reason === "urgent" || a.reason === "safety" || a.reason === "decision" || a.notices.some((n) => n.kind === "safety_crisis" || n.kind === "safety_urgent");

/** What the server said a reply was, read as an intent of the ledger (no model: these are the fields the reply already has). */
export function intentOf(a: AssistantMsg): LedgerIntent {
  if (a.reason === "small_talk") return "chat";
  if (a.mode === "paper") return "ask_paper";
  if (a.mode !== "search") return "offer_tool";
  const c = a.context;
  if (c && c.turns > 0 && c.fellBack !== true) {
    if (c.intent === "same_papers") return "ask_results";
    if (c.intent === "refine") return "refine_search";
  }
  return "search";
}

/** The family name of a record's first author ("Wei Li" is "Li", "Li, Wei" is "Li"), or null. */
export function firstAuthor(authors: readonly unknown[] | undefined): string | null {
  const a = Array.isArray(authors) && typeof authors[0] === "string" ? oneLine(authors[0]) : "";
  if (!a) return null;
  const name = a.includes(",") ? a.split(",")[0]!.trim() : (a.split(" ").at(-1) ?? "").trim();
  return name ? cutWhole(name, 60) : null;
}

/** The first characters of what a reply said: its checked answer (without its marks), or else its background or small-talk text. Null for a reply that did not finish. */
export function replyStart(a: AssistantMsg): string | null {
  if (a.status !== "done") return null;
  const text = a.answer && typeof a.answer.text === "string" ? a.answer.text : typeof a.general?.text === "string" ? a.general.text : "";
  return cutWhole(oneLine(text).replace(/\s*\[\d{1,2}\]/g, "").trim(), LEDGER_REPLY_CHARS).trim();
}

const ledgerPapers = (a: AssistantMsg): LedgerPaper[] =>
  (Array.isArray(a.papers) ? a.papers : []).slice(0, LEDGER_PAPERS).flatMap((p, i) => {
    if (!p || typeof p.id !== "string" || typeof p.title !== "string") return [];
    return [{ n: i + 1, id: p.id, doi: typeof p.doi === "string" ? p.doi : null, title: cutWhole(oneLine(p.title), LEDGER_TITLE_CHARS).trim(), year: typeof p.year === "number" && Number.isInteger(p.year) ? p.year : null, first_author: firstAuthor(p.authors) }];
  });

const userWords = (u: UserMsg): string => cutWhole(oneLine(typeof u.text === "string" ? u.text : ""), LEDGER_USER_CHARS).trim();

/**
 * The ledger of a conversation as it stands: the turns of the version being read, from the last "New topic" on, numbered from 1. A user message with an Idea Check under it is a turn of intent `offer_tool`
 * (the idea's text is not in it: nothing about an idea is kept); a reply still being written, and the lane's replies, are not turns. Pure and total: a record this build cannot read gives no turn.
 */
export function buildLedger(msgs: readonly ChatMsg[]): LedgerTurn[] {
  const path = activePath(msgs);
  const from = topicStart(path);
  const out: LedgerTurn[] = [];
  for (let i = from; i + 1 < path.length; i++) {
    const u = path[i];
    const next = path[i + 1];
    if (u?.role !== "user" || !next) continue;
    try {
      if (next.role === "idea") {
        const words = userWords(u);
        if (words) out.push({ turn: out.length + 1, user: words, intent: "offer_tool", standalone: words, reply: null, papers: [] });
        i++;
        continue;
      }
      if (next.role !== "assistant") continue;
      i++;
      if (next.status === "working" || isLane(next)) continue;
      const words = userWords(u);
      if (!words) continue;
      const c = next.context;
      const standalone = c && c.turns > 0 && c.rewrote && typeof c.question === "string" && c.question.trim() ? cutWhole(oneLine(c.question), LEDGER_USER_CHARS).trim() : words;
      out.push({ turn: out.length + 1, user: words, intent: intentOf(next), standalone, reply: replyStart(next), papers: next.mode === "search" ? ledgerPapers(next) : [] });
    } catch {
      /* a record this build cannot read is not a turn */
    }
  }
  return out;
}

/**
 * The ledger a message at `upTo` may lean on: the turns before it. Empty when the message is the first of a "New topic" (it leans on nothing), so an edit or a Search again of such a message is sent with none
 * either, exactly as `contextBefore` rules for `history`.
 */
export function ledgerBefore(msgs: readonly ChatMsg[], upTo: number): LedgerTurn[] {
  const end = Number.isInteger(upTo) ? Math.max(0, Math.min(upTo, msgs.length)) : 0;
  const at = msgs[end];
  if (at?.role === "user" && at.newTopic === true) return [];
  return buildLedger(msgs.slice(0, end));
}

/**
 * What of a ledger is sent with a message (used from M4 on): for a person who is signed in, the six latest turns whole and the older ones only as their standalone question; for a visitor, only the three
 * latest, whole. Then, while it is over about 3,000 tokens, the oldest goes first (the latest turn always stays). Pure; the ledger it is given is not changed.
 */
export function ledgerForSend(turns: readonly LedgerTurn[], o: { signedIn: boolean }): (LedgerTurn | LedgerTurnShort)[] {
  let out: (LedgerTurn | LedgerTurnShort)[] = o.signedIn
    ? turns.map((t, i) => (i >= turns.length - LEDGER_FULL_TURNS ? t : { turn: t.turn, standalone: t.standalone }))
    : turns.slice(-LEDGER_VISITOR_TURNS);
  while (out.length > 1 && ledgerTokens(out) > LEDGER_TOKEN_CAP) out = out.slice(1);
  return out;
}
