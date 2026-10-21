import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { allowEvent, buildEvent, captureException, envelopeFor, parseDsn, parseStack, resetEventLimit, routeOf, scrubMessage, sendEvent } from "./sentry";
import { monitoringRoutes } from "./routes";

const DSN = "https://abc123publickey@o42.ingest.de.sentry.io/4507";
beforeEach(() => resetEventLimit());
afterEach(() => vi.unstubAllGlobals());

describe("parseDsn", () => {
  it("reads a Sentry DSN, and refuses anything else", () => {
    expect(parseDsn(DSN)).toEqual({ key: "abc123publickey", host: "o42.ingest.de.sentry.io", project: "4507", protocol: "https" });
    expect(parseDsn(undefined)).toBeNull();
    expect(parseDsn("")).toBeNull();
    expect(parseDsn("not a url")).toBeNull();
    expect(parseDsn("https://o42.ingest.sentry.io/4507")).toBeNull(); // no key
    expect(parseDsn("https://k@o42.ingest.sentry.io/notanumber")).toBeNull();
    expect(parseDsn("ftp://k@host/1")).toBeNull();
  });
});

describe("what is allowed to leave", () => {
  it("takes e-mail addresses, links and long ids out of messages, and shortens them", () => {
    expect(scrubMessage("failed for ira@example.edu at https://lab.example/x with doc 3f9a1c2b4d5e6f708192a3b4")).toBe("failed for [email] at [link] with doc :id");
    expect(scrubMessage("x".repeat(1000))).toHaveLength(300);
    expect(scrubMessage(new Error("boom"))).toBe("boom");
    expect(scrubMessage(undefined)).toBe("");
  });

  it("reduces a page address to a route pattern: no ids, no query, no fragment", () => {
    expect(routeOf("/papers/3f9a1c2b4d5e6f708192a3b4?q=my+secret+idea#x")).toBe("/papers/:id");
    expect(routeOf("https://scholar.example/api/v1/documents/3f9a1c2b4d5e6f708192a3b4/ask?stream=1")).toBe("/api/v1/documents/:id/ask");
    expect(routeOf("/idea")).toBe("/idea");
  });

  it("reads stack traces from Chrome and Firefox, oldest call first, without query strings", () => {
    const chrome = "Error: x\n    at inner (https://s.example/assets/app.js?v=1:10:20)\n    at https://s.example/assets/app.js:30:5";
    const frames = parseStack(chrome);
    expect(frames.map((f) => f.lineno)).toEqual([30, 10]);
    expect(frames[1]).toMatchObject({ function: "inner", filename: "https://s.example/assets/app.js", colno: 20 });
    expect(parseStack("inner@https://s.example/app.js:7:9")[0]).toMatchObject({ function: "inner", lineno: 7 });
    expect(parseStack(undefined)).toEqual([]);
  });

  it("builds an event with nothing about the user or the request in it", () => {
    const e = buildEvent({ type: "TypeError", message: "bad thing for ira@example.edu", stack: "TypeError\n    at f (a.js:1:2)", route: "/api/v1/idea/plan", source: "worker", release: "v1" }, {});
    const json = JSON.stringify(e);
    expect(json).not.toMatch(/ira@example|"user"|"request"|ip_address|cookie|authorization/i);
    expect(e.exception.values[0]!.value).toBe("bad thing for [email]");
    expect(e.tags).toMatchObject({ source: "worker", route: "/api/v1/idea/plan" });
    expect(e.event_id).toMatch(/^[0-9a-f]{32}$/);
    expect(e.environment).toBe("production");
  });
});

