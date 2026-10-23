import { Hono, type Context } from "hono";
import type { AdminOverview, FeedbackKind } from "@scholar/shared";
import { NEURON_CENTS } from "../llm/pricing";
import { currentUser, sameOrigin } from "../auth/http";
import { reapplyDeletions } from "../account/erase";
import { readJobs } from "../jobs";
import { compareInventory, listDocuments, listFiles } from "./integrity";
import { eraseAccount } from "../account/erase";
import { findAccount, parseAccountRef } from "./accounts";
import { captureException, parseDsn, sendEvent, type SentryEnv } from "../monitoring/sentry";

type Env = { Bindings: SentryEnv & { DB: D1Database; FILES: R2Bucket } };
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

  const [users, docs, questions, days, models, features, scans, feedback, jobs] = await Promise.all([
    one<{ total: number; week: number }>("SELECT COUNT(*) AS total, COALESCE(SUM(created_at >= datetime('now', '-7 days')), 0) AS week FROM users WHERE deleted_at IS NULL"),
    one<{ total: number; ready: number; failed: number }>("SELECT COUNT(*) AS total, COALESCE(SUM(status = 'ready'), 0) AS ready, COALESCE(SUM(status = 'failed'), 0) AS failed FROM documents"),
    one<{ n: number }>("SELECT COUNT(*) AS n FROM doc_qa"),
    db.prepare("SELECT date(ts) AS day, COUNT(*) AS calls, COALESCE(SUM(ok = 0), 0) AS failed, COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens, COALESCE(SUM(cost_cents), 0) AS cost FROM llm_usage WHERE ts >= date('now', '-13 days') GROUP BY date(ts) ORDER BY day").all<{ day: string; calls: number; failed: number; tokens: number; cost: number }>(),
    db.prepare("SELECT provider, model, COUNT(*) AS calls, COALESCE(SUM(ok = 0), 0) AS failed, COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens, COALESCE(SUM(cost_cents), 0) AS cost FROM llm_usage WHERE ts >= date('now', '-6 days') GROUP BY provider, model ORDER BY tokens DESC").all<{ provider: string; model: string; calls: number; failed: number; tokens: number; cost: number }>(),
    db.prepare("SELECT COALESCE(label, '(not labelled)') AS feature, COUNT(*) AS calls, COALESCE(SUM(ok = 0), 0) AS failed, COALESCE(SUM(tokens_in), 0) AS tin, COALESCE(SUM(tokens_out), 0) AS tout, COALESCE(SUM(cost_cents), 0) AS cost FROM llm_usage WHERE ts >= date('now', '-6 days') GROUP BY feature ORDER BY cost DESC").all<{ feature: string; calls: number; failed: number; tin: number; tout: number; cost: number }>(),
    one<{ pages: number; neurons: number }>("SELECT COALESCE(SUM(pages), 0) AS pages, COALESCE(SUM(neurons), 0) AS neurons FROM ocr_usage WHERE day >= date('now', '-6 days')"),
    db.prepare("SELECT id, user_id, kind, problem, note, context, created_at FROM feedback ORDER BY created_at DESC, rowid DESC LIMIT 50").all<{ id: string; user_id: string; kind: FeedbackKind; problem: string; note: string | null; context: string; created_at: string }>(),
    // An unreadable heartbeat must not take the whole page down.
    readJobs(db).catch(() => []),
  ]);

  const body: AdminOverview = {
    users: { total: users.total, newThisWeek: users.week },
    documents: { total: docs.total, ready: docs.ready, failed: docs.failed },
    questions: questions.n,
    usage: days.results.map((d) => ({ day: d.day, calls: d.calls, failed: d.failed, tokens: d.tokens, costCents: Math.round(d.cost * 100) / 100 })),
    byModel: models.results.map((r) => ({ provider: r.provider, model: r.model, calls: r.calls, failed: r.failed, tokens: r.tokens, costCents: Math.round(r.cost * 10000) / 10000 })),
    byFeature: features.results.map((r) => ({ feature: r.feature, calls: r.calls, failed: r.failed, tokensIn: r.tin, tokensOut: r.tout, costCents: Math.round(r.cost * 10000) / 10000 })),
    scans: { pages: scans.pages, neurons: Math.round(scans.neurons), costCents: Math.round(scans.neurons * NEURON_CENTS * 10000) / 10000 },
    feedback: feedback.results.map((f) => ({ id: f.id, kind: f.kind, problem: f.problem, note: f.note, context: JSON.parse(f.context), createdAt: f.created_at.replace(" ", "T") + "Z", user: f.user_id.slice(0, 8) })),
    jobs,
  };
  return c.json(body);
});

/**
 * Compares the paper records with the stored files (read only). Useful after a restore, or when storage grows more than expected.
 * `graceMinutes` (0 to 1440, default 15) is how young a file or record may be before it is judged.
 */
