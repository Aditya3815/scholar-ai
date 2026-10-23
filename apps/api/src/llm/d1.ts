import { d1Store } from "../cache/store";
import type { Ledger, ResponseCache, UsageRow } from "./types";

export function d1Ledger(db: D1Database): Ledger {
  return {
    async tokensToday(subject) {
      const row = await db
        .prepare("SELECT COALESCE(SUM(tokens_in + tokens_out), 0) AS t FROM llm_usage WHERE subject = ?1 AND ts >= date('now')")
        .bind(subject)
        .first<{ t: number }>();
      return row?.t ?? 0;
    },
    async record(r: UsageRow) {
      await db
        .prepare(
          "INSERT INTO llm_usage (subject, task, sensitivity, provider, model, tokens_in, tokens_out, cost_cents, ok, ms, label, tokens_cached) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        )
        .bind(r.subject, r.task, r.sensitivity, r.provider, r.model, r.tokensIn, r.tokensOut, r.costCents, r.ok ? 1 : 0, r.ms, r.label ?? null, r.tokensCached ?? 0)
        .run();
    },
  };
}

/** Reuses the shared `api_cache` table. Only the gateway's PUBLIC responses are ever stored here. */
export function d1ResponseCache(db: D1Database): ResponseCache {
  return d1Store(db, "llm");
}
