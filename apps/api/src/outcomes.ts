import type { AnswerOutcomeRow } from "@scholar/shared";

/**
 * How answers went, as counts (migration 0019). One increment per answered question, never any text or person: the counts say how often the model wrote an answer that our own check then
 * refused (`not_grounded`), how often the papers did not answer (`not_answered`), and so on. They decide whether a "check again" step is worth building (docs/design/research-patterns.md).
 * Counting must never get in the way of an answer: a failure is logged and swallowed.
 */
export const OUTCOME_FEATURES = ["chat", "oa_ask", "oa_ask_abstract", "doc_ask", "litscan"] as const;
export type OutcomeFeature = (typeof OUTCOME_FEATURES)[number];

const MAX_KEEP_DAYS = 90;
export const OUTCOME_RETENTION_SQL = `DELETE FROM answer_outcomes WHERE day < date('now', '-${MAX_KEEP_DAYS} days')`;

export async function countOutcome(db: D1Database, feature: OutcomeFeature, outcome: string): Promise<void> {
  try {
    await db
      .prepare("INSERT INTO answer_outcomes (day, feature, outcome, n) VALUES (date('now'), ?1, ?2, 1) ON CONFLICT (day, feature, outcome) DO UPDATE SET n = n + 1")
      .bind(feature, outcome.slice(0, 40))
      .run();
  } catch {
    console.warn(JSON.stringify({ level: "warn", msg: "outcome_not_counted", feature }));
  }
}

/** The last seven days (today and the six before), by feature and outcome, most frequent first. */
export async function readOutcomes(db: D1Database): Promise<AnswerOutcomeRow[]> {
  const rows = await db
    .prepare("SELECT feature, outcome, SUM(n) AS n FROM answer_outcomes WHERE day >= date('now', '-6 days') GROUP BY feature, outcome ORDER BY feature, SUM(n) DESC, outcome")
    .all<AnswerOutcomeRow>();
  return rows.results;
}

/** What a question about a paper came to, from the answer: found and checked, not in the paper, or found but a quote did not check out. */
export function askOutcome(a: { found: boolean; verified: boolean }): string {
  return !a.found ? "not_in_paper" : a.verified ? "answered" : "unverified";
}
