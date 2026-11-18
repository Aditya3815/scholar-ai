import {
  DEFAULT_LINK_EXPIRY,
  MAX_COMMENTS_PER_DOC,
  SHARE_INVITES_PER_DAY,
  SHARE_MAX_MEMBERS,
  SHARE_RESEND_MS,
  isCommentAnchor,
  isLinkMode,
  isLinkRole,
  isMemberRole,
  type CommentAnchor,
  type DocComment,
  type LinkExpiry,
  type LinkMode,
  type LinkRole,
  type MemberRole,
  type ShareMember,
  type SharedPaper,
  type ShareSettings,
} from "@scholar/shared";
import { linkTokenHash, newLinkToken } from "./access";

/**
 * The rows of sharing (migration 0029; docs/design/paper-share.md, sections 2, 5 and 6). Who may call what is decided by the routes (docs/share-routes.ts, through the one gate in
 * docs/access.ts); what is here takes a paper that is already known to be the caller's to change, and checks everything it is sent.
 */

const iso = (s: string | null): string | null => (s ? new Date(Date.parse(`${s.replace(" ", "T")}Z`)).toISOString() : null);
const randomId = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/* ---------------------------------------------------------------- the owner's dialog */

type ShareRow = { link_mode: string; link_role: string; token_hash: string | null; expires_at: string | null; viewers_download: number };
type MemberRow = { id: string; email: string; role: string; user_id: string | null; name: string | null; invited_at: string; last_opened_at: string | null; emailed_at: string | null };

const toMember = (r: MemberRow): ShareMember => ({
  id: r.id,
  email: r.email,
  role: isMemberRole(r.role) ? r.role : "viewer",
  name: r.name,
  joined: r.user_id !== null,
  invitedAt: iso(r.invited_at)!,
  lastOpenedAt: iso(r.last_opened_at),
  emailedAt: iso(r.emailed_at),
});

export async function listMembers(db: D1Database, docId: string): Promise<ShareMember[]> {
  const rows = await db
    .prepare("SELECT m.id, m.email, m.role, m.user_id, u.name, m.invited_at, m.last_opened_at, m.emailed_at FROM doc_members m LEFT JOIN users u ON u.id = m.user_id WHERE m.doc_id = ?1 ORDER BY m.invited_at, m.rowid")
    .bind(docId)
    .all<MemberRow>();
  return rows.results.map(toMember);
}

export async function shareSettings(db: D1Database, docId: string, email: boolean): Promise<ShareSettings> {
  const s = await db.prepare("SELECT link_mode, link_role, token_hash, expires_at, viewers_download FROM doc_shares WHERE doc_id = ?1").bind(docId).first<ShareRow>();
  return {
    linkMode: s && isLinkMode(s.link_mode) ? s.link_mode : "restricted",
    linkRole: s && isLinkRole(s.link_role) ? s.link_role : "viewer",
    link: !!s?.token_hash,
    expiresAt: iso(s?.expires_at ?? null),
    viewersDownload: (s?.viewers_download ?? 1) === 1,
    members: await listMembers(db, docId),
    email,
  };
}

const expiresSql = (days: LinkExpiry) => (days === null ? null : `+${days} days`);

/** The general access and the viewers' download, changed as a whole or in part. The row is made on the first change. */
export async function updateShare(db: D1Database, docId: string, change: { linkMode?: LinkMode; linkRole?: LinkRole; viewersDownload?: boolean; expiry?: LinkExpiry }): Promise<void> {
  await db.prepare("INSERT INTO doc_shares (doc_id) VALUES (?1) ON CONFLICT (doc_id) DO NOTHING").bind(docId).run();
  const sets: string[] = [];
  const binds: unknown[] = [docId];
  const add = (sql: string, v: unknown) => {
    binds.push(v);
    sets.push(sql.replace("?", `?${binds.length}`));
  };
  if (change.linkMode !== undefined) add("link_mode = ?", change.linkMode);
  if (change.linkRole !== undefined) add("link_role = ?", change.linkRole);
  if (change.viewersDownload !== undefined) add("viewers_download = ?", change.viewersDownload ? 1 : 0);
  if (change.expiry !== undefined) {
    const e = expiresSql(change.expiry);
    if (e === null) sets.push("expires_at = NULL");
    else add("expires_at = datetime('now', ?)", e);
  }
  if (sets.length === 0) return;
  await db.prepare(`UPDATE doc_shares SET ${sets.join(", ")}, updated_at = datetime('now') WHERE doc_id = ?1`).bind(...binds).run();
}

