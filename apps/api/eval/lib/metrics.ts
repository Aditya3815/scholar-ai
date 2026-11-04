// The statistics the intent eval reads its gates with (plan docs/design/intent-and-state.md, 8.3 and 8.5). Pure, deterministic, no dependency, no network.
// Reading rules (8.5, line 784): every gate states its n and is reported with an interval; a rate gate needs n >= n_min or it is `insufficient_n`, never a pass;
// a paired gate is one-sided; only the owner loosens a number. Tested by eval/metrics.eval.ts.

/* ---------- special functions (Lanczos, Lentz continued fractions, bisection): accurate to about 1e-13 ---------- */

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/** Natural log of the gamma function. */
export function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  const z = x - 1;
  let a = LANCZOS[0];
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

const TINY = 1e-300;
const EPS = 1e-15;

function betacf(x: number, a: number, b: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200_000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) return h;
  }
  throw new Error("betaInc did not converge for a = " + a + ", b = " + b);
}

/** The regularised incomplete beta function I_x(a, b). */
export function betaInc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(x, a, b)) / a;
  return 1 - (bt * betacf(1 - x, b, a)) / b;
}

/** erfc for x >= 0 through the incomplete gamma function with a = 1/2 (series below, continued fraction above). */
function erfcPositive(x: number): number {
  if (x === 0) return 1;
  const a = 0.5;
  const g = x * x;
  const front = Math.exp(-g + a * Math.log(g) - lgamma(a));
  if (g < a + 1) {
    let term = 1 / a;
    let sum = term;
    for (let n = 1; n < 1000; n++) {
      term *= g / (a + n);
      sum += term;
      if (term < sum * EPS) break;
    }
    return 1 - sum * front;
  }
  let b = g + 1 - a;
  let c = 1 / TINY;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return front * h;
}

function normalCdf(z: number): number {
  const x = -z / Math.SQRT2;
  return 0.5 * (x >= 0 ? erfcPositive(x) : 2 - erfcPositive(-x));
}

/** The standard normal quantile, by bisection on the cdf (deterministic, about 1e-15). p must be in (1e-9, 1 - 1e-9). */
export function normalQuantile(p: number): number {
  if (!(p > 1e-9 && p < 1 - 1e-9)) throw new RangeError("normalQuantile needs 1e-9 < p < 1 - 1e-9, got " + p);
  if (p === 0.5) return 0;
  let lo = -10;
  let hi = 10;
  for (let i = 0; i < 200 && hi - lo > 1e-15; i++) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/* ---------- exact binomial ---------- */

function checkN(n: number): void {
  if (!Number.isInteger(n) || n < 0) throw new RangeError("n must be a whole number, 0 or more; got " + n);
}
function checkCounts(k: number, n: number): void {
  checkN(n);
  if (!Number.isInteger(k) || k < 0 || k > n) throw new RangeError("k must be a whole number from 0 to n; got k = " + k + ", n = " + n);
}
function checkP(p: number): void {
  if (!(p >= 0 && p <= 1)) throw new RangeError("p must be from 0 to 1; got " + p);
}
function checkLevel(level: number): void {
  if (!(level > 0 && level < 1)) throw new RangeError("level must be between 0 and 1; got " + level);
}

/** Up to this n the tails are summed term by term (easy to audit); above it the incomplete beta function does the same in a fixed number of steps. */
const DIRECT_MAX_N = 1000;

function logPmf(i: number, n: number, p: number): number {
  return lgamma(n + 1) - lgamma(i + 1) - lgamma(n - i + 1) + i * Math.log(p) + (n - i) * Math.log1p(-p);
}

/** P(X = k) for X ~ Binomial(n, p). */
export function binomPmf(k: number, n: number, p: number): number {
  checkN(n);
  checkP(p);
  if (!Number.isInteger(k)) throw new RangeError("k must be a whole number; got " + k);
  if (k < 0 || k > n) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(logPmf(k, n, p));
}

/** P(X <= k) for X ~ Binomial(n, p). */
export function binomCdf(k: number, n: number, p: number): number {
  checkN(n);
  checkP(p);
  if (!Number.isInteger(k)) throw new RangeError("k must be a whole number; got " + k);
  if (k < 0) return 0;
  if (k >= n) return 1;
  if (p === 0) return 1;
  if (p === 1) return 0;
  if (n > DIRECT_MAX_N) return betaInc(1 - p, n - k, k + 1);
  let s = 0;
  for (let i = 0; i <= k; i++) s += Math.exp(logPmf(i, n, p));
  return Math.min(1, s);
}

/** P(X >= k) for X ~ Binomial(n, p): the upper tail, which is what a sign test and a lower confidence limit read. */
export function binomTail(k: number, n: number, p: number): number {
  checkN(n);
  checkP(p);
  if (!Number.isInteger(k)) throw new RangeError("k must be a whole number; got " + k);
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p === 0) return 0;
  if (p === 1) return 1;
  if (n > DIRECT_MAX_N) return betaInc(p, k, n - k + 1);
  let s = 0;
  for (let i = k; i <= n; i++) s += Math.exp(logPmf(i, n, p));
  return Math.min(1, s);
}

