import { Hono } from "hono";
import { AllProvidersFailedError, NoRouteError, PolicyError, QuotaError, gatewayFromEnv, type LlmRequest } from "../platform/llm";
import { currentUser } from "../auth/service";
import { cacheStore } from "../cache";
import { withGate, GATES, type GateName } from "../gate";
import { TRENDING_KEYS } from "../trending/store";
import { devMode } from "../platform/dev";
import type { Env } from "../platform/env";

/**
 * Every development route of the Worker, /api/v1/dev/* (docs/design/untangle.md, F7): what the local test runs use to look inside the Worker and to set up what they test. They are
 * mounted for every request, and in front of them one check answers a plain 404 unless the Worker is in development mode (ENABLE_DEV_ROUTES=1, platform/dev.ts), which no deployed Worker
 * is: a route here never checks for itself. The scripts call them from Node, which sends no Origin, so none of them asks where a request comes from.
 */
export const devRoutes = new Hono<{ Bindings: Env; Variables: { requestId: string } }>();

devRoutes.use("*", async (c, next) => (devMode(c.env) ? next() : c.json({ type: "not_found", title: "Not found" }, 404)));

/** Local smoke test for the LLM Gateway (a plain 404 in production, like every route here, so it can never be used as a free, anonymous LLM endpoint). */
devRoutes.post("/llm", async (c) => {
  const body = await c.req.json<Partial<LlmRequest>>().catch(() => ({}) as Partial<LlmRequest>);
  try {
    const result = await gatewayFromEnv(c.env).complete({
      task: body.task ?? "classify",
      sensitivity: body.sensitivity ?? "private",
      subject: "dev",
      system: body.system ?? "",
      user: body.user ?? "",
      schema: body.schema,
      maxTokens: body.maxTokens,
    });
    return c.json(result);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    const status = e instanceof PolicyError ? 403 : e instanceof NoRouteError ? 422 : e instanceof QuotaError ? 429 : e instanceof AllProvidersFailedError ? 502 : 400;
    return c.json({ type: e instanceof Error ? e.name : "error", title: "LLM request failed", detail }, status);
  }
});

/** Local tests only: is a file still in storage? */
devRoutes.get("/r2-exists", async (c) => {
  return c.json({ exists: (await c.env.FILES.head(c.req.query("key") ?? "")) !== null });
});

/** Local tests only: puts (an empty file) or removes a stored file, to make storage and the database disagree on purpose. */
devRoutes.put("/r2-object", async (c) => {
  await c.env.FILES.put(c.req.query("key") ?? "", "x");
  return c.json({ ok: true });
});
devRoutes.delete("/r2-object", async (c) => {
  await c.env.FILES.delete(c.req.query("key") ?? "");
  return c.json({ ok: true });
});

/**
 * Local tests only: runs SQL statements, one after the other, through the Worker itself and returns the rows of each.
 * Tests must not write to the local database file from a second process (`wrangler d1 execute --local`) while `wrangler dev` has it open:
 * that left the dev server spinning at 100% CPU and answering nothing.
 */
devRoutes.post("/sql", async (c) => {
  const body = (await c.req.json().catch(() => null)) as { sql?: unknown } | null;
  const list = body?.sql;
  if (!Array.isArray(list) || list.length === 0 || list.length > 100 || !list.every((s) => typeof s === "string" && s.length < 20_000)) return c.json({ type: "invalid", title: "Send {sql: [statement, ...]}" }, 400);
  const results: unknown[][] = [];
  for (const s of list) results.push((await c.env.DB.prepare(s).all()).results);
  return c.json({ results });
});

/**
 * Local tests only: reads and writes the public cache through the Worker's own binding, to prove the wiring (KV or the table) and the rules in kv.ts. Never in production
 * (ENABLE_DEV_ROUTES is never set there).
 */
