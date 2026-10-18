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
  lib ??= import("pdfjs-dist").then((m) => {
    m.GlobalWorkerOptions.workerSrc = workerUrl;
    return m;
  });
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

export class PdfError extends Error {
  constructor(message: string, readonly kind: "password" | "invalid" | "network" | "other" = "other") {
    super(message);
  }
}

export async function openPdf(source: { url: string } | { data: ArrayBuffer }, onProgress?: (fraction: number) => void): Promise<PDFDocumentProxy> {
  const m = await pdfjs();
  try {
    const task = m.getDocument({ ...OPTIONS, ...("url" in source ? { url: source.url, withCredentials: true } : { data: new Uint8Array(source.data) }) });
    if (onProgress) task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => total > 0 && onProgress(Math.min(1, loaded / total));
    return await task.promise;
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === "PasswordException") throw new PdfError("This PDF is password protected. Remove the password and upload it again.", "password");
    if (name === "InvalidPDFException" || name === "FormatError") throw new PdfError("This file could not be read as a PDF.", "invalid");
    if (name === "UnexpectedResponseException" || name === "ResponseException") throw new PdfError("The paper could not be downloaded. Check your connection and try again.", "network");
    throw new PdfError(e instanceof Error ? e.message : "The PDF could not be opened.");
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

/** A small JPEG of the first page (about 360 px wide) used as the paper's cover in the list. Always under the server's limit. */
export async function renderCover(pdf: PDFDocumentProxy): Promise<Blob | null> {
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 360 / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    for (const q of [0.85, 0.7, 0.55, 0.4]) {
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", q));
      if (blob && blob.size <= 290 * 1024) return blob;
    }
    return null;
  } catch {
    return null;
  }
}
