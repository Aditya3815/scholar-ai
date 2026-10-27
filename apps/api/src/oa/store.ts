import { OA_RETRYABLE, OA_RETRY_AFTER_MINUTES, OA_WORKING, type OaReason, type OaRef, type OaSource, type OaStatus } from "@scholar/shared";
import { decodeVec, encodeVec } from "../docs/vector";
import type { StoredChunk } from "../docs/qa";
import type { OaChunk } from "./chunks";

/**
 * The shared index in D1 (migration 0017). Everything that can be done twice is written so that doing it twice is harmless: a row is created with INSERT OR IGNORE, a try is
 * claimed with one conditional UPDATE (so two people asking for the same new paper start one reading), passages are written under (paper, idx) and replaced as a whole, and a
 * paper becomes `ready` only when every passage has its embedding.
 */
export type OaRow = {
  key: string;
  doi: string | null;
  arxiv_id: string | null;
  pmcid: string | null;
  title: string | null;
  source: OaSource | null;
  license: string | null;
  status: OaStatus;
  reason: OaReason | null;
  attempt: number;
  instance: string | null;
  pages: number | null;
  chunk_count: number;
  done_chunks: number;
  r2_key: string | null;
  created_at: string;
  updated_at: string;
  ready_at: string | null;
  retry_after: string | null;
  content_hash: string | null;
  refresh_at: string | null;
};

const sqlTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
export const fromSql = (s: string | null) => (s ? Date.parse(`${s.replace(" ", "T")}Z`) : NaN);

