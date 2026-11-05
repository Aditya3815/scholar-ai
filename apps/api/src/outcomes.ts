import type { AnswerOutcomeRow } from "@scholar/shared";
import { INPUT_SHAPE_NAMES, SUBJECT_NAMES } from "./understand/input-shape";

/**
 * How answers went, as counts (migration 0019). One increment per answered question, never any text or person: the counts say how often the model wrote an answer that our own check then
 * refused (`not_grounded`), how often the papers did not answer (`not_answered`), and so on. They decide whether a "check again" step is worth building (docs/design/research-patterns.md).
 * Counting must never get in the way of an answer: a failure is logged and swallowed.
 *
 * `chat_input` is not about an answer: it counts what a message in the prompt box looked like (a polite frame, a year, an id: the closed names of src/understand/input-shape.ts), one count for each
 * name a message has (docs/design/intent-and-state.md, 4.4). Names only, never any of the text. The headline of /admin reads feature `chat` alone, so it does not move.
 */
export const OUTCOME_FEATURES = ["chat", "oa_ask", "oa_ask_abstract", "doc_ask", "litscan", "chat_input"] as const;
export type OutcomeFeature = (typeof OUTCOME_FEATURES)[number];

/**
 * What a message that came with the turns before it (a follow-up, docs/design/chat-actions-context.md; whether or not a model had to read them) counts as, in the place of "answered" and
 * "not_grounded" (every other ending keeps its name):
 * `followup_answered` and `followup_not_grounded` say how the follow-ups went apart from the first messages; `followup_rewrite_failed` is a follow-up whose restatement did not pass the server's
 * checks and was searched as written (so /admin shows how often the model's reading is not used); `followup_context_ignored` is one that carried turns while the CHAT_CONTEXT switch was off. Counts
 * only, at most 40 characters each.
 */
export const FOLLOW_UP_OUTCOMES = {
  answered: "followup_answered",
  notGrounded: "followup_not_grounded",
  rewriteFailed: "followup_rewrite_failed",
  contextIgnored: "followup_context_ignored",
} as const;

/**
 * The two names of the follow-up failure policy (R5, docs/design/intent-and-state.md, 4.6), kept apart from the four above (those belong to the context release and are pinned as four). `followup_unread`
 * (CHAT_FAILPOLICY=on) is a follow-up whose router call FAILED: the papers were shown and no answer was written, so it is neither answered nor refused, and the headline of /admin
 * (`chatRefusalShare`) leaves it out on purpose. `followup_unread_shadow` (CHAT_FAILPOLICY=shadow) counts the same follow-ups while the answer is still written as before, so it is counted IN ADDITION to
 * how that answer ended (a message of it is in two rows). Counts only, at most 40 characters each.
 */
export const UNREAD_OUTCOMES = {
  unread: "followup_unread",
  shadow: "followup_unread_shadow",
} as const;

/**
 * The ending of the relevance floor (R9, docs/design/intent-and-state.md, 4.9), kept apart from the names above: a list in which no paper matched the words closely was not given to the writer. The reply says
 * `not_answered` (the page shows no answer), but `chatRefusalShare` counts `not_answered` as a question the papers could have answered and the model said they could not, and here no model was asked, so
 * the count has a name of its own and the headline of /admin does not move (the share leaves it out, as it leaves out `followup_unread`). Counts only, at most 40 characters.
 */
export const FLOOR_OUTCOMES = {
  skipped: "floor_skipped",
} as const;

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

const SHAPE_NAMES: ReadonlySet<string> = new Set(INPUT_SHAPE_NAMES);
const SUBJECT: ReadonlySet<string> = new Set(SUBJECT_NAMES);

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
    if (feature === "chat_input") {
      const closed = kept.filter((n) => SHAPE_NAMES.has(n));
      const subjects = closed.filter((n) => SUBJECT.has(n));
      const others = closed.filter((n) => !SUBJECT.has(n));
      const rejected = kept.length - others.length - Math.min(subjects.length, 1);
      if (rejected > 0) console.warn(JSON.stringify({ level: "warn", msg: "outcome_names_rejected", feature, rejected }));
      kept = [...subjects.slice(0, 1), ...others];
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
