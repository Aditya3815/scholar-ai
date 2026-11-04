// The dry-run plan for recording provider answers (docs/design/intent-and-state.md, 8.3, layer L2): for every message of the dev and control sets, what each of three variants would ask
// the five sources, how many distinct searches that is, how many requests, and what it costs on OpenAlex. Pure: it reads the case lists it is given, makes no network call and records
// nothing. The recording itself runs later, by a person, on the OpenAlex key's budget (docs/eval/openalex-budget.md), through the eval's request-URL replay and
// `node eval/patch-fixtures.mjs`, which adds only the recordings that are missing.
//
// The three variants: raw is the message as the chat route sends it today (its spaces collapsed, at most 300 characters); read is the topic the product's reader makes of it
// (the reader is built in R8: until one is given, those rows wait); oracle is the hand-clean form of the case (retrieval.cleanOracle), when the case has one.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VARIANTS = ["raw", "read", "oracle"];

/** The chat route searches nothing for a longer message (routes.ts: `if (query.length > 300) ... "too_long"`). */
export const MAX_QUERY_LENGTH = 300;
/** apps/api/src/search/query.ts: a search that finds fewer papers than this, and has a name written as one word, is repeated with the word split. */
export const FEW_RESULTS = 12;
export const MAX_VARIANTS = 2;

/** apps/api/src/search/openalex.ts, the cost note: about $0.001 a call (OpenAlex pricing of Feb 2026). The Trending job's keyword questions are priced at $0.0001; a search is not one of them. */
export const OPENALEX_USD_PER_CALL = 0.001;
/** The plan's figure for the key's day (8.6). It is inferred from the Trending job's note, not read off the dashboard. */
export const OPENALEX_DAY_CALLS = 10_000;
/** The same day in dollars, as the code's own note has it (apps/api/src/search/openalex.ts: "$1/day free"). At a tenth of a cent a search that is a tenth of the calls above. */
export const OPENALEX_DAY_USD = 1;
/** The eval's request layer (apps/api/eval/lib): the recording asks Semantic Scholar once every 1,150 ms, the slowest source. */
export const S2_GAP_MS = 1150;

/**
 * Requests of one regular search (apps/api/src/search/index.ts, scope "all": openalex, s2, crossref, pubmed, doajAll), counted in the code:
 * OpenAlex 1; Semantic Scholar 1 (a second one only after a 429); Crossref 3 (the search, then the DOI check's one batch call and the retraction check's one call, both only when the
 * results have a DOI); PubMed 2 (esearch, then esummary; 1 when esearch finds nothing); DOAJ 1. Not counted: one doi.org lookup for each DOI that Crossref does not hold (at most
 * 12 a search), and a retry after a 429 or a server error.
 */
export const REQUESTS_PER_SEARCH = { openalex: 1, s2: 1, crossref: 3, pubmed: 2, doaj: 1 };
/** The repeat with the split words asks the five sources once more (PubMed twice); the DOI and retraction checks run once, after it. */
export const REQUESTS_PER_SPLIT = { openalex: 1, s2: 1, crossref: 1, pubmed: 2, doaj: 1 };

/** Sets whose messages are not searched as a message: the safety lane answers first and nothing is sent to a source, and a chain is a conversation. */
export const DEFAULT_EXCLUDED_SETS = ["safety_dev", "chains"];
/** The sealed hold-out: its text must never leave the sealed file, so it is never planned. */
const HOLDOUT_SET = "holdout";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CASES_PATH = resolve(HERE, "..", "..", "eval", "data", "intent-cases.json");
export const DEFAULT_CONTROLS_PATH = resolve(HERE, "..", "..", "eval", "data", "intent-controls.json");

/* ---------- the product's own text rules, kept in step with the code by the tests ---------- */

/** What the chat route asks the sources for a message: its spaces collapsed (routes.ts). The plan also trims it. */
export const productQuery = (text) => text.replace(/\s+/g, " ").trim();

/** apps/api/src/search/query.ts: the pieces of one token, split where a lowercase letter meets a capital and at "_"; never between letters and digits. */
export function splitToken(token) {
  if (!/^[\p{L}\p{N}_]+$/u.test(token)) return [token];
  const spaced = token
    .replace(/_+/g, " ")
    .replace(/(?<=\p{Ll})(?=\p{Lu})/gu, " ")
    .replace(/(?<=\p{Lu})(?=\p{Lu}\p{Ll}{2,})/gu, " ");
  return spaced.split(" ").filter(Boolean);
}

const hasWord = (parts) => parts.filter((p) => /\p{L}{3}/u.test(p)).length >= 2;

/** apps/api/src/search/query.ts: the other way to write the search, when a token is really several words; empty for most searches. */
export function queryVariants(q) {
  const tokens = q.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || q.length < 4) return [];
  let changed = false;
  const out = tokens.flatMap((t) => {
    const parts = splitToken(t);
    if (parts.length > 1 && hasWord(parts)) {
      changed = true;
      return parts;
    }
    return [t];
  });
  const spaced = out.join(" ");
  if (!changed || spaced.toLowerCase() === tokens.join(" ").toLowerCase()) return [];
  return [spaced].slice(0, MAX_VARIANTS);
}

