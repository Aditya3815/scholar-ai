import { describe, expect, it, vi } from "vitest";
import { AllProvidersFailedError, createGateway, extractJson, type GatewayConfig } from "./gateway";
import { DEFAULT_CONFIG } from "./config";
import { NoRouteError, PolicyError, QuotaError, assertAllowed, selectChain } from "./policy";
import { geminiProvider } from "./providers/gemini";
import type { Ledger, LlmProvider, LlmRequest, ProviderResponse, ResponseCache, UsageRow } from "./types";

const ok = (text = "hello"): ProviderResponse => ({ text, tokensIn: 10, tokensOut: 5 });

function fakeProvider(id: string, privateOk: boolean, impl: () => Promise<ProviderResponse> = async () => ok()) {
  const complete = vi.fn(impl);
  return { id, privateOk, complete } satisfies LlmProvider;
}

function fakeLedger(used = 0) {
  const rows: UsageRow[] = [];
  const ledger: Ledger = {
    tokensToday: async () => used,
    record: async (r) => void rows.push(r),
  };
  return { ledger, rows };
}

function fakeCache() {
  const store = new Map<string, string>();
  const set = vi.fn(async (k: string, v: string) => void store.set(k, v));
  const cache: ResponseCache = { get: async (k) => store.get(k) ?? null, set };
  return { cache, set, store };
}

const config = (routes: GatewayConfig["routes"]): GatewayConfig => ({
  routes,
  dailyTokenQuota: 1000,
  perCallTimeoutMs: 5000,
  publicCacheTtlSeconds: 60,
  maxPromptChars: 10_000,
});

const allTasks = ["classify", "summarize_public", "qa", "review", "verify"] as const;
const sameRoute = (chain: { provider: string; model: string }[]) =>
  Object.fromEntries(allTasks.map((t) => [t, { public: chain, private: chain }])) as GatewayConfig["routes"];

const req = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  task: "qa",
  sensitivity: "private",
  subject: "user-1",
  system: "sys",
  user: "usr",
  ...over,
});

describe("privacy policy (private data never reaches non-private providers)", () => {
  it("skips a non-private provider even when it is first in the route", async () => {
    const gemini = fakeProvider("gemini", false);
    const wai = fakeProvider("workersai", true);
    const { ledger } = fakeLedger();
    const gw = createGateway({
      providers: { gemini, workersai: wai },
      ledger,
      config: config(sameRoute([{ provider: "gemini", model: "g" }, { provider: "workersai", model: "w" }])),
    });
    const r = await gw.complete(req({ sensitivity: "private" }));
    expect(r.provider).toBe("workersai");
    expect(gemini.complete).not.toHaveBeenCalled();
  });

  it("fails with NoRouteError (never downgrades) when only non-private providers are configured", async () => {
    const gemini = fakeProvider("gemini", false);
    const { ledger } = fakeLedger();
    const gw = createGateway({ providers: { gemini }, ledger, config: config(sameRoute([{ provider: "gemini", model: "g" }])) });
    await expect(gw.complete(req({ sensitivity: "private" }))).rejects.toBeInstanceOf(NoRouteError);
    expect(gemini.complete).not.toHaveBeenCalled();
  });

  it("assertAllowed throws PolicyError for private + non-private provider", () => {
    expect(() => assertAllowed(fakeProvider("x", false), "private")).toThrow(PolicyError);
    expect(() => assertAllowed(fakeProvider("x", false), "public")).not.toThrow();
    expect(() => assertAllowed(fakeProvider("x", true), "private")).not.toThrow();
  });

  it("the real Gemini provider is flagged non-private (unpaid AI Studio tier trains on prompts)", () => {
    expect(geminiProvider("test-key").privateOk).toBe(false);
  });

  it("every PRIVATE route in the shipped config resolves only to privateOk providers", () => {
    const providers = {
      workersai: { id: "workersai", privateOk: true, complete: async () => ok() },
      gemini: { id: "gemini", privateOk: false, complete: async () => ok() },
    } satisfies Record<string, LlmProvider>;
    for (const task of allTasks) {
      const chain = DEFAULT_CONFIG.routes[task].private;
      expect(chain.length, `${task} has a private route`).toBeGreaterThan(0);
      for (const { provider } of selectChain(chain, "private", providers)) expect(provider.privateOk).toBe(true);
      expect(chain.some((r) => r.provider === "gemini"), `${task}: gemini must not be in a private chain`).toBe(false);
    }
  });
});

