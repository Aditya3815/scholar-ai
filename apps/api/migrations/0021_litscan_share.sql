-- A read-only link to a literature scan (docs/design/litscan.md, "Share a link"). The person turns it on for one scan that has ended and can turn it off at any time; the link shows the topic,
-- the approved sub-questions and the checked report, nothing about who made it. It lives no longer than the scan (24 hours: the share is found through the scan's expires_at), it goes
-- when the scan is deleted or the account is erased, and a person has a handful at a time.
CREATE TABLE litscan_shares (
  token TEXT PRIMARY KEY,                                   -- random (32 bytes, base64url): whoever has it can read the scan, like any shared link
  scan_id TEXT NOT NULL UNIQUE REFERENCES litscans (id),    -- one link a scan
  user_id TEXT NOT NULL REFERENCES users (id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_litscan_shares_user ON litscan_shares (user_id);
