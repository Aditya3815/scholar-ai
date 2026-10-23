import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import type { Paper } from "@scholar/shared";
import { cookieOpts, currentUser, isHttps, sameOrigin } from "../auth/http";
import { SESSION_COOKIE } from "../auth/session";
import { fromSqliteTime } from "../library/validate";
import { PRIVACY_VERSION } from "@scholar/shared";
import { eraseAccount } from "./erase";

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
    .prepare("SELECT created_at, last_login_at, locale, theme_pref, privacy_ack, privacy_ack_at FROM users WHERE id = ?1")
    .bind(user.id)
    .first<{ created_at: string; last_login_at: string | null; locale: string; theme_pref: string; privacy_ack: string | null; privacy_ack_at: string | null }>();
  const lib = await c.env.DB
    .prepare("SELECT data, saved_at FROM library_items WHERE user_id = ?1 ORDER BY saved_at DESC")
    .bind(user.id)
    .all<{ data: string; saved_at: string }>();

  const docs = await c.env.DB
    .prepare("SELECT id, title, filename, size_bytes, pages, status, created_at, info, scanned FROM documents WHERE user_id = ?1 ORDER BY created_at DESC")
    .bind(user.id)
    .all<{ id: string; title: string; filename: string; size_bytes: number; pages: number | null; status: string; created_at: string; info: string | null; scanned: number }>();
  // A scanned paper: how each page was read, and the text that was read (the only text the paper has). Text is capped so one export cannot run the Worker out of memory.
  const SCAN_TEXT_ROWS = 1500;
  const scanPages = await c.env.DB
    .prepare("SELECT o.doc_id, o.page, o.status, o.disagreement, o.disputed, o.why FROM doc_ocr o JOIN documents d ON d.id = o.doc_id WHERE d.user_id = ?1 AND o.status != 'pending' ORDER BY o.doc_id, o.page")
    .bind(user.id)
    .all<{ doc_id: string; page: number; status: string; disagreement: number | null; disputed: string | null; why: string | null }>();
  const scanText = await c.env.DB
    .prepare("SELECT o.doc_id, o.page, o.text FROM doc_ocr o JOIN documents d ON d.id = o.doc_id WHERE d.user_id = ?1 AND o.text IS NOT NULL ORDER BY o.doc_id, o.page LIMIT ?2")
    .bind(user.id, SCAN_TEXT_ROWS + 1)
    .all<{ doc_id: string; page: number; text: string }>();
  const qa = await c.env.DB
    .prepare("SELECT q.doc_id, q.question, q.answer, q.created_at FROM doc_qa q JOIN documents d ON d.id = q.doc_id WHERE d.user_id = ?1 ORDER BY q.created_at")
    .bind(user.id)
    .all<{ doc_id: string; question: string; answer: string; created_at: string }>();

  const notes = await c.env.DB
    .prepare("SELECT n.doc_id, n.page, n.quote, n.note, n.created_at FROM doc_notes n JOIN documents d ON d.id = n.doc_id WHERE d.user_id = ?1 ORDER BY n.page, n.created_at")
    .bind(user.id)
    .all<{ doc_id: string; page: number; quote: string; note: string | null; created_at: string }>();
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
      ...(d.scanned === 1
        ? {
            readFromScan: {
              note: "This paper is a scan. The text was read from page pictures by two AI models; a page they did not agree on was left out. Check numbers and names against the page.",
              pages: scanPages.results.filter((p) => p.doc_id === d.id).map((p) => ({ page: p.page, status: p.status, readingsDifferBy: p.disagreement, numbersTheyDisagreedOn: JSON.parse(p.disputed ?? "[]") as string[], ...(p.why ? { why: p.why } : {}) })),
              text: scanText.results.slice(0, SCAN_TEXT_ROWS).filter((p) => p.doc_id === d.id).map((p) => ({ page: p.page, text: p.text })),
              textComplete: scanText.results.length <= SCAN_TEXT_ROWS,
            },
          }
        : {}),
      note: "The PDF itself can be downloaded from the paper’s page while signed in.",
      highlightsAndNotes: notes.results.filter((n) => n.doc_id === d.id).map((n) => ({ page: n.page, quote: n.quote, note: n.note ?? "", madeAt: new Date(fromSqliteTime(n.created_at)).toISOString() })),
      questions: qa.results.filter((q) => q.doc_id === d.id).map((q) => ({ question: q.question, answer: (JSON.parse(q.answer) as { answer: string }).answer, askedAt: new Date(fromSqliteTime(q.created_at)).toISOString() })),
    })),
    reports: reports.results.map((r) => ({ kind: r.kind, problem: r.problem, note: r.note, sent: JSON.parse(r.context), reportedAt: new Date(fromSqliteTime(r.created_at)).toISOString() })),
    library: lib.results.map((r) => ({ ...(JSON.parse(r.data) as Paper), savedAt: new Date(fromSqliteTime(r.saved_at)).toISOString() })),
  };
  c.header("Content-Type", "application/json; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="scholar-ai-export-${new Date().toISOString().slice(0, 10)}.json"`);
  return c.body(JSON.stringify(body, null, 2));
});

/** "I have read how my papers and ideas are handled." Needed before the first upload or idea check; records which text and when. */
accountRoutes.post("/privacy-ack", async (c) => {
  if (!sameOrigin(c)) return c.json({ type: "forbidden", title: "Cross-origin request blocked" }, 403);
  const user = await currentUser(c);
  if (!user) return c.json({ type: "unauthorized", title: "Sign in first" }, 401);
  const body = (await c.req.json().catch(() => null)) as { version?: unknown } | null;
  if (body?.version !== PRIVACY_VERSION) return c.json({ type: "outdated", title: "That text has changed", detail: "Reload the page and read the current text." }, 400);
  await c.env.DB.prepare("UPDATE users SET privacy_ack = ?2, privacy_ack_at = datetime('now') WHERE id = ?1").bind(user.id, PRIVACY_VERSION).run();
  return c.json({ ok: true, privacyAck: PRIVACY_VERSION });
});

/** Irreversible: deletes the account, sign-in links, sessions and library in one batch. Needs {"confirm":"DELETE"}. */
accountRoutes.delete("/", async (c) => {
  if (!sameOrigin(c)) return c.json({ type: "forbidden", title: "Cross-origin request blocked" }, 403);
  const user = await currentUser(c);
  if (!user) return c.json({ type: "unauthorized", title: "Sign in first" }, 401);
  const body = (await c.req.json().catch(() => null)) as { confirm?: unknown } | null;
  if (body?.confirm !== "DELETE") return c.json({ type: "confirmation_required", title: 'Send {"confirm":"DELETE"}' }, 400);

  // Files first (the rows that name them disappear with the user), and a deletion marker before both: see account/erase.ts.
  await eraseAccount(c.env, user.id);
  deleteCookie(c, SESSION_COOKIE, { path: "/", ...cookieOpts(c), secure: isHttps(c) });
  return c.json({ ok: true });
});
