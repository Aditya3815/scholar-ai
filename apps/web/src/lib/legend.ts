import { useSyncExternalStore } from "react";
import { cleanLegend, type Legend, type NoteColor } from "@scholar/shared";

/** What the reader's four highlight colours mean to them. Kept on this device (it is a habit, not a document); a question about the highlights sends it so the answer can use the same words. */
const KEY = "scholar.legend.v1";
const listeners = new Set<() => void>();
let cache: Legend | null = null;

function load(): Legend {
  try {
    return cleanLegend(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return cleanLegend(null);
  }
}
const get = (): Legend => (cache ??= load());
/** The names as saved right now (after the store has tidied them). */
export const currentLegend = get;

export function setLegendName(color: NoteColor, name: string) {
  cache = cleanLegend({ ...get(), [color]: name });
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* private mode: the names last until the page is closed */
  }
  listeners.forEach((l) => l());
}

export const useLegend = (): Legend =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      const onStorage = (e: StorageEvent) => {
        if (e.key === KEY) {
          cache = null;
          l();
        }
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(l);
        window.removeEventListener("storage", onStorage);
      };
    },
    get,
    () => cleanLegend(null),
  );
