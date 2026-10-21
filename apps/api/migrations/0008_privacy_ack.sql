-- The researcher has read how their papers and ideas are handled (shown before the first upload or idea check). The version says which text,
-- so a changed policy asks again.
ALTER TABLE users ADD COLUMN privacy_ack TEXT;
ALTER TABLE users ADD COLUMN privacy_ack_at TEXT;
