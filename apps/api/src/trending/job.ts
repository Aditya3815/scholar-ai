import { TRENDING_POOL_MAX_DAYS, YEAR_FILTER_SEARCH_LIMIT, parseTrending, type SearchResponse, type SearchScope } from "@scholar/shared";
import { QUERYABLE_SUBFIELDS } from "@scholar/shared/src/subfield-policy";
import {
  buildPayload,
  confirmation,
  countryProblem,
  journalProblem,
  phraseKey,
  retractionChecked,
  scoreSubfields,
  selectShown,
  summarizeSearch,
  trendWindows,
  usesSecondSource,
  verifySummary,
  withExactBaseline,
  type Candidate,
  type SecondSource,
  type SubfieldInput,
  type TrendGroup,
} from "@scholar/shared/src/trending";
import { runSearch } from "../search";
import { memoryStore } from "../cache/store";
import { searchEnvFrom, type SearchBindings } from "../search/env";
import type { SearchEnv } from "../search/types";
import { arxivCounts, type ArxivDeps } from "./arxiv";
import { countriesOf, exactCount, venuesOf, type OaDeps } from "./openalex";
import { expand, isBatchFile, scanBatch, type BatchFile } from "./scan";
import { BudgetError, CallBudget, SourceError, makePacer, mapLimit, type Http } from "./sources";
import { BATCH_TTL_SECONDS, FILE_TTL_SECONDS, POOL_TTL_SECONDS, TRENDING_KEYS } from "./store";
import { STUB_FAULT_KEY, STUB_SUBFIELDS, makeStubTrending, parseStubFault } from "./stub";

/**
 * The Trending job (docs/design/chatview-and-trending.md, T3, T4, T8): once a day, inside the 03:17 UTC run, it makes the one file the page reads. It does two things.
 *
 *   Weekly (on Monday, or when the pool is missing or a week old): the SCAN. For every subfield of OpenAlex's taxonomy, the keywords of the last quarter against the same quarter a year before,
 *   for everyone and for papers with an author at an Indian institution (scan.ts). About 1,000 calls of 1 to 4 seconds, so it is done in batches whose results wait in KV, and a run that
 *   runs out of time goes on in the next one. When the scan is whole the ranker (packages/shared/src/trending.ts) scores it, the best candidates are asked their journals and countries
 *   (and, when last year's list did not have them, their exact count), and what passes is the POOL: about 40 phrases for everyone and 20 for India.
 *
 *   Daily: the FILE. From the pool: a phrase from computing, mathematics or physics must be growing on arXiv too; every phrase must pass the verifier (T8: the product's own search, all its sources
 *   or the Indian ones, finds enough papers with abstracts, recent ones, none retracted, not all from one journal); the list is picked with hysteresis (what was shown stays unless something scores 1.25
 *   times higher), 12 phrases at most, one per OpenAlex field and four per domain. The file is written only when at least 8 phrases are left. On ANY error, nothing is written and the last file stays.
 *
 * The daily part comes first when there is a usable pool, so a long scan can never keep the day's file from being made. The platform's numbers (checked 3 Nov 2026,
 * developers.cloudflare.com/workers/platform/limits): a Workers Paid invocation may make 10,000 subrequests (KV, D1 and R2 operations count) and a scheduled one may run 15 minutes; 6 connections at
 * once; 1,000 KV operations (the KV page says that, for Free and Paid alike, and the Workers page says 10,000 subrequests: they disagree, so the smaller is the rule). The other two jobs share the
 * invocation. So: at most 2,000 calls a run (a search is counted as 25: with its cache in memory, `jobSearchEnv`, a cold search was measured at 8 requests and about 9 calls to the shared lanes, and
 * none to KV), 1,600 for a whole scan, 900 KV operations (the job's own: its searches make none), 9 minutes of wall time, 4 calls at once.
 *
 * Nothing here is about a person. The only text that goes out is a keyword from OpenAlex's own list, to the product's own search (as the person would send it).
 */
