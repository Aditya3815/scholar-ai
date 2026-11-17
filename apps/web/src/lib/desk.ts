import { useSyncExternalStore } from "react";

/**
 * The new Paper Reader's layout rule (docs/design/paper-reader.md, section 2). One test tells a wide screen (a laptop, a desktop, a tablet either way round) from a phone, in either
 * orientation: wide is at least 744 px wide (the narrowest tablet in portrait) AND at least 520 px tall (a phone on its side is wide but never that tall). The same query is in desk.css.
 * Nothing looks at the user agent.
 */
export const WIDE_QUERY = "(min-width: 744px) and (min-height: 520px)";

/** The three views of the reader. A phone gets Paper and Notes only: never both at once, never Split. */
export type DeskView = "paper" | "split" | "notes";
export const VIEW_KEY = "scholar.view";
/** The key the old reader kept "the side panel put away" under: "1" (or "closed", the plan's word for it) is read once as Paper, then the new key is used. */
export const OLD_FOCUS_KEY = "scholar.focus";

/** The rule itself, for a size (the hook below asks the browser; a test asks this). */
export const isWide = (width: number, height: number): boolean => width >= 744 && height >= 520;

/** The views a screen offers, in the order the switch shows them. */
export const viewsFor = (wide: boolean): DeskView[] => (wide ? ["paper", "split", "notes"] : ["paper", "notes"]);

/** A view the screen does not offer becomes the nearest one it does: Split on a phone is Paper (a rotation, a window dragged narrow). */
export const fitView = (view: DeskView, wide: boolean): DeskView => (wide || view !== "split" ? view : "paper");

const isView = (v: unknown): v is DeskView => v === "paper" || v === "split" || v === "notes";

/**
 * The view to start with: the one kept on this device, else an old "side panel put away" as Paper, else the screen's first view (Split on a wide screen, as today; Paper on a phone).
 * `get` reads the device's storage (it may throw: private mode), so a test can hand it a map.
 */
export function startView(get: (key: string) => string | null, wide: boolean): DeskView {
  let kept: string | null = null;
  let old: string | null = null;
  try {
    kept = get(VIEW_KEY);
    old = kept === null ? get(OLD_FOCUS_KEY) : null;
  } catch {
    /* private mode: the default */
  }
  if (isView(kept)) return fitView(kept, wide);
  if (old === "1" || old === "closed") return "paper";
  return wide ? "split" : "paper";
}

/* ---------------------------------------------------------------- the hook */

const mq = () => (typeof matchMedia === "function" ? matchMedia(WIDE_QUERY) : null);
const subscribe = (l: () => void) => {
  const m = mq();
  if (!m) return () => {};
  m.addEventListener("change", l);
  return () => m.removeEventListener("change", l);
};
const snapshot = () => mq()?.matches ?? true;

/** True on a wide screen; it changes as the window is turned or resized (a listener on the media query, not a resize handler). */
export const useWide = (): boolean => useSyncExternalStore(subscribe, snapshot, () => true);

/* ---------------------------------------------------------------- the new reader on screen */

/**
 * True while the new reader is the one on screen. The parts of the app outside the reader that follow it read this: the highlight colours carry their meanings (lib/legend.ts),
 * and the list of shortcuts has the reader's own keys. With the switch off it is never set, and both are exactly what they were.
 */
let deskOpen = false;
const deskListeners = new Set<() => void>();
export const isDeskOpen = (): boolean => deskOpen;
export function setDeskOpen(on: boolean): void {
  if (deskOpen === on) return;
  deskOpen = on;
  deskListeners.forEach((l) => l());
}
export const subscribeDesk = (l: () => void): (() => void) => {
  deskListeners.add(l);
  return () => deskListeners.delete(l);
};
export const useDeskOpen = (): boolean => useSyncExternalStore(subscribeDesk, isDeskOpen, () => false);
