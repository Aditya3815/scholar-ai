import type { Paper } from "@scholar/shared";
import type { Complete } from "../docs/qa";
import { AllProvidersFailedError, gatewayFromEnv, type LlmEnv } from "../llm";
import { sha256Hex } from "../hash";
import { applyDoiIntegrity, applyRetractions } from "../search";
import { cacheKey, cached } from "../search/cache";
import { mergeAndRank } from "../search/merge";
import { plainPapers } from "../search/normalize";
import { openalexByDois } from "../search/openalex";
import type { SearchEnv } from "../search/types";
import type { LedgerPaper } from "../understand/ledger-input";
import { stubIndiaPapers, stubPapers } from "./stub";

/**
 * What the chat route needs to run the Understand step (M4/M5; design PDF "Sodhsetu understanding, follow-ups and MCP", pages 3 to 9) that is not the step itself (understand/understand.ts):
 *   - the private model for the step and for the conversation reply (task `understand`: Workers AI only, never the public lane, also for a visitor);
 *   - the stand-ins of both for the offline runs (QA_STUB);
 *   - the papers a ledger points at, resolved again by their DOI (the browser's copy of a paper is never used as a fact);
 *   - a visitor's daily cap of Understand calls (migration 0027): a one-way code of the day and the address, never the address.
 */

/** How long the Understand call may take in the gateway (the step itself gives up at UNDERSTAND_TIMEOUT_MS and lets the rules decide). */
const UNDERSTAND_GATEWAY_MS = 8_000;

/** The Understand step's model for `subject` (a person's id, or a visitor's code of the day): PRIVATE, counted in that subject's daily allowance like every other model call. */
export function understandCompleteFor(env: LlmEnv, subject: string): Complete {
  const gateway = gatewayFromEnv(env);
  return async (req) => {
    const r = await gateway.complete({ task: "understand", sensitivity: "private", subject, system: req.system, user: req.user, schema: req.schema, maxTokens: req.maxTokens, timeoutMs: UNDERSTAND_GATEWAY_MS, label: req.label });
    return { json: r.json, model: r.model };
  };
}

/** The conversation reply's model (intent `chat`): the same private chain, a short reply. */
export function chatReplyCompleteFor(env: LlmEnv, subject: string): Complete {
  const gateway = gatewayFromEnv(env);
  return async (req) => {
    const r = await gateway.complete({ task: "understand", sensitivity: "private", subject, system: req.system, user: req.user, schema: req.schema, maxTokens: req.maxTokens, timeoutMs: 15_000, label: req.label });
    return { json: r.json, model: r.model };
  };
}

/* ---------------------------------------------------------------- the stand-ins (QA_STUB=1 with ENABLE_DEV_ROUTES=1: tests and the local end-to-end run only) */

const failedWith = (error: string) => new AllProvidersFailedError([{ provider: "workersai", model: "stub", ok: false, ms: 1, error }]);

/** The last turn of the ledger block that listed papers, and how many (read from the prompt's own lines: "Turn 3: ..." and "  paper 2: ..."). */
function ledgerOf(prompt: string): { lastTurn: number; papersTurn: number; papers: number; topic: string } {
  const lines = prompt.split("\n");
  let lastTurn = 0;
  let papersTurn = 0;
  let papers = 0;
  let current = 0;
  let topic = "";
  for (const l of lines) {
    const t = /^Turn (\d+)(?: \(older\))?:\s*(?:user said:\s*)?(.*)$/.exec(l);
    if (t) {
      current = Number(t[1]);
      lastTurn = current;
      continue;
    }
    const u = /^\s+understood as: (?:search|refine_search)(?:: (.*))?$/.exec(l);
    if (u && u[1]) topic = u[1];
    if (/^\s+paper \d+:/.test(l)) {
      if (papersTurn !== current) papers = 0;
      papersTurn = current;
      papers++;
    }
  }
  return { lastTurn, papersTurn, papers, topic };
}

const ORDINALS: [RegExp, number][] = [
  [/\b(?:first|pehl[ae]|pahl[ae])\b/i, 1],
  [/\b(?:second|dusr[aei]|doosr[aei])\b/i, 2],
  [/\b(?:third|teesr[aei]|tisr[aei])\b/i, 3],
];

/**
 * The Understand model, offline. It reads the message (the last triple-quoted block) and the ledger lines before it, and answers by words:
 *   "undtimeout" / "undgarbled" / "unddown": a call that times out, a reply that is not valid twice, every model down (the fail policy);
 *   "undclarify": the model's own question; "undunsure": a search it is only 0.6 sure of (the "Did you want this?" line);
 *   "literature review", "lit scan", "review chahiye": offer the literature scan; "reference", "bibliograph": Check references; "idea", "novel": Idea Check; "uploaded", "my pdf": the person's paper;
 *   "cricket", "kaise ho", "kya kar sakte", "aur batao", "undchat": conversation;
 * and with papers in the ledger: a year after "baad", "after" or "since" refines the last search from that year; "first/second/third paper" (pehla, dusra, teesra) asks about that paper; "simple", "samjhao",
 * "explain" ask about the papers again; "hindi mein" is the same answer in Hindi. Anything else is a search of the message's words. Never a fact of its own: a stand-in for what the real model decides.
 */
