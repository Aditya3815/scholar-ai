import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { HealthResponse } from "@scholar/shared";
import { MAX_QUERY_LENGTH, runSearch } from "./search";
import { AllProvidersFailedError, NoRouteError, PolicyError, QuotaError, gatewayFromEnv, type LlmRequest } from "./llm";
import { authRoutes } from "./auth/routes";
import { libraryRoutes } from "./library/routes";
import { accountRoutes } from "./account/routes";
import { referenceRoutes } from "./references/routes";
import { documentRoutes } from "./docs/routes";
import type { AuthEnv } from "./auth/providers";
import { d1Store } from "./cache/store";
import type { SearchEnv } from "./search/types";
import { apiSecurityHeaders, requestLog } from "./middleware";
import { rateLimit, type LimitEnv } from "./ratelimit";
import { runMaintenance } from "./maintenance";
import type { S2Throttle } from "./s2-throttle";

type Bindings = AuthEnv & LimitEnv & {
  S2_THROTTLE: DurableObjectNamespace<S2Throttle>;
  DB: D1Database;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
  JOBS: Queue;
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
};

const searchEnv = (env: Bindings): SearchEnv => ({
  store: d1Store(env.DB),
  OPENALEX_API_KEY: env.OPENALEX_API_KEY,
  NCBI_API_KEY: env.NCBI_API_KEY,
  S2_API_KEY: env.S2_API_KEY,
  CROSSREF_MAILTO: env.CROSSREF_MAILTO,
  s2Gate: (maxWaitMs) => env.S2_THROTTLE.getByName("global").reserve(maxWaitMs),
});

const app = new Hono<{ Bindings: Bindings; Variables: { requestId: string } }>();

app.use("*", requestLog());
app.use("/api/*", apiSecurityHeaders);
app.use("/api/*", rateLimit());

app.route("/api/v1/auth", authRoutes);
app.route("/api/v1/library", libraryRoutes);
app.route("/api/v1/account", accountRoutes);
app.route("/api/v1/references", referenceRoutes);
app.route("/api/v1/documents", documentRoutes);

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

app.notFound((c) =>
  c.json({ type: "not_found", title: "Not found", detail: c.req.path }, 404),
);

app.onError((err, c) => {
  console.error(JSON.stringify({ level: "error", msg: "unhandled", requestId: c.get("requestId"), error: err.name }));
  return c.json({ type: "internal_error", title: "Internal error", requestId: c.get("requestId") }, 500);
});

export { S2Throttle } from "./s2-throttle";

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Bindings, ctx: ExecutionContext) {
    ctx.waitUntil(
      runMaintenance(env.DB).then(
        (deleted) => console.log(JSON.stringify({ level: "info", msg: "maintenance", deleted })),
        (err) => console.error(JSON.stringify({ level: "error", msg: "maintenance_failed", error: String(err) })),
      ),
    );
  },
} satisfies ExportedHandler<Bindings>;
