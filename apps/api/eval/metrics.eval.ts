// The statistics the intent eval reads its gates with (eval/lib/metrics.ts): pure, offline, deterministic.
// Known values come from the plan's own figures (docs/design/intent-and-state.md 8.5, line 784) and from standard tables (Clopper-Pearson and Wilson for 5 of 10, 2 and 3 of 100),
// and the intervals are also checked against their own definition with the exact binomial sum, so a wrong inverse cannot hide behind a wrong table.
import { describe, expect, it } from "vitest";
import {
  binomCdf,
  binomPmf,
  binomTail,
  betaInc,
  clopperPearson,
  clusteredBootstrap,
  cohensKappa,
  evaluateGate,
  lgamma,
  lower95,
  mulberry32,
  normalQuantile,
  overlapAtK,
  precisionAtK,
  quantile,
  signTestOneSided,
  upper95,
  wilson,
  type Gate,
} from "./lib/metrics";

const close = (a: number, b: number, tol: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
const relClose = (a: number, b: number, rel: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.abs(b));

/** An exact reference that shares no code with metrics.ts: the p = 1/2 tail as a BigInt count over 2^n. */
function halfTail(k: number, n: number): number {
  let num = 0n;
  let c = 1n; // C(n, 0)
  for (let i = 0; i <= n; i++) {
    if (i >= k) num += c;
    c = (c * BigInt(n - i)) / BigInt(i + 1);
  }
  return Number(num) / 2 ** n;
}

describe("special functions", () => {
  it("lgamma matches known values", () => {
    close(lgamma(1), 0, 1e-13);
    close(lgamma(2), 0, 1e-13);
    close(lgamma(0.5), 0.5723649429247001, 1e-13); // ln(sqrt(pi))
    close(lgamma(10), 12.801827480081469, 1e-12); // ln(9!)
    close(lgamma(100), 359.1342053695754, 1e-10); // ln(99!)
  });

  it("betaInc matches closed forms", () => {
    close(betaInc(0.3, 1, 1), 0.3, 1e-14);
    close(betaInc(0.5, 2, 2), 0.5, 1e-14);
    close(betaInc(0.3, 2, 3), 0.3483, 1e-14); // 6(.3^2)(.7^2) + 4(.3^3)(.7) + .3^4
    expect(betaInc(0, 2, 3)).toBe(0);
    expect(betaInc(1, 2, 3)).toBe(1);
  });

  it("normalQuantile matches the standard values", () => {
    close(normalQuantile(0.5), 0, 1e-12);
    close(normalQuantile(0.975), 1.959963984540054, 1e-9);
    close(normalQuantile(0.95), 1.6448536269514722, 1e-9);
    close(normalQuantile(0.995), 2.5758293035489004, 1e-9);
    close(normalQuantile(0.025), -1.959963984540054, 1e-9);
  });
});

describe("exact binomial", () => {
  it("equals the BigInt count over 2^n for p = 1/2, every k, n up to 40", () => {
    for (let n = 0; n <= 40; n++) {
      for (let k = 0; k <= n; k++) relClose(binomTail(k, n, 0.5), halfTail(k, n), 1e-12);
    }
  });

  it("pmf sums to 1 and cdf and tail are complements around k", () => {
    let s = 0;
    for (let k = 0; k <= 30; k++) s += binomPmf(k, 30, 0.3);
    close(s, 1, 1e-12);
    for (const k of [0, 1, 7, 15, 30]) close(binomCdf(k, 30, 0.3) + binomTail(k + 1, 30, 0.3), 1, 1e-12);
  });

  it("edge cases: k = 0 is certain, k > n is impossible, p = 0 and p = 1", () => {
    expect(binomTail(0, 10, 0.4)).toBe(1);
    expect(binomTail(11, 10, 0.4)).toBe(0);
    expect(binomCdf(10, 10, 0.4)).toBe(1);
    expect(binomCdf(-1, 10, 0.4)).toBe(0);
    expect(binomTail(1, 10, 0)).toBe(0);
    expect(binomTail(10, 10, 1)).toBe(1);
    expect(binomCdf(9, 10, 1)).toBe(0);
    expect(binomTail(0, 0, 0.5)).toBe(1);
  });

  it("direct sum and incomplete beta agree where the code switches between them", () => {
    for (const [k, n, p] of [[40, 100, 0.5], [450, 1000, 0.5], [1010, 2000, 0.5], [30, 1000, 0.02], [3, 1001, 0.001]] as const) {
      // P(X >= k) = I_p(k, n - k + 1)
      relClose(binomTail(k, n, p), betaInc(p, k, n - k + 1), 1e-9);
    }
  });

  it("huge n stays finite and right", () => {
    relClose(binomCdf(0, 1_000_000, 1e-6), Math.exp(1_000_000 * Math.log1p(-1e-6)), 1e-6); // (1 - p)^n
    // by symmetry P(X >= n/2) = (1 + P(X = n/2)) / 2, and P(X = n/2) is about 1 / sqrt(pi n / 2)
    close(binomTail(500_000, 1_000_000, 0.5), (1 + 1 / Math.sqrt((Math.PI * 1_000_000) / 2)) / 2, 1e-6);
    expect(binomTail(1_000_000, 1_000_000, 0.5)).toBe(0.5 ** 1_000_000);
    const t = binomTail(600_000, 1_000_000, 0.5);
    expect(t).toBeGreaterThanOrEqual(0);
    expect(t).toBeLessThan(1e-300);
  });

  it("rejects what is not a count", () => {
    expect(() => binomTail(1.5, 10, 0.5)).toThrow(RangeError);
    expect(() => binomTail(1, -1, 0.5)).toThrow(RangeError);
    expect(() => binomTail(1, 10, 1.5)).toThrow(RangeError);
    expect(() => binomTail(Number.NaN, 10, 0.5)).toThrow(RangeError);
  });
});

describe("the sign test (one-sided, exact), with the plan's own vectors", () => {
  it("6 worse and 0 better is 1/64", () => {
    expect(signTestOneSided(6, 0)).toBeCloseTo(1 / 64, 14);
    expect(signTestOneSided(6, 0).toFixed(3)).toBe("0.016");
  });
  it("6 and 1 is 8/128", () => {
    expect(signTestOneSided(6, 1)).toBeCloseTo(8 / 128, 14);
    expect(signTestOneSided(6, 1).toFixed(3)).toBe("0.063");
  });
  it("5 and 1 is 7/64", () => {
    expect(signTestOneSided(5, 1)).toBeCloseTo(7 / 64, 14);
    expect(signTestOneSided(5, 1).toFixed(3)).toBe("0.109");
  });
  it("5 and 0 is 1/32 (not in the plan: it shows 5 worse with none better is already below 0.05)", () => {
    expect(signTestOneSided(5, 0)).toBeCloseTo(1 / 32, 14);
  });
  it("no pairs, or none worse, is 1", () => {
    expect(signTestOneSided(0, 0)).toBe(1);
    expect(signTestOneSided(0, 7)).toBe(1);
  });
  it("is one-sided: more better than worse is a large p", () => {
    expect(signTestOneSided(1, 6)).toBeGreaterThan(0.9);
  });
});

describe("intervals", () => {
  it("Clopper-Pearson matches the textbook values", () => {
    const a = clopperPearson(5, 10);
    close(a.low, 0.1871, 5e-5);
    close(a.high, 0.8129, 5e-5);
    const b = clopperPearson(0, 10);
    expect(b.low).toBe(0);
    close(b.high, 0.3085, 5e-5);
    const c = clopperPearson(1, 10);
    close(c.low, 0.0025, 5e-5);
    close(c.high, 0.445, 5e-5);
    const d = clopperPearson(2, 100);
    close(d.low, 0.0024, 5e-5);
    close(d.high, 0.0704, 5e-5);
    const e = clopperPearson(3, 100);
    close(e.low, 0.0062, 5e-5);
    close(e.high, 0.0852, 5e-5);
  });

  it("Clopper-Pearson obeys its own definition (exact binomial sum at each end)", () => {
    for (const [k, n] of [[1, 7], [4, 25], [12, 60], [37, 100], [250, 1000], [3, 300], [299, 300]] as const) {
      const { low, high } = clopperPearson(k, n);
      close(binomTail(k, n, low), 0.025, 1e-9); // P(X >= k | low) = alpha / 2
      close(binomCdf(k, n, high), 0.025, 1e-9); // P(X <= k | high) = alpha / 2
    }
  });

  it("Clopper-Pearson edges: n = 0, k = 0, k = n", () => {
    expect(clopperPearson(0, 0)).toEqual({ low: 0, high: 1 });
    const z = clopperPearson(0, 100);
    expect(z.low).toBe(0);
    close(z.high, 1 - 0.025 ** (1 / 100), 1e-12); // closed form at k = 0
    const f = clopperPearson(100, 100);
    expect(f.high).toBe(1);
    close(f.low, 0.025 ** (1 / 100), 1e-12);
  });

  it("Clopper-Pearson with a huge n is finite, ordered and about the Poisson width", () => {
    const { low, high } = clopperPearson(500, 1_000_000);
    expect(low).toBeGreaterThan(0.00044);
    expect(low).toBeLessThan(0.0005);
    expect(high).toBeGreaterThan(0.0005);
    expect(high).toBeLessThan(0.00056);
    relClose(high - low, (2 * 1.96 * Math.sqrt(500)) / 1_000_000, 0.05);
  });

  it("Wilson matches the textbook values and keeps its ends inside 0 and 1", () => {
    const a = wilson(5, 10);
    close(a.low, 0.2366, 5e-5);
    close(a.high, 0.7634, 5e-5);
    const z = wilson(0, 100);
    expect(z.low).toBe(0);
    close(z.high, 3.841458820694124 / (100 + 3.841458820694124), 1e-9); // z^2 / (n + z^2) at k = 0
    const f = wilson(100, 100);
    expect(f.high).toBe(1);
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1 });
  });

  it("level changes the width the right way", () => {
    const w90 = clopperPearson(5, 20, 0.9);
    const w99 = clopperPearson(5, 20, 0.99);
    expect(w99.high - w99.low).toBeGreaterThan(w90.high - w90.low);
    const v90 = wilson(5, 20, 0.9);
    const v99 = wilson(5, 20, 0.99);
    expect(v99.high - v99.low).toBeGreaterThan(v90.high - v90.low);
  });

  it("rejects bad input", () => {
    expect(() => clopperPearson(11, 10)).toThrow(RangeError);
    expect(() => clopperPearson(-1, 10)).toThrow(RangeError);
    expect(() => wilson(1, 10, 1.2)).toThrow(RangeError);
    expect(() => clopperPearson(1, 10, 0)).toThrow(RangeError);
  });
});