export const stubUnderstand: Complete = async ({ user }) => {
  const blocks = [...user.matchAll(/"""\n([\s\S]*?)\n"""/g)];
  const text = (blocks.at(-1)?.[1] ?? "").trim();
  const record = blocks.length >= 2 ? (blocks.at(-2)?.[1] ?? "") : "";
  const l = text.toLowerCase();
  if (/\bundtimeout\b/.test(l)) throw failedWith("timeout");
  if (/\bundgarbled\b/.test(l)) return { model: "stub", json: { intent: "banana" } };
  if (/\bunddown\b/.test(l)) throw failedWith("HTTP 503");
  const language = /[ऀ-ॿ]/.test(text) ? "hi" : /\b(?:hai|kya|mein|ke|ka|ki|batao|samjhao|baad|dusre|sirf|aur|chahiye|kaise)\b/.test(l) ? "hinglish" : "en";
  const base = { language, standalone: text.slice(0, 200), refers_to: null, tool: null, clarify: null, search: null };
  const status = (s: string) => ({ en: s, hinglish: s, hi: s })[language as "en"];
  const ledger = ledgerOf(record);
  if (/\bundclarify\b/.test(l)) return { model: "stub", json: { ...base, intent: "clarify", status: status("I need to check what you mean"), clarify: { question: "Which topic should I look for papers on?", choices: ["Machine learning in health", "Machine learning in farming"] }, confidence: 0.5 } };
  if (/literature review|lit scan|literature scan|review chahiye/.test(l)) return { model: "stub", json: { ...base, intent: "offer_tool", tool: "litscan", status: status("You want a literature review"), confidence: 0.9 } };
  if (/reference|bibliograph/.test(l)) return { model: "stub", json: { ...base, intent: "offer_tool", tool: "verify", status: status("You want your references checked"), confidence: 0.9 } };
  if (/\b(?:idea|novel)\b/.test(l)) return { model: "stub", json: { ...base, intent: "offer_tool", tool: "idea", status: status("You want to know if your idea is new"), confidence: 0.9 } };
  if (/uploaded|my pdf/.test(l)) return { model: "stub", json: { ...base, intent: "ask_paper", status: status("A question about your uploaded paper"), confidence: 0.9 } };
  if (/cricket|kaise ho|kya kar sakte|aur batao|\bundchat\b|\bundleak\b/.test(l)) return { model: "stub", json: { ...base, intent: "chat", status: status("Conversation, no search"), confidence: 0.95 } };
  if (ledger.papers > 0) {
    const year = /(?:baad|after|since)\D{0,12}((?:19|20)\d{2})|((?:19|20)\d{2})\D{0,12}(?:ke baad|baad|onwards|or later)/.exec(l);
    if (year) {
      const y = Number(year[1] ?? year[2]);
      const topic = ledger.topic || text;
      return { model: "stub", json: { ...base, intent: "refine_search", standalone: `${topic} from ${y}`.slice(0, 200), status: status(`The last search, from ${y} on`), search: { queries: [topic.slice(0, 100)], year_from: y, year_to: null, indian_sources: null }, confidence: 0.9 } };
    }
    const ord = ORDINALS.find(([re]) => re.test(l));
    if (ord && /paper|wala|wale|study|one/.test(l)) return { model: "stub", json: { ...base, intent: "ask_results", status: status(`A question about paper ${ord[1]} above`), refers_to: { turn: ledger.papersTurn, papers: [ord[1]] }, confidence: 0.88 } };
    if (/simple|samjhao|explain|hindi mein|in hindi/.test(l)) return { model: "stub", json: { ...base, intent: "ask_results", language: /hindi/.test(l) ? "hi" : language, status: status("A question about the papers above"), refers_to: { turn: ledger.papersTurn, papers: [] }, confidence: 0.9 } };
  }
  const words = text.replace(/^(?:ab|now)\s+/i, "").split(/\s+/).slice(0, 8).join(" ");
  const confidence = /\bundunsure\b/.test(l) ? 0.6 : 0.9;
  const query = words.replace(/\bundunsure\b/gi, "").replace(/\s+/g, " ").trim() || words;
  return { model: "stub", json: { ...base, intent: "search", status: status(`You want papers on ${query.toLowerCase()}`), search: { queries: [query], year_from: null, year_to: null, indian_sources: null }, confidence } };
};

