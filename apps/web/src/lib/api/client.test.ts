import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, isAbort, problemError, send, streamError } from "./client";
import { endingOf, perFrame, postStream, streamResult } from "./stream";
import { retry, retryAfterMs, sleep } from "./retry";
import { fakeNet, json, offline, problem, sse, type Net } from "../../test/fake-net";

/** The one browser client (docs/design/untangle.md, F9): requests, problems, streams and retries. */

let net: Net;
beforeEach(() => {
  net = fakeNet();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("api() and send()", () => {
  it("a GET with the person's cookies; resolves with the JSON", async () => {
    net.reply = () => json({ a: 1 });
    expect(await api("/api/v1/x")).toEqual({ a: 1 });
    expect(net.calls).toEqual([{ url: "/api/v1/x", method: "GET", headers: {}, body: null, credentials: "same-origin", keepalive: undefined, signal: false }]);
  });

  it("a JSON body is sent as JSON, beside the call's own headers; credentials, keepalive and signal pass through", async () => {
    await api("/api/v1/x", { method: "POST", json: { q: 1 }, headers: { "Idempotency-Key": "k" }, credentials: "omit", keepalive: true, signal: new AbortController().signal });
    expect(net.calls[0]).toEqual({ url: "/api/v1/x", method: "POST", headers: { "content-type": "application/json", "idempotency-key": "k" }, body: { q: 1 }, credentials: "omit", keepalive: true, signal: true });
  });

  it("a body that is not JSON is sent as it is, with the call's headers only", async () => {
    const blob = new Blob(["x"], { type: "image/jpeg" });
    await send("/api/v1/x", { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: blob });
    expect(net.calls[0]).toMatchObject({ method: "PUT", headers: { "content-type": "image/jpeg" }, body: blob });
  });

  it("a reply that is not ok is an ApiError carrying the problem: status, type, title, detail, the other fields, Retry-After", async () => {
    net.reply = () => problem(409, { type: "scan_running", title: "A scan is already running", detail: "Stop it first", id: "s1" }, { "Retry-After": "7" });
    const e = (await api("/x").catch((x) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ status: 409, type: "scan_running", title: "A scan is already running", detail: "Stop it first", extra: { id: "s1" }, retryAfter: "7", message: "A scan is already running. Stop it first" });
  });

  it("a reply with no problem: type error, and the call's fallback title (by default the status)", async () => {
    net.reply = () => problem(502, "<html>");
    expect(await api("/x").catch((x) => x)).toMatchObject({ status: 502, type: "error", title: "The service answered 502", detail: undefined, message: "The service answered 502" });
    expect(await api("/x", { fallback: "That could not be saved" }).catch((x) => x)).toMatchObject({ message: "That could not be saved" });
    expect(await api("/x", { fallback: (s) => (s === 502 ? "Bad gateway" : "Other") }).catch((x) => x)).toMatchObject({ message: "Bad gateway" });
  });

  it("a lost connection rejects with fetch's TypeError; a stopped request with an AbortError", async () => {
    net.reply = () => offline();
    expect(await api("/x").catch((x) => x)).toBeInstanceOf(TypeError);
    const ctl = new AbortController();
    ctl.abort();
    const e = await api("/x", { signal: ctl.signal }).catch((x) => x);
    expect(isAbort(e)).toBe(true);
    expect(isAbort(new Error("x"))).toBe(false);
  });

  it("problemError and streamError build the same error the way the old helpers did", () => {
    expect(problemError(500, null)).toMatchObject({ type: "error", title: "The service answered 500" });
    expect(problemError(400, { type: "invalid", title: "No", detail: 3 })).toMatchObject({ type: "invalid", title: "No", detail: undefined, extra: {} });
    expect(streamError(200, { code: "no_text", title: "Nothing to read", detail: "Add the PDF" })).toMatchObject({ status: 200, type: "error", extra: { code: "no_text" }, message: "Nothing to read. Add the PDF" });
  });
});

describe("streams", () => {
  it("postStream: a POST of JSON with the call's headers; a refusal rejects before any event", async () => {
    net.reply = () => sse([]);
    await postStream("/s", { q: 1 }, { headers: { Accept: "text/event-stream" }, signal: new AbortController().signal });
    expect(net.calls[0]).toMatchObject({ method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream" }, body: { q: 1 }, credentials: "same-origin", signal: true });
    net.reply = () => problem(429, { type: "quota", title: "Used up" });
    expect(await postStream("/s", {}).catch((x) => x)).toMatchObject({ status: 429, type: "quota" });
  });

  it("streamResult: the last end event's result; an error event as an ApiError; neither is cut off", async () => {
    type E = { type: "stage" } | { type: "done"; v: number } | { type: "error"; code: string; title: string };
    const seen: string[] = [];
    expect(await streamResult<E, number>(sse([{ type: "stage" }, { type: "done", v: 1 }]), "done", (e) => (e as { v: number }).v, "cut", (e) => seen.push(e.type))).toBe(1);
    expect(seen).toEqual(["stage", "done"]);
    const e = await streamResult<E, number>(sse([{ type: "error", code: "ai_failed", title: "Failed" }]), "done", () => 1, "cut").catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e).toMatchObject({ message: "Failed", extra: { code: "ai_failed" } });
    const cut = await streamResult<E, number>(sse([{ type: "stage" }]), "done", () => 1, "It was cut off").catch((x) => x);
    expect(cut).toBeInstanceOf(TypeError);
    expect(cut.message).toBe("It was cut off");
  });

  it("perFrame: events pushed in one frame are applied together, once; flush applies what is queued and cancels the frame", async () => {
    const frames: (() => void)[] = [];
    const g = globalThis as unknown as Record<string, unknown>;
    g.requestAnimationFrame = (cb: () => void) => frames.push(cb);
    let cancelled = 0;
    g.cancelAnimationFrame = () => void cancelled++;
    const batches: number[][] = [];
    const f = perFrame<number>((b) => batches.push(b));
    f.push(1);
    f.push(2);
    expect(frames).toHaveLength(1);
    frames[0]!();
    expect(batches).toEqual([[1, 2]]);
    f.push(3);
    f.flush();
    expect(batches).toEqual([[1, 2], [3]]);
    expect(cancelled).toBe(1);
    f.flush();
    expect(batches).toHaveLength(2);
  });

  it("endingOf: stopped, the connection lost, failed", () => {
    expect(endingOf(new DOMException("aborted", "AbortError"))).toBe("stopped");
    expect(endingOf(new TypeError("Failed to fetch"))).toBe("connection_lost");
    expect(endingOf(new ApiError(429, "quota", "x"))).toBe("failed");
  });
});

describe("retry", () => {
  it("retryAfterMs: the header's seconds, the fallback without a number, never above the cap", () => {
    expect(retryAfterMs("5", 20, 60)).toBe(5000);
    expect(retryAfterMs(null, 20, 60)).toBe(20_000);
    expect(retryAfterMs("Wed, 21 Oct 2026 07:28:00 GMT", 20, 60)).toBe(20_000);
    expect(retryAfterMs("120", 20, 60)).toBe(60_000);
  });

  it("sleep waits, and ends at once when the signal aborts", async () => {
    vi.useFakeTimers();
    let done = false;
    void sleep(1000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
    const ctl = new AbortController();
    let early = false;
    void sleep(60_000, ctl.signal).then(() => (early = true));
    ctl.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(early).toBe(true);
  });

  it("tries at most `tries` times, waits delayMs(attempt) between, stops at once on a failure `again` refuses", async () => {
    vi.useFakeTimers();
    const waits: number[] = [];
    const real = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => (waits.push(ms ?? 0), real(fn, ms))) as typeof setTimeout);
    let n = 0;
    const retried: number[] = [];
    const p = retry({ tries: 3, delayMs: (a) => 900 * a, again: () => true }, async () => { n++; throw new TypeError("x"); }, (_e, a) => retried.push(a)).catch((x) => x);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBeInstanceOf(TypeError);
    expect([n, waits, retried]).toEqual([3, [900, 1800], [1, 2]]);
    n = 0;
    expect(await retry({ tries: 3, delayMs: () => 1, again: () => false }, async () => { n++; throw new Error("no"); }).catch((x) => x.message)).toBe("no");
    expect(n).toBe(1);
    expect(await retry({ tries: 2, delayMs: () => 1, again: () => true }, async (a) => a)).toBe(1);
  });
});
