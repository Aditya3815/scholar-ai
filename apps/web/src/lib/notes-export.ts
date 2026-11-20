import { DOCX_MIME, IMAGE_SIZE_WIDTH, agentHeading, buildDocx, inkHex, parseNotebookMd, type CaptureBlock, type DocFloat, type DocRun, type ImageBlock, type Block as DocBlock, type MdBlock, type MdInline, type NotebookBlock, type NoteStroke, type QuoteColor, type SketchBlock } from "@scholar/shared";
import devanagariFace from "@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff?url";
import { drawCapture } from "./capture";
import { markerPath, penPath } from "./ink-path";
import type { PDFDocumentProxy } from "./pdf";

/**
 * The Notebook's pages as a PDF or a Word file (docs/design/paper-reader.md, 21.1, 4), made in the browser: nothing is sent anywhere. A lazy chunk, fetched when Export asks for one.
 * Text keeps its headings, lists, bold and italic; a quote its meaning and page; a capture is drawn from the open paper and a sketch from its strokes, both put in as PNG pictures.
 * The PDF writes Latin text in Helvetica and Devanagari in Noto Sans Devanagari, which (with fontkit) is fetched and embedded, as a subset, only when the text has Devanagari.
 *
 * Ink on the pages (25.7 and 25.8). Our PDF is laid out here, so the place of every character is known: the writer notes where each anchored character lands as it draws its line, moves a
 * line to the next page with the ink below it, and draws the ink last, as vector paths over the text (which stays real text). Word lays out its own text: a page with ink is written in Arial
 * (Helvetica's widths) with exact line spacing, our line-breaker predicts each anchor's line and place, and each paragraph's ink is one transparent picture anchored to that paragraph, in front
 * of the text. Ink on a box (a space, a picture, a capture, a sketch) is placed by the box's width, in both.
 */
export type ExportPage = { title: string; blocks: readonly NotebookBlock[]; ink?: readonly NoteStroke[] };
export type ExportArgs = { docTitle: string; pages: readonly ExportPage[]; names: Record<QuoteColor, string>; pdf: PDFDocumentProxy | null; imageUrl?: (blockId: string) => string };
type Png = { bytes: Uint8Array; w: number; h: number; /** a picture shown narrower than the page: its share of the width */ frac?: number };

const DEVANAGARI = /[ऀ-ॿ꣠-ꣿ]/;
const PICTURE_WIDTH = 900;
/** The text's size the ink is measured in (1 em = 11 pt), and where a line's middle is above its baseline, in em (the middle of a line box on screen). */
const EM_PT = 11;
const MID = 0.33;
/** The width of the text in both files: A4 less two margins of 56 pt (Word's text width is set to this when there is ink). */
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const TEXT_W = PAGE_W - 2 * MARGIN;

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

/** A picture of the notes, fetched (the owner's own, with their cookie) and drawn again as a PNG at most 900 px wide. */
async function imagePng(url: string, b: ImageBlock): Promise<Png> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error("no picture");
  const bitmap = await createImageBitmap(await res.blob());
  const w = Math.min(PICTURE_WIDTH, bitmap.width);
  const h = Math.max(1, Math.round((bitmap.height * w) / bitmap.width));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return { bytes: await pngOf(c), w: Math.min(w, b.w), h: Math.round((h * Math.min(w, b.w)) / w), ...(b.width !== undefined && b.width < 1 ? { frac: b.width } : {}) };
}

/** A block's picture; with ink on it, a capture keeps its share of the width as on screen (S, M, Full), so the ink stays on what it was drawn over. */
const pictureOf = async (b: NotebookBlock, pdf: PDFDocumentProxy | null, imageUrl: ((id: string) => string) | undefined, inked: boolean): Promise<Png | null> => {
  try {
    if (b.kind === "image" && imageUrl) return await imagePng(imageUrl(b.id), b);
    if (b.kind === "sketch") return await sketchPng(b);
    if (b.kind === "capture" && pdf) {
      const png = await capturePng(pdf, b);
      return inked && b.size !== "full" ? { ...png, frac: IMAGE_SIZE_WIDTH[b.size] } : png;
    }
  } catch {
    /* written as words instead */
  }
  return null;
};

