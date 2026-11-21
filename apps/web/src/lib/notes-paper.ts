import { NOTEBOOK_STYLE_NAMES, docxPage, type NotebookStyle } from "@scholar/shared";

/**
 * A page's paper (plain, ruled, dotted, graph) in the exported notes: the PDF draws it as vector lines and dots behind the text, Word as one page-sized picture behind the text of the page's
 * section. Pure: where every line and dot goes, in points from the page's top left (y down), inside a box (the text's margins).
 *
 * The screen's rhythm (notebook.css, .nb-scroll): one line of text is --nb-line high (1.75 rem: 28 CSS px, 21 pt), the ruled lines are at the foot of each line, the dots at the top left of
 * each square and the graph's squares a line high. Colours: the Light theme's --border-strong (#cfc9bb), a little stronger than on screen so that a printer keeps them.
 * A small chunk of its own, fetched by the export only when a page is on a paper other than plain.
 */
export const PAPER = {
  /** The height of a line and the side of a square, in points: 28 CSS px. */
  pitch: 21,
  rule: "#e1ddd3",
  grid: "#e8e5de",
  dot: "#c9c3b5",
  /** a line's width and a dot's radius, in points */
  lineW: 0.5,
  dotR: 0.8,
} as const;

export type PaperBox = { x: number; y: number; w: number; h: number };
/** Lines as [x1, y1, x2, y2] and dots as [x, y], in points, y down. */
export type PaperMarks = { lines: [number, number, number, number][]; dots: [number, number][]; color: string };

export function paperMarks(style: NotebookStyle | undefined, box: PaperBox, pitch: number = PAPER.pitch): PaperMarks {
  const rows = Math.floor(box.h / pitch + 1e-6);
  const cols = Math.floor(box.w / pitch + 1e-6);
  const lines: PaperMarks["lines"] = [];
  const dots: PaperMarks["dots"] = [];
  const bottom = box.y + rows * pitch;
  const right = box.x + cols * pitch;
  if (style === "ruled") {
    // at the foot of each line of text, across the text's width
    for (let k = 1; k <= rows; k++) lines.push([box.x, box.y + k * pitch, box.x + box.w, box.y + k * pitch]);
    return { lines, dots, color: PAPER.rule };
  }
  if (style === "grid") {
    for (let k = 0; k <= rows; k++) lines.push([box.x, box.y + k * pitch, right, box.y + k * pitch]);
    for (let j = 0; j <= cols; j++) lines.push([box.x + j * pitch, box.y, box.x + j * pitch, bottom]);
    return { lines, dots, color: PAPER.grid };
  }
  if (style === "dotted") {
    for (let k = 0; k <= rows; k++) for (let j = 0; j <= cols; j++) dots.push([box.x + j * pitch, box.y + k * pitch]);
    return { lines, dots, color: PAPER.dot };
  }
  return { lines, dots, color: PAPER.rule };
}

/**
 * Where a line of text sits on the paper's lines (a paper other than plain): it takes as many lines as it needs (1.4 times its size, as on plain paper, rounded up to whole lines). In one
 * line its letters are in the middle (Helvetica: 0.718 of the size above the baseline, 0.207 below), as the screen's line box centres its text; a taller line (the title) stands on the
 * line above its last, as a large hand writes across two. `off` is the baseline's height above the foot of its last line.
 */
export function onLines(size: number, pitch: number = PAPER.pitch): { lead: number; off: number } {
  const rows = Math.max(1, Math.ceil((size * 1.4) / pitch - 1e-6));
  return { lead: rows * pitch, off: rows === 1 ? (pitch - 0.925 * size) / 2 + 0.207 * size : (rows - 1) * pitch + 0.25 * size };
}

/** What Word says the paper picture is ("Graph paper"). */
export const paperAlt = (style: NotebookStyle) => `${NOTEBOOK_STYLE_NAMES[style]} paper`;

/** A page's paper for Word: the whole page (transparent) at 2 pixels a point, the lines and dots inside the text's margins as Word has them. */
export function paperPng(style: NotebookStyle, ink: boolean): Promise<Uint8Array> {
  const pg = docxPage(ink);
  const c = document.createElement("canvas");
  c.width = Math.round(pg.w * 2);
  c.height = Math.round(pg.h * 2);
  const ctx = c.getContext("2d")!;
  ctx.scale(2, 2);
  const m = paperMarks(style, { x: pg.side, y: pg.top, w: pg.w - 2 * pg.side, h: pg.h - pg.top - pg.bottom });
  ctx.strokeStyle = ctx.fillStyle = m.color;
  ctx.lineWidth = PAPER.lineW;
  ctx.beginPath();
  for (const [x1, y1, x2, y2] of m.lines) {
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  ctx.beginPath();
  for (const [x, y] of m.dots) {
    ctx.moveTo(x + PAPER.dotR, y);
    ctx.arc(x, y, PAPER.dotR, 0, 2 * Math.PI);
  }
  ctx.fill();
  return new Promise((res, rej) => c.toBlob((b) => (b ? b.arrayBuffer().then((a) => res(new Uint8Array(a)), rej) : rej(new Error("no picture"))), "image/png"));
}
