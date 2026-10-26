import { Hono, type Context } from "hono";
import { d1KeyStore, readKey, runIdempotent } from "../idempotency";
import { sseStream } from "../sse";
import {
  MAX_CHARS_PER_BATCH,
  MAX_COVER_BYTES,
  MAX_DOCS_PER_USER,
  MAX_DOC_BYTES,
  INK_LIMITS,
  MAX_DOC_PAGES,
  MAX_TAGS_PER_DOC,
  READ_STATES,
  cleanLegend,
  checkInk,
  cleanTag,
  tagKey,
  type ReadState,
  MAX_NOTES_PER_DOC,
  MAX_NOTE_CHARS,
  OCR_MAX_IMAGE_BYTES,
  OCR_MAX_SIDE_PX,
  OCR_MIN_SIDE_PX,
  OCR_PAGES_PER_DAY,
  MAX_NOTE_QUOTE_CHARS,
  MIN_NOTE_QUOTE_CHARS,
  NOTE_COLORS,
  type DocNote,
  type NoteColor,
  MAX_PAGES_PER_BATCH,
  MAX_QUESTION_CHARS,
  MAX_TOTAL_DOC_BYTES,
  type Answer,
  type AskStreamEvent,
  type DocStatus,
  type DocumentInfo,
  type PaperInfo,
  PRIVACY_VERSION,
} from "@scholar/shared";
import { currentUser, sameOrigin } from "../auth/http";
import { answerAboutHighlights } from "./highlights-qa";
import { AllProvidersFailedError, NoRouteError, QuotaError, gatewayFromEnv } from "../llm";
import { fromSqliteTime } from "../library/validate";
import { cacheStore } from "../cache";
import { chunkPage } from "./chunk";
import { enrichPaperInfo, sanitizePaperInfo } from "./info";
import { hashEmbedder, workersAiEmbedder, type Embedder } from "./embed";
import { answerQuestion, answerQuestionStream, type Complete, type StoredChunk, type StreamComplete } from "./qa";
import { stubComplete, stubStream } from "./stub";
import { decodeVec, encodeVec } from "./vector";
import { readJpeg } from "../ocr/jpeg";
import { DailyLimitError, ReadFailedError, finishIfDone, readScanPage, registerScan, scanInfo, scanTexts } from "../ocr/process";
import { workersAiReader, type PageReader } from "../ocr/read";
import { stubReader } from "../ocr/stub";

type Bindings = {
  DB: D1Database;
  CACHE?: KVNamespace;
  FILES: R2Bucket;
  AI?: Ai;
  GEMINI_API_KEY?: string;
  CROSSREF_MAILTO: string;
  OPENALEX_API_KEY?: string;
  ENABLE_DEV_ROUTES?: string;
  /** "1" (with ENABLE_DEV_ROUTES) swaps the model and embeddings for deterministic stand-ins in local tests. */
  QA_STUB?: string;
  /** Pages of a scanned paper one person may have read per day (default OCR_PAGES_PER_DAY). */
  OCR_PAGES_PER_DAY?: string;
  /** Cost experiments only, with ENABLE_DEV_ROUTES (docs/spikes/R5-cost.md): passages shown to the model, and the model / thinking effort (read by llm/index.ts). */
  QA_TOP_K?: string;
  LLM_QA_MODEL?: string;
  LLM_REASONING?: string;
};
type Env = { Bindings: Bindings };
export const documentRoutes = new Hono<Env>();

documentRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

const deny = (c: Context<Env>, status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 502 | 503, type: string, title: string, detail?: string) =>
  c.json({ type, title, ...(detail ? { detail } : {}) }, status);

type Row = {
  id: string; user_id: string; title: string; filename: string; size_bytes: number; pages: number | null; status: DocStatus;
  error: string | null; has_cover: number; chunk_count: number; scanned: number; scan_pending: number; created_at: string; updated_at: string;
  read_state: ReadState; last_page: number | null; max_page: number | null; opened_at: string | null; tags: string | null;
};
const COLS =
  "id, user_id, title, filename, size_bytes, pages, status, error, has_cover, chunk_count, scanned, (SELECT COUNT(*) FROM doc_ocr o WHERE o.doc_id = documents.id AND o.status = 'pending') AS scan_pending, created_at, updated_at, read_state, last_page, max_page, opened_at, (SELECT group_concat(label, char(31)) FROM (SELECT label FROM doc_tags WHERE doc_id = documents.id ORDER BY label COLLATE NOCASE)) AS tags";

const toInfo = (r: Row): DocumentInfo => ({
  id: r.id, title: r.title, filename: r.filename, sizeBytes: r.size_bytes, pages: r.pages, status: r.status, error: r.error,
  hasCover: r.has_cover === 1, chunkCount: r.chunk_count, scanned: r.scanned === 1, scanPending: r.scan_pending, createdAt: fromSqliteTime(r.created_at), updatedAt: fromSqliteTime(r.updated_at),
  readState: r.read_state, lastPage: r.last_page, maxPage: r.max_page, openedAt: r.opened_at ? fromSqliteTime(r.opened_at) : null, tags: r.tags ? r.tags.split("\u001f") : [],
});

const randomId = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
export const pdfKey = (userId: string, id: string) => `docs/${userId}/${id}.pdf`;
export const coverKey = (userId: string, id: string) => `docs/${userId}/${id}.cover.jpg`;

