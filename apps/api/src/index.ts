import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { HealthResponse, JobsHealthResponse } from "@scholar/shared";
import { MAX_QUERY_LENGTH, runSearch } from "./search";
import { AllProvidersFailedError, NoRouteError, PolicyError, QuotaError, gatewayFromEnv, type LlmRequest } from "./llm";
import { authRoutes } from "./auth/routes";
import { currentUser } from "./auth/http";
import { libraryRoutes } from "./library/routes";
import { accountRoutes } from "./account/routes";
import { referenceRoutes } from "./references/routes";
import { documentRoutes } from "./docs/routes";
import { ideaRoutes } from "./idea/routes";
import { chatRoutes } from "./chat/routes";
import { oaRoutes } from "./oa/routes";
import type { OaParams } from "./oa/workflow";
import { feedbackRoutes } from "./feedback/routes";
import { adminRoutes } from "./admin/routes";
import { monitoringRoutes } from "./monitoring/routes";
import { captureException } from "./monitoring/sentry";
import type { AuthEnv } from "./auth/providers";
import { cacheStore, meter, writeCacheRows } from "./cache";
import type { SearchEnv } from "./search/types";
import { apiSecurityHeaders, requestLog } from "./middleware";
import { rateLimit, type LimitEnv } from "./ratelimit";
import { runMaintenance } from "./maintenance";
import { recheckRetractions } from "./library/retraction";
import { stubCrossrefFetch } from "./library/retraction-stub";
import { readJobs, runJob } from "./jobs";
import type { S2Throttle } from "./s2-throttle";
import { ApiGate, remoteGate } from "./gate/api-gate";
import { installGates, withGate, GATES, type GateName } from "./gate";

type Bindings = AuthEnv & LimitEnv & {
  S2_THROTTLE: DurableObjectNamespace<S2Throttle>;
  /** The shared lanes to Crossref and CORE (src/gate): one limit for every isolate. Absent in a test: each isolate then keeps its own lane. */
  API_GATE?: DurableObjectNamespace<ApiGate>;
  DB: D1Database;
  /** Workers KV: the public cache (src/cache/kv.ts). Absent in a local run without it: the database table is used. */
  CACHE?: KVNamespace;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  JOBS: Queue;
  /** The reading of an open-access paper into the shared index (src/oa/workflow.ts). */
  OA_INGEST: Workflow<OaParams>;
  FILES: R2Bucket;
  AI: Ai;
  GEMINI_API_KEY?: string;
  /** "1" only in local .dev.vars; never set as a production secret. Enables /api/v1/dev/* smoke routes. */
  ENABLE_DEV_ROUTES?: string;
  /** "1" (local tests only, together with ENABLE_DEV_ROUTES) swaps the model and embeddings for stand-ins. */
  QA_STUB?: string;
  OPENALEX_API_KEY?: string;
  NCBI_API_KEY?: string;
  S2_API_KEY?: string;
  CORE_API_KEY?: string;
  CROSSREF_MAILTO: string;
  /** Optional: where unexpected errors are reported (Sentry). Nothing is sent when it is not set. */
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  /** "1" where the daily clean-up is scheduled (production): /api/v1/health/jobs then reports a job that did not run. Staging has no schedule and leaves it unset. */
  EXPECT_CRON?: string;
};

const searchEnv = (env: Bindings): SearchEnv => ({
  store: cacheStore(env),
  OPENALEX_API_KEY: env.OPENALEX_API_KEY,
  NCBI_API_KEY: env.NCBI_API_KEY,
  S2_API_KEY: env.S2_API_KEY,
  CORE_API_KEY: env.CORE_API_KEY,
  CROSSREF_MAILTO: env.CROSSREF_MAILTO,
  s2Gate: (maxWaitMs) => env.S2_THROTTLE.getByName("global").reserve(maxWaitMs),
});

const app = new Hono<{ Bindings: Bindings; Variables: { requestId: string } }>();

app.use("*", requestLog());
// every call to Crossref and CORE asks the shared lane first (the binding is the same for the life of an isolate)
app.use("/api/*", async (c, next) => {
  installGates(c.env.API_GATE ? remoteGate(c.env.API_GATE) : null);
  await next();
});
// cache hit and miss counts are written to the database after the response, in small batches (src/cache/meter.ts)
app.use("/api/*", async (c, next) => {
  try {
    meter.attach(c.executionCtx, (rows) => writeCacheRows(c.env.DB, rows));
  } catch {
    /* no execution context (a test calling the app directly): counts stay in memory */
  }
  await next();
});
app.use("/api/*", apiSecurityHeaders);
app.use("/api/*", rateLimit());