const captureLine = (b: CaptureBlock) => `${b.caption ? `${b.caption} (` : "("}p. ${b.page})`;

/** A run of text, with the offset of its first character in its block's plain text (mdPlain: what an ink anchor counts in); a line break has none. */
type Run = DocRun & { o?: number };

/** Markdown's inline marks as runs: bold, italic and underline (a mark keeps its words). `at` counts the plain text as it goes. */
function runsOf(c: MdInline[], style: { b?: boolean; i?: boolean; u?: boolean } = {}, at = { n: 0 }): Run[] {
  const out: Run[] = [];
  for (const x of c) {
    if (x.t === "text") {
      out.push({ t: x.s, o: at.n, ...(style.b ? { b: true } : {}), ...(style.i ? { i: true } : {}), ...(style.u ? { u: true } : {}) });
      at.n += x.s.length;
    } else if (x.t === "br") out.push({ t: "\n" });
    else out.push(...runsOf(x.c, { ...style, ...(x.t === "b" ? { b: true } : x.t === "i" ? { i: true } : x.t === "u" ? { u: true } : {}) }, at));
  }
  return out;
}

/** A block's Markdown as paragraphs of runs, the offsets counted across them in the order the page draws them. */
type MdPara = { kind: "h1" | "h2" | "p" | "bullet" | "num"; no?: number; runs: Run[]; start: number; end: number };
function mdParas(md: string): MdPara[] {
  const at = { n: 0 };
  const out: MdPara[] = [];
  const one = (kind: MdPara["kind"], c: MdInline[], no?: number) => {
    const start = at.n;
    const runs = runsOf(c, {}, at);
    out.push({ kind, runs, start, end: at.n, ...(no !== undefined ? { no } : {}) });
  };
  for (const m of parseNotebookMd(md) as MdBlock[]) {
    if (m.t === "h") one(m.level === 1 ? "h1" : "h2", m.c);
    else if (m.t === "p") one("p", m.c);
    else if (m.t === "ul") for (const it of m.items) one("bullet", it);
    else m.items.forEach((it, i) => one("num", it, m.start + i));
  }
  return out;
}

/* ---------------------------------------------------------------- ink in points */

/** The strokes of a page by the block they are attached to. */
const byBlock = (ink: readonly NoteStroke[] | undefined) => {
  const m = new Map<string, NoteStroke[]>();
  for (const s of ink ?? []) m.set(s.a.b, [...(m.get(s.a.b) ?? []), s]);
  return m;
};
/** How far below its anchor's middle a text-anchored stroke reaches, in points (with half its width). */
const reachBelow = (s: NoteStroke) => {
  let m = 0;
  for (let i = 1; i < s.pts.length; i += 3) m = Math.max(m, s.pts[i]!);
  return ((m + s.w / 2) / 100) * EM_PT;
};
/**
 * A stroke's points in points, y down: a text stroke from its anchor (`x`, `mid`: the character's left and its line's middle), a box stroke from its box's top left (`x`, `mid` = the top)
 * scaled by the box's width. The width of the line in points too.
 */
function strokePts(s: NoteStroke, x: number, mid: number, boxW: number): { pts: number[]; w: number } {
  const u = s.a.k === "text" ? EM_PT / 100 : boxW / 10_000;
  const pts: number[] = [];
  for (let i = 0; i < s.pts.length; i += 3) pts.push(x + s.pts[i]! * u, mid + s.pts[i + 1]! * u, s.pts[i + 2]! / 100);
  return { pts, w: s.w * u };
}

/** Strokes drawn into a transparent PNG (Word's picture of a paragraph's ink), in the light palette, at 192 dpi; its box in points (relative to the same origin as the strokes). */
async function inkPng(list: { s: NoteStroke; pts: number[]; w: number }[]): Promise<{ bytes: Uint8Array; x: number; y: number; w: number; h: number } | null> {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const k of list)
    for (let i = 0; i < k.pts.length; i += 3) {
      x0 = Math.min(x0, k.pts[i]! - k.w);
      x1 = Math.max(x1, k.pts[i]! + k.w);
      y0 = Math.min(y0, k.pts[i + 1]! - k.w);
      y1 = Math.max(y1, k.pts[i + 1]! + k.w);
    }
  if (!Number.isFinite(x0)) return null;
  x0 -= 1;
  y0 -= 1;
  const w = Math.max(2, x1 - x0 + 1);
  const h = Math.max(2, y1 - y0 + 1);
  const k = 192 / 72;
  const c = document.createElement("canvas");
  c.width = Math.ceil(w * k);
  c.height = Math.ceil(h * k);
  const ctx = c.getContext("2d")!;
  ctx.scale(k, k);
  ctx.translate(-x0, -y0);
  for (const { s, pts, w: lw } of list) {
    if (s.tool === "pen") {
      ctx.globalAlpha = 1;
      ctx.fillStyle = inkHex("pen", s.color);
      ctx.fill(new Path2D(penPath(pts, lw, 1)));
    } else {
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = inkHex("highlighter", s.color);
      ctx.lineWidth = lw;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke(new Path2D(markerPath(pts, 1)));
    }
  }
  return { bytes: await pngOf(c), x: x0, y: y0, w, h };
}