/** A new link (or the link reset): a new token, whose SHA-256 replaces the old one, so the old link stops at once. The token is returned once and never kept. */
export async function makeLink(db: D1Database, docId: string, expiry: LinkExpiry = DEFAULT_LINK_EXPIRY): Promise<{ token: string; expiresAt: string | null }> {
  const token = newLinkToken();
  const hash = await linkTokenHash(token);
  await db.prepare("INSERT INTO doc_shares (doc_id) VALUES (?1) ON CONFLICT (doc_id) DO NOTHING").bind(docId).run();
  const e = expiresSql(expiry);
  await db
    .prepare(`UPDATE doc_shares SET token_hash = ?2, expires_at = ${e === null ? "NULL" : "datetime('now', ?3)"}, updated_at = datetime('now') WHERE doc_id = ?1`)
    .bind(...(e === null ? [docId, hash] : [docId, hash, e]))
    .run();
  const row = await db.prepare("SELECT expires_at FROM doc_shares WHERE doc_id = ?1").bind(docId).first<{ expires_at: string | null }>();
  return { token, expiresAt: iso(row?.expires_at ?? null) };
}

/** Stop sharing: the link and every person go (their addresses with them). The comments stay with the paper. */
export async function stopSharing(db: D1Database, docId: string): Promise<void> {
  await db.batch([db.prepare("DELETE FROM doc_members WHERE doc_id = ?1").bind(docId), db.prepare("DELETE FROM doc_shares WHERE doc_id = ?1").bind(docId)]);
}

/** The paper a link opens, and how long the link has (seconds; null: until stopped). Null when the link is wrong, reset, stopped, expired, or not open to anyone (all look the same). */
export async function paperOfLink(db: D1Database, token: string): Promise<{ docId: string; ownerId: string; seconds: number | null } | null> {
  const row = await db
    .prepare(
      "SELECT s.doc_id, d.user_id, CAST((julianday(s.expires_at) - julianday('now')) * 86400 AS INTEGER) AS left FROM doc_shares s JOIN documents d ON d.id = s.doc_id WHERE s.token_hash = ?1 AND s.link_mode = 'anyone' AND (s.expires_at IS NULL OR s.expires_at > datetime('now'))",
    )
    .bind(await linkTokenHash(token))
    .first<{ doc_id: string; user_id: string; left: number | null }>();
  return row ? { docId: row.doc_id, ownerId: row.user_id, seconds: row.left } : null;
}

/* ---------------------------------------------------------------- people */

export type InviteResult = { ok: true; member: ShareMember; created: boolean } | { ok: false; reason: "full" | "daily" | "self" };

/**
 * Names a person: a new invitation, or a new role for one already named (which is not counted again). 50 people a paper, 200 invitations a day an owner (counted in share_daily, so that
 * removing someone does not give the count back). `count: false` (Undo of a removal) puts the row back without counting it.
 */
