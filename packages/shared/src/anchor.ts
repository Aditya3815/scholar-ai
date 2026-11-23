import { words, type SpanPos } from "./text";

/**
 * Where a quote is on a page of a PDF: the engine under the saved highlights, the passage an answer cites, and the exported PDF's marks.
 *
 * A quote and a page are compared as their letters and digits only, in order (`fold`): compatibility forms decomposed (the ligature "ﬁ" is "fi", the math italic "𝑧" is "z", "ℓ" is "l"),
 * accents and spacing accents dropped (a TeX accent drawn as a glyph of its own, "ˆz" or "na¨ıve", reads "z" and "naive"), lower case, and nothing else: no spaces, no punctuation,
 * no hyphens. So the many small pieces of text pdf.js makes of a line with math ("r" "1" "," "r" "K"), a word hyphenated across two lines ("repre-" "sentation") and the line ends all
 * read the same in the page as in the quote, however the quote was written (a selection's text, the server's text with the hyphen joined, a model's copy).
 *
 * The quote is looked for, in this order:
 *   1. exactly (the usual case: a highlight is the text of the page it was made on);
 *   2. as pieces, when a model joined two stretches with an ellipsis ("...", "…", "[...]"): each piece, in order;
 *   3. closely: the stretch of the page with the fewest letters changed, added or left out (at most a quarter of the quote's), for a quote a model paraphrased slightly, or a page
 *      whose text differs a little from when the highlight was made; or in part: the longest start or end of the quote that is on the page exactly (a selection that ran over onto
 *      the next page), whichever leaves out fewer letters;
 *   4. only when asked (`sentence`, for a cited passage): the sentence of the page (or two together) most like the quote.
 * Null when none of that finds it: the caller says so (a highlight "not found on the page"), never draws nothing in silence.
 */

/** The letters and digits of a page, each with the piece of text (span) and the characters in it that it comes from. */
export type FoldedPage = { text: string; span: Int32Array; start: Int32Array; end: Int32Array; /** where a sentence ends: positions in `text` */ breaks: number[] };

export type QuoteAnchorHow = "exact" | "pieces" | "close" | "part" | "sentence";
export type QuoteAnchorPart = { first: SpanPos; last: SpanPos };
export type QuoteAnchor = {
  /** One stretch of the page, or several (the pieces of a quote joined with an ellipsis, when they are far apart) */
  parts: QuoteAnchorPart[];
  how: QuoteAnchorHow;
  /** Letters of the quote the page has (all of them, for an exact match) */
  matched: number;
  /** Letters of the quote */
  of: number;
};
export type QuoteAnchorOptions = {
  /** A cited passage: when nothing else finds it, the sentence of the page most like it (a highlight of the reader's own never falls back so far) */
  sentence?: boolean;
  /** Fewer words than this is not a quote (one word would mark the first place it appears). Default 2. */
  minWords?: number;
};

const LM = /\p{Lm}/u;
const KEEP = /[\p{L}\p{N}]/u;
const MARK = /\p{M}/u;
/** Letters that compare as another one: the dotless i and j that TeX puts under an accent. */
const SAME: Record<string, string> = { ı: "i", ȷ: "j" };
const cache = new Map<string, string>();

/** One character as the comparison reads it: "" for anything that is not a letter or a digit. */
function foldChar(ch: string): string {
  const c = ch.charCodeAt(0);
  if (ch.length === 1 && c < 128) {
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) return ch;
    if (c >= 65 && c <= 90) return String.fromCharCode(c + 32);
    return "";
  }
  const hit = cache.get(ch);
  if (hit !== undefined) return hit;
  let out = "";
  for (const d of ch.normalize("NFKD").toLowerCase()) if (KEEP.test(d) && !LM.test(d)) out += SAME[d] ?? d;
  if (cache.size < 4000) cache.set(ch, out);
  return out;
}

/** A string as the comparison reads it. */
export const fold = (s: string): string => {
  let out = "";
  for (const ch of s) out += foldChar(ch);
  return out;
};

