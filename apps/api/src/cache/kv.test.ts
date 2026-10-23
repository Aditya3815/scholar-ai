import { describe, expect, it } from "vitest";
import { KV_MIN_TTL_SECONDS, KV_VERSION, MAX_CACHED_CHARS, kvStore } from "./kv";
import { CacheMeter, meteredStore, sourceOfKey, writeCacheRows } from "./meter";
import { getMany, memoryStore, type CacheStore } from "./store";

/** The part of Workers KV that kvStore uses, with a clock, so expiry can be tested. */
function fakeKv(now: () => number = () => 0) {
  const data = new Map<string, { value: string; expires: number | null; metadata: unknown }>();
  const calls = { get: 0, bulk: 0, put: [] as { key: string; ttl?: number; metadata?: unknown }[], opts: [] as unknown[] };
  const live = (k: string) => {
    const e = data.get(k);
    return e && (e.expires === null || e.expires > now()) ? e.value : null;
  };
  const kv = {
    async get(key: string | string[], opts?: unknown) {
      calls.opts.push(opts);
      if (Array.isArray(key)) {
        calls.bulk++;
        if (key.length > 100) throw new Error("KV: at most 100 keys in one read");
        return new Map(key.map((k) => [k, live(k)] as const));
      }
      calls.get++;
      return live(key);
    },
    async put(key: string, value: string, opts?: { expirationTtl?: number; metadata?: unknown }) {
      if (opts?.expirationTtl !== undefined && opts.expirationTtl < 60) throw new Error("KV: expirationTtl must be at least 60");
      calls.put.push({ key, ttl: opts?.expirationTtl, metadata: opts?.metadata });
      data.set(key, { value, expires: opts?.expirationTtl ? now() + opts.expirationTtl * 1000 : null, metadata: opts?.metadata });
    },
  };
  return { kv: kv as unknown as KVNamespace, data, calls };
}

describe("kvStore", () => {
  it("stores and returns a value under a versioned key, and a missing key is null", async () => {
    const { kv, data } = fakeKv();
    const s = kvStore(kv);
    await s.set("search:openalex:abc", '{"a":1}', 3600, "search:openalex");
    expect(await s.get("search:openalex:abc")).toBe('{"a":1}');
    expect([...data.keys()]).toEqual([`${KV_VERSION}:search:openalex:abc`]);
    expect(await s.get("nothing")).toBeNull();
  });
  it("hands KV the lifetime in seconds and never less than the 60 seconds KV accepts", async () => {
    const { kv, calls } = fakeKv();
    const s = kvStore(kv);
    await s.set("a", "1", 3600);
    await s.set("b", "1", 5);
    await s.set("c", "1", 0.2);
    await s.set("d", "1", 90.4);
    expect(calls.put.map((p) => p.ttl)).toEqual([3600, KV_MIN_TTL_SECONDS, KV_MIN_TTL_SECONDS, 91]);
  });
  it("entries expire by themselves", async () => {
    let t = 0;
    const { kv } = fakeKv(() => t);
    const s = kvStore(kv);
    await s.set("a", "x", 120);
    t = 119_000;
    expect(await s.get("a")).toBe("x");
    t = 121_000;
    expect(await s.get("a")).toBeNull();
  });
  it("keeps the source label as metadata, and does not store a value that is too large to be worth reading back", async () => {
    const { kv, calls } = fakeKv();
    const s = kvStore(kv);
    await s.set("k", "v", 100, "doicheck");
    expect(calls.put[0]!.metadata).toEqual({ s: "doicheck" });
    await s.set("big", "x".repeat(MAX_CACHED_CHARS + 1), 100);
    expect(calls.put).toHaveLength(1);
    expect(await s.get("big")).toBeNull();
    await s.set("edge", "x".repeat(MAX_CACHED_CHARS), 100);
    expect(calls.put).toHaveLength(2);
  });
  it("reads many keys in one operation per 100, and returns null for the ones that are not there", async () => {
    const { kv, calls } = fakeKv();
    const s = kvStore(kv);
    await Promise.all(Array.from({ length: 250 }, (_, i) => (i % 2 === 0 ? s.set(`k${i}`, `v${i}`, 100) : Promise.resolve())));
    const keys = Array.from({ length: 250 }, (_, i) => `k${i}`);
    const got = await s.getMany!(keys);
    expect(got.size).toBe(250);
    expect(got.get("k0")).toBe("v0");
    expect(got.get("k1")).toBeNull();
    expect(got.get("k248")).toBe("v248");
    expect(calls.bulk).toBe(3);
    expect(calls.get).toBe(0);
    expect((await s.getMany!([])).size).toBe(0);
  });
  it("lets a place keep what it read for at least the 30 seconds KV allows", async () => {
    const { kv, calls } = fakeKv();
    await kvStore(kv).get("a");
    await kvStore(kv, { cacheTtl: 5 }).get("a");
    await kvStore(kv, { cacheTtl: 600 }).get("a");
    expect(calls.opts).toEqual([{ cacheTtl: 60 }, { cacheTtl: 30 }, { cacheTtl: 600 }]);
  });
  it("lets a KV failure reach the caller (which treats it as a miss), without having changed anything", async () => {
    const broken = { get: async () => { throw new Error("KV down"); }, put: async () => { throw new Error("KV down"); } } as unknown as KVNamespace;
    await expect(kvStore(broken).get("a")).rejects.toThrow("KV down");
    await expect(kvStore(broken).set("a", "1", 100)).rejects.toThrow("KV down");
  });
});

describe("getMany", () => {
  it("uses the store's own bulk read when it has one, one read per key when it has not", async () => {
    const m = memoryStore();
    await m.set("a", "1", 100);
    expect([...(await getMany(m, ["a", "b"]))]).toEqual([["a", "1"], ["b", null]]);
    let reads = 0;
    const plain: CacheStore = { get: async (k) => (reads++, k === "a" ? "1" : null), set: async () => {} };
    expect([...(await getMany(plain, ["a", "b", "c"]))]).toEqual([["a", "1"], ["b", null], ["c", null]]);
    expect(reads).toBe(3);
    expect((await getMany(plain, [])).size).toBe(0);
  });
});

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