/** The name under which a paper's files and its Workflow instances are kept: a short hash of the key (a key can be long and has characters an id cannot have). */
export async function keyHash(key: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const instanceId = (hash: string, attempt: number) => `oa-${hash}-${attempt}`;
export const fileKey = (hash: string, name: string) => `oa/${hash}/${name}`;

export const getPaper = (db: D1Database, key: string) => db.prepare("SELECT * FROM oa_papers WHERE key = ?1").bind(key).first<OaRow>();

/** Makes the row if there is none. True if this call made it. */
export async function createPaper(db: D1Database, key: string, ref: OaRef): Promise<boolean> {
  const r = await db.prepare("INSERT OR IGNORE INTO oa_papers (key, doi, arxiv_id, pmcid) VALUES (?1, ?2, ?3, ?4)").bind(key, ref.doi ?? null, ref.arxivId ?? null, ref.pmcid ?? null).run();
  return (r.meta?.changes ?? 0) === 1;
}

/**
 * Claims the right to start a reading: only for a row nobody has started (attempt 0), or one that failed and whose wait is over. Returns the number of the try, or null if
 * someone else has it, it is being read, or it is finished for good. One statement, so two askers cannot both win.
 */
export async function claimAttempt(db: D1Database, key: string, now: number): Promise<number | null> {
  const r = await db
    .prepare(
      `UPDATE oa_papers SET attempt = attempt + 1, status = 'queued', reason = NULL, instance = NULL, done_chunks = 0, retry_after = NULL, updated_at = ?2
       WHERE key = ?1 AND ((attempt = 0 AND status = 'queued') OR (status = 'failed' AND (retry_after IS NULL OR retry_after <= ?2))) RETURNING attempt`,
    )
    .bind(key, sqlTime(now))
    .first<{ attempt: number }>();
  return r?.attempt ?? null;
}

export const setInstance = (db: D1Database, key: string, instance: string) => db.prepare("UPDATE oa_papers SET instance = ?2, updated_at = datetime('now') WHERE key = ?1").bind(key, instance).run();

export const setStatus = (db: D1Database, key: string, status: OaStatus) => db.prepare("UPDATE oa_papers SET status = ?2, updated_at = datetime('now') WHERE key = ?1").bind(key, status).run();

export async function setFetched(db: D1Database, key: string, f: { source: OaSource; license: string | null; title: string | null; r2Key: string; contentHash?: string | null }) {
  await db.prepare("UPDATE oa_papers SET source = ?2, license = COALESCE(?3, license), title = COALESCE(?4, title), r2_key = ?5, content_hash = COALESCE(?6, content_hash), updated_at = datetime('now') WHERE key = ?1").bind(key, f.source, f.license, f.title, f.r2Key, f.contentHash ?? null).run();
}

/** What was learned about a paper that could not be read (its title), so the screen can name it. */
export const setTitle = (db: D1Database, key: string, title: string | null) => db.prepare("UPDATE oa_papers SET title = COALESCE(?2, title) WHERE key = ?1").bind(key, title).run();

/**
 * The reading ended without a paper. A reason that waiting can cure (a failed download, a timeout, a fault of ours) leaves it `failed`, to be tried again after an hour by
 * whoever asks next; the others (not open access, blocked, scanned, too long ...) make it `unreadable`, which stays.
 */
export async function markFailed(db: D1Database, key: string, reason: OaReason, now: number) {
  const retry = OA_RETRYABLE.includes(reason);
  await db
    .prepare("UPDATE oa_papers SET status = ?2, reason = ?3, retry_after = ?4, updated_at = ?5 WHERE key = ?1")
    .bind(key, retry ? "failed" : "unreadable", reason, retry ? sqlTime(now + OA_RETRY_AFTER_MINUTES * 60_000) : null, sqlTime(now))
    .run();
}

/** A paper that is "working" but has not moved for a quarter of an hour lost its Workflow (a failure nobody recorded): it is failed, so that it can be tried again. */
export const STALE_MINUTES = 15;
export async function failIfStale(db: D1Database, key: string, now: number): Promise<boolean> {
  const marks = OA_WORKING.map((_, i) => `?${i + 3}`).join(",");
  const r = await db
    .prepare(`UPDATE oa_papers SET status = 'failed', reason = 'internal', retry_after = NULL, updated_at = ?2 WHERE key = ?1 AND status IN (${marks}) AND updated_at < ?${OA_WORKING.length + 3}`)
    .bind(key, sqlTime(now), ...OA_WORKING, sqlTime(now - STALE_MINUTES * 60_000))
    .run();
  return (r.meta?.changes ?? 0) === 1;
}

/** Replaces all the passages of a paper (a new try starts from nothing: no half of the old reading is mixed with the new). Passages have no embedding yet. */
export async function replaceChunks(db: D1Database, key: string, chunks: readonly OaChunk[], pages: number | null) {
  const ROWS = 19; // 19 rows x 5 values = 95 bound values, under D1's limit of 100 per statement
  const inserts: D1PreparedStatement[] = [];
  for (let i = 0; i < chunks.length; i += ROWS) {
    const part = chunks.slice(i, i + ROWS);
    inserts.push(
      db.prepare(`INSERT OR REPLACE INTO oa_chunks (paper_key, idx, page, section, text) VALUES ${part.map(() => "(?, ?, ?, ?, ?)").join(",")}`).bind(...part.flatMap((c) => [key, c.idx, c.page, c.section, c.text])),
    );
  }
  await db.batch([
    db.prepare("DELETE FROM oa_chunks WHERE paper_key = ?1").bind(key),
    ...inserts,
    db.prepare("UPDATE oa_papers SET chunk_count = ?2, pages = ?3, done_chunks = 0, updated_at = datetime('now') WHERE key = ?1").bind(key, chunks.length, pages),
  ]);
}

export const pendingEmbeddings = async (db: D1Database, key: string, limit: number) =>
  (await db.prepare("SELECT idx, text FROM oa_chunks WHERE paper_key = ?1 AND embedding IS NULL ORDER BY idx LIMIT ?2").bind(key, limit).all<{ idx: number; text: string }>()).results ?? [];

export async function saveEmbeddings(db: D1Database, key: string, items: readonly { idx: number; vector: ArrayLike<number> }[]) {
  await db.batch([
    ...items.map((it) => db.prepare("UPDATE oa_chunks SET embedding = ?3 WHERE paper_key = ?1 AND idx = ?2").bind(key, it.idx, encodeVec(it.vector))),
    db.prepare("UPDATE oa_papers SET done_chunks = (SELECT COUNT(*) FROM oa_chunks WHERE paper_key = ?1 AND embedding IS NOT NULL), updated_at = datetime('now') WHERE key = ?1").bind(key),
  ]);
}

/** `ready` only if every passage has its embedding and there is at least one. False otherwise (and nothing changes). */
export async function markReady(db: D1Database, key: string): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE oa_papers SET status = 'ready', reason = NULL, ready_at = datetime('now'), refresh_at = NULL, updated_at = datetime('now'), done_chunks = chunk_count
       WHERE key = ?1 AND chunk_count > 0 AND chunk_count = (SELECT COUNT(*) FROM oa_chunks WHERE paper_key = ?1 AND embedding IS NOT NULL)`,
    )
    .bind(key)
    .run();
  return (r.meta?.changes ?? 0) === 1;
}

/** The passages of a ready paper, for answering. */
export async function readyChunks(db: D1Database, key: string): Promise<(StoredChunk & { section?: string })[]> {
  const rows = (await db.prepare("SELECT idx, page, section, text, embedding FROM oa_chunks WHERE paper_key = ?1 ORDER BY idx").bind(key).all<{ idx: number; page: number; section: string | null; text: string; embedding: string | null }>()).results ?? [];
  return rows.map((r) => ({ idx: r.idx, page: r.page, text: r.text, embedding: r.embedding ? decodeVec(r.embedding) : null, ...(r.section ? { section: r.section } : {}) }));
}

/**
 * Claims the right to refresh a ready paper that was read more than `days` ago: one statement, so two askers cannot both win, and none again for an hour (a refresh that is lost is tried again then).
 * The paper stays `ready` and keeps answering while it is fetched again. Returns the number of the try, or null.
 */
export async function claimRefresh(db: D1Database, key: string, now: number, days: number): Promise<number | null> {
  const r = await db
    .prepare(
      `UPDATE oa_papers SET attempt = attempt + 1, refresh_at = ?2, updated_at = ?2
       WHERE key = ?1 AND status = 'ready' AND ready_at IS NOT NULL AND ready_at <= ?3 AND (refresh_at IS NULL OR refresh_at <= ?4) RETURNING attempt`,
    )
    .bind(key, sqlTime(now), sqlTime(now - days * 86_400_000), sqlTime(now - 3_600_000))
    .first<{ attempt: number }>();
  return r?.attempt ?? null;
}

/** The file is the same as before: the paper is as fresh as a new reading, and is looked at again after the full time. */
export const markRefreshed = (db: D1Database, key: string, now: number) => db.prepare("UPDATE oa_papers SET ready_at = ?2, refresh_at = NULL, updated_at = ?2 WHERE key = ?1").bind(key, sqlTime(now)).run();

/** The new file could not be fetched: keep the copy that works, and look again in thirty days (not at every question). */
export const keepOld = (db: D1Database, key: string, now: number, days: number) =>
  db.prepare("UPDATE oa_papers SET ready_at = ?2, refresh_at = NULL, updated_at = ?3 WHERE key = ?1 AND status = 'ready'").bind(key, sqlTime(now - (days - 30) * 86_400_000), sqlTime(now)).run();

/** Counts one new paper against a person's day. False when they have used the day's allowance. */
export async function takeDaily(db: D1Database, userId: string, day: string, max: number): Promise<boolean> {
  const r = await db.prepare("INSERT INTO oa_daily (user_id, day, n) VALUES (?1, ?2, 1) ON CONFLICT (user_id, day) DO UPDATE SET n = n + 1 WHERE n < ?3").bind(userId, day, max).run();
  return (r.meta?.changes ?? 0) === 1;
}
export const refundDaily = (db: D1Database, userId: string, day: string) => db.prepare("UPDATE oa_daily SET n = MAX(0, n - 1) WHERE user_id = ?1 AND day = ?2").bind(userId, day).run();
