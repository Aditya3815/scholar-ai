import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeNet, json, problem, sse, type Call, type Net } from "../test/fake-net";

/**
 * The papers' requests, as they were before the one browser client (docs/design/untangle.md, F9): the list and its changes, the question stream, the upload (with its Idempotency-Key and its
 * retries) and the indexing retry. The PDF is stood in (lib/pdf.ts); the upload's XMLHttpRequest is a fake that answers from `xhrReply`.
 */

vi.mock("react", async () => (await import("../test/fake-react")).react);
vi.mock("./offline", () => ({ removeCachedPaper: async () => {} }));
const pdfPages = vi.hoisted(() => ({ texts: [] as string[] }));
vi.mock("./pdf", () => {
  class PdfError extends Error {
    constructor(message: string, readonly kind = "other") {
      super(message);
    }
  }
  const pdf = () => ({ numPages: pdfPages.texts.length, getPage: async (n: number) => ({ n, cleanup() {} }), loadingTask: { destroy: async () => {} } });
  return { PdfError, openPdf: async () => pdf(), readPage: async (p: { n: number }) => ({ text: pdfPages.texts[p.n - 1], lines: [] }), readOutline: async () => [], renderCover: async () => null };
});

type Sent = { method: string; url: string; headers: Record<string, string>; body: unknown; withCredentials: boolean };
let xhrSent: Sent[];
let xhrReply: (n: number) => { status: number; body: string } | "network";
class FakeXhr {
  status = 0;
  responseText = "";
  withCredentials = false;
  upload: { onprogress: ((e: unknown) => void) | null } = { onprogress: null };
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;
  private sent: Sent = { method: "", url: "", headers: {}, body: null, withCredentials: false };
  open(method: string, url: string) {
    this.sent = { ...this.sent, method, url };
  }
  setRequestHeader(k: string, v: string) {
    this.sent.headers[k] = v;
  }
  send(body: unknown) {
    xhrSent.push({ ...this.sent, body, withCredentials: this.withCredentials });
    const r = xhrReply(xhrSent.length);
    queueMicrotask(() => {
      if (r === "network") return this.onerror?.();
      this.status = r.status;
      this.responseText = r.body;
      this.onload?.();
    });
  }
}

const g = globalThis as unknown as Record<string, unknown>;
const docs = await import("./documents");

let net: Net;
let delays: number[];
beforeEach(() => {
  net = fakeNet();
  xhrSent = [];
  delays = [];
  g.XMLHttpRequest = FakeXhr;
  g.window = { setTimeout: () => 0, clearTimeout: () => {} };
  vi.useFakeTimers();
  const real = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => (delays.push(ms ?? 0), real(fn, ms))) as typeof setTimeout);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const req = (url: string, method = "GET", over: Partial<Call> = {}): Call => ({ url, method, headers: {}, body: null, credentials: "same-origin", keepalive: undefined, signal: false, ...over });
const jsonReq = (url: string, method: string, body: unknown, over: Partial<Call> = {}): Call => req(url, method, { headers: { "content-type": "application/json" }, body, ...over });
const DOC = { id: "d1", title: "A paper", status: "ready", pages: 1 };

