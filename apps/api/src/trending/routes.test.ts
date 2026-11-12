import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isFresh, parseTrending, type TrendingChip, type TrendingPayload } from "@scholar/shared";
import { rateLimit } from "../ratelimit";
import { fakeKv } from "./fake-kv";
import { TRENDING_KEYS } from "./store";
import { readTrending, trendingRoutes, type TrendingRouteEnv } from "./routes";

/**
 * GET /api/v1/home/trending (T12): one public file, the same for everyone, read from KV and never from OpenAlex or arXiv. A miss, a broken store, a broken file, a stale file and the two
 * kill switches each answer with a file the page accepts and shows nothing for.
 */

const NOW = Date.parse("2026-11-03T06:00:00Z");
const chip = (text: string): TrendingChip => ({ text, sinceYear: 2025, a: 300, b: 120, field: "Computer Science" });
const good = (over: Partial<TrendingPayload> = {}): TrendingPayload => ({
  version: 1,
  asOf: "2026-11-03",
  generatedAt: "2026-11-03T03:17:20.000Z",
  validUntil: "2026-11-05T03:17:20.000Z",
  poolAsOf: "2026-11-02",
  disabled: false,
  groups: { global: { chips: ["retrieval-augmented generation", "AI literacy", "altermagnetism", "environmental DNA", "predictive coding", "green hydrogen production", "central bank digital currency", "plant microbiome engineering"].map(chip) }, in: { chips: [chip("explainable AI")] } },
  ...over,
});

function app(env: TrendingRouteEnv) {
  const a = new Hono<{ Bindings: TrendingRouteEnv }>();
  a.route("/api/v1/home", trendingRoutes);
  const call = (init?: RequestInit) => a.request("http://localhost/api/v1/home/trending", init, env);
  return { call };
}
const fileKv = (payload: unknown, opts: Parameters<typeof fakeKv>[0] = {}) => {
  const k = fakeKv({ now: () => NOW, ...opts });
  k.seed(TRENDING_KEYS.file, typeof payload === "string" ? payload : JSON.stringify(payload));
  return k;
};

afterEach(() => vi.useRealTimers());

