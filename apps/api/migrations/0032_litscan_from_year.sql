-- The earliest publication year a literature scan reads (chosen on the plan step). NULL: any year; the scans made before this are NULL.
ALTER TABLE litscans ADD COLUMN from_year INTEGER CHECK (from_year IS NULL OR (from_year >= 1900 AND from_year <= 2100));