describe("the papers' requests", () => {
  it("each call: address, method, headers, body, credentials, keepalive", async () => {
    net.reply = (c) => json(c.url.includes("/search") ? { papers: [] } : c.url.includes("/remember") ? { highlight: null, total: 0 } : c.url.endsWith("/ask-highlights") ? { answer: 1, used: 1, total: 1 } : { document: DOC, items: [], usage: null, history: [], info: null, scan: null, ok: true });
    const s = new AbortController().signal;
    await docs.fetchDocument("d1");
    await docs.savePaperInfo("d1", { doi: null } as never);
    await docs.askHighlights("d1", "why?", { yellow: "x" } as never, s);
    await docs.searchWorkspace("a b", s);
    await docs.fetchRemember(2);
    await docs.renameDoc("d1", "New");
    await docs.setMeta("d1", { tags: ["t"] });
    docs.postProgress("d1", 3, true);
    await docs.removeDoc("d1");
    await vi.advanceTimersByTimeAsync(0);
    expect(net.calls).toEqual([
      req("/api/v1/documents/d1"),
      jsonReq("/api/v1/documents/d1/info", "PUT", { doi: null }),
      jsonReq("/api/v1/documents/d1/ask-highlights", "POST", { question: "why?", legend: { yellow: "x" } }, { signal: true }),
      req("/api/v1/documents/search?q=a%20b", "GET", { signal: true }),
      req("/api/v1/documents/remember?skip=2"),
      jsonReq("/api/v1/documents/d1", "PATCH", { title: "New" }),
      jsonReq("/api/v1/documents/d1/meta", "PUT", { tags: ["t"] }),
      jsonReq("/api/v1/documents/d1/progress", "POST", { page: 3 }, { keepalive: true }),
      req("/api/v1/documents/d1", "DELETE"),
      req("/api/v1/documents"),
    ]);
  });

  it("a refusal is an ApiError with the problem's fields; the list says its message", async () => {
    net.reply = () => problem(401, { type: "unauthorized", title: "Sign in to see your papers" });
    const e = await docs.fetchDocument("d1").catch((x) => x);
    expect(e).toMatchObject({ status: 401, type: "unauthorized", message: "Sign in to see your papers" });
    expect(e).toBeInstanceOf(docs.ApiError);
    await docs.loadDocs();
    expect(docs.useDocs()).toMatchObject({ status: "error", error: "Sign in to see your papers" });
    net.reply = () => problem(500, "oops");
    expect(await docs.fetchDocument("d1").catch((x) => x)).toMatchObject({ status: 500, type: "error", message: "The service answered 500" });
  });
});

describe("a question about a paper, as a stream", () => {
  it("POST ...?stream=1 with the question; events go on; resolves with the answer", async () => {
    net.reply = () => sse([{ type: "stage", stage: "reading" }, { type: "delta", text: "Hi" }, { type: "answer", answer: { a: 1 } }]);
    const seen: string[] = [];
    expect(await docs.askDocumentStream("d1", "why?", (e) => seen.push(e.type), new AbortController().signal)).toEqual({ a: 1 });
    expect(seen).toEqual(["stage", "delta", "answer"]);
    expect(net.calls).toEqual([jsonReq("/api/v1/documents/d1/ask?stream=1", "POST", { question: "why?" }, { signal: true })]);
  });

  it("refused, an error event, cut off", async () => {
    net.reply = () => problem(429, { type: "quota", title: "Today's allowance is used" });
    expect(await docs.askDocumentStream("d1", "q", () => {}).catch((e) => e)).toMatchObject({ status: 429, type: "quota", message: "Today's allowance is used" });
    net.reply = () => sse([{ type: "error", code: "ai_unavailable", title: "The model is busy", detail: "Try again" }]);
    const e = await docs.askDocumentStream("d1", "q", () => {}).catch((x) => x);
    expect(e).toBeInstanceOf(docs.ApiError);
    expect(e).toMatchObject({ status: 200, message: "The model is busy. Try again" });
    net.reply = () => sse([{ type: "delta", text: "Hi" }]);
    const cut = await docs.askDocumentStream("d1", "q", () => {}).catch((x) => x);
    expect(cut).toBeInstanceOf(TypeError);
    expect(cut.message).toBe("The answer was cut off. Please try again.");
  });
});

