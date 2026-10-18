import { Hono, type Context } from "hono";
import type { AdminOverview, FeedbackKind } from "@scholar/shared";
import { currentUser, sameOrigin } from "../auth/http";

type Env = { Bindings: { DB: D1Database } };
export const adminRoutes = new Hono<Env>();

adminRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

const deny = (c: Context<Env>, status: 401 | 403 | 404, type: string, title: string) => c.json({ type, title }, status);

/** Admin only. Anyone else, signed in or not, is told the page does not exist. */
async function admin(c: Context<Env>) {
  const user = await currentUser(c);
  return user?.role === "admin" ? user : null;
}

/** One page of numbers: who uses it, what the AI costs, what is failing, what people reported. Nothing here shows paper or idea text. */
adminRoutes.get("/overview", async (c) => {
  if (!(await admin(c))) return deny(c, 404, "not_found", "Not found");
  const db = c.env.DB;
  const one = async <T>(sql: string) => (await db.prepare(sql).first<T>()) as T;

  const [users, docs, questions, days, models, feedback] = await Promise.all([
    one<{ total: number; week: number }>("SELECT COUNT(*) AS total, COALESCE(SUM(created_at >= datetime('now', '-7 days')), 0) AS week FROM users WHERE deleted_at IS NULL"),
    one<{ total: number; ready: number; failed: number }>("SELECT COUNT(*) AS total, COALESCE(SUM(status = 'ready'), 0) AS ready, COALESCE(SUM(status = 'failed'), 0) AS failed FROM documents"),
    one<{ n: number }>("SELECT COUNT(*) AS n FROM doc_qa"),
    db.prepare("SELECT date(ts) AS day, COUNT(*) AS calls, COALESCE(SUM(ok = 0), 0) AS failed, COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens, COALESCE(SUM(cost_cents), 0) AS cost FROM llm_usage WHERE ts >= date('now', '-13 days') GROUP BY date(ts) ORDER BY day").all<{ day: string; calls: number; failed: number; tokens: number; cost: number }>(),
    db.prepare("SELECT provider, model, COUNT(*) AS calls, COALESCE(SUM(ok = 0), 0) AS failed, COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens FROM llm_usage WHERE ts >= date('now', '-6 days') GROUP BY provider, model ORDER BY tokens DESC").all<{ provider: string; model: string; calls: number; failed: number; tokens: number }>(),
    db.prepare("SELECT id, user_id, kind, problem, note, context, created_at FROM feedback ORDER BY created_at DESC, rowid DESC LIMIT 50").all<{ id: string; user_id: string; kind: FeedbackKind; problem: string; note: string | null; context: string; created_at: string }>(),
  ]);

  const body: AdminOverview = {
    users: { total: users.total, newThisWeek: users.week },
    documents: { total: docs.total, ready: docs.ready, failed: docs.failed },
    questions: questions.n,
    usage: days.results.map((d) => ({ day: d.day, calls: d.calls, failed: d.failed, tokens: d.tokens, costCents: Math.round(d.cost * 100) / 100 })),
    byModel: models.results,
    feedback: feedback.results.map((f) => ({ id: f.id, kind: f.kind, problem: f.problem, note: f.note, context: JSON.parse(f.context), createdAt: f.created_at.replace(" ", "T") + "Z", user: f.user_id.slice(0, 8) })),
  };
  return c.json(body);
});

/** A report that has been dealt with (or is not useful) is removed. */
adminRoutes.delete("/feedback/:id", async (c) => {
  if (!sameOrigin(c)) return c.json({ type: "forbidden", title: "Cross-origin request blocked" }, 403);
  if (!(await admin(c))) return deny(c, 404, "not_found", "Not found");
  await c.env.DB.prepare("DELETE FROM feedback WHERE id = ?1").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});
