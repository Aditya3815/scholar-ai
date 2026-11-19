import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { SHARE_TOKEN, higherRole, isLinkRole, isMemberRole, type ShareRole } from "@scholar/shared";
import { sha256Hex } from "../hash";
import type { SessionUser } from "../auth/users";
import { shareOnFor, type ShareFlagEnv } from "./share-flag";

/**
 * Who may do what with one paper (docs/design/paper-share.md, sections 2 and 6): the ONE gate every paper route asks. `accessTo` answers the person's role, `owner`, `editor`, `commenter` or
 * `viewer`, or null (nothing: the route says "not found", so a paper that is not shared with someone does not exist for them). Each route states the role it needs (docs/routes.ts).
 *
 *   owner      the paper's own account. Always, whatever the SHARE switch says (that is how every paper route worked before sharing).
 *   member     a person the owner named by e-mail: the account the invitation was matched to, or, the first time, an account whose VERIFIED e-mail is the address the owner typed (Google gives a
 *              verified e-mail; an ORCID account has none, so it never matches). The match is kept (user_id), so a later change of the account's address does not move it.
 *   link       anyone who opened the link while the paper is open to anyone with it, as Viewer or Commenter (never Editor). A visitor who is not signed in is a Viewer even on a Commenter link:
 *              a comment needs a name. The token is in an HttpOnly cookie of its own for this paper (set by POST /api/v1/share/open); only its SHA-256 is stored, and it is compared in constant time.
 * A member who also has the link gets the higher of the two. Every request reads the share again, so a person removed, a link reset, expired or stopped loses access on their next request.
 * With SHARE off (or, at dark, an owner who is not in SHARE_BETA_USERS) nobody but the owner has any role.
 */
export type DocAccess = {
  role: ShareRole;
  via: "owner" | "member" | "link";
  /** The member row (to note when they opened it); null for the owner and a link visitor. */
  memberId: string | null;
  /** Viewers can download the PDF (the owner's choice; the paper must still reach their browser to be shown). */
  viewersDownload: boolean;
};

export type AccessEnv = ShareFlagEnv & { DB: D1Database };

/* ---------------------------------------------------------------- the link token */

/** A new link token: 32 random bytes in base64url (43 characters). Shown once, to the owner; only its hash is kept. */
export function newLinkToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** What is stored of a token: its SHA-256, in hex. */
export const linkTokenHash = (token: string): Promise<string> => sha256Hex(token);

/** Two hashes compared in constant time (the time does not depend on where they first differ). */
export function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The cookie that holds a paper's link token for a visitor: one a paper, HttpOnly, SameSite=Strict, sent only to the API. */
export const linkCookieName = (docId: string) => `shr_${docId}`;
const COOKIE_PATH = "/api/v1";
const isHttps = (c: Context) => new URL(c.req.url).protocol === "https:";
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The link token this browser holds for the paper, or null. A cookie that is not shaped like a token is no token. */
export function readLinkToken(c: Context, docId: string): string | null {
  if (!SAFE_ID.test(docId)) return null;
  const t = getCookie(c, linkCookieName(docId));
  return t && SHARE_TOKEN.test(t) ? t : null;
}

export function setLinkCookie(c: Context, docId: string, token: string, maxAgeSeconds: number): void {
  setCookie(c, linkCookieName(docId), token, { path: COOKIE_PATH, httpOnly: true, secure: isHttps(c), sameSite: "Strict", maxAge: Math.max(60, Math.floor(maxAgeSeconds)) });
}

export function clearLinkCookie(c: Context, docId: string): void {
  if (SAFE_ID.test(docId)) deleteCookie(c, linkCookieName(docId), { path: COOKIE_PATH, secure: isHttps(c) });
}

/* ---------------------------------------------------------------- the gate */

type ShareRow = { link_mode: string; link_role: string; token_hash: string | null; live: number; viewers_download: number };
type MemberRow = { id: string; role: string; user_id: string | null };

/**
 * The role of `user` (or of a visitor holding `linkToken`) on the paper `doc`. The heart of the gate, without a request: docs/routes.ts reads the cookie and the person and asks this.
 * A member matched by e-mail for the first time is bound to the account here.
 */
export async function resolveAccess(env: AccessEnv, q: { doc: { id: string; user_id: string }; user: Pick<SessionUser, "id"> | null; linkToken: string | null }): Promise<DocAccess | null> {
  const { doc, user, linkToken } = q;
  const share = async () =>
    env.DB.prepare("SELECT link_mode, link_role, token_hash, (expires_at IS NULL OR expires_at > datetime('now')) AS live, viewers_download FROM doc_shares WHERE doc_id = ?1").bind(doc.id).first<ShareRow>();
  if (user && user.id === doc.user_id) return { role: "owner", via: "owner", memberId: null, viewersDownload: true };
  if (!user && !linkToken) return null;
  if (!(await shareOnFor(env, doc.user_id))) return null;

  let memberRole: ShareRole | null = null;
  let memberId: string | null = null;
  if (user) {
    // the account it was matched to, or the first sign-in with the verified address the owner typed
    const m = await env.DB
      .prepare(
        "SELECT m.id, m.role, m.user_id FROM doc_members m WHERE m.doc_id = ?1 AND (m.user_id = ?2 OR (m.user_id IS NULL AND EXISTS (SELECT 1 FROM users u WHERE u.id = ?2 AND u.email_verified = 1 AND lower(u.email) = m.email))) ORDER BY m.user_id IS NULL LIMIT 1",
      )
      .bind(doc.id, user.id)
      .first<MemberRow>();
    if (m && isMemberRole(m.role)) {
      memberRole = m.role;
      memberId = m.id;
      if (m.user_id === null) await env.DB.prepare("UPDATE doc_members SET user_id = ?2 WHERE id = ?1 AND user_id IS NULL").bind(m.id, user.id).run();
    }
  }

  let linkRole: ShareRole | null = null;
  const s = await share();
  if (linkToken && s && s.link_mode === "anyone" && s.token_hash && s.live === 1 && isLinkRole(s.link_role)) {
    if (sameHash(await linkTokenHash(linkToken), s.token_hash)) linkRole = !user && s.link_role === "commenter" ? "viewer" : s.link_role;
  }

  const role = higherRole(memberRole, linkRole);
  if (!role) return null;
  return { role, via: memberRole && role === memberRole ? "member" : "link", memberId: memberRole && role === memberRole ? memberId : null, viewersDownload: (s?.viewers_download ?? 1) === 1 };
}

/** The gate as a route asks it: the paper's owner, the person, and the link cookie of this request. */
export function accessTo<E extends { Bindings: AccessEnv }>(c: Context<E>, doc: { id: string; user_id: string }, user: Pick<SessionUser, "id"> | null): Promise<DocAccess | null> {
  return resolveAccess(c.env, { doc, user, linkToken: user?.id === doc.user_id ? null : readLinkToken(c, doc.id) });
}
