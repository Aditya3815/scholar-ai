/**
 * What other features may use of the papers feature (docs/design/untangle.md, 1.5 and F13: another feature imports only a feature's service.ts).
 * It grows as F13 moves the papers feature's callers onto it. Sharing (docs/design/paper-share.md, section 6): the data export's entries and what deleting an account does to the shares
 * of others (deleting the owner's own papers, with their shares and comments, is deleteDocument's).
 */
export { listNotebookImages } from "./notebook-images";

const iso = (s: string | null): string | null => (s ? new Date(Date.parse(`${s.replace(" ", "T")}Z`)).toISOString() : null);

export type ShareExport = {
  /** The owner's side: for each of their papers that is shared, the link's settings, the people (the addresses they typed) and every comment on it. */
  sharedPapers: { docId: string; title: string; generalAccess: string; linkRole: string; linkExpiresAt: string | null; viewersCanDownload: boolean; people: { email: string; role: string; invitedAt: string | null; lastOpenedAt: string | null }[]; comments: { on: string; reply: boolean; by: string; text: string; resolved: boolean; at: string | null }[] }[];
  /** The member's side: their own comments on papers others shared with them. */
  myCommentsOnSharedPapers: { docId: string; title: string; on: string; reply: boolean; text: string; at: string | null }[];
};

export async function shareExport(db: D1Database, userId: string): Promise<ShareExport> {
  const shares = await db
    .prepare("SELECT d.id, d.title, s.link_mode, s.link_role, s.expires_at, s.viewers_download FROM documents d LEFT JOIN doc_shares s ON s.doc_id = d.id WHERE d.user_id = ?1 AND (s.doc_id IS NOT NULL OR EXISTS (SELECT 1 FROM doc_members m WHERE m.doc_id = d.id) OR EXISTS (SELECT 1 FROM doc_comments k WHERE k.doc_id = d.id)) ORDER BY d.created_at")
    .bind(userId)
    .all<{ id: string; title: string; link_mode: string | null; link_role: string | null; expires_at: string | null; viewers_download: number | null }>();
  const people = await db
    .prepare("SELECT m.doc_id, m.email, m.role, m.invited_at, m.last_opened_at FROM doc_members m JOIN documents d ON d.id = m.doc_id WHERE d.user_id = ?1 ORDER BY m.invited_at")
    .bind(userId)
    .all<{ doc_id: string; email: string; role: string; invited_at: string; last_opened_at: string | null }>();
  const comments = await db
    .prepare("SELECT k.doc_id, k.anchor, k.parent_id, k.user_id, u.name, k.body, k.resolved, k.created_at FROM doc_comments k JOIN documents d ON d.id = k.doc_id LEFT JOIN users u ON u.id = k.user_id WHERE d.user_id = ?1 ORDER BY k.created_at")
    .bind(userId)
    .all<{ doc_id: string; anchor: string; parent_id: string | null; user_id: string | null; name: string | null; body: string; resolved: number; created_at: string }>();
  const mine = await db
    .prepare("SELECT k.doc_id, d.title, k.anchor, k.parent_id, k.body, k.created_at FROM doc_comments k JOIN documents d ON d.id = k.doc_id WHERE k.user_id = ?1 AND d.user_id != ?1 ORDER BY k.created_at")
    .bind(userId)
    .all<{ doc_id: string; title: string; anchor: string; parent_id: string | null; body: string; created_at: string }>();
  return {
    sharedPapers: shares.results.map((s) => ({
      docId: s.id,
      title: s.title,
      generalAccess: s.link_mode === "anyone" ? "anyone with the link" : "restricted",
      linkRole: s.link_role ?? "viewer",
      linkExpiresAt: iso(s.expires_at),
      viewersCanDownload: (s.viewers_download ?? 1) === 1,
      people: people.results.filter((p) => p.doc_id === s.id).map((p) => ({ email: p.email, role: p.role, invitedAt: iso(p.invited_at), lastOpenedAt: iso(p.last_opened_at) })),
      comments: comments.results.filter((k) => k.doc_id === s.id).map((k) => ({ on: k.anchor, reply: k.parent_id !== null, by: k.user_id === null ? "a former member" : k.user_id === userId ? "you" : (k.name ?? "someone"), text: k.body, resolved: k.resolved === 1, at: iso(k.created_at) })),
    })),
    myCommentsOnSharedPapers: mine.results.map((k) => ({ docId: k.doc_id, title: k.title, on: k.anchor, reply: k.parent_id !== null, text: k.body, at: iso(k.created_at) })),
  };
}

/**
 * Deleting an account, for the papers of OTHER people (docs/design/paper-share.md, 6): the account's memberships go (and an invitation still waiting for its address), and its comments stay with
 * the paper, by "a former member". The account's own papers, with their shares and comments, are deleted with them (deleteDocument).
 */
export function forgetPersonStatements(db: D1Database, userId: string, email: string | null): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM doc_members WHERE user_id = ?1 OR (?2 IS NOT NULL AND user_id IS NULL AND email = lower(?2))").bind(userId, email),
    db.prepare("UPDATE doc_comments SET user_id = NULL WHERE user_id = ?1").bind(userId),
    db.prepare("DELETE FROM share_daily WHERE user_id = ?1").bind(userId),
  ];
}