export type TrendingLimits = {
  /** The run starts no new work after this long (ms). The scheduled run may last 15 minutes, and the other two jobs are in it too. */
  wallMs: number;
  /** Nothing at all is started after this long: the daily file's searches stop with an error (the last file stays). Under the 15 minutes a scheduled run may last. */
  hardStopMs: number;
  /** A batch of the scan is started only with this much time left. */
  batchMs: number;
  /** The pool is made from a whole scan only with this much time left (a few hundred calls); otherwise the next run does it. */
  finalizeMs: number;
  /** After a pool is made in a run that had none usable, the file is made in the same run only with this much time left. */
  dailyMs: number;
  /** Calls to OpenAlex and arXiv in a run, and for a whole scan. A search counts as `searchCost`: the sources it asks, the DOI and retraction checks and the calls to the shared lanes (about 17 measured). */
  runCalls: number;
  scanCalls: number;
  searchCost: number;
  batchSubfields: number;
  /** Calls at once: a Worker may have 6 connections open, and the other jobs use some. */
  concurrency: number;
  poolGlobal: number;
  poolIndia: number;
  /** A new pool smaller than this (everyone's) is refused: it would replace a good pool with a poor one. 8 are needed to publish at all. */
  poolMin: number;
  evidenceMaxGlobal: number;
  evidenceMaxIndia: number;
  exactMaxGlobal: number;
  exactMaxIndia: number;
  /** The most searches a run makes for one list. */
  maxAsks: number;
  scanMaxAgeDays: number;
  poolEveryDays: number;
  /** A pool this old (days) at the end of a run, with no new one made, fails the run: the scan is not finishing, and the list goes when the pool is 14 days old. */
  poolLateDays: number;
  /** Whether the held (health) subfields are scanned for the log of what is not shown. */
  scanHeld: boolean;
  leaseMs: number;
  timeoutMs: number;
  retries: number;
  retryWaitMs: number;
  arxivGapMs: number;
  /** This many phrases in a row that arXiv could not answer (each after its own retry) is an outage: the run fails and the last file stays. Fewer is a hiccup: those phrases are not shown tonight. */
  arxivFailures: number;
};
export const TRENDING_LIMITS: TrendingLimits = {
  wallMs: 540_000,
  hardStopMs: 660_000,
  batchMs: 45_000,
  finalizeMs: 150_000,
  dailyMs: 240_000,
  runCalls: 2_000,
  scanCalls: 1_600,
  searchCost: 25,
  batchSubfields: 10,
  concurrency: 4,
  poolGlobal: 40,
  poolIndia: 20,
  poolMin: 10,
  evidenceMaxGlobal: 120,
  evidenceMaxIndia: 50,
  exactMaxGlobal: 40,
  exactMaxIndia: 15,
  maxAsks: 60,
  // a scan begins when the pool is 7 days old and the old pool is good for 13: a scan that has had up to 6 nights still finishes in time (the daily file comes first, so a slow night may leave it a few batches)
  scanMaxAgeDays: 6,
  poolEveryDays: 7,
  poolLateDays: 10,
  scanHeld: true,
  leaseMs: 660_000,
  timeoutMs: 30_000,
  retries: 1,
  retryWaitMs: 1_500,
  arxivGapMs: 3_100,
  arxivFailures: 3,
};
/** KV operations a run may make (the platform allows 1,000 an invocation, the other jobs use none). */
const KV_OPS = 900;
/** At most this many shown phrases in one OpenAlex domain. The plan's 2 gives 6 phrases at most with Health held (three domains), and the file needs 8: see docs/design/chatview-and-trending.md. */
const PER_DOMAIN = 4;
const DAY_MS = 864e5;

export type TrendingDeps = {
  kv: KVNamespace;
  mailto: string;
  apiKey?: string;
  fetch: typeof fetch;
  /** The product's own search: the same merge and providers the chat uses (the Indian ones for scope "india"). */
  search: (q: string, scope: SearchScope) => Promise<SearchResponse>;
  sleep?: (ms: number) => Promise<void>;
  clock?: () => number;
  subfields?: readonly number[];
  limits?: Partial<TrendingLimits>;
  /** The Worker variable TRENDING: "off" stops the job. */
  variable?: string;
  /** Whether arXiv requests take their turn in the shared lane (default yes: see arxiv.ts). Off only for the local run on stand-ins. */
  lane?: boolean;
};

export type TrendingResult = {
  skipped?: "off" | "no_kv";
  asOf: string;
  daily?: { published: boolean; reason?: "pool_stale"; global?: string[]; india?: string[]; asks?: number; rejected?: { confirmation: number; verification: number; /** the search's retraction check did not answer */ unchecked: number; /** arXiv could not give the phrase's counts tonight */ unconfirmed: number }; /** pool phrases the owner's deny list took out of today's file */ denied?: number };
  scan?: { asOf: string; next: number; batches: number; completed: boolean; skipped?: "busy"; calls: number; held?: string[]; pool?: { global: number; india: number } };
  calls: number;
  kvOps: number;
  ms: number;
};

/* ---------------------------------------------------------------- what is kept in KV */

