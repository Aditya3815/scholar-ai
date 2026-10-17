-- LLM Gateway usage ledger. Separate from the Phase-0 `usage_ledger` (which has a FOREIGN KEY to users):
-- `subject` is a user id OR "anon:<hash>", and users do not exist until auth lands.
CREATE TABLE llm_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  task TEXT NOT NULL,
  sensitivity TEXT NOT NULL CHECK (sensitivity IN ('public', 'private')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_cents REAL NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1,
  ms INTEGER NOT NULL DEFAULT 0,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_llm_usage_subject_ts ON llm_usage (subject, ts);
