/**
 * Minimal key/value cache with TTL. Production uses D1 (`api_cache`); tests and the eval harness use memory, which is why the
 * search pipeline depends on this interface and not on D1 directly.
 */
export interface CacheStore {
  get(key: string): Promise<string | null>;
  /** `source` is only a label for the D1 table (which provider produced the value). */
  set(key: string, value: string, ttlSeconds: number, source?: string): Promise<void>;
}

export function d1Store(db: D1Database, defaultSource = "cache"): CacheStore {
  return {
    async get(key) {
      const row = await db
        .prepare("SELECT payload FROM api_cache WHERE key = ?1 AND expires_at > datetime('now')")
        .bind(key)
        .first<{ payload: string }>();
      return row?.payload ?? null;
    },
    async set(key, value, ttlSeconds, source) {
      await db
        .prepare("INSERT OR REPLACE INTO api_cache (key, source, payload, expires_at) VALUES (?1, ?2, ?3, datetime('now', ?4))")
        .bind(key, source ?? defaultSource, value, `+${ttlSeconds} seconds`)
        .run();
    },
  };
}

export function memoryStore(now: () => number = Date.now): CacheStore {
  const m = new Map<string, { value: string; expires: number }>();
  return {
    async get(key) {
      const hit = m.get(key);
      return hit && hit.expires > now() ? hit.value : null;
    },
    async set(key, value, ttlSeconds) {
      m.set(key, { value, expires: now() + ttlSeconds * 1000 });
    },
  };
}
