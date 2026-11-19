import { getStroke } from "perfect-freehand";

/**
 * The outlines of pen and highlighter strokes (perfect-freehand), shared by the paper's drawing (InkLayer), the annotated PDF and the Notebook's sketches, so a stroke looks the same in all three.
 * Points are x, y, pressure triples in units of a width (`pageW` turns them into pixels).
 */
const avg = (a: number, b: number) => (a + b) / 2;
/** The outline from perfect-freehand as a smooth closed SVG path (quadratic curves through the midpoints). */
export function outlinePath(points: number[][]): string {
  const n = points.length;
  if (n < 4) return "";
  let a = points[0]!, b = points[1]!;
  const c = points[2]!;
  let d = `M${a[0]!.toFixed(2)},${a[1]!.toFixed(2)} Q${b[0]!.toFixed(2)},${b[1]!.toFixed(2)} ${avg(b[0]!, c[0]!).toFixed(2)},${avg(b[1]!, c[1]!).toFixed(2)} T`;
  for (let i = 2; i < n - 1; i++) {
    a = points[i]!;
    b = points[i + 1]!;
    d += `${avg(a[0]!, b[0]!).toFixed(2)},${avg(a[1]!, b[1]!).toFixed(2)} `;
  }
  return d + "Z";
}

/** The outline of a pen stroke as a list of points (in page units: a width of 1 is the page width times `pageW`). The same outline is drawn on screen and put into the annotated PDF. */
export function penOutline(pts: number[], w: number, pageW: number): number[][] {
  const points: number[][] = [];
  let simulate = true;
  for (let i = 0; i < pts.length; i += 3) {
    points.push([pts[i]! * pageW, pts[i + 1]! * pageW, pts[i + 2]!]);
    if (pts[i + 2] !== 0.5) simulate = false;
  }
  if (points.length === 1) points.push([points[0]![0]! + 0.01, points[0]![1]!, points[0]![2]!]);
  return getStroke(points, { size: Math.max(0.6, w * pageW), thinning: simulate ? 0.45 : 0.6, smoothing: 0.5, streamline: 0.45, simulatePressure: simulate, last: true });
}
/** A pen stroke as a filled outline, thicker where the pressure was greater. A mouse has no pressure (all 0.5), so the speed of the hand shapes the line instead. */
export function penPath(pts: number[], w: number, pageW: number): string {
  return outlinePath(penOutline(pts, w, pageW));
}
/** A highlighter stroke: a flat-ended wide line of one width (no pressure), which is how a real marker looks. */
export function markerPath(pts: number[], pageW: number): string {
  let d = "";
  for (let i = 0; i < pts.length; i += 3) d += `${i === 0 ? "M" : "L"}${(pts[i]! * pageW).toFixed(2)},${(pts[i + 1]! * pageW).toFixed(2)} `;
  if (pts.length === 3) d += `L${(pts[0]! * pageW + 0.01).toFixed(2)},${(pts[1]! * pageW).toFixed(2)}`;
  return d;
}
