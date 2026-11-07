-- The MCP server (docs "Sodhsetu understanding, follow-ups and MCP (design)", pages 10-14; src/mcp). Two small tables, both counts only.
--
-- mcp_calls: one row per tool call, for the admin page: which tool, which client (the name the client registered with, e.g. "Claude"), how long it took and how it ended. Never the
-- input (a query, a reference list, a DOI), never the answer, never who asked: what an AI assistant sends us can be an unpublished thesis. Kept 35 days (src/maintenance.ts).
CREATE TABLE mcp_calls (
  at TEXT NOT NULL DEFAULT (datetime('now')),
  tool TEXT NOT NULL,
  client TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  outcome TEXT NOT NULL
);
CREATE INDEX mcp_calls_at ON mcp_calls (at);

-- mcp_daily: how many tool calls an account made on a day (the 300 a day of the MCP quota). Only today matters; a few weeks stay for a look at use (src/maintenance.ts), and an erased account's
-- rows go with it (src/account/erase.ts).
CREATE TABLE mcp_daily (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
-- the nightly purge reads only what it deletes (src/scale.test.ts)
CREATE INDEX mcp_daily_day ON mcp_daily (day);
