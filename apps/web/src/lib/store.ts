import { useSyncExternalStore } from "react";

/** localStorage-backed chhota store; storage fail ho toh in-memory chalta rehta hai (private mode). */
export function createPersistedStore<T>(key: string, initial: T, parse: (raw: unknown) => T) {
  let state = initial;
  try {
    const raw = localStorage.getItem(key);
    if (raw) state = parse(JSON.parse(raw));
  } catch {
    /* corrupt ya blocked storage: defaults */
  }
  const listeners = new Set<() => void>();

  const store = {
    get: () => state,
    set(next: T) {
      state = next;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      listeners.forEach((l) => l());
    },
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };

  return {
    ...store,
    use: () => useSyncExternalStore(store.subscribe, store.get, store.get),
  };
}