/** The conversation reply, offline: a fixed reply per language; "undleak" makes it cite a paper (the post-check must throw it away and the message is searched instead). */
export const stubChatReply: Complete = async ({ user }) => {
  const text = [...user.matchAll(/"""\n([\s\S]*?)\n"""/g)].at(-1)?.[1] ?? "";
  if (/\bundleak\b/i.test(text)) return { model: "stub", json: { reply: "Smith et al. (2020) showed that this works." } };
  const hinglish = /Reply language: hinglish/.test(user);
  const hindi = /Reply language: hi /.test(user);
  if (/cricket/i.test(text)) return { model: "stub", json: { reply: "I help with research, not sports scores. Shall I find papers on sports science instead?" } };
  return { model: "stub", json: { reply: hindi ? "सब बढ़िया है! आप किस विषय पर शोध कर रहे हैं?" : hinglish ? "Sab badhiya! Aap kis topic par research kar rahe ho?" : "All good, thanks! What topic are you researching?" } };
};

/* ---------------------------------------------------------------- the papers a ledger points at */

/** The most papers resolved for one message (a ledger turn lists at most ten). */
export const MAX_RESOLVED = 10;
const RESOLVE_TTL_S = 24 * 3600;

/** A ledger paper's DOI: its own, or the one its search id carries (`doi:...`). */
const doiOf = (p: LedgerPaper): string | null => p.doi ?? (p.id && p.id.startsWith("doi:") ? p.id.slice(4).toLowerCase() : null);

/**
 * The papers a reading points at, as they really are: looked up again by DOI (OpenAlex, one request, kept 24 hours in the public cache: a DOI's record is public data), then the DOI check and the retraction
 * check the search makes. In the order the ledger numbered them. A paper with no DOI, or one OpenAlex does not know, is left out: it is never shown or used from the browser's copy. Never throws (a failure
 * resolves nothing, and the caller searches instead).
 */
export async function resolveLedgerPapers(env: SearchEnv, refs: readonly LedgerPaper[], stubbed: boolean): Promise<Paper[]> {
  const wanted = refs.slice(0, MAX_RESOLVED).map((p) => ({ p, doi: doiOf(p) })).filter((x): x is { p: LedgerPaper; doi: string } => !!x.doi);
  if (wanted.length === 0) return [];
  try {
    let found: Paper[];
    if (stubbed) {
      const known = [...stubPapers(), ...stubIndiaPapers()];
      found = wanted.map((w) => known.find((k) => k.doi === w.doi)).filter((k): k is Paper => !!k).map((k) => ({ ...k, sources: [...k.sources], retractionSources: [...k.retractionSources] }));
    } else {
      const dois = wanted.map((w) => w.doi).sort();
      const key = await cacheKey("openalex-dois", ...dois);
      const { value } = await cached(env.store, "openalex", key, RESOLVE_TTL_S, () => openalexByDois(dois, env, AbortSignal.timeout(6_000)));
      const merged = mergeAndRank({ openalex: plainPapers(value) }, MAX_RESOLVED);
      found = wanted.map((w) => merged.find((m) => m.doi === w.doi)).filter((m): m is Paper => !!m);
      await Promise.all([applyDoiIntegrity(env, found), applyRetractions(env, found)]);
    }
    return found;
  } catch {
    console.warn(JSON.stringify({ level: "warn", msg: "ledger_resolve_failed" }));
    return [];
  }
}

/* ---------------------------------------------------------------- a visitor's daily cap */

/** How many Understand calls a visitor (not signed in) may make in a UTC day, per address (design PDF, page 9). */
export const VISITOR_DAILY_CALLS = 40;

/** A one-way code of the day and the address: the same address is a different code every day, and the address is never stored. */
export const visitorCode = async (ip: string, day: string): Promise<string> => (await sha256Hex(`understand:${day}:${ip}`)).slice(0, 32);

/**
 * One more Understand call for this visitor today, if there is room: true when the call may be made (and it is counted), false past the cap. A failure of the count is not a reason to call the model: it
 * says false (the message then goes the rules' way, which costs nothing).
 */
export async function takeVisitorCall(db: D1Database, ip: string, now = new Date()): Promise<{ ok: boolean; code: string }> {
  const day = now.toISOString().slice(0, 10);
  const code = await visitorCode(ip, day);
  try {
    const row = await db
      .prepare("INSERT INTO understand_visitors (day, who, n) VALUES (?1, ?2, 1) ON CONFLICT (day, who) DO UPDATE SET n = n + 1 RETURNING n")
      .bind(day, code)
      .first<{ n: number }>();
    return { ok: !!row && Number(row.n) <= VISITOR_DAILY_CALLS, code };
  } catch {
    console.warn(JSON.stringify({ level: "warn", msg: "understand_visitor_count_failed" }));
    return { ok: false, code };
  }
}
