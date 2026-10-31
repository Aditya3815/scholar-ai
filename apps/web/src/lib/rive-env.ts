import { riveBlockedBy } from "@scholar/shared";

/**
 * Whether a Rive picture may be shown here at all, kept apart from the rest (lib/rive.ts) because the pages ask it up front: this file is a few lines in the first load, the file that draws
 * the pictures is fetched only when one is wanted.
 */

export type RiveEnvironment = { reducedMotion: boolean; saveData: boolean; effectiveType?: string; wasm: boolean };

/** What this browser and this person allow, read now. */
export function riveEnvironment(): RiveEnvironment {
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return {
    reducedMotion: typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches,
    saveData: conn?.saveData === true,
    effectiveType: conn?.effectiveType,
    wasm: typeof WebAssembly === "object",
  };
}

/** Whether a Rive piece may be shown here at all (see `riveBlockedBy`). */
export const riveAllowed = (): boolean => riveBlockedBy(riveEnvironment()) === null;
