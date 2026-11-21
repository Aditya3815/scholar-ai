import { Hono, type Context } from "hono";
import {
  DEFAULT_LINK_EXPIRY,
  INVITE_NOTE_MAX,
  MAX_COMMENTS_PER_DOC,
  SHARE_INVITES_PER_DAY,
  SHARE_MAX_MEMBERS,
  SHARE_TOKEN,
  cleanInviteNote,
  cleanCommentBody,
  cleanEmail,
  isLinkExpiry,
  isLinkMode,
  isLinkRole,
  isMemberRole,
  roleAtLeast,
  type LinkExpiry,
  type ShareRole,
} from "@scholar/shared";
import { requireUser, type Door } from "../auth/service";
import { readJson } from "../platform/http/body";
import { deny } from "../problem";
import type { HonoEnv } from "../platform/env";
import { setLinkCookie } from "./access";
import { mailerFor } from "./invite-mail";
import { checkInvitePicture, type InvitePicture } from "./invite-picture";
import { requirePaper, type PaperDoor } from "./paper-gate";
import { shareOnFor, shareSwitchedOn } from "./share-flag";
import { liveChanged, liveRevoke } from "./live";
import {
  addComment,
  claimSend,
  deleteComment,
  editComment,
  getComment,
  invite,
  leave,
  listComments,
  makeLink,
  memberById,
  paperOfLink,
  releaseSend,
  removeMember,
  resolveThread,
  setRole,
  shareSettings,
  sharedWith,
  stopSharing,
  updateShare,
} from "./share-store";

/**
 * Sharing a paper's workspace (docs/design/paper-share.md), mounted at /api/v1/share. With SHARE off every route here answers 404 before anything else, as before it existed (the way the
 * MCP server answers when it is off). Every route that names a paper goes through the one gate (docs/paper-gate.ts) with the role it needs: the owner's dialog needs the owner (and, at dark,
 * an owner in SHARE_BETA_USERS), the comments need a Viewer to read and a Commenter to write. A write is checked for where it comes from by the mount (platform/http/guards.ts), and every
 * body is read with a limit.
 *
 *   POST   /open                              a link's token (in the body, never in an address) -> the paper's id, and a cookie that holds the token for that paper's routes
 *   GET    /with-me                           "Shared with me"
 *   DELETE /with-me/:id                       Leave
 *   GET    /papers/:id                        the owner's dialog: general access, the people, and whether invitations are e-mailed
 *   PUT    /papers/:id                        general access (restricted | anyone), the link's role (viewer | commenter), expiry (7, 30, null), viewers can download
 *   POST   /papers/:id/link                   make the link, or reset it (the old one stops at once): the token, shown this once
 *   DELETE /papers/:id                        stop sharing: the link and every person go
 *   POST   /papers/:id/members                invite a person by e-mail as viewer, commenter or editor (and e-mail them, when the Worker can, with the owner's note and a picture
 *                                             of the first page when the dialog sends them: used for that e-mail only, never kept)
 *   PATCH  /papers/:id/members/:mid           change a person's role
 *   DELETE /papers/:id/members/:mid           remove a person (the dialog's Undo invites them again, without an e-mail)
 *   POST   /papers/:id/members/:mid/resend    e-mail the invitation again (at most once an hour; the picture of the first page may come again)
 *   GET    /papers/:id/comments               the comments (Viewer up)
 *   POST   /papers/:id/comments               a comment or a reply (Commenter up)
 *   PATCH  /papers/:id/comments/:cid          edit one's own words; resolve or open a thread (the owner and Editors)
 *   DELETE /papers/:id/comments/:cid          delete one's own comment (the owner may delete any)
 */
export const shareRoutes = new Hono<HonoEnv>();

