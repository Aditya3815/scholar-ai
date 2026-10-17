import { Hono } from "hono";
import type { HealthResponse } from "@scholar/shared";
import { MAX_QUERY_LENGTH, runSearch } from "./search";

type Bindings = {
  DB: D1Database;
  JOBS: Queue;
  FILES: R2Bucket;
  OPENALEX_API_KEY?: string;
  NCBI_API_KEY?: string;
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

app.get("/api/v1/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 20) || 20, 1), 40);
  if (q.length < 2 || q.length > MAX_QUERY_LENGTH) {
    return c.json(
      {
        type: "invalid_query",
        title: "Invalid query",
        detail: `q must be 2-${MAX_QUERY_LENGTH} characters`,
      },
      400,
    );
  }
  return c.json(await runSearch(c.env, q, limit));
});

app.notFound((c) =>
  c.json({ type: "not_found", title: "Not found", detail: c.req.path }, 404),
);

app.onError((err, c) => {
  console.error(err);
  return c.json({ type: "internal_error", title: "Internal error" }, 500);
});

export default app;
