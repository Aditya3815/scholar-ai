import { SWITCHES } from "../platform/switches";

/**
 * The names of what the Trending feed keeps in Workers KV (the `CACHE` namespace the public lookups already use: docs/spikes/R6-kv-cache.md). Everything here is public data made from OpenAlex
 * and arXiv counts: no person, no text a person wrote. The keys are not under the cache's `v1:` prefix, so the cache's "throw everything away" (a new KV_VERSION) leaves them alone.
 *
 *   trending:v1            the one file the page reads (served by GET /api/v1/home/trending). Written by the daily job; the last good one stays until a good one replaces it.
 *   trending:v1:off        the kill switch: the key existing, with any value, is "off". Set and removed by hand (docs/runbook.md); the job never writes it.
 *   trending:v1:pool       the weekly pool: about 40 verified-by-count candidates (global) and 20 (India), with the day they were computed from.
 *   trending:v1:scan       the weekly scan's progress (which batch is next), so a scan that did not fit in one run goes on in the next.
 *   trending:v1:scan:<day>:<n>   the counts of one batch of subfields, kept until the pool has been made from them.
 *   trending:v1:deny       the owner's deny list: a JSON list of phrases that are never candidates. Set by hand; optional.
 */
export const TRENDING_KEYS = {
  file: "trending:v1",
  /** the KV key of the switch TRENDING, declared with it (platform/switches.ts) */
  off: SWITCHES.TRENDING.kv.key,
  pool: "trending:v1:pool",
  scan: "trending:v1:scan",
  deny: "trending:v1:deny",
  batch: (day: string, n: number): string => `trending:v1:scan:${day}:${n}`,
} as const;

/** The file expires from KV after this long without a replacement (the page stops showing it after 48 hours anyway: `validUntil`). */
export const FILE_TTL_SECONDS = 14 * 86_400;
/** A scan's batches are kept this long, and are read once, when the scan is complete. */
export const BATCH_TTL_SECONDS = 10 * 86_400;
/** The pool and the scan's progress outlive a failed week. */
export const POOL_TTL_SECONDS = 30 * 86_400;