describe("upper95 and lower95 (one-sided, exact) against the plan's figures (line 784)", () => {
  it("zero errors: the plan's 'about 3/n' is this bound (0 of 100 about 3%, 0 of 250 about 1.2%, 0 of 300 about 1%)", () => {
    close(upper95(0, 100), 0.0295, 5e-5);
    close(upper95(0, 250), 0.0119, 5e-5);
    close(upper95(0, 300), 0.00995, 5e-5);
    for (const n of [100, 250, 300]) {
      expect(upper95(0, n)).toBeLessThan(3 / n); // the rule of three is the slightly looser round number
      expect(upper95(0, n)).toBeGreaterThan(0.98 * (3 / n));
    }
  });

  it("2 of 100 and 3 of 100: the exact one-sided bound is 6.2% and 7.6%; the plan's 7% and 8% are the top of a TWO-sided 95% interval (Clopper-Pearson 7.0% and 8.5%, Wilson 7.0% and 8.5%)", () => {
    close(upper95(2, 100), 0.0616, 5e-4);
    close(upper95(3, 100), 0.0757, 5e-4);
    close(clopperPearson(2, 100).high, 0.0704, 5e-4);
    close(clopperPearson(3, 100).high, 0.0852, 5e-4);
    close(wilson(2, 100).high, 0.07, 5e-4);
    close(wilson(3, 100).high, 0.0845, 5e-4);
    // and for zero errors the two-sided intervals are NOT the plan's figures (3.6%, 1.5%, 1.2%): there the plan used the one-sided bound, the rule of three
    close(clopperPearson(0, 100).high, 0.0362, 5e-4);
    expect(clopperPearson(0, 250).high).toBeGreaterThan(0.014);
    expect(clopperPearson(0, 300).high).toBeGreaterThan(0.012);
    // so the plan's two figures are safe (looser than the one-sided bound), and are not what upper95 returns
    expect(upper95(2, 100)).toBeLessThan(0.07);
    expect(upper95(3, 100)).toBeLessThan(0.08);
  });

  it("is the one-sided exact bound by its own definition: P(X <= k | upper) = 0.05", () => {
    for (const [k, n] of [[0, 40], [1, 40], [5, 60], [20, 200], [7, 1500]] as const) {
      close(binomCdf(k, n, upper95(k, n)), 0.05, 1e-9);
      if (k > 0) close(binomTail(k, n, lower95(k, n)), 0.05, 1e-9);
    }
    for (const [k, n] of [[36, 40], [14, 15], [90, 100]] as const) {
      close(binomTail(k, n, lower95(k, n)), 0.05, 1e-9);
    }
  });

  it("edges", () => {
    expect(upper95(0, 0)).toBe(1);
    expect(upper95(10, 10)).toBe(1);
    expect(lower95(0, 10)).toBe(0);
    expect(lower95(0, 0)).toBe(0);
    relClose(upper95(0, 1_000_000_000), -Math.log(0.05) / 1_000_000_000, 1e-6);
    // R4: 0 false replies on at least 260 negatives is "about 1.2%"
    close(upper95(0, 260), 0.01146, 1e-5);
  });

  it("recall lower bound for R4: 36 of 40 caught (90%) has a lower bound well under 90%", () => {
    const lb = lower95(36, 40);
    expect(lb).toBeGreaterThan(0.78);
    expect(lb).toBeLessThan(0.8);
  });
});

