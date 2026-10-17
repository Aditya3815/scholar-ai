-- Server-side library (synced across devices) and a minimal audit trail.
-- `data` is the Paper snapshot as shown in search (title, authors, DOI, abstract, ...), validated server-side on write.
CREATE TABLE library_items (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  paper_id TEXT NOT NULL,
  data TEXT NOT NULL,
  saved_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, paper_id)
);
CREATE INDEX idx_library_user_saved ON library_items (user_id, saved_at DESC);

-- No personal data in here on purpose (actor is an opaque id; deleted accounts leave only "account_deleted" + timestamp).
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  actor TEXT,
  action TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX idx_audit_ts ON audit_log (ts);
