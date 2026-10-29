export type Remembered = { docId: string; title: string; page: number; quote: string; note: string; color: string };

const FROM = "FROM doc_notes n JOIN documents d ON d.id = n.doc_id WHERE d.user_id = ?1 AND length(n.quote) >= 40";

/**
 * One of the person's own highlights for "Remember this?": the same one all day (`day` is the day number), the next ones for `skip` 1, 2, ... Only highlights of 40 characters or more are
 * offered. It is read by its place in the list (a count, then one row), not by loading every highlight the person has made, so it costs the same for ten highlights and for ten thousand.
 */
export async function rememberOne(db: D1Database, userId: string, skip: number, day: number): Promise<{ highlight: Remembered | null; total: number }> {
  const total = (await db.prepare(`SELECT COUNT(*) AS n ${FROM}`).bind(userId).first<{ n: number }>())?.n ?? 0;
  if (total === 0) return { highlight: null, total: 0 };
  const pick = (day + Math.max(0, skip)) % total;
  const r = await db
    .prepare(`SELECT n.doc_id, d.title, n.page, n.quote, n.note, n.color ${FROM} ORDER BY n.id LIMIT 1 OFFSET ?2`)
    .bind(userId, pick)
    .first<{ doc_id: string; title: string; page: number; quote: string; note: string | null; color: string }>();
  // a highlight removed between the two reads: nothing to show now
  if (!r) return { highlight: null, total: 0 };
  return { highlight: { docId: r.doc_id, title: r.title, page: r.page, quote: r.quote, note: r.note ?? "", color: r.color }, total };
}