describe("Cohen's kappa", () => {
  it("is 0.4 for the classic 20 / 5 / 10 / 15 table", () => {
    const a: string[] = [];
    const b: string[] = [];
    const add = (x: string, y: string, times: number) => {
      for (let i = 0; i < times; i++) {
        a.push(x);
        b.push(y);
      }
    };
    add("yes", "yes", 20);
    add("yes", "no", 5);
    add("no", "yes", 10);
    add("no", "no", 15);
    const r = cohensKappa(a, b);
    expect(r.n).toBe(50);
    close(r.agreement as number, 0.7, 1e-12);
    close(r.expected as number, 0.5, 1e-12);
    close(r.kappa as number, 0.4, 1e-12);
  });

  it("is 1 for perfect agreement and -1 for perfect balanced disagreement", () => {
    expect(cohensKappa(["R", "M", "I", "R"], ["R", "M", "I", "R"]).kappa).toBeCloseTo(1, 12);
    expect(cohensKappa(["x", "y", "x", "y"], ["y", "x", "y", "x"]).kappa).toBeCloseTo(-1, 12);
  });

  it("works with three labels (R, M, I)", () => {
    // 10 items: 7 agree; marginals a: R5 M3 I2, b: R5 M4 I1 -> pe = (25 + 12 + 2) / 100 = 0.39, po = 0.7, kappa = 0.31 / 0.61
    const a = ["R", "R", "R", "R", "R", "M", "M", "M", "I", "I"];
    const b = ["R", "R", "R", "R", "M", "M", "M", "R", "I", "M"];
    // agreements: R,R,R,R (4), M at index 5, M at index 6 (2), I at index 8 (1) = 7
    const r = cohensKappa(a, b);
    close(r.agreement as number, 0.7, 1e-12);
    close(r.expected as number, 0.39, 1e-12);
    close(r.kappa as number, 0.31 / 0.61, 1e-12);
  });

  it("is undefined (null), not a made-up number, when chance agreement is total or there is nothing to compare", () => {
    expect(cohensKappa(["R", "R", "R"], ["R", "R", "R"]).kappa).toBeNull();
    expect(cohensKappa([], []).kappa).toBeNull();
    expect(cohensKappa([], []).n).toBe(0);
  });

  it("refuses lists of different length", () => {
    expect(() => cohensKappa(["a"], ["a", "b"])).toThrow(RangeError);
  });
});

