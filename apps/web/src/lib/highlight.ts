import { findAll, findRun, words } from "@scholar/shared";

export const HL_CLASS = "pdf-hl";
export const NOW_CLASS = "pdf-hl-now";

export function clearHighlights(root: ParentNode) {
  root.querySelectorAll(`.${HL_CLASS}, .${NOW_CLASS}`).forEach((el) => el.classList.remove(HL_CLASS, NOW_CLASS));
}

/**
 * Mark the words of `quote` inside a rendered pdf.js text layer. The quote was verified on the server as an unbroken run of
 * words from this page, so the same word-run search finds it here; the spans that hold those words get the highlight class.
 * Returns the first highlighted span (to scroll to), or null if the text layer does not contain enough of the quote.
 */
export function highlightQuote(layer: HTMLElement, quote: string): HTMLElement | null {
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
  const q = words(quote);
  if (q.length === 0 || hay.length === 0) return null;
  const run = findRun(q, hay);
  if (run.len < Math.max(3, Math.ceil(q.length * 0.6))) return null;
  const from = owner[run.start]!;
  const to = owner[run.start + run.len - 1]!;
  for (let i = from; i <= to; i++) spans[i]!.classList.add(HL_CLASS);
  return spans[from]!;
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
