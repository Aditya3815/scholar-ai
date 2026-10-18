-- Uploaded papers (the user's own PDFs) and the text chunks used to answer questions about them.
-- The PDF itself lives in R2 (docs/<user>/<id>.pdf); everything here is private to its owner and removed with the account.
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  filename TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  pages INTEGER,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'indexing', 'ready', 'failed')),
  error TEXT,
  has_cover INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_documents_user ON documents (user_id, created_at DESC);

-- idx = page * 1000 + n-th chunk on that page, so rows sort in reading order and re-sending a page replaces its chunks.
-- embedding = the vector quantised to int8 and base64-encoded (about 1.4 KB for 1024 dimensions). D1 returns BLOBs as arrays of
-- numbers, which is slow to parse on the free plan's 10 ms CPU limit; a text column is returned as one string.
CREATE TABLE doc_chunks (
  doc_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  page INTEGER NOT NULL,
  text TEXT NOT NULL,
  embedding TEXT,
  PRIMARY KEY (doc_id, idx)
);

-- Question history per paper. `answer` is the verified answer object as returned to the browser.
CREATE TABLE doc_qa (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_doc_qa_doc ON doc_qa (doc_id, created_at);
