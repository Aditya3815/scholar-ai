import { LITSCAN_PURGE_SQL } from "./litscan/store";
import { OUTCOME_RETENTION_SQL } from "./outcomes";

/**
 * Daily housekeeping (cron). Everything deleted here is either already unusable (expired) or past its retention window.
 * Counts are returned and logged so a cron that silently stops doing anything is visible.
 */
const JOBS: { name: string; sql: string }[] = [
  { name: "api_cache", sql: "DELETE FROM api_cache WHERE expires_at < datetime('now')" },
  { name: "sessions", sql: "DELETE FROM sessions WHERE expires_at < datetime('now')" },
  { name: "oauth_states", sql: "DELETE FROM oauth_states WHERE expires_at < datetime('now')" },
  // Quota checks only look at today; 90 days is plenty for cost review.
  { name: "llm_usage", sql: "DELETE FROM llm_usage WHERE ts < datetime('now', '-90 days')" },
  // The daily page count only matters for today; a few weeks stay for cost review.
  { name: "ocr_usage", sql: "DELETE FROM ocr_usage WHERE day < date('now', '-35 days')" },
  // Hit and miss counts of the public cache: a few weeks are enough to see a trend.
  { name: "cache_stats", sql: "DELETE FROM cache_stats WHERE day < date('now', '-35 days')" },
  // Reports are kept for a year, long enough to learn from, then removed.
  { name: "feedback", sql: "DELETE FROM feedback WHERE created_at < datetime('now', '-365 days')" },
  // A key only matters for a retry made soon after the first request; a day is plenty.
  { name: "idempotency_keys", sql: "DELETE FROM idempotency_keys WHERE created_at < datetime('now', '-1 day')" },
  // How many new papers a person brought into the shared index on a day: only today matters; a few weeks stay for a look at use.
  { name: "oa_daily", sql: "DELETE FROM oa_daily WHERE day < date('now', '-35 days')" },
  // How answers went: a few weeks are enough to see a trend (src/outcomes.ts).
  { name: "answer_outcomes", sql: OUTCOME_RETENTION_SQL },
  // A literature scan is kept for a day (its expires_at), then its events and the scan go; the daily counter for a few weeks.
  ...LITSCAN_PURGE_SQL.map((sql, i) => ({ name: ["litscan_shares", "litscan_events", "litscans", "litscan_daily"][i]!, sql })),
  { name: "audit_log", sql: "DELETE FROM audit_log WHERE ts < datetime('now', '-365 days')" },
];

export async function runMaintenance(db: D1Database): Promise<Record<string, number>> {
  const results = await db.batch(JOBS.map((j) => db.prepare(j.sql)));
  return Object.fromEntries(JOBS.map((j, i) => [j.name, results[i]?.meta.changes ?? 0]));
}
