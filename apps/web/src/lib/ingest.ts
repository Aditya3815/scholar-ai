import {
  IDEMPOTENCY_HEADER, MAX_CHARS_PER_BATCH, MAX_DOC_BYTES, MAX_DOC_PAGES, MAX_PAGES_PER_BATCH, analyzePaper, analyzeScan, isScanned, mergeScanInfo, needsReading,
  type DocumentInfo, type Line, type PageText, type PaperInfo,
} from "@scholar/shared";
import { ApiError, api, problemError } from "./api/client";
import { retry, type RetryPolicy } from "./api/retry";
import { DOCS, dismissJob, fetchDocument, fileUrl, loadDocs, patchJob, reindexDoc, retained, savePaperInfo, scanControllers } from "./documents";
import { openPdf, readOutline, readPage, renderCover, PdfError, type PDFDocumentProxy } from "./pdf";
import { fetchScan, fetchScanText, readScannedPages, registerScan } from "./scan";

/**
 * Adding a paper (read, upload, index) and reading a scanned one's pictures: the work behind documents.ts's startUpload, retryJob, reindexDoc and continueScan, which put each job
 * on screen and fetch this module when it is wanted. It brings the PDF reader, the scan reader and the retries with it, none of which the first load needs.
 */

const friendly = (e: unknown): string => {
  if (e instanceof PdfError || e instanceof ApiError) return e.message;
  if (e instanceof TypeError) return "The connection was lost. Check your internet and try again.";
  return e instanceof Error ? e.message : "Something went wrong.";
};

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n > 10 * 1024 * 1024 ? 0 : 1)} MB`;

/** A random key for one upload. It is sent again, unchanged, if the upload is tried again, so a reply that never arrived cannot make the server store the paper twice. */
const newIdempotencyKey = () => crypto.randomUUID();

/** The upload: a lost connection, or a first try the server is still finishing, is tried again with the same key; three tries in all, 900 and 1800 ms apart. */
const UPLOAD_RETRY: RetryPolicy = { tries: 3, delayMs: (attempt) => 900 * attempt, again: (e) => e instanceof TypeError || (e instanceof ApiError && e.type === "idempotency_in_progress") };
/** A batch of pages: one more try after 900 ms for a hiccup (a lost connection, a 5xx, a 429), none for a refusal (another 4xx). */
const INDEX_RETRY: RetryPolicy = { tries: 2, delayMs: () => 900, again: (e) => !(e instanceof ApiError && e.status < 500 && e.status !== 429) };

/** POST the file with upload progress (fetch cannot report it). */
function uploadFile(file: File, idempotencyKey: string, onProgress: (f: number) => void): Promise<DocumentInfo> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", DOCS);
    x.withCredentials = true;
    x.setRequestHeader("Content-Type", "application/pdf");
    x.setRequestHeader("X-Filename", encodeURIComponent(file.name));
    x.setRequestHeader(IDEMPOTENCY_HEADER, idempotencyKey);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onerror = () => reject(new TypeError("network"));
    x.onload = () => {
      let body: { document?: DocumentInfo } | null = null;
      try {
        body = JSON.parse(x.responseText);
      } catch { /* non-JSON error page */ }
      if (x.status === 201 && body?.document) resolve(body.document);
      else reject(problemError(x.status, body, `The upload failed (${x.status})`));
    };
    x.send(file);
  });
}

/** Group pages into requests the server accepts (at most 10 pages and 150k characters each). */
export function batches(pages: PageText[]): PageText[][] {
  const out: PageText[][] = [];
  let cur: PageText[] = [];
  let chars = 0;
  for (const p of pages) {
    if (cur.length > 0 && (cur.length >= MAX_PAGES_PER_BATCH || chars + p.text.length > MAX_CHARS_PER_BATCH)) {
      out.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push({ page: p.page, text: p.text.slice(0, 100_000) });
    chars += p.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

async function indexPages(key: string, docId: string, pages: PageText[], total = pages.length): Promise<DocumentInfo> {
  const groups = batches(pages);
  for (const [i, group] of groups.entries()) {
    patchJob(key, { step: "indexing", progress: i / groups.length, detail: `Indexing pages ${group[0]!.page}–${group.at(-1)!.page} of ${pages.length}` });
    await retry(INDEX_RETRY, () => api(`${DOCS}/${docId}/pages`, { method: "POST", json: { pages: group } }));
  }
  patchJob(key, { progress: 1, detail: "Finishing up" });
  return (await api<{ document: DocumentInfo }>(`${DOCS}/${docId}/finish`, { method: "POST", json: { pages: total } })).document;
}

/** Index the few pages of a scanned paper that do have text (the pictures are read separately). No "finish": the paper is ready when its pictures are read. */
async function indexTextPages(key: string, docId: string, pages: PageText[]): Promise<void> {
  for (const [i, group] of batches(pages).entries()) {
    patchJob(key, { step: "indexing", progress: i / Math.max(1, batches(pages).length), detail: `Indexing pages ${group[0]!.page}–${group.at(-1)!.page}` });
    await api(`${DOCS}/${docId}/pages`, { method: "POST", json: { pages: group } });
  }
}

async function readPages(key: string, pdf: Awaited<ReturnType<typeof openPdf>>): Promise<{ pages: PageText[]; info: PaperInfo }> {
  const pages: PageText[] = [];
  const lines: Line[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    patchJob(key, { step: "reading", progress: (n - 1) / pdf.numPages, detail: `Reading page ${n} of ${pdf.numPages}` });
    const page = await pdf.getPage(n);
    const read = await readPage(page);
    pages.push({ page: n, text: read.text });
    lines.push(...read.lines);
    page.cleanup();
  }
  patchJob(key, { detail: "Finding the title and references" });
  return { pages, info: analyzePaper({ lines, outline: await readOutline(pdf), pages: pdf.numPages }) };
}

/* ---------------------------------------------------------------- scanned papers: reading the page pictures */

/** After every page has been tried: the DOI and the references are looked for in what was read, and kept with the paper. */
async function saveScanInfo(docId: string, total: number, base: PaperInfo | null): Promise<void> {
  const found = analyzeScan(await fetchScanText(docId), total);
  const next = mergeScanInfo(base, found);
  // nothing new to say: do not overwrite what the server has (and so do not repeat the registry lookups)
  if (base && next.doi === base.doi && next.references.length === base.references.length) return;
  await savePaperInfo(docId, next).catch(() => null);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Registers the pages to read (the server keeps the list, so this can stop and go on later), reads them, and ends the job in the right state:
 * ready, or paused with a plain reason (today's limit, the reader's own stop, the service not answering).
 */
async function scanPdf(key: string, docId: string, pdf: PDFDocumentProxy, scanPages: number[], base: PaperInfo | null): Promise<void> {
  patchJob(key, { step: "scanning", scanned: true, progress: 0, detail: "Getting the pages ready", retryable: false });
  const registered = await registerScan(docId, pdf.numPages, scanPages);
  const todo = registered.scan?.pending ?? [];
  const total = Math.max(1, registered.scan?.pages ?? todo.length);
  let doc = registered.document;
  if (todo.length > 0) {
    const ctl = new AbortController();
    scanControllers.set(key, ctl);
    patchJob(key, { progress: (total - todo.length) / total, detail: `Reading ${plural(todo.length, "page")}…` });
    const end = await readScannedPages({
      docId, pdf, pages: todo, signal: ctl.signal,
      onPage: (_r, document, left) => {
        doc = document;
        patchJob(key, { progress: (total - left) / total, detail: `Read ${total - left} of ${plural(total, "page")} (the models check each other)` });
        void loadDocs();
      },
    });
    scanControllers.delete(key);
    if (end.document) doc = end.document;
    if (end.reason !== "done" || end.left.length > 0) {
      // the server's count: pages that were already on their way when the reading stopped are finished by it
      const latest = await fetchScan(docId).catch(() => null);
      const leftPages = latest ? latest.pending : end.left;
      const left = plural(leftPages.length, "page");
      const detail =
        end.reason === "limit" ? `Today's limit for reading scanned pages is used. ${left} left: continue tomorrow, what is read is kept.`
        : end.reason === "paused" ? `Paused. ${left} left to read.`
        : end.reason === "signin" ? "You were signed out. Sign in again to continue; what is read is kept."
        : end.reason === "unavailable" ? `The reading service did not answer. ${left} left; try again in a few minutes. What is read is kept.`
        : `${left} could not be read just now. Continue to try them again.`;
      patchJob(key, { step: end.reason === "signin" ? "error" : "paused", progress: (total - leftPages.length) / total, detail, error: end.reason === "signin" ? detail : undefined, retryable: false, docId });
      void loadDocs();
      return;
    }
  }
  await saveScanInfo(docId, pdf.numPages, base).catch(() => {});
  doc = (await fetchDocument(docId)).document;
  finishJob(key, doc);
}

