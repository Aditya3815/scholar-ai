import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Acquired } from "./core";
import { GateBusy, gatesOff, installGates, resetGates, withGate, type RemoteGate } from "./index";

const remote = (over: Partial<RemoteGate> = {}) => {
  const calls: string[] = [];
  const r: RemoteGate = {
    acquire: async (n) => (calls.push(`acquire ${n}`), { ok: true, lease: "L1" } satisfies Acquired),
    release: async (n, l) => void calls.push(`release ${n} ${l}`),
    closeUntil: async (n, t) => void calls.push(`close ${n} ${t}`),
    ...over,
  };
  return { r, calls };
};

beforeEach(() => resetGates({ crossref: { minIntervalMs: 0 }, core: { minIntervalMs: 0, window: undefined } }));
afterEach(() => vi.restoreAllMocks());

describe("withGate", () => {
  it("runs the call between acquire and release on the shared lane, and returns its result", async () => {
    const { r, calls } = remote();
    installGates(r);
    expect(await withGate("crossref", 100, async () => (calls.push("run"), 42))).toBe(42);
    expect(calls).toEqual(["acquire crossref", "run", "release crossref L1"]);
  });

  it("releases the place when the call throws", async () => {
    const { r, calls } = remote();
    installGates(r);
    await expect(withGate("crossref", 100, async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    expect(calls).toContain("release crossref L1");
  });

  it("closes the lane when the call asks for it, before releasing", async () => {
    const { r, calls } = remote();
    installGates(r);
    await withGate("core", 100, async (lane) => lane.closeUntil(123_456));
    expect(calls).toEqual(["acquire core", "close core 123456", "release core L1"]);
  });

  it("does not call the service when the lane turns the caller away, and says why", async () => {
    const { r } = remote({ acquire: async () => ({ ok: false, reason: "budget", retryInMs: 5 }) });
    installGates(r);
    const run = vi.fn();
    await expect(withGate("core", 100, run)).rejects.toMatchObject({ name: "Error", reason: "budget", gate: "core" });
    await expect(withGate("core", 100, run)).rejects.toBeInstanceOf(GateBusy);
    expect(run).not.toHaveBeenCalled();
  });

  it("falls back to the lane of this isolate when the shared one cannot be reached, and says so once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    installGates(remote({ acquire: async () => { throw new Error("DO down"); } }).r);
    expect(await withGate("crossref", 100, async () => "ok")).toBe("ok");
    expect(await withGate("crossref", 100, async () => "ok")).toBe("ok");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("a failing release or close does not fail the call", async () => {
    installGates(remote({ release: async () => { throw new Error("gone"); }, closeUntil: async () => { throw new Error("gone"); } }).r);
    expect(await withGate("core", 100, async (lane) => (lane.closeUntil(1), "fine"))).toBe("fine");
  });

  it("without a shared lane the isolate keeps its own: two at a time", async () => {
    resetGates({ crossref: { minIntervalMs: 0, maxConcurrent: 2 } });
    let running = 0;
    let peak = 0;
    const job = () =>
      withGate("crossref", 5_000, async () => {
        peak = Math.max(peak, ++running);
        await new Promise((r) => setTimeout(r, 10));
        running--;
      });
    await Promise.all(Array.from({ length: 8 }, job));
    expect(peak).toBe(2);
  });

  it("is turned off for tests and the eval", async () => {
    gatesOff();
    let running = 0;
    let peak = 0;
    await Promise.all(Array.from({ length: 6 }, () => withGate("core", 0, async () => { peak = Math.max(peak, ++running); await new Promise((r) => setTimeout(r, 5)); running--; })));
    expect(peak).toBe(6);
  });
});
