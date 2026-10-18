-- "Report a problem" from the app: a wrong answer, a wrong citation, a wrong reference verdict, a missed paper.
-- What is stored is only what the user chose to send: the note, and the text they were looking at (for an answer, the question, the answer
-- and its cited passages, read back from the user's own record; for a reference, the reference text and our verdict). Used to grow the eval
-- sets and to fix bugs. Deleted with the account, and after a year.
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('answer', 'reference', 'idea', 'other')),
  problem TEXT NOT NULL,
  note TEXT,
  context TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_feedback_created ON feedback (created_at);
CREATE INDEX idx_feedback_user ON feedback (user_id, created_at);