function finishJob(key: string, doc: DocumentInfo) {
  retained.delete(key);
  if (doc.status === "ready") {
    patchJob(key, { step: "done", progress: 1, detail: doc.scanned ? `${doc.pages ?? ""} pages read from the scan`.trim() : `${doc.pages ?? ""} pages indexed`.trim(), docId: doc.id });
    window.setTimeout(() => dismissJob(key), 1600);
  } else {
    patchJob(key, { step: "error", error: doc.error ?? "Indexing did not finish.", retryable: false, docId: doc.id });
  }
  void loadDocs();
}

/** startUpload's work (its job is on screen already). */
export async function upload(key: string, file: File): Promise<void> {
  try {
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") throw new PdfError("Only PDF files can be uploaded.", "invalid");
    if (file.size > MAX_DOC_BYTES) throw new PdfError(`This PDF is ${mb(file.size)}. The limit is ${mb(MAX_DOC_BYTES)}.`, "invalid");
    if (file.size === 0) throw new PdfError("This file is empty.", "invalid");

    const pdf = await openPdf({ data: await file.arrayBuffer() });
    if (pdf.numPages > MAX_DOC_PAGES) throw new PdfError(`This PDF has ${pdf.numPages} pages. The limit is ${MAX_DOC_PAGES}.`, "invalid");
    const { pages, info } = await readPages(key, pdf);
    const cover = await renderCover(pdf);
    const scanned = isScanned(pages.map((p) => p.text.length));
    if (!scanned) void pdf.loadingTask.destroy();

    patchJob(key, { step: "uploading", progress: 0, detail: `Uploading ${mb(file.size)}`, scanned });
    // A lost connection, or a first try the server is still finishing, is tried again with the same key (at most three tries): the server stores the paper once.
    const idem = newIdempotencyKey();
    const doc = await retry(UPLOAD_RETRY, () => uploadFile(file, idem, (f) => patchJob(key, { progress: f })), () => patchJob(key, { progress: 0, detail: "The connection was lost. Trying again" }));
    patchJob(key, { docId: doc.id });
    if (cover) await api(`${DOCS}/${doc.id}/cover`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: cover }).catch(() => {});

    if (scanned) {
      // A paper of page pictures: the pages with some text are indexed as usual, the others are read from their pictures (and never refused as "no text").
      try {
        const withText = pages.filter((p) => !needsReading(p.text.length));
        if (withText.length > 0) await indexTextPages(key, doc.id, withText);
        await scanPdf(key, doc.id, pdf, pages.filter((p) => needsReading(p.text.length)).map((p) => p.page), info);
      } finally {
        void pdf.loadingTask.destroy();
      }
      return;
    }
    retained.set(key, { docId: doc.id, pages });

    // The registry lookups behind this can take a few seconds, so it runs alongside indexing. It is a bonus: never a reason to fail.
    const saved = savePaperInfo(doc.id, info).catch(() => null);
    const indexed = await indexPages(key, doc.id, pages);
    await saved;
    finishJob(key, indexed);
  } catch (e) {
    patchJob(key, { step: "error", error: friendly(e), retryable: retained.has(key) });
    if (retained.has(key)) void loadDocs();
  }
}

