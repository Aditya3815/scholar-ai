import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import type * as PdfJs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { groupLines, rawItems, type Line, type OutlineItem } from "@scholar/shared";

/**
 * pdf.js is loaded on first use (it is ~400 KB and only the paper pages need it). Everything it fetches comes from our own
 * origin (see scripts/copy-pdfjs.mjs), which is what the Content-Security-Policy allows.
 */
let lib: Promise<typeof PdfJs> | undefined;
export function pdfjs(): Promise<typeof PdfJs> {
  lib ??= import("pdfjs-dist").then(
    (m) => {
      m.GlobalWorkerOptions.workerSrc = workerUrl;
      return m;
    },
    (e: unknown) => {
      // a failed import is not kept: Try again (or the next paper) asks for it afresh
      lib = undefined;
      throw e;
    },
  );
  return lib;
}

const OPTIONS = {
  wasmUrl: "/pdfjs/wasm/",
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  isEvalSupported: false, // never compile PDF-supplied code with eval
  enableXfa: false,
} as const;

export type { PDFDocumentProxy, PDFPageProxy };

/**
 * Why a paper could not be opened. "network": the file's download failed or was cut off (a dropped connection, a server hiccup), worth trying again; "chunk": a script of ours
 * (pdf.js or its worker) could not be fetched, which after a deploy means the page is stale and must load again; "missing": the server has no file for the paper.
 */
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : typeof e === "string" ? e : "");

/** A failure to fetch one of our own script files (a lazy chunk, its style sheet, or the pdf.js worker), as each browser words it: a stale page after a deploy (lib/chunk-reload.ts). */
export const isChunkError = (e: unknown): boolean =>
  /dynamically imported module|importing a module script failed|error loading dynamically imported module|unable to preload css|fake worker failed|loading chunk \S+ failed/i.test(messageOf(e));

export type PdfErrorKind = "password" | "invalid" | "network" | "chunk" | "missing" | "other";

export class PdfError extends Error {
  constructor(
    message: string,
    readonly kind: PdfErrorKind = "other",
    /** What the browser or pdf.js said, for the "Technical details" line (never shown as the message). */
    readonly detail = "",
  ) {
    super(message);
  }
}

/** The words people see for each kind (the raw "Failed to fetch" goes to the details). */
export const PDF_ERROR_WORDS = {
  network: "We couldn't load this paper. Check your connection and try again.",
  chunk: "This page was updated while it was open. Reload the page to get the new version.",
  missing: "The paper's file could not be found. Try adding the paper again.",
} as const;

const NETWORK = /failed to fetch|networkerror|network ?error|load failed|network connection was lost|err_network|err_connection|err_internet|aborted|the operation was aborted|body stream|unexpected end|terminated/i;

/** Sorts what openPdf caught into a PdfError with words for people. */
export function pdfErrorOf(e: unknown): PdfError {
  if (e instanceof PdfError) return e;
  const name = (e as { name?: string } | null)?.name;
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const detail = [name && name !== "Error" ? name : "", raw].filter(Boolean).join(": ");
  if (name === "PasswordException") return new PdfError("This PDF is password protected. Remove the password and upload it again.", "password", detail);
  if (name === "InvalidPDFException" || name === "FormatError") return new PdfError("This file could not be read as a PDF.", "invalid", detail);
  if (isChunkError(e)) return new PdfError(PDF_ERROR_WORDS.chunk, "chunk", detail);
  if (name === "UnexpectedResponseException" || name === "ResponseException" || name === "MissingPDFException") {
    const status = (e as { status?: number }).status ?? 0;
    if (name === "MissingPDFException" || status === 404 || status === 410) return new PdfError(PDF_ERROR_WORDS.missing, "missing", detail);
    return new PdfError(PDF_ERROR_WORDS.network, "network", detail);
  }
  if (NETWORK.test(raw)) return new PdfError(PDF_ERROR_WORDS.network, "network", detail);
  return new PdfError("The paper could not be opened. Try again, or reload the page.", "other", detail);
}

