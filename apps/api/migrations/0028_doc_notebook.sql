-- A paper's notebook (docs/design/paper-reader.md, 19.2): pages of blocks the owner writes, in their own words, with quotes of their highlights. One row a page, so a save sends
-- one page and two windows on two pages never conflict. Private to the paper's owner; deleted with the paper (and so with the account).
-- The id is made by the browser (a random id), so a page made offline keeps its id; it is unique within its paper (the key is the paper and the id), so one person's id can never
-- meet another's page.
CREATE TABLE doc_notebook_pages (
  doc_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  style TEXT NOT NULL DEFAULT 'plain',       -- plain | ruled | dotted | grid
  position REAL NOT NULL,                    -- order among the paper's pages; a move takes the midpoint, no renumbering
  blocks TEXT NOT NULL DEFAULT '[]',         -- JSON, checked by the server (packages/shared/src/notebook.ts)
  rev INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (doc_id, id)
);
CREATE INDEX idx_doc_notebook_doc ON doc_notebook_pages (doc_id, position);
