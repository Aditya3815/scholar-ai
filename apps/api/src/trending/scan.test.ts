import { describe, expect, it } from "vitest";
import KEYWORDS_A from "./fixtures/oa-keywords-1702-a.json?raw";
import KEYWORDS_B from "./fixtures/oa-keywords-1702-b.json?raw";
import { TREND, scoreSubfields, trendWindows, type KeywordRow, type SubfieldInput } from "@scholar/shared/src/trending";
import { CallBudget, SourceError, type Http } from "./sources";
import type { OaDeps } from "./openalex";
import { compact, expand, isBatchFile, scanBatch } from "./scan";
import { makeStubTrending, STUB_SUBFIELDS } from "./stub";

/**
 * The weekly scan keeps, for each subfield and each group, the counts the ranker needs, in a form small enough to wait in KV between two runs. What is kept must give the ranker
 * exactly what the whole answers would have given: that is checked on data of every shape, not on one example.
 */

// a small fixed pseudo-random sequence, so the "every shape" tests are the same on every run
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
const WORDS = ["graph", "neural", "quantum", "soil", "carbon", "policy", "memory", "protein", "reef", "bond", "wave", "fluid", "cell", "market", "school", "ocean"];
const phrase = (r: () => number): string => `${WORDS[Math.floor(r() * WORDS.length)]} ${WORDS[Math.floor(r() * WORDS.length)]} ${WORDS[Math.floor(r() * WORDS.length)]}`;

function randomInputs(seed: number, subfields: number): SubfieldInput[] {
  const r = rng(seed);
  const ids = ["1702", "1707", "1710", "1711", "1712", "1801", "2002", "2003", "2208", "2303"].slice(0, subfields).map(Number);
  const shared = Array.from({ length: 25 }, () => phrase(r)); // phrases that turn up in several subfields
  return ids.map((subfield) => {
    const names = [...shared.filter(() => r() < 0.5), ...Array.from({ length: 80 }, () => phrase(r))];
    const uniq = [...new Set(names)];
    const rowsA: KeywordRow[] = uniq.map((name) => ({ id: name.replace(/ /g, "-"), name, count: Math.floor(r() ** 3 * 400) })).sort((x, y) => y.count - x.count).slice(0, 200);
    const rowsB: KeywordRow[] = rowsA.filter(() => r() < 0.75).map((row) => ({ ...row, count: Math.max(1, Math.floor(row.count * (0.3 + r() * 1.2))) })).sort((x, y) => y.count - x.count);
    return { subfield, totalA: Math.round(50_000 * (1 + r())), totalB: 40_000, rowsA, rowsB };
  });
}

describe("compact and expand", () => {
  it("keep every row of window A (name and count), and of window B only what a decision can use", () => {
    const input: SubfieldInput = {
      subfield: 1702,
      totalA: 18526,
      totalB: 16924,
      rowsA: [{ id: "rag", name: "retrieval-augmented generation", count: 452 }, { id: "tiny", name: "tiny topic", count: 3 }],
      rowsB: [{ id: "rag", name: "retrieval-augmented generation", count: 176 }, { id: "gone", name: "gone topic", count: 120 }, { id: "min", name: "minimum", count: 31 }],
    };
    const c = compact(input, "global");
    expect(c.ta).toBe(18526);
    expect(c.tb).toBe(16924);
    expect(c.a).toEqual([["rag", "retrieval-augmented generation", 452], ["tiny", "tiny topic", 3]]);
    // B: the keyword that is a candidate (rag) and the smallest row (the estimate for a keyword that was not in last year's list); "gone" decides nothing
    expect(c.b).toEqual([["rag", 176], ["min", 31]]);
    expect(expand(1702, c)).toEqual({ subfield: 1702, totalA: 18526, totalB: 16924, rowsA: input.rowsA, rowsB: [{ id: "rag", name: "", count: 176 }, { id: "min", name: "", count: 31 }] });
  });

  it("gives the ranker exactly what the whole answers give: same candidates, same held ones, same counts of every rule, on 40 random sets of subfields, global and India", () => {
    let candidates = 0;
    let estimated = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const inputs = randomInputs(seed, 2 + (seed % 8));
      for (const group of ["global", "in"] as const) {
        const whole = scoreSubfields(inputs, group);
        const kept = scoreSubfields(inputs.map((i) => expand(i.subfield, JSON.parse(JSON.stringify(compact(i, group))))), group);
        expect(kept, `seed ${seed} ${group}`).toEqual(whole);
        candidates += whole.candidates.length + whole.held.length;
        estimated += whole.candidates.filter((c) => c.bEstimated).length;
      }
    }
    // the comparison is not an empty one: there were candidates to compare, and some of them rested on the estimate from the smallest row
    expect(candidates).toBeGreaterThan(200);
    expect(estimated).toBeGreaterThan(20);
  });

  it("is much smaller than the whole answers (what makes a scan fit in KV)", () => {
    const inputs = randomInputs(7, 8);
    const whole = JSON.stringify(inputs).length;
    const kept = JSON.stringify(inputs.map((i) => compact(i, "global"))).length;
    expect(kept).toBeLessThan(whole * 0.8);
  });

  it("a subfield with no last-year rows keeps none (the ranker skips it anyway)", () => {
    const c = compact({ subfield: 1, totalA: 10, totalB: 0, rowsA: [{ id: "a", name: "a b c", count: 50 }], rowsB: [] }, "global");
    expect(c.b).toEqual([]);
  });
});

