import { describe, expect, it } from "vitest";
import { crossrefFetch, retryDelay } from "./crossref-gate";

const ok = () => new Response("{}", { status: 200 });
const limited = (retryAfter?: string) => new Response("slow down", { status: 429, headers: retryAfter === undefined ? {} : { "retry-after": retryAfter } });

describe("crossrefFetch", () => {
  it("never runs more than two calls at once and still finishes all of them", async () => {
    let running = 0;
    let peak = 0;
    const slow = (async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 15));
      running--;
      return ok();
    }) as typeof fetch;
    const out = await Promise.all(Array.from({ length: 9 }, () => crossrefFetch(slow, "https://api.crossref.org/works", {})));
    expect(out.every((r) => r.status === 200)).toBe(true);
    expect(peak).toBe(2);
  });

  it("retries a 429 and returns the answer that follows", async () => {
    let calls = 0;
    const flaky = (async () => (++calls < 3 ? limited("0") : ok())) as typeof fetch;
    const res = await crossrefFetch(flaky, "https://api.crossref.org/works", {});
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
  });

  it("gives up after a few attempts and reports the 429", async () => {
    let calls = 0;
    const always = (async () => (calls++, limited("0"))) as typeof fetch;
    const res = await crossrefFetch(always, "https://api.crossref.org/works", {});
    expect(res.status).toBe(429);
    expect(calls).toBe(4);
  });

  it("does not retry other errors, and frees its slot when the call throws", async () => {
    let calls = 0;
    const server = (async () => (calls++, new Response("", { status: 500 }))) as typeof fetch;
    expect((await crossrefFetch(server, "u", {})).status).toBe(500);
    expect(calls).toBe(1);
    const boom = (async () => { throw new Error("offline"); }) as typeof fetch;
    for (let i = 0; i < 5; i++) await expect(crossrefFetch(boom, "u", {})).rejects.toThrow("offline");
    expect((await crossrefFetch((async () => ok()) as typeof fetch, "u", {})).status).toBe(200); // slots were released
  });
});

describe("retryDelay", () => {
  it("honours Retry-After but never waits long, and grows without a header", () => {
    expect(retryDelay(limited("1"), 0)).toBe(1000);
    expect(retryDelay(limited("120"), 0)).toBe(3000);
    expect(retryDelay(limited("0"), 2)).toBe(0);
    expect(retryDelay(limited(), 0)).toBe(400);
    expect(retryDelay(limited(), 2)).toBe(1600);
    expect(retryDelay(limited(), 9)).toBe(3000);
  });
});
