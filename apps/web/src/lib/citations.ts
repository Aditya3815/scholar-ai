import {
  alignLabels,
  buildCiteIndex,
  describeTarget,
  findInTextCitations,
  isListMarker,
  joinPieces,
  labelledReferenceList,
  labelsUsable,
  linkCitation,
  mergeLineRects,
  type CiteIndex,
  type Line,
  type MarkRect,
  type TextPiece,
} from "@scholar/shared";
import type { PDFDocumentProxy, PDFPageProxy } from "./pdf";

/** How a page's lines are read (lib/pdf.ts readPage): given by the reader, so that this chunk does not import lib/pdf itself (that pulled lib/pdf into the first load). */
export type ReadPage = (page: PDFPageProxy) => Promise<{ lines: Line[] }>;

/**
 * The in-text citations of the open paper (docs/design/reader-citations.md): what the reader needs to find them on a page and to say what each points at.
 * Made once per open paper, from the stored reference list and the list as it is read from the PDF now (for the labels "[12]" and "[ADG16]" were printed with).
 */
export type CiteMap = {
  index: CiteIndex;
  /** the stored list (PaperInfo.references): an entry's position here is its id in the verifier's results */
  references: readonly string[];
  /** the page each entry starts on in the PDF, when it was found again */
  pages: readonly (number | null)[];
  /** the first page of the reference list (a find there may be a list marker) */
  firstRefPage: number;
};

const idle = (signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(() => resolve(), { timeout: 400 });
    else window.setTimeout(resolve, 16);
  });

/** Reads the PDF's text once (a page at a time, in idle time, so the reader stays smooth) and builds the map. Throws an AbortError when cancelled. */
export async function buildCiteMap(pdf: PDFDocumentProxy, references: readonly string[], signal: AbortSignal, readPage: ReadPage): Promise<CiteMap> {
  const lines: Line[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    await idle(signal);
    if (signal.aborted) throw new DOMException("cancelled", "AbortError");
    const page = await pdf.getPage(n);
    lines.push(...(await readPage(page)).lines);
  }
  const read = labelledReferenceList(lines, pdf.numPages);
  const a = alignLabels(references, read);
  const index = buildCiteIndex(references, labelsUsable(references, a) ? a.labels : null);
  const firstRefPage = a.pages.reduce<number>((min, p) => (p !== null && p < min ? p : min), read[0]?.page ?? pdf.numPages + 1);
  return { index, references, pages: a.pages, firstRefPage };
}

/** A citation drawn on a page: its boxes (pixels from the page's top-left corner), the entries it points at, and its words. */
export type PageCite = { id: string; page: number; rects: MarkRect[]; entries: number[]; text: string; label: string };

/**
 * The citations on a page whose text layer is on screen. The spans' text is joined as one string (by their boxes, the same rule the measurement on real PDFs used:
 * packages/shared/src/citations.real.test.ts), the shared parser finds and links the citations, and each find becomes boxes through a Range over its spans.
 * Only citations linked to an entry are returned; list markers ("[12]" at the start of its own entry) are not.
 */
export function citationsOnLayer(layer: HTMLElement, page: number, map: CiteMap): PageCite[] {
  const spans = [...layer.querySelectorAll<HTMLElement>("span")].filter((s) => s.children.length === 0 && (s.textContent ?? "") !== "");
  if (spans.length === 0) return [];
  const pieces: TextPiece[] = spans.map((s) => {
    const r = s.getBoundingClientRect();
    const next = s.nextSibling;
    return { str: s.textContent ?? "", x: r.left, y: r.top + r.height / 2, w: r.width, h: r.height, eol: next instanceof HTMLBRElement };
  });
  const { text, starts } = joinPieces(pieces);
  const at = (offset: number, end: boolean): { span: number; off: number } => {
    // the last piece starting at or before the offset (an end offset belongs to the piece it closes)
    let i = 0;
    for (let k = 0; k < starts.length; k++) if (starts[k]! < offset || (!end && starts[k] === offset)) i = k;
    const len = spans[i]!.textContent?.length ?? 0;
    return { span: i, off: Math.max(0, Math.min(len, offset - starts[i]!)) };
  };
  const box = (layer.parentElement ?? layer).getBoundingClientRect();
  const out: PageCite[] = [];
  for (const c of findInTextCitations(text, map.index.style)) {
    const entries = linkCitation(c, map.index);
    if (!entries) continue;
    if (entries.length === 1 && page >= map.firstRefPage && isListMarker(text, c, map.references[entries[0]!]!)) continue;
    const a = at(c.start, false);
    const z = at(c.end, true);
    const startNode = spans[a.span]!.firstChild;
    const endNode = spans[z.span]!.firstChild;
    if (!startNode || !endNode) continue;
    const range = document.createRange();
    try {
      range.setStart(startNode, Math.min(a.off, startNode.textContent?.length ?? 0));
      range.setEnd(endNode, Math.min(z.off, endNode.textContent?.length ?? 0));
    } catch {
      continue;
    }
    const rects = mergeLineRects([...range.getClientRects()].map((r) => ({ x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height })));
    if (rects.length === 0) continue;
    out.push({ id: `${page}:${c.start}`, page, rects, entries, text: c.text, label: c.targets.map(describeTarget).join("; ") });
  }
  return out;
}