const MAX_BODY = 8 * 1024;
/** An invitation may carry the picture of the first page (at most 60 KB, as base64) and a note. */
const MAX_INVITE_BODY = 96 * 1024;
const OFF = (c: Context<HonoEnv>) => deny(c, 404, "not_found", "Not found", c.req.path);
const SIGNED_IN: Door = { signIn: "Sign in first" };
const OWNER: PaperDoor = { signIn: "Sign in first", missing: "Paper not found" };
const COMMENTS: PaperDoor = { signIn: "Sign in to see the comments", missing: "Paper not found" };
const paperRow = (c: Context<HonoEnv>) => (id: string) => c.env.DB.prepare("SELECT id, user_id, title FROM documents WHERE id = ?1").bind(id).first<{ id: string; user_id: string; title: string }>();

// off: nothing here exists, for anyone, before any other check
shareRoutes.use("*", async (c, next) => {
  if (!(await shareSwitchedOn(c.env))) return OFF(c);
  await next();
});

/** A body read with a limit: null when it is too big or not an object. */
async function body(c: Context<HonoEnv>, max = MAX_BODY): Promise<Record<string, unknown> | null> {
  const read = await readJson(c, max);
  if (read.tooLarge) return null;
  return read.value && typeof read.value === "object" && !Array.isArray(read.value) ? (read.value as Record<string, unknown>) : null;
}
const TOO_BIG_OR_EMPTY = (c: Context<HonoEnv>) => deny(c, 400, "invalid_share", "Nothing to change");

/** The paper's owner, with sharing on for them (at dark, an owner who is not listed has no Share at all: 404). */
async function owner(c: Context<HonoEnv>) {
  const got = await requirePaper(c, OWNER, "owner", paperRow(c));
  if (got instanceof Response) return got;
  if (!(await shareOnFor(c.env, got.row.user_id))) return OFF(c);
  return { ...got, user: got.user! };
}

/** The address a person opens the paper at: the paper's own page (it works for the people named, once signed in). */
const paperLink = (c: Context<HonoEnv>, docId: string) => `${(c.env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin).replace(/\/+$/, "")}/papers/${docId}`;

/* ---------------------------------------------------------------- the link */

shareRoutes.post("/open", async (c) => {
  const b = await body(c);
  const token = typeof b?.token === "string" ? b.token : "";
  const found = SHARE_TOKEN.test(token) ? await paperOfLink(c.env.DB, token) : null;
  if (!found || !(await shareOnFor(c.env, found.ownerId))) return deny(c, 404, "not_found", "This link does not work", "It was reset or switched off, or it has expired. Ask the person who shared it for a new one.");
  // the token is kept for this paper's routes only, in a cookie the page cannot read; it lasts as long as the link (30 days at most, then the link is opened again)
  setLinkCookie(c, found.docId, token, Math.min(found.seconds ?? 30 * 86_400, 30 * 86_400));
  return c.json({ docId: found.docId });
});

/* ---------------------------------------------------------------- the invited person */

shareRoutes.get("/with-me", async (c) => {
  const got = await requireUser(c, SIGNED_IN);
  if (got instanceof Response) return got;
  const all = await sharedWith(c.env.DB, got.user.id);
  const owners = new Map<string, boolean>();
  for (const p of all) if (!owners.has(p.ownerId)) owners.set(p.ownerId, await shareOnFor(c.env, p.ownerId));
  return c.json({ items: all.filter((p) => owners.get(p.ownerId)).map(({ ownerId: _o, ...p }) => p) });
});

shareRoutes.delete("/with-me/:id", async (c) => {
  const got = await requireUser(c, SIGNED_IN);
  if (got instanceof Response) return got;
  if (!(await leave(c.env.DB, c.req.param("id"), got.user.id))) return deny(c, 404, "not_found", "That paper is not shared with you");
  // their other windows of it close (docs/design/paper-live.md, 2); one that still has the link connects again
  liveRevoke(c, c.env, c.req.param("id"), { userId: got.user.id });
  return c.json({ ok: true });
});

/* ---------------------------------------------------------------- the owner's dialog */

shareRoutes.get("/papers/:id", async (c) => {
  const got = await owner(c);
  if (got instanceof Response) return got;
  return c.json({ share: await shareSettings(c.env.DB, got.row.id, mailerFor(c.env) !== null) });
});

