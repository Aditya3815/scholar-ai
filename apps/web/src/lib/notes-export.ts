import { DOCX_MIME, buildDocx, inkHex, parseNotebookMd, type CaptureBlock, type DocRun, type Block as DocBlock, type MdInline, type NotebookBlock, type QuoteColor, type SketchBlock } from "@scholar/shared";
import devanagariFace from "@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff?url";
import { drawCapture } from "./capture";
import { markerPath, penPath } from "./ink-path";
import type { PDFDocumentProxy } from "./pdf";

/**
 * The Notebook's pages as a PDF or a Word file (docs/design/paper-reader.md, 21.1, 4), made in the browser: nothing is sent anywhere. A lazy chunk, fetched when Export asks for one.
 * Text keeps its headings, lists, bold and italic; a quote its meaning and page; a capture is drawn from the open paper and a sketch from its strokes, both put in as PNG pictures.
 * The PDF writes Latin text in Helvetica and Devanagari in Noto Sans Devanagari, which (with fontkit) is fetched and embedded, as a subset, only when the text has Devanagari.
 */
export type ExportPage = { title: string; blocks: readonly NotebookBlock[] };
export type ExportArgs = { docTitle: string; pages: readonly ExportPage[]; names: Record<QuoteColor, string>; pdf: PDFDocumentProxy | null };
type Png = { bytes: Uint8Array; w: number; h: number };

const DEVANAGARI = /[ऀ-ॿ꣠-ꣿ]/;
const PICTURE_WIDTH = 900;

const pngOf = (c: HTMLCanvasElement) =>
  new Promise<Uint8Array>((res, rej) => c.toBlob((b) => (b ? b.arrayBuffer().then((a) => res(new Uint8Array(a)), rej) : rej(new Error("no picture"))), "image/png"));

/** A capture as a PNG, drawn from the open paper. */
async function capturePng(pdf: PDFDocumentProxy, b: CaptureBlock): Promise<Png> {
  const c = document.createElement("canvas");
  const h = await drawCapture(pdf, c, b.page, b, PICTURE_WIDTH);
  return { bytes: await pngOf(c), w: PICTURE_WIDTH, h: Math.round(h) };
}

/** A sketch as a PNG on white, at twice its pixels (its height grows to hold its lowest stroke, as on screen). */
export async function sketchPng(b: SketchBlock, width = PICTURE_WIDTH): Promise<Png> {
  const lowest = b.strokes.reduce((m, s) => {
    for (let i = 1; i < s.pts.length; i += 3) m = Math.max(m, s.pts[i]!);
    return m;
  }, 0);
  const h = Math.max(b.height, Math.ceil(lowest * width + 12));
  const c = document.createElement("canvas");
  c.width = width * 2;
  c.height = h * 2;
  const ctx = c.getContext("2d")!;
  ctx.scale(2, 2);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, h);
  for (const s of b.strokes) {
    if (s.tool === "pen") {
      ctx.globalAlpha = 1;
      ctx.fillStyle = inkHex("pen", s.color);
      ctx.fill(new Path2D(penPath(s.pts, s.w, width)));
    } else {
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = inkHex("highlighter", s.color);
      ctx.lineWidth = s.w * width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke(new Path2D(markerPath(s.pts, width)));
    }
  }
  return { bytes: await pngOf(c), w: width, h };
}

const pictureOf = async (b: NotebookBlock, pdf: PDFDocumentProxy | null): Promise<Png | null> => {
  try {
    if (b.kind === "sketch") return await sketchPng(b);
    if (b.kind === "capture" && pdf) return await capturePng(pdf, b);
  } catch {
    /* written as words instead */
  }
  return null;
};

