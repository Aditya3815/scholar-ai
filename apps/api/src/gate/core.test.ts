import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GateCore, Scheduler, freshState, type GateConfig } from "./core";

const cfg = (c: Partial<GateConfig> = {}): GateConfig => ({ minIntervalMs: 0, maxConcurrent: 1_000, leaseMs: 10_000, ...c });
const DAY = 86_400_000;

describe("Scheduler", () => {
  it("starts calls at least minIntervalMs apart", () => {
    const s = new Scheduler(cfg({ minIntervalMs: 350 }));
    expect(s.take(1_000).ok).toBe(true);
    expect(s.take(1_100)).toMatchObject({ ok: false, reason: "wait", retryInMs: 250 });
    expect(s.take(1_350).ok).toBe(true);
    expect(s.take(1_349)).toMatchObject({ ok: false });
  });

  it("allows only maxConcurrent calls in flight and frees a place on release", () => {
    const s = new Scheduler(cfg({ maxConcurrent: 2 }));
    const a = s.take(0);
    const b = s.take(0);
    expect(a.ok && b.ok).toBe(true);
    expect(s.take(1)).toMatchObject({ ok: false, reason: "concurrency" });
    if (a.ok) s.release(a.lease);
    expect(s.take(2).ok).toBe(true);
    expect(s.inFlight()).toBe(2);
  });

  it("stops counting a call that never reported back once its lease ran out", () => {
    const s = new Scheduler(cfg({ maxConcurrent: 1, leaseMs: 5_000 }));
    expect(s.take(0).ok).toBe(true);
    expect(s.take(4_999).ok).toBe(false);
    expect(s.take(5_000).ok).toBe(true);
  });

  it("keeps to a per-minute allowance: nine starts, then the next place opens when the first leaves the window", () => {
    const s = new Scheduler(cfg({ window: { max: 9, ms: 60_000 } }));
    for (let i = 0; i < 9; i++) {
      const r = s.take(1_000 + i * 100);
      expect(r.ok).toBe(true);
      if (r.ok) s.release(r.lease);
    }
    expect(s.take(5_000)).toMatchObject({ ok: false, reason: "wait", retryInMs: 1_000 + 60_000 - 5_000 });
    expect(s.take(61_000).ok).toBe(true);
    expect(s.take(61_050)).toMatchObject({ ok: false, reason: "wait", retryInMs: 50 }); // nine starts are inside the last minute again; the next leaves it at 61,100
  });

  it("refuses for the rest of the day when the daily allowance is used, and starts again at midnight UTC", () => {
    const s = new Scheduler(cfg({ dailyBudget: 3 }));
    const t = 5 * DAY + 10_000;
    for (let i = 0; i < 3; i++) {
      const r = s.take(t + i);
      expect(r.ok).toBe(true);
      if (r.ok) s.release(r.lease);
    }
    expect(s.take(t + 10)).toMatchObject({ ok: false, reason: "budget", retryInMs: 6 * DAY - (t + 10) });
    expect(s.take(6 * DAY).ok).toBe(true);
  });

  it("closes when the service says so, and opens when that time has passed", () => {
    const s = new Scheduler(cfg());
    s.closeUntil(10_000);
    expect(s.take(9_000)).toMatchObject({ ok: false, reason: "closed", retryInMs: 1_000 });
    expect(s.take(10_000).ok).toBe(true);
    s.closeUntil(500); // never shortens
    s.closeUntil(20_000);
    s.closeUntil(15_000);
    expect(s.take(12_000).ok).toBe(false);
  });

  it("continues from saved state (a restarted lane does not forget what was spent)", () => {
    const first = new Scheduler(cfg({ dailyBudget: 2, window: { max: 5, ms: 60_000 } }));
    const t = 3 * DAY + 1;
    for (let i = 0; i < 2; i++) {
      const r = first.take(t + i);
      if (r.ok) first.release(r.lease);
    }
    const again = new Scheduler(cfg({ dailyBudget: 2, window: { max: 5, ms: 60_000 } }), first.state());
    expect(again.take(t + 100)).toMatchObject({ ok: false, reason: "budget" });
  });

  it("does not let the state it hands out be changed from outside", () => {
    const s = new Scheduler(cfg({ window: { max: 5, ms: 1_000 } }));
    s.take(1);
    const snap = s.state();
    snap.starts.push(999);
    snap.used = 50;
    expect(s.state().starts).toEqual([1]);
    expect(s.state().used).toBe(1);
  });
});

describe("GateCore", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const core = (c: Partial<GateConfig>, save?: (s: unknown) => void) =>
    new GateCore(cfg(c), { now: () => Date.now(), sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)), save }, freshState());

  it("serves callers in the order they came, one interval apart", async () => {
    const g = core({ minIntervalMs: 100 });
    const started: number[] = [];
    const t0 = Date.now();
    const jobs = [0, 1, 2, 3].map((i) =>
      g.acquire(5_000).then((a) => {
        expect(a.ok).toBe(true);
        started[i] = Date.now() - t0;
        if (a.ok) g.release(a.lease);
      }),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.all(jobs);
    expect(started).toEqual([0, 100, 200, 300]);
  });

  it("makes a caller wait for a place when too many are in flight, and wakes it when one is released", async () => {
    const g = core({ maxConcurrent: 1 });
    const first = await g.acquire(1_000);
    expect(first.ok).toBe(true);
    let second: Awaited<ReturnType<typeof g.acquire>> | undefined;
    const p = g.acquire(1_000).then((r) => (second = r));
    await vi.advanceTimersByTimeAsync(200);
    expect(second).toBeUndefined();
    if (first.ok) g.release(first.lease);
    await vi.advanceTimersByTimeAsync(30);
    expect(second?.ok).toBe(true);
    await p;
  });

  it("turns a caller away at once when its wait would be longer than it can give, and does not keep its place in the line", async () => {
    const g = core({ minIntervalMs: 10_000 });
    expect((await g.acquire(0)).ok).toBe(true);
    const t = Date.now();
    const refused = await g.acquire(2_000);
    expect(refused).toMatchObject({ ok: false, reason: "busy" });
    expect(Date.now() - t).toBe(0);
    // the line is empty again: a caller with enough patience is served after the interval
    const later = g.acquire(11_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await later).ok).toBe(true);
  });

  it("gives up after maxWaitMs when the places stay taken", async () => {
    const g = core({ maxConcurrent: 1, leaseMs: 60_000 });
    await g.acquire(0);
    const p = g.acquire(300);
    await vi.advanceTimersByTimeAsync(400);
    expect(await p).toMatchObject({ ok: false, reason: "busy" });
  });

  it("says why when the daily allowance is gone or the service closed the lane", async () => {
    const g = core({ dailyBudget: 1 });
    const a = await g.acquire(0);
    if (a.ok) g.release(a.lease);
    expect(await g.acquire(1_000)).toMatchObject({ ok: false, reason: "budget" });
    const h = core({});
    await h.closeUntil(Date.now() + 5_000);
    expect(await h.acquire(1_000)).toMatchObject({ ok: false, reason: "closed" });
  });

  it("saves its state after every start and every closing", async () => {
    const saved: unknown[] = [];
    const g = core({ dailyBudget: 10 }, (s) => void saved.push(s));
    await g.acquire(0);
    await g.closeUntil(Date.now() + 1_000);
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ used: 1 });
  });
});
