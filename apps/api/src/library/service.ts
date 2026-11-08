import type { LibraryAlert, Paper } from "@scholar/shared";
import { MAX_LIBRARY_ITEMS, doiColumn, fromSqliteTime } from "./validate";

/**
 * The library as a service (docs "Sodhsetu understanding, follow-ups and MCP (design)", page 12: "service layer"): the page's /api/v1/library routes and the MCP tools get_library and save_paper
 * call the same two functions. Every query is scoped by the account id the caller passes; there is no way to name another person's rows.
 */

export type LibraryItem = Paper & { savedAt: number };

/** `gone`: the daily re-check (retraction.ts) has found the paper retracted since it was saved. */
type Row = { data: string; saved_at: string; gone?: number };
const CROSSREF_RETRACTION = "crossref-retraction-watch";
const toItem = (r: Row): LibraryItem => {
  const paper = JSON.parse(r.data) as Paper;
  const retracted = paper.retracted || r.gone === 1;
  const retractionSources = r.gone === 1 && !paper.retractionSources?.includes(CROSSREF_RETRACTION) ? [...(paper.retractionSources ?? []), CROSSREF_RETRACTION] : (paper.retractionSources ?? []);
  return { ...paper, retracted, retractionSources, savedAt: fromSqliteTime(r.saved_at) };
};

/** The person's saved papers, newest first, each marked retracted when the re-check has found it so since it was saved. */
export async function listLibrary(db: D1Database, userId: string): Promise<LibraryItem[]> {
  const rows = await db
    .prepare(
      `SELECT data, saved_at, EXISTS (SELECT 1 FROM paper_retraction r WHERE r.doi = lower(json_extract(data, '$.doi')) AND r.state = 'retracted') AS gone
         FROM library_items WHERE user_id = ?1 ORDER BY saved_at DESC, rowid DESC LIMIT ?2`,
    )
    .bind(userId, MAX_LIBRARY_ITEMS)
    .all<Row>();
  return rows.results.map(toItem);
}

/** The notices the person has not dismissed ("A paper you saved has been retracted"). */
export async function libraryAlerts(db: D1Database, userId: string): Promise<LibraryAlert[]> {
  const notices = await db
    .prepare("SELECT paper_id, title, kind, created_at FROM library_alerts WHERE user_id = ?1 AND seen_at IS NULL ORDER BY created_at DESC, paper_id LIMIT 100")
    .bind(userId)
    .all<{ paper_id: string; title: string; kind: "retracted"; created_at: string }>();
  return notices.results.map((a) => ({ paperId: a.paper_id, title: a.title, kind: a.kind, at: new Date(fromSqliteTime(a.created_at)).toISOString() }));
}

/**
 * Saves a paper (already checked by `parsePaper`) for the person, or updates the copy they have. `full` when the library holds MAX_LIBRARY_ITEMS papers and this one is new; `existed` says
 * whether it was there already (saving twice is the same as saving once).
 */
export async function saveToLibrary(db: D1Database, userId: string, paper: Paper): Promise<{ ok: true; existed: boolean } | { ok: false; full: true }> {
  const existing = await db.prepare("SELECT 1 AS x FROM library_items WHERE user_id = ?1 AND paper_id = ?2").bind(userId, paper.id).first();
  if (!existing) {
    const n = await db.prepare("SELECT COUNT(*) AS n FROM library_items WHERE user_id = ?1").bind(userId).first<{ n: number }>();
    if ((n?.n ?? 0) >= MAX_LIBRARY_ITEMS) return { ok: false, full: true };
  }
  await db
    .prepare("INSERT INTO library_items (user_id, paper_id, data, doi) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (user_id, paper_id) DO UPDATE SET data = excluded.data, doi = excluded.doi")
    .bind(userId, paper.id, JSON.stringify(paper), doiColumn(paper))
    .run();
  return { ok: true, existed: !!existing };
}

export const libraryService = { list: listLibrary, alerts: libraryAlerts, save: saveToLibrary };