adminRoutes.get("/integrity", async (c) => {
  if (!(await admin(c))) return deny(c, 404, "not_found", "Not found");
  const asked = Number(c.req.query("graceMinutes") ?? 15);
  const graceMinutes = Number.isFinite(asked) ? Math.min(Math.max(Math.round(asked), 0), 1440) : 15;
  try {
    const [files, rows] = await Promise.all([listFiles(c.env.FILES), listDocuments(c.env.DB)]);
    return c.json(compareInventory(files.objects, rows, { now: Date.now(), graceMinutes, truncated: files.truncated }));
  } catch (err) {
    captureException(c.env, err, { route: "/api/v1/admin/integrity", waitUntil: (p) => c.executionCtx.waitUntil(p) });
    return c.json({ type: "check_failed", title: "The check could not run", detail: "Storage or the database did not answer. Try again." }, 502);
  }
});

/**
 * After a database restore: accounts that were deleted since the restore point come back with it. Every account that has a deletion marker
 * (account/erase.ts) and a row again is erased once more. Safe to run twice.
 */
adminRoutes.post("/reapply-deletions", async (c) => {
  if (!sameOrigin(c)) return c.json({ type: "forbidden", title: "Cross-origin request blocked" }, 403);
  if (!(await admin(c))) return deny(c, 404, "not_found", "Not found");
  try {
    return c.json(await reapplyDeletions(c.env));
  } catch (err) {
    captureException(c.env, err, { route: "/api/v1/admin/reapply-deletions", waitUntil: (p) => c.executionCtx.waitUntil(p) });
    return c.json({ type: "reapply_failed", title: "Deletions could not be re-applied", detail: "Storage or the database did not answer. Nothing was half done that a second run cannot finish." }, 502);
  }
});

/**
 * Erases an account for someone who cannot sign in to delete it themselves (a request to delete their data). Same erasure as "delete my account",
 * deletion marker included. By e-mail address or ORCID iD. Refuses to erase the admin who asks, or any other admin: remove the admin role first.
 * Nothing about the person is returned or stored; the address typed is used for one lookup.
 */
adminRoutes.post("/erase-account", async (c) => {
  if (!sameOrigin(c)) return c.json({ type: "forbidden", title: "Cross-origin request blocked" }, 403);
  const me = await admin(c);
  if (!me) return deny(c, 404, "not_found", "Not found");
  const body = (await c.req.json().catch(() => null)) as { account?: unknown; confirm?: unknown } | null;
  if (body?.confirm !== "ERASE") return c.json({ type: "confirmation_required", title: 'Send {"account": ..., "confirm": "ERASE"}' }, 400);
  const ref = parseAccountRef(body.account);
  if (!ref) return c.json({ type: "invalid_account", title: "Give an e-mail address or an ORCID iD", detail: "For example name@university.edu or 0000-0002-1825-0097." }, 400);
  const found = await findAccount(c.env.DB, ref);
  if (!found) return c.json({ type: "no_account", title: "No account has that address", detail: "Nothing was erased. Check the spelling, or whether the person signed in with ORCID only." }, 404);
  if (found.id === me.id) return c.json({ type: "own_account", title: "That is your own account", detail: "Use Settings and data to delete your own account." }, 409);
  if (found.role === "admin") return c.json({ type: "admin_account", title: "That account is an admin", detail: "Remove the admin role first (docs/runbook.md), so that an admin cannot be erased by mistake." }, 409);
  try {
    await eraseAccount(c.env, found.id);
    await c.env.DB.prepare("INSERT INTO audit_log (action) VALUES ('account_erased_by_admin')").run();
  } catch (err) {
    captureException(c.env, err, { route: "/api/v1/admin/erase-account", waitUntil: (p) => c.executionCtx.waitUntil(p) });
    return c.json({ type: "erase_failed", title: "The account could not be erased", detail: "Something went wrong part way. Running the same request again finishes it." }, 502);
  }
  return c.json({ erased: true });
});

/** A report that has been dealt with (or is not useful) is removed. */
adminRoutes.delete("/feedback/:id", async (c) => {
  if (!sameOrigin(c)) return c.json({ type: "forbidden", title: "Cross-origin request blocked" }, 403);
  if (!(await admin(c))) return deny(c, 404, "not_found", "Not found");
  await c.env.DB.prepare("DELETE FROM feedback WHERE id = ?1").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

/**
 * Sends one harmless test event to Sentry, so the setup can be checked without waiting for a real error. Each press is a NEW Sentry issue (the time is in
 * the message, which is part of the grouping key): a repeated test would otherwise join the first one, and an alert on "a new issue is created" would
 * never fire again. It is sent at error level, like the real thing, so the alert rules are tested the way they will be used.
 */
adminRoutes.post("/monitoring-test", async (c) => {
  if (!sameOrigin(c)) return c.json({ type: "forbidden", title: "Cross-origin request blocked" }, 403);
  if (!(await admin(c))) return deny(c, 404, "not_found", "Not found");
  if (!parseDsn(c.env.SENTRY_DSN)) return c.json({ configured: false, status: null });
  const status = await sendEvent(c.env, { type: "TestEvent", message: `Test event from the admin page at ${new Date().toISOString().slice(11, 19)} UTC. Nothing is wrong.`, route: "/admin", source: "test", level: "error" });
  return c.json({ configured: true, status });
});
