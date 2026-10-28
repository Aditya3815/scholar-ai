/**
 * Paper information for a scanned paper: its DOI and its reference list, found in the text that was read from the page pictures (see ocr.ts).
 *
 * A scan has no fonts and no positions, so the cues the text-PDF code uses (a title set larger than the body, hanging indents) are not there. What is there
 * is the line structure of the reading, and the models keep a blank line between references, which `splitReferences` uses. The title is not guessed:
 * a scan's first line is usually a running head or a stamp, and a wrong title shown as the paper's is worse than none (it can be renamed).
 */
import { detectIdentifiers, printedMax, referenceEntries, referenceLines, type Line, type PaperInfo, type ReferenceSection } from "./paperinfo";
import type { PageText } from "./documents";

const ENDS_AN_ENTRY = /[.!?)\]"”’]$|\d$/;

/** One line for every line of text, in page order. A blank line is kept as an empty line: it is how the reading separates one reference from the next. */
export function scanLines(pages: readonly PageText[]): Line[] {
  const out: Line[] = [];
  for (const p of [...pages].sort((a, b) => a.page - b.page)) {
    let y = 0;
    // A page break is a paragraph break when the line before it looks finished (ends like the end of a reference: a full stop, a bracket, a digit); a line that
    // stops half way carries on at the top of the next page. No blank line at the top of a page, and never two in a row.
    const before = out[out.length - 1];
    if (before && before.text !== "" && ENDS_AN_ENTRY.test(before.text)) out.push({ text: "", x: 0, y: 0, size: 10, page: p.page });
    let blank = true;
    for (const raw of String(p.text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
      const text = raw.replace(/\s+/g, " ").trim();
      if (text === "" && blank) continue;
      blank = text === "";
      out.push({ text, x: 0, y: --y, size: 10, page: p.page });
    }
  }
  return out;
}

export function scanReferenceSection(pages: readonly PageText[]): ReferenceSection {
  const block = referenceLines(scanLines(pages));
  if (block.length === 0) return { found: false, firstPage: 0, lastPage: 0, printedMax: 0, entries: [] };
  const first = block.find((l) => l.text !== "") ?? block[0]!;
  const last = [...block].reverse().find((l) => l.text !== "") ?? block[block.length - 1]!;
  return { found: true, firstPage: first.page, lastPage: last.page, printedMax: printedMax(block), entries: referenceEntries(block) };
}

/** What can be told about a scanned paper from what was read: its DOI (or arXiv id) when printed on the first pages, and its references. */
export function analyzeScan(pages: readonly PageText[], total: number): PaperInfo {
  const lines = scanLines(pages);
  const ids = detectIdentifiers(lines);
  const references = scanReferenceSection(pages).entries;
  return {
    pages: total,
    title: null,
    doi: ids.doi,
    arxiv: ids.arxiv,
    outline: [],
    headings: [],
    references,
    referencesSource: references.length > 0 ? "pdf" : "none",
    metadata: null,
  };
}

/** What the scan told about the paper fills what the PDF could not: a DOI or a reference list is only taken when the paper has none (a list the reader corrected is kept). */
export function mergeScanInfo(base: PaperInfo | null, fromScan: PaperInfo): PaperInfo {
  if (!base) return fromScan;
  const hasRefs = base.references.length > 0;
  return {
    ...base,
    doi: base.doi ?? fromScan.doi,
    arxiv: base.arxiv ?? fromScan.arxiv,
    references: hasRefs ? base.references : fromScan.references,
    referencesSource: hasRefs ? base.referencesSource : fromScan.referencesSource,
  };
}