/**
 * The one-sided exact sign test of "no worse than baseline": among the cases that changed, `worse` got worse and `better` got better; the p-value is the chance
 * of at least that many worse under "worse and better are equally likely". Plan 8.5: 6 worse and 0 better is 1/64 = 0.016, 6 and 1 is 8/128 = 0.063, 5 and 1 is 7/64 = 0.109.
 * Cases that did not change are not an argument.
 */
export function signTestOneSided(worse: number, better: number): number {
  checkN(worse);
  checkN(better);
  return binomTail(worse, worse + better, 0.5);
}

/* ---------- intervals ---------- */

/** The p where f(p) crosses `target`, for f monotone on [0, 1]; to a relative 1e-13. */
function solve(f: (p: number) => number, target: number, increasing: boolean): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 300 && hi - lo > 1e-13 * hi; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < target === increasing) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The exact (Clopper-Pearson) one-sided upper limit with `alpha` in the tail. */
function upperTail(k: number, n: number, alpha: number): number {
  if (n === 0 || k === n) return 1;
  if (k === 0) return -Math.expm1(Math.log(alpha) / n); // 1 - alpha^(1/n): the rule of three, exactly
  return solve((p) => binomCdf(k, n, p), alpha, false);
}

function lowerTail(k: number, n: number, alpha: number): number {
  if (n === 0 || k === 0) return 0;
  if (k === n) return Math.exp(Math.log(alpha) / n);
  return solve((p) => binomTail(k, n, p), alpha, true);
}

/** One-sided exact upper confidence limit for a rate of k in n (level 0.95: "at most this, with 95% confidence"). Zero errors in n gives about 3/n. */
export function upperBound(k: number, n: number, level = 0.95): number {
  checkCounts(k, n);
  checkLevel(level);
  return upperTail(k, n, 1 - level);
}
export function lowerBound(k: number, n: number, level = 0.95): number {
  checkCounts(k, n);
  checkLevel(level);
  return lowerTail(k, n, 1 - level);
}
/**
 * The bound the plan's statistics line reads ("0 of 100 shows at most about 3%, 0 of 250 about 1.2%, 0 of 300 about 1%"): one-sided, exact, 95%.
 * For 0 events it equals those figures (the rule of three, 3/n, rounded). For 2 and 3 of 100 it is 6.2% and 7.6%, while the plan says "about 7%" and "about 8%": those two
 * match the top of a TWO-sided 95% interval (Clopper-Pearson 7.0% and 8.5%, Wilson 7.0% and 8.5%), which is looser, so they are safe to quote but they are not this number.
 * No single interval reproduces all five of the plan's figures; this function does not bend to match them.
 */
export const upper95 = (k: number, n: number): number => upperBound(k, n, 0.95);
export const lower95 = (k: number, n: number): number => lowerBound(k, n, 0.95);

export interface Bounds {
  low: number;
  high: number;
}

/** The exact two-sided Clopper-Pearson interval (never narrower than the level says; the one to report for a rate). */
export function clopperPearson(k: number, n: number, level = 0.95): Bounds {
  checkCounts(k, n);
  checkLevel(level);
  const tail = (1 - level) / 2;
  return { low: lowerTail(k, n, tail), high: upperTail(k, n, tail) };
}