/* ---------------------------------------------------------------- the line-breaker (the PDF's, and Word's prediction) */

type Font = { widthOfTextAtSize: (s: string, size: number) => number; getCharacterSet: () => number[] };
type Fonts = { r: Font; b: Font; i: Font; bi: Font; deva: Font | null };
type Part = { s: string; font: Font; u?: boolean; o?: number; len: number };
type Line = { parts: (Part & { x: number })[]; brk: boolean };

function makeBreaker(fonts: Fonts) {
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
  /** Where character `at` is on a line: the x of its left edge, or null when the line does not hold it. */
  const xOf = (l: Line, at: number, size: number): number | null => {
    for (const p of l.parts) if (p.o !== undefined && at >= p.o && at < p.o + p.len) return p.x + p.font.widthOfTextAtSize(p.s.slice(0, at - p.o), size);
    return null;
  };
  return { lines, xOf };
}

/* ---------------------------------------------------------------- Word */

/** Word's paragraphs when a page has ink: their size, indent and line height (1.4 times the size, exact), as docx.ts writes them with `ink`. */
const WORD = { h1: { size: 13, indent: 0 }, h2: { size: 11.5, indent: 0 }, p: { size: 11, indent: 0 }, bullet: { size: 11, indent: 36 }, num: { size: 11, indent: 24 }, note: { size: 10, indent: 10 } } as const;
/** Where a line's middle is in Word, from the top of a line of exact height `lead`: its baseline about four fifths down, the middle a third of the size above it. */
const wordMid = (lead: number, size: number) => lead * 0.8 - MID * size;

