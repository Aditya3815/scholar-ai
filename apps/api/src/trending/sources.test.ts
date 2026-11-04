import { describe, expect, it, vi } from "vitest";
import { BudgetError, CallBudget, SourceError, getText, makePacer, mapLimit, type Http } from "./sources";

/**
 * The plumbing under every call the Trending job makes to OpenAlex and arXiv: a call budget that stops a loop, a timeout on every call, one retry for what is worth retrying and a clear
 * failure for the rest, a pause between arXiv requests, and a bounded number of calls at once.
 */

const ok = (body = "{}") => new Response(body, { status: 200 });
const http = (fetchImpl: (url: string, init?: RequestInit) => Promise<Response>, over: Partial<Http> = {}): Http => ({
  fetch: fetchImpl as unknown as typeof fetch,
  sleep: async () => {},
  timeoutMs: 1000,
  retries: 1,
  retryWaitMs: 5,
  maxRetryWaitMs: 10_000,
  ...over,
});

describe("CallBudget", () => {
  it("counts calls and refuses the one that would go over the limit, saying so", () => {
    const b = new CallBudget(3, "OpenAlex calls");
    b.take();
    b.take(2);
    expect(b.used).toBe(3);
    expect(b.left).toBe(0);
    expect(() => b.take()).toThrow(BudgetError);
    expect(b.used).toBe(3);
  });
  it("refuses a call that costs more than is left without using any of it", () => {
    const b = new CallBudget(10, "x");
    b.take(4);
    expect(() => b.take(7)).toThrow(/budget/i);
    expect(b.used).toBe(4);
  });
  it("a limit that is not a number allows nothing", () => {
    expect(() => new CallBudget(NaN, "x").take()).toThrow(BudgetError);
  });
});

describe("getText", () => {
  it("returns the body of a good answer and uses one call of the budget", async () => {
    const budget = new CallBudget(5, "calls");
    expect(await getText(http(async () => ok("hello")), "openalex", "https://example.org/x", {}, budget)).toBe("hello");
    expect(budget.used).toBe(1);
  });

  it("gives every call a timeout signal", async () => {
    let signal: AbortSignal | null | undefined;
    await getText(http(async (_u, init) => ((signal = init?.signal), ok())), "openalex", "https://example.org/x", {}, new CallBudget(5, "c"));
    expect(signal).toBeInstanceOf(AbortSignal);
  });

  it("fails clearly on a timeout after its one retry, and each try is a call of the budget", async () => {
    const budget = new CallBudget(5, "calls");
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("The operation timed out", "TimeoutError");
    });
    const err = await getText(http(fetchImpl), "arxiv", "https://example.org/x", {}, budget).catch((e) => e);
    expect(err).toBeInstanceOf(SourceError);
    expect(err).toMatchObject({ source: "arxiv", kind: "timeout" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(budget.used).toBe(2);
  });

  it("retries once on a 5xx and on a 429 that asks for a short wait, and then answers", async () => {
    const waits: number[] = [];
    const answers = [new Response("busy", { status: 503 }), new Response("slow down", { status: 429, headers: { "retry-after": "2" } }), ok("fine")];
    const h = http(async () => answers.shift()!, { retries: 2, sleep: async (ms) => void waits.push(ms) });
    expect(await getText(h, "openalex", "https://example.org/x", {}, new CallBudget(5, "c"))).toBe("fine");
    expect(waits).toEqual([5, 2000]);
  });

  it("does not retry a 429 that asks for a long wait (the day's allowance is used up): it fails at once", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 429, headers: { "retry-after": "34897" } }));
    const err = await getText(http(fetchImpl), "openalex", "https://example.org/x", {}, new CallBudget(5, "c")).catch((e) => e);
    expect(err).toMatchObject({ source: "openalex", kind: "http", status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 400 or a 404: that is the request's fault", async () => {
    for (const status of [400, 404]) {
      const fetchImpl = vi.fn(async () => new Response("no", { status }));
      const err = await getText(http(fetchImpl), "openalex", "https://example.org/x", {}, new CallBudget(5, "c")).catch((e) => e);
      expect(err).toMatchObject({ kind: "http", status });
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("stops at the budget, before the call that would go over it", async () => {
    const fetchImpl = vi.fn(async () => ok());
    const budget = new CallBudget(2, "calls");
    await getText(http(fetchImpl), "openalex", "https://example.org/x", {}, budget);
    await getText(http(fetchImpl), "openalex", "https://example.org/x", {}, budget);
    await expect(getText(http(fetchImpl), "openalex", "https://example.org/x", {}, budget)).rejects.toBeInstanceOf(BudgetError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("never puts the address of the call (it can carry an API key) in the error", async () => {
    const err = await getText(http(async () => new Response("", { status: 500 }), { retries: 0 }), "openalex", "https://api.openalex.org/works?api_key=SECRET123&mailto=a@b.org", {}, new CallBudget(5, "c")).catch((e) => e);
    expect(String(err.message)).not.toMatch(/SECRET123|api_key|a@b\.org|openalex\.org\/works/);
  });

  it("a network failure is an error of its own kind, with no message from the failure in it", async () => {
    const err = await getText(http(async () => { throw new TypeError("fetch failed for https://x?api_key=SECRET"); }, { retries: 0 }), "openalex", "https://example.org/x", {}, new CallBudget(5, "c")).catch((e) => e);
    expect(err).toMatchObject({ kind: "network" });
    expect(String(err.message)).not.toMatch(/SECRET/);
  });
});

describe("makePacer", () => {
  it("lets the first call go at once and holds each later one until the gap since the last start has passed", async () => {
    let t = 1000;
    const waits: number[] = [];
    const pace = makePacer(3100, () => t, async (ms) => { waits.push(ms); t += ms; });
    await pace(); // 1000: first, no wait
    t += 500;
    await pace(); // 600 ms after the last start's gap... waits 3100 - 500
    t += 5000;
    await pace(); // more than the gap since the last: no wait
    expect(waits).toEqual([2600]);
  });
  it("two calls started together are still 3.1 seconds apart", async () => {
    let t = 0;
    const starts: number[] = [];
    const pace = makePacer(3100, () => t, async (ms) => void (t += ms));
    for (let i = 0; i < 4; i++) {
      await pace();
      starts.push(t);
    }
    expect(starts).toEqual([0, 3100, 6200, 9300]);
  });
});

describe("mapLimit", () => {
  it("never has more than the limit in flight, and keeps the order of the answers", async () => {
    let flying = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      peak = Math.max(peak, ++flying);
      await new Promise((r) => setTimeout(r, 5 - Math.min(n, 4)));
      flying--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBe(3);
  });
  it("stops starting new work after the first failure and rejects with it", async () => {
    const started: number[] = [];
    const err = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      started.push(n);
      await new Promise((r) => setTimeout(r, 2));
      if (n === 2) throw new Error("boom");
      return n;
    }).catch((e) => e);
    expect(err).toEqual(new Error("boom"));
    expect(started.length).toBeLessThan(6);
  });
  it("an empty list is an empty answer, and a limit under one still runs", async () => {
    expect(await mapLimit([], 3, async (n) => n)).toEqual([]);
    expect(await mapLimit([1, 2], 0, async (n) => n)).toEqual([1, 2]);
  });
});
