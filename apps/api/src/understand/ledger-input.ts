import { plainLine, UNDERSTAND_INTENTS, type UnderstandIntent } from "./understanding";

/**
 * The turn ledger as the server reads it (design of 6 Nov 2026, page 7): a short record of each earlier turn of THIS chat, built and kept by the browser, sent with a message so the Understand step
 * can read the conversation. It is UNTRUSTED data, like an abstract: its strings may say anything, and nothing in them is an instruction. So it is read strictly here (a wrong shape refuses the whole
 * ledger, as `readHistory` does for today's history), every string is made a plain line and cut, and it is capped before a model sees it.
 *
 * Its papers are never shown as facts from here: what a model is told about them is "this is what the browser says was listed", and the caller re-resolves the ids before any of them is used
 * (`paperRefsToResolve`). The writer and the judge never get the ledger, only the standalone question and the re-resolved papers.
 *
 * The browser applies the same caps when it builds what it sends (packages/shared, built by M2); the server applies them again because a browser can send anything.
 */

export type LedgerPaper = { n: number; id: string | null; doi: string | null; title: string; year: number | null; first_author: string | null };
export type LedgerTurn = {
  turn: number;
  user: string;
  intent: UnderstandIntent | null;
  standalone: string;
  /** The first 300 characters of the reply; null for a reply that was stopped or failed. */
  reply: string | null;
  /** The numbered top papers of a search turn (at most 10); empty for other turns. */
  papers: LedgerPaper[];
  /**
   * An older turn as the browser sends it once the six latest are sent whole (`ledgerForSend` in packages/shared: only `turn` and `standalone`). It has no words of the person's and no reply here (`user` is
   * empty, `reply` null) and the model is shown only its standalone question.
   */
  short?: true;
};

export const LEDGER_MAX_TURNS_SENT = 40;
export const LEDGER_FULL_TURNS = 6;
export const LEDGER_VISITOR_TURNS = 3;
export const LEDGER_MAX_PAPERS = 10;
export const LEDGER_USER_CHARS = 600;
export const LEDGER_STANDALONE_CHARS = 300;
export const LEDGER_REPLY_CHARS = 300;
export const LEDGER_TITLE_CHARS = 250;
export const LEDGER_AUTHOR_CHARS = 60;
/** About 3,000 tokens at four characters a token: the whole ledger as rendered for the model. */
export const LEDGER_MAX_CHARS = 12_000;

