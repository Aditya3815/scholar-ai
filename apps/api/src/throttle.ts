/**
 * Slot reservation for a shared "N request per interval" gate (used by the Semantic Scholar Durable Object).
 * Pure so it can be unit tested without a Workers runtime.
 *
 * Callers are served in order, one slot per `intervalMs`. If the next free slot is further away than `maxWaitMs` the
 * caller is refused (null) instead of queueing: a search that would wait that long is better off without that source.
 */
export type Slot = { waitMs: number; nextFree: number };

export function reserveSlot(now: number, nextFree: number, maxWaitMs: number, intervalMs: number): Slot | null {
  const start = Math.max(now, nextFree);
  const waitMs = start - now;
  if (waitMs > maxWaitMs) return null;
  return { waitMs, nextFree: start + intervalMs };
}
