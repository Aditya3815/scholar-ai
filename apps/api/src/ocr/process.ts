import { MAX_DOC_PAGES, judgePage, type OcrStatus, type OcrWhy, type ScanInfo, type ScanPage, type ScanPageResult } from "@scholar/shared";
import { chunkPage } from "../docs/chunk";
import type { Embedder } from "../docs/embed";
import { encodeVec } from "../docs/vector";
import type { PageReader } from "./read";

/**
 * Scanned papers on the server side: which pages still have to be read, reading one, keeping what was read, and the daily limit.
 * The rule that decides whether a reading is good enough is `judgePage` (packages/shared/src/ocr.ts); nothing here changes the text.
 */

const day = () => new Date().toISOString().slice(0, 10);

export class DailyLimitError extends Error {
  constructor(readonly used: number, readonly perDay: number) {
    super("daily page limit reached");
  }
}
export class ReadFailedError extends Error {
  constructor(readonly errors: string[]) {
    super("both readings failed");
  }
}

type OcrRow = { page: number; status: OcrStatus | "pending"; disagreement: number | null; disputed: string | null; why: OcrWhy | null };

const parseList = (s: string | null): string[] => {
  try {
    const v = JSON.parse(s ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export async function pagesUsedToday(db: D1Database, userId: string): Promise<number> {
  return (await db.prepare("SELECT pages FROM ocr_usage WHERE user_id = ?1 AND day = ?2").bind(userId, day()).first<{ pages: number }>())?.pages ?? 0;
}

/** What the paper's scan looks like now: counts, and every page that has been tried. */
export async function scanInfo(db: D1Database, userId: string, docId: string, perDay: number): Promise<ScanInfo | null> {
  const rows = await db.prepare("SELECT page, status, disagreement, disputed, why FROM doc_ocr WHERE doc_id = ?1 ORDER BY page").bind(docId).all<OcrRow>();
  if (rows.results.length === 0) return null;
  const count = (s: string) => rows.results.filter((r) => r.status === s).length;
  const items: ScanPage[] = rows.results
    .filter((r) => r.status !== "pending")
    .map((r) => ({ page: r.page, status: r.status as OcrStatus, disagreement: r.disagreement, disputed: parseList(r.disputed), ...(r.why ? { why: r.why } : {}) }));
  return {
    pages: rows.results.length,
    read: count("ok"),
    warned: count("warn"),
    unreliable: count("unreliable"),
    empty: count("empty"),
    pending: rows.results.filter((r) => r.status === "pending").map((r) => r.page),
    usedToday: await pagesUsedToday(db, userId),
    perDay,
    items,
  };
}

/**
 * The pages that have to be read from their pictures (the browser found no text on them). Pages already in the list keep what was read, so asking
 * again (after a stop, or when the paper is opened again) continues instead of starting over. Returns how many pages are still to be read.
 */
export async function registerScan(db: D1Database, docId: string, pages: number, scanPages: number[]): Promise<number> {
  const list = [...new Set(scanPages)].filter((p) => Number.isInteger(p) && p >= 1 && p <= pages).sort((a, b) => a - b);
  const ROWS = 49; // 2 values a row, under D1's limit of 100 per statement
  const inserts: D1PreparedStatement[] = [];
  for (let i = 0; i < list.length; i += ROWS) {
    const part = list.slice(i, i + ROWS);
    inserts.push(db.prepare(`INSERT OR IGNORE INTO doc_ocr (doc_id, page) VALUES ${part.map(() => "(?, ?)").join(",")}`).bind(...part.flatMap((p) => [docId, p])));
  }
  await db.batch([
    db.prepare("UPDATE documents SET scanned = 1, pages = ?1, status = 'indexing', error = NULL, updated_at = datetime('now') WHERE id = ?2").bind(pages, docId),
    ...inserts,
  ]);
  return pendingCount(db, docId);
}

const pendingCount = async (db: D1Database, docId: string) =>
  (await db.prepare("SELECT COUNT(*) AS n FROM doc_ocr WHERE doc_id = ?1 AND status = 'pending'").bind(docId).first<{ n: number }>())?.n ?? 0;

/** When nothing is left to read, the paper is ready (if anything usable was read) or failed (if nothing was). */
export async function finishIfDone(db: D1Database, docId: string): Promise<boolean> {
  if ((await pendingCount(db, docId)) > 0) return false;
  const n = (await db.prepare("SELECT COUNT(*) AS n FROM doc_chunks WHERE doc_id = ?1").bind(docId).first<{ n: number }>())?.n ?? 0;
  const error = n === 0 ? "None of the pages could be read reliably. Try a sharper scan (150 dpi or better, straight, not shadowed), or a text-based PDF." : null;
  await db
    .prepare("UPDATE documents SET status = ?1, error = ?2, chunk_count = ?3, updated_at = datetime('now') WHERE id = ?4")
    .bind(n === 0 ? "failed" : "ready", error, n, docId)
    .run();
  return true;
}

/** Takes one page off the person's daily allowance, atomically. false = none left. */
async function reserve(db: D1Database, userId: string, perDay: number): Promise<boolean> {
  const r = await db
    .prepare("INSERT INTO ocr_usage (user_id, day, pages) VALUES (?1, ?2, 1) ON CONFLICT (user_id, day) DO UPDATE SET pages = pages + 1 WHERE pages < ?3")
    .bind(userId, day(), perDay)
    .run();
  return (r.meta.changes ?? 0) > 0;
}
const refund = (db: D1Database, userId: string) => db.prepare("UPDATE ocr_usage SET pages = MAX(0, pages - 1) WHERE user_id = ?1 AND day = ?2").bind(userId, day()).run();

export type PageResult = ScanPageResult;

type ReadArgs = {
  db: D1Database;
  userId: string;
  docId: string;
  page: number;
  perDay: number;
  reader: PageReader;
  embed: Embedder;
  /** null = the browser saw that the page has nothing on it, so there is nothing to read. */
  image: { bytes: Uint8Array; comment: string | null } | null;
};

/**
 * Reads one page of a scanned paper and keeps the result. Throws DailyLimitError when the person has used today's pages, and ReadFailedError when
 * neither model could be reached (in both cases nothing is changed and no page is used up).
 */
export async function readScanPage(a: ReadArgs): Promise<PageResult | null> {
  const { db, userId, docId, page } = a;
  const row = await db.prepare("SELECT status, disagreement, disputed, why, text FROM doc_ocr WHERE doc_id = ?1 AND page = ?2").bind(docId, page).first<{ status: OcrStatus | "pending"; disagreement: number | null; disputed: string | null; why: OcrWhy | null; text: string | null }>();
  if (!row || page < 1 || page > MAX_DOC_PAGES) return null;
  const used = () => pagesUsedToday(db, userId);
  const chunkCountOf = async () => (await db.prepare("SELECT COUNT(*) AS n FROM doc_chunks WHERE doc_id = ?1 AND page = ?2").bind(docId, page).first<{ n: number }>())?.n ?? 0;

  // A page that was already read (or found empty) is not read, or charged, twice: a repeated request, or a second tab, gets what is kept.
  if (row.status === "ok" || row.status === "warn" || row.status === "empty") {
    return { page, status: row.status, disagreement: row.disagreement, disputed: parseList(row.disputed), ...(row.why ? { why: row.why } : {}), text: row.text ?? "", chunks: await chunkCountOf(), done: await finishIfDone(db, docId), usedToday: await used(), perDay: a.perDay };
  }

  if (a.image === null) {
    await db.prepare("UPDATE doc_ocr SET status = 'empty', disagreement = 0, disputed = '[]', why = NULL, text = NULL, updated_at = datetime('now') WHERE doc_id = ?1 AND page = ?2").bind(docId, page).run();
    return { page, status: "empty", disagreement: 0, disputed: [], text: "", chunks: 0, done: await finishIfDone(db, docId), usedToday: await used(), perDay: a.perDay };
  }

  if (!(await reserve(db, userId, a.perDay))) throw new DailyLimitError(await used(), a.perDay);

  let read;
  try {
    read = await a.reader(a.image.bytes, { page, comment: a.image.comment });
  } catch (e) {
    await refund(db, userId);
    throw new ReadFailedError([e instanceof Error ? e.message.slice(0, 80) : "error"]);
  }
  if (!read.first && !read.second) {
    await refund(db, userId);
    throw new ReadFailedError(read.errors);
  }
  if (read.neurons > 0) await db.prepare("UPDATE ocr_usage SET neurons = neurons + ?3 WHERE user_id = ?1 AND day = ?2").bind(userId, day(), read.neurons).run();
  // One of the two could not be reached: this says nothing about the page, so it is left to be read again and not charged.
  if (!read.first || !read.second) {
    await refund(db, userId);
    return { page, status: "retry", disagreement: null, disputed: [], why: "second_reading_failed", text: "", chunks: 0, done: false, usedToday: await used(), perDay: a.perDay };
  }

  const verdict = judgePage(read.first, read.second);
  const keep = verdict.status === "ok" || verdict.status === "warn";
  const chunks = keep ? chunkPage(page, verdict.text) : [];
  let vectors: number[][] = [];
  if (chunks.length > 0) {
    try {
      vectors = await a.embed(chunks.map((c) => c.text));
    } catch (e) {
      await refund(db, userId);
      throw new ReadFailedError([`embed:${e instanceof Error ? e.message.slice(0, 60) : "error"}`]);
    }
  }
  const ROWS = 19;
  const inserts: D1PreparedStatement[] = [];
  for (let i = 0; i < chunks.length; i += ROWS) {
    const part = chunks.slice(i, i + ROWS);
    inserts.push(
      db
        .prepare(`INSERT INTO doc_chunks (doc_id, idx, page, text, embedding) VALUES ${part.map(() => "(?, ?, ?, ?, ?)").join(",")}`)
        .bind(...part.flatMap((ch, k) => [docId, ch.idx, ch.page, ch.text, encodeVec(vectors[i + k]!)])),
    );
  }
  await db.batch([
    db.prepare("DELETE FROM doc_chunks WHERE doc_id = ?1 AND page = ?2").bind(docId, page),
    ...inserts,
    db
      .prepare("UPDATE doc_ocr SET status = ?3, disagreement = ?4, disputed = ?5, why = ?6, text = ?7, updated_at = datetime('now') WHERE doc_id = ?1 AND page = ?2")
      .bind(docId, page, verdict.status, verdict.disagreement, JSON.stringify(verdict.disputed), verdict.why ?? null, keep ? verdict.text : null),
    db.prepare("UPDATE documents SET chunk_count = (SELECT COUNT(*) FROM doc_chunks WHERE doc_id = ?1), updated_at = datetime('now') WHERE id = ?1").bind(docId),
  ]);
  return {
    page,
    status: verdict.status,
    disagreement: verdict.disagreement,
    disputed: verdict.disputed,
    ...(verdict.why ? { why: verdict.why } : {}),
    text: keep ? verdict.text : "",
    chunks: chunks.length,
    done: await finishIfDone(db, docId),
    usedToday: await used(),
    perDay: a.perDay,
  };
}

/** What was read, page by page, for the pages that were used. */
export async function scanTexts(db: D1Database, docId: string): Promise<{ page: number; text: string; status: OcrStatus }[]> {
  const rows = await db.prepare("SELECT page, text, status FROM doc_ocr WHERE doc_id = ?1 AND status IN ('ok', 'warn') AND text IS NOT NULL ORDER BY page").bind(docId).all<{ page: number; text: string; status: OcrStatus }>();
  return rows.results;
}
