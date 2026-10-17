import type { Paper } from "@scholar/shared";
import { createPersistedStore } from "./store";

/**
 * Library abhi is device ke localStorage mein hai (login Phase 0 Week 2 mein aata hai).
 * Interface (toggle/remove/use) wahi rahegi; baad mein D1 API se swap hoga.
 */
export type SavedPaper = Paper & { savedAt: number };

const store = createPersistedStore<SavedPaper[]>("scholar.library.v1", [], (raw) =>
  Array.isArray(raw) ? (raw as SavedPaper[]).filter((p) => p && typeof p.id === "string") : [],
);

export const useLibrary = store.use;

export function toggleSaved(paper: Paper) {
  const cur = store.get();
  if (cur.some((p) => p.id === paper.id)) store.set(cur.filter((p) => p.id !== paper.id));
  else store.set([{ ...paper, savedAt: Date.now() }, ...cur]);
}

export function removeSaved(id: string) {
  store.set(store.get().filter((p) => p.id !== id));
}
