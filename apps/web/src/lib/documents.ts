import { useSyncExternalStore } from "react";
import {
  MAX_CHARS_PER_BATCH, MAX_DOC_BYTES, MAX_DOC_PAGES, MAX_PAGES_PER_BATCH, analyzePaper, analyzeScan, isScanned, mergeScanInfo, needsReading,
  type Answer, type AskStreamEvent, type DocumentInfo, type Line, type PageText, type PaperInfo, type ReadState, type ScanInfo,
} from "@scholar/shared";
import { readSse } from "./sse";
import { openPdf, readOutline, readPage, renderCover, PdfError, type PDFDocumentProxy } from "./pdf";
import { ApiError, json, request } from "./docs-api";
import { fetchScan, fetchScanText, readScannedPages, registerScan } from "./scan";

export { ApiError };

/* ---------------------------------------------------------------- API client */

export type Usage = { count: number; maxCount: number; bytes: number; maxBytes: number };

export const fetchDocument = (id: string) => request<{ document: DocumentInfo; history: Answer[]; info: PaperInfo | null; scan: ScanInfo | null }>(`/${id}`);

/** Store what was learned from reading the PDF; the server adds registry metadata and may give the paper its real title. */
export const savePaperInfo = (id: string, info: PaperInfo) => request<{ document: DocumentInfo; info: PaperInfo }>(`/${id}/info`, json("PUT", info));
export const askDocument = (id: string, question: string) => request<{ answer: Answer }>(`/${id}/ask`, json("POST", { question })).then((r) => r.answer);
/**
 * Ask with progress: `onEvent` gets the stages, the pages being read, the answer text as it is written, and finally the verified
 * answer. Resolves with that answer; rejects with an ApiError (or an AbortError if `signal` aborts).
 */
export async function askDocumentStream(id: string, question: string, onEvent: (e: AskStreamEvent) => void, signal?: AbortSignal): Promise<Answer> {
  const res = await fetch(`/api/v1/documents/${id}/ask?stream=1`, { ...json("POST", { question }), credentials: "same-origin", signal });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { type?: string; title?: string; detail?: string } | null;
    throw new ApiError(res.status, j?.type ?? "error", j?.title ?? `The service answered ${res.status}`, j?.detail);
  }
  let answer: Answer | null = null;
  let failure: ApiError | null = null;
  await readSse<AskStreamEvent>(
    res,
    (e) => {
      if (e.type === "answer") answer = e.answer;
      else if (e.type === "error") failure = new ApiError(res.status, e.code, e.title, e.detail);
      onEvent(e);
    },
    signal,
  );
  if (failure) throw failure;
  if (!answer) throw new TypeError("The answer was cut off. Please try again.");
  return answer;
}

export const coverUrl = (d: Pick<DocumentInfo, "id" | "updatedAt">) => `/api/v1/documents/${d.id}/cover?v=${d.updatedAt}`;
export const fileUrl = (id: string) => `/api/v1/documents/${id}/file`;

/* ---------------------------------------------------------------- list store */

export type DocsState = { status: "idle" | "loading" | "ready" | "error"; items: DocumentInfo[]; usage: Usage | null; error: string | null };
let docs: DocsState = { status: "idle", items: [], usage: null, error: null };
const docListeners = new Set<() => void>();
const setDocs = (next: Partial<DocsState>) => {
  docs = { ...docs, ...next };
  docListeners.forEach((l) => l());
};
export const useDocs = (): DocsState =>
  useSyncExternalStore(
    (l) => {
      docListeners.add(l);
      return () => docListeners.delete(l);
    },
    () => docs,
    () => docs,
  );

export async function loadDocs(): Promise<void> {
  setDocs({ status: docs.status === "ready" ? "ready" : "loading", error: null });
  try {
    const r = await request<{ items: DocumentInfo[]; usage: Usage }>("");
    setDocs({ status: "ready", items: r.items, usage: r.usage });
  } catch (e) {
    setDocs({ status: "error", error: e instanceof Error ? e.message : "Could not load your papers" });
  }
}