export async function notesDocx(args: ExportArgs): Promise<Blob> {
  const hasInk = args.pages.some((p) => (p.ink?.length ?? 0) > 0);
  let breaker: ReturnType<typeof makeBreaker> | null = null;
  if (hasInk) {
    // Helvetica's widths are Arial's (and Liberation Sans's): our line-breaker predicts Word's lines with them
    const { PDFDocument, StandardFonts } = await import("@cantoo/pdf-lib");
    const d = await PDFDocument.create();
    breaker = makeBreaker({ r: await d.embedFont(StandardFonts.Helvetica), b: await d.embedFont(StandardFonts.HelveticaBold), i: await d.embedFont(StandardFonts.HelveticaOblique), bi: await d.embedFont(StandardFonts.HelveticaBoldOblique), deva: null });
  }
  const blocks: DocBlock[] = [{ k: "title", runs: [{ t: args.docTitle || "Notes" }] }];
  const media: Record<string, Uint8Array> = {};
  let floats = 0;
  /** A paragraph's ink as one picture anchored to it (in front of the text, moving with it). */
  const floatOf = async (list: { s: NoteStroke; pts: number[]; w: number }[], what: string): Promise<DocFloat[] | undefined> => {
    if (!list.length) return undefined;
    const png = await inkPng(list);
    if (!png) return undefined;
    const name = `ink${++floats}.png`;
    media[name] = png.bytes;
    return [{ media: name, x: png.x, y: png.y, w: png.w, h: png.h, alt: `A drawing on ${what}: ${list.length} ${list.length === 1 ? "stroke" : "strokes"}` }];
  };
  /** The ink of a paragraph of runs (offsets start to end) in Word's layout of it. */
  const paraInk = async (strokes: NoteStroke[] | undefined, runs: Run[], start: number, end: number, kind: keyof typeof WORD, what: string) => {
    const mine = (strokes ?? []).filter((s) => s.a.k === "text" && s.a.at >= start && s.a.at < end);
    if (!mine.length || !breaker) return undefined;
    const g = WORD[kind];
    const lead = 1.4 * g.size;
    const lines = breaker.lines(runs, g.size, TEXT_W - g.indent);
    const list = mine.flatMap((s) => {
      const at = (s.a as { at: number }).at;
      for (let li = 0; li < lines.length; li++) {
        const x = breaker!.xOf(lines[li]!, at, g.size);
        if (x !== null) return [{ s, ...strokePts(s, g.indent + x, li * lead + wordMid(lead, g.size), TEXT_W) }];
      }
      return [];
    });
    return floatOf(list, what);
  };
  const boxInk = (strokes: NoteStroke[] | undefined, top = 0) => floatOf((strokes ?? []).filter((s) => s.a.k === "box").map((s) => ({ s, ...strokePts(s, 0, top, TEXT_W) })), "a picture");
  const mdOut = async (md: string, strokes: NoteStroke[] | undefined, headingShift: boolean) => {
    for (const m of mdParas(md)) {
      const word = m.kind === "h1" ? (headingShift ? "h2" : "h1") : m.kind === "h2" ? "h2" : m.kind;
      const fl = await paraInk(strokes, m.runs, m.start, m.end, word === "h1" ? "h1" : word, "the text");
      const f = fl ? { floats: fl } : {};
      if (m.kind === "h1") blocks.push({ k: headingShift ? "h3" : "h2", runs: m.runs, ...f });
      else if (m.kind === "h2") blocks.push({ k: "h3", runs: m.runs, ...f });
      else if (m.kind === "p") blocks.push({ k: "p", runs: m.runs, ...f });
      else if (m.kind === "bullet") blocks.push({ k: "bullet", runs: m.runs, ...f });
      else blocks.push({ k: "ref", no: m.no!, runs: m.runs, ...f });
    }
  };
  for (const p of args.pages) {
    blocks.push({ k: "h1", runs: [{ t: p.title.trim() || "Untitled page" }] });
    const ink = byBlock(p.ink);
    for (const b of p.blocks) {
      const strokes = ink.get(b.id);
      if (b.kind === "text") {
        await mdOut(b.md, strokes, false);
        if (!b.md.trim() && strokes?.length) blocks.push({ k: "p", runs: [], floats: await boxInk(strokes) });
      } else if (b.kind === "quote") {
        const text = `“${b.quote}”`;
        const fl = await paraInk(strokes, [{ t: text, i: true, o: 0 }], 0, text.length, "note", "the quote");
        blocks.push({ k: "note", runs: [{ t: text, i: true }, { t: `\n${args.names[b.color]}, p. ${b.page}`, b: true }], ...(fl ? { floats: fl } : {}) });
      } else if (b.kind === "space") {
        blocks.push({ k: "space", h: (b.h / 10_000) * TEXT_W, floats: await boxInk(strokes) });
      } else if (b.kind === "capture" || b.kind === "sketch" || b.kind === "image") {
        const png = await pictureOf(b, args.pdf, args.imageUrl, !!strokes?.length);
        const name = `image${Object.keys(media).length + 1}.png`;
        const alt = b.kind === "capture" ? `A part of page ${b.page}${b.caption ? `: ${b.caption}` : ""}` : b.kind === "image" ? b.alt || "A picture" : "A sketch";
        if (png) {
          media[name] = png.bytes;
          blocks.push({ k: "image", media: name, w: png.w, h: png.h, alt, ...(png.frac ? { frac: png.frac } : {}), ...(strokes?.length ? { floats: await boxInk(strokes) } : {}) });
        }
        if (b.kind === "capture") blocks.push({ k: "p", runs: [{ t: png ? captureLine(b) : `A part of page ${b.page} ${captureLine(b)}`, i: true }] });
        else if (b.kind === "image" && b.alt) blocks.push({ k: "p", runs: [{ t: b.alt, i: true }] });
        else if (!png) blocks.push({ k: "p", runs: [{ t: b.kind === "image" ? "A picture" : "A sketch", i: true }] });
      } else {
        // an agent's answer: its header ("Explain · p. 3, 4"), what it was asked, and its Markdown as a text block's
        blocks.push({ k: "note", runs: [{ t: agentHeading(b), b: true }, ...(b.ask ? [{ t: `\n${b.agent === "explain" ? "Explained" : "Asked"}: ${b.ask}`, i: true }] : [])] });
        await mdOut(b.md, strokes, true);
      }
    }
  }
  const { zipSync, strToU8 } = await import("fflate");
  const parts = buildDocx({ title: `${args.docTitle || "Notes"}: notes`, author: "Sodhsetu", created: new Date(), lang: DEVANAGARI.test(JSON.stringify(args.pages)) ? "hi-IN" : "en-IN", blocks, ink: hasInk });
  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
  for (const [path, xml] of Object.entries(parts)) files[path] = [strToU8(xml), { level: 6 }];
  for (const [name, bytes] of Object.entries(media)) files[`word/media/${name}`] = [bytes, { level: 0 }];
  return new Blob([zipSync(files) as BlobPart], { type: DOCX_MIME });
}

