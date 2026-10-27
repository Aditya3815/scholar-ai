import { Hono, type Context } from "hono";
import type { LibraryAlert, Paper } from "@scholar/shared";
import { currentUser, sameOrigin } from "../auth/http";
import { MAX_IMPORT_ITEMS, MAX_LIBRARY_ITEMS, fromSqliteTime, parsePaper, sqliteTime } from "./validate";

type Env = { Bindings: { DB: D1Database } };
export const libraryRoutes = new Hono<Env>();

const deny = (c: Context<Env>, status: 401 | 403 | 409 | 400, type: string, title: string) => c.json({ type, title }, status);

libraryRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

/** `gone`: the daily re-check (retraction.ts) has found the paper retracted since it was saved. */
type Row = { data: string; saved_at: string; gone?: number };
const CROSSREF_RETRACTION = "crossref-retraction-watch";
const toItem = (r: Row) => {
  const paper = JSON.parse(r.data) as Paper;
  const retracted = paper.retracted || r.gone === 1;
  const retractionSources = r.gone === 1 && !paper.retractionSources?.includes(CROSSREF_RETRACTION) ? [...(paper.retractionSources ?? []), CROSSREF_RETRACTION] : (paper.retractionSources ?? []);
  return { ...paper, retracted, retractionSources, savedAt: fromSqliteTime(r.saved_at) };
};

/** Every handler is scoped by the session's user id; there is no way to name another user's rows. */
libraryRoutes.get("/", async (c) => {
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in to use your library");
  const rows = await c.env.DB
    .prepare(
      `SELECT data, saved_at, EXISTS (SELECT 1 FROM paper_retraction r WHERE r.doi = lower(json_extract(data, '$.doi')) AND r.state = 'retracted') AS gone
         FROM library_items WHERE user_id = ?1 ORDER BY saved_at DESC, rowid DESC LIMIT ?2`,
    )
    .bind(user.id, MAX_LIBRARY_ITEMS)
    .all<Row>();
  const notices = await c.env.DB
    .prepare("SELECT paper_id, title, kind, created_at FROM library_alerts WHERE user_id = ?1 AND seen_at IS NULL ORDER BY created_at DESC, paper_id LIMIT 100")
    .bind(user.id)
    .all<{ paper_id: string; title: string; kind: "retracted"; created_at: string }>();
  const alerts: LibraryAlert[] = notices.results.map((a) => ({ paperId: a.paper_id, title: a.title, kind: a.kind, at: new Date(fromSqliteTime(a.created_at)).toISOString() }));
  return c.json({ items: rows.results.map(toItem), alerts });
});

/** "I have seen it": the notices are not shown again. With `paperIds` only those, otherwise all of this person's. */
libraryRoutes.post("/alerts/seen", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in to use your library");
  const body = (await c.req.json().catch(() => null)) as { paperIds?: unknown } | null;
  const ids = Array.isArray(body?.paperIds) ? body.paperIds.filter((x): x is string => typeof x === "string").slice(0, 100) : null;
  if (ids && ids.length === 0) return c.json({ ok: true, dismissed: 0 });
  const res = ids
    ? await c.env.DB
        .prepare(`UPDATE library_alerts SET seen_at = datetime('now') WHERE user_id = ?1 AND seen_at IS NULL AND paper_id IN (${ids.map((_, i) => `?${i + 2}`).join(",")})`)
        .bind(user.id, ...ids)
        .run()
    : await c.env.DB.prepare("UPDATE library_alerts SET seen_at = datetime('now') WHERE user_id = ?1 AND seen_at IS NULL").bind(user.id).run();
  return c.json({ ok: true, dismissed: res.meta?.changes ?? 0 });
});

libraryRoutes.put("/:id", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in to use your library");

  const paper = parsePaper(await c.req.json().catch(() => null));
  if (!paper || paper.id !== decodeURIComponent(c.req.param("id"))) return deny(c, 400, "invalid_paper", "Invalid paper");

  const existing = await c.env.DB
    .prepare("SELECT 1 AS x FROM library_items WHERE user_id = ?1 AND paper_id = ?2")
    .bind(user.id, paper.id)
    .first();
  if (!existing) {
    const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM library_items WHERE user_id = ?1").bind(user.id).first<{ n: number }>();
    if ((n?.n ?? 0) >= MAX_LIBRARY_ITEMS) return deny(c, 409, "library_full", `Your library is full (${MAX_LIBRARY_ITEMS} papers)`);
  }
  await c.env.DB
    .prepare(
      "INSERT INTO library_items (user_id, paper_id, data) VALUES (?1, ?2, ?3) ON CONFLICT (user_id, paper_id) DO UPDATE SET data = excluded.data",
    )
    .bind(user.id, paper.id, JSON.stringify(paper))
    .run();
  return c.json({ ok: true });
});

libraryRoutes.delete("/:id", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in to use your library");
  const paperId = decodeURIComponent(c.req.param("id"));
  // taking a paper out of the library settles any notice about it
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM library_items WHERE user_id = ?1 AND paper_id = ?2").bind(user.id, paperId),
    c.env.DB.prepare("DELETE FROM library_alerts WHERE user_id = ?1 AND paper_id = ?2").bind(user.id, paperId),
  ]);
  return c.json({ ok: true });
});

/** One-time import of a device-local library after sign-in. Never overwrites rows that already exist. */
libraryRoutes.post("/import", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in to use your library");

  const body = (await c.req.json().catch(() => null)) as { items?: unknown } | null;
  if (!body || !Array.isArray(body.items) || body.items.length > MAX_IMPORT_ITEMS) {
    return deny(c, 400, "invalid_import", `Send up to ${MAX_IMPORT_ITEMS} items`);
  }
  const n = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM library_items WHERE user_id = ?1").bind(user.id).first<{ n: number }>();
  let room = MAX_LIBRARY_ITEMS - (n?.n ?? 0);

  const stmts: D1PreparedStatement[] = [];
  let skipped = 0;
  for (const raw of body.items) {
    const paper = parsePaper(raw);
    if (!paper || room <= 0) { skipped++; continue; }
    const savedAt = sqliteTime((raw as { savedAt?: unknown }).savedAt);
    stmts.push(
      c.env.DB
        .prepare("INSERT OR IGNORE INTO library_items (user_id, paper_id, data, saved_at) VALUES (?1, ?2, ?3, ?4)")
        .bind(user.id, paper.id, JSON.stringify(paper), savedAt),
    );
    room--;
  }
  let imported = 0;
  if (stmts.length) {
    const results = await c.env.DB.batch(stmts);
    imported = results.reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0); // INSERT OR IGNORE: rows that already existed add 0
  }
  return c.json({ imported, skipped: skipped + (stmts.length - imported) });
});