export function resetDocs() {
  setDocs({ status: "idle", items: [], usage: null, error: null });
}

export async function renameDoc(id: string, title: string): Promise<void> {
  const { document } = await request<{ document: DocumentInfo }>(`/${id}`, json("PATCH", { title }));
  setDocs({ items: docs.items.map((d) => (d.id === id ? document : d)) });
}

/** Reading status and tags (My Workspace). The server tidies the tags, so what comes back is what the card shows. */
export async function setMeta(id: string, change: { readState?: ReadState; tags?: string[] }): Promise<DocumentInfo> {
  const { document } = await request<{ document: DocumentInfo }>(`/${id}/meta`, json("PUT", change));
  setDocs({ items: docs.items.map((d) => (d.id === id ? document : d)) });
  return document;
}

/** Where the reader is. Fire and forget on purpose: a place that is not saved costs the reader nothing but a page. */
export function postProgress(id: string, page: number, keepalive = false): void {
  void request<{ document: DocumentInfo }>(`/${id}/progress`, { ...json("POST", { page }), keepalive })
    .then(({ document }) => setDocs({ items: docs.items.map((d) => (d.id === id ? document : d)) }))
    .catch(() => {});
}

export type WorkspaceHits = {
  papers: { docId: string; title: string }[];
  passages: { docId: string; title: string; page: number; snippet: string }[];
  highlights: { docId: string; title: string; page: number; quote: string; note: string | null; color: string }[];
};
export const searchWorkspace = (q: string, signal?: AbortSignal) => request<WorkspaceHits>(`/search?q=${encodeURIComponent(q)}`, { signal });

export type Remembered = { docId: string; title: string; page: number; quote: string; note: string | null; color: string };
export const fetchRemember = (skip = 0) => request<{ highlight: Remembered | null; total: number }>(`/remember?skip=${skip}`);

export async function removeDoc(id: string): Promise<void> {
  await request<{ ok: true }>(`/${id}`, { method: "DELETE" });
  setDocs({ items: docs.items.filter((d) => d.id !== id) });
  void loadDocs();
}

/* ---------------------------------------------------------------- ingest jobs (read -> upload -> index) */

export type JobStep = "reading" | "uploading" | "indexing" | "scanning" | "paused" | "done" | "error";
export type Job = {
  key: string;
  name: string;
  size: number;
  step: JobStep;
  /** 0..1 within the current step */
  progress: number;
  detail: string;
  error?: string;
  docId?: string;
  /** what the user can do about an error */
  retryable: boolean;
  /** A paper of page pictures: its pages are read by models one by one (see scan.ts), which is a step of its own. */
  scanned?: boolean;
};

let jobs: Job[] = [];
const jobListeners = new Set<() => void>();
const emitJobs = () => jobListeners.forEach((l) => l());
const patchJob = (key: string, change: Partial<Job>) => {
  jobs = jobs.map((j) => (j.key === key ? { ...j, ...change } : j));
  emitJobs();
};
export const useJobs = (): Job[] =>
  useSyncExternalStore(
    (l) => {
      jobListeners.add(l);
      return () => jobListeners.delete(l);
    },
    () => jobs,
    () => jobs,
  );
export function dismissJob(key: string) {
  jobs = jobs.filter((j) => j.key !== key);
  retained.delete(key);
  scanControllers.get(key)?.abort();
  emitJobs();
}
/** Stops reading a scanned paper's pages (what was read is kept). */
export const pauseScan = (key: string) => scanControllers.get(key)?.abort();
const scanControllers = new Map<string, AbortController>();

/** Text of pages already read, kept only while a job is on screen so "Try again" does not re-read the PDF. */
const retained = new Map<string, { docId: string; pages: PageText[] }>();