/** The Wilson score interval (two-sided). It is shorter than Clopper-Pearson and sits inside it; reported beside it, not instead of it. */
export function wilson(k: number, n: number, level = 0.95): Bounds {
  checkCounts(k, n);
  checkLevel(level);
  if (n === 0) return { low: 0, high: 1 };
  const z = normalQuantile(1 - (1 - level) / 2);
  const z2 = z * z;
  const ph = k / n;
  const denom = 1 + z2 / n;
  const centre = (ph + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((ph * (1 - ph)) / n + z2 / (4 * n * n))) / denom;
  return { low: k === 0 ? 0 : Math.max(0, centre - half), high: k === n ? 1 : Math.min(1, centre + half) };
}

/* ---------- agreement and ranking ---------- */

export interface Kappa {
  /** null when chance agreement is total (both raters used one label only) or there is nothing to compare: kappa is then 0 / 0, not a number. */
  kappa: number | null;
  agreement: number | null;
  expected: number | null;
  n: number;
}

/** Cohen's kappa for two raters of the same items (plan 8.3 L3: kappa at least 0.6 on R, M, I, else the labels are not a gate). */
export function cohensKappa(a: readonly string[], b: readonly string[]): Kappa {
  if (a.length !== b.length) throw new RangeError("two raters must rate the same items; got " + a.length + " and " + b.length);
  const n = a.length;
  if (n === 0) return { kappa: null, agreement: null, expected: null, n };
  const countA = new Map<string, number>();
  const countB = new Map<string, number>();
  let same = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) same++;
    countA.set(a[i], (countA.get(a[i]) ?? 0) + 1);
    countB.set(b[i], (countB.get(b[i]) ?? 0) + 1);
  }
  let expected = 0;
  for (const [label, ca] of countA) expected += (ca / n) * ((countB.get(label) ?? 0) / n);
  const agreement = same / n;
  return { kappa: expected >= 1 ? null : (agreement - expected) / (1 - expected), agreement, expected, n };
}

/** Precision at k: relevant in the first k, over k (a list shorter than k counts its missing places as not relevant, so a short list is not rewarded). */
export function precisionAtK(relevant: readonly boolean[], k: number): number {
  if (!Number.isInteger(k) || k < 1) throw new RangeError("k must be a whole number, 1 or more; got " + k);
  let hits = 0;
  for (let i = 0; i < Math.min(k, relevant.length); i++) if (relevant[i]) hits++;
  return hits / k;
}

/** Overlap at k of two ranked lists of ids: how many of the first k are in both (a repeated id once), over k. The plan's "oracle overlap at 20" (8.3 L2). */
export function overlapAtK(a: readonly string[], b: readonly string[], k: number): number {
  if (!Number.isInteger(k) || k < 1) throw new RangeError("k must be a whole number, 1 or more; got " + k);
  const top = new Set(a.slice(0, k));
  const other = new Set(b.slice(0, k));
  let shared = 0;
  for (const id of top) if (other.has(id)) shared++;
  return shared / k;
}

/* ---------- seeded randomness and the clustered bootstrap ---------- */

/** mulberry32: a small seeded generator of numbers in [0, 1). The same seed gives the same stream on every machine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The q-quantile by linear interpolation between the closest ranks, of a sorted copy. */
export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) throw new RangeError("quantile of an empty list");
  if (!(q >= 0 && q <= 1)) throw new RangeError("q must be from 0 to 1; got " + q);
  const s = [...values].sort((x, y) => x - y);
  const pos = q * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export interface ClusterItem {
  /** The conversation or case the value belongs to: values of one cluster move together, so a whole cluster is drawn or left out. */
  cluster: string | number;
  value: number;
}
export interface BootstrapOptions {
  reps?: number;
  seed?: number;
  level?: number;
  /** Computed on the pooled values of the drawn clusters; the mean by default (a rate is the mean of 0 and 1 values). */
  statistic?: (values: number[]) => number;
}
export interface BootstrapResult {
  estimate: number | null;
  low: number | null;
  high: number | null;
  level: number;
  reps: number;
  seed: number;
  clusters: number;
  n: number;
}