const captureLine = (b: CaptureBlock) => `${b.caption ? `${b.caption} (` : "("}p. ${b.page})`;

/** Markdown's inline marks as runs: bold, italic (underline and mark keep their words). */
function runsOf(c: MdInline[], style: { b?: boolean; i?: boolean } = {}): DocRun[] {
  const out: DocRun[] = [];
  for (const x of c) {
    if (x.t === "text") out.push({ t: x.s, ...(style.b ? { b: true } : {}), ...(style.i ? { i: true } : {}) });
    else if (x.t === "br") out.push({ t: "\n" });
    else out.push(...runsOf(x.c, { ...style, ...(x.t === "b" ? { b: true } : x.t === "i" ? { i: true } : {}) }));
  }
  return out;
}

/* ---------------------------------------------------------------- Word */

export async function notesDocx(args: ExportArgs): Promise<Blob> {
  const blocks: DocBlock[] = [{ k: "title", runs: [{ t: args.docTitle || "Notes" }] }];
  const media: Record<string, Uint8Array> = {};
  for (const p of args.pages) {
    blocks.push({ k: "h1", runs: [{ t: p.title.trim() || "Untitled page" }] });
    for (const b of p.blocks) {
      if (b.kind === "text") {
        for (const m of parseNotebookMd(b.md)) {
          if (m.t === "h") blocks.push({ k: m.level === 1 ? "h2" : "h3", runs: runsOf(m.c) });
          else if (m.t === "p") blocks.push({ k: "p", runs: runsOf(m.c) });
          else if (m.t === "ul") for (const it of m.items) blocks.push({ k: "bullet", runs: runsOf(it) });
          else m.items.forEach((it, i) => blocks.push({ k: "ref", no: m.start + i, runs: runsOf(it) }));
        }
      } else if (b.kind === "quote") {
        blocks.push({ k: "note", runs: [{ t: `“${b.quote}”`, i: true }, { t: `\n${args.names[b.color]}, p. ${b.page}`, b: true }] });
      } else if (b.kind === "capture" || b.kind === "sketch") {
        const png = await pictureOf(b, args.pdf);
        const name = `image${Object.keys(media).length + 1}.png`;
        const alt = b.kind === "capture" ? `A part of page ${b.page}${b.caption ? `: ${b.caption}` : ""}` : "A sketch";
        if (png) {
          media[name] = png.bytes;
          blocks.push({ k: "image", media: name, w: png.w, h: png.h, alt });
        }
        if (b.kind === "capture") blocks.push({ k: "p", runs: [{ t: png ? captureLine(b) : `A part of page ${b.page} ${captureLine(b)}`, i: true }] });
        else if (!png) blocks.push({ k: "p", runs: [{ t: "A sketch", i: true }] });
      } else {
        blocks.push({ k: "p", runs: [{ t: b.agent, b: true }, { t: `\n${b.text}` }] });
      }
    }
  }
  const { zipSync, strToU8 } = await import("fflate");
  const parts = buildDocx({ title: `${args.docTitle || "Notes"}: notes`, author: "Sodhsetu", created: new Date(), lang: DEVANAGARI.test(JSON.stringify(args.pages)) ? "hi-IN" : "en-IN", blocks });
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const [path, xml] of Object.entries(parts)) files[path] = [strToU8(xml), { level: 6 }];
  for (const [name, bytes] of Object.entries(media)) files[`word/media/${name}`] = [bytes, { level: 0 }];
  return new Blob([zipSync(files) as BlobPart], { type: DOCX_MIME });
}

/* ---------------------------------------------------------------- PDF */

type Run = { t: string; b?: boolean; i?: boolean };

