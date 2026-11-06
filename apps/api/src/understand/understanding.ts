/**
 * The Understand step's output (docs/design/understand-and-mcp.md, from the design of 6 Nov 2026 "Sodhsetu: understanding, follow-ups and MCP", page 4): ONE shape for every message, asked of a
 * private model as JSON and read here before anything acts on it. Only the enums, the numbers and the checked strings below leave `parseUnderstanding`; a field that does not fit is not repaired into
 * something the model did not say: the whole reading is refused (and the caller asks once more, then falls back to the rules).
 *
 * Pure and total: nothing here calls a model, reads the network or throws.
 */

export const UNDERSTAND_INTENTS = ["chat", "search", "refine_search", "ask_results", "ask_paper", "offer_tool", "clarify"] as const;
export type UnderstandIntent = (typeof UNDERSTAND_INTENTS)[number];
export const UNDERSTAND_LANGUAGES = ["en", "hi", "hinglish"] as const;
export type UnderstandLanguage = (typeof UNDERSTAND_LANGUAGES)[number];
/** The tools a card can offer (never start): Check references, Idea Check, a literature scan. */
export const UNDERSTAND_TOOLS = ["verify", "idea", "litscan"] as const;
export type UnderstandTool = (typeof UNDERSTAND_TOOLS)[number];

export const MAX_STATUS_CHARS = 160;
export const MAX_STANDALONE_CHARS = 300;
export const MAX_QUERY_CHARS = 120;
export const MAX_QUERIES = 3;
export const MAX_CLARIFY_QUESTION_CHARS = 160;
export const MAX_CHOICE_CHARS = 80;
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;

export type UnderstandSearch = {
  /** 1 to 3 English queries. */
  queries: string[];
  year_from: number | null;
  year_to: number | null;
  /** null: the person's own toggle decides; true or false only when the person said so in the message. */
  indian_sources: boolean | null;
};

export type Understanding = {
  intent: UnderstandIntent;
  language: UnderstandLanguage;
  /** One line in the person's language, shown first in the Thinking block with the label "I understood". The only model-written line there. */
  status: string;
  /** The question as it can be understood alone: the writer and the judge get this, never the history. */
  standalone: string;
  /** For search and refine_search; null for every other intent. */
  search: UnderstandSearch | null;
  /** The earlier turn (and its numbered papers) the message is about; null when it is about none. */
  refers_to: { turn: number; papers: number[] } | null;
  /** For offer_tool only. */
  tool: UnderstandTool | null;
  /** For clarify only: one question and 2 or 3 tappable choices ("Search anyway" is added by the page, not asked of the model). */
  clarify: { question: string; choices: string[] } | null;
  /** 0 to 1. */
  confidence: number;
};

/** The JSON schema the model is asked to fill (Workers AI json_schema). Every key is required so that a model cannot leave one out and have a default stand in for what it did not say. */
export const UNDERSTAND_SCHEMA = {
  type: "object",
  properties: {
    intent: { type: "string", enum: [...UNDERSTAND_INTENTS] },
    language: { type: "string", enum: [...UNDERSTAND_LANGUAGES] },
    status: { type: "string" },
    standalone: { type: "string" },
    search: {
      type: ["object", "null"],
      properties: {
        queries: { type: "array", items: { type: "string" } },
        year_from: { type: ["integer", "null"] },
        year_to: { type: ["integer", "null"] },
        indian_sources: { type: ["boolean", "null"] },
      },
      required: ["queries", "year_from", "year_to", "indian_sources"],
    },
    refers_to: {
      type: ["object", "null"],
      properties: { turn: { type: "integer" }, papers: { type: "array", items: { type: "integer" } } },
      required: ["turn", "papers"],
    },
    tool: { type: ["string", "null"], enum: [...UNDERSTAND_TOOLS, null] },
    clarify: {
      type: ["object", "null"],
      properties: { question: { type: "string" }, choices: { type: "array", items: { type: "string" } } },
      required: ["question", "choices"],
    },
    confidence: { type: "number" },
  },
  required: ["intent", "language", "status", "standalone", "search", "refers_to", "tool", "clarify", "confidence"],
} as const;

