import { Hono } from "hono";
import type { HealthResponse } from "@scholar/shared";

type Bindings = {
  DB: D1Database;
  JOBS: Queue;
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

app.notFound((c) =>
  c.json({ type: "not_found", title: "Not found", detail: c.req.path }, 404),
);

app.onError((err, c) => {
  console.error(err);
  return c.json({ type: "internal_error", title: "Internal error" }, 500);
});

export default app;