describe("the route", () => {
  it("answers a fresh file as it is, with Cache-Control public and max-age=300, JSON, and no cookie", async () => {
    vi.useFakeTimers({ now: NOW });
    const k = fileKv(good());
    const res = await app({ CACHE: k.kv }).call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(res.headers.get("content-type")).toMatch(/^application\/json/);
    expect(res.headers.has("set-cookie")).toBe(false);
    expect(await res.json()).toEqual(good());
  });

  it("is open to everyone and the same for everyone: a cookie or a sign-in header changes nothing and is not answered with a cookie", async () => {
    vi.useFakeTimers({ now: NOW });
    const k = fileKv(good());
    const plain = await (await app({ CACHE: k.kv }).call()).text();
    const res = await app({ CACHE: k.kv }).call({ headers: { cookie: `sid=${"a".repeat(40)}`, authorization: "Bearer x", "accept-language": "hi-IN", "cf-connecting-ip": "203.0.113.9" } });
    expect(await res.text()).toBe(plain);
    expect(res.headers.has("set-cookie")).toBe(false);
  });

  it("reads KV once for a request (the flag and the file in one operation) and asks nothing else", async () => {
    vi.useFakeTimers({ now: NOW });
    const k = fileKv(good());
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await app({ CACHE: k.kv }).call();
    expect(k.log.gets).toEqual([[TRENDING_KEYS.off, TRENDING_KEYS.file]]);
    expect(k.log.puts).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled(); // never OpenAlex, never arXiv, on the request path
    fetchSpy.mockRestore();
  });

  it("asks the place that serves it to keep what it read for a minute (the kill switch is then effective in about a minute)", async () => {
    vi.useFakeTimers({ now: NOW });
    const k = fileKv(good());
    await app({ CACHE: k.kv }).call();
    expect(k.log.getOptions[0]).toMatchObject({ cacheTtl: 60 });
  });

  it("is not under /search or /chat, so it is outside their limit of 60 a minute", async () => {
    const used: string[] = [];
    const limiter = (name: string) => ({ limit: async () => (used.push(name), { success: true }) });
    const a = new Hono();
    a.use("/api/*", rateLimit());
    a.route("/api/v1/home", trendingRoutes);
    const env = { SEARCH_LIMITER: limiter("search"), API_LIMITER: limiter("api"), VERIFY_LIMITER: limiter("verify"), ASK_LIMITER: limiter("ask") };
    await a.request("http://localhost/api/v1/home/trending", {}, env);
    expect(used).toEqual(["api"]);
  });

  it("is not in the service worker: no rule of sw.js lets it handle this address", () => {
    const sw = readFileSync(fileURLToPath(new URL("../../../web/public/sw.js", import.meta.url)), "utf8");
    expect(sw).not.toMatch(/trending|home\//);
    const paperFile = new RegExp(/const paperFile = \/(.+)\/;/.exec(sw)![1]!);
    const readable = new Function("p", `return ${/const readable = \(p\) => (.+);\r?\n/.exec(sw)![1]!}`) as (p: string) => boolean;
    const isAsset = new Function("p", `return ${/const isAsset = \(p\) => (.+);\r?\n/.exec(sw)![1]!}`) as (p: string) => boolean;
    const path = "/api/v1/home/trending";
    expect([paperFile.test(path), readable(path), isAsset(path)]).toEqual([false, false, false]);
    // and a page request for it would not be answered as the page either: it is under /api/
    expect(path.startsWith("/api/")).toBe(true);
  });
});

describe("what it answers when there is nothing to show", () => {
  const nothing = (b: TrendingPayload) => {
    expect(parseTrending(JSON.parse(JSON.stringify(b)))).not.toBeNull(); // a file the page accepts
    expect(b.groups.global.chips).toEqual([]);
    expect(b.groups.in.chips).toEqual([]);
    expect(isFresh(b, NOW)).toBe(false); // already out of date: no page can call it trending
  };

  it("a missing file (KV miss)", async () => {
    vi.useFakeTimers({ now: NOW });
    const res = await app({ CACHE: fakeKv({ now: () => NOW }).kv }).call();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const b = (await res.json()) as TrendingPayload;
    expect(b.disabled).toBe(false);
    nothing(b);
  });

  it("no KV binding at all (a local run without one)", async () => {
    vi.useFakeTimers({ now: NOW });
    const b = (await (await app({}).call()).json()) as TrendingPayload;
    expect(b.disabled).toBe(false);
    nothing(b);
  });

  it("a KV that throws, from a rejected read or a thrown one: a 503 that nobody may keep (no-store), with an empty file the page would not show anyway, and the error is not shown", async () => {
    // a 200 with max-age=300 would be kept by a browser (and, with 'public', by anything between) for 5 minutes after a one-second blip, and the page would erase its device copy on seeing it:
    // the page ignores an answer that is not OK, and keeps its copy until the copy's own validUntil
    vi.useFakeTimers({ now: NOW });
    const err = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const kv of [fakeKv({ fail: () => { throw new Error("KV is down: secret detail"); } }).kv, { get: () => { throw new Error("sync boom"); } } as unknown as KVNamespace]) {
      const res = await app({ CACHE: kv }).call();
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.has("set-cookie")).toBe(false);
      const text = await res.text();
      expect(text).not.toMatch(/secret detail|boom/);
      nothing(JSON.parse(text));
    }
    err.mockRestore();
  });

  it("readTrending itself still answers an empty expired file for a store that throws (nothing is shown; it never throws)", async () => {
    vi.useFakeTimers({ now: NOW });
    const b = (await readTrending({ CACHE: fakeKv({ fail: () => { throw new Error("down"); } }).kv }, new Date(NOW))).payload;
    nothing(b);
    expect(b.disabled).toBe(false);
  });

  it("a miss, no KV binding and a stale file are still 200 with the usual max-age (only a store that cannot be read is not kept)", async () => {
    vi.useFakeTimers({ now: NOW });
    for (const env of [{ CACHE: fakeKv({ now: () => NOW }).kv }, {}, { CACHE: fileKv(good({ validUntil: "2026-11-03T05:00:00.000Z" })).kv }]) {
      const res = await app(env).call();
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    }
  });

  it("a stale file (past its validUntil) is not served as trending: the page is given no chips", async () => {
    const stale = good({ validUntil: "2026-11-03T05:59:59.000Z" });
    const b = (await readTrending({ CACHE: fileKv(stale).kv }, new Date(NOW))).payload;
    nothing(b);
    expect(b.disabled).toBe(false);
    // the second it expires
    expect((await readTrending({ CACHE: fileKv(good({ validUntil: "2026-11-03T06:00:01.000Z" })).kv }, new Date(NOW))).payload.groups.global.chips).toHaveLength(8);
    expect((await readTrending({ CACHE: fileKv(good({ validUntil: "2026-11-03T06:00:00.000Z" })).kv }, new Date(NOW))).payload.groups.global.chips).toHaveLength(0);
  });

  it("a file made from a weekly pool older than 14 days is not served as trending", async () => {
    // the page's rule is on time, not on days: the pool's day counts from its midnight, and it is 06:00 on the 3rd
    expect((await readTrending({ CACHE: fileKv(good({ poolAsOf: "2026-10-21" })).kv }, new Date(NOW))).payload.groups.global.chips).toHaveLength(8); // 13 days and 6 hours
    expect((await readTrending({ CACHE: fileKv(good({ poolAsOf: "2026-10-20" })).kv }, new Date(NOW))).payload.groups.global.chips).toHaveLength(0); // 14 days and 6 hours
  });

  it("a file that is not right (not JSON, wrong version, a bad chip, 13 chips, text that is not tidy) is treated as missing, and says so once in the log without its content", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const thirteen = good();
    thirteen.groups.global.chips = Array.from({ length: 13 }, (_, i) => chip(`phrase number ${i}`));
    for (const bad of ["not json {", JSON.stringify({ ...good(), version: 2 }), JSON.stringify(good({ asOf: "2026-02-31" })), JSON.stringify(thirteen), JSON.stringify(good({ groups: { global: { chips: [chip(`two${String.fromCharCode(0x200b)}words`)] }, in: { chips: [] } } })), "null", "[]", '"x"']) {
      const b = (await readTrending({ CACHE: fileKv(bad).kv }, new Date(NOW))).payload;
      nothing(b);
    }
    expect(warn).toHaveBeenCalled();
    for (const call of warn.mock.calls) expect(String(call[0])).not.toMatch(/phrase number|two/);
    warn.mockRestore();
  });
});