describe("precision@k and overlap@k", () => {
  it("precision@k divides by k, so a short list is not rewarded", () => {
    const rel = [true, false, true, true, false];
    expect(precisionAtK(rel, 1)).toBe(1);
    expect(precisionAtK(rel, 3)).toBeCloseTo(2 / 3, 12);
    expect(precisionAtK(rel, 5)).toBeCloseTo(3 / 5, 12);
    expect(precisionAtK(rel, 10)).toBeCloseTo(3 / 10, 12);
    expect(precisionAtK([], 10)).toBe(0);
  });

  it("precision@k rejects k that is not a positive integer", () => {
    expect(() => precisionAtK([true], 0)).toThrow(RangeError);
    expect(() => precisionAtK([true], 1.5)).toThrow(RangeError);
  });

  it("overlap@k is the shared share of the two top-k lists, over k", () => {
    const a = ["a", "b", "c", "d"];
    const b = ["c", "b", "x", "y"];
    expect(overlapAtK(a, b, 1)).toBe(0);
    expect(overlapAtK(a, b, 3)).toBeCloseTo(2 / 3, 12);
    expect(overlapAtK(a, a, 4)).toBe(1);
    expect(overlapAtK([], [], 5)).toBe(0);
    expect(overlapAtK(a, b, 20)).toBeCloseTo(2 / 20, 12); // b and c are shared; a list shorter than k is not padded
  });

  it("overlap@k counts a repeated id once, and ignores the order inside the top k", () => {
    expect(overlapAtK(["a", "a", "b"], ["b", "b", "a"], 3)).toBeCloseTo(2 / 3, 12);
    expect(overlapAtK(["a", "b", "c"], ["c", "b", "a"], 3)).toBe(1);
  });
});

describe("seeded PRNG", () => {
  it("same seed, same stream; another seed, another stream", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const xs = Array.from({ length: 20 }, () => a());
    const ys = Array.from({ length: 20 }, () => b());
    const zs = Array.from({ length: 20 }, () => c());
    expect(xs).toEqual(ys);
    expect(xs).not.toEqual(zs);
  });

  it("is the published mulberry32 (these four are the reference form's output for seed 42), so a change of generator cannot slip in and move every recorded interval", () => {
    const r = mulberry32(42);
    expect([r(), r(), r(), r()]).toEqual([0.6011037519201636, 0.44829055899754167, 0.8524657934904099, 0.6697340414393693]);
  });

  it("stays in [0, 1) and is about uniform", () => {
    const r = mulberry32(7);
    let sum = 0;
    const buckets = new Array<number>(10).fill(0);
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
      buckets[Math.floor(v * 10)]++;
    }
    close(sum / N, 0.5, 0.01);
    for (const c of buckets) close(c / N, 0.1, 0.01);
  });
});

describe("quantile", () => {
  it("interpolates linearly on a sorted copy and leaves the input alone", () => {
    const v = [5, 1, 3, 2, 4];
    expect(quantile(v, 0)).toBe(1);
    expect(quantile(v, 1)).toBe(5);
    expect(quantile(v, 0.5)).toBe(3);
    expect(quantile(v, 0.25)).toBe(2);
    expect(quantile(v, 0.1)).toBeCloseTo(1.4, 12);
    expect(v).toEqual([5, 1, 3, 2, 4]);
    expect(quantile([7], 0.9)).toBe(7);
  });
  it("rejects an empty list and q outside [0, 1]", () => {
    expect(() => quantile([], 0.5)).toThrow(RangeError);
    expect(() => quantile([1], 1.5)).toThrow(RangeError);
  });
});