app.route("/api/v1/auth", authRoutes);
app.route("/api/v1/library", libraryRoutes);
app.route("/api/v1/account", accountRoutes);
app.route("/api/v1/references", referenceRoutes);
app.route("/api/v1/documents", documentRoutes);
app.route("/api/v1/idea", ideaRoutes);
app.route("/api/v1/chat", chatRoutes);
app.route("/api/v1/papers/oa", oaRoutes);
app.route("/api/v1/feedback", feedbackRoutes);
app.route("/api/v1/admin", adminRoutes);
app.route("/api/v1/monitoring", monitoringRoutes);

app.get("/api/v1/health", async (c) => {
  let db: HealthResponse["db"] = "ok";
  let migrations = 0;
  try {
    // Also proves the schema was migrated: a deploy that skipped `db:migrate:remote` reports 0 here.
    const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first<{ n: number }>();
    migrations = row?.n ?? 0;
  } catch {
    db = "error";
  }
  const ok = db === "ok" && migrations > 0;
  const body: HealthResponse = {
    ok,
    service: "scholar-api",
    time: new Date().toISOString(),
    db,
    migrations,
    version: c.env.CF_VERSION_METADATA?.id,
  };
  c.header("Cache-Control", "no-store");
  return c.json(body, ok ? 200 : 503);
});

/** The scheduled jobs: 200 when each ran on time and well, 503 when one failed, hung or did not run. Point an uptime check at it (docs/runbook.md). */
app.get("/api/v1/health/jobs", async (c) => {
  c.header("Cache-Control", "no-store");
  if (c.env.EXPECT_CRON !== "1") return c.json({ ok: true, scheduled: false, jobs: [] } satisfies JobsHealthResponse);
  try {
    const jobs = await readJobs(c.env.DB);
    const ok = jobs.every((j) => j.state === "ok");
    // Public: states and times only, never the error text.
    const body: JobsHealthResponse = { ok, scheduled: true, jobs: jobs.map((j) => ({ name: j.name, state: j.state, lastOkAt: j.lastOkAt, runs: j.runs })) };
    return c.json(body, ok ? 200 : 503);
  } catch {
    const body: JobsHealthResponse = { ok: false, scheduled: true, jobs: [], error: "db" };
    return c.json(body, 503);
  }
});

function parseSearch(query: (k: string) => string | undefined) {
  const q = (query("q") ?? "").trim();
  const limit = Math.min(Math.max(Number(query("limit") ?? 20) || 20, 1), 40);
  const valid = q.length >= 2 && q.length <= MAX_QUERY_LENGTH;
  return { q, limit, valid };
}

const invalidQuery = {
  type: "invalid_query",
  title: "Invalid query",
  detail: `q must be 2-${MAX_QUERY_LENGTH} characters`,
};

app.get("/api/v1/search", async (c) => {
  const { q, limit, valid } = parseSearch((k) => c.req.query(k));
  if (!valid) return c.json(invalidQuery, 400);
  return c.json(await runSearch(searchEnv(c.env), q, limit));
});

/**
 * SSE: `snapshot` har provider ke baad (merged results + provider statuses), phir `done` (final, retraction flags ke saath).
 * UI pehle results ~1 s mein dikha sakti hai, sabse dheemi source ka wait kiye bina.
 */
app.get("/api/v1/search/stream", (c) => {
  const { q, limit, valid } = parseSearch((k) => c.req.query(k));
  if (!valid) return c.json(invalidQuery, 400);

  return streamSSE(c, async (stream) => {
    let closed = false;
    stream.onAbort(() => {
      closed = true;
    });
    const send = async (event: string, data: unknown) => {
      if (!closed) await stream.writeSSE({ event, data: JSON.stringify(data) });
    };
    try {
      const final = await runSearch(searchEnv(c.env), q, limit, { onSnapshot: (s) => send("snapshot", s) });
      await send("done", final);
    } catch (err) {
      console.error(err);
      await send("error", { type: "internal_error", title: "Search failed" });
    }
  });
});

/**
 * Local smoke test for the LLM Gateway. Returns 404 unless ENABLE_DEV_ROUTES=1, so it can never be used as a free,
 * anonymous LLM endpoint in production. Real Q&A endpoints arrive in Phase 1 behind auth.
 */