const OPENALEX_ID = /^W\d{1,12}$/;
/** A paper id as the search makes it (search/merge.ts: `doi:`, `pmid:` or `t:` and a key). Only an id: it is never shown, and a paper is resolved again by its DOI before it is used. */
const SEARCH_ID = /^(?:doi:10\.\d{4,9}\/[^\s"<>]{1,200}|pmid:\d{1,12}|t:[\p{L}\p{N} _.:-]{1,200})$/u;
const DOI = /^10\.\d{4,9}\/[^\s"<>]{1,200}$/;

export type LedgerRead = { ok: true; turns: LedgerTurn[] } | { ok: false; detail: string };

const str = (v: unknown, max: number): string | null => (typeof v === "string" ? plainLine(v).slice(0, max) : null);

function readPaper(v: unknown): LedgerPaper | string {
  if (!v || typeof v !== "object" || Array.isArray(v)) return "a paper is not an object";
  const p = v as Record<string, unknown>;
  if (typeof p.n !== "number" || !Number.isInteger(p.n) || p.n < 1 || p.n > LEDGER_MAX_PAPERS) return "a paper number is out of range";
  const title = str(p.title, LEDGER_TITLE_CHARS);
  if (!title) return "a paper has no title";
  let id: string | null = null;
  if (p.id !== undefined && p.id !== null) {
    if (typeof p.id !== "string" || !(OPENALEX_ID.test(p.id) || SEARCH_ID.test(p.id))) return "a paper id is not one the search makes";
    id = p.id;
  }
  let doi: string | null = null;
  if (p.doi !== undefined && p.doi !== null) {
    if (typeof p.doi !== "string") return "a DOI is not text";
    const d = p.doi.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "").toLowerCase();
    if (!DOI.test(d)) return "a DOI does not look like one";
    doi = d;
  }
  let year: number | null = null;
  if (p.year !== undefined && p.year !== null) {
    if (typeof p.year !== "number" || !Number.isInteger(p.year) || p.year < 1500 || p.year > 2100) return "a year is out of range";
    year = p.year;
  }
  const first_author = p.first_author === undefined || p.first_author === null ? null : str(p.first_author, LEDGER_AUTHOR_CHARS);
  if (p.first_author !== undefined && p.first_author !== null && first_author === null) return "an author is not text";
  return { n: p.n, id, doi, title, year, first_author: first_author || null };
}

/** The ledger as sent, read strictly. Absent (undefined or null) is an empty ledger; anything else that is not a list of well-formed turns is refused with what was wrong (never with what it said). */
export function readLedger(raw: unknown): LedgerRead {
  if (raw === undefined || raw === null) return { ok: true, turns: [] };
  if (!Array.isArray(raw)) return { ok: false, detail: "the ledger is not a list" };
  if (raw.length > LEDGER_MAX_TURNS_SENT) return { ok: false, detail: "the ledger has too many turns" };
  const turns: LedgerTurn[] = [];
  let last = 0;
  for (const v of raw) {
    if (!v || typeof v !== "object" || Array.isArray(v)) return { ok: false, detail: "a turn is not an object" };
    const t = v as Record<string, unknown>;
    if (typeof t.turn !== "number" || !Number.isInteger(t.turn) || t.turn <= last || t.turn > 10_000) return { ok: false, detail: "turn numbers do not rise" };
    last = t.turn;
    // an older turn, sent as its standalone question only: nothing else may be in it
    if (t.user === undefined && t.reply === undefined && t.papers === undefined && t.intent === undefined) {
      const standalone = str(t.standalone, LEDGER_STANDALONE_CHARS);
      if (!standalone) return { ok: false, detail: "an older turn has no standalone question" };
      turns.push({ turn: t.turn, user: "", intent: null, standalone, reply: null, papers: [], short: true });
      continue;
    }
    const user = str(t.user, LEDGER_USER_CHARS);
    if (user === null) return { ok: false, detail: "a turn has no message" };
    let intent: UnderstandIntent | null = null;
    if (t.intent !== undefined && t.intent !== null) {
      const i = UNDERSTAND_INTENTS.find((x) => x === t.intent);
      if (!i) return { ok: false, detail: "a turn's intent is not one of the intents" };
      intent = i;
    }
    const standalone = t.standalone === undefined || t.standalone === null ? "" : str(t.standalone, LEDGER_STANDALONE_CHARS);
    if (standalone === null) return { ok: false, detail: "a standalone question is not text" };
    let reply: string | null = null;
    if (t.reply !== undefined && t.reply !== null) {
      reply = str(t.reply, LEDGER_REPLY_CHARS);
      if (reply === null) return { ok: false, detail: "a reply is not text" };
    }
    const papers: LedgerPaper[] = [];
    if (t.papers !== undefined && t.papers !== null) {
      if (!Array.isArray(t.papers) || t.papers.length > LEDGER_MAX_PAPERS) return { ok: false, detail: "a turn's papers are not a short list" };
      for (const pv of t.papers) {
        const p = readPaper(pv);
        if (typeof p === "string") return { ok: false, detail: p };
        if (papers.some((x) => x.n === p.n)) return { ok: false, detail: "two papers have the same number" };
        papers.push(p);
      }
    }
    turns.push({ turn: t.turn, user, intent, standalone, reply, papers });
  }
  return { ok: true, turns };
}

/** A turn as the model reads it: full (the last few), or only its standalone question (older ones). */
export type LedgerView = { turn: LedgerTurn; full: boolean };

/**
 * What of the ledger a model reads: the last `LEDGER_FULL_TURNS` turns in full, older ones only by their standalone question, the whole within `LEDGER_MAX_CHARS` (the oldest go first when it is
 * over). A visitor's ledger is only the last `LEDGER_VISITOR_TURNS` turns.
 */
export function capLedger(turns: readonly LedgerTurn[], options: { visitor?: boolean } = {}): LedgerView[] {
  const kept = options.visitor ? turns.slice(-LEDGER_VISITOR_TURNS) : turns.slice();
  const views: LedgerView[] = kept.map((turn, i) => ({ turn, full: !turn.short && i >= kept.length - LEDGER_FULL_TURNS }));
  // an older turn with no standalone question has nothing to show
  const shown = views.filter((v) => v.full || v.turn.standalone);
  while (shown.length > 1 && renderLedger(shown).length > LEDGER_MAX_CHARS) shown.shift();
  return shown;
}

/** The ledger for the model, as plain lines inside a block the system prompt calls data. */
export function renderLedger(views: readonly LedgerView[]): string {
  const lines: string[] = [];
  for (const { turn: t, full } of views) {
    if (!full) {
      lines.push(`Turn ${t.turn} (older): ${t.standalone}`);
      continue;
    }
    lines.push(`Turn ${t.turn}: user said: ${t.user}`);
    if (t.intent) lines.push(`  understood as: ${t.intent}${t.standalone ? `: ${t.standalone}` : ""}`);
    lines.push(`  reply: ${t.reply === null ? "(did not finish)" : t.reply}`);
    for (const p of t.papers) lines.push(`  paper ${p.n}: ${p.title}${p.first_author ? `; ${p.first_author}` : ""}${p.year ? `; ${p.year}` : ""}`);
  }
  return lines.join("\n");
}

/** The ledger papers a reading points at, for the caller to re-resolve (KV or an OpenAlex lookup by DOI) before any of them is used: never shown as they were sent. */
export function paperRefsToResolve(turns: readonly LedgerTurn[], refersTo: { turn: number; papers: number[] } | null): LedgerPaper[] {
  if (!refersTo) return [];
  const t = turns.find((x) => x.turn === refersTo.turn);
  if (!t) return [];
  return refersTo.papers.map((n) => t.papers.find((p) => p.n === n)).filter((p): p is LedgerPaper => !!p && (p.id !== null || p.doi !== null));
}
