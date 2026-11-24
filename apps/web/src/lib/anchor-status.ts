import { useSyncExternalStore } from "react";

/**
 * The saved highlights whose words the reader could not find on their page (the anchoring engine, @scholar/shared anchor.ts), so that a highlight's card can say so instead of the
 * highlight vanishing in silence. Known once the page has been drawn; the viewer writes it, the cards read it. Kept in memory only, for this visit.
 */
const missing = new Set<string>();
const listeners = new Set<() => void>();

/** What one page's drawing found: `placed` were drawn, `notFound` were not. */
export function setPlaced(placed: readonly string[], notFound: readonly string[]) {
  let changed = false;
  for (const id of placed) changed = missing.delete(id) || changed;
  for (const id of notFound) {
    if (!missing.has(id)) {
      missing.add(id);
      changed = true;
    }
  }
  if (changed) listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
/** True when the highlight was looked for on its page and not found there. */
export const useNotFound = (id: string): boolean => useSyncExternalStore(subscribe, () => missing.has(id), () => false);
