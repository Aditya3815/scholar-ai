import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeNet, json, problem, sse, type Call, type Net } from "../test/fake-net";
import { render, unmount } from "../test/fake-react";

vi.mock("react", async () => (await import("../test/fake-react")).react);

/** The literature scan's requests and its live stream, as they were before the one browser client (docs/design/untangle.md, F9), and bug B1. */

const lib = await import("./litscan");
const { runningScanId } = lib;

let net: Net;
beforeEach(() => {
  net = fakeNet();
});

const req = (url: string, method = "GET", over: Partial<Call> = {}): Call => ({ url, method, headers: {}, body: null, credentials: "same-origin", keepalive: undefined, signal: false, ...over });
const jsonReq = (url: string, method: string, body: unknown, signal = false): Call => req(url, method, { headers: { "content-type": "application/json" }, body, signal });

describe("the scan's requests", () => {
  it("each call: address, method, headers, body, credentials", async () => {
    const answers: Record<string, unknown> = { plan: { plan: { p: 1 } }, start: { id: "s1" }, list: { scans: [1] }, get: { scan: { id: "s1" } }, shared: { scan: { t: 1 } }, share: { token: "tok" } };
    net.reply = (c) => json(c.url.endsWith("/plan") ? answers.plan : c.url.endsWith("/share") && c.method === "POST" ? answers.share : c.url.includes("/shared/") ? answers.shared : c.url === "/api/v1/litscan" && c.method === "POST" ? answers.start : c.url === "/api/v1/litscan" ? answers.list : answers.get);
    const s = new AbortController().signal;
    expect(await lib.planScan("topic", "auto", s)).toEqual({ p: 1 });
    expect(await lib.startScan({ topic: "t" } as never)).toBe("s1");
    expect(await lib.listScans(s)).toEqual([1]);
    expect(await lib.getScan("s1", s)).toEqual({ id: "s1" });
    expect(await lib.getSharedScan("tok", s)).toEqual({ t: 1 });
    expect(await lib.shareScan("s1")).toBe("tok");
    await lib.unshareScan("s1");
    await lib.cancelScan("s1");
    await lib.deleteScan("s1");
    expect(net.calls).toEqual([
      jsonReq("/api/v1/litscan/plan", "POST", { topic: "topic", language: "auto" }, true),
      jsonReq("/api/v1/litscan", "POST", { topic: "t" }),
      req("/api/v1/litscan", "GET", { signal: true }),
      req("/api/v1/litscan/s1", "GET", { signal: true }),
      req("/api/v1/litscan/shared/tok", "GET", { credentials: "omit", signal: true }),
      req("/api/v1/litscan/s1/share", "POST"),
      req("/api/v1/litscan/s1/share", "DELETE"),
      req("/api/v1/litscan/s1/cancel", "POST"),
      req("/api/v1/litscan/s1", "DELETE"),
    ]);
  });

  it("a refusal is an ApiError with the problem's fields; a reply without one says the status", async () => {
    net.reply = () => problem(400, { type: "invalid_topic", title: "That topic is too short", detail: "Write a few words" });
    expect(await lib.planScan("x", "auto").catch((e) => e)).toMatchObject({ status: 400, type: "invalid_topic", message: "That topic is too short. Write a few words" });
    net.reply = () => problem(503, "down");
    expect(await lib.listScans().catch((e) => e)).toMatchObject({ status: 503, type: "error", message: "The service answered 503" });
  });

  it("another scan still running: the error carries that scan's id", async () => {
    net.reply = () => problem(409, { type: "scan_running", title: "A scan is already running", id: "other" });
    const e = await lib.startScan({} as never).catch((x) => x);
    expect(e).toMatchObject({ status: 409, type: "scan_running", message: "A scan is already running" });
    expect(runningScanId(e)).toBe("other");
    net.reply = () => problem(409, { type: "scan_running", title: "A scan is already running" });
    expect(runningScanId(await lib.startScan({} as never).catch((x) => x))).toBeNull();
  });
});

