import {
  OCR_JPEG_QUALITY,
  OCR_MAX_IMAGE_BYTES,
  OCR_PARALLEL_PAGES,
  looksBlank,
  pictureSize,
  readingOrder,
  type DocumentInfo,
  type PageText,
  type ScanInfo,
  type ScanPageResult,
} from "@scholar/shared";
import { ApiError, json, request } from "./docs-api";
import type { PDFDocumentProxy, PDFPageProxy } from "./pdf";

/**
 * Reading a scanned paper from the browser: each page that has no text is drawn from the PDF (150 dpi, as a JPEG, not enlarged, not touched up: the spike
 * found that "cleaning" a scan made the models read it worse), sent to be read by two models and checked, and the answer kept with the paper. Pictures go to
 * our own server and its private model route only, are not stored, and are dropped here as soon as they are sent. See docs/ocr.md.
 */

/* ---------------------------------------------------------------- the server calls */

export const registerScan = (id: string, pages: number, scanPages: number[]) => request<{ document: DocumentInfo; scan: ScanInfo | null }>(`/${id}/scan`, json("POST", { pages, scanPages }));
export const fetchScan = (id: string) => request<{ scan: ScanInfo | null }>(`/${id}/scan`).then((r) => r.scan);
export const fetchScanText = (id: string) => request<{ pages: PageText[] }>(`/${id}/scan/text`).then((r) => r.pages);

export const sendPage = (id: string, page: number, picture: Blob | null, signal?: AbortSignal) =>
  request<{ result: ScanPageResult; document: DocumentInfo }>(
    `/${id}/ocr?page=${page}${picture ? "" : "&blank=1"}`,
    picture ? { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: picture, signal } : { method: "POST", signal },
  );

/* ---------------------------------------------------------------- drawing a page */

const SAMPLE_WIDTH = 310;

const toBlob = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));

/** Brightness of every pixel of a small copy of the page (a quarter size or so), for the blank-page check. */
function lumaOf(canvas: HTMLCanvasElement): Uint8Array {
  const w = Math.min(SAMPLE_WIDTH, canvas.width);
  const h = Math.max(1, Math.round((canvas.height * w) / canvas.width));
  const small = document.createElement("canvas");
  small.width = w;
  small.height = h;
  const ctx = small.getContext("2d", { willReadFrequently: true });
  if (!ctx) return new Uint8Array([0, 255]); // cannot look: treat as "not blank" (see looksBlank)
  ctx.drawImage(canvas, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = (px[i * 4]! * 0.299 + px[i * 4 + 1]! * 0.587 + px[i * 4 + 2]! * 0.114) | 0;
  small.width = 0;
  return out;
}

/**
 * The page as a JPEG to send, or null when there is nothing on it (then nothing is sent for reading). Throws when the page cannot be drawn.
 */
export async function pictureOfPage(page: PDFPageProxy): Promise<Blob | null> {
  const base = page.getViewport({ scale: 1 });
  const size = pictureSize(base.width, base.height);
  const viewport = page.getViewport({ scale: size.width / base.width });
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw pages.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  try {
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    if (looksBlank(lumaOf(canvas))) return null;
    // Normally 150 to 300 KB. A very detailed page is saved at a lower quality rather than refused.
    for (const q of [OCR_JPEG_QUALITY, 0.65, 0.5, 0.4]) {
      const blob = await toBlob(canvas, q);
      if (blob && blob.size <= OCR_MAX_IMAGE_BYTES) return blob;
    }
    throw new Error("This page is too detailed to send.");
  } finally {
    canvas.width = 0; // frees the memory on phones straight away
    page.cleanup();
  }
}

/* ---------------------------------------------------------------- reading the pages */

export type ScanEnd = {
  /** done = every page was tried; limit = today's allowance is used; paused = the reader stopped it; unavailable = the service failed; signin = signed out. */
  reason: "done" | "limit" | "paused" | "unavailable" | "signin";
  /** Pages that were not read (still to do). */
  left: number[];
  /** The paper as the server last described it. */
  document: DocumentInfo | null;
  lastResult: ScanPageResult | null;
};

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });

/**
 * Reads `pages` of `pdf`, several at a time. First the first pages and the last ones (title, DOI, references), then the rest. A page whose reading failed for
 * a reason that says nothing about the page (a model could not be reached, the connection dropped) is tried once more at the end. Stops at once when today's
 * allowance is used, when the person stops it, or when the service keeps failing; what was read is kept by the server in every case.
 */
export async function readScannedPages(args: {
  docId: string;
  pdf: PDFDocumentProxy;
  pages: number[];
  signal: AbortSignal;
  onPage: (result: ScanPageResult, document: DocumentInfo, left: number) => void;
  parallel?: number;
}): Promise<ScanEnd> {
  const { docId, pdf, signal } = args;
  const queue = readingOrder(args.pages);
  const tries = new Map<number, number>();
  const left = new Set(args.pages);
  let stop: ScanEnd["reason"] | null = null;
  let document: DocumentInfo | null = null;
  let lastResult: ScanPageResult | null = null;
  let failures = 0;
  // pages are drawn one after another (drawing is heavy work on the main thread) while the earlier ones are being read on the server
  let drawing: Promise<unknown> = Promise.resolve();
  const draw = (n: number): Promise<Blob | null> => {
    const job = drawing.then(async () => (await pictureOfPage(await pdf.getPage(n))));
    drawing = job.catch(() => {});
    return job;
  };

  const one = async (page: number) => {
    tries.set(page, (tries.get(page) ?? 0) + 1);
    let picture: Blob | null;
    try {
      picture = await draw(page);
    } catch {
      return; // this page cannot be drawn: it stays unread, and the rest go on
    }
    if (signal.aborted) return;
    try {
      const r = await sendPage(docId, page, picture, signal);
      failures = 0;
      document = r.document;
      lastResult = r.result;
      if (r.result.status === "retry") {
        if ((tries.get(page) ?? 0) < 2) queue.push(page);
        return;
      }
      left.delete(page);
      args.onPage(r.result, r.document, left.size);
    } catch (e) {
      if (signal.aborted || (e instanceof DOMException && e.name === "AbortError")) return;
      if (e instanceof ApiError && e.type === "ocr_daily_limit") stop = "limit";
      else if (e instanceof ApiError && (e.status === 401 || e.status === 403)) stop = "signin";
      else if (e instanceof ApiError && e.status === 429) {
        if ((tries.get(page) ?? 0) < 3) {
          queue.push(page);
          await wait(4000, signal);
        }
      } else {
        // a dropped connection or a 5xx: once more later, and if it keeps happening the service is down
        if ((tries.get(page) ?? 0) < 2) queue.push(page);
        if (++failures >= 4) stop = "unavailable";
        else await wait(1500, signal);
      }
    }
  };

  const worker = async () => {
    while (!stop && !signal.aborted) {
      const page = queue.shift();
      if (page === undefined) return;
      await one(page);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(args.parallel ?? OCR_PARALLEL_PAGES, 6)) }, worker));
  const reason = stop ?? (signal.aborted ? "paused" : "done");
  return { reason, left: [...left].sort((a, b) => a - b), document, lastResult };
}