describe("clustered bootstrap", () => {
  // 20 conversations of 5 messages each; a conversation is all right or all wrong, so the 100 messages are not 100 independent draws
  const clustered = Array.from({ length: 20 }, (_, c) => Array.from({ length: 5 }, () => ({ cluster: "c" + c, value: c % 2 }))).flat();
  const asIfIndependent = clustered.map((x, i) => ({ cluster: "m" + i, value: x.value }));

  it("same seed, same result, to the last digit", () => {
    const a = clusteredBootstrap(clustered, { seed: 11 });
    const b = clusteredBootstrap(clustered, { seed: 11 });
    expect(a).toEqual(b);
  });

  it("another seed moves the ends a little but not the estimate", () => {
    // continuous values, so that two seeds cannot land on the same lattice point by chance
    const r = mulberry32(1);
    const continuous = Array.from({ length: 40 }, (_, i) => ({ cluster: i % 10, value: r() }));
    const a = clusteredBootstrap(continuous, { seed: 11 });
    const b = clusteredBootstrap(continuous, { seed: 12 });
    expect(a.estimate).toBe(b.estimate);
    expect(a.low).not.toBe(b.low);
    expect(a.high).not.toBe(b.high);
  });

  it("regression pin: seed 11, 2000 reps, 95% on the 20 conversations of 5 gives 0.3 to 0.7 (captured from the first run; it changes only if the method changes)", () => {
    const r = clusteredBootstrap(clustered, { seed: 11 });
    expect([r.estimate, r.low, r.high, r.reps, r.clusters, r.n]).toEqual([0.5, 0.3, 0.7, 2000, 20, 100]);
  });

  it("estimates the mean and brackets it", () => {
    const r = clusteredBootstrap(clustered, { seed: 3 });
    expect(r.estimate).toBeCloseTo(0.5, 12);
    expect(r.low).toBeLessThanOrEqual(r.estimate as number);
    expect(r.high).toBeGreaterThanOrEqual(r.estimate as number);
    expect(r.clusters).toBe(20);
    expect(r.n).toBe(100);
  });

  it("is wider than the same numbers treated as independent (the point of clustering)", () => {
    const withClusters = clusteredBootstrap(clustered, { seed: 5, reps: 4000 });
    const without = clusteredBootstrap(asIfIndependent, { seed: 5, reps: 4000 });
    expect(withClusters.estimate).toBe(without.estimate);
    const wc = (withClusters.high as number) - (withClusters.low as number);
    const wi = (without.high as number) - (without.low as number);
    expect(wc).toBeGreaterThan(1.5 * wi);
    // normal-theory widths for comparison: 2 * 1.96 * sqrt(.25 / 20) = 0.44 and 2 * 1.96 * sqrt(.25 / 100) = 0.196
    close(wc, 0.44, 0.08);
    close(wi, 0.196, 0.04);
  });

  it("all-equal values give a point interval; one cluster gives a point interval", () => {
    const same = Array.from({ length: 10 }, (_, i) => ({ cluster: i, value: 1 }));
    const r = clusteredBootstrap(same, { seed: 1 });
    expect(r.low).toBe(1);
    expect(r.high).toBe(1);
    const one = clusteredBootstrap([{ cluster: "a", value: 0 }, { cluster: "a", value: 1 }], { seed: 1 });
    expect(one.low).toBe(0.5);
    expect(one.high).toBe(0.5);
    expect(one.clusters).toBe(1);
  });

  it("an empty input has no interval (null), never a number made up", () => {
    const r = clusteredBootstrap([], { seed: 1 });
    expect(r.estimate).toBeNull();
    expect(r.low).toBeNull();
    expect(r.high).toBeNull();
    expect(r.n).toBe(0);
  });

  it("takes any statistic of the pooled values", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ cluster: i % 6, value: i }));
    const r = clusteredBootstrap(items, { seed: 2, statistic: (v) => Math.max(...v) });
    expect(r.estimate).toBe(29);
    expect(r.high).toBeLessThanOrEqual(29);
  });

  it("the order of the items does not change the answer (clusters are drawn in key order, not in file order)", () => {
    const r = mulberry32(5);
    const items = Array.from({ length: 60 }, (_, i) => ({ cluster: "c" + (i % 12), value: r() }));
    const a = clusteredBootstrap(items, { seed: 9 });
    const b = clusteredBootstrap([...items].reverse(), { seed: 9 });
    expect(b.clusters).toBe(a.clusters);
    close(b.estimate as number, a.estimate as number, 1e-12);
    close(b.low as number, a.low as number, 1e-12);
    close(b.high as number, a.high as number, 1e-12);
  });
});

/* ---------- evaluateGate ---------- */

function gate(over: Partial<Gate>): Gate {
  return {
    id: "t.gate",
    release: "R0",
    metric: "m",
    kind: "rate_max",
    threshold: 0.05,
    n_min: 100,
    baseline: null,
    source: 1,
    status: "proposed",
    note: "",
    ...over,
  };
}

