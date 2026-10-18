import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import type { Paper } from "@scholar/shared";
import { cookieOpts, currentUser, isHttps, sameOrigin } from "../auth/http";
import { SESSION_COOKIE } from "../auth/session";
import { fromSqliteTime } from "../library/validate";
import { deleteDocument } from "../docs/routes";

type Env = { Bindings: { DB: D1Database; FILES: R2Bucket } };
export const accountRoutes = new Hono<Env>();

accountRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

/** Everything we hold about the signed-in user, as a downloadable JSON file (DPDP: right to access / portability). */
accountRoutes.get("/export", async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ type: "unauthorized", title: "Sign in first" }, 401);

  const profile = await c.env.DB
    .prepare("SELECT created_at, last_login_at, locale, theme_pref FROM users WHERE id = ?1")
    .bind(user.id)
    .first<{ created_at: string; last_login_at: string | null; locale: string; theme_pref: string }>();
  const lib = await c.env.DB
    .prepare("SELECT data, saved_at FROM library_items WHERE user_id = ?1 ORDER BY saved_at DESC")
    .bind(user.id)
    .all<{ data: string; saved_at: string }>();

  const docs = await c.env.DB
    .prepare("SELECT id, title, filename, size_bytes, pages, status, created_at, info FROM documents WHERE user_id = ?1 ORDER BY created_at DESC")
    .bind(user.id)
    .all<{ id: string; title: string; filename: string; size_bytes: number; pages: number | null; status: string; created_at: string; info: string | null }>();
  const qa = await c.env.DB
    .prepare("SELECT q.doc_id, q.question, q.answer, q.created_at FROM doc_qa q JOIN documents d ON d.id = q.doc_id WHERE d.user_id = ?1 ORDER BY q.created_at")
    .bind(user.id)
    .all<{ doc_id: string; question: string; answer: string; created_at: string }>();

  const reports = await c.env.DB
    .prepare("SELECT kind, problem, note, context, created_at FROM feedback WHERE user_id = ?1 ORDER BY created_at")
    .bind(user.id)
    .all<{ kind: string; problem: string; note: string | null; context: string; created_at: string }>();

  const body = {
    exportedAt: new Date().toISOString(),
    account: { id: user.id, name: user.name, email: user.email, orcid: user.orcid, role: user.role, signInMethods: user.providers, ...profile },
    uploadedPapers: docs.results.map((d) => ({
      id: d.id, title: d.title, filename: d.filename, sizeBytes: d.size_bytes, pages: d.pages, status: d.status,
      uploadedAt: new Date(fromSqliteTime(d.created_at)).toISOString(),
      paperInfo: d.info ? JSON.parse(d.info) : null,
      note: "The PDF itself can be downloaded from the paper’s page while signed in.",
      questions: qa.results.filter((q) => q.doc_id === d.id).map((q) => ({ question: q.question, answer: (JSON.parse(q.answer) as { answer: string }).answer, askedAt: new Date(fromSqliteTime(q.created_at)).toISOString() })),
    })),
    reports: reports.results.map((r) => ({ kind: r.kind, problem: r.problem, note: r.note, sent: JSON.parse(r.context), reportedAt: new Date(fromSqliteTime(r.created_at)).toISOString() })),
    library: lib.results.map((r) => ({ ...(JSON.parse(r.data) as Paper), savedAt: new Date(fromSqliteTime(r.saved_at)).toISOString() })),
  };
  c.header("Content-Type", "application/json; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="shodhsetu-export-${new Date().toISOString().slice(0, 10)}.json"`);
  return c.body(JSON.stringify(body, null, 2));
});

/** Irreversible: deletes the account, sign-in links, sessions and library in one batch. Needs {"confirm":"DELETE"}. */
accountRoutes.delete("/", async (c) => {
  if (!sameOrigin(c)) return c.json({ type: "forbidden", title: "Cross-origin request blocked" }, 403);
  const user = await currentUser(c);
  if (!user) return c.json({ type: "unauthorized", title: "Sign in first" }, 401);
  const body = (await c.req.json().catch(() => null)) as { confirm?: unknown } | null;
  if (body?.confirm !== "DELETE") return c.json({ type: "confirmation_required", title: 'Send {"confirm":"DELETE"}' }, 400);

  const db = c.env.DB;
  // Files first: the rows that name them disappear with the user, so nothing is left behind in storage.
  const owned = await db.prepare("SELECT id FROM documents WHERE user_id = ?1").bind(user.id).all<{ id: string }>();
  for (const d of owned.results) await deleteDocument(c.env, user.id, d.id);
  await db.batch([
    db.prepare("DELETE FROM library_items WHERE user_id = ?1").bind(user.id),
    db.prepare("DELETE FROM feedback WHERE user_id = ?1").bind(user.id),
    db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(user.id),
    db.prepare("DELETE FROM oauth_states WHERE link_user_id = ?1").bind(user.id),
    db.prepare("DELETE FROM identities WHERE user_id = ?1").bind(user.id),
    db.prepare("DELETE FROM users WHERE id = ?1").bind(user.id),
    db.prepare("INSERT INTO audit_log (action) VALUES ('account_deleted')"),
  ]);
  deleteCookie(c, SESSION_COOKIE, { path: "/", ...cookieOpts(c), secure: isHttps(c) });
  return c.json({ ok: true });
});
