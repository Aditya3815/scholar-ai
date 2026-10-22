/** Scheduled jobs and whether they ran on time (see apps/api/src/jobs.ts). */

/** ok: ran on time and succeeded. failing: the last run threw. stuck: it started and never finished. overdue: no good run in time (or it never reported). */
export type JobState = "ok" | "failing" | "stuck" | "overdue";
export type JobStatus = { name: string; state: JobState; lastOkAt: string | null; lastError: string | null; runs: number; failures: number };
/** GET /api/v1/health/jobs: 200 when every scheduled job is ok, 503 otherwise. No error text: it is public. */
export type JobsHealthResponse = { ok: boolean; scheduled: boolean; jobs: { name: string; state: JobState; lastOkAt: string | null; runs: number }[]; error?: "db" };