export async function invite(db: D1Database, q: { docId: string; ownerId: string; ownerEmail: string | null; email: string; role: MemberRole; count?: boolean }, now = Date.now()): Promise<InviteResult> {
  if (q.ownerEmail && q.ownerEmail.toLowerCase() === q.email) return { ok: false, reason: "self" };
  const have = await db.prepare("SELECT id FROM doc_members WHERE doc_id = ?1 AND email = ?2").bind(q.docId, q.email).first<{ id: string }>();
  if (have) {
    await db.prepare("UPDATE doc_members SET role = ?2 WHERE id = ?1").bind(have.id, q.role).run();
    return { ok: true, member: (await memberById(db, q.docId, have.id))!, created: false };
  }
  const n = (await db.prepare("SELECT COUNT(*) AS n FROM doc_members WHERE doc_id = ?1").bind(q.docId).first<{ n: number }>())?.n ?? 0;
  if (n >= SHARE_MAX_MEMBERS) return { ok: false, reason: "full" };
  if (q.count !== false) {
    // the day's count goes up only while it is under the limit, in one statement, so two tabs cannot both pass at 199
    const r = await db
      .prepare("INSERT INTO share_daily (user_id, day, invites) VALUES (?1, ?2, 1) ON CONFLICT (user_id, day) DO UPDATE SET invites = invites + 1 WHERE invites < ?3")
      .bind(q.ownerId, today(now), SHARE_INVITES_PER_DAY)
      .run();
    if ((r.meta?.changes ?? 0) === 0) return { ok: false, reason: "daily" };
  }
  const id = randomId();
  await db.prepare("INSERT INTO doc_members (doc_id, email, id, role) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (doc_id, email) DO NOTHING").bind(q.docId, q.email, id, q.role).run();
  const made = await db.prepare("SELECT id FROM doc_members WHERE doc_id = ?1 AND email = ?2").bind(q.docId, q.email).first<{ id: string }>();
  return { ok: true, member: (await memberById(db, q.docId, made!.id))!, created: made!.id === id };
}

export async function memberById(db: D1Database, docId: string, id: string): Promise<ShareMember | null> {
  const r = await db
    .prepare("SELECT m.id, m.email, m.role, m.user_id, u.name, m.invited_at, m.last_opened_at, m.emailed_at FROM doc_members m LEFT JOIN users u ON u.id = m.user_id WHERE m.doc_id = ?1 AND m.id = ?2")
    .bind(docId, id)
    .first<MemberRow>();
  return r ? toMember(r) : null;
}

export async function setRole(db: D1Database, docId: string, id: string, role: MemberRole): Promise<ShareMember | null> {
  const r = await db.prepare("UPDATE doc_members SET role = ?3 WHERE doc_id = ?1 AND id = ?2").bind(docId, id, role).run();
  return (r.meta?.changes ?? 0) > 0 ? memberById(db, docId, id) : null;
}

/** Removes a person (their address with them). Returns what was removed, for Undo. */
export async function removeMember(db: D1Database, docId: string, id: string): Promise<ShareMember | null> {
  const m = await memberById(db, docId, id);
  if (!m) return null;
  await db.prepare("DELETE FROM doc_members WHERE doc_id = ?1 AND id = ?2").bind(docId, id).run();
  return m;
}

/** May the invitation be e-mailed now? Once when it is made, then "Resend" at most once an hour. Marks it as sent when it may (one statement, so two clicks send one). */
export async function claimSend(db: D1Database, docId: string, id: string, now = Date.now()): Promise<boolean> {
  const since = new Date(now - SHARE_RESEND_MS).toISOString().slice(0, 19).replace("T", " ");
  const r = await db.prepare("UPDATE doc_members SET emailed_at = datetime('now') WHERE doc_id = ?1 AND id = ?2 AND (emailed_at IS NULL OR emailed_at <= ?3)").bind(docId, id, since).run();
  return (r.meta?.changes ?? 0) > 0;
}
/** The send failed: the next try is not made to wait an hour. */
export const releaseSend = (db: D1Database, docId: string, id: string) => db.prepare("UPDATE doc_members SET emailed_at = NULL WHERE doc_id = ?1 AND id = ?2").bind(docId, id).run();

/** "Opened": noted for a named person when they open the paper (at most once a minute, so reading does not write on every request). */
export const noteOpened = (db: D1Database, memberId: string) =>
  db.prepare("UPDATE doc_members SET last_opened_at = datetime('now') WHERE id = ?1 AND (last_opened_at IS NULL OR last_opened_at < datetime('now', '-1 minute'))").bind(memberId).run();

/* ---------------------------------------------------------------- the invited person */