type Pool = { version: 1; poolAsOf: string; builtAt: string; global: Candidate[]; india: Candidate[]; held: string[] };
type ScanState = { version: 1; asOf: string; startedAt: number; next: number; batches: number; n: number; calls: number; leaseUntil: number; done?: boolean };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const daysBetween = (from: string, to: string): number => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;
const num = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

function isCandidate(c: unknown): c is Candidate {
  const o = c as Candidate | null;
  return (
    !!o && typeof o === "object" &&
    typeof o.id === "string" && typeof o.text === "string" && typeof o.phrase === "string" && typeof o.subfieldName === "string" && typeof o.field === "string" && typeof o.domain === "string" &&
    isCount(o.subfield) && isCount(o.fieldId) && isCount(o.domainId) && isCount(o.a) && isCount(o.b) && isCount(o.total) && num(o.ratio) && num(o.score) &&
    typeof o.bEstimated === "boolean" && (o.policy === "allow" || o.policy === "hold")
  );
}
function parsePool(text: string | null): Pool | null {
  if (text === null) return null;
  try {
    const o = JSON.parse(text) as Pool;
    if (o?.version !== 1 || typeof o.poolAsOf !== "string" || !DAY.test(o.poolAsOf) || !Array.isArray(o.global) || !Array.isArray(o.india) || o.global.length > 200 || o.india.length > 200) return null;
    if (!o.global.every(isCandidate) || !o.india.every(isCandidate)) return null;
    return { version: 1, poolAsOf: o.poolAsOf, builtAt: String(o.builtAt), global: o.global, india: o.india, held: Array.isArray(o.held) ? o.held.filter((h) => typeof h === "string") : [] };
  } catch {
    return null;
  }
}
function parseScan(text: string | null): ScanState | null {
  if (text === null) return null;
  try {
    const o = JSON.parse(text) as ScanState;
    if (o?.version !== 1 || typeof o.asOf !== "string" || !DAY.test(o.asOf) || !isCount(o.next) || !isCount(o.batches) || !isCount(o.n) || !isCount(o.calls) || !num(o.leaseUntil) || !num(o.startedAt)) return null;
    return { version: 1, asOf: o.asOf, startedAt: o.startedAt, next: o.next, batches: o.batches, n: o.n, calls: o.calls, leaseUntil: o.leaseUntil, ...(o.done ? { done: true } : {}) };
  } catch {
    return null;
  }
}

/** KV as the job uses it: every operation counted against the run's allowance, and a key never written twice within a second (KV refuses that). */
class Store {
  readonly ops: CallBudget;
  private readonly lastPut = new Map<string, number>();
  constructor(private readonly kv: KVNamespace, private readonly clock: () => number, private readonly sleep: (ms: number) => Promise<void>) {
    this.ops = new CallBudget(KV_OPS, "KV operations");
  }
  async get(key: string): Promise<string | null> {
    this.ops.take();
    return this.kv.get(key);
  }
  /** Up to 100 keys in one operation: ONE toward the invocation's limit of 1,000, but billed by the keys it reads (kv/platform/pricing). */
  async getMany(keys: string[]): Promise<Map<string, string | null>> {
    this.ops.take();
    return this.kv.get(keys);
  }
  async put(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.ops.take();
    const wait = (this.lastPut.get(key) ?? -Infinity) + 1100 - this.clock();
    if (wait > 0) await this.sleep(wait);
    await this.kv.put(key, value, { expirationTtl: ttlSeconds });
    this.lastPut.set(key, this.clock());
  }
}

const DENY_MAX = 1000;
/**
 * The owner's deny list: a JSON list of phrases (no key, an empty value or [] is no list). A list that is THERE and cannot be used throws, and the run writes nothing (the last file stays, and
 * the heartbeat says why): the owner who put a phrase in it believes it is out, and a list that quietly denied nothing (a value PowerShell had stripped of its quotes is the usual cause) would
 * leave it in. A KV that cannot be read is the same. The message says what is wrong and what to do, never what the value was.
 */