const mean = (v: number[]): number => {
  let s = 0;
  for (const x of v) s += x;
  return s / v.length;
};

/**
 * A percentile bootstrap interval that draws whole clusters with replacement (plan 8.5: "a bootstrap interval clustered by conversation or case").
 * Same seed, same result; clusters are drawn in key order, so the order of the items in the input does not matter. An empty input has no interval (null).
 */
export function clusteredBootstrap(items: readonly ClusterItem[], opts: BootstrapOptions = {}): BootstrapResult {
  const { reps = 2000, seed = 1, level = 0.95, statistic = mean } = opts;
  if (!Number.isInteger(reps) || reps < 1) throw new RangeError("reps must be a whole number, 1 or more; got " + reps);
  checkLevel(level);
  const byCluster = new Map<string, number[]>();
  for (const it of items) {
    if (!Number.isFinite(it.value)) throw new RangeError("a bootstrap value must be a finite number");
    const key = String(it.cluster);
    const list = byCluster.get(key);
    if (list) list.push(it.value);
    else byCluster.set(key, [it.value]);
  }
  const keys = [...byCluster.keys()].sort();
  const groups = keys.map((k) => byCluster.get(k) as number[]);
  const base = { level, reps, seed, clusters: groups.length, n: items.length };
  if (groups.length === 0) return { estimate: null, low: null, high: null, ...base };
  const estimate = statistic(groups.flat());
  const rng = mulberry32(seed);
  const stats = new Array<number>(reps);
  for (let r = 0; r < reps; r++) {
    const pooled: number[] = [];
    for (let g = 0; g < groups.length; g++) {
      const drawn = groups[Math.floor(rng() * groups.length)];
      for (let i = 0; i < drawn.length; i++) pooled.push(drawn[i]);
    }
    stats[r] = statistic(pooled);
  }
  const tail = (1 - level) / 2;
  return { estimate, low: quantile(stats, tail), high: quantile(stats, 1 - tail), ...base };
}

/* ---------- gates ---------- */

export type GateKind = "rate_max" | "rate_min" | "paired_no_worse" | "count_equals" | "floor" | "tests_pass" | "report_only";
export type GateStatus = "pass" | "fail" | "insufficient_n" | "report_only" | "needs_owner";

/** One entry of docs/eval/intent-gates.json. */
export interface Gate {
  id: string;
  release: string;
  also_releases?: string[];
  metric: string;
  kind: GateKind;
  /** rate_*: the rate (0 to 1). paired_no_worse: the most cases that may get worse. count_equals: the count. floor: the limit (or the margin, with `relative_to`). null where the plan gives no number. */
  threshold: number | null;
  n_min: number | null;
  n_min_reason?: string;
  /** floor only: at_least (>=), at_most (<=) or under (<). */
  direction?: "at_least" | "at_most" | "under";
  /** floor only: the limit is this measured reference plus `threshold`; the observation brings `reference`. */
  relative_to?: string;
  baseline: string | null;
  source: number;
  status: "proposed" | "needs_owner";
  note: string;
}

export interface Interval {
  low: number;
  high: number;
  level: number;
  method: string;
}

/** What a run measured. rate_*: k of n. paired_no_worse: worse and better among n pairs. count_equals: count (and n). floor: value (and n, reference). tests_pass: passed and failed. */
export interface Observed {
  k?: number;
  n?: number;
  worse?: number;
  better?: number;
  count?: number;
  value?: number;
  reference?: number;
  passed?: number;
  failed?: number;
  /** An interval computed elsewhere (a clustered bootstrap) replaces the exact one. */
  interval?: Interval;
}

export interface GateResult {
  status: GateStatus;
  value: number | null;
  n: number | null;
  interval: Interval | null;
  /** The one-sided 95% bound the plan reads: the upper one for a maximum, the lower one for a minimum. */
  bound?: { side: "upper" | "lower"; level: number; value: number };
  /** paired_no_worse: the one-sided exact sign-test p-value. */
  p?: number;
  reason: string;
}