/** Strip any path, control characters and quotes; the name is only ever shown, never used as a storage key. */
export function safeFilename(raw: string | undefined | null): string {
  let name = "paper.pdf";
  try {
    name = decodeURIComponent(raw ?? "") || name;
  } catch { /* keep default */ }
  name = name.split(/[\\/]/).pop()!.replace(/[\u0000-\u001f"<>|:*?]/g, "").trim().slice(0, 150);
  return name || "paper.pdf";
}
const titleFrom = (filename: string) => filename.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").trim().slice(0, 200) || "Untitled paper";

async function owned(c: Context<Env>, userId: string, id: string): Promise<Row | null> {
  return c.env.DB.prepare(`SELECT ${COLS} FROM documents WHERE id = ?1 AND user_id = ?2`).bind(id, userId).first<Row>();
}

const stubbed = (env: Bindings) => env.ENABLE_DEV_ROUTES === "1" && env.QA_STUB === "1";
const readerFor = (env: Bindings): PageReader | null => (stubbed(env) ? stubReader : env.AI ? workersAiReader(env.AI) : null);
/** Pages per person per day. A value that is not a whole number from 1 to 2000 is ignored (the default is used), so a typo cannot switch the limit off. */
export function ocrPerDay(env: Pick<Bindings, "OCR_PAGES_PER_DAY">): number {
  const n = Number(env.OCR_PAGES_PER_DAY);
  return Number.isInteger(n) && n >= 1 && n <= 2000 ? n : OCR_PAGES_PER_DAY;
}

/** Dev-only: passages per question for the cost experiments. Undefined (the default of 6) everywhere else. */
const devTopK = (env: Bindings): number | undefined => {
  const n = Number(env.QA_TOP_K);
  return env.ENABLE_DEV_ROUTES === "1" && Number.isInteger(n) && n >= 1 && n <= 12 ? n : undefined;
};

const embedderFor = (env: Bindings): Embedder | null =>
  env.ENABLE_DEV_ROUTES === "1" && env.QA_STUB === "1" ? hashEmbedder : env.AI ? workersAiEmbedder(env.AI) : null;

function completeFor(env: Bindings, subject: string): Complete | null {
  if (env.ENABLE_DEV_ROUTES === "1" && env.QA_STUB === "1") return stubComplete;
  const gateway = gatewayFromEnv(env);
  return async (req) => {
    // An uploaded paper and the questions about it are PRIVATE: the gateway will only use privacy-safe providers.
    const r = await gateway.complete({ task: "qa", sensitivity: "private", subject, system: req.system, user: req.user, schema: req.schema, maxTokens: req.maxTokens, label: req.label });
    return { json: r.json, model: r.model };
  };
}

function streamFor(env: Bindings, subject: string, abort: AbortSignal): StreamComplete | null {
  if (env.ENABLE_DEV_ROUTES === "1" && env.QA_STUB === "1") return stubStream;
  const gateway = gatewayFromEnv(env);
  return async (req, hooks) => {
    // Same PRIVATE route, same quota and ledger as the non-streaming call; `abort` stops the model when the reader leaves.
    const r = await gateway.stream({ task: "qa", sensitivity: "private", subject, system: req.system, user: req.user, schema: req.schema, maxTokens: req.maxTokens, label: req.label }, hooks, abort);
    return { json: r.json, model: r.model };
  };
}

/** One place that turns a failure into what the browser is told (as an HTTP error, or as a stream `error` event). */
function describeAskError(e: unknown): { status: 429 | 502 | 503; code: string; title: string; detail?: string } | null {
  if (e instanceof QuotaError) return { status: 429, code: "quota", title: "You have used today's AI allowance", detail: e.message };
  if (e instanceof NoRouteError) return { status: 503, code: "ai_unavailable", title: "Answering is unavailable right now" };
  if (e instanceof AllProvidersFailedError) {
    console.error(JSON.stringify({ level: "error", msg: "qa_failed", attempts: e.attempts.map((a) => `${a.provider}:${a.ok ? "ok" : a.error}`) }));
    return { status: 502, code: "ai_failed", title: "The AI service could not answer just now", detail: "Please try again in a moment." };
  }
  return null;
}

/* ---------------------------------------------------------------- list / read */

documentRoutes.get("/", async (c) => {
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in to use your papers");
  const rows = await c.env.DB.prepare(`SELECT ${COLS} FROM documents WHERE user_id = ?1 ORDER BY created_at DESC, rowid DESC`).bind(user.id).all<Row>();
  const used = rows.results.reduce((n, r) => n + r.size_bytes, 0);
  return c.json({ items: rows.results.map(toInfo), usage: { count: rows.results.length, maxCount: MAX_DOCS_PER_USER, bytes: used, maxBytes: MAX_TOTAL_DOC_BYTES } });
});

/* these two are before "/:id" on purpose: a path segment "search" or "remember" must not be taken for a paper id */
const likeWord = (w: string) => `%${w.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
/** The words of a search (at least two characters, at most six, lower case). */
export const searchWords = (q: string): string[] => [...new Set(q.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{M}\p{N}]+/u).filter((w) => w.length >= 2))].slice(0, 6);
const snippet = (text: string, words: string[], len = 220): string => {
  const flat = text.replace(/\s+/g, " ");
  const at = Math.min(...words.map((w) => { const i = flat.toLowerCase().indexOf(w); return i < 0 ? Infinity : i; }));
  const from = Math.max(0, (Number.isFinite(at) ? at : 0) - 70);
  return (from > 0 ? "\u2026" : "") + flat.slice(from, from + len) + (from + len < flat.length ? "\u2026" : "");
};

/** Search across everything of one person's: paper titles and tags, the passages of the papers, highlights and notes. Words must all be present; nothing leaves the database. */
documentRoutes.get("/search", async (c) => {
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const q = (c.req.query("q") ?? "").slice(0, 200);
  const words = searchWords(q);
  if (words.length === 0) return c.json({ q, papers: [], passages: [], highlights: [] });
  const cond = (cols: string[]) => words.map((_, i) => `(${cols.map((col) => `${col} LIKE ?${i + 2} ESCAPE '\\'`).join(" OR ")})`).join(" AND ");
  const binds = (extra: unknown[] = []) => [user.id, ...words.map(likeWord), ...extra];
  const [papers, passages, highlights] = await Promise.all([
    c.env.DB.prepare(`SELECT d.id, d.title FROM documents d WHERE d.user_id = ?1 AND (${words.map((_, i) => `(d.title LIKE ?${i + 2} ESCAPE '\\' OR EXISTS (SELECT 1 FROM doc_tags g WHERE g.doc_id = d.id AND g.label LIKE ?${i + 2} ESCAPE '\\'))`).join(" AND ")}) ORDER BY d.created_at DESC LIMIT 20`).bind(...binds()).all<{ id: string; title: string }>(),
    c.env.DB.prepare(`SELECT c.doc_id, d.title, c.page, c.text FROM doc_chunks c JOIN documents d ON d.id = c.doc_id WHERE d.user_id = ?1 AND ${cond(["c.text"])} ORDER BY d.created_at DESC, c.idx LIMIT 40`).bind(...binds()).all<{ doc_id: string; title: string; page: number; text: string }>(),
    c.env.DB.prepare(`SELECT n.doc_id, d.title, n.page, n.quote, n.note, n.color FROM doc_notes n JOIN documents d ON d.id = n.doc_id WHERE d.user_id = ?1 AND ${cond(["n.quote", "n.note"])} ORDER BY d.created_at DESC, n.page LIMIT 40`).bind(...binds()).all<{ doc_id: string; title: string; page: number; quote: string; note: string | null; color: string }>(),
  ]);
  return c.json({
    q,
    papers: papers.results.map((r) => ({ docId: r.id, title: r.title })),
    passages: passages.results.slice(0, 20).map((r) => ({ docId: r.doc_id, title: r.title, page: r.page, snippet: snippet(r.text, words) })),
    highlights: highlights.results.slice(0, 20).map((r) => ({ docId: r.doc_id, title: r.title, page: r.page, quote: r.quote, note: r.note ?? "", color: r.color })),
  });
});

/** One of the person's own highlights for "Remember this?" on the home screen: the same one all day, another on `?skip=1`, `?skip=2`... Nothing is sent to anyone. */
documentRoutes.get("/remember", async (c) => {
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const rows = await c.env.DB.prepare("SELECT n.doc_id, d.title, n.page, n.quote, n.note, n.color FROM doc_notes n JOIN documents d ON d.id = n.doc_id WHERE d.user_id = ?1 AND length(n.quote) >= 40 ORDER BY n.id").bind(user.id).all<{ doc_id: string; title: string; page: number; quote: string; note: string | null; color: string }>();
  if (rows.results.length === 0) return c.json({ highlight: null, total: 0 });
  const skip = Math.max(0, Math.min(1000, Number(c.req.query("skip")) || 0));
  const day = Math.floor(Date.now() / 86_400_000);
  const pick = (day + skip) % rows.results.length;
  const r = rows.results[pick]!;
  return c.json({ highlight: { docId: r.doc_id, title: r.title, page: r.page, quote: r.quote, note: r.note ?? "", color: r.color }, total: rows.results.length });
});

documentRoutes.get("/:id", async (c) => {
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in to use your papers");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");
  const qa = await c.env.DB.prepare("SELECT answer FROM doc_qa WHERE doc_id = ?1 ORDER BY created_at, rowid LIMIT 100").bind(row.id).all<{ answer: string }>();
  const stored = await c.env.DB.prepare("SELECT info FROM documents WHERE id = ?1").bind(row.id).first<{ info: string | null }>();
  const scan = row.scanned === 1 ? await scanInfo(c.env.DB, user.id, row.id, ocrPerDay(c.env)) : null;
  return c.json({ document: toInfo(row), history: qa.results.map((r) => JSON.parse(r.answer) as Answer), info: stored?.info ? (JSON.parse(stored.info) as PaperInfo) : null, scan });
});

documentRoutes.get("/:id/file", async (c) => {
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in to use your papers");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");
  const obj = await c.env.FILES.get(pdfKey(user.id, row.id));
  if (!obj) return deny(c, 404, "not_found", "The file is missing");
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(obj.size),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

documentRoutes.get("/:id/cover", async (c) => {
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in to use your papers");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row || !row.has_cover) return deny(c, 404, "not_found", "No cover");
  const obj = await c.env.FILES.get(coverKey(user.id, row.id));
  if (!obj) return deny(c, 404, "not_found", "No cover");
  return new Response(obj.body, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
});

/* ---------------------------------------------------------------- upload */

documentRoutes.post("/", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in to upload papers");
  if (user.privacyAck !== PRIVACY_VERSION) return deny(c, 403, "privacy_ack_required", "Please read how your papers are handled first", "A short note appears before your first upload.");

  // A retry with the same Idempotency-Key (a reply that never arrived) returns the first result instead of storing the paper twice; see idempotency.ts.
  return runIdempotent(d1KeyStore(c.env.DB), { userId: user.id, route: "documents" }, readKey(c.req.header("Idempotency-Key")), `${c.req.header("content-length") ?? ""}:${c.req.header("x-filename") ?? ""}`, Date.now(), async () => {
    const declared = Number(c.req.header("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_DOC_BYTES) return deny(c, 413, "too_large", "That PDF is too large", `The limit is ${MAX_DOC_BYTES / 1024 / 1024} MB.`);

    const totals = await c.env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS bytes FROM documents WHERE user_id = ?1").bind(user.id).first<{ n: number; bytes: number }>();
    if ((totals?.n ?? 0) >= MAX_DOCS_PER_USER) return deny(c, 409, "library_full", "Your paper library is full", `You can keep ${MAX_DOCS_PER_USER} papers. Delete one to add another.`);

    const body = await c.req.arrayBuffer();
    if (body.byteLength > MAX_DOC_BYTES) return deny(c, 413, "too_large", "That PDF is too large", `The limit is ${MAX_DOC_BYTES / 1024 / 1024} MB.`);
    if ((totals?.bytes ?? 0) + body.byteLength > MAX_TOTAL_DOC_BYTES) return deny(c, 409, "storage_full", "Your storage is full", "Delete a paper to free up space.");
    // Magic bytes, not the Content-Type header, decide whether this is a PDF.
    const head = new TextDecoder().decode(new Uint8Array(body.slice(0, 1024)));
    if (!head.includes("%PDF-")) return deny(c, 415, "not_a_pdf", "That file is not a PDF");

    const id = randomId();
    const filename = safeFilename(c.req.header("x-filename"));
    await c.env.FILES.put(pdfKey(user.id, id), body, { httpMetadata: { contentType: "application/pdf" } });
    try {
      await c.env.DB.prepare("INSERT INTO documents (id, user_id, title, filename, size_bytes) VALUES (?1, ?2, ?3, ?4, ?5)").bind(id, user.id, titleFrom(filename), filename, body.byteLength).run();
    } catch (e) {
      await c.env.FILES.delete(pdfKey(user.id, id)).catch(() => {});
      throw e;
    }
    return c.json({ document: toInfo((await owned(c, user.id, id))!) }, 201);
  });
});

documentRoutes.put("/:id/cover", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");
  const img = await c.req.arrayBuffer();
  const b = new Uint8Array(img);
  if (img.byteLength > MAX_COVER_BYTES || b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return deny(c, 400, "invalid_cover", "The cover must be a JPEG under 300 KB");
  await c.env.FILES.put(coverKey(user.id, row.id), img, { httpMetadata: { contentType: "image/jpeg" } });
  await c.env.DB.prepare("UPDATE documents SET has_cover = 1, updated_at = datetime('now') WHERE id = ?1").bind(row.id).run();
  return c.json({ ok: true });
});

/**
 * The browser has read the PDF's title, DOI, outline and reference list; we keep them, add what the registries know about the DOI,
 * and, if the paper still has the title we made up from its file name, give it its real title.
 */
documentRoutes.put("/:id/info", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");
  const raw = await c.req.text();
  if (raw.length > 700_000) return deny(c, 413, "too_large", "That is too much to store");
  const clean = sanitizePaperInfo((() => { try { return JSON.parse(raw); } catch { return null; } })());
  if (!clean) return deny(c, 400, "invalid_info", "Could not read that information about the paper");

  const info = await enrichPaperInfo(clean, { ...c.env, store: cacheStore(c.env) });
  const renamed = row.title === titleFrom(row.filename) ? (info.metadata?.title ?? info.title)?.slice(0, 200) : undefined;
  await c.env.DB
    .prepare("UPDATE documents SET info = ?1, title = COALESCE(?2, title), updated_at = datetime('now') WHERE id = ?3")
    .bind(JSON.stringify(info), renamed ?? null, row.id)
    .run();
  return c.json({ document: toInfo((await owned(c, user.id, row.id))!), info });
});

documentRoutes.patch("/:id", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");
  const body = (await c.req.json().catch(() => null)) as { title?: unknown } | null;
  const title = typeof body?.title === "string" ? body.title.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  if (!title) return deny(c, 400, "invalid_title", "Give the paper a title");
  await c.env.DB.prepare("UPDATE documents SET title = ?1, updated_at = datetime('now') WHERE id = ?2").bind(title, row.id).run();
  return c.json({ document: toInfo((await owned(c, user.id, row.id))!) });
});

/** Deletes the PDF, its cover, its text and its question history. Irreversible. */
export async function deleteDocument(env: Pick<Bindings, "DB" | "FILES">, userId: string, id: string): Promise<void> {
  await Promise.all([env.FILES.delete(pdfKey(userId, id)), env.FILES.delete(coverKey(userId, id))]);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM doc_notes WHERE doc_id = ?1").bind(id),
    env.DB.prepare("DELETE FROM doc_ink WHERE doc_id = ?1").bind(id),
    env.DB.prepare("DELETE FROM doc_tags WHERE doc_id = ?1").bind(id),
    env.DB.prepare("DELETE FROM doc_qa WHERE doc_id = ?1").bind(id),
    env.DB.prepare("DELETE FROM doc_chunks WHERE doc_id = ?1").bind(id),
    env.DB.prepare("DELETE FROM doc_ocr WHERE doc_id = ?1").bind(id),
    env.DB.prepare("DELETE FROM documents WHERE id = ?1 AND user_id = ?2").bind(id, userId),
  ]);
}

documentRoutes.delete("/:id", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");
  await deleteDocument(c.env, user.id, row.id);
  return c.json({ ok: true });
});

/* ---------------------------------------------------------------- indexing (the browser reads the PDF; we chunk + embed) */

documentRoutes.post("/:id/pages", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");

  const body = (await c.req.json().catch(() => null)) as { pages?: unknown } | null;
  const pages = Array.isArray(body?.pages) ? body.pages : null;
  if (!pages || pages.length === 0 || pages.length > MAX_PAGES_PER_BATCH) return deny(c, 400, "invalid_pages", `Send 1 to ${MAX_PAGES_PER_BATCH} pages at a time`);
  const clean: { page: number; text: string }[] = [];
  let chars = 0;
  for (const p of pages) {
    const o = (p && typeof p === "object" ? p : {}) as { page?: unknown; text?: unknown };
    if (typeof o.page !== "number" || !Number.isInteger(o.page) || o.page < 1 || o.page > MAX_DOC_PAGES || typeof o.text !== "string") return deny(c, 400, "invalid_pages", "Each page needs a page number and text");
    chars += o.text.length;
    clean.push({ page: o.page, text: o.text });
  }
  if (chars > MAX_CHARS_PER_BATCH) return deny(c, 413, "too_large", "That batch of pages is too large");

  const embed = embedderFor(c.env);
  if (!embed) return deny(c, 503, "ai_unavailable", "Indexing is unavailable right now");

  const chunks = clean.flatMap((p) => chunkPage(p.page, p.text));
  let vectors: number[][] = [];
  if (chunks.length > 0) {
    try {
      vectors = await embed(chunks.map((ch) => ch.text));
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "embed_failed", error: e instanceof Error ? e.message : String(e) }));
      return deny(c, 502, "embedding_failed", "Could not index these pages", "Please try again.");
    }
  }

  const db = c.env.DB;
  const pageNumbers = clean.map((p) => p.page);
  // Multi-row INSERTs (19 rows x 5 values = 95 bound values, under D1's limit of 100 per statement) keep the number of queries
  // per request small: the free plan allows 50 per invocation.
  const ROWS = 19;
  const inserts: D1PreparedStatement[] = [];
  for (let i = 0; i < chunks.length; i += ROWS) {
    const part = chunks.slice(i, i + ROWS);
    inserts.push(
      db
        .prepare(`INSERT INTO doc_chunks (doc_id, idx, page, text, embedding) VALUES ${part.map(() => "(?, ?, ?, ?, ?)").join(",")}`)
        .bind(...part.flatMap((ch, k) => [row.id, ch.idx, ch.page, ch.text, encodeVec(vectors[i + k]!)])),
    );
  }
  const statements = [
    db.prepare(`DELETE FROM doc_chunks WHERE doc_id = ?1 AND page IN (${pageNumbers.map((_, i) => `?${i + 2}`).join(",")})`).bind(row.id, ...pageNumbers),
    ...inserts,
    db.prepare("UPDATE documents SET status = 'indexing', error = NULL, updated_at = datetime('now') WHERE id = ?1").bind(row.id),
  ];
  await db.batch(statements);
  return c.json({ ok: true, chunks: chunks.length });
});

documentRoutes.post("/:id/finish", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");
  const body = (await c.req.json().catch(() => null)) as { pages?: unknown; failed?: unknown } | null;
  const pages = typeof body?.pages === "number" && Number.isInteger(body.pages) && body.pages >= 1 && body.pages <= MAX_DOC_PAGES ? body.pages : null;

  const n = (await c.env.DB.prepare("SELECT COUNT(*) AS n FROM doc_chunks WHERE doc_id = ?1").bind(row.id).first<{ n: number }>())?.n ?? 0;
  const failed = typeof body?.failed === "string" ? body.failed.slice(0, 200) : null;
  const status: DocStatus = failed || n === 0 ? "failed" : "ready";
  const error = failed ?? (n === 0 ? "No readable text was found. This looks like a scanned PDF (page images). Upload a text-based PDF." : null);
  await c.env.DB.prepare("UPDATE documents SET status = ?1, error = ?2, pages = COALESCE(?3, pages), chunk_count = ?4, updated_at = datetime('now') WHERE id = ?5").bind(status, error, pages, n, row.id).run();
  return c.json({ document: toInfo((await owned(c, user.id, row.id))!) });
});

/* ---------------------------------------------------------------- scanned papers (docs/ocr.md) */

/**
 * The browser found that most pages of this PDF have no text, and says which pages have to be read from their pictures. The list is kept here, so reading
 * can be stopped and continued (also from another day, when the daily limit has been reached). Asking again keeps what has been read.
 */
documentRoutes.post("/:id/scan", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");
  const body = (await c.req.json().catch(() => null)) as { pages?: unknown; scanPages?: unknown } | null;
  const pages = body?.pages;
  const list = body?.scanPages;
  if (typeof pages !== "number" || !Number.isInteger(pages) || pages < 1 || pages > MAX_DOC_PAGES) return deny(c, 400, "invalid_scan", "The number of pages is not valid");
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_DOC_PAGES || list.some((p) => typeof p !== "number" || !Number.isInteger(p) || p < 1 || p > pages)) {
    return deny(c, 400, "invalid_scan", "List the pages that have to be read from their pictures");
  }
  const pending = await registerScan(c.env.DB, row.id, pages, list as number[]);
  if (pending === 0) await finishIfDone(c.env.DB, row.id);
  return c.json({ document: toInfo((await owned(c, user.id, row.id))!), scan: await scanInfo(c.env.DB, user.id, row.id, ocrPerDay(c.env)) });
});

documentRoutes.get("/:id/scan", async (c) => {
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");
  return c.json({ scan: await scanInfo(c.env.DB, user.id, row.id, ocrPerDay(c.env)) });
});

/** The text that was read from the scanned pages that were used (for the paper's title, DOI and reference list, and for showing what was read). */
documentRoutes.get("/:id/scan/text", async (c) => {
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");
  return c.json({ pages: await scanTexts(c.env.DB, row.id) });
});

/**
 * One page picture (a JPEG in the body) is read by two models and checked. `?blank=1` with no body = the browser saw nothing on the page. The picture is
 * not stored. The answer says how the page was read and, for a page that was used, what it says.
 */
documentRoutes.post("/:id/ocr", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");
  if (row.scanned !== 1) return deny(c, 409, "not_scanned", "This paper has a text layer, so nothing has to be read from pictures");
  const page = Number(c.req.query("page"));
  if (!Number.isInteger(page) || page < 1 || page > (row.pages ?? MAX_DOC_PAGES)) return deny(c, 400, "invalid_page", "That page is not in this paper");

  let image: { bytes: Uint8Array; comment: string | null } | null = null;
  if (c.req.query("blank") !== "1") {
    const declared = Number(c.req.header("content-length") ?? "");
    if (Number.isFinite(declared) && declared > OCR_MAX_IMAGE_BYTES) return deny(c, 413, "too_large", "That page picture is too large", "Pages are sent as a JPEG of about 150 dpi.");
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength > OCR_MAX_IMAGE_BYTES) return deny(c, 413, "too_large", "That page picture is too large", "Pages are sent as a JPEG of about 150 dpi.");
    const jpeg = readJpeg(bytes);
    if (!jpeg) return deny(c, 415, "not_a_jpeg", "A page has to be sent as a JPEG picture");
    const long = Math.max(jpeg.width, jpeg.height);
    if (long < OCR_MIN_SIDE_PX || long > OCR_MAX_SIDE_PX + 200 || jpeg.width * jpeg.height > 4_500_000) {
      return deny(c, 400, "invalid_image_size", "That page picture has an unusable size", `Send at most ${OCR_MAX_SIDE_PX} pixels on the long side.`);
    }
    image = { bytes, comment: jpeg.comment };
  }

  const reader = readerFor(c.env);
  const embed = embedderFor(c.env);
  if (!reader || !embed) return deny(c, 503, "ai_unavailable", "Reading scanned pages is unavailable right now");
  try {
    const result = await readScanPage({ db: c.env.DB, userId: user.id, docId: row.id, page, perDay: ocrPerDay(c.env), reader, embed, image });
    if (!result) return deny(c, 404, "not_found", "That page is not on the list of pages to read");
    return c.json({ result, document: toInfo((await owned(c, user.id, row.id))!) });
  } catch (e) {
    if (e instanceof DailyLimitError) {
      return deny(c, 429, "ocr_daily_limit", "Today's limit for reading scanned pages is used", `You can have ${e.perDay} scanned pages read per day. What has been read is kept: continue tomorrow.`);
    }
    if (e instanceof ReadFailedError) {
      console.error(JSON.stringify({ level: "error", msg: "ocr_failed", errors: e.errors }));
      return deny(c, 502, "ai_failed", "The page could not be read just now", "Please try again in a moment.");
    }
    throw e;
  }
});

/* ---------------------------------------------------------------- ask */

documentRoutes.post("/:id/ask", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");
  if (row.status !== "ready") return deny(c, 409, "not_ready", "This paper is not ready yet", row.status === "failed" ? row.error ?? undefined : "Wait until indexing finishes.");

  const body = (await c.req.json().catch(() => null)) as { question?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.replace(/\s+/g, " ").trim() : "";
  if (question.length < 3) return deny(c, 400, "invalid_question", "Ask a question about the paper");
  if (question.length > MAX_QUESTION_CHARS) return deny(c, 400, "invalid_question", "That question is too long", `Keep it under ${MAX_QUESTION_CHARS} characters.`);

  const embed = embedderFor(c.env);
  const complete = completeFor(c.env, user.id);
  if (!embed || !complete) return deny(c, 503, "ai_unavailable", "Answering is unavailable right now");

  const rows = await c.env.DB.prepare("SELECT idx, page, text, embedding FROM doc_chunks WHERE doc_id = ?1 ORDER BY idx").bind(row.id).all<{ idx: number; page: number; text: string; embedding: string | null }>();
  const chunks: StoredChunk[] = rows.results.map((r) => ({ idx: r.idx, page: r.page, text: r.text, embedding: r.embedding ? decodeVec(r.embedding) : null }));

  if (c.req.query("stream") === "1") {
    const abort = new AbortController();
    const stream = streamFor(c.env, user.id, abort.signal);
    if (!stream) return deny(c, 503, "ai_unavailable", "Answering is unavailable right now");
    return sseStream<AskStreamEvent>(c, { terminal: ["answer", "error"], fallback: { type: "error", code: "internal_error", title: "Something went wrong" }, abort }, async (sse) => {
      const send = sse.send;
      try {
        const answer = await answerQuestionStream({ question, chunks, embed, stream, meta: { id: randomId(), createdAt: Date.now() }, emit: send, topK: devTopK(c.env) });
        if (sse.gone) return; // the reader left: nothing to save or send
        await c.env.DB.prepare("INSERT INTO doc_qa (id, doc_id, question, answer) VALUES (?1, ?2, ?3, ?4)").bind(answer.id, row.id, question, JSON.stringify(answer)).run();
        await send({ type: "answer", answer });
      } catch (e) {
        const d = describeAskError(e);
        if (!d) console.error(JSON.stringify({ level: "error", msg: "qa_stream_failed", error: e instanceof Error ? e.name : "unknown" }));
        await send({ type: "error", code: d?.code ?? "internal_error", title: d?.title ?? "Something went wrong", detail: d?.detail });
      }
    });
  }

  let answer: Answer;
  try {
    answer = await answerQuestion({
      question, chunks, embed, complete, meta: { id: randomId(), createdAt: Date.now() }, topK: devTopK(c.env),
      // Only with the local dev switch: print what the model said and saw, to tune prompts. Never in production.
      onRaw: c.env.ENABLE_DEV_ROUTES === "1" ? (raw, ex) => console.log(JSON.stringify({ msg: "qa_debug", raw, excerpts: ex.map((e) => ({ page: e.page, text: e.text.slice(0, 160) })) })) : undefined,
    });
  } catch (e) {
    const d = describeAskError(e);
    if (d) return deny(c, d.status, d.code, d.title, d.detail);
    throw e;
  }
  await c.env.DB.prepare("INSERT INTO doc_qa (id, doc_id, question, answer) VALUES (?1, ?2, ?3, ?4)").bind(answer.id, row.id, question, JSON.stringify(answer)).run();
  return c.json({ answer });
});


/** A question about what the reader marked: the highlights are the passages, the answer's quotes are checked against them, and it is not added to the paper's question history. */
documentRoutes.post("/:id/ask-highlights", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");
  const body = (await c.req.json().catch(() => null)) as { question?: unknown; legend?: unknown } | null;
  const question = typeof body?.question === "string" ? body.question.replace(/\s+/g, " ").trim() : "";
  if (question.length < 3) return deny(c, 400, "invalid_question", "Ask a question about your highlights");
  if (question.length > MAX_QUESTION_CHARS) return deny(c, 400, "invalid_question", "That question is too long", `Keep it under ${MAX_QUESTION_CHARS} characters.`);
  const rows = await c.env.DB.prepare(`SELECT ${NOTE_COLS} FROM doc_notes WHERE doc_id = ?1 ORDER BY page, created_at, rowid LIMIT ?2`).bind(row.id, MAX_NOTES_PER_DOC).all<NoteRow>();
  if (rows.results.length === 0) return deny(c, 409, "no_highlights", "You have not highlighted anything in this paper yet", "Select text in the paper to highlight it, then ask about your highlights.");
  const complete = completeFor(c.env, user.id);
  if (!complete) return deny(c, 503, "ai_unavailable", "Answering is unavailable right now");
  try {
    const r = await answerAboutHighlights({ question, notes: rows.results.map(toNote), legend: cleanLegend(body?.legend), complete, meta: { id: randomId(), createdAt: Date.now() } });
    return c.json(r);
  } catch (e) {
    const d = describeAskError(e);
    if (d) return deny(c, d.status, d.code, d.title, d.detail);
    throw e;
  }
});

/* ---------------------------------------------------------------- My Workspace: status, tags, progress, search, "remember this" */

/** Reading status and tags (collections) of one paper. Tags are replaced as a set: the browser sends the whole list. */
documentRoutes.put("/:id/meta", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");
  const b = (await c.req.json().catch(() => null)) as { readState?: unknown; tags?: unknown } | null;
  if (!b || (b.readState === undefined && b.tags === undefined)) return deny(c, 400, "invalid_meta", "Nothing to change");
  const statements: D1PreparedStatement[] = [];
  if (b.readState !== undefined) {
    if (!READ_STATES.includes(b.readState as ReadState)) return deny(c, 400, "invalid_meta", "That is not a reading status");
    statements.push(c.env.DB.prepare("UPDATE documents SET read_state = ?2 WHERE id = ?1").bind(row.id, b.readState));
  }
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags) || b.tags.length > MAX_TAGS_PER_DOC * 3) return deny(c, 400, "invalid_meta", "Tags must be a short list");
    const seen = new Map<string, string>();
    for (const raw of b.tags) {
      const label = cleanTag(raw);
      if (!label) continue;
      if (!seen.has(tagKey(label))) seen.set(tagKey(label), label);
    }
    if (seen.size > MAX_TAGS_PER_DOC) return deny(c, 400, "too_many_tags", "A paper can have up to " + MAX_TAGS_PER_DOC + " tags");
    statements.push(c.env.DB.prepare("DELETE FROM doc_tags WHERE doc_id = ?1").bind(row.id));
    for (const [key, label] of seen) statements.push(c.env.DB.prepare("INSERT INTO doc_tags (doc_id, tag_key, label) VALUES (?1, ?2, ?3)").bind(row.id, key, label));
  }
  await c.env.DB.batch(statements);
  return c.json({ document: toInfo((await owned(c, user.id, row.id))!) });
});

/**
 * Where the reader is. Sent from the reader a couple of seconds after the page changes. The furthest page only ever grows; a paper that was "to read" becomes
 * "reading" once the reader is past its first page. "Done" is always the reader's own decision.
 */
documentRoutes.post("/:id/progress", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");
  const b = (await c.req.json().catch(() => null)) as { page?: unknown } | null;
  const limit = row.pages ?? MAX_DOC_PAGES;
  if (typeof b?.page !== "number" || !Number.isInteger(b.page) || b.page < 1 || b.page > limit) return deny(c, 400, "invalid_progress", "That page is not in this paper");
  await c.env.DB
    .prepare("UPDATE documents SET last_page = ?2, max_page = MAX(COALESCE(max_page, 0), ?2), opened_at = datetime('now'), read_state = CASE WHEN read_state = 'to_read' AND ?2 >= 2 THEN 'reading' ELSE read_state END WHERE id = ?1")
    .bind(row.id, b.page)
    .run();
  return c.json({ document: toInfo((await owned(c, user.id, row.id))!) });
});

/* ---------------------------------------------------------------- drawing: pen, highlighter, eraser (My Workspace) */

/** One paper's strokes are saved as a whole, with a revision, so two tabs cannot silently overwrite each other (the later one is told and shows the newer drawing). */
const INK_MAX_BODY = INK_LIMITS.bytes + 100_000;

documentRoutes.get("/:id/ink", async (c) => {
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");
  const ink = await c.env.DB.prepare("SELECT data, rev FROM doc_ink WHERE doc_id = ?1").bind(row.id).first<{ data: string; rev: number }>();
  return c.json({ strokes: ink ? (JSON.parse(ink.data) as unknown) : [], rev: ink?.rev ?? 0 });
});

documentRoutes.put("/:id/ink", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");
  const length = Number(c.req.header("content-length") ?? 0);
  if (length > INK_MAX_BODY) return deny(c, 413, "too_big", "There is too much drawing on this paper to save", "Erase some of it, or draw on a copy.");
  const text = await c.req.text().catch(() => "");
  if (text.length > INK_MAX_BODY) return deny(c, 413, "too_big", "There is too much drawing on this paper to save", "Erase some of it, or draw on a copy.");
  let body: { strokes?: unknown; rev?: unknown } | null = null;
  try {
    body = JSON.parse(text) as { strokes?: unknown; rev?: unknown };
  } catch {
    /* handled below */
  }
  if (!body || typeof body.rev !== "number" || !Number.isInteger(body.rev) || body.rev < 0) return deny(c, 400, "invalid_ink", "Nothing to save");
  const checked = checkInk(body.strokes, row.pages ?? MAX_DOC_PAGES);
  if (!checked.ok) return deny(c, checked.reason.startsWith("too") ? 413 : 400, "invalid_ink", "That drawing could not be saved", checked.reason);
  const data = JSON.stringify(checked.strokes);
  // first save: insert only if nobody saved before; later saves: only if the revision is the one the browser started from
  const res =
    body.rev === 0
      ? await c.env.DB.prepare("INSERT INTO doc_ink (doc_id, data, rev) VALUES (?1, ?2, 1) ON CONFLICT (doc_id) DO NOTHING").bind(row.id, data).run()
      : await c.env.DB.prepare("UPDATE doc_ink SET data = ?2, rev = rev + 1, updated_at = datetime('now') WHERE doc_id = ?1 AND rev = ?3").bind(row.id, data, body.rev).run();
  if ((res.meta.changes ?? 0) === 0) {
    const now = await c.env.DB.prepare("SELECT data, rev FROM doc_ink WHERE doc_id = ?1").bind(row.id).first<{ data: string; rev: number }>();
    return c.json({ type: "conflict", title: "This paper was drawn on in another window", strokes: now ? (JSON.parse(now.data) as unknown) : [], rev: now?.rev ?? 0 }, 409);
  }
  return c.json({ rev: body.rev + 1 });
});

/* ---------------------------------------------------------------- highlights and notes */

type NoteRow = { id: string; page: number; quote: string; note: string | null; color: NoteColor; created_at: string; updated_at: string };
const toNote = (r: NoteRow): DocNote => ({ id: r.id, page: r.page, quote: r.quote, note: r.note ?? "", color: r.color, createdAt: fromSqliteTime(r.created_at), updatedAt: fromSqliteTime(r.updated_at) });
const cleanText = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const NOTE_COLS = "id, page, quote, note, color, created_at, updated_at";

documentRoutes.get("/:id/notes", async (c) => {
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");
  const rows = await c.env.DB.prepare(`SELECT ${NOTE_COLS} FROM doc_notes WHERE doc_id = ?1 ORDER BY page, created_at, rowid`).bind(row.id).all<NoteRow>();
  return c.json({ items: rows.results.map(toNote), max: MAX_NOTES_PER_DOC });
});

documentRoutes.post("/:id/notes", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");
  const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const page = b?.page;
  const quote = cleanText(b?.quote, MAX_NOTE_QUOTE_CHARS);
  if (typeof page !== "number" || !Number.isInteger(page) || page < 1 || page > (row.pages ?? MAX_DOC_PAGES)) return deny(c, 400, "invalid_note", "That page is not in this paper");
  if (quote.length < MIN_NOTE_QUOTE_CHARS) return deny(c, 400, "invalid_note", "Select some text first");
  const color = NOTE_COLORS.includes(b?.color as NoteColor) ? (b!.color as NoteColor) : "yellow";
  const note = cleanText(b?.note, MAX_NOTE_CHARS);
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM doc_notes WHERE doc_id = ?1").bind(row.id).first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_NOTES_PER_DOC) return deny(c, 409, "notes_full", "This paper has as many notes as it can hold", `The limit is ${MAX_NOTES_PER_DOC}.`);
  const id = randomId();
  await c.env.DB.prepare("INSERT INTO doc_notes (id, doc_id, page, quote, note, color) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(id, row.id, page, quote, note || null, color).run();
  const saved = await c.env.DB.prepare(`SELECT ${NOTE_COLS} FROM doc_notes WHERE id = ?1`).bind(id).first<NoteRow>();
  return c.json({ note: toNote(saved!) }, 201);
});

documentRoutes.patch("/:id/notes/:nid", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");
  const existing = await c.env.DB.prepare(`SELECT ${NOTE_COLS} FROM doc_notes WHERE id = ?1 AND doc_id = ?2`).bind(c.req.param("nid"), row.id).first<NoteRow>();
  if (!existing) return deny(c, 404, "not_found", "Note not found");
  const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return deny(c, 400, "invalid_note", "Nothing to change");
  const note = "note" in b ? cleanText(b.note, MAX_NOTE_CHARS) : (existing.note ?? "");
  const color = NOTE_COLORS.includes(b.color as NoteColor) ? (b.color as NoteColor) : existing.color;
  await c.env.DB.prepare("UPDATE doc_notes SET note = ?2, color = ?3, updated_at = datetime('now') WHERE id = ?1").bind(existing.id, note || null, color).run();
  const saved = await c.env.DB.prepare(`SELECT ${NOTE_COLS} FROM doc_notes WHERE id = ?1`).bind(existing.id).first<NoteRow>();
  return c.json({ note: toNote(saved!) });
});

documentRoutes.delete("/:id/notes/:nid", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const row = await owned(c, user.id, c.req.param("id"));
  if (!row) return deny(c, 404, "not_found", "Paper not found");
  const r = await c.env.DB.prepare("DELETE FROM doc_notes WHERE id = ?1 AND doc_id = ?2").bind(c.req.param("nid"), row.id).run();
  if ((r.meta.changes ?? 0) === 0) return deny(c, 404, "not_found", "Note not found");
  return c.json({ ok: true });
});
