import { useSyncExternalStore } from "react";

/** One dismissible banner for things the user should know about (sign-in errors, library problems, account deleted). */
let message: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const showNotice = (text: string) => {
  message = text;
  emit();
};
export const clearNotice = () => {
  message = null;
  emit();
};
export const useNotice = (): string | null =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => message,
    () => message,
  );
