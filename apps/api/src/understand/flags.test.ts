import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FLAG_CACHE_MS, FLAG_KV_TIMEOUT_MS, flagKey, flagOf, positionOfVariable, resetFlagCache, type FlagCache, type FlagPosition } from "./flags";

/**
 * Gate flags (docs/design/intent-and-state.md, P3 and H0 item 1). The variable says where a flag starts; a KV override, `flag:<NAME>` in the same namespace as the public cache and the Trending switch,
 * can only lower it. What these tests pin, and why each is worth a test: an unset or misspelt variable must never turn new behaviour on (a typo is off, and counted); a KV value must never raise
 * (a tripwire is a one-way ratchet); a KV that cannot be read must change nothing and never throw (the chat path awaits this); the answer of KV is kept for 30 seconds and not a moment more.
 */

const T0 = 1_700_000_000_000;

/** A clock the test moves. */
function clock(start = T0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms), set: (v: number) => void (t = v) };
}

/** KV with only what flagOf may use. `get` and `put` are spies; a value in `data` is returned as it is, so a test can put a number or an object where KV would never. */
function fakeKv(data: Record<string, unknown> = {}) {
  const get = vi.fn(async (key: string, _options?: unknown) => (key in data ? data[key] : null));
  const put = vi.fn(async () => undefined);
  return { kv: { get, put } as unknown as KVNamespace, get, put, data };
}

const deps = () => {
  const c = clock();
  const cache: FlagCache = new Map();
  return { c, cache, now: c.now };
};

describe("the variable", () => {
  it("is off when it is not set (P3: unset is off), and that is not a bad value", async () => {
    for (const env of [{}, { CHAT_X: undefined }, { CHAT_X: null }]) {
      expect(await flagOf(env, "CHAT_X")).toEqual({ position: "off", variable: "off", badVariable: false, override: null, badOverride: false, kvUnreadable: false });
    }
  });

  it("reads off, shadow and on, spelt exactly", async () => {
    for (const p of ["off", "shadow", "on"] as const) {
      const r = await flagOf({ CHAT_X: p }, "CHAT_X");
      expect(r).toMatchObject({ position: p, variable: p, badVariable: false });
    }
  });

  it("reads the name it is asked for and no other", async () => {
    expect((await flagOf({ CHAT_X: "on", CHAT_Y: "shadow" }, "CHAT_Y")).position).toBe("shadow");
    expect((await flagOf({ CHAT_X: "on" }, "CHAT_Y")).position).toBe("off");
  });

  // The strict reading, chosen on purpose: a flag turns behaviour on, so a value that is not exactly a position must not (a lenient reading would turn "ON" on in the Worker while the committed
  // config check of legal-match.test.ts, which reads it the same strict way, says the privacy sentence for it must be absent). The cost is that "ON" is off and counted, which is the safe way to be wrong.
  it.each([
    ["ON"], ["On"], ["oN"], ["OFF"], ["Off"], ["Shadow"], ["SHADOW"],
    [" on"], ["on "], ["on\n"], ["shadow "], ["\ton"],
    ["true"], ["false"], ["1"], ["0"], ["yes"], ["enabled"], ["core"],
    [""], [" "], ["banana"], ["on,shadow"], ["on shadow"],
    [true], [false], [1], [0], [{}], [[]], [["on"]],
  ])("is off, and a bad value, for %j", async (value) => {
    const r = await flagOf({ CHAT_X: value }, "CHAT_X");
    expect(r).toMatchObject({ position: "off", variable: "off", badVariable: true });
  });

  it("takes core only for a flag whose caller says it has one (the safety lane), and for no other", async () => {
    expect(await flagOf({ CHAT_SAFETY: "core" }, "CHAT_SAFETY", { allowCore: true })).toMatchObject({ position: "core", variable: "core", badVariable: false });
    expect(await flagOf({ CHAT_SAFETY: "core" }, "CHAT_SAFETY")).toMatchObject({ position: "off", badVariable: true });
    expect(await flagOf({ CHAT_SAFETY: "core" }, "CHAT_SAFETY", { allowCore: false })).toMatchObject({ position: "off", badVariable: true });
    // the other three positions read the same with and without it
    for (const p of ["off", "shadow", "on"] as const) {
      expect((await flagOf({ F: p }, "F", { allowCore: true })).position).toBe(p);
    }
  });

  it("is read by one pure function that the disclosure test shares, so that 'on' means the same in the config check as in the Worker", () => {
    expect(positionOfVariable("on", false)).toEqual({ position: "on", bad: false });
    expect(positionOfVariable(undefined, false)).toEqual({ position: "off", bad: false });
    expect(positionOfVariable("ON", false)).toEqual({ position: "off", bad: true });
    expect(positionOfVariable("core", true)).toEqual({ position: "core", bad: false });
    expect(positionOfVariable("core", false)).toEqual({ position: "off", bad: true });
  });
});