describe("useScan, a scan followed live", () => {
  const running = (seq = 0) => ({ scan: { id: "s1", state: "running", total: 2, done: 0, stages: {}, parts: [], seq } });
  const ended = { scan: { id: "s1", state: "done", total: 2, done: 2, stages: {}, parts: [], seq: 9 } };
  let delays: number[];
  beforeEach(() => {
    vi.useFakeTimers();
    delays = [];
    const real = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => (delays.push(ms ?? 0), real(fn, ms))) as typeof setTimeout);
  });
  afterEach(() => {
    unmount();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("reads the scan, follows its events from the last one it has, and reads it once more when it is done", async () => {
    let gets = 0;
    net.reply = (c) => (c.url.includes("/events") ? sse([{ type: "started", total: 2, seq: 1 }, { type: "done", state: "done", seq: 2 }]) : json(gets++ === 0 ? running(4) : ended));
    render(() => lib.useScan("s1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(net.calls.map((c) => c.url)).toEqual(["/api/v1/litscan/s1", "/api/v1/litscan/s1/events?after=4", "/api/v1/litscan/s1"]);
    expect(net.calls[1]).toMatchObject({ method: "GET", headers: { accept: "text/event-stream" }, credentials: "same-origin", signal: true });
    expect(render(() => lib.useScan("s1"))).toMatchObject({ scan: ended.scan, problem: null });
  });

  it("a scan that is gone (404) or a person signed out (401) is missing, and is not asked again", async () => {
    net.reply = () => problem(404, { type: "not_found", title: "Not found" });
    render(() => lib.useScan("s1"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(net.calls).toHaveLength(1);
    expect(render(() => lib.useScan("s1")).problem).toBe("missing");
  });

  it("a failing read is tried again after 2, 4, 8, 8 s, and the page says offline from the second failure", async () => {
    net.reply = () => problem(500, "x");
    render(() => lib.useScan("s1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(render(() => lib.useScan("s1")).problem).toBeNull();
    await vi.advanceTimersByTimeAsync(2000 + 4000 + 8000 + 8000);
    expect(net.calls).toHaveLength(5);
    expect(delays.filter((d) => d >= 1000)).toEqual([2000, 4000, 8000, 8000, 8000]);
    expect(render(() => lib.useScan("s1")).problem).toBe("offline");
  });

  it("a stream that is cut without its end: read again after 1 s, and its stream asked from the seq the scan was read at", async () => {
    let streams = 0;
    net.reply = (c) => (c.url.includes("/events") ? sse(streams++ === 0 ? [{ type: "started", total: 2, seq: 3 }] : [{ type: "done", state: "done", seq: 5 }]) : json(running(0)));
    render(() => lib.useScan("s1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(delays.filter((d) => d >= 1000)).toEqual([1000]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(net.calls.map((c) => c.url)).toEqual(["/api/v1/litscan/s1", "/api/v1/litscan/s1/events?after=0", "/api/v1/litscan/s1", "/api/v1/litscan/s1/events?after=0", "/api/v1/litscan/s1"]);
  });

  // Bug B1 (docs/design/untangle.md, section 5): the scan's `error` event was thrown inside the reader's handler and swallowed, so useScan took it for a stream that was merely cut
  // (failures back to 0, read again after 1 s) and never said "offline" however often the scan's stream failed. It now reaches useScan as a failure.
  it("B1: the stream's error event reaches useScan as a failure (read again after 2 s, offline at the second)", async () => {
    net.reply = (c) => (c.url.includes("/events") ? sse([{ type: "error", code: "internal_error", title: "Something went wrong" }]) : json(running(0)));
    render(() => lib.useScan("s1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(delays.filter((d) => d >= 1000)).toEqual([2000]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(render(() => lib.useScan("s1")).problem).toBe("offline");
  });
});