/** Words before a full stop that do not end a sentence ("Fig. 4", "e.g. this", "et al. show"), or a single letter (an initial, "(a)"). */
const NOT_END = /(?:\b(?:e\.g|i\.e|fig|figs|eq|eqs|al|vs|cf|sec|tab|no|ref|refs|approx|resp)|(?:^|[^\p{L}])\p{L})$/iu;

/** The letters and digits of the pieces of text of a page (the spans of pdf.js's text layer, in their order), and where each comes from. */
export function foldSpans(texts: readonly string[]): FoldedPage {
  let text = "";
  const span: number[] = [];
  const start: number[] = [];
  const end: number[] = [];
  const breaks: number[] = [];
  texts.forEach((t, si) => {
    for (let k = 0; k < t.length; ) {
      const cp = t.codePointAt(k)!;
      const len = cp > 0xffff ? 2 : 1;
      const ch = len === 1 ? t[k]! : t.slice(k, k + 2);
      const f = foldChar(ch);
      if (f) {
        // an accent written after its letter belongs to it (the marked box takes it in)
        let e = k + len;
        while (e < t.length && MARK.test(t[e]!)) e++;
        for (const x of f) {
          text += x;
          span.push(si);
          start.push(k);
          end.push(e);
        }
      } else if ((ch === "." || ch === "!" || ch === "?") && (k + 1 >= t.length || /\s/.test(t[k + 1]!)) && !(ch === "." && NOT_END.test(t.slice(Math.max(0, k - 8), k)))) {
        if (breaks[breaks.length - 1] !== text.length) breaks.push(text.length);
      }
      k += len;
    }
  });
  return { text, span: Int32Array.from(span), start: Int32Array.from(start), end: Int32Array.from(end), breaks };
}

const GAP = /\s*(?:\[\s*(?:\.{3}|…)\s*\]|\.{3,}|…)\s*/;
/** The longest quote compared closely (the work grows with its length times the page's). */
const MAX_CLOSE = 1500;

type Hit = { from: number; to: number; err: number };

/**
 * The stretch of `hay` that is closest to `q`: the fewest letters changed, added or left out (Sellers' search with Ukkonen's cut-off, so the work is about the page's length times `k`),
 * and at most `k` of them. The earliest of equally close stretches.
 */
export function closest(hay: string, q: string, k: number): Hit | null {
  const m = q.length;
  const n = hay.length;
  if (m === 0 || n === 0 || k < 0) return null;
  const BIG = k + 1;
  const C = new Int32Array(m + 1);
  const S = new Int32Array(m + 1);
  for (let i = 0; i <= m; i++) C[i] = i;
  let lact = Math.min(k, m);
  let best: Hit | null = null;
  if (lact === m) best = { from: 0, to: 0, err: m };
  for (let j = 1; j <= n; j++) {
    const hc = hay.charCodeAt(j - 1);
    let diag = C[0]!;
    let diagS = S[0]!;
    C[0] = 0;
    S[0] = j;
    const lim = Math.min(lact + 1, m);
    for (let i = 1; i <= lim; i++) {
      const oldC = i <= lact ? C[i]! : BIG;
      const oldS = S[i]!;
      let v = diag + (q.charCodeAt(i - 1) === hc ? 0 : 1);
      let s = diagS;
      if (oldC + 1 < v) {
        v = oldC + 1;
        s = oldS;
      }
      if (C[i - 1]! + 1 < v) {
        v = C[i - 1]! + 1;
        s = S[i - 1]!;
      }
      diag = oldC;
      diagS = oldS;
      C[i] = v;
      S[i] = s;
    }
    lact = lim;
    while (lact > 0 && C[lact]! > k) lact--;
    if (lim === m && C[m]! <= k && (!best || C[m]! < best.err)) best = { from: S[m]!, to: j, err: C[m]! };
  }
  return best && best.to > best.from ? best : null;
}