export async function notesPdf(args: ExportArgs): Promise<Uint8Array> {
  const lib = await import("@cantoo/pdf-lib");
  const { PDFDocument, StandardFonts, rgb } = lib;
  const doc = await PDFDocument.create();
  doc.setTitle(`${args.docTitle || "Notes"}: notes`);
  doc.setCreator("Sodhsetu");
  doc.setProducer("Sodhsetu");
  const fonts = {
    r: await doc.embedFont(StandardFonts.Helvetica),
    b: await doc.embedFont(StandardFonts.HelveticaBold),
    i: await doc.embedFont(StandardFonts.HelveticaOblique),
    bi: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  type Font = typeof fonts.r;
  const shown = new Set(fonts.r.getCharacterSet());
  let deva: Font | null = null;
  if (DEVANAGARI.test(JSON.stringify(args.pages)) || DEVANAGARI.test(args.docTitle)) {
    const fontkit = (await import("@cantoo/fontkit")).default;
    doc.registerFontkit(fontkit);
    const face = await (await fetch(devanagariFace)).arrayBuffer();
    deva = await doc.embedFont(face, { subset: true });
  }
  const W = 595.28;
  const H = 841.89;
  const M = 56;
  const TW = W - 2 * M;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const ink = rgb(0.1, 0.11, 0.13);
  const muted = rgb(0.38, 0.38, 0.4);
  const need = (h: number) => {
    if (y - h < M) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
  };
  /** A run cut into pieces of one script: Devanagari in its face, the rest in Helvetica (a letter Helvetica cannot draw becomes "?"). */
  const pieces = (r: Run): { s: string; font: Font }[] => {
    const latin = r.b && r.i ? fonts.bi : r.b ? fonts.b : r.i ? fonts.i : fonts.r;
    const out: { s: string; font: Font }[] = [];
    for (const ch of r.t) {
      const isDeva = DEVANAGARI.test(ch) || (ch === "‍" || ch === "‌");
      const font = isDeva && deva ? deva : latin;
      const c = font === latin && !shown.has(ch.codePointAt(0)!) && ch !== " " ? "?" : ch;
      const last = out[out.length - 1];
      if (last && last.font === font) last.s += c;
      else out.push({ s: c, font });
    }
    return out;
  };
  /** Writes runs as wrapped lines at `size`, `indent` from the margin; returns nothing, moves y. */
  const write = (runs: Run[], size: number, opts: { indent?: number; color?: ReturnType<typeof rgb>; gap?: number; prefix?: string } = {}) => {
    const indent = opts.indent ?? 0;
    const lead = size * 1.4;
    // words, each a list of pieces; a line break starts a new line
    type Word = { parts: { s: string; font: Font }[]; w: number; brk?: boolean };
    const words: Word[] = [];
    for (const r of runs) {
      const lines = r.t.split("\n");
      lines.forEach((ln, li) => {
        if (li > 0) words.push({ parts: [], w: 0, brk: true });
        for (const tok of ln.split(/(\s+)/)) {
          if (!tok) continue;
          if (/^\s+$/.test(tok)) {
            words.push({ parts: [{ s: " ", font: fonts.r }], w: fonts.r.widthOfTextAtSize(" ", size) });
            continue;
          }
          const parts = pieces({ ...r, t: tok });
          words.push({ parts, w: parts.reduce((a, p) => a + p.font.widthOfTextAtSize(p.s, size), 0) });
        }
      });
    }
    const max = TW - indent;
    let line: Word[] = [];
    let lw = 0;
    let first = true;
    const flush = () => {
      need(lead);
      y -= lead;
      let x = M + indent;
      if (first && opts.prefix) page.drawText(opts.prefix, { x: M + indent - 14, y, size, font: fonts.r, color: opts.color ?? ink });
      first = false;
      for (const w of line) for (const p of w.parts) {
        if (p.s.trim() || p.s === " ") page.drawText(p.s, { x, y, size, font: p.font, color: opts.color ?? ink });
        x += p.font.widthOfTextAtSize(p.s, size);
      }
      line = [];
      lw = 0;
    };
    for (const w of words) {
      if (w.brk) {
        flush();
        continue;
      }
      if (lw + w.w > max && line.length) {
        flush();
        if (w.parts.length === 1 && w.parts[0]!.s === " ") continue;
      }
      line.push(w);
      lw += w.w;
    }
    if (line.length || first) flush();
    y -= opts.gap ?? size * 0.5;
  };
  const picture = async (png: Png) => {
    const img = await doc.embedPng(png.bytes);
    const scale = Math.min(TW / png.w, (H - 2 * M) / png.h, 1);
    const w = png.w * scale;
    const h = png.h * scale;
    need(h + 6);
    y -= h;
    page.drawImage(img, { x: M, y, width: w, height: h });
    y -= 6;
  };

  write([{ t: args.docTitle || "Notes", b: true }], 18, { gap: 14 });
  for (const p of args.pages) {
    need(40);
    write([{ t: p.title.trim() || "Untitled page", b: true }], 15, { gap: 8 });
    for (const b of p.blocks) {
      if (b.kind === "text") {
        for (const m of parseNotebookMd(b.md)) {
          if (m.t === "h") write(runsOf(m.c).map((r) => ({ ...r, b: true })), m.level === 1 ? 13 : 12, { gap: 4 });
          else if (m.t === "p") write(runsOf(m.c), 11);
          else if (m.t === "ul") for (const it of m.items) write(runsOf(it), 11, { indent: 16, prefix: "•", gap: 2 });
          else m.items.forEach((it, i) => write(runsOf(it), 11, { indent: 20, prefix: `${m.start + i}.`, gap: 2 }));
        }
      } else if (b.kind === "quote") {
        const top = y;
        write([{ t: `“${b.quote}”`, i: true }], 11, { indent: 12, gap: 1 });
        write([{ t: `${args.names[b.color]}, p. ${b.page}`, b: true }], 9, { indent: 12, color: muted, gap: 4 });
        if (top > y) page.drawRectangle({ x: M, y: y + 4, width: 2.5, height: Math.min(top - y - 4, H), color: rgb(0.62, 0.5, 0.1) });
        y -= 4;
      } else if (b.kind === "capture" || b.kind === "sketch") {
        const png = await pictureOf(b, args.pdf);
        if (png) await picture(png);
        if (b.kind === "capture") write([{ t: png ? captureLine(b) : `A part of page ${b.page} ${captureLine(b)}`, i: true }], 9, { color: muted });
        else if (!png) write([{ t: "A sketch", i: true }], 9, { color: muted });
      } else {
        write([{ t: b.agent, b: true }], 11, { gap: 2 });
        write([{ t: b.text }], 11);
      }
    }
    y -= 8;
  }
  return doc.save();
}

const slug = (s: string) => s.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "paper";
/** notes-<paper>-<date>.<ext> for all pages, notes-<paper>-<page>-<date>.<ext> for one (as the Markdown's). */
export function notesFileName(docTitle: string, pageTitle: string | null, ext: "pdf" | "docx"): string {
  const d = new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `notes-${slug(docTitle)}-${pageTitle === null ? "" : `${slug(pageTitle || "page")}-`}${date}.${ext}`;
}
