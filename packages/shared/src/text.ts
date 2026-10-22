/** Word-level text helpers shared by the server (verifying quotes) and the browser (highlighting them in the PDF). */

/** Lower-case words and numbers; diacritics folded so "Résumé" and "resume" compare equal. Punctuation is dropped. */
export const words = (s: string): string[] => s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").match(/[\p{L}\p{N}]+/gu) ?? [];

export type Run = { /** words of `needle` found together */ len: number; /** index in `hay` where the run starts */ start: number };

/** The longest stretch of consecutive `needle` words that also appears, unbroken and in order, in `hay`. */
export function findRun(needle: string[], hay: string[]): Run {
  let best: Run = { len: 0, start: 0 };
  let prev = new Array<number>(hay.length + 1).fill(0);
  for (const w of needle) {
    const cur = new Array<number>(hay.length + 1).fill(0);
    for (let j = 1; j <= hay.length; j++) {
      if (hay[j - 1] === w) {
        cur[j] = prev[j - 1]! + 1;
        if (cur[j]! > best.len) best = { len: cur[j]!, start: j - cur[j]! };
      }
    }
    prev = cur;
  }
  return best;
}

/**
 * Every place the words of `needle` appear together, in order and unbroken, in `hay` (start indices). The LAST needle word may be a
 * beginning ("transfor" finds "transformer"), so a search can be run while it is still being typed.
 */
export function findAll(needle: string[], hay: string[]): number[] {
  const out: number[] = [];
  const n = needle.length;
  if (n === 0) return out;
  const last = needle[n - 1]!;
  for (let i = 0; i + n <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < n - 1 && ok; j++) ok = hay[i + j] === needle[j];
    if (ok && hay[i + n - 1]!.startsWith(last)) out.push(i);
  }
  return out;
}

/* ---------------------------------------------------------------- saved highlights: where they are on a page */

export type SpanPos = { span: number; start: number; end: number };

/**
 * Where a saved quote sits among the pieces of text of a rendered page (the spans of pdf.js's text layer): the first and the last word of the quote, each with
 * the span it is in and its character positions there. Found by words, like every other quote in the app, so it survives zoom and re-rendering. Null when
 * too little of the quote is on the page (`minShare` of its words, and at least `minWords`).
 * A span whose words cannot be mapped one to one onto its characters counts as wholly part of the quote (a marker slightly too wide, never one that is missing).
 */
export function locateInSpans(texts: readonly string[], quote: string, minShare = 0.6, minWords = 2): { first: SpanPos; last: SpanPos; matched: number; of: number } | null {
  const hay: string[] = [];
  const pos: SpanPos[] = [];
  texts.forEach((t, i) => {
    const w = words(t);
    const raw = [...t.matchAll(/[\p{L}\p{N}]+/gu)];
    const exact = raw.length === w.length;
    w.forEach((word, k) => {
      hay.push(word);
      pos.push(exact ? { span: i, start: raw[k]!.index!, end: raw[k]!.index! + raw[k]![0].length } : { span: i, start: 0, end: t.length });
    });
  });
  const q = words(quote);
  if (q.length === 0 || hay.length === 0) return null;
  const run = findRun(q, hay);
  if (run.len < Math.max(minWords, Math.ceil(q.length * minShare))) return null;
  return { first: pos[run.start]!, last: pos[run.start + run.len - 1]!, matched: run.len, of: q.length };
}

export type MarkRect = { x: number; y: number; w: number; h: number };

/**
 * The boxes of a highlight as the browser reports them (one per piece of text, and often one for the element round it too) become the boxes to draw:
 * tiny ones are dropped, a box inside another is dropped, and boxes on one line that touch or overlap are joined into one, so a highlight is a few clean bars.
 */
export function mergeLineRects(rects: readonly MarkRect[]): MarkRect[] {
  const ok = rects.filter((r) => r.w >= 1 && r.h >= 1 && Number.isFinite(r.x + r.y + r.w + r.h));
  const inside = (a: MarkRect, b: MarkRect) => a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.w <= b.x + b.w + 1 && a.y + a.h <= b.y + b.h + 1;
  const kept = ok.filter((a, i) => !ok.some((b, j) => j !== i && inside(a, b) && (!inside(b, a) || j < i)));
  // group the boxes by line (the middle of the box, within 40% of its height), then join those that touch from left to right
  const lines: MarkRect[][] = [];
  for (const r of [...kept].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l[0]!.y + l[0]!.h / 2 - (r.y + r.h / 2)) <= Math.max(l[0]!.h, r.h) * 0.4);
    if (line) line.push(r);
    else lines.push([r]);
  }
  const out: MarkRect[] = [];
  for (const line of lines) {
    let cur: MarkRect | null = null;
    for (const r of line.sort((a, b) => a.x - b.x)) {
      if (cur && r.x <= cur.x + cur.w + 3) {
        const top = Math.min(cur.y, r.y);
        const bottom = Math.max(cur.y + cur.h, r.y + r.h);
        const right = Math.max(cur.x + cur.w, r.x + r.w);
        cur = { x: cur.x, y: top, w: right - cur.x, h: bottom - top };
        out[out.length - 1] = cur;
      } else {
        cur = { ...r };
        out.push(cur);
      }
    }
  }
  return out.map((r) => ({ x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.w * 10) / 10, h: Math.round(r.h * 10) / 10 }));
}

/** What to do with a new highlight, given the highlights and notes already on the page. */
export type NewHighlightPlan =
  | { action: "add" }
  /** The same text is already highlighted (in this or another colour): change that one, never draw a second copy on top. */
  | { action: "recolor"; id: string }
  /** Nothing to do: it is the same text in the same colour, or a part of a highlight that already has that colour. */
  | { action: "skip"; id: string }
  /** The reader wants a note on text that already has a highlight: open that one. */
  | { action: "open"; id: string };

const norm = (s: string) => words(s).join(" ");

/**
 * Highlights may overlap (a different colour over part of one, a longer one around a short one) and each stays visible; what is refused is a copy of the same thing:
 *  - the same words again: a note request opens the existing one, a new colour recolours it, the same colour changes nothing;
 *  - a part of a highlight of the same colour, without a note: nothing to add;
 *  - everything else (a part in another colour, a longer text, an overlap, a note on a part) is added next to what is there.
 */
export function planNewHighlight(existing: readonly { id: string; page: number; quote: string; color: string }[], n: { page: number; quote: string; color: string; withNote: boolean }): NewHighlightPlan {
  const q = norm(n.quote);
  const same = existing.find((e) => e.page === n.page && norm(e.quote) === q);
  if (same) return n.withNote ? { action: "open", id: same.id } : same.color !== n.color ? { action: "recolor", id: same.id } : { action: "skip", id: same.id };
  if (!n.withNote) {
    const around = existing.find((e) => e.page === n.page && e.color === n.color && ` ${norm(e.quote)} `.includes(` ${q} `));
    if (around) return { action: "skip", id: around.id };
  }
  return { action: "add" };
}
