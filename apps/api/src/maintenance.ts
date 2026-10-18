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
  // Reports are kept for a year, long enough to learn from, then removed.
  { name: "feedback", sql: "DELETE FROM feedback WHERE created_at < datetime('now', '-365 days')" },
  { name: "audit_log", sql: "DELETE FROM audit_log WHERE ts < datetime('now', '-365 days')" },
];

export async function runMaintenance(db: D1Database): Promise<Record<string, number>> {
  const results = await db.batch(JOBS.map((j) => db.prepare(j.sql)));
  return Object.fromEntries(JOBS.map((j, i) => [j.name, results[i]?.meta.changes ?? 0]));
}