export async function openPdf(source: { url: string } | { data: ArrayBuffer }, onProgress?: (fraction: number) => void): Promise<PDFDocumentProxy> {
  let m: typeof PdfJs;
  try {
    m = await pdfjs();
  } catch (e) {
    // pdf.js itself could not be fetched: a stale page after a deploy, or no network
    const detail = e instanceof Error ? e.message : String(e);
    throw navigator.onLine === false ? new PdfError(PDF_ERROR_WORDS.network, "network", detail) : new PdfError(PDF_ERROR_WORDS.chunk, "chunk", detail);
  }
  try {
    const task = m.getDocument({ ...OPTIONS, ...("url" in source ? { url: source.url, withCredentials: true } : { data: new Uint8Array(source.data) }) });
    if (onProgress) task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => total > 0 && onProgress(Math.min(1, loaded / total));
    return await task.promise;
  } catch (e) {
    throw pdfErrorOf(e);
  }
}

/**
 * One page, read once: its text in reading order (line ends become spaces, a word hyphenated across lines is rejoined) and its
 * lines with font sizes and positions, which is what finding the title, headings and reference list needs.
 */
export async function readPage(page: PDFPageProxy): Promise<{ text: string; lines: Line[] }> {
  const content = await page.getTextContent();
  const lines = groupLines(rawItems(content.items as never), page.pageNumber);
  let out = "";
  for (const item of content.items) {
    if (!("str" in item)) continue;
    out += item.str;
    out += item.hasEOL ? "\n" : " ";
  }
  const text = out.replace(/(\p{L})-\n(?=\p{Ll})/gu, "$1").replace(/[ \t]*\n[ \t]*/g, " ").replace(/\s{2,}/g, " ").trim();
  return { text, lines };
}

type OutlineNode = { title: string; dest: unknown; items?: OutlineNode[] };

/** The PDF's own bookmarks as a flat list with page numbers (entries whose target cannot be resolved are left out). */
export async function readOutline(pdf: PDFDocumentProxy): Promise<OutlineItem[]> {
  const out: OutlineItem[] = [];
  const walk = async (nodes: OutlineNode[], level: number) => {
    for (const n of nodes) {
      if (out.length >= 150) return;
      try {
        const dest = typeof n.dest === "string" ? await pdf.getDestination(n.dest) : (n.dest as unknown[] | null);
        const ref = dest?.[0];
        const page = ref && typeof ref === "object" ? (await pdf.getPageIndex(ref as never)) + 1 : typeof ref === "number" ? ref + 1 : 0;
        if (page >= 1 && n.title?.trim()) out.push({ title: n.title.replace(/\s+/g, " ").trim().slice(0, 200), page, level });
      } catch {
        /* a bookmark that points nowhere */
      }
      if (n.items?.length) await walk(n.items, level + 1);
    }
  };
  try {
    await walk(((await pdf.getOutline()) ?? []) as OutlineNode[], 1);
  } catch {
    /* no outline */
  }
  return out;
}

/** The first page drawn as a JPEG `width` px wide, at the best quality (of those given) that is at most `maxBytes`; null when it cannot be drawn or is still too big. */
export async function firstPageJpeg(pdf: PDFDocumentProxy, width: number, maxBytes: number, qualities: number[]): Promise<{ blob: Blob; width: number; height: number } | null> {
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    for (const q of qualities) {
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", q));
      if (blob && blob.size <= maxBytes) return { blob, width: canvas.width, height: canvas.height };
    }
    return null;
  } catch {
    return null;
  }
}

/** A small JPEG of the first page (about 360 px wide) used as the paper's cover in the list. Always under the server's limit. */
export async function renderCover(pdf: PDFDocumentProxy): Promise<Blob | null> {
  return (await firstPageJpeg(pdf, 360, 290 * 1024, [0.85, 0.7, 0.55, 0.4]))?.blob ?? null;
}
