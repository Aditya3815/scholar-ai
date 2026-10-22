-- Highlights and notes a researcher makes in their own uploaded paper. A highlight is a piece of the paper's text (found again by its words, so it
-- survives zoom and re-rendering) on one page, with an optional note. Private to the paper's owner; deleted with the paper.
CREATE TABLE doc_notes (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  quote TEXT NOT NULL,
  note TEXT,
  color TEXT NOT NULL DEFAULT 'yellow',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_doc_notes_doc ON doc_notes (doc_id, page, created_at);
