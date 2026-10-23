import type { CacheStore } from "../cache/store";

/**
 * Read-through cache over a CacheStore, for PUBLIC lookups. Rules that keep it safe:
 *  - a failing cache never breaks a request: a read that throws is a miss, a write that throws is logged and ignored;
 *  - a lookup that throws is never cached (only what the provider really answered, including "does not exist", which callers cache for a shorter time);
 *  - identical misses at the same moment share ONE call upstream (a client that sends a bibliography checks a handful of references in parallel; the same DOI, title or query
 *    often turns up in several of them). Without this a burst of identical misses made one call each, and the key is written more than once a second, which KV refuses.
 */

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function cacheKey(source: string, ...parts: string[]): Promise<string> {
  return `${source}:${(await sha256(parts.join("\u0000"))).slice(0, 32)}`;
}

/** Lookups running right now, per store (so two stores never share one). */
const running = new WeakMap<CacheStore, Map<string, Promise<unknown>>>();

/** `ttlSeconds` may depend on the answer (found: long, not found: short); a TTL of 0 or less means "do not keep this answer". */
export async function cached<T>(
  store: CacheStore,
  source: string,
  key: string,
  ttlSeconds: number | ((value: T) => number),
  load: () => Promise<T>,
): Promise<{ value: T; hit: boolean }> {
  try {
    const hit = await store.get(key);
    if (hit !== null) return { value: JSON.parse(hit) as T, hit: true };
  } catch (err) {
    console.warn("cache read failed", err);
  }

  let mine = running.get(store);
  if (!mine) running.set(store, (mine = new Map()));
  const sharing = mine.get(key);
  if (sharing) return { value: (await sharing) as T, hit: false };

  const call = (async () => {
    const value = await load();
    const ttl = typeof ttlSeconds === "function" ? ttlSeconds(value) : ttlSeconds;
    if (ttl > 0) {
      try {
        await store.set(key, JSON.stringify(value), ttl, source);
      } catch (err) {
        console.warn("cache write failed", err);
      }
    }
    return value;
  })();
  mine.set(key, call);
  try {
    return { value: await call, hit: false };
  } finally {
    if (mine.get(key) === call) mine.delete(key);
  }
}
