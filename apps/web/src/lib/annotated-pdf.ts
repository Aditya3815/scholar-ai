import { DEFAULT_LEGEND, STICKY_SIDE, arrowHead, itemHex, quadsForQuote, shapeOutline, type DocNote, type InkItem, type Legend, type NoteColor, type Quad, type TextBox } from "@scholar/shared";
import type { PDFDocumentProxy, PDFPageProxy } from "./pdf";
import { penOutline } from "../components/papers/InkLayer";

/** The colours of the text highlights on screen (`--hl-*` in workspace.css), for a white page. */
const NOTE_HEX: Record<NoteColor, string> = { yellow: "#f2cf3e", green: "#7fcf93", blue: "#7ab0ee", pink: "#f08fb4" };

export class ExportError extends Error {}

export type ExportReport = {
  /** pen, highlighter and shapes */
  strokes: number;
  /** text boxes and sticky notes drawn on pages */
  texts: number;
  highlights: number;
  /** Text highlights whose words could not be found on their page (a scan, or text the PDF does not keep in order): they are listed on the notes page but not marked. */
  notPlaced: number;
  notesPage: boolean;
  /** Characters of notes that the notes page's font cannot show (they are replaced by "?"). */
  replacedChars: number;
};

type Viewport = ReturnType<PDFPageProxy["getViewport"]>;

const rgbOf = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];

/** The pieces of text of a page, each with its box as the reader sees the page (so a turned page or turned text is handled by pdf.js, not by guessing). */
async function textBoxes(page: PDFPageProxy, vp: Viewport): Promise<TextBox[]> {
  const content = await page.getTextContent();
  const out: TextBox[] = [];
  for (const it of content.items) {
    if (!("str" in it)) continue;
    const [a, b, c, d, e, f] = it.transform as number[];
    const sx = Math.hypot(a!, b!) || 1;
    const sy = Math.hypot(c!, d!) || 1;
    const h = it.height || sy;
    // user space: the box runs from a little below the baseline to a little above the letters
    const ux: [number, number] = [a! / sx, b! / sx];
    const uy: [number, number] = [c! / sy, d! / sy];
    const o: [number, number] = [e! - 0.2 * h * uy[0], f! - 0.2 * h * uy[1]];
    const at = (x: number, y: number) => vp.convertToViewportPoint(x, y) as [number, number];
    const p = at(o[0], o[1]);
    const end = at(o[0] + ux[0] * it.width, o[1] + ux[1] * it.width);
    const top = at(o[0] + uy[0] * h, o[1] + uy[1] * h);
    out.push({ str: it.str, p, along: [end[0] - p[0], end[1] - p[1]], up: [top[0] - p[0], top[1] - p[1]] });
  }
  return out;
}

/**
 * A copy of the paper with the reader's marks drawn into it: text highlights, the highlighter and the pen, in the colours of the screen, and a last page that lists the
 * notes. The original file is not changed. Everything happens in the browser; nothing is sent anywhere.
 *
 * Positions come from pdf.js's own page view (`convertToPdfPoint`), which knows about page rotation and crop boxes, so a marked page lands where it was on screen.
 */
