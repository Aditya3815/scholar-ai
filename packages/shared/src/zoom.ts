/** Zoom of the paper reader: the steps of the buttons, and what a pinch (two fingers, or Ctrl and the wheel) does. Pure, so it can be tested. */
export const ZOOM_STOPS = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.6, 2, 2.5] as const;
export const MIN_ZOOM = ZOOM_STOPS[0];
export const MAX_ZOOM = ZOOM_STOPS[ZOOM_STOPS.length - 1]!;

export const clampZoom = (z: number): number => (Number.isFinite(z) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) : 1);

/** The next step up (dir 1) or down (dir -1) from where a pinch may have left the zoom, which is between steps. Stays at the end when there is no further step. */
export function stepZoom(level: number, dir: 1 | -1): number {
  const eps = 0.004;
  const stops: readonly number[] = ZOOM_STOPS;
  if (dir === 1) return stops.find((s) => s > level + eps) ?? MAX_ZOOM;
  return [...stops].reverse().find((s) => s < level - eps) ?? MIN_ZOOM;
}

/**
 * How much a turn of the wheel with Ctrl held (which is how a trackpad pinch arrives in a browser) changes the zoom. A pinch sends many small turns, a mouse
 * wheel a few big ones: each is capped, so that one notch of a wheel is about a quarter more or less, not a leap.
 */
export function wheelFactor(deltaY: number, deltaMode = 0): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const capped = Math.max(-25, Math.min(25, Number.isFinite(px) ? px : 0));
  return Math.exp(-capped * 0.01);
}

/** The change of zoom for two fingers that were `from` apart and are now `to` apart. */
export const pinchFactor = (from: number, to: number): number => (from > 0 && to > 0 && Number.isFinite(from + to) ? to / from : 1);

/**
 * Where to scroll after the zoom was multiplied by `factor`, so that the point under the fingers (or the middle of the view) stays where it was:
 * `scroll` is the scroll position before, `at` the distance of that point from the edge of the view.
 */
export const anchoredScroll = (scroll: number, at: number, factor: number): number => Math.max(0, (scroll + at) * factor - at);