describe("evaluateGate: rate gates", () => {
  it("rate_max passes at or under the threshold and fails over it, with n and an interval", () => {
    const g = gate({ kind: "rate_max", threshold: 0.05, n_min: 100 });
    const ok = evaluateGate(g, { k: 5, n: 100 });
    expect(ok.status).toBe("pass");
    expect(ok.value).toBeCloseTo(0.05, 12);
    expect(ok.n).toBe(100);
    expect(ok.interval).not.toBeNull();
    close(ok.interval!.high, clopperPearson(5, 100).high, 1e-12);
    expect(evaluateGate(g, { k: 6, n: 100 }).status).toBe("fail");
  });

  it("rate_min passes at or over the threshold: 36 of 40 is exactly 90%", () => {
    const g = gate({ kind: "rate_min", threshold: 0.9, n_min: 40 });
    expect(evaluateGate(g, { k: 36, n: 40 }).status).toBe("pass");
    expect(evaluateGate(g, { k: 35, n: 40 }).status).toBe("fail");
  });

  it("the comparison is on counts, so 19 of 20 meets 0.95 and 0.8 of 40 meets 32 (no float surprise)", () => {
    expect(evaluateGate(gate({ kind: "rate_min", threshold: 0.95, n_min: 20 }), { k: 19, n: 20 }).status).toBe("pass");
    expect(evaluateGate(gate({ kind: "rate_min", threshold: 0.8, n_min: 40 }), { k: 32, n: 40 }).status).toBe("pass");
    expect(evaluateGate(gate({ kind: "rate_min", threshold: 0.9, n_min: 50 }), { k: 45, n: 50 }).status).toBe("pass");
    // 0.07 * 100 is 7.000000000000001 and 0.7 * 90 is 62.99999999999999 in floating point: a plain k >= r * n or k <= r * n would get these two wrong
    expect(evaluateGate(gate({ kind: "rate_min", threshold: 0.07, n_min: 100 }), { k: 7, n: 100 }).status).toBe("pass");
    expect(evaluateGate(gate({ kind: "rate_max", threshold: 0.7, n_min: 90 }), { k: 63, n: 90 }).status).toBe("pass");
    expect(evaluateGate(gate({ kind: "rate_min", threshold: 0.07, n_min: 100 }), { k: 6, n: 100 }).status).toBe("fail");
    expect(evaluateGate(gate({ kind: "rate_max", threshold: 0.7, n_min: 90 }), { k: 64, n: 90 }).status).toBe("fail");
    expect(evaluateGate(gate({ kind: "rate_max", threshold: 0.01, n_min: 400 }), { k: 4, n: 400 }).status).toBe("pass");
    expect(evaluateGate(gate({ kind: "rate_max", threshold: 0.01, n_min: 400 }), { k: 5, n: 400 }).status).toBe("fail");
  });

  it("a rate on too few cases is insufficient_n, never a pass, even with a perfect result", () => {
    const g = gate({ kind: "rate_max", threshold: 0, n_min: 260 });
    const r = evaluateGate(g, { k: 0, n: 259 });
    expect(r.status).toBe("insufficient_n");
    expect(r.n).toBe(259);
    expect(r.value).toBe(0);
    expect(evaluateGate(g, { k: 0, n: 260 }).status).toBe("pass");
    const hi = evaluateGate(gate({ kind: "rate_min", threshold: 0.9, n_min: 40 }), { k: 10, n: 10 });
    expect(hi.status).toBe("insufficient_n");
  });

  it("too few cases beats fail: an underpowered set decides nothing in either direction", () => {
    const r = evaluateGate(gate({ kind: "rate_max", threshold: 0, n_min: 260 }), { k: 3, n: 50 });
    expect(r.status).toBe("insufficient_n");
  });

  it("n = 0 is insufficient_n with no rate and the whole 0..1 interval", () => {
    const r = evaluateGate(gate({ kind: "rate_max", threshold: 0.05, n_min: 100 }), { k: 0, n: 0 });
    expect(r.status).toBe("insufficient_n");
    expect(r.value).toBeNull();
    expect(r.interval).toEqual({ low: 0, high: 1, level: 0.95, method: "clopper-pearson" });
  });

  it("reports the one-sided bound the plan reads: upper for a maximum, lower for a minimum", () => {
    const mx = evaluateGate(gate({ kind: "rate_max", threshold: 0, n_min: 260 }), { k: 0, n: 260 });
    close(mx.bound!.value, upper95(0, 260), 1e-12);
    expect(mx.bound!.side).toBe("upper");
    const mn = evaluateGate(gate({ kind: "rate_min", threshold: 0.9, n_min: 40 }), { k: 38, n: 40 });
    close(mn.bound!.value, lower95(38, 40), 1e-12);
    expect(mn.bound!.side).toBe("lower");
  });

  it("an interval from outside (a clustered bootstrap) replaces the exact one", () => {
    const own = { low: 0.01, high: 0.09, level: 0.95, method: "clustered-bootstrap" };
    const r = evaluateGate(gate({ kind: "rate_max", threshold: 0.05, n_min: 100 }), { k: 3, n: 100, interval: own });
    expect(r.interval).toEqual(own);
  });

  it("a gate with no threshold, or one the owner has not settled, is needs_owner and never a pass", () => {
    const none = evaluateGate(gate({ kind: "rate_max", threshold: null }), { k: 0, n: 1000 });
    expect(none.status).toBe("needs_owner");
    const owner = evaluateGate(gate({ kind: "rate_min", threshold: 0.9, status: "needs_owner" }), { k: 1000, n: 1000 });
    expect(owner.status).toBe("needs_owner");
    expect(owner.value).toBe(1);
  });

  it("a rate gate whose n_min the plan never gave cannot pass either", () => {
    const r = evaluateGate(gate({ kind: "rate_max", threshold: 0.05, n_min: null }), { k: 0, n: 3 });
    expect(r.status).toBe("needs_owner");
  });

  it("refuses an observation that is not counts", () => {
    const g = gate({ kind: "rate_max" });
    expect(() => evaluateGate(g, { k: 5, n: 3 })).toThrow(RangeError);
    expect(() => evaluateGate(g, { k: -1, n: 3 })).toThrow(RangeError);
    expect(() => evaluateGate(g, { k: 1.5, n: 3 })).toThrow(RangeError);
    expect(() => evaluateGate(g, {})).toThrow(TypeError);
  });

  it("huge n: a million cases, 0 errors, is a pass with a tiny bound", () => {
    const r = evaluateGate(gate({ kind: "rate_max", threshold: 0, n_min: 300 }), { k: 0, n: 1_000_000 });
    expect(r.status).toBe("pass");
    expect(r.bound!.value).toBeLessThan(4e-6);
  });
});