/** Character trigrams of a folded string, counted. */
function grams(s: string): Map<string, number> {
  const g = new Map<string, number>();
  for (let i = 0; i + 3 <= s.length; i++) {
    const t = s.slice(i, i + 3);
    g.set(t, (g.get(t) ?? 0) + 1);
  }
  return g;
}
function overlap(a: Map<string, number>, b: Map<string, number>): number {
  let n = 0;
  for (const [t, c] of a) n += Math.min(c, b.get(t) ?? 0);
  return n;
}

/** The sentence of the page (or two that follow each other) most like `q`: most of its trigrams in it (recall at least a half), and not drowned in a much longer stretch. */
function bestSentence(page: FoldedPage, q: string): Hit | null {
  const qg = grams(q);
  const qn = Math.max(1, q.length - 2);
  const cuts = [0, ...page.breaks.filter((b) => b > 0 && b < page.text.length), page.text.length];
  let best: (Hit & { score: number }) | null = null;
  for (let a = 0; a + 1 < cuts.length; a++) {
    for (let w = 1; w <= 2 && a + w < cuts.length; w++) {
      const from = cuts[a]!;
      const to = cuts[a + w]!;
      const s = page.text.slice(from, to);
      if (s.length < 3) continue;
      const hits = overlap(qg, grams(s));
      const recall = hits / qn;
      const precision = hits / Math.max(1, s.length - 2);
      const score = (2 * recall * precision) / Math.max(1e-9, recall + precision);
      if (recall >= 0.5 && score >= 0.35 && (!best || score > best.score + 1e-9)) best = { from, to, err: q.length - hits, score };
    }
  }
  return best;
}

