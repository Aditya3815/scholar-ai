import { OUTCOME_COUNTS, type AnswerOutcomeRow, type OutcomeFeature } from "@scholar/shared";

export { FLOOR_OUTCOMES, FOLLOW_UP_OUTCOMES, OUTCOME_FEATURES, UNREAD_OUTCOMES, type OutcomeFeature } from "@scholar/shared";

/**
 * How answers went, as counts (migration 0019). One increment per answered question, never any text or person: the counts say how often the model wrote an answer that our own check then
 * refused (`not_grounded`), how often the papers did not answer (`not_answered`), and so on. They decide whether a "check again" step is worth building (docs/design/research-patterns.md).
 * Counting must never get in the way of an answer: a failure is logged and swallowed.
 *
 * `chat_input` is not about an answer: it counts what a message in the prompt box looked like (a polite frame, a year, an id: the closed names of src/understand/input-shape.ts), one count for each
 * name a message has (docs/design/intent-and-state.md, 4.4). Names only, never any of the text. The headline of /admin reads feature `chat` alone, so it does not move.
 *
 * The features, their closed names and how each is counted are data (packages/shared/src/vocab/outcomes.ts, `OUTCOME_COUNTS`): this counter has no rule of one feature's own.
 */

const MAX_KEEP_DAYS = 90;
export const OUTCOME_RETENTION_SQL = `DELETE FROM answer_outcomes WHERE day < date('now', '-${MAX_KEEP_DAYS} days')`;

/** One count: the day, the feature and the name by the primary key. Exported so that scale.test.ts reads the plan of the very statement that runs. */
export const COUNT_SQL = "INSERT INTO answer_outcomes (day, feature, outcome, n) VALUES (date('now'), ?1, ?2, 1) ON CONFLICT (day, feature, outcome) DO UPDATE SET n = n + 1";

export async function countOutcome(db: D1Database, feature: OutcomeFeature, outcome: string): Promise<void> {
  try {
    await db.prepare(COUNT_SQL).bind(feature, outcome.slice(0, 40)).run();
  } catch {
    console.warn(JSON.stringify({ level: "warn", msg: "outcome_not_counted", feature }));
  }
}

/** The most names one message writes: every query of an invocation counts toward the Worker's limit on subrequests (as src/docs/routes.ts notes), so a message keeps to a small batch. */
export const MAX_OUTCOME_NAMES = 8;

/**
 * One message, several names: each different name (cut to forty characters, as `countOutcome` cuts) adds one to its count, all in ONE batch (one round trip, all or none). Past `MAX_OUTCOME_NAMES`
 * the first ones, in the order given, are written and the rest are not: nothing is chosen at random, and one line says how many were left out (a number, never a name). A failure is logged as
 * `countOutcome` logs it, without a word of the error (it may quote the values), and swallowed.
 *
 * `chat_input` has a closed list of names (`INPUT_SHAPE_NAMES`, no text), and this function keeps to it whoever calls: a name outside it is not written, and one line says how many were left out (a
 * number again), so that a caller that passes a piece of a message by mistake writes none of it into a table kept 90 days. Its subject name (`subj0` to `subj7p`: one for every message, so the
 * four add up to the messages counted) is written first, so that the cap can never take it, and only one is written (a second is left out like a name outside the list); the other names keep the
 * order given.
 */
export async function countOutcomes(db: D1Database, feature: OutcomeFeature, names: readonly string[]): Promise<void> {
  try {
    let kept = [...new Set(names.map((n) => n.slice(0, 40)).filter((n) => n.length > 0))];
    // a feature with a closed list keeps to it whoever calls, and writes its one-of names (the subject count of a message) first and once
    const { names: closedList, one } = OUTCOME_COUNTS[feature];
    if (closedList) {
      const closed = kept.filter((n) => closedList.includes(n));
      const firsts = one ? closed.filter((n) => one.includes(n)) : [];
      const others = one ? closed.filter((n) => !one.includes(n)) : closed;
      const rejected = kept.length - others.length - Math.min(firsts.length, 1);
      if (rejected > 0) console.warn(JSON.stringify({ level: "warn", msg: "outcome_names_rejected", feature, rejected }));
      kept = [...firsts.slice(0, 1), ...others];
    }
    if (kept.length > MAX_OUTCOME_NAMES) console.warn(JSON.stringify({ level: "warn", msg: "outcome_names_dropped", feature, dropped: kept.length - MAX_OUTCOME_NAMES }));
    if (kept.length === 0) return;
    await db.batch(kept.slice(0, MAX_OUTCOME_NAMES).map((name) => db.prepare(COUNT_SQL).bind(feature, name)));
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
