import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeNet, json, offline, problem, type Net } from "../test/fake-net";
import { render, unmount } from "../test/fake-react";

/**
 * The small request modules (report a problem, the privacy note, a paper's notes), as they were before the one browser client (docs/design/untangle.md, F9): the requests made, the
 * Idempotency-Key, the one retry of a report, and the words each says when the server refuses.
 */

vi.mock("react", async () => (await import("../test/fake-react")).react);
const refreshed = vi.hoisted(() => ({ n: 0 }));
vi.mock("./auth", () => ({ refreshAuth: async () => void refreshed.n++ }));

const { sendReport } = await import("./feedback");
const { acknowledgePrivacy } = await import("./legal");
const { useNotes } = await import("./notes");
const { PRIVACY_VERSION } = await import("@scholar/shared");

let net: Net;
let delays: number[];
beforeEach(() => {
  net = fakeNet();
  delays = [];
  vi.useFakeTimers();
  const real = globalThis.setTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => void, ms?: number) => (delays.push(ms ?? 0), real(fn, ms))) as typeof setTimeout);
});
afterEach(() => {
  unmount();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("report a problem", () => {
  const report = { kind: "bug", text: "It broke" } as never;

  it("POST /api/v1/feedback with an Idempotency-Key; a lost connection is tried once more after 900 ms with the same key", async () => {
    net.reply = (_c, n) => (n === 1 ? offline() : json({ ok: true }, 201));
    const p = sendReport(report);
    await vi.advanceTimersByTimeAsync(900);
    await p;
    expect(net.calls).toHaveLength(2);
    expect(net.calls[0]).toMatchObject({ url: "/api/v1/feedback", method: "POST", body: report, credentials: "same-origin", headers: { "content-type": "application/json" } });
    expect(net.calls[0]!.headers["idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(net.calls[1]!.headers["idempotency-key"]).toBe(net.calls[0]!.headers["idempotency-key"]);
    expect(delays.filter((d) => d >= 100)).toEqual([900]);
  });

  it("two lost connections reject with the network's error; a refusal is not tried again and says the problem", async () => {
    net.reply = () => offline();
    const p = sendReport(report).catch((e) => e);
    await vi.advanceTimersByTimeAsync(900);
    expect(await p).toBeInstanceOf(TypeError);
    expect(net.calls).toHaveLength(2);
    net.calls = [];
    net.reply = () => problem(429, { type: "rate_limited", title: "Too many reports", detail: "Wait a minute" });
    expect(await sendReport(report).catch((e) => e)).toMatchObject({ status: 429, type: "rate_limited", message: "Too many reports. Wait a minute" });
    expect(net.calls).toHaveLength(1);
    net.reply = () => problem(500, "x");
    expect(await sendReport(report).catch((e) => e)).toMatchObject({ status: 500, type: "error", message: "The report could not be sent" });
  });
});

describe("the privacy note read", () => {
  it("POST /api/v1/account/privacy-ack with the version, then the sign-in state is read again", async () => {
    refreshed.n = 0;
    net.reply = () => json({ ok: true });
    await acknowledgePrivacy();
    expect(net.calls).toEqual([{ url: "/api/v1/account/privacy-ack", method: "POST", headers: { "content-type": "application/json" }, body: { version: PRIVACY_VERSION }, credentials: "same-origin", keepalive: undefined, signal: false }]);
    expect(refreshed.n).toBe(1);
  });

  it("refused: the problem's words, or 'That could not be saved'; the sign-in state is not read again", async () => {
    refreshed.n = 0;
    net.reply = () => problem(401, { type: "unauthorized", title: "Sign in first" });
    expect(await acknowledgePrivacy().catch((e) => e)).toMatchObject({ status: 401, type: "unauthorized", message: "Sign in first" });
    net.reply = () => problem(500, "");
    expect(await acknowledgePrivacy().catch((e) => e)).toMatchObject({ status: 500, type: "error", message: "That could not be saved" });
    expect(refreshed.n).toBe(0);
  });
});

describe("a paper's notes", () => {
  const note = (id: string, page = 1) => ({ id, page, quote: "q", note: null, color: "yellow", createdAt: 1 });

  it("loads them, and adds, changes and removes one: the requests", async () => {
    net.reply = (c) => json(c.method === "GET" ? { items: [note("n1", 2)] } : c.method === "DELETE" ? { ok: true } : { note: c.method === "POST" ? note("n2", 1) : { ...note("n1", 2), note: "x" } });
    render(() => useNotes("d1"));
    await vi.advanceTimersByTimeAsync(0);
    let api = render(() => useNotes("d1"));
    expect(api).toMatchObject({ status: "ready", notes: [note("n1", 2)] });
    await api.add({ page: 1, quote: "q" });
    await api.update("n1", { note: "x" });
    await api.remove("n2");
    api = render(() => useNotes("d1"));
    expect(api.notes.map((n) => n.id)).toEqual(["n1"]);
    const J = { "content-type": "application/json" };
    expect(net.calls.map(({ url, method, headers, body, credentials }) => ({ url, method, headers, body, credentials }))).toEqual([
      { url: "/api/v1/documents/d1/notes", method: "GET", headers: {}, body: null, credentials: "same-origin" },
      { url: "/api/v1/documents/d1/notes", method: "POST", headers: J, body: { page: 1, quote: "q" }, credentials: "same-origin" },
      { url: "/api/v1/documents/d1/notes/n1", method: "PATCH", headers: J, body: { note: "x" }, credentials: "same-origin" },
      { url: "/api/v1/documents/d1/notes/n2", method: "DELETE", headers: {}, body: null, credentials: "same-origin" },
    ]);
  });

  it("the words: a list that could not be loaded, a change the server refused (its problem), one with no problem in the reply", async () => {
    net.reply = () => problem(500, "x");
    render(() => useNotes("d1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(render(() => useNotes("d1"))).toMatchObject({ status: "error", error: "Your notes could not be loaded." });
    net.reply = () => problem(413, { type: "notes_full", title: "This paper has as many notes as it can hold", detail: "Remove one first" });
    await render(() => useNotes("d1")).add({ page: 1, quote: "q" });
    expect(render(() => useNotes("d1")).error).toBe("This paper has as many notes as it can hold. Remove one first");
    net.reply = () => problem(502, "");
    await render(() => useNotes("d1")).remove("n1");
    expect(render(() => useNotes("d1")).error).toBe("That could not be saved");
  });
});
