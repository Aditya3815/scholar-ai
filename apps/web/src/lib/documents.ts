import { useSyncExternalStore } from "react";
import type { Answer, AskStreamEvent, PaperAccess, DocumentInfo, Legend, PageText, PaperInfo, ReadState, ScanInfo } from "@scholar/shared";
import { api } from "./api/client";
import { postStream, streamResult } from "./api/stream";
import { removeCachedPaper } from "./offline";

/* ---------------------------------------------------------------- API client */

export type Usage = { count: number; maxCount: number; bytes: number; maxBytes: number };

export const DOCS = "/api/v1/documents";

/** `features.reader`: the new Paper Reader is on for this account (the server's READER switch; absent from an older server or a kept offline copy, which is today's reader). */
export const fetchDocument = (id: string) =>
  api<{ document: DocumentInfo; history: Answer[]; info: PaperInfo | null; scan: ScanInfo | null; features?: { reader?: boolean; share?: boolean; comments?: number; live?: boolean }; access?: PaperAccess }>(`${DOCS}/${id}`);

/** Store what was learned from reading the PDF; the server adds registry metadata and may give the paper its real title. */
export const savePaperInfo = (id: string, info: PaperInfo) => api<{ document: DocumentInfo; info: PaperInfo }>(`${DOCS}/${id}/info`, { method: "PUT", json: info });
/** A question about what the reader marked in this paper. `used` of `total` highlights were shown to the model (all of them unless there are very many). Not added to the paper's question history. */
export const askHighlights = (id: string, question: string, legend: Legend, signal?: AbortSignal) =>
  api<{ answer: Answer; used: number; total: number }>(`${DOCS}/${id}/ask-highlights`, { method: "POST", json: { question, legend }, signal });
/**
 * Ask with progress: `onEvent` gets the stages, the pages being read, the answer text as it is written, and finally the verified
 * answer. Resolves with that answer; rejects with an ApiError (or an AbortError if `signal` aborts).
 */
export async function askDocumentStream(id: string, question: string, onEvent: (e: AskStreamEvent) => void, signal?: AbortSignal): Promise<Answer> {
  const res = await postStream(`${DOCS}/${id}/ask?stream=1`, { question }, { signal });
  return streamResult<AskStreamEvent, Answer>(res, "answer", (e) => (e as Extract<AskStreamEvent, { type: "answer" }>).answer, "The answer was cut off. Please try again.", onEvent, signal);
}

export const coverUrl = (d: Pick<DocumentInfo, "id" | "updatedAt">) => `${DOCS}/${d.id}/cover?v=${d.updatedAt}`;
export const fileUrl = (id: string) => `${DOCS}/${id}/file`;

/* ---------------------------------------------------------------- list store */

export type DocsState = { status: "idle" | "loading" | "ready" | "error"; items: DocumentInfo[]; usage: Usage | null; error: string | null; /** papers others shared with this account (SHARE on; 0 otherwise) */ shared?: number };
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
    const r = await api<{ items: DocumentInfo[]; usage: Usage; sharedWithMe?: number }>(DOCS);
    setDocs({ status: "ready", items: r.items, usage: r.usage, shared: r.sharedWithMe ?? 0 });
  } catch (e) {
    setDocs({ status: "error", error: e instanceof Error ? e.message : "Could not load your papers" });
  }
}

export function resetDocs() {
  setDocs({ status: "idle", items: [], usage: null, error: null });
}

export async function renameDoc(id: string, title: string): Promise<void> {
  const { document } = await api<{ document: DocumentInfo }>(`${DOCS}/${id}`, { method: "PATCH", json: { title } });
  setDocs({ items: docs.items.map((d) => (d.id === id ? document : d)) });
}

/** Reading status and tags (My Workspace). The server tidies the tags, so what comes back is what the card shows. */
export async function setMeta(id: string, change: { readState?: ReadState; tags?: string[] }): Promise<DocumentInfo> {
  const { document } = await api<{ document: DocumentInfo }>(`${DOCS}/${id}/meta`, { method: "PUT", json: change });
  setDocs({ items: docs.items.map((d) => (d.id === id ? document : d)) });
  return document;
}