describe("sending", () => {
  const input = { type: "Error", message: "boom", route: "/x", source: "worker" as const };

  it("posts an envelope to the project's endpoint with the public key", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const send = (async (url: string, init: RequestInit) => (calls.push({ url, init }), new Response("{}", { status: 200 }))) as unknown as typeof fetch;
    expect(await sendEvent({ SENTRY_DSN: DSN }, input, send)).toBe(200);
    expect(calls[0]!.url).toBe("https://o42.ingest.de.sentry.io/api/4507/envelope/");
    expect(String((calls[0]!.init.headers as Record<string, string>)["X-Sentry-Auth"])).toContain("sentry_key=abc123publickey");
    const lines = String(calls[0]!.init.body).split("\n");
    expect(JSON.parse(lines[0]!).dsn).toBe(DSN);
    expect(JSON.parse(lines[1]!)).toEqual({ type: "event" });
    expect(JSON.parse(lines[2]!).exception.values[0].value).toBe("boom");
    expect(envelopeFor(JSON.parse(lines[2]!), parseDsn(DSN)!).split("\n")).toHaveLength(3);
  });

  it("does nothing without a DSN, and never throws when Sentry is down", async () => {
    const never = vi.fn();
    expect(await sendEvent({}, input, never as unknown as typeof fetch)).toBeNull();
    expect(never).not.toHaveBeenCalled();
    const down = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await sendEvent({ SENTRY_DSN: DSN }, input, down)).toBeNull();
  });

  it("sends at most 20 events a minute from one isolate", () => {
    const results = Array.from({ length: 25 }, () => allowEvent(1_000));
    expect(results.filter(Boolean)).toHaveLength(20);
    expect(allowEvent(1_000 + 61_000)).toBe(true);
  });

  it("captureException reports an unexpected error and tells the Worker to wait for it", async () => {
    const fetchMock = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    const waits: Promise<unknown>[] = [];
    captureException({ SENTRY_DSN: DSN }, new RangeError("kaput"), { route: "/api/v1/documents/:id/ask", waitUntil: (p) => void waits.push(p) });
    await Promise.all(waits);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    captureException({}, new Error("silent"), { route: "/x" }); // no DSN: nothing
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/v1/monitoring (errors from the browser)", () => {
  const app = new Hono<{ Bindings: { SENTRY_DSN?: string } }>().route("/api/v1/monitoring", monitoringRoutes);
  const waits: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void waits.push(p), passThroughOnException() {} } as unknown as ExecutionContext;
  const post = (body: unknown, env: object, headers: Record<string, string> = {}) =>
    app.request("/api/v1/monitoring", { method: "POST", headers: { Origin: "http://localhost", "Content-Type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }, env, ctx);

  it("says 204 and sends nothing while monitoring is off", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const res = await post({ message: "x" }, {});
    expect(res.status).toBe(204);
    expect(f).not.toHaveBeenCalled();
  });

  it("forwards a browser error with only a short message, the stack and a route pattern", async () => {
    const bodies: string[] = [];
    vi.stubGlobal("fetch", async (_u: string, init: RequestInit) => (bodies.push(String(init.body)), new Response("{}")));
    const res = await post({ type: "TypeError", message: "Cannot read x of undefined for ira@example.edu", stack: "TypeError: x\n    at f (https://s/app.js:1:2)", path: "/papers/3f9a1c2b4d5e6f708192a3b4?q=secret", cookie: "sid=abc", text: "my unpublished idea" }, { SENTRY_DSN: DSN });
    await Promise.all(waits);
    expect(res.status).toBe(204);
    const event = JSON.parse(bodies[0]!.split("\n")[2]!);
    expect(event.tags).toMatchObject({ source: "browser", route: "/papers/:id" });
    expect(JSON.stringify(event)).not.toMatch(/ira@example|secret|unpublished|sid=abc/);
  });

  it("refuses other sites, oversized bodies and garbage, quietly", async () => {
    const f = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", f);
    expect((await post({ message: "x" }, { SENTRY_DSN: DSN }, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await post("x".repeat(20_000), { SENTRY_DSN: DSN })).status).toBe(413);
    expect((await post("not json", { SENTRY_DSN: DSN })).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });
});
