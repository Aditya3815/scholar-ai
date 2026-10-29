-- Indexes for what grows without a limit (docs/design/scalability.md, 29 Oct 2026). Found by reading the query plans of the nightly purges and the admin page:
-- each of these read the whole table. Nothing here changes what any query returns.

-- One row for every model call: the 90-day purge and the admin page's "last 14 days" read it by time alone (the other indexes start with the person or the feature).
CREATE INDEX idx_llm_usage_ts ON llm_usage (ts);

-- Daily counters keyed (person, day): the purge of old days has no person to start from.
CREATE INDEX idx_ocr_usage_day ON ocr_usage (day);
CREATE INDEX idx_oa_daily_day ON oa_daily (day);
CREATE INDEX idx_litscan_daily_day ON litscan_daily (day);

-- The DOI of a saved paper as a column of its own (lower case, empty when the record has none). The nightly retraction re-check and the notices read the DOI of every saved paper; out of the
-- JSON each row had to be parsed, in a table with a row for every saved paper of every person. The JSON stays the record; the column is a copy that the code keeps in step on every write.
ALTER TABLE library_items ADD COLUMN doi TEXT;
UPDATE library_items SET doi = lower(trim(json_extract(data, '$.doi'))) WHERE json_extract(data, '$.doi') IS NOT NULL AND trim(json_extract(data, '$.doi')) <> '';
CREATE INDEX idx_library_doi ON library_items (doi) WHERE doi IS NOT NULL;
