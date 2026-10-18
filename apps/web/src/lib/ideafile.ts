import { MAX_IDEA_CHARS, docxXmlToText, ideaFileKind, texToText, tidyText } from "@scholar/shared";
import { openPdf, readPage } from "./pdf";

/** Why a file could not be turned into text, in words the researcher can act on. */
export class IdeaFileError extends Error {}

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_PDF_PAGES = 40;
const MAX_DOCX_XML_BYTES = 30 * 1024 * 1024;

export const IDEA_FILE_ACCEPT = ".txt,.md,.markdown,.tex,.latex,.pdf,.docx";
export const IDEA_FILE_HELP = "PDF, Word (.docx), LaTeX (.tex), Markdown or plain text";

export type IdeaFileText = { text: string; truncated: boolean };

async function readPdf(file: File): Promise<string> {
  const pdf = await openPdf({ data: await file.arrayBuffer() });
  try {
    const pages: string[] = [];
    for (let n = 1; n <= Math.min(pdf.numPages, MAX_PDF_PAGES); n++) {
      const page = await pdf.getPage(n);
      pages.push((await readPage(page)).text);
      page.cleanup();
    }
    return pages.join("\n\n");
  } finally {
    void pdf.loadingTask.destroy();
  }
}

async function readDocx(file: File): Promise<string> {
  const { unzipSync, strFromU8 } = await import("fflate");
  let entries: Record<string, Uint8Array>;
  try {
    // Only the one file that holds the text is unpacked, and only if it is a sane size (a zip can be made to expand enormously).
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (f) => f.name === "word/document.xml" && f.originalSize <= MAX_DOCX_XML_BYTES });
  } catch {
    throw new IdeaFileError("This file could not be opened as a Word .docx document.");
  }
  const xml = entries["word/document.xml"];
  if (!xml) throw new IdeaFileError("No text was found in this Word file. If it is an older .doc file, save it as .docx and try again.");
  return docxXmlToText(strFromU8(xml));
}

/** Reads an idea from a file in the browser; nothing is uploaded. */
export async function readIdeaFile(file: File): Promise<IdeaFileText> {
  const kind = ideaFileKind(file.name);
  if (!kind) throw new IdeaFileError(`${file.name} is not a format we can read. Use ${IDEA_FILE_HELP}.`);
  if (file.size > MAX_FILE_BYTES) throw new IdeaFileError("That file is larger than 15 MB. Paste the idea instead, or use a shorter file.");

  let text: string;
  try {
    text = kind === "pdf" ? await readPdf(file) : kind === "docx" ? await readDocx(file) : kind === "latex" ? texToText(await file.text()) : await file.text();
  } catch (e) {
    if (e instanceof IdeaFileError) throw e;
    throw new IdeaFileError(e instanceof Error ? e.message : "The file could not be read.");
  }
  text = tidyText(text);
  if (text.length < 20) {
    throw new IdeaFileError(kind === "pdf" ? "No text was found in this PDF. It may be a scan; paste the idea instead." : "No text was found in this file.");
  }
  return { text: text.slice(0, MAX_IDEA_CHARS), truncated: text.length > MAX_IDEA_CHARS };
}
