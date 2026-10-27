-- How answers went, as plain counts: one row per day, feature and outcome ("answered", "not_grounded", ...). No text, no person, no paper. The admin page shows the last seven days.
-- It exists to answer one question with data instead of a guess: how often does the model write an answer that our own check then refuses (docs/design/research-patterns.md, section 3)?
CREATE TABLE answer_outcomes (
  day TEXT NOT NULL,
  feature TEXT NOT NULL,   -- chat | oa_ask | oa_ask_abstract | doc_ask
  outcome TEXT NOT NULL,   -- answered | not_in_paper | unverified | not_answered | not_grounded | no_abstracts | quota | unavailable | stopped | routed | small_talk | sign_in | too_long | other
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, feature, outcome)
);