async function readDeny(store: Store): Promise<string[]> {
  const fix = `the deny list (${TRENDING_KEYS.deny}) cannot be used, so nothing was written and the last file stays: put a JSON list of phrases in it from a file (npx wrangler kv key put ${TRENDING_KEYS.deny} --path deny.json --binding CACHE --remote), or delete the key`;
  let text: string | null;
  try {
    text = await store.get(TRENDING_KEYS.deny);
  } catch {
    throw new Error(`the deny list (${TRENDING_KEYS.deny}) could not be read from KV, so nothing was written and the last file stays`);
  }
  if (text === null || text.trim() === "") return [];
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error(`${fix}: the value is not JSON`);
  }
  if (!Array.isArray(v) || !v.every((x): x is string => typeof x === "string")) throw new Error(`${fix}: the value is not a list of phrases (text)`);
  if (v.length > DENY_MAX) throw new Error(`${fix}: the list has more than ${DENY_MAX} phrases`);
  return v;
}
/** Read once a run, whoever asks first (the weekly pool, the day's file): the same answer, or the same error, for both. */
const denyOf = (ctx: Ctx): Promise<string[]> => (ctx.deny ??= readDeny(ctx.store));

/* ---------------------------------------------------------------- the run */

type Ctx = {
  L: TrendingLimits;
  store: Store;
  budget: CallBudget;
  http: Http;
  oaBase: { mailto: string; apiKey?: string };
  search: TrendingDeps["search"];
  clock: () => number;
  sleep: (ms: number) => Promise<void>;
  asOf: string;
  deadline: number;
  hardStop: number;
  subfields: readonly number[];
  /** The owner's deny list, read on first use (denyOf). */
  deny?: Promise<string[]>;
  lane: boolean;
};

const oaDeps = (ctx: Ctx): OaDeps => ({ http: ctx.http, mailto: ctx.oaBase.mailto, ...(ctx.oaBase.apiKey ? { apiKey: ctx.oaBase.apiKey } : {}), budget: ctx.budget });
const off = (v: unknown): boolean => typeof v === "string" && v.trim().toLowerCase() === "off";
const isMonday = (day: string): boolean => new Date(Date.parse(day)).getUTCDay() === 1;
const cmp = (p: string, q: string): number => (p < q ? -1 : p > q ? 1 : 0);
const bestFirst = (x: Candidate, y: Candidate): number => y.score - x.score || y.a - x.a || cmp(x.phrase, y.phrase);

export async function runTrending(deps: TrendingDeps, scheduledTime: number): Promise<TrendingResult> {
  const clock = deps.clock ?? Date.now;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const started = clock();
  const asOf = isoDay(scheduledTime);
  if (off(deps.variable)) return { skipped: "off", asOf, calls: 0, kvOps: 0, ms: 0 };
  const L: TrendingLimits = { ...TRENDING_LIMITS, ...deps.limits };
  const store = new Store(deps.kv, clock, sleep);
  const budget = new CallBudget(L.runCalls, "calls to OpenAlex, arXiv and the search");
  const ctx: Ctx = {
    L, store, budget, clock, sleep, asOf,
    http: { fetch: deps.fetch, sleep, timeoutMs: L.timeoutMs, retries: L.retries, retryWaitMs: L.retryWaitMs, maxRetryWaitMs: 10_000 },
    oaBase: { mailto: deps.mailto, ...(deps.apiKey ? { apiKey: deps.apiKey } : {}) },
    search: deps.search,
    deadline: started + L.wallMs,
    hardStop: started + L.hardStopMs,
    subfields: deps.subfields ?? QUERYABLE_SUBFIELDS,
    lane: deps.lane !== false,
  };
  const result: TrendingResult = { asOf, calls: 0, kvOps: 0, ms: 0 };
  const errors: unknown[] = [];
  const attempt = async (what: () => Promise<void>): Promise<void> => {
    try {
      await what();
    } catch (e) {
      errors.push(e);
    }
  };

  let pool = parsePool(await store.get(TRENDING_KEYS.pool));
  const usable = (p: Pool | null): p is Pool => p !== null && daysBetween(p.poolAsOf, asOf) <= TRENDING_POOL_MAX_DAYS;

  // the day's file first, from the pool there is: a long scan never keeps it from being made
  if (usable(pool)) await attempt(async () => void (result.daily = await daily(ctx, pool!)));
  else if (pool) result.daily = { published: false, reason: "pool_stale" };

  // then the scan, with the time that is left; a pool made now is used for the file at once only when there was none usable before
  await attempt(async () => {
    const made = await scanStage(ctx, pool, result);
    if (made) {
      pool = made;
      if (result.daily?.published !== true && ctx.deadline - clock() >= L.dailyMs) result.daily = await daily(ctx, made);
    }
  });

  // a pool that has not been renewed by now is not "nothing to report": the scan is not finishing (no time left at night, or it keeps starting again), and in a few days the list goes. Said loudly, once the day's own work is done.
  if (pool && daysBetween(pool.poolAsOf, asOf) >= L.poolLateDays) {
    errors.push(new Error(`the weekly pool is ${daysBetween(pool.poolAsOf, asOf)} days old and no new scan has finished: the list will be hidden when it is ${TRENDING_POOL_MAX_DAYS} days old (the scan's progress is in trending:v1:scan)`));
  }

  result.calls = budget.used;
  result.kvOps = store.ops.used;
  result.ms = clock() - started;
  if (errors.length > 1) console.error(JSON.stringify({ level: "error", msg: "trending_more_errors", n: errors.length - 1 }));
  if (errors.length) throw errors[0];
  return result;
}

