import { findQuote, findAll, foldSpans, mergeLineRects, words, type QuoteAnchor, type QuoteAnchorHow, type QuoteAnchorOptions, type FoldedPage, type MarkRect } from "@scholar/shared";

export const HL_CLASS = "pdf-hl";
export const NOW_CLASS = "pdf-hl-now";

export function clearHighlights(root: ParentNode) {
  root.querySelectorAll(`.${HL_CLASS}, .${NOW_CLASS}`).forEach((el) => el.classList.remove(HL_CLASS, NOW_CLASS));
}

/**
 * Mark every place `query` occurs in a rendered text layer (the one at index `current` stronger), the way a search in a paper shows its hits.
 * Returns the first span of the current hit, to scroll to, or null when the layer has no hit.
 */
export function highlightMatches(layer: HTMLElement, query: string, current: number): HTMLElement | null {
  clearHighlights(layer);
  const spans = [...layer.querySelectorAll<HTMLElement>("span")].filter((s) => s.children.length === 0 && (s.textContent ?? "").trim() !== "");
  const hay: string[] = [];
  const owner: number[] = [];
  spans.forEach((s, i) => {
    for (const w of words(s.textContent ?? "")) {
      hay.push(w);
      owner.push(i);
    }
  });
  const q = words(query);
  if (q.length === 0) return null;
  const starts = findAll(q, hay);
  let focus: HTMLElement | null = null;
  starts.forEach((start, idx) => {
    const from = owner[start]!;
    const to = owner[start + q.length - 1]!;
    for (let i = from; i <= to; i++) {
      spans[i]!.classList.add(HL_CLASS);
      if (idx === current) spans[i]!.classList.add(NOW_CLASS);
    }
    if (idx === current) focus = spans[from]!;
  });
  return focus;
}

/** The pieces of text of a rendered pdf.js text layer, in order (the leaves: pdf.js wraps marked content in spans of spans), and its letters for the anchoring engine. */
export type ReadLayer = { spans: HTMLElement[]; page: FoldedPage };
export function readLayer(layer: HTMLElement): ReadLayer {
  const spans = [...layer.querySelectorAll<HTMLElement>("span")].filter((s) => s.children.length === 0 && (s.textContent ?? "").trim() !== "");
  return { spans, page: foldSpans(spans.map((s) => s.textContent ?? "")) };
}

/** The text node and the offset in it of character `at` of an element's text (a piece of pdf.js text has one text node; walked, to be safe). */
function pointIn(el: HTMLElement, at: number): { node: Node; offset: number } | null {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let left = at;
  let last: Text | null = null;
  for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
    if (left <= n.length) return { node: n, offset: left };
    left -= n.length;
    last = n;
  }
  return last ? { node: last, offset: last.length } : null;
}

/**
 * The boxes of a stretch the anchoring engine found, in pixels from the top-left corner of its page: a DOM range over the text layer from its first letter to its last, so they are exact to
 * the letter, follow the browser's own layout of every piece (sub- and superscripts included), and survive zoom (measured again on every render).
 */
export function anchorRects(layer: HTMLElement, read: ReadLayer, at: QuoteAnchor): MarkRect[] {
  const page = (layer.parentElement ?? layer).getBoundingClientRect();
  const out: MarkRect[] = [];
  for (const part of at.parts) {
    const a = read.spans[part.first.span];
    const z = read.spans[part.last.span];
    if (!a || !z) continue;
    const range = document.createRange();
    const s = pointIn(a, part.first.start);
    const e = pointIn(z, part.last.end);
    if (s) range.setStart(s.node, s.offset);
    else range.setStartBefore(a);
    if (e) range.setEnd(e.node, e.offset);
    else range.setEndAfter(z);
    for (const r of range.getClientRects()) out.push({ x: r.left - page.left, y: r.top - page.top, w: r.width, h: r.height });
  }
  return mergeLineRects(out);
}

/**
 * Where a quote is on a rendered page, as boxes to draw: found by the anchoring engine (exactly, then as pieces, closely, in part, and for a cited passage the most similar sentence),
 * so a highlight of a caption with math, ligatures or a hyphenated word is found as surely as plain text. `how` says how it was found; null when it is not on the page (the caller says so).
 */
export function quoteRects(layer: HTMLElement, quote: string, opts: QuoteAnchorOptions = {}, read: ReadLayer = readLayer(layer)): { rects: MarkRect[]; how: QuoteAnchorHow } | null {
  const at = findQuote(read.page, quote, opts);
  if (!at) return null;
  const rects = anchorRects(layer, read, at);
  return rects.length > 0 ? { rects, how: at.how } : null;
}
