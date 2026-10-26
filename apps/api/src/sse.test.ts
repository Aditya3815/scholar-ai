import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { KEEP_ALIVE_MS, sseStream, type SseSession } from "./sse";

type Ev = { type: "step" | "done" | "error"; n?: number; title?: string };
const FALLBACK: Ev = { type: "error", title: "Something went wrong" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs `work` inside a stream and returns the raw text the browser would have received. */
async function body(work: (s: SseSession<Ev>) => Promise<void>, env: Record<string, string> = {}, abort?: AbortController): Promise<string> {
  const app = new Hono();
  app.get("/", (c) => sseStream<Ev>(c, { terminal: ["done", "error"], fallback: FALLBACK, abort }, work));
  const res = await app.request("/", {}, env);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  return await res.text();
}
const events = (raw: string) => [...raw.matchAll(/^event: (\w+)\ndata: (.*)$/gm)].map((m) => JSON.parse(m[2]!) as Ev);

describe("sseStream", () => {
  it("sends the events in order and ends with the terminal event the work sent", async () => {
    const raw = await body(async (s) => {
      await s.send({ type: "step", n: 1 });
      await s.send({ type: "step", n: 2 });
      await s.send({ type: "done" });
    });
    expect(events(raw).map((e) => e.type)).toEqual(["step", "step", "done"]);
  });

  it("sends the fallback error when the work ends without a terminal event", async () => {
    const raw = await body(async (s) => {
      await s.send({ type: "step", n: 1 });
    });
    expect(events(raw)).toEqual([{ type: "step", n: 1 }, FALLBACK]);
  });

  it("turns an exception that escapes into the fallback error (and keeps what was already sent)", async () => {
    const raw = await body(async (s) => {
      await s.send({ type: "step", n: 1 });
      throw new Error("boom with a secret");
    });
    expect(events(raw).map((e) => e.type)).toEqual(["step", "error"]);
    expect(raw).not.toContain("secret");
  });

  it("drops a second terminal event: one stream, one ending", async () => {
    const raw = await body(async (s) => {
      await s.send({ type: "error", title: "first" });
      await s.send({ type: "done" });
      await s.send({ type: "error", title: "second" });
    });
    expect(events(raw)).toEqual([{ type: "error", title: "first" }]);
  });

  it("sends a keep-alive comment while the work is quiet, never before the interval, and none after the end", async () => {
    const quiet = await body(
      async (s) => {
        await sleep(260);
        await s.send({ type: "done" });
      },
      { ENABLE_DEV_ROUTES: "1", SSE_KEEPALIVE_MS: "60" },
    );
    expect((quiet.match(/^: keep-alive$/gm) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(quiet.trimEnd().endsWith("}")).toBe(true); // the last thing sent is the terminal event
    const fast = await body(async (s) => s.send({ type: "done" }), { ENABLE_DEV_ROUTES: "1", SSE_KEEPALIVE_MS: "60" });
    expect(fast).not.toContain("keep-alive");
  });

  it("ignores a shortened interval unless the development switch is on, and never goes below 50 ms", async () => {
    const work = async (s: SseSession<Ev>) => {
      await sleep(200);
      await s.send({ type: "done" });
    };
    expect(await body(work, { SSE_KEEPALIVE_MS: "60" })).not.toContain("keep-alive");
    expect(await body(work, { ENABLE_DEV_ROUTES: "1", SSE_KEEPALIVE_MS: "5" })).not.toContain("keep-alive");
    expect(KEEP_ALIVE_MS).toBe(15_000);
  });

  it("a keep-alive line is a comment: the browser's reader finds no event in it", async () => {
    const raw = await body(
      async (s) => {
        await sleep(150);
        await s.send({ type: "done" });
      },
      { ENABLE_DEV_ROUTES: "1", SSE_KEEPALIVE_MS: "60" },
    );
    expect(events(raw).map((e) => e.type)).toEqual(["done"]);
  });
});