const friendly = (e: unknown): string => {
  if (e instanceof PdfError || e instanceof ApiError) return e.message;
  if (e instanceof TypeError) return "The connection was lost. Check your internet and try again.";
  return e instanceof Error ? e.message : "Something went wrong.";
};

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n > 10 * 1024 * 1024 ? 0 : 1)} MB`;

/** POST the file with upload progress (fetch cannot report it). */
function uploadFile(file: File, onProgress: (f: number) => void): Promise<DocumentInfo> {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", "/api/v1/documents");
    x.withCredentials = true;
    x.setRequestHeader("Content-Type", "application/pdf");
    x.setRequestHeader("X-Filename", encodeURIComponent(file.name));
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onerror = () => reject(new TypeError("network"));
    x.onload = () => {
      let body: { document?: DocumentInfo; title?: string; detail?: string; type?: string } = {};
      try {
        body = JSON.parse(x.responseText);
      } catch { /* non-JSON error page */ }
      if (x.status === 201 && body.document) resolve(body.document);
      else reject(new ApiError(x.status, body.type ?? "error", body.title ?? `The upload failed (${x.status})`, body.detail));
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
    try {
      await request(`/${docId}/pages`, json("POST", { pages: group }));
    } catch (e) {
      if (e instanceof ApiError && e.status < 500 && e.status !== 429) throw e;
      await new Promise((r) => setTimeout(r, 900)); // one retry for a hiccup
      await request(`/${docId}/pages`, json("POST", { pages: group }));
    }
  }
  patchJob(key, { progress: 1, detail: "Finishing up" });
  return (await request<{ document: DocumentInfo }>(`/${docId}/finish`, json("POST", { pages: total }))).document;
}

/** Index the few pages of a scanned paper that do have text (the pictures are read separately). No "finish": the paper is ready when its pictures are read. */
async function indexTextPages(key: string, docId: string, pages: PageText[]): Promise<void> {
  for (const [i, group] of batches(pages).entries()) {
    patchJob(key, { step: "indexing", progress: i / Math.max(1, batches(pages).length), detail: `Indexing pages ${group[0]!.page}–${group.at(-1)!.page}` });
    await request(`/${docId}/pages`, json("POST", { pages: group }));
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

/** Upload a new paper: read it in the browser (nothing is guessed server-side), store it, then index its text. */
export async function startUpload(file: File): Promise<void> {
  const key = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  jobs = [...jobs, { key, name: file.name, size: file.size, step: "reading", progress: 0, detail: "Opening the PDF", retryable: false }];
  emitJobs();

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
    const doc = await uploadFile(file, (f) => patchJob(key, { progress: f }));
    patchJob(key, { docId: doc.id });
    if (cover) await request(`/${doc.id}/cover`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: cover }).catch(() => {});

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

/** Retry indexing after a failure, using the pages already read in this tab. */
export async function retryJob(key: string): Promise<void> {
  const kept = retained.get(key);
  if (!kept) return;
  patchJob(key, { step: "indexing", progress: 0, detail: "Trying again", error: undefined, retryable: false });
  try {
    finishJob(key, await indexPages(key, kept.docId, kept.pages));
  } catch (e) {
    patchJob(key, { step: "error", error: friendly(e), retryable: true });
  }
}

/** Re-read a stored paper from the server and index it again (a paper stuck as "indexing", or one that failed). */
export async function reindexDoc(doc: DocumentInfo): Promise<void> {
  const key = `re-${doc.id}-${Date.now()}`;
  jobs = [...jobs, { key, name: doc.filename, size: doc.sizeBytes, step: "reading", progress: 0, detail: "Opening the paper", retryable: false, docId: doc.id }];
  emitJobs();
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

/**
 * Carries on reading a scanned paper whose reading was stopped (the limit for the day, the reader's own stop, the tab was closed): opens the PDF again and
 * reads the pages that are still to be read. Nothing that was read is read, or counted, twice.
 */
export async function continueScan(doc: Pick<DocumentInfo, "id" | "filename" | "sizeBytes">): Promise<void> {
  const key = `scan-${doc.id}-${Date.now()}`;
  jobs = [...jobs.filter((j) => !(j.docId === doc.id && (j.step === "paused" || j.step === "error"))), { key, name: doc.filename, size: doc.sizeBytes, step: "scanning", progress: 0, detail: "Opening the paper", retryable: false, docId: doc.id, scanned: true }];
  emitJobs();
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
