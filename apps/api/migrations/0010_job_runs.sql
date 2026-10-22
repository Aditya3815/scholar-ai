-- Heartbeat of the scheduled jobs: what each one did last. GET /api/v1/health/jobs and the admin page read it, so a cron that stops running,
-- fails, or hangs is noticed (an uptime check on that address turns it into an alert).
-- last_result is kept next to the times, not worked out from them: two runs in the same second must not look like one failing run.
CREATE TABLE job_runs (
  name TEXT PRIMARY KEY,
  last_started_at TEXT,
  last_finished_at TEXT,
  last_result TEXT CHECK (last_result IN ('ok', 'failed')),
  last_ok_at TEXT,
  last_error TEXT,
  runs INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0
);

-- The migration time counts as the first good run, so a job that never starts is reported "overdue" one day after deploy, not never.
INSERT INTO job_runs (name, last_ok_at) VALUES ('maintenance', datetime('now'));
