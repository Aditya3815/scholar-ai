/** The four counts of the subject words of a message (src/understand/input-shape.ts in the Worker): exactly one of them is written for every message that is counted, so together they are the messages counted. */
const SUBJECT_COUNTS = ["subj0", "subj1", "subj2_6", "subj7p"];

/**
 * What the Share column of /admin is a share of, for one feature. For the outcomes of an answer it is the sum of the rows (every question has one ending). For the shape of messages (`chat_input`) a
 * message has several names at once ("frame", "year", ...), so the sum of the rows is a message several times over and would make every share too small; the four subject counts add up to the messages
 * counted, and that is the total. 0 when there is no subject count yet (only `anyway` has been counted): the page then shows no share. Counts only; no text, no person.
 */
export function outcomeTotal(feature: string, rows: readonly { outcome: string; n: number }[]): number {
  return rows.reduce((sum, r) => (feature !== "chat_input" || SUBJECT_COUNTS.includes(r.outcome) ? sum + r.n : sum), 0);
}