/* ---------------------------------------------------------------- the weekly scan, and the pool from it */

class ScanLost extends Error {}

async function scanStage(ctx: Ctx, pool: Pool | null, result: TrendingResult): Promise<Pool | null> {
  const { L, store, budget, clock } = ctx;
  const list = ctx.subfields;
  const batches = Math.ceil(list.length / L.batchSubfields);
  let state = parseScan(await store.get(TRENDING_KEYS.scan));
  // a scan of another list of subfields (a deploy changed the table) or older than a few days is not gone on with
  if (state && (state.n !== list.length || state.batches !== batches || daysBetween(state.asOf, ctx.asOf) > L.scanMaxAgeDays)) state = null;

  let restarted = false;
  for (;;) {
    const inProgress = state !== null && state.done !== true;
    if (!inProgress) {
      const due = pool === null || daysBetween(pool.poolAsOf, ctx.asOf) >= L.poolEveryDays || (isMonday(ctx.asOf) && pool.poolAsOf !== ctx.asOf);
      if (!due || state?.asOf === ctx.asOf) return null; // not this week's, or today's has been made
      const left = batches === 0 ? 0 : Math.min(L.batchSubfields, list.length) * 4;
      if (ctx.deadline - clock() < L.batchMs || budget.left < left) {
        result.scan = { asOf: ctx.asOf, next: 0, batches, completed: false, calls: 0 };
        return null; // no time or no calls for a first batch: the next run begins
      }
      state = { version: 1, asOf: ctx.asOf, startedAt: clock(), next: 0, batches, n: list.length, calls: 0, leaseUntil: 0 };
    } else if (state!.leaseUntil > clock()) {
      result.scan = { asOf: state!.asOf, next: state!.next, batches, completed: false, skipped: "busy", calls: 0 };
      return null; // another run is on it
    }

    const s = state!;
    const callsBefore = budget.used;
    s.leaseUntil = clock() + L.leaseMs;
    await store.put(TRENDING_KEYS.scan, JSON.stringify(s), POOL_TTL_SECONDS);
    let made: Pool | null = null;
    let lost = false;
    try {
      while (s.next < s.batches) {
        const slice = list.slice(s.next * L.batchSubfields, (s.next + 1) * L.batchSubfields);
        const worst = slice.length * 4;
        if (ctx.deadline - clock() < L.batchMs || budget.left < worst) break; // the next run goes on from here
        if (s.calls + worst > L.scanCalls) throw new BudgetError("calls of one weekly scan", L.scanCalls);
        const before = budget.used;
        const batch = await scanBatch(oaDeps(ctx), { day: s.asOf, n: s.batches, subfields: slice, concurrency: L.concurrency, scanHeld: L.scanHeld });
        await store.put(TRENDING_KEYS.batch(s.asOf, s.next), JSON.stringify(batch), BATCH_TTL_SECONDS);
        s.next += 1;
        s.calls += budget.used - before;
        await store.put(TRENDING_KEYS.scan, JSON.stringify(s), POOL_TTL_SECONDS);
      }
      result.scan = { asOf: s.asOf, next: s.next, batches: s.batches, completed: false, calls: budget.used - callsBefore };
      if (s.next >= s.batches && !s.done && ctx.deadline - clock() >= L.finalizeMs) {
        try {
          const finished = await finalize(ctx, s, result);
          made = finished;
          s.done = true;
          result.scan.completed = true;
        } catch (e) {
          if (e instanceof ScanLost) lost = true;
          else {
            if (e instanceof PoolTooSmall) s.done = true; // the same counts would give the same pool: not tried again today
            throw e;
          }
        }
      }
    } finally {
      s.leaseUntil = 0;
      try {
        await store.put(TRENDING_KEYS.scan, JSON.stringify(s), POOL_TTL_SECONDS);
      } catch (e) {
        console.error(JSON.stringify({ level: "error", msg: "trending_scan_state_not_saved", error: e instanceof Error ? e.name : "unknown" })); // never hides the run's own error
      }
    }
    if (result.scan) result.scan.calls = budget.used - callsBefore;
    if (!lost) return made;
    if (restarted) throw new Error("the scan's batches could not be read twice in a row");
    restarted = true; // its batches have gone from KV: it is begun again from today's windows, in this run, if a scan is due
    state = null;
    result.scan = undefined;
  }
}

