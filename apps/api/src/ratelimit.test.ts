import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { rateLimit, type LimitEnv } from "./ratelimit";

const limiter = (allow: boolean | "throw") => ({
  calls: [] as string[],
  async limit({ key }: { key: string }) {
    this.calls.push(key);
    if (allow === "throw") throw new Error("limiter down");
    return { success: allow };
  },
});

function appWith(env: LimitEnv) {
  const app = new Hono<{ Bindings: LimitEnv }>();
  app.use("/api/*", rateLimit());
  app.get("/api/v1/health", (c) => c.json({ ok: true }));
  app.get("/api/v1/search", (c) => c.json({ ok: true }));
  app.get("/api/v1/library", (c) => c.json({ ok: true }));
  app.post("/api/v1/references/verify", (c) => c.json({ ok: true }));
  return (path: string, ip = "203.0.113.7") => app.request(path, { headers: { "cf-connecting-ip": ip } }, env);
}

describe("rateLimit", () => {
  it("uses the search bucket for search and the API bucket for everything else, keyed by IP", async () => {
    const search = limiter(true);
    const api = limiter(true);
    const get = appWith({ SEARCH_LIMITER: search, API_LIMITER: api });
    await get("/api/v1/search?q=x");
    await get("/api/v1/library");
    expect(search.calls).toEqual(["203.0.113.7"]);
    expect(api.calls).toEqual(["203.0.113.7"]);
  });

  it("puts the strict check of an answer on the AI bucket, and the chat itself on the search bucket", async () => {
    const ask = limiter(true);
    const api = limiter(true);
    const search = limiter(true);
    const app = new Hono<{ Bindings: LimitEnv }>();
    app.use("/api/*", rateLimit());
    app.post("/api/v1/chat/tighten", (c) => c.json({ ok: true }));
    app.post("/api/v1/chat", (c) => c.json({ ok: true }));
    const env = { SEARCH_LIMITER: search, ASK_LIMITER: ask, API_LIMITER: api };
    await app.request("/api/v1/chat/tighten", { method: "POST", headers: { "cf-connecting-ip": "198.51.100.9" } }, env);
    await app.request("/api/v1/chat", { method: "POST", headers: { "cf-connecting-ip": "198.51.100.9" } }, env);
    expect(ask.calls).toEqual(["198.51.100.9"]);
    expect(search.calls).toEqual(["198.51.100.9"]);
    expect(api.calls).toEqual([]);
  });

  it("gives reference verification its own bucket", async () => {
    const verify = limiter(true);
    const api = limiter(true);
    const search = limiter(true);
    const app = new Hono<{ Bindings: LimitEnv }>();
    app.use("/api/*", rateLimit());
    app.post("/api/v1/references/verify", (c) => c.json({ ok: true }));
    await app.request("/api/v1/references/verify", { method: "POST", headers: { "cf-connecting-ip": "198.51.100.2" } }, { SEARCH_LIMITER: search, VERIFY_LIMITER: verify, API_LIMITER: api });
    expect(verify.calls).toEqual(["198.51.100.2"]);
    expect(api.calls).toEqual([]);
    expect(search.calls).toEqual([]);
  });

  it("limits idea planning like asking (it calls the model) and idea searching like searching (it fans out to services)", async () => {
    const ask = limiter(true);
    const search = limiter(true);
    const api = limiter(true);
    const app = new Hono<{ Bindings: LimitEnv }>();
    app.use("/api/*", rateLimit());
    app.post("/api/v1/idea/plan", (c) => c.json({ ok: true }));
    app.post("/api/v1/idea/search", (c) => c.json({ ok: true }));
    const env = { ASK_LIMITER: ask, SEARCH_LIMITER: search, API_LIMITER: api };
    await app.request("/api/v1/idea/plan", { method: "POST", headers: { "cf-connecting-ip": "198.51.100.9" } }, env);
    await app.request("/api/v1/idea/search", { method: "POST", headers: { "cf-connecting-ip": "198.51.100.9" } }, env);
    expect(ask.calls).toEqual(["198.51.100.9"]);
    expect(search.calls).toEqual(["198.51.100.9"]);
    expect(api.calls).toEqual([]);
  });

  it("answers 429 with Retry-After when the bucket is empty", async () => {
    const get = appWith({ SEARCH_LIMITER: limiter(false), API_LIMITER: limiter(true) });
    const res = await get("/api/v1/search?q=x");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(((await res.json()) as { type: string }).type).toBe("rate_limited");
    expect((await get("/api/v1/library")).status).toBe(200);
  });

  it("never limits health checks", async () => {
    const api = limiter(false);
    const get = appWith({ SEARCH_LIMITER: limiter(false), API_LIMITER: api });
    expect((await get("/api/v1/health")).status).toBe(200);
    expect(api.calls).toEqual([]);
  });

  it("fails open when the limiter errors or is not bound", async () => {
    expect((await appWith({ SEARCH_LIMITER: limiter("throw") })("/api/v1/search?q=x")).status).toBe(200);
    expect((await appWith({})("/api/v1/library")).status).toBe(200);
  });
});
