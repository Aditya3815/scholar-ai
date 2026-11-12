import { describe, expect, it } from "vitest";
import { CacheMeter, meteredStore, sourceOfKey, writeCacheRows } from "./meter";
import { memoryStore, type CacheStore } from "./store";

describe("sourceOfKey", () => {
  it("drops the hash and keeps the name of the source", () => {
    expect(sourceOfKey("search:openalex:3fa9c1")).toBe("search:openalex");
    expect(sourceOfKey("doicheck:3fa9c1")).toBe("doicheck");
    expect(sourceOfKey("lk-crossref-doi:abc")).toBe("lk-crossref-doi");
    expect(sourceOfKey("nocolon")).toBe("nocolon");
    expect(sourceOfKey(":x")).toBe(":x");
  });
});

describe("CacheMeter", () => {
  const ctx = () => {
    const promises: Promise<unknown>[] = [];
    return { waitUntil: (p: Promise<unknown>) => void promises.push(p), promises };
  };

  it("counts hits and misses per source and forgets them once drained", () => {
    const m = new CacheMeter();
    m.record("a", true);
    m.record("a", false);
    m.record("a", true);
    m.record("b", false);
    expect(m.drain()).toEqual([{ source: "a", hits: 2, misses: 1 }, { source: "b", hits: 0, misses: 1 }]);
    expect(m.drain()).toEqual([]);
  });
  it("writes what it counted in ONE batch after the delay, on the request's context, however many lookups there were", async () => {
    const written: unknown[][] = [];
    const c = ctx();
    const m = new CacheMeter(1500, async () => {});
    m.attach(c, async (rows) => void written.push(rows));
    for (let i = 0; i < 40; i++) m.record(i % 2 ? "a" : "b", i % 3 === 0);
    expect(c.promises).toHaveLength(1);
    await Promise.all(c.promises);
    expect(written).toHaveLength(1);
    expect((written[0] as { hits: number; misses: number }[]).reduce((n, r) => n + r.hits + r.misses, 0)).toBe(40);
    // the next lookups schedule the next write
    m.record("a", true);
    expect(c.promises).toHaveLength(2);
    await Promise.all(c.promises);
    expect(written).toHaveLength(2);
  });
  it("waits the delay before it writes", async () => {
    const waited: number[] = [];
    const c = ctx();
    const m = new CacheMeter(1500, async (ms) => void waited.push(ms));
    m.attach(c, async () => {});
    m.record("a", true);
    await Promise.all(c.promises);
    expect(waited).toEqual([1500]);
  });
  it("keeps counting in memory when no request is attached (a test, the daily job), and writes nothing", () => {
    const m = new CacheMeter();
    m.record("a", true);
    expect(m.drain()).toEqual([{ source: "a", hits: 1, misses: 0 }]);
  });
  it("a write that fails is only logged, and the next lookup schedules another", async () => {
    const c = ctx();
    const m = new CacheMeter(1, async () => {});
    m.attach(c, async () => { throw new Error("D1 busy"); });
    m.record("a", true);
    await Promise.all(c.promises);
    m.record("a", true);
    expect(c.promises).toHaveLength(2);
  });
  it("tries again with the next request's context when the attached one has already finished", async () => {
    const dead = { waitUntil: () => { throw new Error("the request is over"); } };
    const m = new CacheMeter(1, async () => {});
    m.attach(dead, async () => {});
    m.record("a", true);
    const live = ctx();
    m.attach(live, async () => {});
    m.record("a", false);
    expect(live.promises).toHaveLength(1);
    await Promise.all(live.promises);
  });
});

describe("meteredStore", () => {
  it("counts every read, in one at a time and in bulk, by the source in the key, and passes writes through", async () => {
    const meter = new CacheMeter();
    const inner = memoryStore();
    const s = meteredStore(inner, meter);
    await s.set("search:openalex:h1", "x", 100);
    await s.get("search:openalex:h1");
    await s.get("search:openalex:h2");
    await s.getMany!(["doicheck:a", "doicheck:b"]);
    expect(await inner.get("search:openalex:h1")).toBe("x");
    expect(meter.drain()).toEqual([
      { source: "search:openalex", hits: 1, misses: 1 },
      { source: "doicheck", hits: 0, misses: 2 },
    ]);
  });
  it("has no bulk read when the store under it has none", () => {
    const plain: CacheStore = { get: async () => null, set: async () => {} };
    expect(meteredStore(plain, new CacheMeter()).getMany).toBeUndefined();
  });
});

describe("writeCacheRows", () => {
  it("is one batch of upserts, nothing for no rows", async () => {
    const stmts: { sql: string; args: unknown[] }[] = [];
    let batches = 0;
    const db = {
      prepare: (sql: string) => ({ bind: (...args: unknown[]) => ({ sql, args }) }),
      batch: async (list: { sql: string; args: unknown[] }[]) => {
        batches++;
        stmts.push(...list);
        return [];
      },
    } as unknown as D1Database;
    await writeCacheRows(db, []);
    expect(batches).toBe(0);
    await writeCacheRows(db, [{ source: "a", hits: 2, misses: 1 }, { source: "b", hits: 0, misses: 3 }]);
    expect(batches).toBe(1);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]!.sql).toMatch(/ON CONFLICT \(day, source\) DO UPDATE SET hits = hits \+ \?2, misses = misses \+ \?3/);
    expect(stmts.map((s) => s.args)).toEqual([["a", 2, 1], ["b", 0, 3]]);
  });
});
