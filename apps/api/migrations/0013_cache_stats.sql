-- How well the public cache works: hits and misses per source per day, so the admin page can say how many calls to OpenAlex, Crossref and doi.org it saved.
-- Counted in memory and written in one small batch about every 1.5 seconds (src/cache/meter.ts). No person, no text, no key: only the name of the source.
CREATE TABLE cache_stats (
  day TEXT NOT NULL,
  source TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  misses INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, source)
);