/** retryJob's work: indexing again from the pages kept in this tab. */
export async function indexAgain(key: string): Promise<void> {
  const kept = retained.get(key);
  if (!kept) return;
  try {
    finishJob(key, await indexPages(key, kept.docId, kept.pages));
  } catch (e) {
    patchJob(key, { step: "error", error: friendly(e), retryable: true });
  }
}

/** reindexDoc's work (its job is on screen already). */
export async function reindex(key: string, doc: DocumentInfo): Promise<void> {
  try {
    const pdf = await openPdf({ url: fileUrl(doc.id) });
    const { pages, info } = await readPages(key, pdf);
    if (isScanned(pages.map((p) => p.text.length))) {
      // what has been read stays: the server keeps the list of pages and only the ones still to be read are read
      try {
        patchJob(key, { scanned: true });
        const withText = pages.filter((p) => !needsReading(p.text.length));
        if (withText.length > 0) await indexTextPages(key, doc.id, withText);
        const server = await fetchDocument(doc.id).catch(() => null);
        await scanPdf(key, doc.id, pdf, pages.filter((p) => needsReading(p.text.length)).map((p) => p.page), server?.info ?? info);
      } finally {
        void pdf.loadingTask.destroy();
      }
      return;
    }
    void pdf.loadingTask.destroy();
    retained.set(key, { docId: doc.id, pages });
    const saved = savePaperInfo(doc.id, info).catch(() => null);
    const indexed = await indexPages(key, doc.id, pages);
    await saved;
    finishJob(key, indexed);
  } catch (e) {
    patchJob(key, { step: "error", error: friendly(e), retryable: retained.has(key) });
  }
}

/** continueScan's work (its job is on screen already). */
export async function continueReading(key: string, doc: Pick<DocumentInfo, "id" | "filename" | "sizeBytes">): Promise<void> {
  let pdf: PDFDocumentProxy | null = null;
  try {
    const [opened, server, scan] = await Promise.all([openPdf({ url: fileUrl(doc.id) }), fetchDocument(doc.id), fetchScan(doc.id)]);
    pdf = opened;
    if (!scan) {
      // never registered as a scan (the upload stopped before that): read it as a new paper
      dismissJob(key);
      return void reindexDoc(server.document);
    }
    const list = scan.pending;
    await scanPdf(key, doc.id, pdf, list.length > 0 ? list : scan.items.map((i) => i.page), server.info);
  } catch (e) {
    patchJob(key, { step: "error", error: friendly(e), retryable: false });
  } finally {
    void pdf?.loadingTask.destroy();
  }
}
