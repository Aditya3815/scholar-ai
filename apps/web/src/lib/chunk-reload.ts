/**
 * A page left open across a deploy still names the old hashed files (a lazy chunk, the pdf.js worker); the new deploy no longer has them, so opening a paper fails with
 * "Failed to fetch dynamically imported module" or "Setting up fake worker failed". The cure is to load the page again, once: a second failure within a short while is a real
 * fault (or no network), and reloading again would only loop, so the page then shows its own message instead. The guard is kept in sessionStorage (one tab, one visit).
 * (Which failures are of this kind is said by isChunkError in pdf.ts: imported from here, it would tie the paper-adding chunk to the first load's.)
 */
const KEY = "scholar.chunkReload";
/** A reload this recent means the last one did not help. */
const WINDOW_MS = 30_000;

/** Loads the page again unless it did so in the last half minute (or storage is blocked, so a loop could not be stopped). Returns whether it is reloading. */
export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) || 0);
    if (Date.now() - last < WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    return false;
  }
  location.reload();
  return true;
}

/** Vite tells the page when a lazy chunk (or one it needs) could not be fetched: a stale page after a deploy. Called once at start. */
export function watchChunkErrors(): void {
  // offline, a reload would only show the browser's own offline page: the page says so itself
  window.addEventListener("vite:preloadError", () => void (navigator.onLine !== false && reloadOnce()));
}
