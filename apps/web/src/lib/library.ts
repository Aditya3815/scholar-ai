import { useSyncExternalStore } from "react";
import type { LibraryAlert, Paper } from "@scholar/shared";
import { getAuthState, subscribeAuth } from "./auth";
import { showNotice } from "./notice";
import { createPersistedStore } from "./store";

/**
 * Library has two homes behind one interface:
 *  - signed out: this device's localStorage (private to the browser profile)
 *  - signed in: the server (D1), synced across devices. The first time a user signs in, whatever they saved on this device is
 *    imported once and the local copy is cleared, so signing out on a shared computer leaves nothing behind.
 */
export type SavedPaper = Paper & { savedAt: number };

const local = createPersistedStore<SavedPaper[]>("scholar.library.v1", [], (raw) =>
  Array.isArray(raw) ? (raw as SavedPaper[]).filter((p) => p && typeof p.id === "string") : [],
);

let serverUserId: string | null = null;
let serverItems: SavedPaper[] = [];
/** Notices the daily re-check made (a saved paper was retracted), for a signed-in person. A library that lives only in this browser has none: nothing about it reaches the server. */
let serverAlerts: LibraryAlert[] = [];
let view: SavedPaper[] = local.get();
const listeners = new Set<() => void>();
let loadedAt = 0;
let pending = 0; // changes on their way to the server: a refresh must not overwrite them

function recompute() {
  view = getAuthState().user ? serverItems : local.get();
  listeners.forEach((l) => l());
}
local.subscribe(recompute);

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  credentials: "same-origin",
  headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
  body: body !== undefined ? JSON.stringify(body) : undefined,
});

async function loadServer(userId: string): Promise<{ items: SavedPaper[]; alerts: LibraryAlert[] } | null> {
  const res = await fetch("/api/v1/library", { credentials: "same-origin" }).catch(() => null);
  if (!res?.ok || serverUserId !== userId) return null;
  const body = (await res.json()) as { items: SavedPaper[]; alerts?: LibraryAlert[] };
  loadedAt = Date.now();
  return { items: body.items, alerts: body.alerts ?? [] };
}

async function syncAfterLogin(userId: string) {
  const first = await loadServer(userId);
  let items = first?.items ?? null;
  let alerts = first?.alerts ?? [];
  if (!items) {
    if (serverUserId === userId) showNotice("We could not load your library. It will retry on your next visit.");
    return;
  }
  const device = local.get();
  if (device.length > 0) {
    const res = await fetch("/api/v1/library/import", jsonInit("POST", { items: device.slice(0, 500) })).catch(() => null);
    if (res?.ok) {
      const again = await loadServer(userId);
      items = again?.items ?? items;
      alerts = again?.alerts ?? alerts;
      if (serverUserId !== userId) return;
      serverItems = items; // show the account copy first so the badge never dips to 0 while the device copy is cleared
      local.set([]); // imported: nothing personal stays in this browser
    } else {
      showNotice("We could not move the papers saved on this device into your account. They are still here; try again later.");
    }
  }
  if (serverUserId !== userId) return;
  serverItems = items;
  serverAlerts = alerts;
  recompute();
}

/**
 * The daily re-check can find a retraction while the page is open. When the tab comes back into view after a while, the account's copy is read again (only the notices and the
 * retracted marks can have changed under us, and only when nothing of ours is still on its way to the server).
 */
const REFRESH_AFTER_MS = 30 * 60_000;
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    const id = serverUserId;
    if (document.visibilityState !== "visible" || !id || pending > 0 || Date.now() - loadedAt < REFRESH_AFTER_MS) return;
    void loadServer(id).then((fresh) => {
      if (!fresh || serverUserId !== id || pending > 0) return;
      serverItems = fresh.items;
      serverAlerts = fresh.alerts;
      recompute();
    });
  });
}

subscribeAuth(() => {
  const id = getAuthState().user?.id ?? null;
  if (id !== serverUserId) {
    serverUserId = id;
    serverItems = [];
    serverAlerts = [];
    recompute();
    if (id) void syncAfterLogin(id);
  }
});

export function useLibrary(): SavedPaper[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => view,
    () => view,
  );
}

/** Notices about retractions found after the papers were saved; empty when signed out. */
export function useLibraryAlerts(): LibraryAlert[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => serverAlerts,
    () => serverAlerts,
  );
}

/** "I have seen it": the given notices (all of them without an argument) are not shown again. The papers stay in the library, marked as retracted. */
export function dismissAlerts(paperIds?: string[]) {
  const before = serverAlerts;
  serverAlerts = paperIds ? before.filter((a) => !paperIds.includes(a.paperId)) : [];
  recompute();
  pending++;
  void fetch("/api/v1/library/alerts/seen", jsonInit("POST", paperIds ? { paperIds } : {}))
    .catch(() => null)
    .then((res) => {
      if (res?.ok) return;
      serverAlerts = before;
      recompute();
      showNotice("That could not be saved. Please check your connection and try again.");
    })
    .finally(() => pending--);
}

async function pushServer(op: () => Promise<Response | null>, rollback: () => void) {
  pending++;
  const res = await op().finally(() => pending--);
  if (!res?.ok) {
    rollback();
    showNotice(res?.status === 409 ? "Your library is full (2,000 papers)." : "That change could not be saved. Please check your connection and try again.");
  }
}

const idPath = (id: string) => `/api/v1/library/${encodeURIComponent(id)}`;

export function toggleSaved(paper: Paper) {
  const user = getAuthState().user;
  const has = view.some((p) => p.id === paper.id);
  if (!user) {
    local.set(has ? local.get().filter((p) => p.id !== paper.id) : [{ ...paper, savedAt: Date.now() }, ...local.get()]);
    return;
  }
  const before = serverItems;
  const alertsBefore = serverAlerts;
  serverItems = has ? before.filter((p) => p.id !== paper.id) : [{ ...paper, savedAt: Date.now() }, ...before];
  if (has) serverAlerts = serverAlerts.filter((a) => a.paperId !== paper.id); // removing the paper settles its notice (the server does the same)
  recompute();
  void pushServer(
    () => fetch(idPath(paper.id), has ? jsonInit("DELETE") : jsonInit("PUT", paper)).catch(() => null),
    () => {
      serverItems = before;
      serverAlerts = alertsBefore;
      recompute();
    },
  );
}

export function removeSaved(id: string) {
  const paper = view.find((p) => p.id === id);
  if (paper) toggleSaved(paper); // present in view -> toggling removes it
}

/** Called after the account is deleted so no stale rows linger in memory. */
export function resetLibraryView() {
  serverUserId = null;
  serverItems = [];
  serverAlerts = [];
  recompute();
}