describe("an upload", () => {
  const LONG = "word ".repeat(400);
  const file = (name = "paper.pdf") => Object.assign(new Blob(["%PDF-1.7"], { type: "application/pdf" }), { name, arrayBuffer: async () => new ArrayBuffer(8) }) as unknown as File;
  const created = { status: 201, body: JSON.stringify({ document: DOC }) };
  const jobOf = () => docs.useJobs().at(-1)!;
  const run = async (f = file()) => {
    const p = docs.startUpload(f);
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1000);
    await p;
  };

  beforeEach(() => {
    pdfPages.texts = [LONG];
    net.reply = (c) => json(c.url.endsWith("/finish") ? { document: DOC } : c.url.endsWith("/info") ? { document: DOC, info: {} } : { items: [], usage: null, document: DOC });
  });

  it("sends the file with its name and an Idempotency-Key, then the info, the pages and the finish", async () => {
    xhrReply = () => created;
    await run(file("My paper (1).pdf"));
    expect(xhrSent).toHaveLength(1);
    expect(xhrSent[0]).toMatchObject({ method: "POST", url: "/api/v1/documents", withCredentials: true, headers: { "Content-Type": "application/pdf", "X-Filename": "My%20paper%20(1).pdf" } });
    expect(xhrSent[0]!.headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(net.calls.map((c) => `${c.method} ${c.url}`)).toEqual(["PUT /api/v1/documents/d1/info", "POST /api/v1/documents/d1/pages", "POST /api/v1/documents/d1/finish", "GET /api/v1/documents"]);
    expect(net.calls[1]).toEqual(jsonReq("/api/v1/documents/d1/pages", "POST", { pages: [{ page: 1, text: LONG }] }));
    expect(net.calls[2]!.body).toEqual({ pages: 1 });
    expect(jobOf()).toMatchObject({ step: "done", detail: "1 pages indexed" });
  });

  it("a lost connection, or a first try still being finished, is tried again with the same key: at most three tries, 900 and 1800 ms apart", async () => {
    xhrReply = (n) => (n === 1 ? "network" : n === 2 ? { status: 409, body: JSON.stringify({ type: "idempotency_in_progress", title: "Still storing it" }) } : created);
    await run();
    expect(xhrSent).toHaveLength(3);
    expect(new Set(xhrSent.map((s) => s.headers["Idempotency-Key"])).size).toBe(1);
    expect(delays.filter((d) => d >= 900)).toEqual([900, 1800]);
    expect(jobOf().step).toBe("done");
    xhrReply = () => "network";
    await run();
    expect(xhrSent).toHaveLength(6);
    expect(jobOf()).toMatchObject({ step: "error", error: "The connection was lost. Check your internet and try again." });
  });

  it("a refusal is not tried again, and says the problem; a reply with no problem says the status", async () => {
    xhrReply = () => ({ status: 413, body: JSON.stringify({ type: "too_big", title: "This PDF is too big", detail: "The limit is 50 MB" }) });
    await run();
    expect(xhrSent).toHaveLength(1);
    expect(jobOf()).toMatchObject({ step: "error", error: "This PDF is too big. The limit is 50 MB" });
    xhrReply = () => ({ status: 502, body: "<html>" });
    await run();
    expect(jobOf()).toMatchObject({ step: "error", error: "The upload failed (502)" });
  });

  it("indexing: a 5xx or a 429 is tried once more after 900 ms; another 4xx is not", async () => {
    xhrReply = () => created;
    let pages = 0;
    net.reply = (c) => (c.url.endsWith("/pages") ? (++pages === 1 ? problem(503, "busy") : json({ ok: true })) : json(c.url.endsWith("/info") ? { document: DOC, info: {} } : { document: DOC, items: [], usage: null }));
    await run();
    expect(pages).toBe(2);
    expect(delays.filter((d) => d === 900)).toEqual([900]);
    expect(jobOf().step).toBe("done");
    pages = 0;
    net.reply = (c) => (c.url.endsWith("/pages") ? (++pages === 1 ? problem(429, { type: "rate_limited", title: "Slow down" }) : json({ ok: true })) : json({ document: DOC, info: {}, items: [], usage: null }));
    await run();
    expect(pages).toBe(2);
    pages = 0;
    net.reply = (c) => (c.url.endsWith("/pages") ? (++pages, problem(400, { type: "invalid_pages", title: "Those pages are not right" })) : json({ document: DOC, info: {}, items: [], usage: null }));
    await run();
    expect(pages).toBe(1);
    expect(jobOf()).toMatchObject({ step: "error", error: "Those pages are not right", retryable: true });
  });
});
