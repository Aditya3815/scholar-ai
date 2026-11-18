-- Sharing a paper's workspace (docs/design/paper-share.md, section 6). Nothing here is read while the SHARE switch is off.

-- One row a shared paper: the link's position and role, the SHA-256 of its token (never the token: a copy of the database holds no working link), its expiry, and whether viewers may download.
CREATE TABLE doc_shares (
  doc_id TEXT PRIMARY KEY REFERENCES documents (id) ON DELETE CASCADE,
  link_mode TEXT NOT NULL DEFAULT 'restricted',   -- restricted | anyone
  link_role TEXT NOT NULL DEFAULT 'viewer',       -- viewer | commenter (never editor)
  token_hash TEXT UNIQUE,                         -- sha-256 (hex) of the link token; NULL = no link made yet
  expires_at TEXT,                                -- NULL = until stopped
  viewers_download INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The people the owner named. The address is kept only while the share exists, only to match that person (the first sign-in with it binds user_id), and deleted with it.
-- `id` is a random handle for the routes (an address in a path would be logged); `emailed_at` is when the invitation was last e-mailed (Resend: once an hour).
CREATE TABLE doc_members (
  doc_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  email TEXT NOT NULL,                            -- lower-cased, as typed by the owner
  id TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users (id) ON DELETE CASCADE,
  role TEXT NOT NULL,                             -- viewer | commenter | editor
  invited_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_opened_at TEXT,
  emailed_at TEXT,
  PRIMARY KEY (doc_id, email)
);
CREATE INDEX idx_doc_members_user ON doc_members (user_id);
CREATE INDEX idx_doc_members_email ON doc_members (email) WHERE user_id IS NULL;

-- Comments on a block of a page of notes (block:<pageId>:<blockId>) or on a highlight (note:<highlightId>), with replies (parent_id). An author whose account is deleted becomes NULL ("a former member").
CREATE TABLE doc_comments (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  anchor TEXT NOT NULL,
  parent_id TEXT,
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_doc_comments_doc ON doc_comments (doc_id, created_at);
CREATE INDEX idx_doc_comments_user ON doc_comments (user_id);

-- Invitations an owner made in a day (200 a day): counted here, not from doc_members, so removing a person does not give the count back.
CREATE TABLE share_daily (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,                              -- YYYY-MM-DD (UTC)
  invites INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
