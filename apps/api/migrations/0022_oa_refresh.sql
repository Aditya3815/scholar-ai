-- The shared index keeps a paper's text for ever, but a paper can change (a new arXiv version, a corrected PMC article). A paper that was read more than 180 days ago is fetched again when someone
-- asks it, without making that person wait: it is answered from the copy that is there. If the new file is the same as the old (its hash), nothing else happens; if it differs, the paper is read
-- again like a new one. docs/design/oa-w4.md, "Refreshing".
ALTER TABLE oa_papers ADD COLUMN content_hash TEXT;   -- SHA-256 of the file the text was read from; null for papers read before this column existed (they are read again once)
ALTER TABLE oa_papers ADD COLUMN refresh_at TEXT;     -- when a refresh was started: one at a time, and none again for an hour