describe("the KV override: it can only lower", () => {
  // every pair, written out (not computed from the order, which would repeat the code's own rule): rows are the variable, columns the override
  const THREE: Record<string, Record<string, FlagPosition>> = {
    off: { off: "off", shadow: "off", on: "off" },
    shadow: { off: "off", shadow: "shadow", on: "shadow" },
    on: { off: "off", shadow: "shadow", on: "on" },
  };
  for (const [variable, row] of Object.entries(THREE)) {
    for (const [override, expected] of Object.entries(row)) {
      it(`variable ${variable} with override ${override} stands at ${expected}`, async () => {
        const { kv } = fakeKv({ [flagKey("CHAT_X")]: override });
        const d = deps();
        const r = await flagOf({ CHAT_X: variable, CACHE: kv }, "CHAT_X", d);
        expect(r.position).toBe(expected);
        expect(r.variable).toBe(variable);
        expect(r.badVariable).toBe(false);
        expect(r.badOverride).toBe(false);
        expect(r.kvUnreadable).toBe(false);
      });
    }
  }

  // with core (the safety lane): off < shadow < core < on, so a tripwire can take on back to core (plan 4.5, "lowers the flag to core"), which the list in 4.2 leaves out
  const FOUR: Record<string, Record<string, FlagPosition>> = {
    off: { off: "off", shadow: "off", core: "off", on: "off" },
    shadow: { off: "off", shadow: "shadow", core: "shadow", on: "shadow" },
    core: { off: "off", shadow: "shadow", core: "core", on: "core" },
    on: { off: "off", shadow: "shadow", core: "core", on: "on" },
  };
  for (const [variable, row] of Object.entries(FOUR)) {
    for (const [override, expected] of Object.entries(row)) {
      it(`core allowed: variable ${variable} with override ${override} stands at ${expected}`, async () => {
        const { kv } = fakeKv({ [flagKey("CHAT_SAFETY")]: override });
        const r = await flagOf({ CHAT_SAFETY: variable, CACHE: kv }, "CHAT_SAFETY", { allowCore: true, ...deps() });
        expect(r.position).toBe(expected);
        expect(r.badVariable).toBe(false);
        expect(r.badOverride).toBe(false);
      });
    }
  }

  it("never raises: an override above the variable changes nothing, and it is still reported as what it was", async () => {
    const { kv } = fakeKv({ [flagKey("CHAT_X")]: "on" });
    const r = await flagOf({ CHAT_X: "shadow", CACHE: kv }, "CHAT_X", deps());
    expect(r).toEqual({ position: "shadow", variable: "shadow", badVariable: false, override: "on", badOverride: false, kvUnreadable: false });
  });

  it("does not read KV at all when the variable is off, because nothing can be lowered below it (today's Worker, every flag unset, makes no KV read)", async () => {
    const { kv, get } = fakeKv({ [flagKey("CHAT_X")]: "on" });
    const d = deps();
    expect((await flagOf({ CACHE: kv }, "CHAT_X", d)).position).toBe("off");
    expect((await flagOf({ CHAT_X: "off", CACHE: kv }, "CHAT_X", d)).position).toBe("off");
    expect((await flagOf({ CHAT_X: "ON", CACHE: kv }, "CHAT_X", d)).position).toBe("off");
    expect(get).not.toHaveBeenCalled();
    expect(d.cache.size).toBe(0);
  });

  it("treats an override for a position the flag does not have (core on a flag with no core) as a bad override that changes nothing", async () => {
    const { kv } = fakeKv({ [flagKey("CHAT_X")]: "core" });
    const r = await flagOf({ CHAT_X: "on", CACHE: kv }, "CHAT_X", deps());
    expect(r).toMatchObject({ position: "on", override: null, badOverride: true });
  });

  // The variable is read strictly because a typo there would raise. The override cannot raise whatever it says, so it is read leniently: a person who writes `Off` or `OFF` or `off` plus a
  // newline into KV in the middle of an incident must have the flag lowered, not silently left where it was.
  it.each([["OFF"], ["Off"], [" off"], ["off\n"], ["  off  "]])("lowers for an override written as %j, which a person might type in a hurry", async (text) => {
    const { kv } = fakeKv({ [flagKey("CHAT_X")]: text });
    const r = await flagOf({ CHAT_X: "on", CACHE: kv }, "CHAT_X", deps());
    expect(r).toMatchObject({ position: "off", override: "off", badOverride: false });
  });

  it("is not lowered when KV holds no override", async () => {
    const { kv } = fakeKv();
    expect(await flagOf({ CHAT_X: "on", CACHE: kv }, "CHAT_X", deps())).toEqual({ position: "on", variable: "on", badVariable: false, override: null, badOverride: false, kvUnreadable: false });
  });

  it("stands at the variable when the Worker has no KV binding (a local run, a test), and that is not a problem to count", async () => {
    expect(await flagOf({ CHAT_X: "shadow" }, "CHAT_X", deps())).toEqual({ position: "shadow", variable: "shadow", badVariable: false, override: null, badOverride: false, kvUnreadable: false });
  });

  it("reads `flag:<NAME>` from the same namespace the cache uses, as text, with KV's shortest edge cache (30 s), so a lowering reaches a place within about a minute", async () => {
    const { kv, get } = fakeKv();
    await flagOf({ CHAT_FLOOR: "on", CACHE: kv }, "CHAT_FLOOR", deps());
    expect(flagKey("CHAT_FLOOR")).toBe("flag:CHAT_FLOOR");
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("flag:CHAT_FLOOR", { type: "text", cacheTtl: 30 });
  });

  it("never writes to KV (the scheduled check that writes an override is a later release)", async () => {
    const { kv, put } = fakeKv({ [flagKey("CHAT_X")]: "off" });
    await flagOf({ CHAT_X: "on", CACHE: kv }, "CHAT_X", deps());
    expect(put).not.toHaveBeenCalled();
  });
});