const KINDS: readonly GateKind[] = ["rate_max", "rate_min", "paired_no_worse", "count_equals", "floor", "tests_pass", "report_only"];

function need(obs: Observed, key: keyof Observed, kind: string): number {
  const v = obs[key];
  if (v === undefined) throw new TypeError("evaluateGate: observed." + key + " is required for a " + kind + " gate");
  if (typeof v !== "number") throw new TypeError("evaluateGate: observed." + key + " must be a number");
  return v;
}
function whole(name: string, v: number): number {
  if (!Number.isInteger(v) || v < 0) throw new RangeError("evaluateGate: " + name + " must be a whole number, 0 or more; got " + v);
  return v;
}
const exactInterval = (k: number, n: number): Interval => ({ ...clopperPearson(k, n), level: 0.95, method: "clopper-pearson" });

interface Measured {
  value: number | null;
  n: number | null;
  interval: Interval | null;
  bound?: GateResult["bound"];
  p?: number;
  /** true: meets the gate; null: the gate has no rule to apply (report_only). */
  meets: boolean;
  /** The smallest n this reading needs even when the gate states no n_min. */
  nFloor: number;
}

/** Whether k of n is at most (or at least) a rate: compared as counts, so 36 of 40 meets 0.9 and 7 of 100 meets 0.07 whatever the float product gives. */
function countsMeet(k: number, n: number, rate: number, atMost: boolean): boolean {
  const slack = 1e-9 + 1e-12 * n;
  return atMost ? k <= rate * n + slack : k >= rate * n - slack;
}

function measure(gate: Gate, obs: Observed): Measured {
  switch (gate.kind) {
    case "rate_max":
    case "rate_min": {
      const k = whole("k", need(obs, "k", gate.kind));
      const n = whole("n", need(obs, "n", gate.kind));
      if (k > n) throw new RangeError("evaluateGate: k (" + k + ") is more than n (" + n + ")");
      const atMost = gate.kind === "rate_max";
      return {
        value: n === 0 ? null : k / n,
        n,
        interval: obs.interval ?? exactInterval(k, n),
        bound: { side: atMost ? "upper" : "lower", level: 0.95, value: atMost ? upper95(k, n) : lower95(k, n) },
        meets: gate.threshold != null && n > 0 && countsMeet(k, n, gate.threshold, atMost),
        nFloor: 1,
      };
    }
    case "paired_no_worse": {
      const worse = whole("worse", need(obs, "worse", gate.kind));
      const better = whole("better", need(obs, "better", gate.kind));
      const n = whole("n", need(obs, "n", gate.kind));
      if (worse + better > n) throw new RangeError("evaluateGate: worse + better (" + (worse + better) + ") is more than the " + n + " pairs");
      return {
        value: worse,
        n,
        interval: obs.interval ?? (n === 0 ? null : exactInterval(worse, n)),
        bound: { side: "upper", level: 0.95, value: upper95(worse, n) },
        p: signTestOneSided(worse, better),
        meets: gate.threshold != null && worse <= gate.threshold,
        nFloor: 1,
      };
    }
    case "count_equals": {
      const count = whole("count", need(obs, "count", gate.kind));
      const n = obs.n === undefined ? null : whole("n", obs.n);
      return { value: count, n, interval: obs.interval ?? null, meets: gate.threshold != null && count === gate.threshold, nFloor: 0 };
    }
    case "floor": {
      if (gate.direction === undefined) throw new TypeError("evaluateGate: floor gate " + gate.id + " has no direction");
      const value = need(obs, "value", gate.kind);
      if (!Number.isFinite(value)) throw new RangeError("evaluateGate: observed.value must be a finite number");
      const n = obs.n === undefined ? null : whole("n", obs.n);
      let limit: number | null = gate.threshold ?? null;
      if (gate.relative_to !== undefined) {
        const reference = need(obs, "reference", gate.kind);
        if (!Number.isFinite(reference)) throw new RangeError("evaluateGate: observed.reference must be a finite number");
        limit = limit === null ? null : reference + limit;
      }
      const meets = limit !== null && (gate.direction === "at_least" ? value >= limit : gate.direction === "at_most" ? value <= limit : value < limit);
      return { value, n, interval: obs.interval ?? null, meets, nFloor: 0 };
    }
    case "tests_pass": {
      const passed = whole("passed", need(obs, "passed", gate.kind));
      const failed = whole("failed", need(obs, "failed", gate.kind));
      const n = passed + failed;
      return { value: n === 0 ? null : passed / n, n, interval: null, meets: failed === 0, nFloor: 1 };
    }
    case "report_only": {
      if (obs.k !== undefined && obs.n !== undefined) {
        const k = whole("k", obs.k);
        const n = whole("n", obs.n);
        if (k > n) throw new RangeError("evaluateGate: k (" + k + ") is more than n (" + n + ")");
        return { value: n === 0 ? null : k / n, n, interval: obs.interval ?? exactInterval(k, n), meets: true, nFloor: 0 };
      }
      return { value: obs.value ?? null, n: obs.n === undefined ? null : whole("n", obs.n), interval: obs.interval ?? null, meets: true, nFloor: 0 };
    }
  }
}

