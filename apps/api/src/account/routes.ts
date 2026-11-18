import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import type { Paper } from "@scholar/shared";
import { cookieOpts, isHttps } from "../auth/http";
import { requireUser, type Door } from "../auth/service";
import { readJson } from "../platform/http/body";
import { SESSION_COOKIE } from "../auth/session";
import { fromSqliteTime } from "../library/validate";
import { PRIVACY_VERSION } from "@scholar/shared";
import { listNotebookImages, shareExport } from "../docs/service";
import { eraseAccount } from "./erase";
import type { HonoEnv } from "../platform/env";

export const accountRoutes = new Hono<HonoEnv>();

const SIGNED_IN: Door = { signIn: "Sign in first" };


/** Everything we hold about the signed-in user, as a downloadable JSON file (DPDP: right to access / portability). */
accountRoutes.get("/export", async (c) => {
  const got = await requireUser(c, SIGNED_IN);
  if (got instanceof Response) return got;
  const { user } = got;

  const profile = await c.env.DB
    .prepare("SELECT created_at, last_login_at, locale, theme_pref, privacy_ack, privacy_ack_at FROM users WHERE id = ?1")
    .bind(user.id)
    .first<{ created_at: string; last_login_at: string | null; locale: string; theme_pref: string; privacy_ack: string | null; privacy_ack_at: string | null }>();
  const lib = await c.env.DB
    .prepare("SELECT data, saved_at FROM library_items WHERE user_id = ?1 ORDER BY saved_at DESC")
    .bind(user.id)
    .all<{ data: string; saved_at: string }>();

  const alerts = await c.env.DB
    .prepare("SELECT paper_id, title, kind, created_at, seen_at FROM library_alerts WHERE user_id = ?1 ORDER BY created_at")
    .bind(user.id)
    .all<{ paper_id: string; title: string; kind: string; created_at: string; seen_at: string | null }>();

  const docs = await c.env.DB
    .prepare("SELECT id, title, filename, size_bytes, pages, status, created_at, info, scanned, read_state, last_page, max_page, opened_at, (SELECT group_concat(label, char(31)) FROM (SELECT label FROM doc_tags WHERE doc_id = documents.id ORDER BY label COLLATE NOCASE)) AS tags FROM documents WHERE user_id = ?1 ORDER BY created_at DESC")
    .bind(user.id)
    .all<{ id: string; title: string; filename: string; size_bytes: number; pages: number | null; status: string; created_at: string; info: string | null; scanned: number; read_state: string; last_page: number | null; max_page: number | null; opened_at: string | null; tags: string | null }>();
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
    .prepare("SELECT n.doc_id, n.page, n.quote, n.note, n.color, n.created_at FROM doc_notes n JOIN documents d ON d.id = n.doc_id WHERE d.user_id = ?1 ORDER BY n.page, n.created_at")
    .bind(user.id)
    .all<{ doc_id: string; page: number; quote: string; note: string | null; color: string; created_at: string }>();
  const ink = await c.env.DB
    .prepare("SELECT i.doc_id, i.data FROM doc_ink i JOIN documents d ON d.id = i.doc_id WHERE d.user_id = ?1")
    .bind(user.id)
    .all<{ doc_id: string; data: string }>();
  // the pages of notes of the new reader (docs/design/paper-reader.md, 19.3), in each paper's order
  const notebook = await c.env.DB
    .prepare("SELECT p.doc_id, p.title, p.style, p.blocks, p.updated_at FROM doc_notebook_pages p JOIN documents d ON d.id = p.doc_id WHERE d.user_id = ?1 ORDER BY p.doc_id, p.position, p.created_at")
    .bind(user.id)
    .all<{ doc_id: string; title: string; style: string; blocks: string; updated_at: string }>();
  // the pictures in those notes (phase 2.5): where each is, its kind and size; the files themselves are fetched from those addresses while signed in
  const notebookImages = await listNotebookImages(c.env, user.id, [...new Set(notebook.results.map((p) => p.doc_id))]);
  // sharing (docs/design/paper-share.md, 6): the people this account shared its papers with and the comments on them, and its own comments on papers shared with it
  const sharing = await shareExport(c.env.DB, user.id);
  const reports = await c.env.DB
    .prepare("SELECT kind, problem, note, context, created_at FROM feedback WHERE user_id = ?1 ORDER BY created_at")
    .bind(user.id)
    .all<{ kind: string; problem: string; note: string | null; context: string; created_at: string }>();

  // literature scans of the last day: the topic, the approved plan and what the checked report says
  const scans = await c.env.DB
    .prepare("SELECT id, topic, language, plan, state, created_at, expires_at FROM litscans WHERE user_id = ?1 AND expires_at > datetime('now') ORDER BY created_at")
    .bind(user.id)
    .all<{ id: string; topic: string; language: string; plan: string; state: string; created_at: string; expires_at: string }>();
  const scanParts = await c.env.DB
    .prepare("SELECT e.scan_id, e.data FROM litscan_events e JOIN litscans s ON s.id = e.scan_id WHERE s.user_id = ?1 AND e.type = 'part' ORDER BY e.seq")
    .bind(user.id)
    .all<{ scan_id: string; data: string }>();

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
      readingStatus: d.read_state,
      tags: d.tags ? d.tags.split("\u001f") : [],
      readingProgress: { lastPage: d.last_page, furthestPage: d.max_page, lastOpenedAt: d.opened_at ? new Date(fromSqliteTime(d.opened_at)).toISOString() : null },
      drawing: (() => {
        const row = ink.results.find((i) => i.doc_id === d.id);
        return row ? { note: "What you drew and wrote on this paper: pen and highlighter strokes (a list of points x, y, pressure), shapes (two points), text boxes and sticky notes (position and words). Positions are fractions of the page width.", strokes: JSON.parse(row.data) as unknown } : null;
      })(),
      highlightsAndNotes: notes.results.filter((n) => n.doc_id === d.id).map((n) => ({ page: n.page, quote: n.quote, colour: n.color, note: n.note ?? "", madeAt: new Date(fromSqliteTime(n.created_at)).toISOString() })),
      questions: qa.results.filter((q) => q.doc_id === d.id).map((q) => ({ question: q.question, answer: (JSON.parse(q.answer) as { answer: string }).answer, askedAt: new Date(fromSqliteTime(q.created_at)).toISOString() })),
    })),
    // only when there is something: with SHARE off (nothing can be shared) the export is what it was
    ...(sharing.sharedPapers.length > 0 || sharing.myCommentsOnSharedPapers.length > 0 ? sharing : {}),
    notebook: notebook.results.map((p) => ({ docId: p.doc_id, title: p.title, style: p.style, blocks: JSON.parse(p.blocks) as unknown, updatedAt: new Date(fromSqliteTime(p.updated_at)).toISOString() })),
    notebookImages,
    reports: reports.results.map((r) => ({ kind: r.kind, problem: r.problem, note: r.note, sent: JSON.parse(r.context), reportedAt: new Date(fromSqliteTime(r.created_at)).toISOString() })),
    library: lib.results.map((r) => ({ ...(JSON.parse(r.data) as Paper), savedAt: new Date(fromSqliteTime(r.saved_at)).toISOString() })),
    literatureScans: scans.results.map((s) => ({ topic: s.topic, language: s.language, state: s.state, startedAt: new Date(fromSqliteTime(s.created_at)).toISOString(), keptUntil: new Date(fromSqliteTime(s.expires_at)).toISOString(), subQuestions: JSON.parse(s.plan) as unknown, results: scanParts.results.filter((p) => p.scan_id === s.id).map((p) => (JSON.parse(p.data) as { part: unknown }).part) })),
    retractionNotices: alerts.results.map((a) => ({ paperId: a.paper_id, title: a.title, kind: a.kind, noticedAt: new Date(fromSqliteTime(a.created_at)).toISOString(), dismissedAt: a.seen_at ? new Date(fromSqliteTime(a.seen_at)).toISOString() : null })),
  };
  c.header("Content-Type", "application/json; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="sodhsetu-export-${new Date().toISOString().slice(0, 10)}.json"`);
  return c.body(JSON.stringify(body, null, 2));
});

