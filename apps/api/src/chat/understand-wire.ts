import type { Paper } from "@scholar/shared";
import { sha256Hex } from "../hash";
import { applyDoiIntegrity, applyRetractions } from "../search";
import { cacheKey, cached } from "../search/cache";
import { mergeAndRank } from "../search/merge";
import { plainPapers } from "../search/normalize";
import { openalexByDois } from "../search/openalex";
import type { SearchEnv } from "../search/types";
import type { LedgerPaper } from "../understand/ledger-input";

/**
 * What the chat route needs to run the Understand step (M4/M5; design PDF "Sodhsetu understanding, follow-ups and MCP", pages 3 to 9) that is not the step itself (understand/understand.ts):
 *   (the private model of the step and of the conversation reply are the profiles `understand` and `chatReply`, platform/llm/profiles.ts; their stand-ins are in testing/understand.ts)
 *   - the papers a ledger points at, resolved again by their DOI (the browser's copy of a paper is never used as a fact);
 *   - a visitor's daily cap of Understand calls (migration 0027): a one-way code of the day and the address, never the address.
 */

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
export async function resolveLedgerPapers(refs: readonly LedgerPaper[], byDoi: (dois: string[]) => Promise<Paper[]>): Promise<Paper[]> {
  const wanted = refs.slice(0, MAX_RESOLVED).map((p) => doiOf(p)).filter((d): d is string => !!d);
  if (wanted.length === 0) return [];
  try {
    return await byDoi(wanted);
  } catch {
    console.warn(JSON.stringify({ level: "warn", msg: "ledger_resolve_failed" }));
    return [];
  }
}

/** The papers of these DOIs as they really are, in the order given (deps.papersByDoi outside a test run): one OpenAlex request, kept 24 hours in the public cache, then the DOI and retraction checks of the search. */
export async function ledgerPapersByDoi(env: SearchEnv, wanted: string[]): Promise<Paper[]> {
  const dois = [...wanted].sort();
  const key = await cacheKey("openalex-dois", ...dois);
  const { value } = await cached(env.store, "openalex", key, RESOLVE_TTL_S, () => openalexByDois(dois, env, AbortSignal.timeout(6_000)));
  const merged = mergeAndRank({ openalex: plainPapers(value) }, MAX_RESOLVED);
  const found = wanted.map((d) => merged.find((m) => m.doi === d)).filter((m): m is Paper => !!m);
  await Promise.all([applyDoiIntegrity(env, found), applyRetractions(env, found)]);
  return found;
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