describe("isBatchFile", () => {
  const ok = { version: 1, day: "2026-11-02", n: 10, subfields: [1702], global: { "1702": { ta: 5, tb: 4, a: [["x", "x y z", 50]], b: [["x", 20]] } }, india: {} };
  it("accepts what scanBatch writes, for the scan it belongs to", () => {
    expect(isBatchFile(JSON.parse(JSON.stringify(ok)), "2026-11-02", 10)).toEqual(ok);
  });
  it("refuses another day, another size of scan, and anything that is not the shape", () => {
    expect(isBatchFile(ok, "2026-11-09", 10)).toBeNull();
    expect(isBatchFile(ok, "2026-11-02", 11)).toBeNull();
    for (const bad of [null, [], "x", { ...ok, version: 2 }, { ...ok, global: null }, { ...ok, global: { "1702": { ta: "5", tb: 4, a: [], b: [] } } }, { ...ok, global: { "1702": { ta: 5, tb: 4, a: [["x", "x y z"]], b: [] } } }, { ...ok, global: { "1702": { ta: 5, tb: 4, a: [], b: [["x", -1]] } } }]) {
      expect(isBatchFile(bad, "2026-11-02", 10), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("scanBatch", () => {
  const DAY = "2026-11-02";
  const W = trendWindows(DAY);
  function setup(over: { intercept?: Parameters<typeof makeStubTrending>[0]["intercept"] } = {}) {
    const stub = makeStubTrending({ asOf: () => DAY, ...over });
    const http: Http = { fetch: stub.fetch, sleep: async () => {}, timeoutMs: 1000, retries: 0, retryWaitMs: 1, maxRetryWaitMs: 1 };
    const oa: OaDeps = { http, mailto: "ops@example.org", apiKey: "K", budget: new CallBudget(10_000, "OpenAlex calls") };
    return { stub, oa };
  }
  const filters = (urls: URL[]) => urls.map((u) => u.searchParams.get("filter")!);

  it("asks for both windows of both groups for an allowed subfield, and keeps the counts", async () => {
    const { stub, oa } = setup();
    const b = await scanBatch(oa, { day: DAY, n: 3, subfields: [1702], concurrency: 3, scanHeld: true });
    expect(stub.calls.openalex).toHaveLength(4);
    const f = filters(stub.calls.openalex);
    expect(f.filter((x) => x.includes("country_code:IN"))).toHaveLength(2);
    expect(f.filter((x) => x.includes(`from_publication_date:${W.a.from}`))).toHaveLength(2);
    expect(f.filter((x) => x.includes(`from_publication_date:${W.b.from}`))).toHaveLength(2);
    expect(b).toMatchObject({ version: 1, day: DAY, n: 3, subfields: [1702] });
    expect(b.global["1702"]).toMatchObject({ ta: 110_000, tb: 100_000 });
    expect(b.global["1702"]!.a[0]).toEqual(["retrieval-augmented-generation", "retrieval-augmented generation", 452]);
    expect(b.india["1702"]).toMatchObject({ ta: 1800, tb: 1640 });
  });

  it("does not ask for window B when window A has fewer papers than any keyword needs (no keyword can pass the floor), and keeps nothing of that subfield", async () => {
    const { stub, oa } = setup();
    const b = await scanBatch(oa, { day: DAY, n: 1, subfields: [1703], concurrency: 1, scanHeld: true }); // an allowed subfield the stand-in knows nothing about: 0 papers
    expect(stub.calls.openalex).toHaveLength(2); // A for the global group and A for India; no B
    expect(b.global).toEqual({});
    expect(b.india).toEqual({});
    expect(TREND.floors.global.subfield).toBeGreaterThan(0);
  });

  it("asks about a held (health) subfield for the global group only, and not at all when told not to hold them", async () => {
    const { stub, oa } = setup();
    const held = 2712; // Endocrinology: held in the policy table
    await scanBatch(oa, { day: DAY, n: 1, subfields: [held], concurrency: 1, scanHeld: true });
    expect(filters(stub.calls.openalex).every((x) => !x.includes("country_code:IN"))).toBe(true);
    expect(stub.calls.openalex).toHaveLength(2); // A and B for the global group; the stand-in knows a held topic there
    expect(stub.calls.openalex.every((u) => !String(u.searchParams.get("filter")).includes("country_code"))).toBe(true);
    const again = setup();
    await scanBatch(again.oa, { day: DAY, n: 1, subfields: [held], concurrency: 1, scanHeld: false });
    expect(again.stub.calls.openalex).toHaveLength(0);
  });

  it("never asks about a subfield the policy says never", async () => {
    const { stub, oa } = setup();
    const b = await scanBatch(oa, { day: DAY, n: 1, subfields: [1100], concurrency: 2, scanHeld: true }); // General Agricultural and Biological Sciences
    expect(stub.calls.openalex).toHaveLength(0);
    expect(b.global).toEqual({});
  });

  it("has at most `concurrency` calls in flight", async () => {
    let flying = 0;
    let peak = 0;
    const { oa } = setup();
    const inner = oa.http.fetch;
    oa.http.fetch = (async (...args: Parameters<typeof fetch>) => {
      peak = Math.max(peak, ++flying);
      await new Promise((r) => setTimeout(r, 3));
      flying--;
      return inner(...args);
    }) as typeof fetch;
    await scanBatch(oa, { day: DAY, n: 1, subfields: [...STUB_SUBFIELDS], concurrency: 3, scanHeld: true });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  it("fails on the first source error and says which source: no subfield is skipped quietly", async () => {
    let n = 0;
    const { oa } = setup({ intercept: () => (++n === 3 ? new Response("down", { status: 503 }) : null) });
    const err = await scanBatch(oa, { day: DAY, n: 1, subfields: [...STUB_SUBFIELDS], concurrency: 1, scanHeld: true }).catch((e) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err).toMatchObject({ source: "openalex", kind: "http", status: 503 });
  });
});

describe("the real answers of 3 Nov 2026 (subfield 1702, Artificial Intelligence)", () => {
  it("make a batch with the subfield's own totals, every row of window A, and of window B only what a decision can use", async () => {
    const day = "2026-11-03"; // the day the answers were recorded for: their windows are this day's
    const w = trendWindows(day);
    const http: Http = {
      fetch: (async (input: RequestInfo | URL) => new Response(String(new URL(String(input)).searchParams.get("filter")).includes(`from_publication_date:${w.a.from}`) ? KEYWORDS_A : KEYWORDS_B)) as typeof fetch,
      sleep: async () => {}, timeoutMs: 1000, retries: 0, retryWaitMs: 1, maxRetryWaitMs: 1,
    };
    const oa: OaDeps = { http, mailto: "ops@example.org", budget: new CallBudget(100, "calls") };
    const b = await scanBatch(oa, { day, n: 1, subfields: [1702], concurrency: 1, scanHeld: true });
    const c = b.global["1702"]!;
    expect(c).toMatchObject({ ta: 18526, tb: 16924 }); // the totals of the live probe, from the answers' own meta.count
    expect(c.a).toHaveLength(30);
    const recordedB = new Set((JSON.parse(KEYWORDS_B) as { group_by: { key: string }[] }).group_by.map((g) => g.key.slice(g.key.lastIndexOf("/") + 1)));
    expect(c.b.length).toBeGreaterThan(0);
    expect(c.b.every(([id]) => recordedB.has(id))).toBe(true);
    // and the ranker can read it back
    const kept = scoreSubfields([expand(1702, c)], "global");
    expect(kept.stats.rows).toBe(30);
  });
});
