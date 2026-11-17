import { notebookMarkdown, type NotebookExportPage, type QuoteColor } from "@scholar/shared";
import { downloadText } from "../../../../lib/download";

/**
 * The Notebook's Markdown out (Copy and Download, from the page menu), and the name of the file it is saved as.
 */
const slug = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "paper";
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const markdownOf = (docTitle: string, pages: readonly NotebookExportPage[], names: Record<QuoteColor, string>) => notebookMarkdown(docTitle, pages, names);

/** notes-<paper>-<date>.md for all pages, notes-<paper>-<page>-<date>.md for one. */
export function downloadMarkdown(docTitle: string, pageTitle: string | null, text: string): void {
  downloadText(`notes-${slug(docTitle)}-${pageTitle === null ? "" : `${slug(pageTitle || "page")}-`}${today()}.md`, text, "text/markdown;charset=utf-8");
}
