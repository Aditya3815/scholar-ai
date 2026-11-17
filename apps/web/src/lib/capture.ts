import type { PDFDocumentProxy } from "./pdf";

/**
 * Capture (docs/design/paper-reader.md, 6 and 21.1, 6): a part of a page, kept as a place, never as a picture. A place is fractions of the page as it is shown (its rotation and crop
 * box included, as pdf.js gives them in a viewport), so the same viewport draws it back from the open paper at any size.
 */
export type CaptureRect = { x: number; y: number; w: number; h: number };

/** Smaller than this (in CSS pixels on the page) is a click, not a frame. */
export const MIN_CAPTURE_PX = 12;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The frame between two points of a drag, as fractions of the page's box, held inside the page; null when it is too small to be meant. */
export function rectFromDrag(a: { x: number; y: number }, b: { x: number; y: number }, box: { width: number; height: number }): CaptureRect | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const x0 = clamp(Math.min(a.x, b.x), 0, box.width);
  const x1 = clamp(Math.max(a.x, b.x), 0, box.width);
  const y0 = clamp(Math.min(a.y, b.y), 0, box.height);
  const y1 = clamp(Math.max(a.y, b.y), 0, box.height);
  if (x1 - x0 < MIN_CAPTURE_PX || y1 - y0 < MIN_CAPTURE_PX) return null;
  return { x: x0 / box.width, y: y0 / box.height, w: (x1 - x0) / box.width, h: (y1 - y0) / box.height };
}

/** The frame a keyboard places first: the middle half of the page's width, a third of its height. */
export const FIRST_FRAME: CaptureRect = { x: 0.25, y: 0.3, w: 0.5, h: 0.3 };

/** The arrows move the frame by `step` (a fraction of the page), Shift and the arrows make it larger or smaller; it never leaves the page and never gets smaller than 5 % a side. */
export function nudgeFrame(r: CaptureRect, key: string, resize: boolean, step = 0.02): CaptureRect {
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[key] as [number, number] | undefined;
  if (!d) return r;
  if (resize) {
    const w = clamp(r.w + d[0], 0.05, 1 - r.x);
    const h = clamp(r.h + d[1], 0.05, 1 - r.y);
    return { ...r, w, h };
  }
  return { ...r, x: clamp(r.x + d[0], 0, 1 - r.w), y: clamp(r.y + d[1], 0, 1 - r.h) };
}

/**
 * How to draw a capture at `cssWidth` pixels wide on a screen of `dpr`: the scale of the page's viewport, the canvas's size in device pixels, and the translation that puts the frame's top
 * left corner at the canvas's. `page` is the size of the page's viewport at scale 1 (rotation included).
 */
export function captureTransform(r: CaptureRect, page: { width: number; height: number }, cssWidth: number, dpr: number) {
  const scale = (cssWidth * dpr) / (r.w * page.width);
  const width = Math.max(1, Math.round(r.w * page.width * scale));
  const height = Math.max(1, Math.round(r.h * page.height * scale));
  return { scale, width, height, cssHeight: height / dpr, transform: [1, 0, 0, 1, -r.x * page.width * scale, -r.y * page.height * scale] as [number, number, number, number, number, number] };
}

/** Draws page `n`'s part `r` into `canvas`, `cssWidth` pixels wide, sharp on this screen. Resolves to the height it was given, in CSS pixels. */
export async function drawCapture(pdf: PDFDocumentProxy, canvas: HTMLCanvasElement, n: number, r: CaptureRect, cssWidth: number): Promise<number> {
  const page = await pdf.getPage(n);
  const one = page.getViewport({ scale: 1 });
  const dpr = Math.min(3, globalThis.devicePixelRatio || 1);
  const t = captureTransform(r, one, Math.max(40, cssWidth), dpr);
  canvas.width = t.width;
  canvas.height = t.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return t.cssHeight;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, t.width, t.height);
  await page.render({ canvas, canvasContext: ctx, viewport: page.getViewport({ scale: t.scale }), transform: t.transform }).promise;
  return t.cssHeight;
}
