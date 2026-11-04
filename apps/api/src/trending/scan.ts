import { TREND, trendWindows, type KeywordRow, type SubfieldInput, type TrendGroup } from "@scholar/shared/src/trending";
import { policyOf } from "@scholar/shared/src/subfield-policy";
import { keywordCounts, type OaDeps } from "./openalex";
import { mapLimit } from "./sources";

/**
 * The weekly scan (docs/design/chatview-and-trending.md, T3): for every subfield, the keywords of window A and of window B, once for everyone and once for papers with an author at an Indian
 * institution. A scan is about a thousand calls of 1 to 4 seconds, which is more than one run of the daily job should spend, so it is done in batches of a few subfields, and what a batch
 * found is kept in KV (a few KB per subfield) until the scan is whole and the ranker can look at all of it at once (job.ts).
 *
 * What is kept is what the ranker can use and nothing else, and the ranker gives the same answer on it as on the whole answers (scan.test.ts checks that on random data of every shape):
 *   window A: every row (id, name, count): the ranker adds a phrase's papers over all subfields, so a small row counts;
 *   window B: only the rows of keywords that can be candidates (window A count at or over the floor), and the smallest row (the estimate for a keyword missing from last year's 200).
 * A subfield whose window A has fewer papers than a keyword needs to pass the floor cannot have a candidate, and is not asked about window B.
 */
const FLOOR_KEY: Record<TrendGroup, "global" | "in"> = { global: "global", in: "in" };

export type Compact = { ta: number; tb: number; a: [string, string, number][]; b: [string, number][] };
export type BatchFile = { version: 1; day: string; n: number; subfields: number[]; global: Record<string, Compact>; india: Record<string, Compact> };

export function compact(input: SubfieldInput, group: TrendGroup): Compact {
  const floor = TREND.floors[FLOOR_KEY[group]].subfield;
  const candidates = new Set(input.rowsA.filter((r) => r.count >= floor).map((r) => r.id));
  const smallest = input.rowsB.reduce<KeywordRow | null>((m, r) => (m === null || r.count < m.count ? r : m), null);
  const b = input.rowsB.filter((r) => candidates.has(r.id) || r === smallest);
  return { ta: input.totalA, tb: input.totalB, a: input.rowsA.map((r) => [r.id, r.name, r.count]), b: b.map((r) => [r.id, r.count]) };
}

export function expand(subfield: number, c: Compact): SubfieldInput {
  return { subfield, totalA: c.ta, totalB: c.tb, rowsA: c.a.map(([id, name, count]) => ({ id, name, count })), rowsB: c.b.map(([id, count]) => ({ id, name: "", count })) };
}

const isCount = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;
const isCompact = (c: unknown): c is Compact => {
  const o = c as Compact | null;
  return (
    !!o &&
    typeof o === "object" &&
    isCount(o.ta) &&
    isCount(o.tb) &&
    Array.isArray(o.a) &&
    o.a.every((r) => Array.isArray(r) && r.length === 3 && typeof r[0] === "string" && typeof r[1] === "string" && isCount(r[2])) &&
    Array.isArray(o.b) &&
    o.b.every((r) => Array.isArray(r) && r.length === 2 && typeof r[0] === "string" && isCount(r[1]))
  );
};
const isTable = (t: unknown): t is Record<string, Compact> => !!t && typeof t === "object" && !Array.isArray(t) && Object.values(t).every(isCompact);

/** What was read back from KV, as a batch of the scan of `day` that has `n` batches, or null when it is not one. */
export function isBatchFile(raw: unknown, day: string, n: number): BatchFile | null {
  const o = raw as BatchFile | null;
  if (!o || typeof o !== "object" || o.version !== 1 || o.day !== day || o.n !== n) return null;
  if (!Array.isArray(o.subfields) || !o.subfields.every(isCount) || !isTable(o.global) || !isTable(o.india)) return null;
  return o;
}

/** The groups a subfield is asked about: everyone (a held subfield only when its candidates are to be logged), and India for an allowed subfield (a held one is never shown, so it is not paid for). */
function groupsOf(subfield: number, scanHeld: boolean): TrendGroup[] {
  const policy = policyOf(subfield);
  if (policy === "never") return [];
  if (policy === "allow") return ["global", "in"];
  return scanHeld ? ["global"] : [];
}

/** One batch: `subfields` (at most a few), both windows, both groups. Fails on the first source error (nothing is skipped quietly). */
export async function scanBatch(oa: OaDeps, opts: { day: string; n: number; subfields: readonly number[]; concurrency: number; scanHeld: boolean }): Promise<BatchFile> {
  const w = trendWindows(opts.day);
  const out: BatchFile = { version: 1, day: opts.day, n: opts.n, subfields: [...opts.subfields], global: {}, india: {} };
  await mapLimit(opts.subfields, opts.concurrency, async (subfield) => {
    for (const group of groupsOf(subfield, opts.scanHeld)) {
      const country = group === "in" ? ("IN" as const) : undefined;
      const a = await keywordCounts(oa, { subfield, window: w.a, ...(country ? { country } : {}) });
      if (a.total < TREND.floors[FLOOR_KEY[group]].subfield) continue; // no keyword of it can reach the floor
      const b = await keywordCounts(oa, { subfield, window: w.b, ...(country ? { country } : {}) });
      (group === "in" ? out.india : out.global)[String(subfield)] = compact({ subfield, totalA: a.total, totalB: b.total, rowsA: a.rows, rowsB: b.rows }, group);
    }
  });
  return out;
}