export async function buildAnnotatedPdf(args: {
  original: ArrayBuffer;
  pdf: PDFDocumentProxy;
  title: string;
  notes: DocNote[];
  strokes: InkItem[];
  legend?: Legend;
  notesPage?: boolean;
}): Promise<{ bytes: Uint8Array; report: ExportReport }> {
  const lib = await import("@cantoo/pdf-lib");
  const { PDFDocument, StandardFonts, degrees, rgb, pushGraphicsState, popGraphicsState, setGraphicsState, setFillingRgbColor, setStrokingRgbColor, setLineWidth, setLineCap, setLineJoin, moveTo, lineTo, closePath, fill, fillAndStroke, stroke, LineCapStyle, LineJoinStyle } = lib;
  const legend = args.legend ?? DEFAULT_LEGEND;

  let doc: Awaited<ReturnType<typeof PDFDocument.load>>;
  try {
    doc = await PDFDocument.load(args.original, { updateMetadata: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (/encrypt/i.test(msg)) throw new ExportError("This PDF is protected with a password or permissions, so a marked-up copy cannot be made from it.");
    throw new ExportError("A marked-up copy could not be made from this PDF.");
  }
  if (doc.getPageCount() !== args.pdf.numPages) throw new ExportError("A marked-up copy could not be made from this PDF.");

  // multiply, so the colour goes over the words instead of covering them (the same as on screen)
  const multiply = doc.context.register(doc.context.obj({ Type: "ExtGState", BM: "Multiply", CA: 1, ca: 1 }));
  const report: ExportReport = { strokes: 0, texts: 0, highlights: 0, notPlaced: 0, notesPage: false, replacedChars: 0 };

  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const helvShown = new Set(helv.getCharacterSet());
  /** Helvetica shows Western European letters only: anything else becomes "?" and is counted, so the reader is told. */
  const latin = (s: string) => [...s].map((ch) => (helvShown.has(ch.codePointAt(0)!) ? ch : (report.replacedChars++, "?"))).join("");

  const pageNumbers = [...new Set([...args.notes.map((n) => n.page), ...args.strokes.map((s) => s.page)])].filter((n) => n >= 1 && n <= args.pdf.numPages).sort((a, b) => a - b);
  for (const n of pageNumbers) {
    const jsPage = await args.pdf.getPage(n);
    const vp = jsPage.getViewport({ scale: 1 });
    const page = doc.getPage(n - 1);
    const toPdf = (x: number, y: number) => vp.convertToPdfPoint(x, y) as [number, number];
    const poly = (pts: ArrayLike<readonly [number, number]>, close: boolean) => {
      const ops = [] as ReturnType<typeof moveTo>[];
      for (let i = 0; i < pts.length; i++) {
        const [x, y] = toPdf(pts[i]![0], pts[i]![1]);
        ops.push(i === 0 ? moveTo(x, y) : lineTo(x, y));
      }
      if (close) ops.push(closePath() as never);
      return ops;
    };
    const gs = page.node.newExtGState("ScholarMultiply", multiply);

    // 1. text highlights (under the drawing)
    const mine = args.notes.filter((x) => x.page === n);
    if (mine.length > 0) {
      const boxes = await textBoxes(jsPage, vp);
      for (const note of mine) {
        const quads: Quad[] | null = quadsForQuote(boxes, note.quote);
        if (!quads) {
          report.notPlaced++;
          continue;
        }
        const [r, g, b] = rgbOf(NOTE_HEX[note.color]);
        const ops: unknown[] = [pushGraphicsState(), setGraphicsState(gs), setFillingRgbColor(r, g, b)];
        for (const q of quads) ops.push(...poly(q, true), fill());
        ops.push(popGraphicsState());
        page.pushOperators(...(ops as Parameters<typeof page.pushOperators>));
        report.highlights++;
      }
    }

    // 2. the highlighter first (it goes under), then pens and shapes in the order they were drawn, then text boxes and sticky notes
    const W = vp.width;
    const ink = args.strokes.filter((s) => s.page === n);
    const thick = (w: number) => Math.max(0.6, w * W);
    for (const s of [...ink.filter((x) => x.tool === "highlighter"), ...ink.filter((x) => x.tool === "pen" || x.tool === "shape")]) {
      if (s.tool === "text" || s.tool === "sticky") continue;
      const [r, g, b] = rgbOf(itemHex(s));
      if (s.tool === "pen") {
        const outline = penOutline(s.pts, s.w, W) as [number, number][];
        if (outline.length < 3) continue;
        page.pushOperators(pushGraphicsState(), setFillingRgbColor(r, g, b), ...poly(outline, true), fill(), popGraphicsState());
      } else if (s.tool === "highlighter") {
        const pts: [number, number][] = [];
        for (let i = 0; i < s.pts.length; i += 3) pts.push([s.pts[i]! * W, s.pts[i + 1]! * W]);
        if (pts.length === 1) pts.push([pts[0]![0] + 0.01, pts[0]![1]]);
        page.pushOperators(pushGraphicsState(), setGraphicsState(gs), setStrokingRgbColor(r, g, b), setLineWidth(s.w * W), setLineCap(LineCapStyle.Butt), setLineJoin(LineJoinStyle.Round), ...poly(pts, false), stroke(), popGraphicsState());
      } else if (s.tool === "shape") {
        // a shape: a line or an outline in the pen colour; an arrow also has a filled head
        const scaled = (o: readonly (readonly [number, number])[]) => o.map(([x, y]) => [x * W, y * W] as [number, number]);
        const head = s.kind === "arrow" ? arrowHead([s.pts[0]!, s.pts[1]!], [s.pts[3]!, s.pts[4]!], s.w) : null;
        const outline = head ? scaled([[s.pts[0]!, s.pts[1]!], head.stop]) : scaled(shapeOutline(s));
        page.pushOperators(pushGraphicsState(), setStrokingRgbColor(r, g, b), setLineWidth(thick(s.w)), setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round), ...poly(outline, s.kind === "rect" || s.kind === "ellipse"), stroke(), popGraphicsState());
        if (head) page.pushOperators(pushGraphicsState(), setFillingRgbColor(r, g, b), setStrokingRgbColor(r, g, b), setLineWidth(thick(s.w) * 0.5), setLineJoin(LineJoinStyle.Round), ...poly(scaled([head.tip, head.left, head.right]), true), fillAndStroke(), popGraphicsState());
      }
      report.strokes++;
    }
    for (const s of ink) {
      if (s.tool === "text") {
        const fs = s.size * W;
        const [r, g, b] = rgbOf(itemHex(s));
        const maxW = s.w * W;
        // the browser wrapped the words by its own font; they are wrapped again here with Helvetica's widths, so the lines can break in other places
        const lines: string[] = [];
        for (const para of latin(s.text).split(/\r?\n/)) {
          let cur = "";
          for (const word of para.split(/ +/)) {
            const trial = cur ? `${cur} ${word}` : word;
            if (!cur || helv.widthOfTextAtSize(trial, fs) <= maxW) cur = trial;
            else {
              lines.push(cur);
              cur = word;
            }
          }
          lines.push(cur);
        }
        const o = toPdf(s.x * W, s.y * W);
        const along = toPdf(s.x * W + 1, s.y * W);
        const angle = (Math.atan2(along[1] - o[1], along[0] - o[0]) * 180) / Math.PI;
        lines.forEach((line, i) => {
          if (!line) return;
          const at = toPdf(s.x * W, s.y * W + (i * 1.3 + 1.0) * fs);
          page.drawText(line, { x: at[0], y: at[1], size: fs, font: helv, color: rgb(r, g, b), rotate: degrees(angle) });
        });
        report.texts++;
      } else if (s.tool === "sticky") {
        const [r, g, b] = rgbOf(itemHex(s));
        const side = STICKY_SIDE * W;
        const q: [number, number][] = [[s.x * W, s.y * W], [s.x * W + side, s.y * W], [s.x * W + side, s.y * W + side], [s.x * W, s.y * W + side]];
        page.pushOperators(pushGraphicsState(), setFillingRgbColor(r, g, b), setStrokingRgbColor(0.35, 0.3, 0.1), setLineWidth(0.6), ...poly(q, true), fillAndStroke(), popGraphicsState());
        report.texts++;
      }
    }
  }

  // 3. the notes, listed on a page of their own at the end (the marks above show where; this shows what was written)
  const listed = args.notes;
  const stickies = args.strokes.filter((s): s is Extract<InkItem, { tool: "sticky" }> => s.tool === "sticky" && s.text.trim() !== "");
  if (args.notesPage !== false && (listed.length > 0 || stickies.length > 0)) {
    const font = helv;
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    // Helvetica can only show Western European letters; anything else is replaced and counted, so the reader is told rather than shown wrong text
    const shown = helvShown;
    const safe = (s: string) => [...s.replace(/\s+/g, " ")].map((ch) => { if (shown.has(ch.codePointAt(0)!)) return ch; report.replacedChars++; return "?"; }).join("");
    const M = 54, SIZE = 10, LEAD = 14, PW = 595, PH = 842, MAXW = PW - 2 * M;
    let page = doc.addPage([PW, PH]);
    let y = PH - M;
    const wrap = (text: string, f: typeof font, size: number, width: number): string[] => {
      const out: string[] = [];
      let cur = "";
      for (const word of safe(text).split(" ")) {
        const trial = cur ? `${cur} ${word}` : word;
        if (f.widthOfTextAtSize(trial, size) <= width) cur = trial;
        else {
          if (cur) out.push(cur);
          // a word longer than the line is cut
          let rest = word;
          while (f.widthOfTextAtSize(rest, size) > width) {
            let k = rest.length;
            while (k > 1 && f.widthOfTextAtSize(rest.slice(0, k), size) > width) k--;
            out.push(rest.slice(0, k));
            rest = rest.slice(k);
          }
          cur = rest;
        }
      }
      if (cur) out.push(cur);
      return out;
    };
    const line = (text: string, f: typeof font, size: number, indent = 0, color = rgb(0.1, 0.1, 0.12)) => {
      if (y < M + LEAD) {
        page = doc.addPage([PW, PH]);
        y = PH - M;
      }
      page.drawText(text, { x: M + indent, y, size, font: f, color });
      y -= LEAD * (size / SIZE > 1.2 ? 1.5 : 1);
    };
    for (const l of wrap(`Notes on ${args.title}`, bold, 14, MAXW)) line(l, bold, 14);
    y -= 6;
    line("Marked in Sodhsetu. The marks on the pages show where; this page shows what was written.", font, 9, 0, rgb(0.4, 0.4, 0.45));
    y -= 8;
    for (const n of [...listed].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt)) {
      const [r, g, b] = rgbOf(NOTE_HEX[n.color]);
      if (y < M + 3 * LEAD) {
        page = doc.addPage([PW, PH]);
        y = PH - M;
      }
      page.drawRectangle({ x: M, y: y - 2, width: 8, height: 8, color: rgb(r, g, b) });
      line(safe(`Page ${n.page} · ${legend[n.color]}`), bold, SIZE, 14);
      for (const l of wrap(`“${n.quote}”`, font, SIZE, MAXW - 14)) line(l, font, SIZE, 14);
      if (n.note.trim()) for (const l of wrap(n.note, font, SIZE, MAXW - 28)) line(l, font, SIZE, 28, rgb(0.15, 0.25, 0.6));
      y -= 8;
    }
    if (stickies.length > 0) {
      line("Sticky notes", bold, 12);
      for (const s of [...stickies].sort((a, b) => a.page - b.page)) {
        line(safe(`Page ${s.page}`), bold, SIZE, 14);
        for (const l of wrap(s.text, font, SIZE, MAXW - 14)) line(l, font, SIZE, 14, rgb(0.15, 0.25, 0.6));
        y -= 8;
      }
    }
    if (report.replacedChars > 0) line("Some characters could not be shown here and appear as “?”. The full text is in the Markdown export.", font, 9, 0, rgb(0.6, 0.2, 0.1));
    report.notesPage = true;
  }

  const bytes = await doc.save();
  return { bytes, report };
}