/* ---------- the estimate ---------- */

const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const round = (x, digits) => Math.round(x * 10 ** digits) / 10 ** digits;

/**
 * What `searches` distinct searches cost. `typical` is one pass of REQUESTS_PER_SEARCH each. `couldSplit` of them have a name written as one word: if such a search finds fewer
 * than 12 papers the product asks the five sources once more, so those add at most one OpenAlex call and six requests each (`upper`, `extraIfSplit`).
 */
export function estimateFor(searches, couldSplit = 0) {
  const calls = searches * REQUESTS_PER_SEARCH.openalex;
  const upper = calls + couldSplit * REQUESTS_PER_SPLIT.openalex;
  return {
    searches,
    requests: {
      typical: searches * sum(REQUESTS_PER_SEARCH),
      byProvider: Object.fromEntries(Object.entries(REQUESTS_PER_SEARCH).map(([k, n]) => [k, n * searches])),
      extraIfSplit: couldSplit * sum(REQUESTS_PER_SPLIT),
    },
    openalex: { calls, upper },
    usd: { typical: round(calls * OPENALEX_USD_PER_CALL, 4), upper: round(upper * OPENALEX_USD_PER_CALL, 4) },
    keyDayShare: { typical: round(calls / OPENALEX_DAY_CALLS, 6), upper: round(upper / OPENALEX_DAY_CALLS, 6) },
    keyDayShareUsd: { typical: round((calls * OPENALEX_USD_PER_CALL) / OPENALEX_DAY_USD, 6), upper: round((upper * OPENALEX_USD_PER_CALL) / OPENALEX_DAY_USD, 6) },
    minutesAtS2Pace: round((searches * S2_GAP_MS) / 60000, 1),
  };
}

/* ---------- the plan ---------- */

/** The list of cases in a parsed file: the list itself, or the "cases" list of an object; null for anything else. */
export const casesOf = (json) => (Array.isArray(json) ? json : json && typeof json === "object" && Array.isArray(json.cases) ? json.cases : null);

/**
 * @param {Record<string, unknown[]>} sets  case lists by the name of their source, e.g. { cases, controls }
 * @param {{ readTopic?: (text: string, c: object) => string | null | undefined, excludeSets?: string[] }} [opts]  readTopic answers at once (not a promise)
 *
 * A case needs a text id and a non-empty text. An item that has neither, or whose id is used twice, is reported in `problems` and left out: nothing is guessed.
 */
export function buildReplayPlan(sets, { readTopic, excludeSets = DEFAULT_EXCLUDED_SETS } = {}) {
  const rows = [];
  const pending = [];
  const refused = [];
  const problems = [];
  const excluded = {};
  const bySource = {};
  const seen = new Map();
  let total = 0;

  for (const [source, list] of Object.entries(sets)) {
    bySource[source] = 0;
    (list ?? []).forEach((c, i) => {
      const at = `${source} #${i + 1}`;
      if (!c || typeof c !== "object" || typeof c.id !== "string" || c.id.trim() === "" || typeof c.text !== "string" || c.text.trim() === "") {
        return void problems.push(`${at}: a case needs a text id and a non-empty text`);
      }
      if (c.set === HOLDOUT_SET) return void problems.push(`${c.id}: a hold-out case is never planned (its text must not leave the sealed file)`);
      if (typeof c.set === "string" && excludeSets.includes(c.set)) return void (excluded[c.set] = (excluded[c.set] ?? 0) + 1);
      if (seen.has(c.id)) return void problems.push(`${at}: the id ${c.id} is already used in ${seen.get(c.id)}`);
      seen.set(c.id, at);
      total++;
      bySource[source]++;

      const base = { caseId: c.id, source };
      const add = (variant, text) => {
        const query = productQuery(text);
        if (query.length > MAX_QUERY_LENGTH) refused.push({ ...base, variant, length: query.length, reason: `longer than ${MAX_QUERY_LENGTH} characters: the product does not search it` });
        else rows.push({ ...base, variant, query });
      };
      const wait = (reason) => pending.push({ ...base, variant: "read", reason });

      add("raw", c.text);

      if (typeof readTopic !== "function") wait("no reader was given (the reader is built in R8)");
      else {
        let topic;
        let failed = false;
        try {
          topic = readTopic(c.text, c);
        } catch {
          failed = true;
        }
        if (failed) {
          problems.push(`${c.id}: the reader failed`);
          wait("the reader failed");
        } else if (topic && typeof topic.then === "function") {
          problems.push(`${c.id}: the reader must answer at once, not with a promise`);
          wait("the reader returned a promise");
        } else if (typeof topic === "string" && topic.trim() !== "") add("read", topic);
        else wait("the reader gave no topic");
      }

      const oracle = c.retrieval?.cleanOracle;
      if (oracle !== undefined && oracle !== null) {
        if (typeof oracle !== "string") problems.push(`${c.id}: retrieval.cleanOracle is not a text`);
        else if (oracle.trim() !== "") add("oracle", oracle);
      }
    });
  }

  // One search for the same words with any spacing, but not in any case: the recording keys on the request address, which keeps the case (requestKey in the eval's request layer, apps/api/eval/lib), so "Attention is
  // all you need" and "attention is all you need" are two recordings, though the product's own cache (apps/api/src/search/index.ts, normalisedQuery) would answer the second from the first.
  const distinct = new Map();
  for (const r of rows) distinct.set(r.query, (distinct.get(r.query) ?? false) || queryVariants(r.query).length > 0);
  const couldSplit = [...distinct.values()].filter(Boolean).length;
  const byVariant = Object.fromEntries(VARIANTS.map((v) => [v, rows.filter((r) => r.variant === v).length]));

  return {
    rows,
    pending,
    refused,
    problems,
    summary: {
      cases: { total, bySource },
      excluded,
      rows: { planned: rows.length, pending: pending.length, refused: refused.length, byVariant },
      distinctSearches: distinct.size,
      sharedRows: rows.length - distinct.size,
      couldSplit,
      estimate: estimateFor(distinct.size, couldSplit),
      // each waiting read row adds at most one more search (none when the reader's topic equals a message already planned)
      estimateWithRead: pending.length > 0 ? estimateFor(distinct.size + pending.length, couldSplit) : null,
    },
  };
}