class PoolTooSmall extends Error {}

/** Reads the scan's batches back (several keys in one KV operation) and gives the ranker all of it. Throws `ScanLost` when one has gone or is not the scan's. */
async function loadBatches(ctx: Ctx, s: ScanState): Promise<BatchFile[]> {
  const keys = Array.from({ length: s.batches }, (_, i) => TRENDING_KEYS.batch(s.asOf, i));
  const out: BatchFile[] = [];
  for (let i = 0; i < keys.length; i += 100) {
    const got = await ctx.store.getMany(keys.slice(i, i + 100));
    for (const key of keys.slice(i, i + 100)) {
      let file: BatchFile | null = null;
      try {
        const text = got.get(key);
        file = text ? isBatchFile(JSON.parse(text), s.asOf, s.batches) : null;
      } catch {
        file = null;
      }
      if (!file) throw new ScanLost();
      out.push(file);
    }
  }
  return out;
}

/**
 * The scan is whole: score it, get the exact count of the best keywords that last year's list did not have, ask the best candidates their journals (and, for everyone, their countries), and keep
 * what passes. A pool smaller than `poolMin` is refused. Writes the pool.
 */
async function finalize(ctx: Ctx, s: ScanState, result: TrendingResult): Promise<Pool> {
  const { L, store } = ctx;
  const files = await loadBatches(ctx, s);
  const inputs: Record<TrendGroup, SubfieldInput[]> = { global: [], in: [] };
  for (const f of files) {
    for (const [id, c] of Object.entries(f.global)) inputs.global.push(expand(Number(id), c));
    for (const [id, c] of Object.entries(f.india)) inputs.in.push(expand(Number(id), c));
  }
  const deny = await denyOf(ctx);
  const everyone = scoreSubfields(inputs.global, "global", { deny });
  const india = scoreSubfields(inputs.in, "in", { deny });
  const w = trendWindows(s.asOf);
  const refine = async (candidates: readonly Candidate[], group: TrendGroup, size: number, evidenceMax: number, exactMax: number): Promise<Candidate[]> => {
    const oa = oaDeps(ctx);
    const country = group === "in" ? ("IN" as const) : undefined;
    const scope = (c: Candidate, window: { from: string; to: string }) => ({ subfield: c.subfield, window, keywordId: c.id, ...(country ? { country } : {}) });
    // the exact count of the most substantial keywords that were not in last year's 200: their score rests on an estimate until then, and an estimated phrase is never shown
    const estimated = candidates.filter((c) => c.bEstimated).sort((x, y) => y.a - x.a || cmp(x.phrase, y.phrase)).slice(0, exactMax);
    const exact = new Map<string, Candidate>();
    await mapLimit(estimated, L.concurrency, async (c) => {
      const n = await exactCount(oa, scope(c, w.b));
      try {
        exact.set(c.phrase, withExactBaseline(c, n));
      } catch {
        /* not a usable count: it stays an estimate, and is not shown */
      }
    });
    const ranked = candidates.map((c) => exact.get(c.phrase) ?? c).filter((c) => !c.bEstimated).sort(bestFirst);
    const kept: Candidate[] = [];
    let checked = 0;
    while (checked < ranked.length && checked < evidenceMax && kept.length < size) {
      const chunk = ranked.slice(checked, checked + Math.min(L.concurrency, evidenceMax - checked));
      const passes = await mapLimit(chunk, L.concurrency, async (c) => {
        const venues = await venuesOf(oa, scope(c, w.a));
        if (journalProblem(venues, c.a) !== null) return false;
        if (group === "in") return true; // for India one country is the point
        return countryProblem(await countriesOf(oa, scope(c, w.a)), c.a) === null;
      });
      chunk.forEach((c, i) => {
        if (passes[i] && kept.length < size) kept.push(c);
      });
      checked += chunk.length;
    }
    return kept;
  };
  const poolGlobal = await refine(everyone.candidates, "global", L.poolGlobal, L.evidenceMaxGlobal, L.exactMaxGlobal);
  if (poolGlobal.length < L.poolMin) throw new PoolTooSmall(`the new pool is too small: ${poolGlobal.length} phrases, at least ${L.poolMin} are needed; the last pool is kept`);
  const poolIndia = await refine(india.candidates, "in", L.poolIndia, L.evidenceMaxIndia, L.exactMaxIndia);
  const held = everyone.held.slice(0, 20).map((c) => c.text);
  const pool: Pool = { version: 1, poolAsOf: s.asOf, builtAt: new Date(ctx.clock()).toISOString(), global: poolGlobal, india: poolIndia, held };
  await store.put(TRENDING_KEYS.pool, JSON.stringify(pool), POOL_TTL_SECONDS);
  if (result.scan) {
    result.scan.held = held;
    result.scan.pool = { global: poolGlobal.length, india: poolIndia.length };
  }
  return pool;
}

