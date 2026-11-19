/**
 * Sharing a paper's workspace (docs/design/paper-share.md): the roles, the limits and the shapes both apps read. Drive's model: people named by e-mail as Viewer, Commenter or Editor; a link that
 * is Restricted (the people above only) or opens to anyone as Viewer or Commenter, never as Editor. Imports only the e-mail pattern.
 */
import { EMAIL_WHOLE } from "./ids";

/** What a person may do with one paper, lowest first. `owner` is the paper's own account and is never given. */
export const SHARE_ROLES = ["viewer", "commenter", "editor", "owner"] as const;
export type ShareRole = (typeof SHARE_ROLES)[number];
/** The roles a named person can be given. */
export const MEMBER_ROLES = ["viewer", "commenter", "editor"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
/** The roles a link can give: never Editor (a leaked link must never change someone's notes). */
export const LINK_ROLES = ["viewer", "commenter"] as const;
export type LinkRole = (typeof LINK_ROLES)[number];
export const LINK_MODES = ["restricted", "anyone"] as const;
export type LinkMode = (typeof LINK_MODES)[number];

export const ROLE_LABEL: Record<ShareRole, string> = { viewer: "Can view", commenter: "Can comment", editor: "Can edit", owner: "Owner" };

/** Does `have` allow what `need` allows? A missing role allows nothing. */
export const roleAtLeast = (have: ShareRole | null | undefined, need: ShareRole): boolean => !!have && SHARE_ROLES.indexOf(have) >= SHARE_ROLES.indexOf(need);
/** The higher of two roles (a member who also opened the link keeps the better one). */
export const higherRole = (a: ShareRole | null, b: ShareRole | null): ShareRole | null => (!a ? b : !b ? a : roleAtLeast(a, b) ? a : b);

export const isMemberRole = (v: unknown): v is MemberRole => typeof v === "string" && (MEMBER_ROLES as readonly string[]).includes(v);
export const isLinkRole = (v: unknown): v is LinkRole => typeof v === "string" && (LINK_ROLES as readonly string[]).includes(v);
export const isLinkMode = (v: unknown): v is LinkMode => typeof v === "string" && (LINK_MODES as readonly string[]).includes(v);

/** The limits of section 6. */
export const SHARE_MAX_MEMBERS = 50;
export const SHARE_INVITES_PER_DAY = 200;
export const MAX_COMMENTS_PER_DOC = 500;
export const MAX_COMMENT_CHARS = 2000;
/** "Resend" sends the invitation e-mail again at most once an hour. */
export const SHARE_RESEND_MS = 60 * 60 * 1000;
/** How long a link lasts: 7 or 30 days, or until it is stopped (null). 30 days is the default. */
export const LINK_EXPIRY_DAYS = [7, 30, null] as const;
export type LinkExpiry = (typeof LINK_EXPIRY_DAYS)[number];
export const DEFAULT_LINK_EXPIRY: LinkExpiry = 30;
export const isLinkExpiry = (v: unknown): v is LinkExpiry => v === null || v === 7 || v === 30;

/** A link token: 32 random bytes in base64url, 43 characters. */
export const SHARE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** An address as the owner typed it, lower-cased and trimmed; null when it is not an e-mail address (or longer than 254 characters). */
export function cleanEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.length <= 254 && EMAIL_WHOLE.test(e) ? e : null;
}

/** What a comment hangs on: a block of a page of notes, or a highlight. */
export type CommentAnchor = `block:${string}:${string}` | `note:${string}`;
const ANCHOR_ID = "[A-Za-z0-9_-]{1,64}";
const ANCHOR = new RegExp(`^(?:block:${ANCHOR_ID}:${ANCHOR_ID}|note:${ANCHOR_ID})$`);
export const isCommentAnchor = (v: unknown): v is CommentAnchor => typeof v === "string" && ANCHOR.test(v);
export const blockAnchor = (pageId: string, blockId: string): CommentAnchor => `block:${pageId}:${blockId}`;
export const noteAnchor = (noteId: string): CommentAnchor => `note:${noteId}`;

/** A comment's words: plain text, its line breaks kept (at most two in a row), at most MAX_COMMENT_CHARS. Empty when there is nothing. */
export function cleanCommentBody(v: unknown): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_COMMENT_CHARS);
}

/* ---------------------------------------------------------------- what the API answers */

/** One person the owner shared with (the owner's dialog only). */
export type ShareMember = { id: string; email: string; role: MemberRole; name: string | null; joined: boolean; invitedAt: string; lastOpenedAt: string | null; emailedAt: string | null };
/** A paper's sharing, as its owner sees it. `link` is whether a link was made (its token is shown once, when it is made: only its SHA-256 is kept). */
export type ShareSettings = {
  linkMode: LinkMode;
  linkRole: LinkRole;
  link: boolean;
  expiresAt: string | null;
  viewersDownload: boolean;
  members: ShareMember[];
  /** Invitations are sent by e-mail (S4). */
  email: boolean;
};
/** A paper someone shared with this person (My Workspace, "Shared with me"). */
export type SharedPaper = { docId: string; title: string; ownerName: string | null; role: MemberRole; invitedAt: string; lastOpenedAt: string | null };
/** How this person reaches a paper that is not theirs: told with the paper (GET /documents/:id). Absent for the owner. */
export type PaperAccess = { role: Exclude<ShareRole, "owner">; via: "member" | "link"; ownerName: string | null; viewersDownload: boolean; signedIn: boolean };
/** One comment. `mine`: written by the person asking. `author` null: an account that was deleted ("a former member"). */
export type DocComment = { id: string; anchor: CommentAnchor; parentId: string | null; author: string | null; mine: boolean; body: string; resolved: boolean; createdAt: string; updatedAt: string };
