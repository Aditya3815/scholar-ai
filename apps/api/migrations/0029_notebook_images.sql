-- Pictures in the notes (docs/design/paper-reader.md, 22; the owner's yes of 18 Nov 2026). A picture's file is in R2 under its paper and its block
-- (docs/<user>/<paper>/notebook/<block>); its block is in doc_notebook_pages.blocks. A file that no block holds (a block taken out of a page, a page deleted,
-- an upload whose page was never saved) is noted here and deleted ten minutes later, on the next write in that paper, so that Undo can still bring it back;
-- the paper's deletion (and the account's) deletes them all at once.
CREATE TABLE doc_notebook_image_gone (
  doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  block_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  since INTEGER NOT NULL,                  -- ms since 1970: when no block held it
  PRIMARY KEY (doc_id, block_id)
);
CREATE INDEX doc_notebook_image_gone_since ON doc_notebook_image_gone (doc_id, since);
