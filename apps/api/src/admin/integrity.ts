/**
 * Do the uploaded-paper records and the stored files agree? After a database restore (or a failed delete) they can drift apart:
 *  - a paper whose PDF is not in storage (the reader cannot open it),
 *  - a stored file that no record points to (it costs money and, if its owner deleted the account, is personal data kept by mistake),
 *  - a paper that says it has a cover image that is not there.
 * Read only. Names are shortened to the first 8 characters of the paper id; the owner is never shown.
 */
import type { IntegrityReport } from "@scholar/shared";

export type Obj = { key: string; uploadedMs: number };
export type DocRow = { id: string; user_id: string; has_cover: number; createdMs: number };

const KEY = /^docs\/([^/]+)\/([^/]+?)(\.cover\.jpg|\.pdf)$/;
const SAMPLES = 10;
const short = (id: string) => id.slice(0, 8);

export function compareInventory(objects: Obj[], rows: DocRow[], opts: { now: number; graceMinutes: number; truncated?: boolean }): IntegrityReport {
  const cutoff = opts.now - opts.graceMinutes * 60_000;
  const have = new Map<string, Obj>(); // "user/id.pdf" or "user/id.cover.jpg" -> object
  let unrecognised = 0;
  for (const o of objects) {
    const m = KEY.exec(o.key);
    if (!m) {
      unrecognised++;
      continue;
    }
    have.set(`${m[1]}/${m[2]}${m[3]}`, o);
  }

  const wanted = new Set<string>();
  const missingFiles: string[] = [];
  const missingCovers: string[] = [];
  let missingFilesN = 0;
  let missingCoversN = 0;
  for (const r of rows) {
    wanted.add(`${r.user_id}/${r.id}.pdf`);
    if (r.has_cover) wanted.add(`${r.user_id}/${r.id}.cover.jpg`);
    // A record younger than the grace may be an upload whose file is still on its way.
    if (!(r.createdMs <= cutoff)) continue;
    if (!have.has(`${r.user_id}/${r.id}.pdf`)) {
      missingFilesN++;
      if (missingFiles.length < SAMPLES) missingFiles.push(short(r.id));
    }
    if (r.has_cover && !have.has(`${r.user_id}/${r.id}.cover.jpg`)) {
      missingCoversN++;
      if (missingCovers.length < SAMPLES) missingCovers.push(short(r.id));
    }
  }

  const orphanFiles: string[] = [];
  let orphanN = 0;
  for (const [k, o] of have) {
    if (wanted.has(k)) continue;
    // A file younger than the grace may belong to a record that is not visible yet, or one being deleted.
    if (!(o.uploadedMs <= cutoff)) continue;
    orphanN++;
    if (orphanFiles.length < SAMPLES) orphanFiles.push(short(k.split("/")[1]!.replace(/\.(cover\.jpg|pdf)$/, "")));
  }

  return {
    checkedAt: new Date(opts.now).toISOString(),
    files: have.size,
    documents: rows.length,
    missingFiles: missingFilesN,
    missingCovers: missingCoversN,
    orphanFiles: orphanN,
    unrecognised,
    samples: { missingFiles, missingCovers, orphanFiles },
    truncated: !!opts.truncated,
    graceMinutes: opts.graceMinutes,
  };
}

/** Stored files must not be listed forever: past this many the report says it is partial. One list call returns up to 1,000. */
export const MAX_FILES = 20_000;

export async function listFiles(bucket: R2Bucket, max = MAX_FILES): Promise<{ objects: Obj[]; truncated: boolean }> {
  const objects: Obj[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await bucket.list({ prefix: "docs/", cursor, limit: 1000 });
    for (const o of page.objects) objects.push({ key: o.key, uploadedMs: o.uploaded.getTime() });
    if (!page.truncated) return { objects, truncated: false };
    if (objects.length >= max) return { objects, truncated: true };
    cursor = page.cursor;
  }
}

export async function listDocuments(db: D1Database): Promise<DocRow[]> {
  const rows: DocRow[] = [];
  let after = "";
  for (;;) {
    const page = await db
      .prepare("SELECT id, user_id, has_cover, created_at FROM documents WHERE id > ?1 ORDER BY id LIMIT 2000")
      .bind(after)
      .all<{ id: string; user_id: string; has_cover: number; created_at: string }>();
    for (const r of page.results) rows.push({ id: r.id, user_id: r.user_id, has_cover: r.has_cover, createdMs: Date.parse(`${r.created_at.replace(" ", "T")}Z`) });
    if (page.results.length < 2000) return rows;
    after = page.results[page.results.length - 1]!.id;
  }
}
