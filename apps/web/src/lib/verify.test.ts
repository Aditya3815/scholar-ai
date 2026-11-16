import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeNet, json, offline, problem, type Net } from "../test/fake-net";
import { render, unmount } from "../test/fake-react";

/**
 * Check references (useVerify), as it was before the one browser client (docs/design/untangle.md, F9): one request per reference, a 429 waits what Retry-After says (20 s without it, 60 s at
 * most) and is tried three times in all, any other failure is tried once more after 0.6 s unless the server refused it (a 4xx), and the words shown for each. Bug B2 is below.
 */

vi.mock("react", async () => (await import("../test/fake-react")).react);
const { useVerify } = await import("./verify");

let net: Net;
let delays: number[];
beforeEach(() => {
  net = fakeNet();
  delays = [];
  vi.useFakeTimers();
  (globalThis as unknown as { window: unknown }).window = {
    setTimeout: (fn: () => void, ms: number) => (delays.push(ms), setTimeout(fn, ms)),
    clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
  };
});
afterEach(() => {
  unmount();
  vi.useRealTimers();
});

const VERDICT = { status: "verified", input: "x" };
const check = async (...entries: string[]) => {
  const p = render(() => useVerify()).start(entries);
  for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(10_000);
  await p;
  return render(() => useVerify()).state;
};

describe("useVerify", () => {
  it("one POST per reference; the verdicts in the order of the list", async () => {
    net.reply = (c) => json({ ...VERDICT, n: (c.body as { reference: string }).reference });
    const state = await check("Ref A", "Ref B");
    expect(net.calls.map(({ url, method, headers, body, credentials, signal }) => ({ url, method, headers, body, credentials, signal }))).toEqual([
      { url: "/api/v1/references/verify", method: "POST", headers: { "content-type": "application/json" }, body: { reference: "Ref A" }, credentials: "same-origin", signal: true },
      { url: "/api/v1/references/verify", method: "POST", headers: { "content-type": "application/json" }, body: { reference: "Ref B" }, credentials: "same-origin", signal: true },
    ]);
    expect(state.items.map((i) => [i.state, i.verdict?.input])).toEqual([["done", "Ref A"], ["done", "Ref B"]]);
    expect(state.running).toBe(false);
  });

  it("a 429 waits what Retry-After says, at most 60 s, 20 s without it; three tries in all, then the words for it", async () => {
    net.reply = (_c, n) => (n === 1 ? problem(429, {}, { "Retry-After": "5" }) : n === 2 ? problem(429, {}, { "Retry-After": "120" }) : n === 3 ? problem(429, {}) : json(VERDICT));
    let state = await check("A");
    expect(net.calls).toHaveLength(3);
    expect(delays.filter((d) => d > 1000).map((d) => Math.round(d / 1000))).toEqual([5, 60]);
    expect(state.items[0]).toMatchObject({ state: "error", error: "Too many requests at once. Wait a minute, then re-check." });
    net.calls = [];
    delays = [];
    net.reply = (_c, n) => (n === 1 ? problem(429, "") : json(VERDICT));
    state = await check("A");
    expect(delays.filter((d) => d > 1000).map((d) => Math.round(d / 1000))).toEqual([20]);
    expect(state.items[0]!.state).toBe("done");
  });

  it("a 5xx or a lost connection is tried once more after 0.6 s; then its words: the detail, the status, or the network's message", async () => {
    net.reply = (_c, n) => (n === 1 ? problem(503, "x") : json(VERDICT));
    expect((await check("A")).items[0]!.state).toBe("done");
    expect(delays).toEqual([600]);
    net.calls = [];
    net.reply = () => problem(500, { type: "check_failed", title: "Check failed", detail: "The databases did not answer" });
    expect((await check("A")).items[0]).toMatchObject({ state: "error", error: "The databases did not answer" });
    expect(net.calls).toHaveLength(2);
    net.reply = () => problem(502, "");
    expect((await check("A")).items[0]!.error).toBe("The service answered 502");
    net.calls = [];
    net.reply = () => offline();
    expect((await check("A")).items[0]!.error).toBe("Failed to fetch");
    expect(net.calls).toHaveLength(2);
  });

  it("a refusal without a detail (a 4xx) is not tried again", async () => {
    net.reply = () => problem(400, { type: "invalid_reference", title: "That is not a reference" });
    expect((await check("A")).items[0]).toMatchObject({ state: "error", error: "The service answered 400" });
    expect(net.calls).toHaveLength(1);
  });
});
