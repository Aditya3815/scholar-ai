import type { CacheStore } from "../cache/store";

/** Read-through cache over a CacheStore. A failing cache never breaks a search: it just means a live call. */

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function cacheKey(source: string, ...parts: string[]): Promise<string> {
  return `${source}:${(await sha256(parts.join("\u0000"))).slice(0, 32)}`;
}

export async function cached<T>(
  store: CacheStore,
  source: string,
  key: string,
  ttlSeconds: number,
  load: () => Promise<T>,
): Promise<{ value: T; hit: boolean }> {
  try {
    const hit = await store.get(key);
    if (hit) return { value: JSON.parse(hit) as T, hit: true };
  } catch (err) {
    console.warn("cache read failed", err);
  }

  const value = await load();

  try {
    await store.set(key, JSON.stringify(value), ttlSeconds, source);
  } catch (err) {
    console.warn("cache write failed", err);
  }
  return { value, hit: false };
}