describe("a KV that cannot be read leaves the variable as it is, and never throws", () => {
  const standing = (extra: object) => ({ position: "on", variable: "on", badVariable: false, override: null, badOverride: false, kvUnreadable: false, ...extra });

  it("when get throws at once", async () => {
    const kv = { get: () => { throw new Error("KV down"); } } as unknown as KVNamespace;
    expect(await flagOf({ CHAT_X: "on", CACHE: kv }, "CHAT_X", deps())).toEqual(standing({ kvUnreadable: true }));
  });

  it("when get rejects", async () => {
    const kv = { get: async () => { throw new Error("KV 503"); } } as unknown as KVNamespace;
    expect(await flagOf({ CHAT_X: "on", CACHE: kv }, "CHAT_X", deps())).toEqual(standing({ kvUnreadable: true }));
  });

  // Pinned as the behaviour today, not as the last word: a malformed key (a typo such as `of`, quotes around `off`) is ignored and counted, it does not lower. Whether it should lower to off, as the
  // Trending switch does, is the owner's call (see the header of flags.ts); this test and that header are the two places to change if it is decided.
  it.each([[""], ["banana"], ["{\"position\":\"off\"}"], ["off shadow"], ["0"], ["null"], ["raise"], ["of"], ["\"off\""], ["off."]])("when the value is text that is not a position: %j", async (text) => {
    const { kv } = fakeKv({ [flagKey("CHAT_X")]: text });
    expect(await flagOf({ CHAT_X: "on", CACHE: kv }, "CHAT_X", deps())).toEqual(standing({ badOverride: true }));
  });

  it.each([[42], [true], [{ position: "off" }], [["off"]]])("when the value is not text at all: %j", async (value) => {
    const { kv } = fakeKv({ [flagKey("CHAT_X")]: value });
    expect(await flagOf({ CHAT_X: "on", CACHE: kv }, "CHAT_X", deps())).toEqual(standing({ badOverride: true }));
  });

  it("keeps the last override that was read while KV cannot be read, so a tripwire does not let go of a flag because KV blinked; when KV answers again it follows the answer", async () => {
    const d = deps();
    let down = false;
    let stored: string | null = "off";
    const kv = { get: vi.fn(async () => { if (down) throw new Error("KV down"); return stored; }) } as unknown as KVNamespace;
    const env = { CHAT_X: "on", CACHE: kv };
    expect((await flagOf(env, "CHAT_X", d)).position).toBe("off");
    down = true;
    d.c.advance(FLAG_CACHE_MS);
    expect(await flagOf(env, "CHAT_X", d)).toMatchObject({ position: "off", variable: "on", kvUnreadable: true });
    d.c.advance(FLAG_CACHE_MS);
    down = false;
    stored = null; // the owner took the override away
    expect(await flagOf(env, "CHAT_X", d)).toMatchObject({ position: "on", kvUnreadable: false });
  });

  it("does not invent a lowering from a read that failed before any read worked", async () => {
    const kv = { get: async () => { throw new Error("KV down"); } } as unknown as KVNamespace;
    const r = await flagOf({ CHAT_X: "shadow", CACHE: kv }, "CHAT_X", deps());
    expect(r.position).toBe("shadow");
    expect(r.override).toBeNull();
  });

  // The chat path awaits this for every flag that is not off. A `get` that never settles must cost a request FLAG_KV_TIMEOUT_MS at most, once per 30 seconds, and then count as unreadable.
  describe("when get never settles", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });
    const hanging = () => {
      const get = vi.fn((_key: string, _options?: unknown) => new Promise<string | null>(() => {}));
      return { kv: { get } as unknown as KVNamespace, get };
    };
    /** Whether a promise has settled, without waiting on it (a test that awaited a hang would hang). */
    const watch = (p: Promise<unknown>) => {
      const state = { done: false };
      void p.then(() => (state.done = true), () => (state.done = true));
      return state;
    };

    it("pins the bound to the range of a read worth waiting for on the chat path", () => {
      expect(FLAG_KV_TIMEOUT_MS).toBeGreaterThanOrEqual(250);
      expect(FLAG_KV_TIMEOUT_MS).toBeLessThanOrEqual(500);
    });

    it("gives up at the bound, not before, and leaves the variable standing with kvUnreadable set", async () => {
      const { kv } = hanging();
      const p = flagOf({ CHAT_X: "on", CACHE: kv }, "CHAT_X", deps());
      const state = watch(p);
      await vi.advanceTimersByTimeAsync(FLAG_KV_TIMEOUT_MS - 1);
      expect(state.done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(state.done).toBe(true);
      expect(await p).toEqual(standing({ kvUnreadable: true }));
    });

    it("frees every caller of the same window: concurrent ones share the one read, and one that comes later in the 30 seconds gets the same answer at once", async () => {
      const { kv, get } = hanging();
      const d = deps();
      const env = { CHAT_X: "on", CACHE: kv };
      const all = Array.from({ length: 8 }, () => flagOf(env, "CHAT_X", d));
      const states = all.map(watch);
      await vi.advanceTimersByTimeAsync(FLAG_KV_TIMEOUT_MS);
      expect(states.every((s) => s.done)).toBe(true);
      expect(get).toHaveBeenCalledTimes(1);
      d.c.advance(29_999);
      const late = flagOf(env, "CHAT_X", d);
      const lateState = watch(late);
      await vi.advanceTimersByTimeAsync(0);
      expect(lateState.done).toBe(true);
      expect(await late).toEqual(standing({ kvUnreadable: true }));
      expect(get).toHaveBeenCalledTimes(1);
    });

    it("reads again after the 30 seconds, and gives up on that read too", async () => {
      const { kv, get } = hanging();
      const d = deps();
      const env = { CHAT_X: "on", CACHE: kv };
      const first = flagOf(env, "CHAT_X", d);
      await vi.advanceTimersByTimeAsync(FLAG_KV_TIMEOUT_MS);
      await first;
      d.c.advance(30_000);
      const second = flagOf(env, "CHAT_X", d);
      const state = watch(second);
      await vi.advanceTimersByTimeAsync(FLAG_KV_TIMEOUT_MS);
      expect(state.done).toBe(true);
      expect(get).toHaveBeenCalledTimes(2);
    });

    it("keeps the last override that was read when a later read hangs, as it does when a later read throws", async () => {
      const d = deps();
      let hang = false;
      const get = vi.fn((_key: string, _options?: unknown) => (hang ? new Promise<string | null>(() => {}) : Promise.resolve<string | null>("off")));
      const env = { CHAT_X: "on", CACHE: { get } as unknown as KVNamespace };
      expect((await flagOf(env, "CHAT_X", d)).position).toBe("off");
      hang = true;
      d.c.advance(FLAG_CACHE_MS);
      const p = flagOf(env, "CHAT_X", d);
      const state = watch(p);
      await vi.advanceTimersByTimeAsync(FLAG_KV_TIMEOUT_MS);
      expect(state.done).toBe(true);
      expect(await p).toMatchObject({ position: "off", variable: "on", kvUnreadable: true });
    });

    it("leaves no timer running once a read has answered, failed or thrown at once", async () => {
      const d = deps();
      await flagOf({ CHAT_X: "on", CACHE: fakeKv().kv }, "CHAT_X", d);
      expect(vi.getTimerCount()).toBe(0);
      await flagOf({ CHAT_X: "on", CACHE: { get: async () => { throw new Error("503"); } } as unknown as KVNamespace }, "CHAT_Y", d);
      expect(vi.getTimerCount()).toBe(0);
      await flagOf({ CHAT_X: "on", CACHE: { get: () => { throw new Error("sync"); } } as unknown as KVNamespace }, "CHAT_Z", d);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("is not troubled by an answer or an error that arrives after it gave up (no unhandled rejection, and the late answer changes nothing)", async () => {
      const d = deps();
      const get = vi.fn((_key: string, _options?: unknown) => new Promise<string | null>((_resolve, reject) => setTimeout(() => reject(new Error("late 503")), FLAG_KV_TIMEOUT_MS * 3)));
      const p = flagOf({ CHAT_X: "on", CACHE: { get } as unknown as KVNamespace }, "CHAT_X", d);
      await vi.advanceTimersByTimeAsync(FLAG_KV_TIMEOUT_MS);
      expect(await p).toEqual(standing({ kvUnreadable: true }));
      await vi.advanceTimersByTimeAsync(FLAG_KV_TIMEOUT_MS * 3);
      d.c.advance(1000);
      expect(await flagOf({ CHAT_X: "on", CACHE: { get } as unknown as KVNamespace }, "CHAT_X", d)).toEqual(standing({ kvUnreadable: true }));
    });
  });
});