/* ---------- what is printed ---------- */

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const money = (x) => `$${x.toFixed(4)}`;
const num = (n) => n.toLocaleString("en-US");

/** The plan as lines for a screen: counts only, no message (the messages are in the JSON). */
export function formatPlan(plan) {
  const { summary: s } = plan;
  const e = s.estimate;
  const sources = Object.entries(s.cases.bySource).map(([k, n]) => `${n} ${k}`).join(", ");
  const left = Object.entries(s.excluded).map(([k, n]) => `${k} ${n}`).join(", ");
  const lines = [
    "Replay plan: a dry run. It makes no network call and records nothing; no search has been made.",
    `cases: ${s.cases.total} cases${sources ? ` (${sources})` : ""}${left ? `; left out by set: ${left}` : ""}`,
    `rows: ${s.rows.planned} planned (raw ${s.rows.byVariant.raw}, read ${s.rows.byVariant.read}, oracle ${s.rows.byVariant.oracle})${s.rows.refused ? `; ${plural(s.rows.refused, "row")} refused (longer than ${MAX_QUERY_LENGTH} characters: the product does not search it)` : ""}`,
  ];
  if (s.rows.pending) lines.push(`read variant: ${plural(s.rows.pending, "row")} ${s.rows.pending === 1 ? "waits" : "wait"} for the reader (R8); each may add one more search`);
  lines.push(
    `searches: ${e.searches} distinct searches (${plural(s.sharedRows, "row")} share a search with another row); ${s.couldSplit} could be repeated with a name split into words`,
    `provider requests, one pass: ${num(e.requests.typical)} (${Object.entries(e.requests.byProvider).map(([k, n]) => `${k} ${num(n)}`).join(", ")}); at most ${num(e.requests.extraIfSplit)} more for the repeats`,
    `OpenAlex calls: ${num(e.openalex.calls)}${e.openalex.upper === e.openalex.calls ? "" : `, at most ${num(e.openalex.upper)}`}: ${money(e.usd.typical)}${e.usd.upper === e.usd.typical ? "" : ` to ${money(e.usd.upper)}`} at ${OPENALEX_USD_PER_CALL} a call (apps/api/src/search/openalex.ts, cost note; one call for each search)`,
    `share of the key's day: ${round(e.keyDayShare.typical * 100, 2)}% if the day is ${num(OPENALEX_DAY_CALLS)} calls (the plan's inferred figure); ${round(e.keyDayShareUsd.typical * 100, 2)}% if the day is $${OPENALEX_DAY_USD} (the code's own note, apps/api/src/search/openalex.ts, "$1/day free": the more careful reading). Neither is read off the dashboard: see docs/eval/openalex-budget.md`,
    `time: at least ${e.minutesAtS2Pace} minutes at the eval request layer's pace (Semantic Scholar takes one request every ${S2_GAP_MS} ms; patch-fixtures.mjs, which adds the missing recordings, has no such pace yet: see docs/eval/openalex-budget.md)`,
  );
  if (s.estimateWithRead) {
    const w = s.estimateWithRead;
    lines.push(`with the read rows filled in, at most: ${w.searches} searches, ${w.openalex.calls} OpenAlex calls, ${money(w.usd.typical)}`);
  }
  if (plan.problems.length) lines.push(`${plural(plan.problems.length, "problem")}:`, ...plan.problems.map((p) => `  ${p}`));
  else lines.push("0 problems");
  return lines;
}