/**
 * "Shared with me": the papers named people shared with this account, matched by its id or (the first time) by its verified e-mail. The caller keeps only the papers whose owner may share
 * (the switch at dark), since the person named does not decide that.
 */
export async function sharedWith(db: D1Database, userId: string): Promise<(SharedPaper & { ownerId: string })[]> {
  await db
    .prepare("UPDATE doc_members SET user_id = ?1 WHERE user_id IS NULL AND email = (SELECT lower(email) FROM users WHERE id = ?1 AND email_verified = 1 AND email IS NOT NULL)")
    .bind(userId)
    .run();
  const rows = await db
    .prepare(
      "SELECT m.doc_id, d.title, d.user_id AS owner_id, o.name AS owner_name, m.role, m.invited_at, m.last_opened_at FROM doc_members m JOIN documents d ON d.id = m.doc_id LEFT JOIN users o ON o.id = d.user_id WHERE m.user_id = ?1 AND d.user_id != ?1 ORDER BY COALESCE(m.last_opened_at, m.invited_at) DESC LIMIT 200",
    )
    .bind(userId)
    .all<{ doc_id: string; title: string; owner_id: string; owner_name: string | null; role: string; invited_at: string; last_opened_at: string | null }>();
  return rows.results.map((r) => ({ docId: r.doc_id, title: r.title, ownerId: r.owner_id, ownerName: r.owner_name, role: isMemberRole(r.role) ? r.role : "viewer", invitedAt: iso(r.invited_at)!, lastOpenedAt: iso(r.last_opened_at) }));
}

/** "Leave": the person takes the paper off their list (their membership, and the address the owner typed, go). */
export async function leave(db: D1Database, docId: string, userId: string): Promise<boolean> {
  const r = await db.prepare("DELETE FROM doc_members WHERE doc_id = ?1 AND (user_id = ?2 OR (user_id IS NULL AND email = (SELECT lower(email) FROM users WHERE id = ?2 AND email_verified = 1)))").bind(docId, userId).run();
  return (r.meta?.changes ?? 0) > 0;
}

/* ---------------------------------------------------------------- comments */

type CommentRow = { id: string; anchor: string; parent_id: string | null; user_id: string | null; author: string | null; body: string; resolved: number; created_at: string; updated_at: string };
const COMMENT_COLS = "c.id, c.anchor, c.parent_id, c.user_id, u.name AS author, c.body, c.resolved, c.created_at, c.updated_at";
const toComment = (r: CommentRow, me: string | null): DocComment => ({
  id: r.id,
  anchor: r.anchor as CommentAnchor,
  parentId: r.parent_id,
  // a deleted account's comments stay, by "a former member"; a name the account never had is "Someone"
  author: r.user_id === null ? null : (r.author ?? "Someone"),
  mine: me !== null && r.user_id === me,
  body: r.body,
  resolved: r.resolved === 1,
  createdAt: iso(r.created_at)!,
  updatedAt: iso(r.updated_at)!,
});

export async function listComments(db: D1Database, docId: string, me: string | null): Promise<DocComment[]> {
  const rows = await db.prepare(`SELECT ${COMMENT_COLS} FROM doc_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.doc_id = ?1 ORDER BY c.created_at, c.rowid`).bind(docId).all<CommentRow>();
  return rows.results.map((r) => toComment(r, me));
}

const commentById = async (db: D1Database, docId: string, id: string, me: string | null) => {
  const r = await db.prepare(`SELECT ${COMMENT_COLS} FROM doc_comments c LEFT JOIN users u ON u.id = c.user_id WHERE c.doc_id = ?1 AND c.id = ?2`).bind(docId, id).first<CommentRow>();
  return r ? toComment(r, me) : null;
};
export const getComment = commentById;

