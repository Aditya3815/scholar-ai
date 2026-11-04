import { isFresh, parseTrending, type TrendingPayload } from "@scholar/shared";
import { decideFetched, deviceCopyOf, readDeviceCopy } from "@scholar/shared/src/trending-row";

/**
 * Where the Home page gets the Trending list from (docs/design/chatview-and-trending.md, T4, T11, T12). Only our own API is asked: never OpenAlex or arXiv (the page's security policy forbids it, and a request
 * from the browser would tell them who is reading). The file is public and the same for everyone, so the request carries no cookie and nothing the person did.
 *
 * It is asked for AFTER the first screen is drawn and the browser is idle, with a 2.5 second limit, and a failure is silent (no row, no message). The answer is kept for the NEXT time Home is drawn, on the
 * device (a copy of at most 24 hours) and in memory: it is never put into a Home screen that is already being read, so nothing moves under the reader and nothing needs to be reserved. A list that is
 * not fresh, or that the server says is switched off, is never shown and clears the copy on the device. Where the browser refuses storage the page simply has no copy.
 */
const KEY = "scholar.trending";
export const TRENDING_URL = "/api/v1/home/trending";
export const TRENDING_TIMEOUT_MS = 2500;
/** The server lets a browser keep the answer for five minutes; asking more often than that gets the same file. */
const EVERY_MS = 5 * 60_000;

/** The list of this page load, kept for the next Home screen. */
let latest: TrendingPayload | null = null;
let lastTry = 0;

const read = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const write = (value: string | null) => {
  try {
    if (value) localStorage.setItem(KEY, value);
    else localStorage.removeItem(KEY);
  } catch {
    /* nothing to keep it in */
  }
};

/**
 * The list a Home screen that is being drawn now may show, or null: the answer of this page load, else the copy on the device, as long as it is fresh (and the copy under 24 hours old). A copy that
 * may not be used any more is removed. Called once when Home is drawn (never again while it is shown).
 */
export function currentTrending(now: number = Date.now()): TrendingPayload | null {
  if (latest && isFresh(latest, now)) return latest;
  latest = null;
  const raw = read();
  const copy = readDeviceCopy(raw, now);
  if (raw !== null && !copy) write(null);
  return copy;
}

/**
 * Ask for the list once the first screen is drawn and the browser has nothing else to do; at most once in five minutes. Returns what stops it (Home was left before it began).
 * The answer goes to the next Home screen only: see `currentTrending`.
 */
export function askForTrending(): () => void {
  let stopped = false;
  const go = async () => {
    const now = Date.now();
    if (stopped || now - lastTry < EVERY_MS) return;
    lastTry = now;
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), TRENDING_TIMEOUT_MS);
    try {
      const res = await fetch(TRENDING_URL, { credentials: "omit", headers: { Accept: "application/json" }, signal: ctl.signal });
      if (!res.ok) return;
      const p = parseTrending(await res.json());
      const at = Date.now();
      const what = decideFetched(p, at);
      if (what === "save" && p) {
        latest = p;
        write(deviceCopyOf(p, at));
      } else if (what === "clear") {
        latest = null;
        write(null);
      }
    } catch {
      /* silent: no list this time, and no message about it */
    } finally {
      window.clearTimeout(timer);
    }
  };
  let cancel: () => void;
  if (typeof window.requestIdleCallback === "function") {
    const h = window.requestIdleCallback(() => void go(), { timeout: 4000 });
    cancel = () => window.cancelIdleCallback(h);
  } else {
    const h = window.setTimeout(() => void go(), 2000);
    cancel = () => window.clearTimeout(h);
  }
  return () => {
    stopped = true;
    cancel();
  };
}
