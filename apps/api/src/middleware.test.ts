import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { apiSecurityHeaders, requestLog, type LogLine } from "./middleware";

function appWithLog() {
  const lines: LogLine[] = [];
  const app = new Hono<{ Variables: { requestId: string } }>();
  app.use("*", requestLog((l) => lines.push(l)));
  app.use("/api/*", apiSecurityHeaders);
  app.get("/api/ok", (c) => c.json({ ok: true }));
  app.get("/api/missing", (c) => c.json({}, 404));
  app.get("/api/boom", () => {
    throw new Error("secret detail");
  });
  app.onError((_e, c) => c.json({ requestId: c.get("requestId") }, 500));
  return { app, lines };
}

describe("requestLog", () => {
  it("echoes a generated request id and logs one line without the query string", async () => {
    const { app, lines } = appWithLog();
    const res = await app.request("/api/ok?q=my+private+thesis+topic&code=oauth-code");
    const id = res.headers.get("x-request-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ level: "info", requestId: id, method: "GET", path: "/api/ok", status: 200 });
    expect(JSON.stringify(lines[0])).not.toMatch(/thesis|oauth-code/);
  });

  it("accepts a well-formed incoming id and rejects a malformed one", async () => {
    const { app } = appWithLog();
    const good = await app.request("/api/ok", { headers: { "x-request-id": "abc-12345678" } });
    expect(good.headers.get("x-request-id")).toBe("abc-12345678");
    const bad = await app.request("/api/ok", { headers: { "x-request-id": "x y<script>" } });
    expect(bad.headers.get("x-request-id")).not.toContain("script");
  });

  it("uses warn for 4xx and error for 5xx, and still logs when a handler throws", async () => {
    const { app, lines } = appWithLog();
    await app.request("/api/missing");
    const boom = await app.request("/api/boom");
    expect(lines.map((l) => [l.status, l.level])).toEqual([
      [404, "warn"],
      [500, "error"],
    ]);
    expect(((await boom.json()) as { requestId: string }).requestId).toBe(lines[1]!.requestId);
  });
});

describe("apiSecurityHeaders", () => {
  it("locks API responses down", async () => {
    const { app } = appWithLog();
    const res = await app.request("/api/ok");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });
});
