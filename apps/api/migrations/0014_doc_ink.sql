-- Pen, highlighter and eraser strokes a researcher draws on their own uploaded paper (My Workspace). One row per paper: the strokes as JSON (vectors, see
-- packages/shared/src/ink.ts), with a revision number so that two tabs cannot silently overwrite each other. Private to the paper's owner; deleted with the paper.
CREATE TABLE doc_ink (
  doc_id TEXT PRIMARY KEY REFERENCES documents (id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
