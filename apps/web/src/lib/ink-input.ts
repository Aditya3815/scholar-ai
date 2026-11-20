/**
 * How a pointer draws (one copy of the rules, for the paper's InkLayer and the ink on the pages of notes, docs/design/paper-reader.md, 25): a stylus's pressure (a mouse and a finger have
 * none: 0.5), its eraser end, the points the browser merged between two frames, and the palm rule: a touch is ignored for 4 s after a stylus was seen (the palm resting while it writes), a
 * second finger is a pinch, and a finger draws only when finger drawing is on.
 */
export const PEN_SEEN_MS = 4000;

type Ptr = { pointerType: string; pressure: number; buttons: number; button: number };
export const pressureOf = (e: Ptr): number => (e.pointerType === "pen" ? e.pressure || 0.5 : 0.5);
/** The eraser end of a stylus (or its barrel button): it erases whatever tool is on. */
export const isEraserEnd = (e: Ptr): boolean => e.pointerType === "pen" && (!!(e.buttons & 32) || e.button === 5);
/** The samples the browser merged since the last event (smooth curves from a fast pen); the event itself when it gives none (an old Firefox gave none for a pen). */
export function samplesOf(e: PointerEvent): PointerEvent[] {
  const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
  return list.length > 0 ? list : [e];
}

/**
 * What a touch going down does: "draw", "pinch" (a second finger: the stroke being drawn is dropped), "palm" (a stylus was seen in the last 4 s) or "finger-off" (finger drawing is off:
 * say how to turn it on). A stylus and a mouse always draw. `touches` holds the fingers down, this one included.
 */
export function touchVerdict(touches: number, finger: boolean, penSeenAt: number, now: number): "draw" | "pinch" | "palm" | "finger-off" {
  if (touches > 1) return "pinch";
  if (!finger) return "finger-off";
  return now - penSeenAt < PEN_SEEN_MS ? "palm" : "draw";
}
