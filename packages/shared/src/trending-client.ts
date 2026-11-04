/**
 * The browser's half of the Trending feed (docs/design/chatview-and-trending.md, T3, T4, T7, T12): what the server publishes, a strict reader for it, the freshness rule and the pick of
 * today's chips. Kept to what the page needs and nothing else, because everything here is in the first-load script: the ranking, the filters and the policy table are in `trending.ts`
 * and `subfield-policy.ts`, which the page never imports.
 *
 * The page asks only our own API for this (never OpenAlex or arXiv: a request from the browser would tell them who is reading, and the page's security policy forbids it).
 */

export const TRENDING_VERSION = 1;
/** The list the server publishes, and the pool a day's chips are picked from: the top 12 of each group. */
export const TRENDING_MAX_CHIPS = 12;
/** A chip is a search phrase that goes into the box: 3 to 36 characters, tidy (see `parseTrending`). */
export const TRENDING_CHIP_MIN = 3;
export const TRENDING_CHIP_MAX = 36;
/** A list whose weekly pool is older than this is not shown, however new the daily file is. */
export const TRENDING_POOL_MAX_DAYS = 14;

/**
 * One chip: the exact display name of an OpenAlex keyword (never written or reworded by a model), the year its search starts from ("From 2025 on"), the two counts behind it (journal
 * papers in the 91 days that end 45 days ago, and in the same dates a year earlier: shown in the Why panel) and the OpenAlex field it was found in.
 */
export type TrendingChip = { text: string; sinceYear: number; a: number; b: number; field: string };
export type TrendingGroupName = "global" | "in";

/**
 * The one public file, the same for everyone. `asOf` is the day it was made for (the seed of the day's pick), `generatedAt` and `validUntil` (generated plus 48 hours) are timestamps in
 * UTC, `poolAsOf` is the day the weekly pool was computed from OpenAlex, and `disabled` is the kill switch. `groups.in` is the list for papers with an author at an Indian institution.
 */
export type TrendingPayload = {
  version: 1;
  asOf: string;
  generatedAt: string;
  validUntil: string;
  poolAsOf: string;
  disabled: boolean;
  groups: Record<TrendingGroupName, { chips: TrendingChip[] }>;
};

const DAY = 864e5;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** A date or a UTC time as the server writes it, and a real one (a parser would roll "02-31" over into March). */
const isoOk = (s: unknown, shape: RegExp): s is string => typeof s === "string" && shape.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s.slice(0, 10);
/** Text that is already tidy: one line, single spaces, nothing at either end, no control or invisible character. What is shown is what is checked. */
const tidy = (v: unknown, min: number, max: number): v is string => typeof v === "string" && v.length >= min && v.length <= max && v === v.replace(/\s+/g, " ").trim() && !/[\p{Cc}\p{Cf}]/u.test(v);
const whole = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

function readChips(raw: unknown): TrendingChip[] | null {
  if (!Array.isArray(raw) || raw.length > TRENDING_MAX_CHIPS) return null;
  const out: TrendingChip[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] as Record<string, unknown> | null | undefined;
    if (!c || typeof c !== "object") return null;
    const { text, sinceYear, a, b, field } = c;
    if (!tidy(text, TRENDING_CHIP_MIN, TRENDING_CHIP_MAX) || !whole(sinceYear, 2000, 2100) || !whole(a, 0, 1e9) || !whole(b, 0, 1e9) || !tidy(field, 1, 60)) return null;
    const key = text.toLowerCase();
    if (seen.has(key)) return null;
    seen.add(key);
    out.push({ text, sinceYear, a, b, field });
  }
  return out;
}

/**
 * The file as the page may trust it, or null. Never throws. Anything off (another version, a date that is not a date, one bad chip, more than 12 chips, text that is not tidy, a getter that
 * throws) makes the whole file null: nothing half-trusted is shown. What comes back is a new object that holds only the fields of the contract.
 */
export function parseTrending(raw: unknown): TrendingPayload | null {
  try {
    const o = raw as Record<string, any> | null;
    if (!o || typeof o !== "object" || o.version !== TRENDING_VERSION || typeof o.disabled !== "boolean") return null;
    const { asOf, poolAsOf, generatedAt, validUntil, groups } = o;
    if (!isoOk(asOf, DATE) || !isoOk(poolAsOf, DATE) || !isoOk(generatedAt, TIME) || !isoOk(validUntil, TIME) || !groups || typeof groups !== "object") return null;
    const global = readChips(groups.global?.chips);
    const inn = readChips(groups.in?.chips);
    if (!global || !inn) return null;
    return { version: 1, asOf, generatedAt, validUntil, poolAsOf, disabled: o.disabled, groups: { global: { chips: global }, in: { chips: inn } } };
  } catch {
    return null;
  }
}

/**
 * Whether the page may call this list "Trending": not switched off, before `validUntil`, and a weekly pool no more than 14 days old. About time only: a fresh file with no chips is fresh.
 * A broken clock or a broken payload is not fresh. Never throws.
 */
export function isFresh(p: Pick<TrendingPayload, "validUntil" | "poolAsOf" | "disabled">, now: number | Date): boolean {
  try {
    const t = +now;
    return p.disabled === false && t < Date.parse(p.validUntil) && t - Date.parse(p.poolAsOf) <= TRENDING_POOL_MAX_DAYS * DAY;
  } catch {
    return false;
  }
}

/** A small fixed number from a text (FNV-1a), the same in every browser. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Today's chips: `n` of the top 12, chosen by the date alone, so the row is the same all day and for everyone, never reshuffles while someone types, and needs no clock or timer. The pool is
 * put in a fixed order (by a hash of each chip's text) and a window of `n` moves along it by `n` places a day: every chip is shown equally often, and the chips of one day are never the
 * chips of the day before. With no more chips than `n`, or a date that is not a date, the top chips by rank are returned. Never throws, never changes its input.
 */
export function pickChips<T extends { text: string }>(chips: readonly T[], asOf: string, n: number): T[] {
  const pool = chips.slice(0, TRENDING_MAX_CHIPS);
  const k = Math.min(Math.max(Math.trunc(n) || 0, 0), pool.length);
  const day = Math.floor(Date.parse(asOf) / DAY);
  if (!k || k === pool.length || !Number.isFinite(day)) return pool.slice(0, k);
  const order = pool.map((c, i) => [hash(c.text), i] as const).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const from = (((day * k) % pool.length) + pool.length) % pool.length;
  return Array.from({ length: k }, (_, j) => pool[order[(from + j) % pool.length]![1]]!);
}
