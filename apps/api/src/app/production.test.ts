import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ DurableObject: class {}, WorkflowEntrypoint: class {}, WorkerEntrypoint: class {}, RpcTarget: class {} }));
vi.mock("cloudflare:workflows", () => ({ NonRetryableError: class extends Error {} }));
const { default: worker } = await import("../index");

/**
 * Production never reaches development code (docs/design/untangle.md, F7): the Worker built with a production environment (no ENABLE_DEV_ROUTES, no QA_STUB) answers every development route
 * with a plain 404, from its own origin and signed in or not, whatever the method; with ENABLE_DEV_ROUTES=1 the same routes are there.
 */

const ORIGIN = "http://localhost";

/** Every development route of the Worker: the /api/v1/dev/* routes and the development routes of the chat. */
const DEV_ROUTES: [string, string][] = [
  ["POST", "/api/v1/dev/llm"],
  ["GET", "/api/v1/dev/r2-exists?key=x"],
  ["PUT", "/api/v1/dev/r2-object?key=x"],
  ["DELETE", "/api/v1/dev/r2-object?key=x"],
  ["POST", "/api/v1/dev/sql"],
  ["POST", "/api/v1/dev/cache"],
  ["POST", "/api/v1/dev/kv"],
  ["POST", "/api/v1/dev/gate"],
  ["POST", "/api/v1/dev/make-admin"],
  ["POST", "/api/v1/chat/route"],
  ["POST", "/api/v1/chat/judge"],
];

/** A database that answers every statement with nothing (a production Worker never gets as far as asking it here). */
const db = {
  prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) }), first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) }),
  batch: async () => [],
};
const files = { head: async () => null, put: async () => null, delete: async () => undefined };
const ctx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext;

async function send(method: string, path: string, env: Record<string, unknown>): Promise<{ status: number; type: unknown }> {
  const res = await worker.fetch!(
    new Request(`${ORIGIN}${path}`, { method, headers: { origin: ORIGIN, "content-type": "application/json", cookie: `sid=${"t".repeat(40)}` }, ...(method === "GET" ? {} : { body: JSON.stringify({ sql: ["SELECT 1"], op: "list", name: "crossref", message: "hello", text: "x" }) }) }) as never,
    { DB: db, FILES: files, CROSSREF_MAILTO: "t@example.org", ...env } as never,
    ctx,
  );
  const text = await res.text();
  let type: unknown = null;
  try {
    type = (JSON.parse(text) as { type?: unknown }).type ?? null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, type };
}

describe("a production Worker (untangle F7)", () => {
  it.each(DEV_ROUTES)("answers %s %s with a plain 404", async (method, path) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    for (const env of [{}, { QA_STUB: "1" }, { ENABLE_DEV_ROUTES: "0", QA_STUB: "1" }, { ENABLE_DEV_ROUTES: "true" }]) {
      const r = await send(method, path, env);
      expect({ env, ...r }).toEqual({ env, status: 404, type: "not_found" });
    }
  });

  it.each(DEV_ROUTES.filter(([, p]) => p.startsWith("/api/v1/dev/")))("has %s %s in development mode", async (method, path) => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await send(method, path, { ENABLE_DEV_ROUTES: "1", QA_STUB: "1" }).catch(() => ({ status: 500, type: "threw" }));
    expect(r.status).not.toBe(404);
  });
});

describe("the stand-ins (untangle F7)", () => {
  it("are imported by app/stand-ins.ts only: no production module imports a testing/ module (one of the same testing/ folder may)", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { dirname, join, relative, resolve } = await import("node:path");
    const slash = (p: string) => p.split(String.fromCharCode(92)).join("/");
    const { fileURLToPath } = await import("node:url");
    const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const files = (readdirSync(SRC, { recursive: true }) as string[]).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts")).map(slash);
    const testingOf = (f: string) => /^([^/]+)\/testing\//.exec(f)?.[1] ?? null;
    const importers: Record<string, string[]> = {};
    for (const file of files) {
      const source = readFileSync(join(SRC, file), "utf8");
      for (const m of source.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
        const target = slash(relative(SRC, resolve(join(SRC, dirname(file)), m[1]!)));
        const feature = testingOf(target);
        if (!feature) continue;
        if (testingOf(file) === feature) continue;
        (importers[target] ??= []).push(file);
      }
    }
    expect(Object.keys(importers).length).toBeGreaterThan(8);
    for (const [target, from] of Object.entries(importers)) expect([target, [...new Set(from)]]).toEqual([target, ["app/stand-ins.ts"]]);
  });
});