/** "I have read how my papers and ideas are handled." Needed before the first upload or idea check; records which text and when. */
accountRoutes.post("/privacy-ack", async (c) => {
  const got = await requireUser(c, SIGNED_IN);
  if (got instanceof Response) return got;
  const { user } = got;
  const body = (await readJson(c)) as { version?: unknown } | null;
  if (body?.version !== PRIVACY_VERSION) return c.json({ type: "outdated", title: "That text has changed", detail: "Reload the page and read the current text." }, 400);
  await c.env.DB.prepare("UPDATE users SET privacy_ack = ?2, privacy_ack_at = datetime('now') WHERE id = ?1").bind(user.id, PRIVACY_VERSION).run();
  return c.json({ ok: true, privacyAck: PRIVACY_VERSION });
});

/** Irreversible: deletes the account, sign-in links, sessions and library in one batch. Needs {"confirm":"DELETE"}. */
accountRoutes.delete("/", async (c) => {
  const got = await requireUser(c, SIGNED_IN);
  if (got instanceof Response) return got;
  const { user } = got;
  const body = (await readJson(c)) as { confirm?: unknown } | null;
  if (body?.confirm !== "DELETE") return c.json({ type: "confirmation_required", title: 'Send {"confirm":"DELETE"}' }, 400);

  // Files first (the rows that name them disappear with the user), and a deletion marker before both: see account/erase.ts.
  await eraseAccount(c.env, user.id);
  deleteCookie(c, SESSION_COOKIE, { path: "/", ...cookieOpts(c), secure: isHttps(c) });
  return c.json({ ok: true });
});