shareRoutes.put("/papers/:id", async (c) => {
  const got = await owner(c);
  if (got instanceof Response) return got;
  const b = await body(c);
  if (!b) return TOO_BIG_OR_EMPTY(c);
  if (b.linkMode !== undefined && !isLinkMode(b.linkMode)) return deny(c, 400, "invalid_share", "General access is restricted or anyone with the link");
  // never Editor by link: a leaked link must never change someone's notes
  if (b.linkRole !== undefined && !isLinkRole(b.linkRole)) return deny(c, 400, "invalid_share", "A link can let people view or comment, not edit", "Add a person by e-mail to let them edit.");
  if (b.expiry !== undefined && !isLinkExpiry(b.expiry)) return deny(c, 400, "invalid_share", "A link lasts 7 days, 30 days or until you stop it");
  if (b.viewersDownload !== undefined && typeof b.viewersDownload !== "boolean") return deny(c, 400, "invalid_share", "Say whether viewers can download");
  await updateShare(c.env.DB, got.row.id, { linkMode: b.linkMode as never, linkRole: b.linkRole as never, expiry: b.expiry as LinkExpiry | undefined, viewersDownload: b.viewersDownload as boolean | undefined });
  // the link's people: closed when the link is restricted again, told to connect again (with their new role) when its role changed
  if (b.linkMode === "restricted") liveRevoke(c, c.env, got.row.id, { via: "link" });
  else if (b.linkRole !== undefined) liveRevoke(c, c.env, got.row.id, { via: "link", reconnect: true });
  const share = await shareSettings(c.env.DB, got.row.id, mailerFor(c.env) !== null);
  // opened to anyone for the first time: the link is made now, and its token is said this once
  if (share.linkMode === "anyone" && !share.link) {
    const made = await makeLink(c.env.DB, got.row.id, isLinkExpiry(b.expiry) ? b.expiry : DEFAULT_LINK_EXPIRY);
    return c.json({ share: await shareSettings(c.env.DB, got.row.id, mailerFor(c.env) !== null), token: made.token });
  }
  return c.json({ share });
});

shareRoutes.post("/papers/:id/link", async (c) => {
  const got = await owner(c);
  if (got instanceof Response) return got;
  const b = (await body(c)) ?? {};
  const expiry = b.expiry === undefined ? DEFAULT_LINK_EXPIRY : b.expiry;
  if (!isLinkExpiry(expiry)) return deny(c, 400, "invalid_share", "A link lasts 7 days, 30 days or until you stop it");
  const made = await makeLink(c.env.DB, got.row.id, expiry);
  // the old link stops at once, the open sockets of the people who came by it too
  liveRevoke(c, c.env, got.row.id, { via: "link" });
  return c.json({ share: await shareSettings(c.env.DB, got.row.id, mailerFor(c.env) !== null), token: made.token });
});

shareRoutes.delete("/papers/:id", async (c) => {
  const got = await owner(c);
  if (got instanceof Response) return got;
  await stopSharing(c.env.DB, got.row.id);
  liveRevoke(c, c.env, got.row.id, { via: "others" });
  return c.json({ share: await shareSettings(c.env.DB, got.row.id, mailerFor(c.env) !== null) });
});

/** The picture of the first page a body carries, when it passes every check; a picture that fails is left out of the e-mail (logged by its reason only), never a refusal. */
function pictureOf(b: Record<string, unknown>): InvitePicture | null {
  if (b.picture === undefined || b.picture === null) return null;
  const got = checkInvitePicture(b.picture);
  if (got.ok) return got.picture;
  console.warn(JSON.stringify({ level: "warn", msg: "invite_picture_left_out", reason: got.reason }));
  return null;
}

/** E-mails the invitation when the Worker can and it may (once, then Resend once an hour). True when it went. */
async function sendInvite(
  c: Context<HonoEnv>,
  q: { docId: string; title: string; memberId: string; email: string; role: "viewer" | "commenter" | "editor"; inviter: string | null; note?: string | null; picture?: InvitePicture | null },
): Promise<boolean> {
  const mailer = mailerFor(c.env);
  if (!mailer || !(await claimSend(c.env.DB, q.docId, q.memberId))) return false;
  const ok = await mailer({ to: q.email, paperTitle: q.title, inviterName: q.inviter ?? "Someone", role: q.role, link: paperLink(c, q.docId), note: q.note ?? null, picture: q.picture ?? null });
  if (!ok) await releaseSend(c.env.DB, q.docId, q.memberId);
  return ok;
}

