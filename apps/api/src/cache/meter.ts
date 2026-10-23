import type { CacheStore } from "./store";

/**
 * Counts hits and misses per source so the admin page can say how many upstream calls the cache saved (OpenAlex and Crossref are the ones with a budget or a rate).
 * Counting is in memory; the counts reach the database in ONE small batch at most every `delayMs`, after the response has gone (waitUntil), so a request never waits for it
 * and a busy Worker does not write on every lookup. A Worker that is stopped between two flushes loses a second of counts: these are measurements, not accounts.
 */
export type CacheRow = { source: string; hits: number; misses: number };

/** `search:openalex:3fa9...` -> `search:openalex`; `doicheck:3fa9...` -> `doicheck`. */
export const sourceOfKey = (key: string): string => {
  const i = key.lastIndexOf(":");
  return i > 0 ? key.slice(0, i) : key;
};

type Target = { waitUntil(p: Promise<unknown>): void };

export class CacheMeter {
  private counts = new Map<string, CacheRow>();
  private scheduled = false;
  private target: { ctx: Target; write: (rows: CacheRow[]) => Promise<void> } | null = null;
  constructor(private delayMs = 1500, private sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {}

  /** Called at the start of a request: from now on counts are written through `write`, scheduled on this request's context. */
  attach(ctx: Target, write: (rows: CacheRow[]) => Promise<void>) {
    this.target = { ctx, write };
  }

  record(source: string, hit: boolean) {
    const row = this.counts.get(source) ?? { source, hits: 0, misses: 0 };
    if (hit) row.hits++;
    else row.misses++;
    this.counts.set(source, row);
    this.schedule();
  }

  /** What has been counted since the last drain, which is then forgotten. */
  drain(): CacheRow[] {
    const rows = [...this.counts.values()];
    this.counts.clear();
    return rows;
  }

  private schedule() {
    if (this.scheduled || !this.target) return;
    this.scheduled = true;
    const { ctx, write } = this.target;
    try {
      ctx.waitUntil(
        (async () => {
          await this.sleep(this.delayMs);
          this.scheduled = false;
          const rows = this.drain();
          if (rows.length > 0) await write(rows).catch((e) => console.warn("cache stats write failed", e));
        })(),
      );
    } catch {
      // the request that was attached has already finished: try again with the next request's context
      this.scheduled = false;
    }
  }
}

/** The same store, with every read counted. Writes are not (a write follows a miss that was counted). */
export function meteredStore(store: CacheStore, meter: CacheMeter): CacheStore {
  return {
    async get(key) {
      const v = await store.get(key);
      meter.record(sourceOfKey(key), v !== null);
      return v;
    },
    getMany: store.getMany
      ? async (keys) => {
          const got = await store.getMany!(keys);
          for (const key of keys) meter.record(sourceOfKey(key), (got.get(key) ?? null) !== null);
          return got;
        }
      : undefined,
    set: (key, value, ttl, source) => store.set(key, value, ttl, source),
  };
}

/** One batch of upserts into the per-day table (migration 0013). */
export async function writeCacheRows(db: D1Database, rows: CacheRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db.batch(
    rows.map((r) =>
      db
        .prepare("INSERT INTO cache_stats (day, source, hits, misses) VALUES (date('now'), ?1, ?2, ?3) ON CONFLICT (day, source) DO UPDATE SET hits = hits + ?2, misses = misses + ?3")
        .bind(r.source, r.hits, r.misses),
    ),
  );
}