/** The longest start, or end, of `q` that is on the page exactly (a selection that ran over onto the next page): at least 24 letters and half of the quote. */
function longestEnd(hay: string, q: string): Hit | null {
  const need = Math.max(24, Math.ceil(q.length / 2));
  const grow = (has: (len: number) => boolean) => {
    if (!has(need)) return 0;
    let lo = need;
    let hi = q.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (has(mid)) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const head = grow((len) => hay.includes(q.slice(0, len)));
  const tail = grow((len) => hay.includes(q.slice(q.length - len)));
  if (head === 0 && tail === 0) return null;
  const piece = head >= tail ? q.slice(0, head) : q.slice(q.length - tail);
  const from = hay.indexOf(piece);
  return { from, to: from + piece.length, err: q.length - piece.length };
}

/** The quote found in the page's letters: exactly, then closely (`close`), from position `after` on. */
function search(hay: string, q: string, after: number, close: boolean): Hit | null {
  const at = hay.indexOf(q, after);
  if (at >= 0) return { from: at, to: at + q.length, err: 0 };
  if (!close || q.length < 16 || q.length > MAX_CLOSE) return null;
  // a short quote may differ in fewer letters (else a near miss of a few words would be found anywhere)
  const hit = closest(after > 0 ? hay.slice(after) : hay, q, Math.floor(q.length / (q.length < 40 ? 6 : 4)));
  return hit ? { from: hit.from + after, to: hit.to + after, err: hit.err } : null;
}

const partOf = (page: FoldedPage, from: number, to: number): QuoteAnchorPart => ({
  first: { span: page.span[from]!, start: page.start[from]!, end: page.end[from]! },
  last: { span: page.span[to - 1]!, start: page.start[to - 1]!, end: page.end[to - 1]! },
});

/** Where `quote` is on a page whose letters are `page` (see the top of this file). Null when it is not there, or is too short to look for. */
export function findQuote(page: FoldedPage, quote: string, opts: QuoteAnchorOptions = {}): QuoteAnchor | null {
  if (words(quote).length < (opts.minWords ?? 2)) return null;
  const hay = page.text;
  const q = fold(quote);
  if (q.length < 4 || hay.length === 0) return null;
  const one = (h: Hit, how: QuoteAnchorHow): QuoteAnchor => ({ parts: [partOf(page, h.from, h.to)], how, matched: Math.max(0, q.length - h.err), of: q.length });

  const exact = hay.indexOf(q);
  if (exact >= 0) return one({ from: exact, to: exact + q.length, err: 0 }, "exact");

  // a model's quote of two stretches joined with an ellipsis: each piece of eight letters or more, in order; pieces close together are one stretch
  const pieces = quote.split(GAP).map((p) => fold(p)).filter((p) => p.length >= 8);
  if (pieces.length > 1) {
    const found: Hit[] = [];
    let after = 0;
    for (const p of pieces) {
      const h = search(hay, p, after, true);
      if (h) {
        found.push(h);
        after = h.to;
      }
    }
    if (found.length > 0) {
      const spans: Hit[] = [];
      for (const h of found) {
        const last = spans[spans.length - 1];
        if (last && h.from - last.to <= 400) last.to = h.to;
        else spans.push({ ...h });
      }
      const got = found.reduce((n, h) => n + (h.to - h.from - h.err), 0);
      return { parts: spans.map((h) => partOf(page, h.from, h.to)), how: "pieces", matched: got, of: pieces.reduce((n, p) => n + p.length, 0) };
    }
  }

  // closely, or in part: a selection that ran over onto the next page also has a near match (its own text and some letters after it, changed), so the exact part wins unless the near
  // match is clearly closer (a word changed at the end of a quote leaves a long exact start too)
  const near = search(hay, q, 0, true);
  const part = longestEnd(hay, q);
  if (part && (!near || part.err <= near.err * 1.5)) return one(part, "part");
  if (near) return one(near, "close");
  if (opts.sentence) {
    const s = bestSentence(page, q);
    if (s) return one(s, "sentence");
  }
  return null;
}

/**
 * Where a saved quote sits among the pieces of text of a rendered page: the first and the last letter of it, each with the piece it is in and its characters there
 * (`findQuote` with a highlight's rules: no sentence fallback). The span of the first part to the last. Null when it is not on the page.
 */
export function locateInSpans(texts: readonly string[], quote: string, minWords = 2): { first: SpanPos; last: SpanPos; matched: number; of: number } | null {
  const at = findQuote(foldSpans(texts), quote, { minWords });
  if (!at) return null;
  return { first: at.parts[0]!.first, last: at.parts[at.parts.length - 1]!.last, matched: at.matched, of: at.of };
}

/* ---------------------------------------------------------------- the exported PDF: the same passage as shapes on the page (was quote-quads.ts) */

/** A piece of text on a page as pdf.js reports it, with where it is on the page as the reader sees it (rotation included): `p` is the start of its box, `along` the vector to the end of the text, `up` the vector from the bottom of the box to the top. */
export type TextBox = { str: string; p: readonly [number, number]; along: readonly [number, number]; up: readonly [number, number] };
export type Quad = [[number, number], [number, number], [number, number], [number, number]];

/**
 * The four-cornered shapes that cover a quote on a page: one for each piece of text it touches, from where the quote starts in the first piece to where it ends in the last.
 * This uses the same matching as the highlights drawn on screen (`findQuote`), so the exported page marks the same letters. Positions inside one piece of text are
 * worked out from the character counts, which is exact for fixed-width text and close for the rest. Null when the quote is not on the page.
 */
export function quadsForQuote(items: readonly TextBox[], quote: string): Quad[] | null {
  const at = findQuote(foldSpans(items.map((i) => i.str)), quote);
  if (!at) return null;
  const out: Quad[] = [];
  for (const part of at.parts) {
    for (let s = part.first.span; s <= part.last.span; s++) {
      const it = items[s];
      if (!it || it.str.length === 0) continue;
      const from = s === part.first.span ? part.first.start : 0;
      const to = s === part.last.span ? part.last.end : it.str.length;
      if (to <= from) continue;
      const t0 = from / it.str.length;
      const t1 = to / it.str.length;
      const a: [number, number] = [it.p[0] + it.along[0] * t0, it.p[1] + it.along[1] * t0];
      const b: [number, number] = [it.p[0] + it.along[0] * t1, it.p[1] + it.along[1] * t1];
      out.push([a, b, [b[0] + it.up[0], b[1] + it.up[1]], [a[0] + it.up[0], a[1] + it.up[1]]]);
    }
  }
  return out.length > 0 ? out : null;
}
