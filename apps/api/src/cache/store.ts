/**
 * Minimal key/value cache with TTL for PUBLIC data (search results, DOI and retraction checks, reference lookups, public model answers). Production keeps it in
 * Workers KV (`kvStore`); without that binding (local runs, tests) it falls back to D1 (`api_cache`), and tests and the eval harness use memory. The search
 * pipeline depends on this interface, not on any of them. Never put a person's own text, file or idea in it (docs/spikes/R6-kv-cache.md).
 */
export interface CacheStore {
  get(key: string): Promise<string | null>;
  /** All of `keys` at once (a missing key is null). KV answers up to 100 keys in one operation, so a search checking 30 DOIs makes one read, not thirty. */
  getMany?(keys: string[]): Promise<Map<string, string | null>>;
  /** `source` is only a label (which provider produced the value). A TTL under a minute is rounded up where the store cannot do less (KV). */
  set(key: string, value: string, ttlSeconds: number, source?: string): Promise<void>;
}

/** `store.getMany` when the store has it, one read per key otherwise. */
export async function getMany(store: CacheStore, keys: string[]): Promise<Map<string, string | null>> {
  if (keys.length === 0) return new Map();
  if (store.getMany) return store.getMany(keys);
  return new Map(await Promise.all(keys.map(async (k) => [k, await store.get(k)] as const)));
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
    async getMany(keys) {
      const out = new Map<string, string | null>(keys.map((k) => [k, null]));
      for (let i = 0; i < keys.length; i += 90) {
        const part = keys.slice(i, i + 90);
        const rows = await db
          .prepare(`SELECT key, payload FROM api_cache WHERE key IN (${part.map((_, j) => `?${j + 1}`).join(",")}) AND expires_at > datetime('now')`)
          .bind(...part)
          .all<{ key: string; payload: string }>();
        for (const r of rows.results) out.set(r.key, r.payload);
      }
      return out;
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
  const read = (key: string) => {
    const hit = m.get(key);
    return hit && hit.expires > now() ? hit.value : null;
  };
  return {
    async get(key) {
      return read(key);
    },
    async getMany(keys) {
      return new Map(keys.map((k) => [k, read(k)] as const));
    },
    async set(key, value, ttlSeconds) {
      m.set(key, { value, expires: now() + ttlSeconds * 1000 });
    },
  };
}
