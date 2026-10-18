import { useSyncExternalStore } from "react";
import { MAX_CHARS_PER_BATCH, MAX_DOC_BYTES, MAX_DOC_PAGES, MAX_PAGES_PER_BATCH, type Answer, type AskStreamEvent, type DocumentInfo, type PageText } from "@scholar/shared";
import { readSse } from "./sse";
import { openPdf, pageText, renderCover, PdfError } from "./pdf";

/* ---------------------------------------------------------------- API client */

export class ApiError extends Error {
  constructor(readonly status: number, readonly type: string, title: string, readonly detail?: string) {
    super(detail ? `${title}. ${detail}` : title);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1/documents${path}`, { credentials: "same-origin", ...init });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { type?: string; title?: string; detail?: string } | null;
    throw new ApiError(res.status, j?.type ?? "error", j?.title ?? `The service answered ${res.status}`, j?.detail);
  }
  return (await res.json()) as T;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export type Usage = { count: number; maxCount: number; bytes: number; maxBytes: number };

export const fetchDocument = (id: string) => request<{ document: DocumentInfo; history: Answer[] }>(`/${id}`);
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

export async function removeDoc(id: string): Promise<void> {
  await request<{ ok: true }>(`/${id}`, { method: "DELETE" });
  setDocs({ items: docs.items.filter((d) => d.id !== id) });
  void loadDocs();
}

/* ---------------------------------------------------------------- ingest jobs (read -> upload -> index) */

export type JobStep = "reading" | "uploading" | "indexing" | "done" | "error";
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
  emitJobs();
}

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

async function indexPages(key: string, docId: string, pages: PageText[]): Promise<DocumentInfo> {
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
  return (await request<{ document: DocumentInfo }>(`/${docId}/finish`, json("POST", { pages: pages.length }))).document;
}

async function readPages(key: string, pdf: Awaited<ReturnType<typeof openPdf>>): Promise<PageText[]> {
  const pages: PageText[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    patchJob(key, { step: "reading", progress: (n - 1) / pdf.numPages, detail: `Reading page ${n} of ${pdf.numPages}` });
    const page = await pdf.getPage(n);
    pages.push({ page: n, text: await pageText(page) });
    page.cleanup();
  }
  return pages;
}

function finishJob(key: string, doc: DocumentInfo) {
  retained.delete(key);
  if (doc.status === "ready") {
    patchJob(key, { step: "done", progress: 1, detail: `${doc.pages ?? ""} pages indexed`.trim(), docId: doc.id });
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
    const pages = await readPages(key, pdf);
    const cover = await renderCover(pdf);
    void pdf.loadingTask.destroy();

    patchJob(key, { step: "uploading", progress: 0, detail: `Uploading ${mb(file.size)}` });
    const doc = await uploadFile(file, (f) => patchJob(key, { progress: f }));
    retained.set(key, { docId: doc.id, pages });
    patchJob(key, { docId: doc.id });
    if (cover) await request(`/${doc.id}/cover`, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: cover }).catch(() => {});

    finishJob(key, await indexPages(key, doc.id, pages));
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
    const pages = await readPages(key, pdf);
    void pdf.loadingTask.destroy();
    retained.set(key, { docId: doc.id, pages });
    finishJob(key, await indexPages(key, doc.id, pages));
  } catch (e) {
    patchJob(key, { step: "error", error: friendly(e), retryable: retained.has(key) });
  }
}
