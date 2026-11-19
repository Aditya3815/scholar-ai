/**
 * The tool keys of the new Paper Reader (docs/design/paper-reader.md, section 3): V Select, H Highlight, D Draw, C Capture, when the focus is not in a text field and no modifier is held. While the
 * Draw toolbar is open, the letters are the drawing tools exactly as today (the viewer's own keys: V select and read, P pen, H the freehand highlighter, ...): this says nothing then.
 * C is Capture (phase 2.5). There is no key for the Agents (A is the arrow in Draw).
 */
export type DeskTool = "select" | "highlight" | "draw" | "capture";

export type KeyLike = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; repeat?: boolean };

const FIELD = "input, textarea, select, [contenteditable=true], [contenteditable=''], [role=dialog], [role=textbox]";
/** The focus is somewhere a letter is typed (or inside a dialog, which has keys of its own). */
export const inTextField = (target: EventTarget | null): boolean => !!(target as Element | null)?.closest?.(FIELD);

export const TOOL_OF_KEY: Readonly<Record<string, DeskTool>> = { v: "select", h: "highlight", d: "draw", c: "capture" };

/** The tool a key picks, or null when the key is not the reader's (typing, a modifier, the Draw toolbar open, a held key repeating). */
export function deskToolKey(e: KeyLike, { drawOpen, typing }: { drawOpen: boolean; typing: boolean }): DeskTool | null {
  if (typing || drawOpen || e.repeat) return null;
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;
  return TOOL_OF_KEY[e.key.toLowerCase()] ?? null;
}
