-- The Trending list (docs/design/chatview-and-trending.md, T3 and T12) is made by a third scheduled job in the 03:17 UTC run, and /api/v1/health/jobs reports it like the other two.
-- Nothing new is stored in the database: the list itself is one public file in Workers KV (key trending:v1), and this row is only the job's heartbeat.
--
-- The migration time counts as its first good run, as for the daily clean-up (0010) and the retraction re-check (0018): without the row /api/v1/health/jobs would call a job that has not had its
-- first night yet overdue, and answer 503 right after the deploy.
INSERT INTO job_runs (name, last_ok_at) VALUES ('trending', datetime('now'));