/** Is the thing a comment hangs on part of this paper: the highlight, or the block on its page of notes? */
async function anchorExists(db: D1Database, docId: string, anchor: CommentAnchor): Promise<boolean> {
  if (anchor.startsWith("note:")) return !!(await db.prepare("SELECT 1 AS ok FROM doc_notes WHERE doc_id = ?1 AND id = ?2").bind(docId, anchor.slice(5)).first());
  const [, pageId, blockId] = anchor.split(":");
  const page = await db.prepare("SELECT blocks FROM doc_notebook_pages WHERE doc_id = ?1 AND id = ?2").bind(docId, pageId).first<{ blocks: string }>();
  if (!page) return false;
  try {
    return (JSON.parse(page.blocks) as { id?: unknown }[]).some((b) => b?.id === blockId);
  } catch {
    return false;
  }
}

export type AddCommentResult = { ok: true; comment: DocComment } | { ok: false; reason: "anchor" | "parent" | "full" };

/** A new comment (a thread's first) or a reply to one (replies are one level deep: a reply to a reply hangs on the same thread). 500 a paper. */
export async function addComment(db: D1Database, q: { docId: string; userId: string; anchor: unknown; parentId: unknown; body: string }): Promise<AddCommentResult> {
  let anchor: CommentAnchor;
  let parentId: string | null = null;
  if (typeof q.parentId === "string" && q.parentId) {
    const parent = await db.prepare("SELECT id, anchor, parent_id FROM doc_comments WHERE doc_id = ?1 AND id = ?2").bind(q.docId, q.parentId).first<{ id: string; anchor: string; parent_id: string | null }>();
    if (!parent) return { ok: false, reason: "parent" };
    parentId = parent.parent_id ?? parent.id;
    anchor = parent.anchor as CommentAnchor;
  } else {
    if (!isCommentAnchor(q.anchor) || !(await anchorExists(db, q.docId, q.anchor))) return { ok: false, reason: "anchor" };
    anchor = q.anchor;
  }
  const n = (await db.prepare("SELECT COUNT(*) AS n FROM doc_comments WHERE doc_id = ?1").bind(q.docId).first<{ n: number }>())?.n ?? 0;
  if (n >= MAX_COMMENTS_PER_DOC) return { ok: false, reason: "full" };
  const id = randomId();
  await db.prepare("INSERT INTO doc_comments (id, doc_id, anchor, parent_id, user_id, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6)").bind(id, q.docId, anchor, parentId, q.userId, q.body).run();
  // a reply opens a resolved thread again
  if (parentId) await db.prepare("UPDATE doc_comments SET resolved = 0 WHERE doc_id = ?1 AND id = ?2").bind(q.docId, parentId).run();
  return { ok: true, comment: (await commentById(db, q.docId, id, q.userId))! };
}

export async function editComment(db: D1Database, docId: string, id: string, body: string, me: string): Promise<DocComment | null> {
  await db.prepare("UPDATE doc_comments SET body = ?3, updated_at = datetime('now') WHERE doc_id = ?1 AND id = ?2").bind(docId, id, body).run();
  return commentById(db, docId, id, me);
}

/** Resolve or open a thread (its first comment carries it). */
export async function resolveThread(db: D1Database, docId: string, id: string, resolved: boolean, me: string): Promise<DocComment | null> {
  await db.prepare("UPDATE doc_comments SET resolved = ?3 WHERE doc_id = ?1 AND id = ?2 AND parent_id IS NULL").bind(docId, id, resolved ? 1 : 0).run();
  return commentById(db, docId, id, me);
}

/** Deletes a comment; the first comment of a thread takes its replies with it. */
export async function deleteComment(db: D1Database, docId: string, id: string): Promise<void> {
  await db.prepare("DELETE FROM doc_comments WHERE doc_id = ?1 AND (id = ?2 OR parent_id = ?2)").bind(docId, id).run();
}

/** A paper's open threads, for the dot and the filter (counted, not listed). */
export async function openThreads(db: D1Database, docId: string): Promise<number> {
  return (await db.prepare("SELECT COUNT(*) AS n FROM doc_comments WHERE doc_id = ?1 AND parent_id IS NULL AND resolved = 0").bind(docId).first<{ n: number }>())?.n ?? 0;
}