describe("evaluateGate: paired gates are one-sided", () => {
  const g = gate({ kind: "paired_no_worse", threshold: 0, n_min: 50 });

  it("no query loses a relevant paper: 0 worse passes, 1 worse fails", () => {
    const ok = evaluateGate(g, { worse: 0, better: 3, n: 50 });
    expect(ok.status).toBe("pass");
    expect(ok.p).toBe(1);
    const bad = evaluateGate(g, { worse: 1, better: 9, n: 50 });
    expect(bad.status).toBe("fail");
    expect(bad.value).toBe(1);
  });

  it("reports the exact one-sided sign-test p, and improvements never count against the gate", () => {
    const r = evaluateGate(gate({ kind: "paired_no_worse", threshold: 5, n_min: 113 }), { worse: 5, better: 1, n: 113 });
    expect(r.p).toBeCloseTo(7 / 64, 12);
    expect(r.status).toBe("pass");
    const r6 = evaluateGate(gate({ kind: "paired_no_worse", threshold: 5, n_min: 113 }), { worse: 6, better: 0, n: 113 });
    expect(r6.p).toBeCloseTo(1 / 64, 12);
    expect(r6.status).toBe("fail");
    const better = evaluateGate(g, { worse: 0, better: 40, n: 50 });
    expect(better.status).toBe("pass");
    expect(better.p).toBe(1);
  });

  it("needs all its pairs: fewer than n_min is insufficient_n", () => {
    expect(evaluateGate(g, { worse: 0, better: 0, n: 49 }).status).toBe("insufficient_n");
  });

  it("gives an interval for the share that got worse, and its one-sided upper bound", () => {
    const r = evaluateGate(g, { worse: 0, better: 4, n: 50 });
    expect(r.interval!.low).toBe(0);
    close(r.bound!.value, upper95(0, 50), 1e-12);
    expect(r.bound!.side).toBe("upper");
  });

  it("refuses counts that cannot be pairs", () => {
    expect(() => evaluateGate(g, { worse: 30, better: 30, n: 50 })).toThrow(RangeError);
    expect(() => evaluateGate(g, { worse: 1, better: 1 })).toThrow(TypeError);
  });

  it("a paired gate with no stated rule is needs_owner", () => {
    expect(evaluateGate(gate({ kind: "paired_no_worse", threshold: null, n_min: 80 }), { worse: 0, better: 0, n: 80 }).status).toBe("needs_owner");
  });
});

