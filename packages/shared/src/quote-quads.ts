import { locateInSpans } from "./text";

/** A piece of text on a page as pdf.js reports it, with where it is on the page as the reader sees it (rotation included): `p` is the start of its box, `along` the vector to the end of the text, `up` the vector from the bottom of the box to the top. */
export type TextBox = { str: string; p: readonly [number, number]; along: readonly [number, number]; up: readonly [number, number] };
export type Quad = [[number, number], [number, number], [number, number], [number, number]];

/**
 * The four-cornered shapes that cover a quote on a page: one for each piece of text it touches, from where the quote starts in the first piece to where it ends in the last.
 * This uses the same word matching as the highlights drawn on screen (`locateInSpans`), so the exported page marks the same words. Positions inside one piece of text are
 * worked out from the character counts, which is exact for fixed-width text and close for the rest. Null when the quote is not on the page.
 */
export function quadsForQuote(items: readonly TextBox[], quote: string): Quad[] | null {
  const at = locateInSpans(items.map((i) => i.str), quote);
  if (!at) return null;
  const out: Quad[] = [];
  for (let s = at.first.span; s <= at.last.span; s++) {
    const it = items[s];
    if (!it || it.str.length === 0) continue;
    const from = s === at.first.span ? at.first.start : 0;
    const to = s === at.last.span ? at.last.end : it.str.length;
    if (to <= from) continue;
    const t0 = from / it.str.length;
    const t1 = to / it.str.length;
    const a: [number, number] = [it.p[0] + it.along[0] * t0, it.p[1] + it.along[1] * t0];
    const b: [number, number] = [it.p[0] + it.along[0] * t1, it.p[1] + it.along[1] * t1];
    out.push([a, b, [b[0] + it.up[0], b[1] + it.up[1]], [a[0] + it.up[0], a[1] + it.up[1]]]);
  }
  return out.length > 0 ? out : null;
}