devRoutes.post("/cache", async (c) => {
  const b = (await c.req.json().catch(() => null)) as { op?: string; key?: string; keys?: string[]; value?: string; ttl?: number } | null;
  const store = cacheStore(c.env);
  const driver = c.env.CACHE ? "kv" : "d1";
  if (b?.op === "set" && typeof b.key === "string" && typeof b.value === "string") {
    await store.set(b.key, b.value, b.ttl ?? 300, "dev");
    return c.json({ ok: true, driver });
  }
  if (b?.op === "get" && typeof b.key === "string") return c.json({ ok: true, driver, value: await store.get(b.key) });
  if (b?.op === "getMany" && Array.isArray(b.keys) && b.keys.length <= 500) return c.json({ ok: true, driver, values: Object.fromEntries(await (store.getMany ? store.getMany(b.keys) : Promise.resolve(new Map()))) });
  return c.json({ type: "invalid", title: "Send {op: set|get|getMany, key, value, ttl, keys}" }, 400);
});

/**
 * Local tests only: reads, writes, removes and lists the Trending list's own keys in KV (every key starts with `trending:v1`: src/trending/store.ts), to set and clear the kill switch, to age or break
 * the file and to make the job's stand-ins fail (scripts/trending-e2e.mjs). A key of any other name is refused, so this cannot reach the public cache or anything else. Never in production
 * (ENABLE_DEV_ROUTES is never set there).
 */
devRoutes.post("/kv", async (c) => {
  const kv = c.env.CACHE;
  const b = (await c.req.json().catch(() => null)) as { op?: string; key?: string; value?: string; ttl?: number } | null;
  const key = typeof b?.key === "string" && b.key.startsWith(TRENDING_KEYS.file) && b.key.length <= 200 ? b.key : null;
  if (!kv) return c.json({ type: "invalid", title: "No KV namespace is bound here" }, 400);
  if (b?.op === "get" && key) return c.json({ ok: true, value: await kv.get(key) });
  if (b?.op === "put" && key && typeof b.value === "string") {
    await kv.put(key, b.value, { expirationTtl: Math.max(60, Math.ceil(b.ttl ?? 3600)) });
    return c.json({ ok: true });
  }
  if (b?.op === "delete" && key) {
    await kv.delete(key);
    return c.json({ ok: true });
  }
  if (b?.op === "list") {
    const keys: { name: string; expiration: number | null }[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await kv.list({ prefix: TRENDING_KEYS.file, ...(cursor ? { cursor } : {}) });
      keys.push(...page.keys.map((k) => ({ name: k.name, expiration: k.expiration ?? null })));
      if (page.list_complete) break;
      cursor = page.cursor;
    }
    return c.json({ ok: true, keys });
  }
  return c.json({ type: "invalid", title: "Send {op: get|put|delete|list, key (a name starting trending:v1), value, ttl}" }, 400);
});

/**
 * Local tests only: sends `n` calls through one lane at once, each holding it for `holdMs`, and reports when each started and the most that were in
 * flight together, so the limits of the real Durable Object can be checked (scripts/gate-e2e.mjs).
 */
devRoutes.post("/gate", async (c) => {
  const b = (await c.req.json().catch(() => null)) as { name?: string; n?: number; holdMs?: number; maxWaitMs?: number } | null;
  if (!b?.name || !(b.name in GATES)) return c.json({ type: "invalid", title: "name must be a lane" }, 400);
  const name = b.name as GateName;
  const n = Math.min(Math.max(1, b.n ?? 1), 40);
  const t0 = Date.now();
  let running = 0;
  let peak = 0;
  const out = await Promise.all(
    Array.from({ length: n }, async () => {
      try {
        return await withGate(name, b.maxWaitMs ?? 5000, async () => {
          const startedAt = Date.now() - t0;
          peak = Math.max(peak, ++running);
          await new Promise((r) => setTimeout(r, Math.min(b.holdMs ?? 0, 2000)));
          running--;
          return { startedAt };
        });
      } catch (e) {
        return { refused: e instanceof Error ? e.message : "refused" };
      }
    }),
  );
  return c.json({ results: out, peak });
});

/** Local tests only: makes the signed-in user an admin, so the admin page can be tested. */
devRoutes.post("/make-admin", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ type: "unauthorized", title: "Sign in first" }, 401);
  await c.env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?1").bind(user.id).run();
  return c.json({ ok: true });
});