describe("evaluateGate: counts, floors, tests, reports", () => {
  it("count_equals needs the exact count and its n", () => {
    const g = gate({ kind: "count_equals", threshold: 0, n_min: 200 });
    expect(evaluateGate(g, { count: 0, n: 200 }).status).toBe("pass");
    expect(evaluateGate(g, { count: 1, n: 200 }).status).toBe("fail");
    expect(evaluateGate(g, { count: 0, n: 199 }).status).toBe("insufficient_n");
    expect(evaluateGate(g, { count: 0 }).status).toBe("insufficient_n");
    const noN = gate({ kind: "count_equals", threshold: 0, n_min: null });
    expect(evaluateGate(noN, { count: 0 }).status).toBe("pass");
  });

  it("count_equals with a threshold above zero passes at exactly that count: fewer and more both fail", () => {
    const g = gate({ kind: "count_equals", threshold: 5, n_min: null });
    expect(evaluateGate(g, { count: 5 }).status).toBe("pass");
    expect(evaluateGate(g, { count: 4 }).status).toBe("fail");
    expect(evaluateGate(g, { count: 3 }).status).toBe("fail");
    expect(evaluateGate(g, { count: 6 }).status).toBe("fail");
  });

  it("floor at_least, at_most and under are compared as the plan words them", () => {
    const atLeast = gate({ kind: "floor", direction: "at_least", threshold: 0.85, n_min: null });
    expect(evaluateGate(atLeast, { value: 0.85 }).status).toBe("pass");
    expect(evaluateGate(atLeast, { value: 0.8499 }).status).toBe("fail");
    const atMost = gate({ kind: "floor", direction: "at_most", threshold: 3, n_min: null });
    expect(evaluateGate(atMost, { value: 3 }).status).toBe("pass");
    expect(evaluateGate(atMost, { value: 3.01 }).status).toBe("fail");
    const under = gate({ kind: "floor", direction: "under", threshold: 10, n_min: null });
    expect(evaluateGate(under, { value: 9.99 }).status).toBe("pass");
    expect(evaluateGate(under, { value: 10 }).status).toBe("fail");
  });

  it("a floor relative to a measured reference adds the threshold to it", () => {
    const g = gate({ kind: "floor", direction: "at_most", threshold: 2, relative_to: "today p90", n_min: null });
    expect(evaluateGate(g, { value: 5.9, reference: 4 }).status).toBe("pass");
    expect(evaluateGate(g, { value: 6, reference: 4 }).status).toBe("pass");
    expect(evaluateGate(g, { value: 6.1, reference: 4 }).status).toBe("fail");
    expect(() => evaluateGate(g, { value: 5 })).toThrow(TypeError);
    const size = gate({ kind: "floor", direction: "under", threshold: 0, relative_to: "pre-release size", n_min: null });
    expect(evaluateGate(size, { value: 249_000, reference: 250_000 }).status).toBe("pass");
    expect(evaluateGate(size, { value: 250_000, reference: 250_000 }).status).toBe("fail");
  });

  it("a floor with n_min still needs its n", () => {
    const g = gate({ kind: "floor", direction: "at_least", threshold: 0.6, n_min: 80 });
    expect(evaluateGate(g, { value: 0.9, n: 79 }).status).toBe("insufficient_n");
    expect(evaluateGate(g, { value: 0.9, n: 80 }).status).toBe("pass");
    expect(evaluateGate(g, { value: 0.9 }).status).toBe("insufficient_n");
  });

  it("a floor with no direction is a malformed gate", () => {
    expect(() => evaluateGate(gate({ kind: "floor", threshold: 1, n_min: null }), { value: 1 })).toThrow(TypeError);
    expect(() => evaluateGate(gate({ kind: "floor", direction: "at_least", threshold: 1, n_min: null }), { value: Number.NaN })).toThrow(RangeError);
  });

  it("tests_pass needs at least one test, all green", () => {
    const g = gate({ kind: "tests_pass", threshold: null, n_min: 3 });
    expect(evaluateGate(g, { passed: 3, failed: 0 }).status).toBe("pass");
    expect(evaluateGate(g, { passed: 2, failed: 1 }).status).toBe("fail");
    expect(evaluateGate(g, { passed: 2, failed: 0 }).status).toBe("insufficient_n");
    expect(evaluateGate(gate({ kind: "tests_pass", threshold: null, n_min: null }), { passed: 0, failed: 0 }).status).toBe("insufficient_n");
    expect(evaluateGate(gate({ kind: "tests_pass", threshold: null, n_min: null }), { passed: 1, failed: 0 }).status).toBe("pass");
  });

  it("tests_pass: a failed test is a fail even when fewer tests ran than n_min, so a visible failure is never hidden behind 'not enough tests'", () => {
    const g = gate({ kind: "tests_pass", threshold: null, n_min: 10 });
    expect(evaluateGate(g, { passed: 3, failed: 1 }).status).toBe("fail");
    expect(evaluateGate(g, { passed: 0, failed: 1 }).status).toBe("fail");
    expect(evaluateGate(g, { passed: 9, failed: 0 }).status).toBe("insufficient_n");
    expect(evaluateGate(g, { passed: 10, failed: 0 }).status).toBe("pass");
    // the owner's say still comes first, and a rate on too few cases still decides nothing
    expect(evaluateGate(gate({ kind: "tests_pass", threshold: null, n_min: 10, status: "needs_owner" }), { passed: 3, failed: 1 }).status).toBe("needs_owner");
    expect(evaluateGate(gate({ kind: "rate_max", threshold: 0, n_min: 260 }), { k: 3, n: 50 }).status).toBe("insufficient_n");
  });

  it("report_only never passes or fails: it reports value, n and interval", () => {
    const g = gate({ kind: "report_only", threshold: 0.6, n_min: 80 });
    const r = evaluateGate(g, { k: 20, n: 40 });
    expect(r.status).toBe("report_only");
    expect(r.value).toBe(0.5);
    expect(r.n).toBe(40);
    expect(r.interval).not.toBeNull();
    expect(evaluateGate(g, { value: 0.9 }).status).toBe("report_only");
    expect(evaluateGate(g, {}).value).toBeNull();
    // a read below the n the plan asks for is still only reported, and says it is not evidence yet
    expect(r.reason).toContain("below the 80");
    expect(evaluateGate(g, { k: 20, n: 80 }).reason).not.toContain("below");
  });

  it("a gate with the n_min or threshold key left out is read as having none: needs_owner or insufficient_n, never a pass", () => {
    const dropped = (over: Partial<Gate>, key: keyof Gate): Gate => {
      const g = gate(over) as unknown as Record<string, unknown>;
      delete g[key];
      return g as unknown as Gate;
    };
    expect(evaluateGate(dropped({ kind: "rate_max", threshold: 0.05 }, "n_min"), { k: 0, n: 3 }).status).toBe("needs_owner");
    expect(evaluateGate(dropped({ kind: "paired_no_worse", threshold: 0 }, "n_min"), { worse: 0, better: 0, n: 3 }).status).toBe("needs_owner");
    expect(evaluateGate(dropped({ kind: "rate_max", n_min: 10 }, "threshold"), { k: 1000, n: 1000 }).status).toBe("needs_owner");
    expect(evaluateGate(dropped({ kind: "floor", direction: "at_least", n_min: null }, "threshold"), { value: 0 }).status).toBe("needs_owner");
    expect(evaluateGate(dropped({ kind: "count_equals", n_min: null }, "threshold"), { count: 0 }).status).toBe("needs_owner");
    // a floor relative to a reference, with no margin, has no limit either
    expect(evaluateGate(dropped({ kind: "floor", direction: "at_most", relative_to: "today", n_min: null }, "threshold"), { value: 1, reference: 5 }).status).toBe("needs_owner");
    // n_min left out of a tests_pass gate still needs one test
    expect(evaluateGate(dropped({ kind: "tests_pass", threshold: null }, "n_min"), { passed: 0, failed: 0 }).status).toBe("insufficient_n");
  });

  it("a gate with no status, or an unknown one, is malformed and refused", () => {
    const g = gate({ kind: "rate_max" }) as unknown as Record<string, unknown>;
    delete g.status;
    expect(() => evaluateGate(g as unknown as Gate, { k: 0, n: 1000 })).toThrow(TypeError);
    expect(() => evaluateGate(gate({ kind: "rate_max", status: "ok" as never }), { k: 0, n: 1000 })).toThrow(TypeError);
    const r = gate({ kind: "report_only" }) as unknown as Record<string, unknown>;
    delete r.status;
    expect(() => evaluateGate(r as unknown as Gate, {})).toThrow(TypeError);
  });

  it("an unknown kind is refused", () => {
    expect(() => evaluateGate(gate({ kind: "nope" as never }), {})).toThrow(TypeError);
  });
});
