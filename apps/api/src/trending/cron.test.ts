import { describe, expect, it, vi } from "vitest";
import { JOB_SPECS, jobStatuses, readJobs, runJob } from "../jobs";
import { testD1 } from "../test-d1";
import { fakeKv } from "./fake-kv";
import { TRENDING_KEYS } from "./store";

const searchSpy = vi.hoisted(() =>
  vi.fn(async (_env: unknown, q: string, _limit: number, _hooks: unknown, scope: string) => ({ query: q, results: [], providers: { openalex: { ok: true, count: 0, ms: 1, cached: false } }, doiCheck: { ok: true, count: 0, ms: 0, cached: false }, retractionCheck: { ok: true, count: 0, ms: 0, cached: false }, tookMs: 1, scope })),
);
vi.mock("../search", () => ({ runSearch: (...args: Parameters<typeof searchSpy>) => searchSpy(...args) }));

import { runTrendingFromEnv, type TrendingJobEnv } from "./job";

/**
 * How the job is wired into the scheduled run and the heartbeat: the job is listed in /api/v1/health/jobs with a row seeded by its own migration (without that row the address answers 503 until the
 * first run), it is run from the environment of the Worker (the stand-ins only for a local test run), and it does nothing without KV.
 */

const NOW = Date.parse("2026-11-03T03:17:00Z");
const env = (over: Partial<TrendingJobEnv> = {}): TrendingJobEnv => ({ DB: {} as D1Database, S2_THROTTLE: {} as never, CROSSREF_MAILTO: "ops@example.org", ...over });

describe("the heartbeat", () => {
  it("lists the job, after the two that were there, with a daily rhythm and the same grace", () => {
    expect(Object.keys(JOB_SPECS)).toEqual(["maintenance", "retraction_check", "trending"]);
    expect(JOB_SPECS.trending).toEqual({ everyHours: 24, graceHours: 6 });
  });

  it("is on time right after the migrations: its own migration is its first good run, so /health/jobs is not a 503 before the first night", async () => {
    const { db } = testD1();
    const jobs = await readJobs(db);
    expect(jobs.map((j) => [j.name, j.state])).toEqual([["maintenance", "ok"], ["retraction_check", "ok"], ["trending", "ok"]]);
    expect(jobs.every((j) => j.state === "ok")).toBe(true);
  });

  it("is overdue when its row is missing (what a deploy that skipped the migration would see), failing after a failed run, ok after a good one", async () => {
    const { db } = testD1();
    await db.prepare("DELETE FROM job_runs WHERE name = 'trending'").run();
    expect(jobStatuses((await db.prepare("SELECT * FROM job_runs").all()).results as never, Date.now()).find((j) => j.name === "trending")!.state).toBe("overdue");
    await expect(runJob(db, "trending", async () => { throw new Error("only 6 phrases can be shown"); })).rejects.toThrow();
    expect((await readJobs(db)).find((j) => j.name === "trending")).toMatchObject({ state: "failing", lastError: "only 6 phrases can be shown" });
    await runJob(db, "trending", async () => ({ ok: true }));
    expect((await readJobs(db)).find((j) => j.name === "trending")).toMatchObject({ state: "ok", lastError: null });
  });
});

/** A pool of 12 that fills a list (none of them in a field arXiv covers), made today: no scan is due, so the run is the day's file, from searches only. */
function seeded(k: ReturnType<typeof fakeKv>) {
  const cand = (i: number, fieldId: number, domainId: number) => ({ id: `t-${i}`, text: `topic number ${i}`, phrase: `topic number ${i}`, subfield: fieldId * 100 + 2, subfieldName: "S", field: `Field ${fieldId}`, fieldId, domain: "D", domainId, policy: "allow", a: 300, b: 100, bEstimated: false, ratio: 1.1, score: 2 - i / 100, total: 300 });
  const fields: [number, number][] = [[19, 3], [21, 3], [22, 3], [23, 3], [11, 1], [13, 1], [28, 1], [24, 1], [12, 2], [14, 2], [20, 2], [33, 2]];
  k.seed(TRENDING_KEYS.pool, JSON.stringify({ version: 1, poolAsOf: "2026-11-02", builtAt: "x", global: fields.map(([f, d], i) => cand(i, f, d)), india: [cand(0, 19, 3)], held: [] }));
}

