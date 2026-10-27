import { LITSCAN_KEEP_HOURS, LITSCAN_STALE_MINUTES, viewFromEvents, type LitscanEvent, type LitscanItem, type LitscanLanguage, type LitscanListItem, type LitscanPart, type LitscanSnapshot, type LitscanState } from "@scholar/shared";
import { fromSqliteTime } from "../library/validate";

/**
 * The scans in the database (migration 0020). A scan is a row; what happened to it is a list of events, and everything the page shows is those events folded together
 * (`viewFromEvents`), so a page that was closed and reopened, a second device, and the stream all see the same thing.
 */
export type ScanRow = {
  id: string;
  user_id: string;
  topic: string;
  language: LitscanLanguage;
  plan: string;
  state: LitscanState;
  est_tokens: number;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

/** The events that can be stored (the stream adds `progress` itself, and `error` never reaches the database). */
export type StoredEvent = Exclude<LitscanEvent, { type: "progress" } | { type: "error" }>;

export const itemsOf = (row: Pick<ScanRow, "plan">): LitscanItem[] => JSON.parse(row.plan) as LitscanItem[];

export async function createScan(db: D1Database, s: { id: string; userId: string; topic: string; language: LitscanLanguage; items: LitscanItem[]; estimate: number }): Promise<void> {
  await db
    .prepare("INSERT INTO litscans (id, user_id, topic, language, plan, est_tokens, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now', ?7))")
    .bind(s.id, s.userId, s.topic, s.language, JSON.stringify(s.items), s.estimate, `+${LITSCAN_KEEP_HOURS} hours`)
    .run();
  await appendEvent(db, s.id, "started", { type: "started", total: s.items.length });
}

/** The scan if it is this person's (anyone else's, and one that does not exist, look the same: null). Only the owner can see it, expired or not removed yet. */
export const getScan = (db: D1Database, id: string, userId: string): Promise<ScanRow | null> =>
  db.prepare("SELECT * FROM litscans WHERE id = ?1 AND user_id = ?2 AND expires_at > datetime('now')").bind(id, userId).first<ScanRow>();

/** The scan by id alone, for the workflow that runs it (it was started by someone who passed the checks; the id is a random one). */
export const getScanForRun = (db: D1Database, id: string): Promise<ScanRow | null> => db.prepare("SELECT * FROM litscans WHERE id = ?1").bind(id).first<ScanRow>();

/**
 * Stores one event, once: the same `key` is ignored the second time (a retried step writes its result again), and nothing is stored once the scan has ended (a worker that was
 * still running when the person pressed Cancel cannot add to a canceled scan). Returns whether this call stored it.
 */
export async function appendEvent(db: D1Database, id: string, key: string, e: StoredEvent): Promise<boolean> {
  const [stored] = await db.batch([
    db
      .prepare("INSERT OR IGNORE INTO litscan_events (scan_id, seq, key, type, data) SELECT ?1, (SELECT COALESCE(MAX(seq), 0) + 1 FROM litscan_events WHERE scan_id = ?1), ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM litscans WHERE id = ?1 AND state = 'running')")
      .bind(id, key, e.type, JSON.stringify(e)),
    db.prepare("UPDATE litscans SET updated_at = datetime('now') WHERE id = ?1 AND state = 'running'").bind(id),
  ]);
  return (stored?.meta?.changes ?? 0) === 1;
}

/** The scans' events after `after` (0 for all), in order, each with its place. */
export async function eventsAfter(db: D1Database, id: string, after: number): Promise<StoredEvent[]> {
  const rows = await db.prepare("SELECT seq, data FROM litscan_events WHERE scan_id = ?1 AND seq > ?2 ORDER BY seq").bind(id, after).all<{ seq: number; data: string }>();
  return rows.results.map((r) => ({ ...(JSON.parse(r.data) as StoredEvent), seq: r.seq }));
}

/**
 * The scan comes to an end: one `done` event with the counts and the new state, together, and only if it is still running (so a cancel and a finish that meet leave one end, whichever
 * came first). Returns whether this call ended it.
 */
export async function endScan(db: D1Database, id: string, state: Exclude<LitscanState, "running">): Promise<boolean> {
  const parts = await partsOf(db, id);
  const answered = parts.filter((p) => p.status === "answered").length;
  const [stored] = await db.batch([
    db
      .prepare("INSERT OR IGNORE INTO litscan_events (scan_id, seq, key, type, data) SELECT ?1, (SELECT COALESCE(MAX(seq), 0) + 1 FROM litscan_events WHERE scan_id = ?1), 'done', 'done', ?2 WHERE EXISTS (SELECT 1 FROM litscans WHERE id = ?1 AND state = 'running')")
      .bind(id, JSON.stringify({ type: "done", state, answered, gaps: parts.length - answered } satisfies StoredEvent)),
    db.prepare("UPDATE litscans SET state = ?2, updated_at = datetime('now') WHERE id = ?1 AND state = 'running'").bind(id, state),
  ]);
  return (stored?.meta?.changes ?? 0) === 1;
}

export async function partsOf(db: D1Database, id: string): Promise<LitscanPart[]> {
  const rows = await db.prepare("SELECT data FROM litscan_events WHERE scan_id = ?1 AND type = 'part' ORDER BY seq").bind(id).all<{ data: string }>();
  return rows.results.map((r) => (JSON.parse(r.data) as { part: LitscanPart }).part);
}

/**
 * A running scan that has not moved for a while is over: the workflow that ran it was lost. It is ended as failed, so the page does not wait for something that will never come.
 * Returns whether this call did it.
 */
export async function failIfStale(db: D1Database, id: string): Promise<boolean> {
  const cutoff = `-${LITSCAN_STALE_MINUTES} minutes`;
  const [stored] = await db.batch([
    db
      .prepare("INSERT OR IGNORE INTO litscan_events (scan_id, seq, key, type, data) SELECT ?1, (SELECT COALESCE(MAX(seq), 0) + 1 FROM litscan_events WHERE scan_id = ?1), 'done', 'done', ?2 WHERE EXISTS (SELECT 1 FROM litscans WHERE id = ?1 AND state = 'running' AND updated_at < datetime('now', ?3))")
      .bind(id, JSON.stringify({ type: "done", state: "failed", answered: 0, gaps: 0 } satisfies StoredEvent), cutoff),
    db.prepare("UPDATE litscans SET state = 'failed' WHERE id = ?1 AND state = 'running' AND updated_at < datetime('now', ?2)").bind(id, cutoff),
  ]);
  return (stored?.meta?.changes ?? 0) === 1;
}

/** The scan as the page needs it. */
export async function snapshotOf(db: D1Database, row: ScanRow): Promise<LitscanSnapshot> {
  const items = itemsOf(row);
  const events = await eventsAfter(db, row.id, 0);
  const view = viewFromEvents(events, items.length);
  return {
    id: row.id,
    topic: row.topic,
    language: row.language,
    items,
    // the row's state and the events agree, because they are written together; the row is the one to trust if a read lands between the two
    state: row.state,
    total: items.length,
    done: view.done,
    stages: view.stages,
    parts: Object.values(view.parts).sort((a, b) => a.idx - b.idx),
    seq: view.seq,
    createdAt: new Date(fromSqliteTime(row.created_at)).toISOString(),
    expiresAt: new Date(fromSqliteTime(row.expires_at)).toISOString(),
    estimate: row.est_tokens,
  };
}

/** The person's scans of the last day, newest first. */
export async function listScans(db: D1Database, userId: string): Promise<LitscanListItem[]> {
  const rows = await db
    .prepare(
      "SELECT s.id, s.topic, s.state, s.plan, s.created_at, s.expires_at, (SELECT COUNT(*) FROM litscan_events e WHERE e.scan_id = s.id AND e.type = 'part') AS done FROM litscans s WHERE s.user_id = ?1 AND s.expires_at > datetime('now') ORDER BY s.created_at DESC, s.id LIMIT 20",
    )
    .bind(userId)
    .all<{ id: string; topic: string; state: LitscanState; plan: string; created_at: string; expires_at: string; done: number }>();
  return rows.results.map((r) => ({ id: r.id, topic: r.topic, state: r.state, total: itemsOf(r).length, done: r.done, createdAt: new Date(fromSqliteTime(r.created_at)).toISOString(), expiresAt: new Date(fromSqliteTime(r.expires_at)).toISOString() }));
}

/** The id of this person's scan that is still moving, if any (one at a time). */
export async function runningScan(db: D1Database, userId: string): Promise<string | null> {
  const r = await db.prepare("SELECT id FROM litscans WHERE user_id = ?1 AND state = 'running' AND updated_at >= datetime('now', ?2) ORDER BY created_at DESC LIMIT 1").bind(userId, `-${LITSCAN_STALE_MINUTES} minutes`).first<{ id: string }>();
  return r?.id ?? null;
}

export async function deleteScan(db: D1Database, id: string, userId: string): Promise<boolean> {
  const mine = await db.prepare("SELECT id FROM litscans WHERE id = ?1 AND user_id = ?2").bind(id, userId).first<{ id: string }>();
  if (!mine) return false;
  await db.batch([db.prepare("DELETE FROM litscan_shares WHERE scan_id = ?1").bind(id), db.prepare("DELETE FROM litscan_events WHERE scan_id = ?1").bind(id), db.prepare("DELETE FROM litscans WHERE id = ?1 AND user_id = ?2").bind(id, userId)]);
  return true;
}

/** One more scan started today, unless the person has used all of theirs. */
export async function takeScan(db: D1Database, userId: string, day: string, max: number): Promise<boolean> {
  const r = await db.prepare("INSERT INTO litscan_daily (user_id, day, n) VALUES (?1, ?2, 1) ON CONFLICT (user_id, day) DO UPDATE SET n = n + 1 WHERE n < ?3").bind(userId, day, max).run();
  return (r.meta?.changes ?? 0) === 1;
}
export const refundScan = (db: D1Database, userId: string, day: string) => db.prepare("UPDATE litscan_daily SET n = MAX(0, n - 1) WHERE user_id = ?1 AND day = ?2").bind(userId, day).run();

/** The daily clean-up (maintenance.ts): events first, then the scans that are past their time. */
export const LITSCAN_PURGE_SQL = [
  "DELETE FROM litscan_shares WHERE scan_id IN (SELECT id FROM litscans WHERE expires_at < datetime('now'))",
  "DELETE FROM litscan_events WHERE scan_id IN (SELECT id FROM litscans WHERE expires_at < datetime('now'))",
  "DELETE FROM litscans WHERE expires_at < datetime('now')",
  "DELETE FROM litscan_daily WHERE day < date('now', '-35 days')",
] as const;