/* ---------------------------------------------------------------- the daily file */

/**
 * `selectShown` with a verifier that has to ask a service: the list is chosen again after each answer, and each time exactly one phrase is asked about, the first one the choice needed an answer
 * for. So a phrase is asked about only if it could be on the list, in the order the plain choice would have asked, and the result is what a verifier that answered at once would have given.
 */
async function selectVerified(ranked: readonly Candidate[], previous: readonly string[], ask: (c: Candidate) => Promise<boolean>, maxAsks: number): Promise<{ shown: Candidate[]; asks: number }> {
  const verdicts = new Map<string, boolean>();
  for (;;) {
    const need: { c: Candidate | null } = { c: null };
    const shown = selectShown(ranked, {
      perDomain: PER_DOMAIN,
      previous,
      accept: (c) => {
        const v = verdicts.get(c.phrase);
        if (v === undefined) {
          need.c ??= c;
          return false;
        }
        return v;
      },
    });
    if (need.c === null || verdicts.size >= maxAsks) return { shown, asks: verdicts.size };
    verdicts.set(need.c.phrase, await ask(need.c));
  }
}

async function daily(ctx: Ctx, pool: Pool): Promise<NonNullable<TrendingResult["daily"]>> {
  const { L, store, budget, clock, asOf } = ctx;
  // the owner's deny list holds the day's file too (not only the weekly pool, which may be up to 14 days old): a phrase put there is out of the next run's file; one read, before anything is paid for
  const deny = new Set((await denyOf(ctx)).map(phraseKey).filter((k) => k !== ""));
  const allowed = (list: readonly Candidate[]): Candidate[] => list.filter((c) => !deny.has(c.phrase));
  const candidates = { global: allowed(pool.global), in: allowed(pool.india) };
  const denied = pool.global.length - candidates.global.length + (pool.india.length - candidates.in.length);
  let previous: Record<TrendGroup, string[]> = { global: [], in: [] };
  try {
    const f = parseTrending(JSON.parse((await store.get(TRENDING_KEYS.file)) ?? "null"));
    if (f) previous = { global: f.groups.global.chips.map((c) => c.text), in: f.groups.in.chips.map((c) => c.text) };
  } catch {
    /* no last file that can be read: nothing to keep */
  }
  const sinceYear = Number(asOf.slice(0, 4)) - 1;
  const arxiv: ArxivDeps = { http: ctx.http, mailto: ctx.oaBase.mailto, budget, pace: makePacer(L.arxivGapMs, clock, ctx.sleep), lane: ctx.lane };
  const seconds = new Map<string, SecondSource>();
  const rejected = { confirmation: 0, verification: 0, unchecked: 0, unconfirmed: 0 };
  // a phrase arXiv could not answer is out for tonight (it was not confirmed), and is not asked again tonight for the other list; a few such phrases in a row are an outage (arxivFailures)
  const arxivFailed = new Set<string>();
  let arxivInARow = 0;

  const asker = (group: TrendGroup) => async (c: Candidate): Promise<boolean> => {
    if (clock() > ctx.hardStop) throw new Error("the daily file ran out of time; the last file stays");
    let conf = confirmation(c);
    if (usesSecondSource(c.fieldId)) {
      if (arxivFailed.has(c.phrase)) {
        rejected.unconfirmed++;
        return false;
      }
      if (!seconds.has(c.phrase)) {
        try {
          seconds.set(c.phrase, await arxivCounts(arxiv, c.text, asOf));
          arxivInARow = 0;
        } catch (e) {
          if (!(e instanceof SourceError && e.source === "arxiv")) throw e; // the budget, the hard stop, anything else: the run's
          arxivFailed.add(c.phrase);
          if (++arxivInARow >= L.arxivFailures) throw e; // arXiv is down, not one request: the last file stays
          rejected.unconfirmed++;
          return false;
        }
      }
      conf = confirmation(c, seconds.get(c.phrase));
    }
    if (!conf.ok) {
      rejected.confirmation++;
      return false;
    }
    budget.take(L.searchCost);
    const found = await ctx.search(c.text, group === "in" ? "india" : "all");
    const answered = Object.values(found.providers ?? {}).some((p) => p?.ok === true);
    if (!answered) throw new Error("search: no source answered");
    const ok = verifySummary(summarizeSearch(found.results, sinceYear)).ok;
    if (!ok) {
      rejected.verification++;
      return false;
    }
    // "none retracted in the top 20" counts for nothing when the search's own check did not answer (Crossref 429 or busy): not shown tonight; the next night asks again
    if (!retractionChecked(found)) {
      rejected.unchecked++;
      return false;
    }
    return true;
  };

  const everyone = await selectVerified(candidates.global, previous.global, asker("global"), L.maxAsks);
  const india = await selectVerified(candidates.in, previous.in, asker("in"), L.maxAsks);
  const payload = buildPayload({ now: new Date(clock()), poolAsOf: pool.poolAsOf, global: everyone.shown, india: india.shown }); // throws under 8 phrases: nothing is written
  await store.put(TRENDING_KEYS.file, JSON.stringify(payload), FILE_TTL_SECONDS);
  return { published: true, global: payload.groups.global.chips.map((c) => c.text), india: payload.groups.in.chips.map((c) => c.text), asks: everyone.asks + india.asks, rejected, denied };
}

