import type { DocComment, LinkExpiry, LinkMode, LinkRole, MemberRole, ShareMember, SharedPaper, ShareSettings } from "@scholar/shared";
/** A refusal of the share routes: its status and type, and the words to show. (Not docs-api's ApiError: importing it from here cut that module out of the first load into a chunk of its own.) */
export class ShareError extends Error {
  constructor(readonly status: number, readonly type: string, title: string, readonly detail?: string) {
    super(detail ? `${title}. ${detail}` : title);
  }
}

/**
 * The browser's side of sharing a paper (docs/design/paper-share.md): the owner's dialog, "Shared with me", opening a link, and comments. Every call goes to /api/v1/share; with the SHARE
 * switch off those answer 404 and the page never makes them (the Share button and the list are shown only when the server says sharing is on).
 */

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api/v1/share${path}`, { credentials: "same-origin", ...init, headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) } });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { type?: string; title?: string; detail?: string } | null;
    throw new ShareError(res.status, j?.type ?? "error", j?.title ?? `The service answered ${res.status}`, j?.detail);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}
const send = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/* ---------------------------------------------------------------- the owner */

export type ShareAnswer = { share: ShareSettings; token?: string };
export const fetchShare = (docId: string) => call<ShareAnswer>(`/papers/${docId}`);
export const changeShare = (docId: string, change: { linkMode?: LinkMode; linkRole?: LinkRole; expiry?: LinkExpiry; viewersDownload?: boolean }) => call<ShareAnswer>(`/papers/${docId}`, send("PUT", change));
export const resetLink = (docId: string, expiry: LinkExpiry) => call<ShareAnswer>(`/papers/${docId}/link`, send("POST", { expiry }));
export const stopSharing = (docId: string) => call<ShareAnswer>(`/papers/${docId}`, send("DELETE"));
export type Invited = { member: ShareMember; created: boolean; emailed: boolean; link: string };
export const inviteMember = (docId: string, email: string, role: MemberRole, opts: { restore?: boolean } = {}) => call<Invited>(`/papers/${docId}/members`, send("POST", { email, role, ...(opts.restore ? { restore: true } : {}) }));
export const changeMember = (docId: string, id: string, role: MemberRole) => call<{ member: ShareMember }>(`/papers/${docId}/members/${id}`, send("PATCH", { role }));
export const removeMember = (docId: string, id: string) => call<{ removed: ShareMember }>(`/papers/${docId}/members/${id}`, send("DELETE"));
export const resendInvite = (docId: string, id: string) => call<{ member: ShareMember; emailed: true }>(`/papers/${docId}/members/${id}/resend`, send("POST"));

/** The link's token is said once, when it is made (only its hash is kept on the server). The owner's browser keeps it, so Copy link works again on this device. */
const TOKEN_KEY = (docId: string) => `scholar.share.${docId}`;
export function keepToken(docId: string, token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY(docId), token);
    else localStorage.removeItem(TOKEN_KEY(docId));
  } catch {
    /* private mode: only this visit */
  }
}
export function keptToken(docId: string): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY(docId));
  } catch {
    return null;
  }
}
export const linkAddress = (token: string) => `${location.origin}/s/${token}`;
export const paperAddress = (docId: string) => `${location.origin}/papers/${docId}`;
/** "Copy invite" (when the Worker cannot e-mail): a ready message the owner sends by their own mail. */
export const inviteText = (title: string, link: string) => `I've shared "${title}" with you on Sodhsetu: ${link}\nSign in with Google using this address to open it.`;

/* ---------------------------------------------------------------- the invited person */

export const fetchSharedWithMe = () => call<{ items: SharedPaper[] }>("/with-me");
export const leaveShared = (docId: string) => call<{ ok: true }>(`/with-me/${docId}`, send("DELETE"));

/** A visitor opened /s/<token>: the server keeps the token for that paper's requests (a cookie the page cannot read) and says which paper it is. */
export const openLink = (token: string) => call<{ docId: string }>("/open", send("POST", { token }));
/** This browser opened the paper by its link (so a visitor who is not signed in may still try to open it at /papers/<id>). */
const VISITED_KEY = (docId: string) => `scholar.shared.${docId}`;
export function markLinkVisit(docId: string): void {
  try {
    sessionStorage.setItem(VISITED_KEY(docId), "1");
  } catch {
    /* ignore */
  }
}
export function linkVisited(docId: string): boolean {
  try {
    return sessionStorage.getItem(VISITED_KEY(docId)) === "1";
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- comments */

export const fetchComments = (docId: string) => call<{ comments: DocComment[]; max: number; role: string }>(`/papers/${docId}/comments`);
export const addComment = (docId: string, q: { anchor?: string; parentId?: string; body: string }) => call<{ comment: DocComment }>(`/papers/${docId}/comments`, send("POST", q));
export const editComment = (docId: string, id: string, change: { body?: string; resolved?: boolean }) => call<{ comment: DocComment }>(`/papers/${docId}/comments/${id}`, send("PATCH", change));
export const deleteComment = (docId: string, id: string) => call<void>(`/papers/${docId}/comments/${id}`, send("DELETE"));
