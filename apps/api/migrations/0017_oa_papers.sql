-- The shared index of open-access papers (W4). One public copy of the text of a paper, read once on the server and used to answer anyone's question about it. It holds no
-- personal data: nobody is recorded as having asked (only how many NEW papers a person brought in today, for a daily cap, in oa_daily).
CREATE TABLE oa_papers (
  key TEXT PRIMARY KEY,                    -- "doi:10.1038/nature14539" or "arxiv:1706.03762": the same paper under any link is one row
  doi TEXT,
  arxiv_id TEXT,
  pmcid TEXT,
  title TEXT,
  source TEXT,                             -- what the text was read from: europepmc | arxiv | pdf
  license TEXT,                            -- cc0, cc-by, cc-by-sa, cc-by-nc ... or other; decides whether the PDF itself may be shown
  status TEXT NOT NULL DEFAULT 'queued',   -- queued | fetching | reading | embedding | ready | failed | unreadable
  reason TEXT,                             -- why a paper is unreadable or failed (OA_REASONS in packages/shared/src/oa.ts)
  attempt INTEGER NOT NULL DEFAULT 0,      -- a Workflow instance id cannot be reused, so every try has its own: oa-<hash>-<attempt>
  instance TEXT,                           -- the instance doing the current try
  pages INTEGER,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  done_chunks INTEGER NOT NULL DEFAULT 0,  -- passages that have their embedding: the progress while embedding
  r2_key TEXT,                             -- the file the text was read from, kept so it can be read again
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  ready_at TEXT,
  retry_after TEXT                         -- a paper that could not be fetched is not tried again, whoever asks, before this
);
CREATE INDEX idx_oa_papers_status ON oa_papers (status, updated_at);

-- Passages. A paper becomes 'ready' only when every passage has its embedding, so a half-read paper is never used for an answer. A repeated step overwrites the same rows.
CREATE TABLE oa_chunks (
  paper_key TEXT NOT NULL REFERENCES oa_papers (key) ON DELETE CASCADE,
  idx INTEGER NOT NULL,                    -- page * 1000 + n, reading order
  page INTEGER NOT NULL,                   -- a page of a PDF, or the number of the section for XML (which has no pages)
  section TEXT,                            -- "Methods > Participants" for XML
  text TEXT NOT NULL,
  embedding TEXT,
  PRIMARY KEY (paper_key, idx)
);

-- How many papers new to the shared index a person has brought in today (papers that were already there cost nothing).
CREATE TABLE oa_daily (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
