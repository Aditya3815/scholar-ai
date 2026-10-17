import { Hono, type Context } from "hono";
import type { Paper } from "@scholar/shared";
import { currentUser, sameOrigin } from "../auth/http";
import { MAX_IMPORT_ITEMS, MAX_LIBRARY_ITEMS, fromSqliteTime, parsePaper, sqliteTime } from "./validate";

type Env = { Bindings: { DB: D1Database } };
export const libraryRoutes = new Hono<Env>();

const deny = (c: Context<Env>, status: 401 | 403 | 409 | 400, type: string, title: string) => c.json({ type, title }, status);

libraryRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

type Row = { data: string; saved_at: string };
const toItem = (r: Row) => ({ ...(JSON.parse(r.data) as Paper), savedAt: fromSqliteTime(r.saved_at) });

/** Every handler is scoped by the session's user id; there is no way to name another user's rows. */
libraryRoutes.get("/", async (c) => {
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in to use your library");
  const rows = await c.env.DB
    .prepare("SELECT data, saved_at FROM library_items WHERE user_id = ?1 ORDER BY saved_at DESC, rowid DESC LIMIT ?2")
    .bind(user.id, MAX_LIBRARY_ITEMS)
    .all<Row>();
  return c.json({ items: rows.results.map(toItem) });
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
  await c.env.DB
    .prepare("DELETE FROM library_items WHERE user_id = ?1 AND paper_id = ?2")
    .bind(user.id, decodeURIComponent(c.req.param("id")))
    .run();
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