/** Control characters, zero-width and bidirectional marks out; runs of space as one. What a line on the page may hold. */
export function plainLine(s: string): string {
  return s
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DEVANAGARI = /[ऀ-ॿ]/;
/** Something a search query must never carry: an address, a link, an instruction-looking colon field. Queries are search words, nothing else. */
const NOT_SEARCH_WORDS = /https?:\/\/|www\.|@\S+\.\S+|[{}<>]|\b(?:ignore|system prompt|instructions?)\b/i;

export type ParseFailure =
  | "not_object"
  | "intent"
  | "language"
  | "status"
  | "standalone"
  | "search"
  | "queries"
  | "years"
  | "refers_to"
  | "tool"
  | "clarify"
  | "confidence";

export type ParsedUnderstanding = { ok: true; value: Understanding } | { ok: false; failure: ParseFailure };

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const yearOrNull = (v: unknown): number | null | undefined => (v === null ? null : isInt(v) && v >= MIN_YEAR && v <= MAX_YEAR ? v : undefined);

/**
 * The model's JSON as an Understanding, or the first field that is wrong. Lenient only where leniency cannot invent meaning: strings are trimmed and cut to their length, the confidence is clamped,
 * a search on an intent that has none is dropped (and the same for tool, clarify). Anything else that does not fit refuses the whole reading.
 */
export function parseUnderstanding(raw: unknown): ParsedUnderstanding {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, failure: "not_object" };
  const o = raw as Record<string, unknown>;
  const intent = UNDERSTAND_INTENTS.find((i) => i === o.intent);
  if (!intent) return { ok: false, failure: "intent" };
  const language = UNDERSTAND_LANGUAGES.find((l) => l === o.language);
  if (!language) return { ok: false, failure: "language" };
  if (typeof o.status !== "string") return { ok: false, failure: "status" };
  const status = plainLine(o.status).slice(0, MAX_STATUS_CHARS);
  if (!status) return { ok: false, failure: "status" };
  if (typeof o.standalone !== "string") return { ok: false, failure: "standalone" };
  const standalone = plainLine(o.standalone).slice(0, MAX_STANDALONE_CHARS);
  if (typeof o.confidence !== "number" || !Number.isFinite(o.confidence)) return { ok: false, failure: "confidence" };
  const confidence = Math.min(1, Math.max(0, o.confidence));

  let search: UnderstandSearch | null = null;
  const searching = intent === "search" || intent === "refine_search";
  if (searching) {
    const s = o.search as Record<string, unknown> | null | undefined;
    if (!s || typeof s !== "object" || Array.isArray(s)) return { ok: false, failure: "search" };
    if (!Array.isArray(s.queries)) return { ok: false, failure: "queries" };
    const queries: string[] = [];
    for (const q of s.queries) {
      if (typeof q !== "string") return { ok: false, failure: "queries" };
      const t = plainLine(q).slice(0, MAX_QUERY_CHARS);
      if (!t) continue;
      if (DEVANAGARI.test(t) || NOT_SEARCH_WORDS.test(t) || !/[\p{L}\p{N}]/u.test(t)) return { ok: false, failure: "queries" };
      if (!queries.some((x) => x.toLowerCase() === t.toLowerCase())) queries.push(t);
    }
    if (queries.length === 0 || queries.length > MAX_QUERIES) return { ok: false, failure: "queries" };
    const from = yearOrNull(s.year_from);
    const to = yearOrNull(s.year_to);
    if (from === undefined || to === undefined || (from !== null && to !== null && from > to)) return { ok: false, failure: "years" };
    const india = s.indian_sources;
    if (india !== null && typeof india !== "boolean") return { ok: false, failure: "search" };
    search = { queries, year_from: from, year_to: to, indian_sources: india };
  }

  let refers_to: Understanding["refers_to"] = null;
  if (o.refers_to !== null && o.refers_to !== undefined) {
    const r = o.refers_to as Record<string, unknown>;
    if (typeof r !== "object" || Array.isArray(r) || !isInt(r.turn) || r.turn < 1 || !Array.isArray(r.papers)) return { ok: false, failure: "refers_to" };
    const papers: number[] = [];
    for (const p of r.papers) {
      if (!isInt(p) || p < 1 || p > 10) return { ok: false, failure: "refers_to" };
      if (!papers.includes(p)) papers.push(p);
    }
    refers_to = { turn: r.turn, papers };
  }

  let tool: UnderstandTool | null = null;
  if (intent === "offer_tool") {
    const t = UNDERSTAND_TOOLS.find((x) => x === o.tool);
    if (!t) return { ok: false, failure: "tool" };
    tool = t;
  }

  let clarify: Understanding["clarify"] = null;
  if (intent === "clarify") {
    const c = o.clarify as Record<string, unknown> | null | undefined;
    if (!c || typeof c !== "object" || typeof c.question !== "string" || !Array.isArray(c.choices)) return { ok: false, failure: "clarify" };
    const question = plainLine(c.question).slice(0, MAX_CLARIFY_QUESTION_CHARS);
    const choices: string[] = [];
    for (const ch of c.choices) {
      if (typeof ch !== "string") return { ok: false, failure: "clarify" };
      const t = plainLine(ch).slice(0, MAX_CHOICE_CHARS);
      if (t && !choices.includes(t)) choices.push(t);
    }
    if (!question || choices.length < 2) return { ok: false, failure: "clarify" };
    clarify = { question, choices: choices.slice(0, 3) };
  }

  return { ok: true, value: { intent, language, status, standalone, search, refers_to, tool, clarify, confidence } };
}
