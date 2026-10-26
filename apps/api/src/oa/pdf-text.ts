import { getDocumentProxy } from "unpdf";
import { MAX_OA_PAGES, type OaReason } from "@scholar/shared";

/**
 * The text of a PDF, page by page, read on the server (spike R8: 35 of 35 papers up to 13.75 MB and 214 pages were read inside a Worker's memory). Three outcomes that are
 * not a result are named, so the screen can say why: more pages than the cap (the paper is refused, not cut: an answer from the first 120 pages of 214 would say "the paper
 * does not cover this" about things it does), a scan (most pages have no text layer: the OCR path stays for a person's own uploads), and a file that is not readable at all.
 */
export type PdfPages = { pages: { page: number; text: string }[]; totalPages: number };
export class PdfReadError extends Error {
  constructor(readonly reason: OaReason, message: string) {
    super(message);
    this.name = "PdfReadError";
  }
}

/** A page with fewer characters than this has no text layer worth reading (a page number, a stamp). */
const MIN_PAGE_CHARS = 20;
/** If this share of the pages (or more) has no text, the file is a scan. */
const SCANNED_SHARE = 0.5;
/** Less text than this in the whole paper is no paper. */
const MIN_TOTAL_CHARS = 500;

/** Words split by a line break at a hyphen are joined again ("exam-\nple" -> "example"); a hyphen before a capital or a digit is part of the word and stays. */
export const dehyphenate = (s: string) => s.replace(/(\p{L})-\n(\p{Ll})/gu, "$1$2");

export async function extractPdfPages(bytes: Uint8Array, maxPages = MAX_OA_PAGES): Promise<PdfPages> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes)); // a copy: pdf.js takes over the buffer it is given
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    throw new PdfReadError(name === "PasswordException" ? "empty" : "not_a_pdf", "the file could not be opened as a PDF");
  }
  try {
    const total = pdf.numPages;
    if (total > maxPages) throw new PdfReadError("too_long", `${total} pages is over the limit of ${maxPages}`);
    const pages: { page: number; text: string }[] = [];
    let empty = 0;
    let chars = 0;
    for (let p = 1; p <= total; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const raw = content.items.map((i) => ("str" in i ? i.str + (i.hasEOL ? "\n" : " ") : "")).join("");
      const text = dehyphenate(raw).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
      page.cleanup();
      if (text.length < MIN_PAGE_CHARS) empty++;
      chars += text.length;
      pages.push({ page: p, text });
    }
    if (total > 0 && empty / total >= SCANNED_SHARE) throw new PdfReadError("scanned", `${empty} of ${total} pages have no text`);
    if (chars < MIN_TOTAL_CHARS) throw new PdfReadError("empty", "almost no text");
    return { pages, totalPages: total };
  } finally {
    await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.().catch(() => {});
  }
}
