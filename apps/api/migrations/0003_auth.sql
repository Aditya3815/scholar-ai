-- Auth: users + identities (Google, ORCID) + sessions + pending OAuth states.
--
-- The Phase-0 `users` table required a NOT NULL UNIQUE email, but an ORCID login has no email. SQLite cannot relax that
-- in place, so the table is recreated. It is empty at this point (no sign-in existed), and the tables that reference it
-- (usage_ledger, jobs) are empty too, so the DROP cannot violate a foreign key.
DROP TABLE users;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT,
  email_verified INTEGER NOT NULL DEFAULT 0,
  name TEXT,
  avatar_url TEXT,
  orcid TEXT,
  role TEXT NOT NULL DEFAULT 'scholar' CHECK (role IN ('scholar', 'professor', 'admin')),
  locale TEXT NOT NULL DEFAULT 'en',
  theme_pref TEXT NOT NULL DEFAULT 'auto',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT,
  deleted_at TEXT
);
-- email unique only when present (ORCID-only users have none)
CREATE UNIQUE INDEX idx_users_email ON users (email) WHERE email IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_users_orcid ON users (orcid) WHERE orcid IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE identities (
  provider TEXT NOT NULL CHECK (provider IN ('google', 'orcid')),
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, subject)
);
CREATE INDEX idx_identities_user ON identities (user_id);

-- `id` is SHA-256(session token): a leaked database does not leak usable session cookies.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

-- One row per login attempt in flight; deleted on use (single-use state) and after 10 minutes.
CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  return_to TEXT NOT NULL DEFAULT '/',
  link_user_id TEXT,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_oauth_states_expires ON oauth_states (expires_at);