describe("runTrendingFromEnv", () => {
  it("does nothing, and says so, when there is no KV to keep a list in", async () => {
    const r = await runTrendingFromEnv(env(), NOW);
    expect(r).toMatchObject({ skipped: "no_kv", calls: 0 });
  });

  it("in a local test run (QA_STUB and ENABLE_DEV_ROUTES) runs on the stand-ins: no real network, not the real search, and a file is made", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    searchSpy.mockClear();
    const k = fakeKv({ now: () => NOW, writeLimit: false });
    const r = await runTrendingFromEnv(env({ CACHE: k.kv, ENABLE_DEV_ROUTES: "1", QA_STUB: "1" }), NOW);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(searchSpy).not.toHaveBeenCalled();
    expect(r.daily).toMatchObject({ published: true });
    expect(JSON.parse(k.read(TRENDING_KEYS.file)!).groups.global.chips.length).toBeGreaterThanOrEqual(8);
    fetchSpy.mockRestore();
  });

  it("the stand-ins need both switches: QA_STUB alone, the dev switch alone, or one of them set to something else, is the real thing", async () => {
    for (const flags of [{ QA_STUB: "1" }, { ENABLE_DEV_ROUTES: "1" }, { QA_STUB: "1", ENABLE_DEV_ROUTES: "0" }, { QA_STUB: "true", ENABLE_DEV_ROUTES: "1" }]) {
      const k = fakeKv({ now: () => NOW });
      seeded(k);
      searchSpy.mockClear();
      await expect(runTrendingFromEnv(env({ CACHE: k.kv, ...flags }), NOW)).rejects.toThrow(/only 0 phrases/); // the real search's (mocked) answer has no papers
      expect(searchSpy).toHaveBeenCalled();
    }
  });

  it("the verifier's search is the chat's own: runSearch with the Worker's bindings, the limit the chat uses for a search with a year filter, and the scope of the list (the Indian sources for India's)", async () => {
    const k = fakeKv({ now: () => NOW });
    seeded(k);
    searchSpy.mockClear();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("unexpected", { status: 404 }));
    await expect(runTrendingFromEnv(env({ CACHE: k.kv }), NOW)).rejects.toThrow(/only 0 phrases/);
    expect(fetchSpy).not.toHaveBeenCalled(); // no scan is due, and none of the 12 is in a field arXiv covers
    expect(searchSpy.mock.calls.length).toBeGreaterThan(12);
    for (const [bindings, q, limit, hooks, scope] of searchSpy.mock.calls) {
      expect((bindings as { CROSSREF_MAILTO: string }).CROSSREF_MAILTO).toBe("ops@example.org");
      expect(q).toMatch(/^topic number [0-9]+$/);
      expect(limit).toBe(40); // YEAR_FILTER_SEARCH_LIMIT
      expect(hooks).toEqual({});
      expect(["all", "india"]).toContain(scope);
    }
    expect(searchSpy.mock.calls.some((c) => c[4] === "india")).toBe(true);
    fetchSpy.mockRestore();
  });

  it("the verifier's searches keep their cache in memory, one for the whole run: a search makes about 100 KV operations when it uses the visitors' cache (one per provider list, DOI check and retraction entry), which the job's own budget does not count and the platform's per-run limit does", async () => {
    const k = fakeKv({ now: () => NOW });
    seeded(k);
    searchSpy.mockClear();
    await expect(runTrendingFromEnv(env({ CACHE: k.kv }), NOW)).rejects.toThrow(/only 0 phrases/);
    expect(searchSpy.mock.calls.length).toBeGreaterThan(12);
    const stores = new Set(searchSpy.mock.calls.map((c) => (c[0] as { store: unknown }).store));
    expect(stores.size).toBe(1);
    const store = [...stores][0] as { get(k: string): Promise<string | null>; set(k: string, v: string, ttl: number): Promise<void>; getMany(keys: string[]): Promise<Map<string, string | null>> };
    const before = k.ops;
    await store.set("search:v1:probe", "x", 3600);
    expect(await store.get("search:v1:probe")).toBe("x");
    expect((await store.getMany(["search:v1:probe", "nothing"])).get("search:v1:probe")).toBe("x");
    expect(k.ops).toBe(before); // nothing went to KV (or to D1: the bindings of this test have no DB that works)
    // and so the only keys the whole run touched are the job's own
    for (const key of k.log.gets.flat()) expect(key).toMatch(/^trending:v1/);
    for (const put of k.log.puts) expect(put.key).toMatch(/^trending:v1/);
  });

  it("the real run asks OpenAlex with the mailto and the key of the Worker's own configuration, and only OpenAlex", async () => {
    const k = fakeKv({ now: () => NOW, writeLimit: false });
    const urls: string[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => (urls.push(String(input)), new Response("no", { status: 403 })));
    await expect(runTrendingFromEnv(env({ CACHE: k.kv, OPENALEX_API_KEY: "KEY-9" }), NOW)).rejects.toMatchObject({ source: "openalex", status: 403 });
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) {
      expect(new URL(u).hostname).toBe("api.openalex.org");
      expect(new URL(u).searchParams.get("api_key")).toBe("KEY-9");
      expect(new URL(u).searchParams.get("mailto")).toBe("ops@example.org");
    }
    fetchSpy.mockRestore();
  });

  it("the variable TRENDING=off stops it before anything is asked", async () => {
    const k = fakeKv({ now: () => NOW });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await runTrendingFromEnv(env({ CACHE: k.kv, TRENDING: "off" }), NOW);
    expect(r).toMatchObject({ skipped: "off" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(k.ops).toBe(0);
    fetchSpy.mockRestore();
  });
});
