import { describe, expect, it, vi } from "vitest";
import { cacheKey, cached } from "./cache";
import { memoryStore, type CacheStore } from "../cache/store";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("cacheKey", () => {
  it("is the source and a short hash, the same for the same parts and different otherwise", async () => {
    const a = await cacheKey("doicheck", "10.1/a");
    expect(a).toMatch(/^doicheck:[0-9a-f]{32}$/);
    expect(await cacheKey("doicheck", "10.1/a")).toBe(a);
    expect(await cacheKey("doicheck", "10.1/b")).not.toBe(a);
    expect(await cacheKey("retraction", "10.1/a")).not.toBe(a);
    expect(await cacheKey("x", "a", "b")).not.toBe(await cacheKey("x", "ab"));
    expect(a.length).toBeLessThan(100);
  });
});

describe("cached", () => {
  it("asks once, then answers from the store", async () => {
    const store = memoryStore();
    const load = vi.fn(async () => ({ n: 1 }));
    expect(await cached(store, "s", "k", 60, load)).toEqual({ value: { n: 1 }, hit: false });
    expect(await cached(store, "s", "k", 60, load)).toEqual({ value: { n: 1 }, hit: true });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps an answer that is null, false, zero, an empty list or an empty string: those are answers too", async () => {
    for (const v of [null, false, 0, [], ""]) {
      const store = memoryStore();
      const load = vi.fn(async () => v);
      await cached(store, "s", "k", 60, load);
      const second = await cached(store, "s", "k", 60, load);
      expect(second).toEqual({ value: v, hit: true });
      expect(load).toHaveBeenCalledTimes(1);
    }
  });

  it("identical misses at the same moment share one call upstream, and all get the answer", async () => {
    const store = memoryStore();
    let release!: (v: string) => void;
    const load = vi.fn(() => new Promise<string>((r) => (release = r)));
    const calls = Array.from({ length: 6 }, () => cached(store, "s", "k", 60, load));
    await tick();
    release("answer");
    const out = await Promise.all(calls);
    expect(load).toHaveBeenCalledTimes(1);
    expect(out.map((o) => o.value)).toEqual(Array(6).fill("answer"));
    expect(out.filter((o) => o.hit)).toHaveLength(0);
    // and the answer was written once
    expect((await cached(store, "s", "k", 60, load)).hit).toBe(true);
  });

  it("different keys, and different stores, never share a call", async () => {
    const load = vi.fn(async () => "x");
    await Promise.all([cached(memoryStore(), "s", "k", 60, load), cached(memoryStore(), "s", "k", 60, load), cached(memoryStore(), "s", "other", 60, load)]);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("a lookup that fails is not kept, every caller waiting for it gets the failure, and the next call asks again", async () => {
    const store = memoryStore();
    let fail = true;
    const load = vi.fn(async () => {
      await tick();
      if (fail) throw new Error("upstream 500");
      return "ok";
    });
    const results = await Promise.allSettled([cached(store, "s", "k", 60, load), cached(store, "s", "k", 60, load)]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(load).toHaveBeenCalledTimes(1);
    fail = false;
    expect((await cached(store, "s", "k", 60, load)).value).toBe("ok");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("a store that cannot be read or written never breaks the request: the lookup is simply made", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken: CacheStore = { get: async () => { throw new Error("down"); }, set: async () => { throw new Error("down"); } };
    const load = vi.fn(async () => 42);
    expect(await cached(broken, "s", "k", 60, load)).toEqual({ value: 42, hit: false });
    expect(await cached(broken, "s", "k", 60, load)).toEqual({ value: 42, hit: false });
    expect(load).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("a damaged entry is a miss: the lookup is made again and the entry is replaced", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = memoryStore();
    await store.set("k", "{not json", 60);
    const load = vi.fn(async () => ({ ok: true }));
    expect(await cached(store, "s", "k", 60, load)).toEqual({ value: { ok: true }, hit: false });
    expect((await cached(store, "s", "k", 60, load)).hit).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("the lifetime may depend on the answer: found long, not found short, and 0 means do not keep", async () => {
    const seen: number[] = [];
    const store: CacheStore = { get: async () => null, set: async (_k, _v, ttl) => void seen.push(ttl) };
    const ttl = (v: string | null) => (v === null ? 0 : v === "" ? 60 : 3600);
    await cached(store, "s", "a", ttl, async () => "found");
    await cached(store, "s", "b", ttl, async () => "");
    await cached(store, "s", "c", ttl, async () => null);
    expect(seen).toEqual([3600, 60]);
  });

  it("a fixed lifetime of 0 or less keeps nothing", async () => {
    const store = memoryStore();
    const load = vi.fn(async () => "x");
    await cached(store, "s", "k", 0, load);
    await cached(store, "s", "k", 0, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("passes the source to the store as a label", async () => {
    let label: string | undefined;
    const store: CacheStore = { get: async () => null, set: async (_k, _v, _t, source) => void (label = source) };
    await cached(store, "search:pubmed", "k", 60, async () => 1);
    expect(label).toBe("search:pubmed");
  });
});