shareRoutes.post("/papers/:id/members", async (c) => {
  const got = await owner(c);
  if (got instanceof Response) return got;
  const b = await body(c, MAX_INVITE_BODY);
  if (!b) return TOO_BIG_OR_EMPTY(c);
  const email = cleanEmail(b.email);
  if (!email) return deny(c, 400, "invalid_email", "That is not an e-mail address");
  if (!isMemberRole(b.role)) return deny(c, 400, "invalid_share", "Choose Can view, Can comment or Can edit");
  if (b.note !== undefined && b.note !== null && typeof b.note !== "string") return deny(c, 400, "invalid_share", "A note is text");
  const note = cleanInviteNote(b.note);
  if (note && note.length > INVITE_NOTE_MAX) return deny(c, 400, "invalid_share", `A note can be at most ${INVITE_NOTE_MAX} characters`);
  // Undo of a removal puts the person back as they were: not counted again, not e-mailed again
  const restore = b.restore === true;
  const r = await invite(c.env.DB, { docId: got.row.id, ownerId: got.user.id, ownerEmail: got.user.email, email, role: b.role, count: !restore });
  if (!r.ok) {
    if (r.reason === "self") return deny(c, 400, "invalid_email", "That is your own address", "You already have this paper.");
    if (r.reason === "full") return deny(c, 409, "members_full", `A paper can be shared with ${SHARE_MAX_MEMBERS} people`, "Remove someone to add another.");
    return deny(c, 429, "invite_limit", `You can invite ${SHARE_INVITES_PER_DAY} people a day`, "Try again tomorrow.");
  }
  const emailed = r.created && !restore && b.send !== false ? await sendInvite(c, { docId: got.row.id, title: got.row.title, memberId: r.member.id, email, role: b.role, inviter: got.user.name, note, picture: pictureOf(b) }) : false;
  return c.json({ member: (await memberById(c.env.DB, got.row.id, r.member.id)) ?? r.member, created: r.created, emailed, link: paperLink(c, got.row.id) }, r.created ? 201 : 200);
});

shareRoutes.patch("/papers/:id/members/:mid", async (c) => {
  const got = await owner(c);
  if (got instanceof Response) return got;
  const b = await body(c);
  if (!b || !isMemberRole(b.role)) return deny(c, 400, "invalid_share", "Choose Can view, Can comment or Can edit");
  const m = await setRole(c.env.DB, got.row.id, c.req.param("mid"), b.role);
  if (!m) return deny(c, 404, "not_found", "That person is not on the list");
  liveRevoke(c, c.env, got.row.id, { memberId: m.id, reconnect: true });
  return c.json({ member: m });
});

shareRoutes.delete("/papers/:id/members/:mid", async (c) => {
  const got = await owner(c);
  if (got instanceof Response) return got;
  const m = await removeMember(c.env.DB, got.row.id, c.req.param("mid"));
  if (!m) return deny(c, 404, "not_found", "That person is not on the list");
  liveRevoke(c, c.env, got.row.id, { memberId: m.id });
  return c.json({ removed: m });
});

shareRoutes.post("/papers/:id/members/:mid/resend", async (c) => {
  const got = await owner(c);
  if (got instanceof Response) return got;
  const m = await c.env.DB.prepare("SELECT id, email, role FROM doc_members WHERE doc_id = ?1 AND id = ?2").bind(got.row.id, c.req.param("mid")).first<{ id: string; email: string; role: string }>();
  if (!m || !isMemberRole(m.role)) return deny(c, 404, "not_found", "That person is not on the list");
  if (!mailerFor(c.env)) return deny(c, 503, "unavailable", "Invitations cannot be e-mailed from here", "Copy the invitation and send it yourself.");
  // an older page sends no body; a body too big is the same as none
  const b = (await body(c, MAX_INVITE_BODY)) ?? {};
  const sent = await sendInvite(c, { docId: got.row.id, title: got.row.title, memberId: m.id, email: m.email, role: m.role, inviter: got.user.name, picture: pictureOf(b) });
  if (!sent) return deny(c, 429, "rate_limited", "The invitation was e-mailed less than an hour ago", "You can send it again an hour after the last one.");
  return c.json({ member: await memberById(c.env.DB, got.row.id, m.id), emailed: true });
});