/* ---------------------------------------------------------------- PDF */

export async function notesPdf(args: ExportArgs): Promise<Uint8Array> {
  const lib = await import("@cantoo/pdf-lib");
  const { PDFDocument, StandardFonts, rgb, LineCapStyle, BlendMode } = lib;
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
  let deva: typeof fonts.r | null = null;
  if (DEVANAGARI.test(JSON.stringify(args.pages)) || DEVANAGARI.test(args.docTitle)) {
    const fontkit = (await import("@cantoo/fontkit")).default;
    doc.registerFontkit(fontkit);
    const face = await (await fetch(devanagariFace)).arrayBuffer();
    deva = await doc.embedFont(face, { subset: true });
  }
  const breaker = makeBreaker({ ...fonts, deva });
  const W = PAGE_W;
  const H = PAGE_H;
  const M = MARGIN;
  const TW = TEXT_W;
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
  /** Ink to draw once the text is down: each stroke, the page it is on and where its anchor landed (x, and the middle of the line or the top of the box, y down from the page's top). */
  const pending: { page: typeof page; s: NoteStroke; x: number; mid: number; boxW: number }[] = [];
  /** The strokes on the block being written, by anchor offset. */
  let anchored = new Map<number, NoteStroke[]>();

  /** Writes runs as wrapped lines at `size`, `indent` from the margin; moves y. A line that holds an anchored character takes the ink below it to the next page with it, and notes where it is. */
  const write = (runs: Run[], size: number, opts: { indent?: number; color?: ReturnType<typeof rgb>; gap?: number; prefix?: string } = {}) => {
    const indent = opts.indent ?? 0;
    const lead = size * 1.4;
    const lines = breaker.lines(runs, size, TW - indent);
    lines.forEach((l, li) => {
      // the anchors on this line, and how far their ink reaches below it
      const here: { at: number; x: number }[] = [];
      let below = 0;
      if (anchored.size)
        for (const [at, list] of anchored) {
          const x = breaker.xOf(l, at, size);
          if (x === null) continue;
          here.push({ at, x });
          for (const s of list) below = Math.max(below, reachBelow(s) - MID * size);
        }
      need(lead + Math.max(0, below - (lead - size)));
      y -= lead;
      if (li === 0 && opts.prefix) page.drawText(opts.prefix, { x: M + indent - 14, y, size, font: fonts.r, color: opts.color ?? ink });
      for (const p of l.parts) {
        const x = M + indent + p.x;
        if (p.s.trim() || p.s === " ") page.drawText(p.s, { x, y, size, font: p.font as typeof fonts.r, color: opts.color ?? ink });
        const pw = p.font.widthOfTextAtSize(p.s, size);
        // an underline is drawn under its words (and the spaces between them)
        if (p.u) page.drawLine({ start: { x, y: y - size * 0.14 }, end: { x: x + pw, y: y - size * 0.14 }, thickness: Math.max(0.5, size * 0.055), color: opts.color ?? ink });
      }
      for (const h of here) for (const s of anchored.get(h.at)!) pending.push({ page, s, x: M + indent + h.x, mid: H - (y + MID * size), boxW: TW });
    });
    y -= opts.gap ?? size * 0.5;
  };
  /** Where a block's box starts (its ink on the box is placed from here, by the text's width). */
  const boxAt = (strokes: NoteStroke[] | undefined, topY: number) => {
    for (const s of strokes ?? []) if (s.a.k === "box") pending.push({ page, s, x: M, mid: H - topY, boxW: TW });
  };
  const picture = async (png: Png, strokes: NoteStroke[] | undefined) => {
    const img = await doc.embedPng(png.bytes);
    // a picture the reader made narrower keeps that share of the text's width
    const scale = Math.min(png.frac ? (TW * png.frac) / png.w : Math.min(TW / png.w, 1), (H - 2 * M) / png.h);
    const w = png.w * scale;
    const h = png.h * scale;
    need(h + 6);
    boxAt(strokes, y);
    y -= h;
    page.drawImage(img, { x: M, y, width: w, height: h });
    y -= 6;
  };
  const md = (text: string, strokes: NoteStroke[] | undefined, h1: number) => {
    for (const m of mdParas(text)) {
      if (m.kind === "h1" || m.kind === "h2") write(m.runs.map((r) => ({ ...r, b: true })), m.kind === "h1" ? h1 : 12, { gap: 4 });
      else if (m.kind === "p") write(m.runs, 11);
      else if (m.kind === "bullet") write(m.runs, 11, { indent: 16, prefix: "•", gap: 2 });
      else write(m.runs, 11, { indent: 20, prefix: `${m.no}.`, gap: 2 });
    }
    void strokes;
  };

  write([{ t: args.docTitle || "Notes", b: true }], 18, { gap: 14 });
  for (const p of args.pages) {
    need(40);
    write([{ t: p.title.trim() || "Untitled page", b: true }], 15, { gap: 8 });
    const inkOf = byBlock(p.ink);
    for (const b of p.blocks) {
      const strokes = inkOf.get(b.id);
      anchored = new Map();
      for (const s of strokes ?? []) if (s.a.k === "text") anchored.set(s.a.at, [...(anchored.get(s.a.at) ?? []), s]);
      if (b.kind === "text") {
        if (!b.md.trim()) boxAt(strokes, y);
        md(b.md, strokes, 13);
      } else if (b.kind === "quote") {
        const top = y;
        write([{ t: `“${b.quote}”`, i: true, o: 0 }], 11, { indent: 12, gap: 1 });
        anchored = new Map();
        write([{ t: `${args.names[b.color]}, p. ${b.page}`, b: true }], 9, { indent: 12, color: muted, gap: 4 });
        if (top > y) page.drawRectangle({ x: M, y: y + 4, width: 2.5, height: Math.min(top - y - 4, H), color: rgb(0.62, 0.5, 0.1) });
        y -= 4;
      } else if (b.kind === "space") {
        const h = (b.h / 10_000) * TW;
        need(Math.min(h, H - 2 * M));
        boxAt(strokes, y);
        y -= h;
      } else if (b.kind === "capture" || b.kind === "sketch" || b.kind === "image") {
        const png = await pictureOf(b, args.pdf, args.imageUrl, !!strokes?.length);
        if (png) await picture(png, strokes);
        else boxAt(strokes, y);
        if (b.kind === "capture") write([{ t: png ? captureLine(b) : `A part of page ${b.page} ${captureLine(b)}`, i: true }], 9, { color: muted });
        else if (b.kind === "image" && b.alt) write([{ t: b.alt, i: true }], 9, { color: muted });
        else if (!png) write([{ t: b.kind === "image" ? "A picture" : "A sketch", i: true }], 9, { color: muted });
      } else {
        const keep = anchored;
        anchored = new Map();
        write([{ t: agentHeading(b), b: true }], 10, { gap: 2, color: muted });
        if (b.ask) write([{ t: `${b.agent === "explain" ? "Explained" : "Asked"}: ${b.ask}`, i: true }], 9, { color: muted, gap: 2 });
        anchored = keep;
        md(b.md, strokes, 12);
        y -= 4;
      }
    }
    anchored = new Map();
    y -= 8;
  }

  // the ink, last: vector paths over the real text (pen strokes filled, the highlighter a wide see-through line, multiplied so the text shows through it)
  const rgbOf = (hex: string) => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
  for (const k of pending) {
    const { pts, w } = strokePts(k.s, k.x, k.mid, k.boxW);
    // a stroke that would cross the page's right edge is moved left to fit (never scaled)
    let maxX = -Infinity, minX = Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      maxX = Math.max(maxX, pts[i]!);
      minX = Math.min(minX, pts[i]!);
    }
    const shift = Math.max(0, Math.min(maxX + w / 2 - (W - 12), minX - 12));
    if (shift > 0) for (let i = 0; i < pts.length; i += 3) pts[i] = pts[i]! - shift;
    if (k.s.tool === "pen") k.page.drawSvgPath(penPath(pts, w, 1), { x: 0, y: H, color: rgbOf(inkHex("pen", k.s.color)) });
    else k.page.drawSvgPath(markerPath(pts, 1), { x: 0, y: H, borderColor: rgbOf(inkHex("highlighter", k.s.color)), borderWidth: w, borderOpacity: 0.45, borderLineCap: LineCapStyle.Round, blendMode: BlendMode.Multiply });
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
