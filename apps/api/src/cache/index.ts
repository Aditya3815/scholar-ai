import { kvStore } from "./kv";
import { CacheMeter, meteredStore } from "./meter";
import { d1Store, type CacheStore } from "./store";

export * from "./store";
export { kvStore } from "./kv";
export { CacheMeter, meteredStore, sourceOfKey, writeCacheRows, type CacheRow } from "./meter";

/** One meter for the whole Worker (an isolate serves many requests; its counts are flushed in small batches, see meter.ts). */
export const meter = new CacheMeter();

export type CacheEnv = { DB: D1Database; CACHE?: KVNamespace };

/**
 * The public cache of this Worker: Workers KV when it is bound (production and staging), the database table otherwise (a local run without the binding).
 * Every read is counted. NEVER pass this anything a person wrote or uploaded.
 */
export function cacheStore(env: CacheEnv): CacheStore {
  return meteredStore(env.CACHE ? kvStore(env.CACHE) : d1Store(env.DB), meter);
}