/* ---------------------------------------------------------------- comments (S2) */

const comments = (c: Context<HonoEnv>, need: ShareRole) => requirePaper(c, COMMENTS, need, paperRow(c));

shareRoutes.get("/papers/:id/comments", async (c) => {
  const got = await comments(c, "viewer");
  if (got instanceof Response) return got;
  return c.json({ comments: await listComments(c.env.DB, got.row.id, got.user?.id ?? null), max: MAX_COMMENTS_PER_DOC, role: got.access.role });
});

shareRoutes.post("/papers/:id/comments", async (c) => {
  const got = await comments(c, "commenter");
  if (got instanceof Response) return got;
  const b = await body(c);
  if (!b) return deny(c, 400, "invalid_comment", "Write a comment");
  const text = cleanCommentBody(b.body);
  if (!text) return deny(c, 400, "invalid_comment", "Write a comment");
  const r = await addComment(c.env.DB, { docId: got.row.id, userId: got.user!.id, anchor: b.anchor, parentId: b.parentId, body: text });
  if (!r.ok) {
    if (r.reason === "full") return deny(c, 409, "comments_full", `A paper can hold ${MAX_COMMENTS_PER_DOC} comments`, "Delete some resolved ones to add more.");
    return deny(c, 400, "invalid_comment", r.reason === "parent" ? "That comment is not there any more" : "That highlight or note is not there any more");
  }
  liveChanged(c, got.row, { kind: "comments", id: r.comment.id, by: got.user!.id });
  return c.json({ comment: r.comment }, 201);
});

shareRoutes.patch("/papers/:id/comments/:cid", async (c) => {
  const got = await comments(c, "commenter");
  if (got instanceof Response) return got;
  const me = got.user!.id;
  const b = await body(c);
  const have = await getComment(c.env.DB, got.row.id, c.req.param("cid"), me);
  if (!have) return deny(c, 404, "not_found", "That comment is not there any more");
  if (!b || (b.body === undefined && b.resolved === undefined)) return deny(c, 400, "invalid_comment", "Nothing to change");
  let now = have;
  if (b.body !== undefined) {
    if (!have.mine) return deny(c, 403, "forbidden", "Only its author can edit a comment");
    const text = cleanCommentBody(b.body);
    if (!text) return deny(c, 400, "invalid_comment", "Write a comment");
    now = (await editComment(c.env.DB, got.row.id, have.id, text, me)) ?? now;
  }
  if (b.resolved !== undefined) {
    if (typeof b.resolved !== "boolean" || have.parentId !== null) return deny(c, 400, "invalid_comment", "A thread is resolved by its first comment");
    if (!roleAtLeast(got.access.role, "editor")) return deny(c, 403, "forbidden", "The owner and the editors resolve threads");
    now = (await resolveThread(c.env.DB, got.row.id, have.id, b.resolved, me)) ?? now;
  }
  liveChanged(c, got.row, { kind: "comments", id: have.id, by: me });
  return c.json({ comment: now });
});

shareRoutes.delete("/papers/:id/comments/:cid", async (c) => {
  const got = await comments(c, "commenter");
  if (got instanceof Response) return got;
  const have = await getComment(c.env.DB, got.row.id, c.req.param("cid"), got.user!.id);
  if (!have) return deny(c, 404, "not_found", "That comment is not there any more");
  if (!have.mine && got.access.role !== "owner") return deny(c, 403, "forbidden", "Only its author or the paper's owner can delete a comment");
  await deleteComment(c.env.DB, got.row.id, have.id);
  liveChanged(c, got.row, { kind: "comments", id: have.id, by: got.user!.id });
  return c.body(null, 204);
});
