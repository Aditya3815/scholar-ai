import { LITSCAN_PURGE_SQL } from "./litscan/store";
import { OUTCOME_RETENTION_SQL } from "./outcomes";

/**
 * Daily housekeeping (cron). Everything deleted here is either already unusable (expired) or past its retention window.
 * Counts are returned and logged so a cron that silently stops doing anything is visible.
 */
export const MAINTENANCE_JOBS: { name: string; sql: string }[] = [
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

/** Every purge is `DELETE FROM <table> WHERE <what is past its date>`; this is the same purge taking at most `?1` rows (through their row number), so one night never holds the database for long. */
const PLAIN_DELETE = /^DELETE FROM (\w+) WHERE ([^;]+)$/;
export function chunkedDelete(sql: string): string {
  const m = PLAIN_DELETE.exec(sql.trim());
  if (!m) throw new Error(`not a plain DELETE ... WHERE: ${sql.slice(0, 60)}`);
  return `DELETE FROM ${m[1]} WHERE rowid IN (SELECT rowid FROM ${m[1]} WHERE ${m[2]} LIMIT ?1)`;
}

export const CHUNK_ROWS = 5000;
/** The night's clean-up may use this long (wall clock); what is left waits for tomorrow, in order. */
export const BUDGET_MS = 25_000;

/**
 * Each purge runs on its own, in pieces. A table that holds a row for every call or every visit (llm_usage) can have millions of rows past their date after a long outage of the job:
 * one statement over all of them would run for longer than D1 allows, fail, and fail again every night. In pieces it makes progress every night; a job that fails does not undo the
 * others (they used to share one transaction), and the run then fails naming it, so the job's health check says so.
 */
export async function runMaintenance(
  db: D1Database,
  opts: { jobs?: { name: string; sql: string }[]; chunk?: number; budgetMs?: number; now?: () => number } = {},
): Promise<Record<string, number>> {
  const jobs = opts.jobs ?? MAINTENANCE_JOBS;
  const chunk = Math.max(1, Math.trunc(opts.chunk ?? CHUNK_ROWS));
  const now = opts.now ?? Date.now;
  const started = now();
  const budget = opts.budgetMs ?? BUDGET_MS;
  const out: Record<string, number> = {};
  const failed: string[] = [];
  for (const job of jobs) {
    out[job.name] = 0;
    try {
      const sql = chunkedDelete(job.sql);
      for (;;) {
        if (now() - started > budget) {
          console.warn(JSON.stringify({ level: "warn", msg: "maintenance_budget", job: job.name, deleted: out[job.name] }));
          break;
        }
        const res = await db.prepare(sql).bind(chunk).run();
        const n = res.meta?.changes ?? 0;
        out[job.name]! += n;
        if (n < chunk) break;
      }
    } catch (e) {
      failed.push(job.name);
      console.error(JSON.stringify({ level: "error", msg: "maintenance_job_failed", job: job.name, error: e instanceof Error ? e.message.slice(0, 200) : "unknown" }));
    }
  }
  if (failed.length) throw new Error(`maintenance: ${failed.join(", ")} failed`);
  return out;
}
