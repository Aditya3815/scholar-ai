import { useSyncExternalStore } from "react";

/** "Remember this?" on the home screen is on until the person turns it off. The choice stays on this device; nothing about it is sent anywhere. */
const KEY = "scholar.remember";
const listeners = new Set<() => void>();
const read = (): boolean => {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
};
export function setRememberOn(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* private mode: the choice lasts until the page is closed */
  }
  listeners.forEach((l) => l());
}
export const useRememberOn = (): boolean =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      window.addEventListener("storage", l);
      return () => {
        listeners.delete(l);
        window.removeEventListener("storage", l);
      };
    },
    read,
    () => true,
  );
