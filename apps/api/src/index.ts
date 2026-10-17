import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { HealthResponse } from "@scholar/shared";
import { MAX_QUERY_LENGTH, runSearch } from "./search";
import { AllProvidersFailedError, NoRouteError, PolicyError, QuotaError, gatewayFromEnv, type LlmRequest } from "./llm";

type Bindings = {
  DB: D1Database;
  JOBS: Queue;
  FILES: R2Bucket;
  AI: Ai;
  GEMINI_API_KEY?: string;
  /** "1" only in local .dev.vars; never set as a production secret. Enables /api/v1/dev/* smoke routes. */
  ENABLE_DEV_ROUTES?: string;
  OPENALEX_API_KEY?: string;
  NCBI_API_KEY?: string;
  S2_API_KEY?: string;
  CORE_API_KEY?: string;
  CROSSREF_MAILTO: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/v1/health", async (c) => {
  let db: HealthResponse["db"] = "ok";
  try {
    await c.env.DB.prepare("SELECT 1").first();
  } catch {
    db = "error";
  }
  const body: HealthResponse = {
    ok: db === "ok",
    service: "scholar-api",
    time: new Date().toISOString(),
    db,
  };
  return c.json(body, db === "ok" ? 200 : 503);
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
  return c.json(await runSearch(c.env, q, limit));
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
      const final = await runSearch(c.env, q, limit, { onSnapshot: (s) => send("snapshot", s) });
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
  console.error(err);
  return c.json({ type: "internal_error", title: "Internal error" }, 500);
});

export default app;
