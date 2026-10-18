/**
 * Reading an idea from the file formats researchers use. These functions are pure text work (the browser supplies the bytes), so they
 * can be tested in Node. PDF text comes from pdf.js and the .docx container is opened by the browser code; only what is inside is handled here.
 */

export type IdeaFileKind = "text" | "markdown" | "latex" | "pdf" | "docx";

const KINDS: Record<string, IdeaFileKind> = { txt: "text", text: "text", md: "markdown", markdown: "markdown", tex: "latex", latex: "latex", pdf: "pdf", docx: "docx" };

/** The kind of file by its extension, or null for formats we do not read (.doc, .rtf, images, ...). */
export function ideaFileKind(filename: string): IdeaFileKind | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(filename.trim())?.[1]?.toLowerCase();
  return ext ? (KINDS[ext] ?? null) : null;
}

const decodeXml = (s: string): string =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");

/** The text of a Word document: `word/document.xml` in, paragraphs out (one per line). Tables and lists come out as their paragraphs. */
export function docxXmlToText(xml: string): string {
  const paragraphs = xml.split(/<\/w:p>/);
  const lines: string[] = [];
  for (const p of paragraphs) {
    // a deleted tracked change (<w:delText>) is not part of the text anymore; only <w:t> counts
    const pieces = [...p.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g)].map((m) => (m[0].startsWith("<w:tab") ? " " : m[0].startsWith("<w:br") ? " " : decodeXml(m[1] ?? "")));
    const line = pieces.join("").replace(/\s+/g, " ").trim();
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

/** Text commands whose argument is the text itself ("\textbf{x}" is "x"). Anything else with an argument is dropped or kept as below. */
const TEXT_COMMANDS = "textbf|textit|emph|textsc|texttt|textrm|textsf|underline|mbox|text|footnote";
/** Environments that are not prose: formulas, figures, tables, code, the bibliography. */
const NON_PROSE = "equation\\*?|align\\*?|eqnarray\\*?|gather\\*?|multline\\*?|displaymath|math|figure\\*?|table\\*?|tabular\\*?|tikzpicture|lstlisting|verbatim|algorithm\\*?|algorithmic|thebibliography";

/**
 * LaTeX source to readable text: the title and abstract are kept, section headings become headings, comments, formulas, figures, tables, the bibliography
 * and citation commands are dropped. A reader for finding what the idea is about, not a LaTeX renderer.
 */
export function texToText(src: string): string {
  let s = src.replace(/\r/g, "");
  s = s.replace(/(^|[^\\])%.*$/gm, "$1"); // comments (an escaped \% stays)

  const title = /\\title\s*(?:\[[^\]]*\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}/.exec(s)?.[1];
  const body = s.includes("\\begin{document}") ? s.slice(s.indexOf("\\begin{document}") + "\\begin{document}".length) : s;
  s = body.replace(/\\end\{document\}[\s\S]*$/, "");

  s = s.replace(new RegExp(`\\\\begin\\{(${NON_PROSE})\\}[\\s\\S]*?\\\\end\\{\\1\\}`, "g"), " ");
  s = s.replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$[^$\n]{0,200}\$/g, " ");
  s = s.replace(/\\(?:cite[a-z]*|ref|eqref|autoref|cref|label|vspace|hspace|bibliography|bibliographystyle|usepackage|input|include|includegraphics|caption)\*?(?:\[[^\]]*\])*\{[^{}]*\}/g, " ");
  s = s.replace(/\\(?:part|chapter|section|subsection|subsubsection|paragraph)\*?(?:\[[^\]]*\])?\{((?:[^{}]|\{[^{}]*\})*)\}/g, "\n\n$1\n");
  s = s.replace(/\\begin\{abstract\}/g, "\n\nAbstract\n").replace(/\\end\{abstract\}/g, "\n");
  s = s.replace(new RegExp(`\\\\(?:${TEXT_COMMANDS})\\s*\\{((?:[^{}]|\\{[^{}]*\\})*)\\}`, "g"), "$1");
  s = s.replace(/\\item\b/g, "\n- ");
  s = s.replace(/\\(?:begin|end)\{[^}]*\}/g, " ");
  s = s.replace(/\\\\|\\newline|~/g, " ");
  s = s.replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?/g, " "); // any command left: dropped, its {argument} text stays
  s = s.replace(/\\(.)/g, "$1").replace(/[{}]/g, "");

  const out = s.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const t = title ? texToText(`\\begin{document}${title}`).replace(/\s+/g, " ").trim() : "";
  return t && !out.startsWith(t) ? `${t}\n\n${out}` : out;
}

/** Plain text and Markdown as the researcher wrote them, tidied: line endings, trailing space, runs of blank lines. */
export function tidyText(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}
