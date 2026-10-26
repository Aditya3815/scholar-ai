-- Idempotency keys: a request that creates something (uploading a paper, sending a report) can carry a random Idempotency-Key. If the same request is sent again with the
-- same key (a retry after a lost reply, a double click), the first result is returned instead of a second thing being created. Kept for a day, then removed by the daily
-- clean-up. `status` is NULL while the first request is still running; only successful replies are kept (an error is simply tried again).
CREATE TABLE idempotency_keys (
  user_id TEXT NOT NULL,
  route TEXT NOT NULL,        -- which endpoint ("documents", "feedback"): the same key on another endpoint is another request
  key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,  -- what the request was (size and name of a file, a hash of a report): the same key with something else is refused
  status INTEGER,
  body TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, route, key)
);
CREATE INDEX idx_idempotency_created ON idempotency_keys (created_at);
