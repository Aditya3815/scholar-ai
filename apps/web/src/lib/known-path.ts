/**
 * Whether a path is one the app draws. The Worker serves index.html for every path (wrangler `not_found_handling: single-page-application`), so an unknown address answers 200 with the home page:
 * a "soft 404". The page marks such an address `noindex` so a search engine does not keep it (the status code itself needs the Worker in front of the assets, which costs a Worker run per page view).
 */
const PAGES = new Set(["", "/", "/verify", "/idea", "/literature-scan", "/admin", "/privacy", "/terms", "/how-we-verify", "/library", "/settings", "/home", "/papers"]);

export function isKnownPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "");
  if (PAGES.has(p)) return true;
  return /^\/literature-scan\/shared\/[A-Za-z0-9_-]{43}$/.test(p) || /^\/s\/[A-Za-z0-9_-]{43}$/.test(p) || /^\/papers\/[a-f0-9]{8,40}$/.test(p);
}
