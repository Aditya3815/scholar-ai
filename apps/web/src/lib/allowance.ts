import { useEffect, useSyncExternalStore } from "react";
import { api } from "./api/client";

/** Today's AI allowance of the signed-in person (GET /api/v1/account/allowance): what the ring in the menu shows. Numbers only. */
export type Allowance = { limit: number; used: number; left: number };

let value: Allowance | null = null;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const getAllowance = (): Allowance | null => value;
export const clearAllowance = () => {
  value = null;
  emit();
};

/** Asks again (a call already on its way is the answer). A failure keeps what was shown: the ring is a gauge, not a thing that can break the page. */
export function refreshAllowance(): Promise<void> {
  inflight ??= api<Allowance>("/api/v1/account/allowance")
    .then((a) => {
      value = a;
      emit();
    })
    .catch(() => undefined)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** A finished reply may have used tokens: ask for the new number a moment later (the ledger is written after the stream ends). */
export const allowanceMayHaveChanged = () => void setTimeout(() => void refreshAllowance(), 1200);

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The allowance, kept fresh while the page is visible (on mount, on return to the tab, every minute). `enabled` false (nobody signed in): nothing is asked. */
export function useAllowance(enabled: boolean): Allowance | null {
  const a = useSyncExternalStore(subscribe, getAllowance, getAllowance);
  useEffect(() => {
    if (!enabled) return;
    void refreshAllowance();
    const again = () => document.visibilityState === "visible" && void refreshAllowance();
    const timer = setInterval(again, 60_000);
    document.addEventListener("visibilitychange", again);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", again);
    };
  }, [enabled]);
  return enabled ? a : null;
}

/** "42,300" → "42.3k" for the small label. */
export const shortTokens = (n: number): string => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));
