-- Scanned papers: a PDF whose pages are pictures is read page by page (docs/ocr.md). The page pictures are never stored: only what was read, and how well.
ALTER TABLE documents ADD COLUMN scanned INTEGER NOT NULL DEFAULT 0;

-- One row per page that has to be read from its picture. 'pending' = not read yet (the list of what is left is kept here, so a reading that is
-- stopped, or interrupted by closing the tab, continues where it was). `text` is what the first model read (kept only for 'ok' and 'warn'; the
-- same words are also in doc_chunks for questions). `disagreement` = share of characters on which the two models differ.
CREATE TABLE doc_ocr (
  doc_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'warn', 'unreliable', 'empty')),
  disagreement REAL,
  disputed TEXT,
  why TEXT,
  text TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (doc_id, page)
);

-- Pages read per person per day (UTC), for the daily limit; neurons = what Workers AI reported, for cost review.
CREATE TABLE ocr_usage (
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  pages INTEGER NOT NULL DEFAULT 0,
  neurons REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
