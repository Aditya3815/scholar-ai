import { isNoise } from "@scholar/shared";

/**
 * Tells us when the app breaks in someone's browser. Only an error's type, a shortened message, its stack and the page path are sent, to
 * our own Worker (which passes them on to Sentry when that is set up). Never page content, what was typed, or who the person is.
 */
const seen = new Set<string>();
const MAX_PER_PAGE_LOAD = 5;

export function reportError(err: unknown): void {
  try {
    const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : "Unknown error");
    const type = e.name || "Error";
    const message = (e.message || "").slice(0, 400);
    const stack = (e.stack || "").slice(0, 6000);
    if (isNoise(type, message, stack)) return;
    const key = `${type}|${message}`;
    if (seen.has(key) || seen.size >= MAX_PER_PAGE_LOAD) return;
    seen.add(key);
    void fetch("/api/v1/monitoring", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, message, stack, path: location.pathname }),
      keepalive: true,
      credentials: "omit",
    }).catch(() => {});
  } catch {
    /* reporting must never break the page */
  }
}

export function initMonitoring(): void {
  window.addEventListener("error", (e) => reportError(e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => reportError(e.reason));
}
