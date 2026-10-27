import type { JobState, JobStatus } from "@scholar/shared";
import { fromSqliteTime } from "./library/validate";
import { scrubMessage } from "./monitoring/sentry";

/**
 * Scheduled jobs leave a heartbeat in `job_runs`, so that a cron which silently stops, fails or hangs is visible (admin page, and
 * GET /api/v1/health/jobs for an uptime check). The job's own result always comes first: a failed heartbeat write is logged and never
 * changes what the job returns or throws.
 */
export const JOB_SPECS = {
  // Daily at 03:17 UTC (wrangler.jsonc). The grace covers a late start and clock drift; a run that has not finished in an hour is stuck.
  maintenance: { everyHours: 24, graceHours: 6 },
  // The same cron: saved papers are looked at again for retractions (library/retraction.ts), each at most once a week, a few hundred a run.
  retraction_check: { everyHours: 24, graceHours: 6 },
} as const;
export type JobName = keyof typeof JOB_SPECS;

const HOUR = 3_600_000;
export const STUCK_AFTER_MS = HOUR;

export type JobRow = {
  name: string;
  last_started_at: string | null;
  last_finished_at: string | null;
  last_result: "ok" | "failed" | null;
  last_ok_at: string | null;
  last_error: string | null;
  runs: number;
  failures: number;
};

const at = (s: string | null | undefined) => (s ? fromSqliteTime(s) : NaN);
const iso = (s: string | null | undefined) => (Number.isFinite(at(s)) ? new Date(at(s)).toISOString() : null);

/** Worst first: a run that failed is reported as failing even when the last good run was long ago. */
export function jobState(row: JobRow | undefined, spec: { everyHours: number; graceHours: number }, now: number): JobState {
  if (!row) return "overdue";
  if (row.last_result === "failed") return "failing";
  const started = at(row.last_started_at);
  const finished = at(row.last_finished_at);
  if (Number.isFinite(started) && (!Number.isFinite(finished) || started > finished) && now - started > STUCK_AFTER_MS) return "stuck";
  const ok = at(row.last_ok_at);
  if (!Number.isFinite(ok) || now - ok > (spec.everyHours + spec.graceHours) * HOUR) return "overdue";
  return "ok";
}

export function jobStatuses(rows: JobRow[], now: number): JobStatus[] {
  const byName = new Map(rows.map((r) => [r.name, r]));
  return (Object.keys(JOB_SPECS) as JobName[]).map((name) => {
    const row = byName.get(name);
    return { name, state: jobState(row, JOB_SPECS[name], now), lastOkAt: iso(row?.last_ok_at), lastError: row?.last_error ?? null, runs: row?.runs ?? 0, failures: row?.failures ?? 0 };
  });
}

export async function readJobs(db: D1Database, now = Date.now()): Promise<JobStatus[]> {
  const rows = await db.prepare("SELECT name, last_started_at, last_finished_at, last_result, last_ok_at, last_error, runs, failures FROM job_runs").all<JobRow>();
  return jobStatuses(rows.results, now);
}

async function beat(label: string, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "job_heartbeat_failed", step: label, error: scrubMessage(e) }));
  }
}

/** Runs a scheduled job and records that it started, and whether it finished well. Returns what the job returns; rethrows what it throws. */
export async function runJob<T>(db: D1Database, name: JobName, job: () => Promise<T>): Promise<T> {
  await beat("start", () =>
    db
      .prepare("INSERT INTO job_runs (name, last_started_at, runs) VALUES (?1, datetime('now'), 1) ON CONFLICT (name) DO UPDATE SET last_started_at = datetime('now'), runs = runs + 1")
      .bind(name)
      .run(),
  );
  let result: T;
  try {
    result = await job();
  } catch (e) {
    await beat("failed", () =>
      db
        .prepare("UPDATE job_runs SET last_finished_at = datetime('now'), last_result = 'failed', last_error = ?2, failures = failures + 1 WHERE name = ?1")
        .bind(name, scrubMessage(e, 200))
        .run(),
    );
    throw e;
  }
  await beat("finish", () =>
    db.prepare("UPDATE job_runs SET last_finished_at = datetime('now'), last_result = 'ok', last_ok_at = datetime('now'), last_error = NULL WHERE name = ?1").bind(name).run(),
  );
  return result;
}
