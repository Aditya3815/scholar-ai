import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeNet, json, offline, problem, type Net } from "../test/fake-net";

/**
 * Reading a scanned paper's pages (lib/scan.ts), as it was before the one browser client (docs/design/untangle.md, F9): the requests, and what each refusal does (today's limit stops, a
 * signed-out person stops, a 429 waits 4 s and tries the page again up to three times, a failure waits 1.5 s and tries it once more, four failures in a row stop as "unavailable").
 * The page pictures are drawn on a stand-in canvas: `blank` pages send no picture.
 */

const scan = await import("./scan");

let blank = true;
const canvas = () => ({
  width: 0,
  height: 0,
  getContext: () => ({ fillRect() {}, drawImage() {}, getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) => (blank || Math.floor(i / 4) % 2 ? 255 : 0)) }) }),
  toBlob: (cb: (b: Blob) => void) => cb(new Blob(["jpeg"], { type: "image/jpeg" })),
});
const pdf = { getPage: async () => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 100 * scale, height: 140 * scale }), render: () => ({ promise: Promise.resolve() }), cleanup() {} }) } as never;
const DOC = { id: "d1" };
const ok = (status = "done") => json({ result: { status, page: 1 }, document: DOC });

let net: Net;
let delays: number[];
beforeEach(() => {
  blank = true;
  net = fakeNet();
  delays = [];
  (globalThis as unknown as { document: unknown }).document = { createElement: canvas };
  vi.useFakeTimers();
  const real = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => (delays.push(ms ?? 0), real(fn, ms))) as typeof setTimeout);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const read = async (pages: number[], ctl = new AbortController()) => {
  const done: number[] = [];
  const p = scan.readScannedPages({ docId: "d1", pdf, pages, signal: ctl.signal, onPage: (r) => done.push(r.page) });
  for (let i = 0; i < 40; i++) await vi.advanceTimersByTimeAsync(500);
  return { end: await p, done };
};

describe("the scan's server calls", () => {
  it("register, read the list, read the text, send a page: the requests", async () => {
    net.reply = (c) => json(c.url.endsWith("/text") ? { pages: [{ page: 1, text: "t" }] } : c.url.includes("/ocr") ? { result: {}, document: DOC } : { scan: { pending: [] }, document: DOC });
    await scan.registerScan("d1", 4, [2, 3]);
    expect(await scan.fetchScan("d1")).toEqual({ pending: [] });
    expect(await scan.fetchScanText("d1")).toEqual([{ page: 1, text: "t" }]);
    await scan.sendPage("d1", 2, new Blob(["jpeg"], { type: "image/jpeg" }), new AbortController().signal);
    await scan.sendPage("d1", 3, null);
    expect(net.calls.map(({ url, method, headers, credentials, signal }) => ({ url, method, headers, credentials, signal }))).toEqual([
      { url: "/api/v1/documents/d1/scan", method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", signal: false },
      { url: "/api/v1/documents/d1/scan", method: "GET", headers: {}, credentials: "same-origin", signal: false },
      { url: "/api/v1/documents/d1/scan/text", method: "GET", headers: {}, credentials: "same-origin", signal: false },
      { url: "/api/v1/documents/d1/ocr?page=2", method: "POST", headers: { "content-type": "image/jpeg" }, credentials: "same-origin", signal: true },
      { url: "/api/v1/documents/d1/ocr?page=3&blank=1", method: "POST", headers: {}, credentials: "same-origin", signal: false },
    ]);
    expect(net.calls[0]!.body).toEqual({ pages: 4, scanPages: [2, 3] });
    expect(net.calls[3]!.body).toBeInstanceOf(Blob);
  });
});

describe("reading the pages", () => {
  it("every page sent (a drawn one as a picture, a blank one as blank) and done", async () => {
    blank = false;
    net.reply = () => ok();
    const { end, done } = await read([1]);
    expect(end).toMatchObject({ reason: "done", left: [] });
    expect(done).toEqual([1]);
    expect(net.calls[0]).toMatchObject({ url: "/api/v1/documents/d1/ocr?page=1", headers: { "content-type": "image/jpeg" } });
  });

  it("today's limit stops at once (ocr_daily_limit), and so does a person signed out (401 or 403)", async () => {
    net.reply = () => problem(429, { type: "ocr_daily_limit", title: "Today's limit is used" });
    expect((await read([1, 2])).end).toMatchObject({ reason: "limit", left: [1, 2] });
    for (const status of [401, 403]) {
      net.reply = () => problem(status, { type: "unauthorized", title: "Sign in" });
      expect((await read([1])).end).toMatchObject({ reason: "signin", left: [1] });
    }
  });

  it("a 429 waits 4 s and tries the page again, three tries in all", async () => {
    net.reply = () => problem(429, { type: "rate_limited", title: "Slow down" });
    const { end } = await read([1]);
    expect(net.calls).toHaveLength(3);
    expect(delays.filter((d) => d >= 1000)).toEqual([4000, 4000]);
    expect(end).toMatchObject({ reason: "done", left: [1] });
  });

  it("a failure (a 5xx or a lost connection) waits 1.5 s and tries the page once more; four failures in a row stop as unavailable", async () => {
    net.reply = (_c, n) => (n === 1 ? problem(503, "x") : ok());
    expect((await read([1])).end).toMatchObject({ reason: "done", left: [] });
    expect(net.calls).toHaveLength(2);
    expect(delays.filter((d) => d >= 1000)).toEqual([1500]);
    net.calls = [];
    delays = [];
    net.reply = () => offline();
    const { end } = await read([1, 2, 3, 4, 5]);
    expect(end.reason).toBe("unavailable");
    expect(net.calls.length).toBeGreaterThanOrEqual(4);
  });

  it("a page the models could not reach ('retry') is sent once more at the end", async () => {
    net.reply = () => ok("retry");
    const { end, done } = await read([1]);
    expect(net.calls).toHaveLength(2);
    expect(done).toEqual([]);
    expect(end).toMatchObject({ reason: "done", left: [1] });
  });
});
