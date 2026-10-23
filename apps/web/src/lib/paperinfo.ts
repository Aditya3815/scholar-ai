import { analyzePaper, referenceSection, scanReferenceSection, type Line, type PaperInfo, type ReferenceSection } from "@scholar/shared";
import { readOutline, readPage, type PDFDocumentProxy } from "./pdf";
import { fetchScanText } from "./scan";

/**
 * Read an already open PDF for its title, DOI, contents and reference list. Papers uploaded before this existed (and any upload
 * whose analysis did not reach the server) are analysed this way when they are opened.
 */
export async function analyzeOpenPdf(pdf: PDFDocumentProxy): Promise<PaperInfo> {
  const lines: Line[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    lines.push(...(await readPage(page)).lines);
    page.cleanup();
  }
  return analyzePaper({ lines, outline: await readOutline(pdf), pages: pdf.numPages });
}

/** The reference section of an open PDF as the app reads it: its pages, its entries, and for a numbered list how many it says there are. */
export async function readReferenceSection(pdf: PDFDocumentProxy): Promise<ReferenceSection> {
  const lines: Line[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    lines.push(...(await readPage(page)).lines);
    page.cleanup();
  }
  return referenceSection(lines, pdf.numPages);
}

/** The same for a scanned paper: found in the text that was read from its pages (only the pages that were used). */
export async function readScanReferenceSection(docId: string): Promise<ReferenceSection> {
  return scanReferenceSection(await fetchScanText(docId));
}