/* ---------------------------------------------------------------- the Worker's side */

export type TrendingJobEnv = SearchBindings & { TRENDING?: string; ENABLE_DEV_ROUTES?: string; QA_STUB?: string };

/**
 * The environment of the verifier's searches: the product's own (keys, the Semantic Scholar lane), with a cache of its own IN MEMORY, one for the whole run. With the visitors' cache a cold search
 * makes about 90 KV operations of its own (a read or a write for every provider list, every DOI check and every retraction entry: measured with the real search code on stand-in providers, 4 Nov),
 * which the job's own KV allowance does not count and which a Worker invocation may be limited in (the KV page says 1,000 an invocation, the Workers page 10,000 subrequests: they disagree). In
 * memory a search makes none, the job reads fresh answers for every phrase (not yesterday's, not the ones a visitor's search kept), the DOI and retraction answers one search found are used by the
 * next, and the job does not fill the visitors' cache with searches nobody asked for.
 */
export const jobSearchEnv = (env: SearchBindings): SearchEnv => ({ ...searchEnvFrom(env), store: memoryStore() });

/**
 * The job as the scheduled handler runs it (src/index.ts): the Worker's KV, its keys and the product's own search, or, in a local test run (QA_STUB=1 with ENABLE_DEV_ROUTES=1, never in
 * production), the stand-ins of stub.ts. Without KV bound there is nowhere to keep a list: it does nothing, and says so.
 */
export async function runTrendingFromEnv(env: TrendingJobEnv, scheduledTime: number): Promise<TrendingResult> {
  const kv = env.CACHE;
  if (!kv) return { skipped: "no_kv", asOf: isoDay(scheduledTime), calls: 0, kvOps: 0, ms: 0 };
  if (env.ENABLE_DEV_ROUTES === "1" && env.QA_STUB === "1") {
    // no real waiting: a clock of its own that only the pauses move (the KV's pause between two writes of a key, the pause between arXiv requests)
    let now = scheduledTime;
    // a stand-in can be made to fail from outside, for the local end-to-end run (stub.ts, STUB_FAULT_KEY): read here and nowhere else, so the production path below has no such switch
    const stub = makeStubTrending({ asOf: () => isoDay(scheduledTime), fault: parseStubFault(await kv.get(STUB_FAULT_KEY)) });
    return runTrending({ kv, mailto: env.CROSSREF_MAILTO, fetch: stub.fetch, search: stub.search, sleep: async (ms) => void (now += ms), clock: () => now, subfields: STUB_SUBFIELDS, variable: env.TRENDING, lane: false }, scheduledTime);
  }
  const searchEnv = jobSearchEnv(env);
  return runTrending(
    {
      kv,
      mailto: env.CROSSREF_MAILTO,
      apiKey: env.OPENALEX_API_KEY,
      // a wrapper, not `fetch` itself: a Worker's fetch called as a method of another object is an illegal invocation
      fetch: (input, init) => fetch(input, init),
      // what the chat does for a search with a year filter: the same limit, the same merge, the same sources (and a cache in memory: jobSearchEnv)
      search: (q, scope) => runSearch(searchEnv, q, YEAR_FILTER_SEARCH_LIMIT, {}, scope),
      variable: env.TRENDING,
    },
    scheduledTime,
  );
}
