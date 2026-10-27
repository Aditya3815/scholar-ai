-- Literature scan (docs/design/litscan.md): one topic is split into sub-questions, each searched and answered from the papers' abstracts, the answers kept together as a report.
--
-- A scan is the person's own: the topic they wrote, the plan they approved, and what came of it. It is kept for 24 hours (expires_at), so a closed tab or another device can still find it,
-- and is removed by the daily clean-up (maintenance.ts), by the person (DELETE), or with the account (account/erase.ts), and is part of the data export. Only the plan's
-- search words ever reach a public service; the topic itself goes to the private model only.
CREATE TABLE litscans (
  id TEXT PRIMARY KEY,                       -- random, not guessable; every read also checks the owner
  user_id TEXT NOT NULL REFERENCES users (id),
  topic TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('en', 'hi', 'hinglish')),  -- the language the written answers use
  plan TEXT NOT NULL,                        -- JSON: the sub-questions the person approved ({ question, searchQuery }[])
  state TEXT NOT NULL DEFAULT 'running' CHECK (state IN ('running', 'completed', 'canceled', 'failed')),
  est_tokens INTEGER NOT NULL,               -- what the approval screen said it would use
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),  -- moves with every event: a running scan that stops moving is called failed (litscan/store.ts)
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_litscans_user ON litscans (user_id, created_at);
CREATE INDEX idx_litscans_expiry ON litscans (expires_at);

-- What happened, in order: the report is these rows folded together (shared/litscan.ts), so a page that was closed and reopened, or a second device, sees exactly the same.
-- `key` makes a write safe to repeat (a retried step writes its result again): the same key is stored once.
CREATE TABLE litscan_events (
  scan_id TEXT NOT NULL REFERENCES litscans (id),
  seq INTEGER NOT NULL,
  key TEXT NOT NULL,
  type TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (scan_id, seq),
  UNIQUE (scan_id, key)
);

-- How many scans a person has started today (UTC): a daily cap that deleting a scan does not reset.
CREATE TABLE litscan_daily (
  user_id TEXT NOT NULL REFERENCES users (id),
  day TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
