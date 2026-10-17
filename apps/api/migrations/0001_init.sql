-- Phase 0 foundation tables. Aur tables phase-wise migrations mein aayengi.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'scholar' CHECK (role IN ('scholar', 'professor', 'admin')),
  locale TEXT NOT NULL DEFAULT 'en',
  theme_pref TEXT NOT NULL DEFAULT 'system',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE api_cache (
  key TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  payload TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_api_cache_expires ON api_cache (expires_at);

CREATE TABLE usage_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users (id),
  kind TEXT NOT NULL,
  provider TEXT,
  tokens_in INTEGER NOT NULL DEFAULT 0,
  tokens_out INTEGER NOT NULL DEFAULT 0,
  cost_cents REAL NOT NULL DEFAULT 0,
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_usage_user_ts ON usage_ledger (user_id, ts);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  progress INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT UNIQUE,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_jobs_user ON jobs (user_id, created_at);