app.post("/api/v1/dev/llm", async (c) => {
  if (c.env.ENABLE_DEV_ROUTES !== "1") return c.json({ type: "not_found", title: "Not found" }, 404);
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

/** Local tests only (ENABLE_DEV_ROUTES=1, never a production secret): is a file still in storage? */
app.get("/api/v1/dev/r2-exists", async (c) => {
  if (c.env.ENABLE_DEV_ROUTES !== "1") return c.json({ type: "not_found", title: "Not found" }, 404);
  return c.json({ exists: (await c.env.FILES.head(c.req.query("key") ?? "")) !== null });
});

/** Local tests only: puts (an empty file) or removes a stored file, to make storage and the database disagree on purpose. */
app.put("/api/v1/dev/r2-object", async (c) => {
  if (c.env.ENABLE_DEV_ROUTES !== "1") return c.json({ type: "not_found", title: "Not found" }, 404);
  await c.env.FILES.put(c.req.query("key") ?? "", "x");
  return c.json({ ok: true });
});
app.delete("/api/v1/dev/r2-object", async (c) => {
  if (c.env.ENABLE_DEV_ROUTES !== "1") return c.json({ type: "not_found", title: "Not found" }, 404);
  await c.env.FILES.delete(c.req.query("key") ?? "");
  return c.json({ ok: true });
});

/**
 * Local tests only (ENABLE_DEV_ROUTES=1): runs SQL statements, one after the other, through the Worker itself and returns the rows of each.
 * Tests must not write to the local database file from a second process (`wrangler d1 execute --local`) while `wrangler dev` has it open:
 * that left the dev server spinning at 100% CPU and answering nothing.
 */
app.post("/api/v1/dev/sql", async (c) => {
  if (c.env.ENABLE_DEV_ROUTES !== "1") return c.json({ type: "not_found", title: "Not found" }, 404);
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
app.post("/api/v1/dev/cache", async (c) => {
  if (c.env.ENABLE_DEV_ROUTES !== "1") return c.json({ type: "not_found", title: "Not found" }, 404);
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
 * Local tests only: sends `n` calls through one lane at once, each holding it for `holdMs`, and reports when each started and the most that were in
 * flight together, so the limits of the real Durable Object can be checked (scripts/gate-e2e.mjs).
 */
app.post("/api/v1/dev/gate", async (c) => {
  if (c.env.ENABLE_DEV_ROUTES !== "1") return c.json({ type: "not_found", title: "Not found" }, 404);
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
app.post("/api/v1/dev/make-admin", async (c) => {
  if (c.env.ENABLE_DEV_ROUTES !== "1") return c.json({ type: "not_found", title: "Not found" }, 404);
  const user = await currentUser(c);
  if (!user) return c.json({ type: "unauthorized", title: "Sign in first" }, 401);
  await c.env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?1").bind(user.id).run();
  return c.json({ ok: true });
});

app.notFound((c) =>
  c.json({ type: "not_found", title: "Not found", detail: c.req.path }, 404),
);

app.onError((err, c) => {
  captureException(c.env, err, { route: c.req.routePath, release: c.env.CF_VERSION_METADATA?.id, waitUntil: (p) => c.executionCtx.waitUntil(p) });
  console.error(JSON.stringify({ level: "error", msg: "unhandled", requestId: c.get("requestId"), error: err.name }));
  return c.json({ type: "internal_error", title: "Internal error", requestId: c.get("requestId") }, 500);
});

export { S2Throttle } from "./s2-throttle";
export { ApiGate } from "./gate/api-gate";
export { OaIngest } from "./oa/workflow";

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    // the calls to Crossref take their turn in the shared lane, as they do in a request
    installGates(env.API_GATE ? remoteGate(env.API_GATE) : null);
    const cron = <T,>(name: "maintenance" | "retraction_check", job: () => Promise<T>) =>
      runJob(env.DB, name, job).then(
        (result) => console.log(JSON.stringify({ level: "info", msg: name, result })),
        (err) => {
          console.error(JSON.stringify({ level: "error", msg: `${name}_failed`, error: String(err) }));
          captureException(env, err, { route: `cron:${name}`, source: "cron", release: env.CF_VERSION_METADATA?.id, waitUntil: (p) => ctx.waitUntil(p) });
        },
      );
    // independent of each other: a failing re-check must not stop the clean-up, and the other way round
    ctx.waitUntil(
      Promise.all([
        cron("maintenance", () => runMaintenance(env.DB)),
        cron("retraction_check", () =>
          recheckRetractions(env.DB, { CROSSREF_MAILTO: env.CROSSREF_MAILTO, ...(env.ENABLE_DEV_ROUTES === "1" && env.QA_STUB === "1" ? { fetch: stubCrossrefFetch } : {}) }),
        ),
      ]),
    );
  },
} satisfies ExportedHandler<Bindings>;
