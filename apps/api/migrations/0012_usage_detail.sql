-- What each model call was for, and what it really used. `label` says which feature made the call (document question, each Idea Check step...), so cost can be
-- read per feature; `tokens_cached` is the part of the input the provider served from its prompt cache, when it says so. `cost_cents` is now filled from the price
-- table in src/llm/pricing.ts (it was always 0).
ALTER TABLE llm_usage ADD COLUMN label TEXT;
ALTER TABLE llm_usage ADD COLUMN tokens_cached INTEGER NOT NULL DEFAULT 0;
CREATE INDEX idx_llm_usage_label_ts ON llm_usage (label, ts);
