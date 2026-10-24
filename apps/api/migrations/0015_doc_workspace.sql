-- My Workspace: where a person is in each paper, whether they have read it, and the tags (collections) they gave it. Private to the owner; deleted with the paper.
ALTER TABLE documents ADD COLUMN read_state TEXT NOT NULL DEFAULT 'to_read'; -- to_read | reading | done
ALTER TABLE documents ADD COLUMN last_page INTEGER;                          -- the page the reader was on last
ALTER TABLE documents ADD COLUMN max_page INTEGER;                           -- the furthest page reached (the progress bar)
ALTER TABLE documents ADD COLUMN opened_at TEXT;                             -- when it was last opened

CREATE TABLE doc_tags (
  doc_id TEXT NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
  tag_key TEXT NOT NULL, -- lower case, how two spellings of one tag are told to be the same
  label TEXT NOT NULL,   -- as typed
  PRIMARY KEY (doc_id, tag_key)
);