describe("routing, fallback and structured output", () => {
  it("uses non-private providers for public requests", async () => {
    const gemini = fakeProvider("gemini", false);
    const { ledger } = fakeLedger();
    const gw = createGateway({ providers: { gemini }, ledger, config: config(sameRoute([{ provider: "gemini", model: "g" }])) });
    const r = await gw.complete(req({ sensitivity: "public", task: "classify" }));
    expect(r.provider).toBe("gemini");
  });

  it("falls back to the next provider and reports the attempts", async () => {
    const bad = fakeProvider("a", true, async () => { throw new Error("HTTP 429"); });
    const good = fakeProvider("b", true);
    const { ledger, rows } = fakeLedger();
    const gw = createGateway({ providers: { a: bad, b: good }, ledger, config: config(sameRoute([{ provider: "a", model: "m1" }, { provider: "b", model: "m2" }])) });
    const r = await gw.complete(req());
    expect(r.provider).toBe("b");
    expect(r.attempts.map((x) => [x.provider, x.ok])).toEqual([["a", false], ["b", true]]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ provider: "b", ok: true, tokensIn: 10, tokensOut: 5, sensitivity: "private" });
  });

  it("treats invalid JSON as a failed attempt and moves on; returns parsed JSON", async () => {
    const bad = fakeProvider("a", true, async () => ok("<|channel|>final answerable=true"));
    const good = fakeProvider("b", true, async () => ok('Here you go: {"answerable": true, "answer": "28.4"}'));
    const { ledger } = fakeLedger();
    const gw = createGateway({ providers: { a: bad, b: good }, ledger, config: config(sameRoute([{ provider: "a", model: "m" }, { provider: "b", model: "m" }])) });
    const r = await gw.complete(req({ schema: { type: "object" } }));
    expect(r.provider).toBe("b");
    expect(r.json).toEqual({ answerable: true, answer: "28.4" });
  });

  it("throws AllProvidersFailedError and records a failure row when everything fails", async () => {
    const bad = fakeProvider("a", true, async () => { throw new Error("boom"); });
    const { ledger, rows } = fakeLedger();
    const gw = createGateway({ providers: { a: bad }, ledger, config: config(sameRoute([{ provider: "a", model: "m" }])) });
    await expect(gw.complete(req())).rejects.toBeInstanceOf(AllProvidersFailedError);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ok).toBe(false);
  });

  it("extractJson handles prose and fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson("x [1,2] y")).toEqual([1, 2]);
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("quota and cache", () => {
  it("rejects when the daily token quota is used up, without calling any provider", async () => {
    const p = fakeProvider("a", true);
    const { ledger } = fakeLedger(1000);
    const gw = createGateway({ providers: { a: p }, ledger, config: config(sameRoute([{ provider: "a", model: "m" }])) });
    await expect(gw.complete(req())).rejects.toBeInstanceOf(QuotaError);
    expect(p.complete).not.toHaveBeenCalled();
  });

  it("caches PUBLIC responses but never stores PRIVATE ones", async () => {
    const p = fakeProvider("a", true);
    const { ledger } = fakeLedger();
    const { cache, set } = fakeCache();
    const gw = createGateway({ providers: { a: p }, ledger, cache, config: config(sameRoute([{ provider: "a", model: "m" }])) });

    await gw.complete(req({ sensitivity: "public" }));
    const second = await gw.complete(req({ sensitivity: "public" }));
    expect(second.cached).toBe(true);
    expect(p.complete).toHaveBeenCalledTimes(1);

    set.mockClear();
    await gw.complete(req({ sensitivity: "private", user: "my secret manuscript text" }));
    await gw.complete(req({ sensitivity: "private", user: "my secret manuscript text" }));
    expect(p.complete).toHaveBeenCalledTimes(3); // private: no cache hit
    expect(set).not.toHaveBeenCalled(); // and nothing private was written to the cache
  });

  it("rejects oversized prompts", async () => {
    const p = fakeProvider("a", true);
    const { ledger } = fakeLedger();
    const gw = createGateway({ providers: { a: p }, ledger, config: config(sameRoute([{ provider: "a", model: "m" }])) });
    await expect(gw.complete(req({ user: "x".repeat(20_000) }))).rejects.toThrow(/too long/);
  });
});