/**
 * Read one run against one gate (plan 8.5 reading rules). Order of the verdicts:
 *   report_only            always, with value, n and interval; a target that the plan calls "not a gate" never fails
 *   needs_owner            the gate says so, or has no threshold, or is a rate with no stated n: nothing can pass until the owner settles it, in writing
 *   insufficient_n         fewer cases than n_min (or than one): an underpowered set decides nothing in either direction, so it beats fail for a rate, a paired or a floor gate.
 *                          A tests_pass gate is the exception: a failed test is a fail at any n, so a visible failure is never hidden behind "not enough tests"
 *   pass or fail           rate gates compare the observed rate with the threshold (the interval and the one-sided bound are reported, not used to pass);
 *                          paired gates compare the count of cases that got worse; floors compare as the plan words them
 * A threshold, n_min or status that is missing (not only null) counts as not given: a hand-edited gate with a key removed is needs_owner, never lenient; a gate with no valid status throws.
 * Throws on an observation that cannot be counts (k > n, a fraction where a whole number belongs) or on a malformed gate.
 */
export function evaluateGate(gate: Gate, observed: Observed): GateResult {
  if (!KINDS.includes(gate.kind)) throw new TypeError("evaluateGate: unknown kind " + String(gate.kind));
  if (gate.status !== "proposed" && gate.status !== "needs_owner") throw new TypeError("evaluateGate: gate " + gate.id + " has no valid status (proposed or needs_owner), got " + String(gate.status));
  const m = measure(gate, observed);
  const out = (status: GateStatus, reason: string): GateResult => {
    const r: GateResult = { status, value: m.value, n: m.n, interval: m.interval, reason };
    if (m.bound) r.bound = m.bound;
    if (m.p !== undefined) r.p = m.p;
    return r;
  };
  if (gate.kind === "report_only") {
    const short = gate.n_min != null && m.n !== null && m.n < gate.n_min;
    return out("report_only", short ? "reported, not a gate; n = " + m.n + " is below the " + gate.n_min + " the read needs, so it is not evidence yet" : "reported, not a gate");
  }
  if (gate.status === "needs_owner") return out("needs_owner", "the owner has to settle this gate (see its note)");
  if (gate.threshold == null && gate.kind !== "tests_pass") return out("needs_owner", "the plan gives no number for this gate");
  if (gate.n_min == null && (gate.kind === "rate_max" || gate.kind === "rate_min" || gate.kind === "paired_no_worse")) {
    return out("needs_owner", "the plan states no n for this rate, so no number of cases can be enough");
  }
  // A test that failed is a failure whatever n_min says: only a statistic needs enough cases to decide anything.
  if (gate.kind === "tests_pass" && !m.meets) return out("fail", "a test failed");
  const needed = Math.max(gate.n_min ?? 0, m.nFloor);
  if (needed > 0 && (m.n === null || m.n < needed)) return out("insufficient_n", "n = " + (m.n ?? "unknown") + " is below the " + needed + " the gate needs");
  return m.meets ? out("pass", "meets the gate") : out("fail", "does not meet the gate");
}
