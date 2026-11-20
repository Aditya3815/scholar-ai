-- Ink on the pages of notes (docs/design/paper-reader.md, 25): the pen and highlighter strokes drawn on a page of the Notebook, one row a page, apart from the page's blocks, so typing
-- and drawing never conflict (each has its own revision) and a text save stays small. Each stroke is attached to a character of a block or to a block's box (packages/shared/src/notebook-ink.ts
-- checks every stroke). Deleted with its page (the cascade, and explicitly), with the paper and with the account.
CREATE TABLE doc_notebook_ink (
  doc_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  strokes TEXT NOT NULL DEFAULT '[]',        -- JSON, checked by the server
  rev INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (doc_id, page_id),
  FOREIGN KEY (doc_id, page_id) REFERENCES doc_notebook_pages (doc_id, id) ON DELETE CASCADE
);
