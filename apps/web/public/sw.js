/*
 * Sodhsetu service worker: offline reading, and only when the reader has switched it on in Settings.
 *
 * What it keeps on this device while it is on:
 *   - the app itself (the page, /assets, /pdfjs), so the app opens without a connection;
 *   - the PDF of each paper that is opened (the 10 most recent), and the few small reads the reader needs: the paper's details, its notes, its drawing, the list of
 *     papers and who is signed in;
 * and nothing else: searches, questions, answers and anything that changes data go to the network as usual and are never stored here. Reads are asked from the
 * network first (so what is shown is current) and fall back to what was kept only when the network does not answer.
 *
 * It does nothing until the page sends it "on", and it throws everything away when the page sends "off" or "clear" (signing out does that).
 */
const VERSION = "v1";
const SHELL = `scholar-shell-${VERSION}`;
const DATA = `scholar-data-${VERSION}`;
const PAPERS = `scholar-papers-${VERSION}`;
const META = "scholar-meta";
const MAX_PAPERS = 10;
/** how long the network may take before a kept copy is used instead (a connection that is "on" but does not answer) */
const WAIT_MS = 6000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // caches of an older version of this file go
      for (const name of await caches.keys()) if (name.startsWith("scholar-") && ![SHELL, DATA, PAPERS, META].includes(name)) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

async function isOn() {
  return !!(await (await caches.open(META)).match("/__on"));
}
async function setOn(on) {
  const meta = await caches.open(META);
  if (on) await meta.put("/__on", new Response("1"));
  else await meta.delete("/__on");
}
async function clearAll() {
  for (const name of await caches.keys()) if (name.startsWith("scholar-") && name !== META) await caches.delete(name);
}

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  event.waitUntil(
    (async () => {
      if (type === "on") await setOn(true);
      else if (type === "off" || type === "clear") {
        await setOn(false);
        await clearAll();
        if (type === "off") await self.registration.unregister();
      } else return;
      if (event.source) event.source.postMessage({ type: "done", what: type });
    })(),
  );
});

const paperFile = /^\/api\/v1\/documents\/[a-f0-9]+\/file$/;
/** the small reads that let the reader open a paper that was opened before */
const readable = (p) => /^\/api\/v1\/documents(\/[a-f0-9]+(\/(notes|ink))?)?$/.test(p) || p === "/api/v1/auth/me" || p === "/api/v1/auth/providers";
const isAsset = (p) => p.startsWith("/assets/") || p.startsWith("/pdfjs/") || p === "/theme-init.js" || p === "/favicon.svg" || p === "/favicon.ico";

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  const html = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
  if (!(paperFile.test(p) || readable(p) || isAsset(p) || (html && !p.startsWith("/api/")))) return;
  event.respondWith(handle(req, p, html));
});

async function networkFirst(req, cacheName, key) {
  const cache = await caches.open(cacheName);
  const kept = await cache.match(key);
  try {
    const ctl = new AbortController();
    const timer = kept ? setTimeout(() => ctl.abort(), WAIT_MS) : 0;
    const res = await fetch(req, { signal: ctl.signal });
    clearTimeout(timer);
    // an answer is kept only when it is a good one: an error page must never replace what was kept
    if (res.ok) await cache.put(key, res.clone());
    return res;
  } catch (e) {
    if (kept) return kept;
    throw e;
  }
}

async function handle(req, p, html) {
  if (!(await isOn())) return fetch(req);
  try {
    if (paperFile.test(p)) {
      const cache = await caches.open(PAPERS);
      const hit = await cache.match(p);
      if (hit) return hit;
      // the whole file is fetched (a range request cannot be stored) and kept, the oldest paper going when there are more than ten
      const res = await fetch(new Request(req.url, { credentials: "same-origin" }));
      if (res.ok && res.status === 200) {
        await cache.put(p, res.clone());
        const keys = await cache.keys();
        for (const k of keys.slice(0, Math.max(0, keys.length - MAX_PAPERS))) await cache.delete(k);
      }
      return res;
    }
    if (readable(p)) return await networkFirst(req, DATA, p + new URL(req.url).search);
    if (html) return await networkFirst(req, SHELL, "/");
    // /assets are fingerprinted (their name changes when they do), so a kept copy is always right
    const cache = await caches.open(SHELL);
    const hit = await cache.match(p);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) await cache.put(p, res.clone());
    return res;
  } catch (e) {
    return fetch(req);
  }
}