describe("the cache: one read for 30 seconds per name per isolate", () => {
  it("answers from memory until the 30th second, and reads again at exactly 30.000", async () => {
    const { kv, get } = fakeKv({ [flagKey("CHAT_X")]: "shadow" });
    const d = deps();
    const env = { CHAT_X: "on", CACHE: kv };
    expect(FLAG_CACHE_MS).toBe(30_000);
    await flagOf(env, "CHAT_X", d);
    expect(get).toHaveBeenCalledTimes(1);
    d.c.advance(29_999);
    await flagOf(env, "CHAT_X", d);
    expect(get).toHaveBeenCalledTimes(1);
    d.c.advance(1); // now exactly 30 000 ms after the read
    await flagOf(env, "CHAT_X", d);
    expect(get).toHaveBeenCalledTimes(2);
    // and the new read starts a new 30 seconds
    d.c.advance(29_999);
    await flagOf(env, "CHAT_X", d);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("shows a lowering written in KV only after the cached answer has expired, and a removal the same way", async () => {
    const data: Record<string, unknown> = {};
    const { kv } = fakeKv(data);
    const d = deps();
    const env = { CHAT_X: "on", CACHE: kv };
    expect((await flagOf(env, "CHAT_X", d)).position).toBe("on");
    data[flagKey("CHAT_X")] = "shadow";
    d.c.advance(29_999);
    expect((await flagOf(env, "CHAT_X", d)).position).toBe("on");
    d.c.advance(1);
    expect((await flagOf(env, "CHAT_X", d)).position).toBe("shadow");
    delete data[flagKey("CHAT_X")];
    d.c.advance(30_000);
    expect((await flagOf(env, "CHAT_X", d)).position).toBe("on");
  });

  it("keeps 'no override' too (the usual answer), and a failed read too, so a broken KV is not asked once per request", async () => {
    const miss = fakeKv();
    const d1 = deps();
    for (let i = 0; i < 5; i++) await flagOf({ CHAT_X: "on", CACHE: miss.kv }, "CHAT_X", d1);
    expect(miss.get).toHaveBeenCalledTimes(1);

    const get = vi.fn(async () => { throw new Error("KV down"); });
    const d2 = deps();
    for (let i = 0; i < 5; i++) await flagOf({ CHAT_X: "on", CACHE: { get } as unknown as KVNamespace }, "CHAT_X", d2);
    expect(get).toHaveBeenCalledTimes(1);
    d2.c.advance(30_000);
    await flagOf({ CHAT_X: "on", CACHE: { get } as unknown as KVNamespace }, "CHAT_X", d2);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("keeps each name apart", async () => {
    const { kv, get } = fakeKv({ [flagKey("CHAT_A")]: "off" });
    const d = deps();
    const env = { CHAT_A: "on", CHAT_B: "on", CACHE: kv };
    expect((await flagOf(env, "CHAT_A", d)).position).toBe("off");
    expect((await flagOf(env, "CHAT_B", d)).position).toBe("on");
    expect(get.mock.calls.map((c) => c[0]).sort()).toEqual(["flag:CHAT_A", "flag:CHAT_B"]);
  });

  it("shares one read between requests that ask at the same moment, as a busy isolate does when the 30 seconds end", async () => {
    const { kv, get } = fakeKv({ [flagKey("CHAT_X")]: "shadow" });
    const d = deps();
    const all = await Promise.all(Array.from({ length: 8 }, () => flagOf({ CHAT_X: "on", CACHE: kv }, "CHAT_X", d)));
    expect(get).toHaveBeenCalledTimes(1);
    expect(all.every((r) => r.position === "shadow")).toBe(true);
  });

  it("reads again when the clock has gone backwards, rather than trusting an age below zero", async () => {
    const { kv, get } = fakeKv();
    const d = deps();
    await flagOf({ CHAT_X: "on", CACHE: kv }, "CHAT_X", d);
    d.c.set(T0 - 5_000);
    await flagOf({ CHAT_X: "on", CACHE: kv }, "CHAT_X", d);
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("works with no injected clock or cache (the Worker's own: Date.now and one cache per isolate), and resetFlagCache forgets it", async () => {
    resetFlagCache();
    const { kv, get } = fakeKv({ [flagKey("CHAT_X")]: "off" });
    const env = { CHAT_X: "on", CACHE: kv };
    expect((await flagOf(env, "CHAT_X")).position).toBe("off");
    expect((await flagOf(env, "CHAT_X")).position).toBe("off");
    expect(get).toHaveBeenCalledTimes(1);
    resetFlagCache();
    await flagOf(env, "CHAT_X");
    expect(get).toHaveBeenCalledTimes(2);
    resetFlagCache();
  });

  // A Worker has one env per isolate, but a test file builds several. With a cache keyed by name alone, the second test's env would be answered from the first test's KV for 30 real seconds.
  it("keeps the isolate's own cache apart per KV namespace, so two envs in one process never answer each other", async () => {
    resetFlagCache();
    const a = fakeKv({ [flagKey("CHAT_X")]: "off" });
    const b = fakeKv();
    expect((await flagOf({ CHAT_X: "on", CACHE: a.kv }, "CHAT_X")).position).toBe("off");
    expect((await flagOf({ CHAT_X: "on", CACHE: b.kv }, "CHAT_X")).position).toBe("on");
    expect(b.get).toHaveBeenCalledTimes(1);
    // each namespace still keeps its own answer for its 30 seconds
    expect((await flagOf({ CHAT_X: "on", CACHE: a.kv }, "CHAT_X")).position).toBe("off");
    expect((await flagOf({ CHAT_X: "on", CACHE: b.kv }, "CHAT_X")).position).toBe("on");
    expect(a.get).toHaveBeenCalledTimes(1);
    expect(b.get).toHaveBeenCalledTimes(1);
    resetFlagCache();
  });

  it("resetFlagCache forgets every namespace's answers", async () => {
    resetFlagCache();
    const a = fakeKv({ [flagKey("CHAT_X")]: "off" });
    const b = fakeKv({ [flagKey("CHAT_X")]: "shadow" });
    await flagOf({ CHAT_X: "on", CACHE: a.kv }, "CHAT_X");
    await flagOf({ CHAT_X: "on", CACHE: b.kv }, "CHAT_X");
    resetFlagCache();
    await flagOf({ CHAT_X: "on", CACHE: a.kv }, "CHAT_X");
    await flagOf({ CHAT_X: "on", CACHE: b.kv }, "CHAT_X");
    expect(a.get).toHaveBeenCalledTimes(2);
    expect(b.get).toHaveBeenCalledTimes(2);
    resetFlagCache();
  });
});

describe("the signature fits a Worker env", () => {
  // The shape of `Bindings` in chat/routes.ts and index.ts: a type with its own bindings, a KV that is the real KVNamespace and optional variables. This is checked by the compiler (npm run typecheck)
  // as much as by the run: if flagOf asked for more than this, or for a narrower KV, this would not compile.
  type Bindings = { DB: D1Database; CACHE?: KVNamespace; AI?: Ai; CHAT_X?: string; CROSSREF_MAILTO: string };
  it("takes such an env as it is, and a KVNamespace as the override store", async () => {
    const { kv } = fakeKv({ [flagKey("CHAT_X")]: "off" });
    const env = { DB: {} as D1Database, CACHE: kv, CHAT_X: "on", CROSSREF_MAILTO: "x@example.org" } satisfies Bindings;
    const r = await flagOf(env as Bindings, "CHAT_X", deps());
    expect(r.position).toBe("off");
    const none: Bindings = { DB: {} as D1Database, CROSSREF_MAILTO: "x@example.org" };
    expect((await flagOf(none, "CHAT_X")).position).toBe("off");
  });

  // Every env in apps/api today is a type alias, but nothing stops a module from declaring its env as an interface, which has no index signature: the compiler checks this one too.
  interface IfaceBindings { DB: D1Database; CACHE?: KVNamespace; CHAT_X?: string }
  it("takes an env declared as an interface, with a KV or without one", async () => {
    const { kv } = fakeKv({ [flagKey("CHAT_X")]: "off" });
    const withKv: IfaceBindings = { DB: {} as D1Database, CACHE: kv, CHAT_X: "on" };
    expect((await flagOf(withKv, "CHAT_X", deps())).position).toBe("off");
    const withoutKv: IfaceBindings = { DB: {} as D1Database, CHAT_X: "shadow" };
    expect((await flagOf(withoutKv, "CHAT_X", deps())).position).toBe("shadow");
  });

  it("does not throw when it is handed no env at all (Hono's app.request without an env gives an undefined c.env): every flag is off", async () => {
    const r = await flagOf(undefined as never, "CHAT_X");
    expect(r).toEqual({ position: "off", variable: "off", badVariable: false, override: null, badOverride: false, kvUnreadable: false });
  });
});
