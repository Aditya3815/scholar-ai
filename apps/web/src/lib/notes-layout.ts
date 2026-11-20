import type { DocRun, NoteStroke } from "@scholar/shared";

/**
 * Where ink on the pages of notes lands in our PDF and in Word (docs/design/paper-reader.md, 25.7 and 25.8): the line-breaker that lays a paragraph out word by word (the PDF draws its
 * lines; for Word it predicts them), knowing for every piece of a line the offset of its first character in the block's plain text, and the stroke's points in points from its anchor. Pure:
 * the fonts are handed in (pdf-lib's standard fonts in the page, a fake in a test). An anchor is the middle of its character, on screen (lib/note-ink.ts) and here alike.
 */

/** The text's size the ink is measured in (1 em = 11 pt), and where a line's middle is above its baseline, in em (the middle of a line box on screen). */
export const EM_PT = 11;
export const MID = 0.33;
const DEVANAGARI = /[\u0900-\u097f\ua8e0-\ua8ff]/;

/** A run of text, with the offset of its first character in its block's plain text (mdPlain: what an ink anchor counts in); a line break has none. */
export type LayoutRun = DocRun & { o?: number };
type Run = LayoutRun;

/**
 * A stroke's points in points, y down: a text stroke from its anchor (`x`, `mid`: the middle of the character and of its line), a box stroke from its box's top left (`x`, `mid` = the top)
 * scaled by the box's width. The width of the line in points too.
 */
export function strokePts(s: NoteStroke, x: number, mid: number, boxW: number): { pts: number[]; w: number } {
  const u = s.a.k === "text" ? EM_PT / 100 : boxW / 10_000;
  const pts: number[] = [];
  for (let i = 0; i < s.pts.length; i += 3) pts.push(x + s.pts[i]! * u, mid + s.pts[i + 1]! * u, s.pts[i + 2]! / 100);
  return { pts, w: s.w * u };
}

/* ---------------------------------------------------------------- the line-breaker (the PDF's, and Word's prediction) */

export type Font = { widthOfTextAtSize: (s: string, size: number) => number; getCharacterSet: () => number[] };
export type Fonts = { r: Font; b: Font; i: Font; bi: Font; deva: Font | null };
type Part = { s: string; font: Font; u?: boolean; o?: number; len: number };
type Line = { parts: (Part & { x: number })[]; brk: boolean };

export function makeBreaker(fonts: Fonts) {
  const shown = new Set(fonts.r.getCharacterSet());
  /** A run cut into pieces of one script: Devanagari in its face, the rest in Helvetica (a letter Helvetica cannot draw becomes "?"); each piece knows its plain-text offset. */
  const pieces = (r: Run, t: string, o: number | undefined): Part[] => {
    const latin = r.b && r.i ? fonts.bi : r.b ? fonts.b : r.i ? fonts.i : fonts.r;
    const out: Part[] = [];
    let off = o;
    for (const ch of t) {
      const isDeva = DEVANAGARI.test(ch) || ch === "‍" || ch === "‌";
      const font = isDeva && fonts.deva ? fonts.deva : latin;
      const c = font === latin && !shown.has(ch.codePointAt(0)!) && ch !== " " ? "?" : ch;
      const last = out[out.length - 1];
      if (last && last.font === font) {
        last.s += c;
        last.len += ch.length;
      } else out.push({ s: c, font, len: ch.length, ...(off !== undefined ? { o: off } : {}), ...(r.u ? { u: true } : {}) });
      if (off !== undefined) off += ch.length;
    }
    return out;
  };
  /** Runs broken into lines `max` wide at `size`: each line's pieces with their x (from the line's start). */
  const lines = (runs: Run[], size: number, max: number): Line[] => {
    type Word = { parts: Part[]; w: number; brk?: boolean };
    const words: Word[] = [];
    for (const r of runs) {
      let o = r.o;
      r.t.split("\n").forEach((ln, li) => {
        if (li > 0) words.push({ parts: [], w: 0, brk: true });
        for (const tok of ln.split(/(\s+)/)) {
          if (!tok) continue;
          if (/^\s+$/.test(tok)) words.push({ parts: [{ s: " ", font: fonts.r, len: tok.length, ...(o !== undefined ? { o } : {}), ...(r.u ? { u: true } : {}) }], w: fonts.r.widthOfTextAtSize(" ", size) });
          else {
            const parts = pieces(r, tok, o);
            words.push({ parts, w: parts.reduce((a, p) => a + p.font.widthOfTextAtSize(p.s, size), 0) });
          }
          if (o !== undefined) o += tok.length;
        }
      });
    }
    const out: Line[] = [];
    let line: Word[] = [];
    let lw = 0;
    const flush = (brk: boolean) => {
      let x = 0;
      const parts: Line["parts"] = [];
      for (const w of line)
        for (const p of w.parts) {
          parts.push({ ...p, x });
          x += p.font.widthOfTextAtSize(p.s, size);
        }
      out.push({ parts, brk });
      line = [];
      lw = 0;
    };
    for (const w of words) {
      if (w.brk) {
        flush(true);
        continue;
      }
      if (lw + w.w > max && line.length) {
        flush(false);
        if (w.parts.length === 1 && w.parts[0]!.s === " ") continue;
      }
      line.push(w);
      lw += w.w;
    }
    if (line.length || !out.length) flush(false);
    return out;
  };
  /** Where character `at` is on a line: the x of its middle (as the page measures an anchor), or null when the line does not hold it. */
  const xOf = (l: Line, at: number, size: number): number | null => {
    for (const p of l.parts)
      if (p.o !== undefined && at >= p.o && at < p.o + p.len) {
        const k = at - p.o;
        return p.x + p.font.widthOfTextAtSize(p.s.slice(0, k), size) + p.font.widthOfTextAtSize(p.s.slice(k, k + 1), size) / 2;
      }
    return null;
  };
  return { lines, xOf };
}
