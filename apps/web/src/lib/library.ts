import { useSyncExternalStore } from "react";
import type { Paper } from "@scholar/shared";
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
let view: SavedPaper[] = local.get();
const listeners = new Set<() => void>();

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

async function loadServer(userId: string): Promise<SavedPaper[] | null> {
  const res = await fetch("/api/v1/library", { credentials: "same-origin" }).catch(() => null);
  if (!res?.ok || serverUserId !== userId) return null;
  return ((await res.json()) as { items: SavedPaper[] }).items;
}

async function syncAfterLogin(userId: string) {
  let items = await loadServer(userId);
  if (!items) {
    if (serverUserId === userId) showNotice("We could not load your library. It will retry on your next visit.");
    return;
  }
  const device = local.get();
  if (device.length > 0) {
    const res = await fetch("/api/v1/library/import", jsonInit("POST", { items: device.slice(0, 500) })).catch(() => null);
    if (res?.ok) {
      local.set([]); // imported: nothing personal stays in this browser
      items = (await loadServer(userId)) ?? items;
    } else {
      showNotice("We could not move the papers saved on this device into your account. They are still here; try again later.");
    }
  }
  if (serverUserId !== userId) return;
  serverItems = items;
  recompute();
}

subscribeAuth(() => {
  const id = getAuthState().user?.id ?? null;
  if (id !== serverUserId) {
    serverUserId = id;
    serverItems = [];
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

async function pushServer(op: () => Promise<Response | null>, rollback: () => void) {
  const res = await op();
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
  serverItems = has ? before.filter((p) => p.id !== paper.id) : [{ ...paper, savedAt: Date.now() }, ...before];
  recompute();
  void pushServer(
    () => fetch(idPath(paper.id), has ? jsonInit("DELETE") : jsonInit("PUT", paper)).catch(() => null),
    () => {
      serverItems = before;
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
  recompute();
}
