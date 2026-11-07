import { Hono } from "hono";
import { currentUser, sameOrigin } from "../auth/http";
import { MAX_IMPORT_ITEMS, MAX_LIBRARY_ITEMS, doiColumn, parsePaper, sqliteTime } from "./validate";
import { libraryService } from "./service";
import { deny } from "../problem";

type Env = { Bindings: { DB: D1Database } };
export const libraryRoutes = new Hono<Env>();


libraryRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

/** Every handler is scoped by the session's user id; there is no way to name another user's rows. */
libraryRoutes.get("/", async (c) => {
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in to use your library");
  const [items, alerts] = await Promise.all([libraryService.list(c.env.DB, user.id), libraryService.alerts(c.env.DB, user.id)]);
  return c.json({ items, alerts });
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

  const saved = await libraryService.save(c.env.DB, user.id, paper);
  if (!saved.ok) return deny(c, 409, "library_full", `Your library is full (${MAX_LIBRARY_ITEMS} papers)`);
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
        .prepare("INSERT OR IGNORE INTO library_items (user_id, paper_id, data, saved_at, doi) VALUES (?1, ?2, ?3, ?4, ?5)")
        .bind(user.id, paper.id, JSON.stringify(paper), savedAt, doiColumn(paper)),
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
