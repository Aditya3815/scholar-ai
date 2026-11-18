/**
 * The page's test knobs, in one place (docs/design/untangle.md, F7): values a browser suite may set in sessionStorage to shorten a wait that a test cannot sit through. Each has a floor, so a
 * knob can only make a wait shorter within reason, never remove it; a value that is not a number, or storage that cannot be read, is the production value. Nothing in production sets one.
 */

/** sessionStorage key: how long a working reply may be silent before it says it is still working (e2e/chat.mjs sets 1500). */
export const QUIET_MS_KEY = "scholar.quiet.ms";

/** After this long without a single event from the server (the model can think for 9 to 12 s before its first word), the reply says it is still working. */
export const QUIET_MS = 15_000;

/** A number a test has set in sessionStorage under `key`, if it is at least `min`; else `fallback`. */
function knob(key: string, min: number, fallback: number): number {
  try {
    const v = Number(sessionStorage.getItem(key));
    return Number.isFinite(v) && v >= min ? v : fallback;
  } catch {
    return fallback;
  }
}

/** How long a working reply may be silent before the page says it is still working: 15 s, or a test's shorter value (500 ms at least). */
export const quietMs = (): number => knob(QUIET_MS_KEY, 500, QUIET_MS);
