import { describe, expect, it } from "vitest";
import { d1Store, getMany, memoryStore, type CacheStore } from "./store";

/** A D1 stand-in that remembers the statements and answers `all` from a table of rows, so the SQL the store writes is checked as well as what it returns. */
function fakeD1(rows: Record<string, string> = {}) {
  const log: { sql: string; args: unknown[] }[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => {
          log.push({ sql, args });
          const v = rows[String(args[0])];
          return v === undefined ? null : { payload: v };
        },
        all: async () => {
          log.push({ sql, args });
          return { results: args.filter((k) => String(k) in rows).map((k) => ({ key: String(k), payload: rows[String(k)] })) };
        },
        run: async () => void log.push({ sql, args }),
      }),
    }),
  } as unknown as D1Database;
  return { db, log };
}

describe("d1Store (the fallback when KV is not bound)", () => {
  it("reads one key only while it has not expired, and a missing key is null", async () => {
    const { db, log } = fakeD1({ a: "1" });
    const s = d1Store(db);
    expect(await s.get("a")).toBe("1");
    expect(await s.get("zz")).toBeNull();
    expect(log[0]!.sql).toMatch(/expires_at > datetime\('now'\)/);
  });
  it("writes the value with its lifetime and the label of its source", async () => {
    const { db, log } = fakeD1();
    await d1Store(db, "default").set("k", "v", 3600, "doicheck");
    await d1Store(db, "default").set("k2", "v", 60);
    expect(log[0]!.args).toEqual(["k", "doicheck", "v", "+3600 seconds"]);
    expect(log[1]!.args).toEqual(["k2", "default", "v", "+60 seconds"]);
  });
  it("reads many keys with as few statements as D1's limit of parameters allows, and returns null for the missing ones", async () => {
    const keys = Array.from({ length: 200 }, (_, i) => `k${i}`);
    const { db, log } = fakeD1({ k0: "a", k150: "b" });
    const got = await d1Store(db).getMany!(keys);
    expect(got.size).toBe(200);
    expect(got.get("k0")).toBe("a");
    expect(got.get("k150")).toBe("b");
    expect(got.get("k1")).toBeNull();
    expect(log).toHaveLength(3);
    expect(log.every((l) => l.args.length <= 90)).toBe(true);
    expect((await d1Store(fakeD1().db).getMany!([])).size).toBe(0);
  });
});

describe("memoryStore", () => {
  it("expires entries by the clock it is given", async () => {
    let t = 0;
    const s = memoryStore(() => t);
    await s.set("a", "1", 10);
    expect(await s.get("a")).toBe("1");
    t = 9_999;
    expect((await s.getMany!(["a", "b"])).get("a")).toBe("1");
    t = 10_001;
    expect(await s.get("a")).toBeNull();
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
