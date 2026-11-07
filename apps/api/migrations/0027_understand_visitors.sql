-- The Understand step for a visitor who is not signed in (design PDF "Sodhsetu understanding, follow-ups and MCP", page 9; switch CHAT_UNDERSTAND_VISITORS): at most 40 calls a day per address.
-- `who` is a one-way code (SHA-256) of the day and the address together, so the same address gives a different code every day and the address itself is never stored; a row is deleted by the
-- nightly maintenance two days after its day. Only a count: no message, no text. Numbered 0027 so that it never collides with 0026 (the MCP server's table, on its own branch).
CREATE TABLE understand_visitors (
  day TEXT NOT NULL,
  who TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, who)
);
