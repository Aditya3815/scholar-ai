import { analyzePaper, type Line, type PaperInfo } from "@scholar/shared";
import { readOutline, readPage, type PDFDocumentProxy } from "./pdf";

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
