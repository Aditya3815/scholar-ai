import { deleteDocument } from "../docs/routes";
import { captureException, type SentryEnv } from "../monitoring/sentry";

/**
 * Deleting an account, and keeping a deletion from being undone by a database restore.
 *
 * A restore (D1 Time Travel) returns the database to an earlier moment, so an account deleted after that moment would come back. Files in R2
 * are not rolled back, so before anything else a small marker, `tombstones/<account id>`, is written there (an empty file; the id is a random
 * identifier, not an e-mail or a name). After a restore the admin runs "re-apply deletions" and every account that has a marker but a row again is
 * erased once more. The markers expire after 35 days (an R2 lifecycle rule, docs/runbook.md), a few days longer than the 30 days a restore can reach back,
 * so a marker never outlives the backups it protects against.
 */
export const TOMBSTONE_PREFIX = "tombstones/";
const ID = /^[A-Za-z0-9-]{8,64}$/;
const tombstoneKey = (userId: string) => `${TOMBSTONE_PREFIX}${userId}`;

type Env = { DB: D1Database; FILES: R2Bucket } & SentryEnv;

/** Erases the account's papers (files and rows), library, reports, sessions and sign-in links, in that order, then the account itself. */
export async function eraseAccount(env: Env, userId: string, opts: { tombstone?: boolean } = {}): Promise<void> {
  if (opts.tombstone !== false && ID.test(userId)) {
    // First, so that a deletion which stops half way is still re-applied. A marker that cannot be written must not block someone's right to delete.
    try {
      await env.FILES.put(tombstoneKey(userId), "", { customMetadata: { at: new Date().toISOString() } });
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "tombstone_failed" }));
      captureException(env, err, { route: "account:erase", tags: { step: "tombstone" } });
    }
  }
  const db = env.DB;
  const owned = await db.prepare("SELECT id FROM documents WHERE user_id = ?1").bind(userId).all<{ id: string }>();
  for (const d of owned.results) await deleteDocument(env, userId, d.id);
  await db.batch([
    db.prepare("DELETE FROM ocr_usage WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM library_alerts WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM library_items WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM feedback WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM idempotency_keys WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM oa_daily WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM oauth_states WHERE link_user_id = ?1").bind(userId),
    db.prepare("DELETE FROM identities WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM users WHERE id = ?1").bind(userId),
    db.prepare("INSERT INTO audit_log (action) VALUES ('account_deleted')"),
  ]);
}

/** Account ids that have a deletion marker. Anything under the prefix that is not shaped like an id is ignored. */
export async function listTombstones(bucket: R2Bucket): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await bucket.list({ prefix: TOMBSTONE_PREFIX, cursor, limit: 1000 });
    for (const o of page.objects) {
      const id = o.key.slice(TOMBSTONE_PREFIX.length);
      if (ID.test(id)) ids.push(id);
    }
    if (!page.truncated) return ids;
    cursor = page.cursor;
  }
}

/** Of these ids, the ones that have an account row (in chunks, because D1 allows 100 parameters a query). */
export async function existingUsers(db: D1Database, ids: string[]): Promise<string[]> {
  const found: string[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const rows = await db.prepare(`SELECT id FROM users WHERE id IN (${chunk.map((_, k) => `?${k + 1}`).join(",")})`).bind(...chunk).all<{ id: string }>();
    found.push(...rows.results.map((r) => r.id));
  }
  return found;
}

export type ReapplyResult = { markers: number; erased: number; failed: number };

/** Erases again every account that was deleted and has come back (after a restore). Safe to run twice: the second run finds nothing. */
export async function reapplyDeletions(env: Env): Promise<ReapplyResult> {
  const ids = await listTombstones(env.FILES);
  const back = await existingUsers(env.DB, ids);
  let erased = 0;
  let failed = 0;
  for (const id of back) {
    try {
      await eraseAccount(env, id, { tombstone: false });
      erased++;
    } catch (err) {
      failed++;
      captureException(env, err, { route: "account:reapply" });
    }
  }
  return { markers: ids.length, erased, failed };
}