/** Where the reader is. Fire and forget on purpose: a place that is not saved costs the reader nothing but a page. */
export function postProgress(id: string, page: number, keepalive = false): void {
  void api<{ document: DocumentInfo }>(`${DOCS}/${id}/progress`, { method: "POST", json: { page }, keepalive })
    .then(({ document }) => setDocs({ items: docs.items.map((d) => (d.id === id ? document : d)) }))
    .catch(() => {});
}

export type WorkspaceHits = {
  papers: { docId: string; title: string }[];
  passages: { docId: string; title: string; page: number; snippet: string }[];
  highlights: { docId: string; title: string; page: number; quote: string; note: string | null; color: string }[];
};
export const searchWorkspace = (q: string, signal?: AbortSignal) => api<WorkspaceHits>(`${DOCS}/search?q=${encodeURIComponent(q)}`, { signal });

export type Remembered = { docId: string; title: string; page: number; quote: string; note: string | null; color: string };
export const fetchRemember = (skip = 0) => api<{ highlight: Remembered | null; total: number }>(`${DOCS}/remember?skip=${skip}`);

export async function removeDoc(id: string): Promise<void> {
  await api<{ ok: true }>(`${DOCS}/${id}`, { method: "DELETE" });
  void removeCachedPaper(id); // a deleted paper is not kept on this device either
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
/** Changes a job on screen (lib/ingest.ts reports its steps through it). */
export const patchJob = (key: string, change: Partial<Job>) => {
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
/** The stop of each scanned paper being read (lib/ingest.ts sets and clears them). */
export const scanControllers = new Map<string, AbortController>();

/** Text of pages already read, kept only while a job is on screen so "Try again" does not re-read the PDF. */
export const retained = new Map<string, { docId: string; pages: PageText[] }>();

/*
 * Reading, uploading and indexing a paper (lib/ingest.ts, with the PDF reader, the scan reader and the retries) is fetched when a paper is first added or read again, not with the
 * first load. Each job is on screen at once, before that code arrives; if it cannot arrive (the connection is lost), the job says so.
 */
const LOST = "The connection was lost. Check your internet and try again.";
const jobKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
function addJob(job: Job, keep: (j: Job) => boolean = () => true): void {
  jobs = [...jobs.filter(keep), job];
  emitJobs();
}
const run = (key: string, work: (m: typeof import("./ingest")) => Promise<void>, retryable = false): Promise<void> =>
  import("./ingest").then(work, () => patchJob(key, { step: "error", error: LOST, retryable }));

/** Upload a new paper: read it in the browser (nothing is guessed server-side), store it, then index its text. */
export function startUpload(file: File): Promise<void> {
  const key = jobKey();
  addJob({ key, name: file.name, size: file.size, step: "reading", progress: 0, detail: "Opening the PDF", retryable: false });
  return run(key, (m) => m.upload(key, file));
}

/** Retry indexing after a failure, using the pages already read in this tab. */
export function retryJob(key: string): Promise<void> {
  if (!retained.has(key)) return Promise.resolve();
  patchJob(key, { step: "indexing", progress: 0, detail: "Trying again", error: undefined, retryable: false });
  return run(key, (m) => m.indexAgain(key), true);
}

/** Re-read a stored paper from the server and index it again (a paper stuck as "indexing", or one that failed). */
export function reindexDoc(doc: DocumentInfo): Promise<void> {
  const key = `re-${doc.id}-${Date.now()}`;
  addJob({ key, name: doc.filename, size: doc.sizeBytes, step: "reading", progress: 0, detail: "Opening the paper", retryable: false, docId: doc.id });
  return run(key, (m) => m.reindex(key, doc));
}

/**
 * Carries on reading a scanned paper whose reading was stopped (the limit for the day, the reader's own stop, the tab was closed): opens the PDF again and
 * reads the pages that are still to be read. Nothing that was read is read, or counted, twice.
 */
export function continueScan(doc: Pick<DocumentInfo, "id" | "filename" | "sizeBytes">): Promise<void> {
  const key = `scan-${doc.id}-${Date.now()}`;
  addJob(
    { key, name: doc.filename, size: doc.sizeBytes, step: "scanning", progress: 0, detail: "Opening the paper", retryable: false, docId: doc.id, scanned: true },
    (j) => !(j.docId === doc.id && (j.step === "paused" || j.step === "error")),
  );
  return run(key, (m) => m.continueReading(key, doc));
}