describe("the kill switch", () => {
  it("the KV flag trending:v1:off: disabled, no chips, even with a good file, and effective on the next read", async () => {
    vi.useFakeTimers({ now: NOW });
    const k = fileKv(good());
    const a = app({ CACHE: k.kv });
    expect(((await (await a.call()).json()) as TrendingPayload).groups.global.chips).toHaveLength(8);
    k.seed(TRENDING_KEYS.off, "1");
    const off = (await (await a.call()).json()) as TrendingPayload;
    expect(off.disabled).toBe(true);
    expect(off.groups.global.chips).toEqual([]);
    expect(parseTrending(off)).not.toBeNull();
    expect(isFresh(off, NOW)).toBe(false);
  });

  it("the flag is its presence: any value, even an empty one or 0, is off", async () => {
    vi.useFakeTimers({ now: NOW });
    for (const v of ["1", "", "0", "false", "on", "no"]) {
      const k = fileKv(good());
      k.seed(TRENDING_KEYS.off, v);
      expect(((await (await app({ CACHE: k.kv }).call()).json()) as TrendingPayload).disabled, JSON.stringify(v)).toBe(true);
    }
  });

  it("deleting the flag brings the list back", async () => {
    vi.useFakeTimers({ now: NOW });
    const k = fileKv(good());
    k.seed(TRENDING_KEYS.off, "1");
    const a = app({ CACHE: k.kv });
    expect(((await (await a.call()).json()) as TrendingPayload).disabled).toBe(true);
    await k.kv.delete(TRENDING_KEYS.off);
    expect(((await (await a.call()).json()) as TrendingPayload).groups.global.chips).toHaveLength(8);
  });

  it("the variable TRENDING=off: disabled, and KV is not even read", async () => {
    vi.useFakeTimers({ now: NOW });
    for (const v of ["off", "OFF", " Off "]) {
      const k = fileKv(good());
      const b = (await (await app({ CACHE: k.kv, TRENDING: v }).call()).json()) as TrendingPayload;
      expect(b.disabled, v).toBe(true);
      expect(b.groups.global.chips).toEqual([]);
      expect(k.log.gets).toHaveLength(0);
    }
  });

  it("any other value of the variable, or none, leaves the list on", async () => {
    vi.useFakeTimers({ now: NOW });
    for (const v of ["on", "", "1", "true", undefined]) {
      const b = (await (await app({ CACHE: fileKv(good()).kv, TRENDING: v }).call()).json()) as TrendingPayload;
      expect(b.disabled, String(v)).toBe(false);
      expect(b.groups.global.chips).toHaveLength(8);
    }
  });

  it("a flag and a variable together are still just disabled", async () => {
    vi.useFakeTimers({ now: NOW });
    const k = fileKv(good());
    k.seed(TRENDING_KEYS.off, "1");
    expect(((await (await app({ CACHE: k.kv, TRENDING: "off" }).call()).json()) as TrendingPayload).disabled).toBe(true);
  });
});

describe("TRENDING=dark: the launch state (the job runs and makes the list, the route hides it)", () => {
  it("answers disabled with no chips and does not read KV, for any case and spacing, although a good file is there", async () => {
    vi.useFakeTimers({ now: NOW });
    for (const v of ["dark", "DARK", " Dark "]) {
      const k = fileKv(good());
      const b = (await (await app({ CACHE: k.kv, TRENDING: v }).call()).json()) as TrendingPayload;
      expect(b.disabled, v).toBe(true);
      expect(b.groups.global.chips, v).toEqual([]);
      expect(isFresh(b, NOW), v).toBe(false);
      expect(k.log.gets, v).toHaveLength(0);
    }
  });

  it("the committed apps/api/wrangler.jsonc launches dark or off, or has no variable at all; a value the code does not know would leave the list free to show", () => {
    // wrangler.jsonc only has whole-line // comments (scripts/integration.mjs reads it the same way)
    const text = readFileSync(fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url)), "utf8");
    const cfg = JSON.parse(text.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n")) as { vars?: Record<string, string>; env?: Record<string, { vars?: Record<string, string> }> };
    for (const vars of [cfg.vars, cfg.env?.staging?.vars]) {
      const v = vars?.TRENDING;
      if (v !== undefined) expect(["dark", "off"], `TRENDING is ${JSON.stringify(v)}`).toContain(v);
    }
  });
});
