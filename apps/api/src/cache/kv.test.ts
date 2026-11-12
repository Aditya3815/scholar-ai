import { describe, expect, it } from "vitest";
import { KV_MIN_TTL_SECONDS, KV_VERSION, MAX_CACHED_CHARS, kvStore } from "./kv";

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
  it("lets a place keep what it read for a minute (KV allows no less than 30 seconds)", async () => {
    const { kv, calls } = fakeKv();
    await kvStore(kv).get("a");
    expect(calls.opts).toEqual([{ cacheTtl: 60 }]);
  });
  it("lets a KV failure reach the caller (which treats it as a miss), without having changed anything", async () => {
    const broken = { get: async () => { throw new Error("KV down"); }, put: async () => { throw new Error("KV down"); } } as unknown as KVNamespace;
    await expect(kvStore(broken).get("a")).rejects.toThrow("KV down");
    await expect(kvStore(broken).set("a", "1", 100)).rejects.toThrow("KV down");
  });
});
