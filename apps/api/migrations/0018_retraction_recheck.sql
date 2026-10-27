-- S3: saved papers are looked at again for retractions (a daily job, each paper at most once a week), and the person is told.
--
-- paper_retraction is SHARED and has no person in it: one row per DOI that someone has saved, what the retraction check last said about it and when. Crossref's retraction data is public.
CREATE TABLE paper_retraction (
  doi TEXT PRIMARY KEY,                       -- lower case, as in Paper.doi
  state TEXT NOT NULL CHECK (state IN ('clear', 'retracted', 'unknown')),  -- unknown: the service refused this DOI itself (a bad request), so it is not asked again for a week
  checked_at TEXT NOT NULL DEFAULT (datetime('now')),
  retracted_at TEXT                           -- when the job first saw it retracted
);
CREATE INDEX idx_paper_retraction_checked ON paper_retraction (checked_at);

-- A notice for one person about one paper they saved. Made by the job when a saved paper turns out to be retracted; shown until they dismiss it or remove the paper from their library.
-- The title is kept here so the notice still reads right if the paper is removed. Erased with the account (account/erase.ts) and part of the data export.
CREATE TABLE library_alerts (
  user_id TEXT NOT NULL REFERENCES users (id),
  paper_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'retracted',
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  seen_at TEXT,
  PRIMARY KEY (user_id, paper_id, kind)
);
CREATE INDEX idx_library_alerts_user ON library_alerts (user_id, seen_at);

-- The new job's first good run is the migration itself, as for the daily clean-up (0010): without it /api/v1/health/jobs would call a job that has not had its first night yet overdue.
INSERT INTO job_runs (name, last_ok_at) VALUES ('retraction_check', datetime('now'));
