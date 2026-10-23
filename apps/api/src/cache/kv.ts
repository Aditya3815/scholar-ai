import type { CacheStore } from "./store";

/**
 * The public cache in Workers KV: read-heavy, written rarely, every entry expires by itself (no clean-up job), and read from the edge near the person instead of from
 * the database's one region. What KV is and is not good at, and why a lookup cache fits: docs/spikes/R6-kv-cache.md.
 *
 * Things this honours on purpose:
 *  - KV is eventually consistent (a write can take about a minute to show in another place; a miss is cached too). Fine for a cache: the worst case is one extra call upstream.
 *  - `expirationTtl` cannot be under 60 seconds: shorter TTLs are rounded up.
 *  - A key is written at most once a second: callers coalesce identical misses (search/cache.ts) and a rejected write is only logged.
 *  - Keys are prefixed with a version, so a change in what is stored is made by changing VERSION, not by deleting anything. Keys stay far under the 512-byte limit (a source name and a hash).
 *  - A value over MAX_CHARS is not cached (a normal result is 1 to 100 KB); KV allows 25 MiB but reading megabytes to save a call is no saving.
 */
export const KV_VERSION = "v1";
export const KV_MIN_TTL_SECONDS = 60;
export const MAX_CACHED_CHARS = 1_000_000;
/** KV reads at most this many keys in one operation. */
const BULK = 100;

export function kvStore(kv: KVNamespace, opts: { /** how long a place keeps what it read, seconds (KV's minimum is 30) */ cacheTtl?: number } = {}): CacheStore {
  const cacheTtl = Math.max(30, opts.cacheTtl ?? 60);
  const k = (key: string) => `${KV_VERSION}:${key}`;
  return {
    async get(key) {
      return kv.get(k(key), { cacheTtl });
    },
    async getMany(keys) {
      const out = new Map<string, string | null>();
      for (let i = 0; i < keys.length; i += BULK) {
        const part = keys.slice(i, i + BULK);
        const got = await kv.get(part.map(k), { cacheTtl });
        for (const key of part) out.set(key, got.get(k(key)) ?? null);
      }
      return out;
    },
    async set(key, value, ttlSeconds, source) {
      if (value.length > MAX_CACHED_CHARS) return;
      await kv.put(k(key), value, { expirationTtl: Math.max(KV_MIN_TTL_SECONDS, Math.ceil(ttlSeconds)), metadata: { s: source ?? null } });
    },
  };
}
