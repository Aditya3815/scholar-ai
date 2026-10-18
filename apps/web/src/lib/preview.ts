import { useSyncExternalStore } from "react";
import type { Paper } from "@scholar/shared";

/** One preview sheet for the whole app: any card can open it, with the list it came from so the reader can step through. */
export type PreviewState = { open: boolean; items: Paper[]; index: number; /** which way the user last moved, for the slide direction */ dir: 1 | -1 };

let state: PreviewState = { open: false, items: [], index: 0, dir: 1 };
const listeners = new Set<() => void>();
const set = (next: PreviewState) => {
  state = next;
  listeners.forEach((l) => l());
};

export function openPreview(paper: Paper, siblings?: Paper[]) {
  const items = siblings && siblings.some((p) => p.id === paper.id) ? siblings : [paper];
  set({ open: true, items, index: Math.max(0, items.findIndex((p) => p.id === paper.id)), dir: 1 });
}
export const closePreview = () => set({ ...state, open: false });
export function stepPreview(by: 1 | -1) {
  const index = state.index + by;
  if (index < 0 || index >= state.items.length) return;
  set({ ...state, index, dir: by });
}

export const usePreview = (): PreviewState =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
