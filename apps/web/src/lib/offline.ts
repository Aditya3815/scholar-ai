import { useEffect, useState, useSyncExternalStore } from "react";
import { idbClear, idbKeys } from "./idb";

/**
 * Offline reading (My Workspace), switched on in Settings and off by default. While it is on, a service worker (public/sw.js) keeps the app and the papers that are opened
 * on this device. Nothing here sends anything anywhere; it only decides what the browser keeps. Turning it off, and signing out, remove what was kept.
 */
const KEY = "scholar.offline";
const PAPERS = "scholar-papers-v1";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const supported = () => typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof caches !== "undefined";
const readSetting = (): boolean => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};
export const offlineSupported = supported;

export const useOfflineOn = (): boolean =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      window.addEventListener("storage", l);
      return () => {
        listeners.delete(l);
        window.removeEventListener("storage", l);
      };
    },
    readSetting,
    () => false,
  );

/** The service worker, once it is running and controlling this page. */
async function worker(): Promise<ServiceWorker | null> {
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  const ready = await navigator.serviceWorker.ready;
  return reg.active ?? ready.active ?? null;
}

/** Ask the worker to do something and wait until it says it has (the reply is its answer, so nothing is assumed). */
function tell(sw: ServiceWorker, type: "on" | "off" | "clear"): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => done(false), 5000);
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "done" && e.data.what === type) done(true);
    };
    const done = (ok: boolean) => {
      window.clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("message", onMsg);
      resolve(ok);
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    sw.postMessage({ type });
  });
}

/** After the worker is on, the page asks again for what it already loaded, so the worker keeps those copies too (the app opens offline at once, not after a second visit). */
async function warmUp() {
  const urls = new Set<string>();
  for (const e of performance.getEntriesByType("resource")) {
    const u = new URL(e.name, location.href);
    if (u.origin === location.origin && (u.pathname.startsWith("/assets/") || u.pathname === "/theme-init.js")) urls.add(u.pathname);
  }
  await Promise.allSettled([fetch("/", { headers: { Accept: "text/html" } }), ...[...urls].map((u) => fetch(u))]);
}

export type OfflineResult = "ok" | "unsupported" | "failed";

export async function enableOffline(): Promise<OfflineResult> {
  if (!supported()) return "unsupported";
  try {
    const sw = await worker();
    if (!sw || !(await tell(sw, "on"))) return "failed";
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      return "failed";
    }
    emit();
    void warmUp();
    return "ok";
  } catch {
    return "failed";
  }
}

/** Off: the worker forgets everything and removes itself. */
export async function disableOffline(): Promise<void> {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  emit();
  if (!supported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    if (reg?.active) await tell(reg.active, "off");
    // belt and braces: what the worker could not delete is deleted here
    for (const name of await caches.keys()) if (name.startsWith("scholar-")) await caches.delete(name);
    await reg?.unregister();
  } catch {
    /* ignore */
  }
  notifyChanged();
}

/**
 * Signing out, or deleting the account: what was kept for this person goes (papers, notes, the list), and so do drawings that could not be sent yet. The switch stays as it
 * was, so the next person who signs in starts with an empty store and the same setting.
 */
export async function clearOfflineData(): Promise<void> {
  try {
    if (supported()) {
      for (const name of await caches.keys()) if (name.startsWith("scholar-") && name !== "scholar-meta") await caches.delete(name);
    }
    await idbClear();
  } catch {
    /* ignore */
  }
  notifyChanged();
}

/** Drawings that have not reached the server (made offline). */
export const pendingDrawings = async (): Promise<number> => (await idbKeys()).length;

const idOf = (url: string) => /\/api\/v1\/documents\/([a-f0-9]+)\/file$/.exec(new URL(url).pathname)?.[1] ?? null;

/** The papers whose file is kept on this device. */
export async function cachedPaperIds(): Promise<string[]> {
  if (!supported()) return [];
  try {
    if (!(await caches.has(PAPERS))) return [];
    const cache = await caches.open(PAPERS);
    return (await cache.keys()).map((r) => idOf(r.url)).filter((x): x is string => !!x);
  } catch {
    return [];
  }
}

/** One paper's kept copy goes (its file, and the small reads that were kept with it). */
export async function removeCachedPaper(id: string): Promise<void> {
  if (!supported()) return;
  try {
    const papers = await caches.open(PAPERS);
    for (const r of await papers.keys()) if (idOf(r.url) === id) await papers.delete(r);
    if (await caches.has("scholar-data-v1")) {
      const data = await caches.open("scholar-data-v1");
      for (const r of await data.keys()) if (new URL(r.url).pathname.startsWith(`/api/v1/documents/${id}`)) await data.delete(r);
    }
  } catch {
    /* ignore */
  }
  notifyChanged();
}

const CHANGED = "scholar:offline-changed";
export const notifyChanged = () => window.dispatchEvent(new Event(CHANGED));

/** The papers that are kept on this device now; follows changes (a paper opened, removed, everything cleared). */
export function useCachedPapers(refreshWhen: unknown = null): ReadonlySet<string> {
  const on = useOfflineOn();
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!on) return setIds(new Set());
    let live = true;
    const read = () => void cachedPaperIds().then((x) => live && setIds(new Set(x)));
    read();
    window.addEventListener(CHANGED, read);
    window.addEventListener("focus", read);
    // a paper that is being opened is kept a moment after, so look again shortly
    const t = window.setTimeout(read, 2500);
    return () => {
      live = false;
      window.clearTimeout(t);
      window.removeEventListener(CHANGED, read);
      window.removeEventListener("focus", read);
    };
  }, [on, refreshWhen]);
  return ids;
}

/** Whether the browser thinks it has a connection (it can be wrong in one direction only: "online" does not prove the service answers). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (l) => {
      window.addEventListener("online", l);
      window.addEventListener("offline", l);
      return () => {
        window.removeEventListener("online", l);
        window.removeEventListener("offline", l);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

/** How much space this site is using on the device and how much it may use, in bytes (null where the browser does not say). */
export async function storageUse(): Promise<{ used: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e && typeof e.usage === "number" && typeof e.quota === "number" ? { used: e.usage, quota: e.quota } : null;
  } catch {
    return null;
  }
}

/** Keep the worker registered and current at the start of every visit while the switch is on (a new version of the worker replaces the old one). */
export function resumeOffline() {
  if (readSetting() && supported()) void worker().catch(() => {});
}
