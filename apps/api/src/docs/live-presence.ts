import { LIVE_RATE_PER_SECOND, liveInitial, type LiveHere, type LiveKind, type LivePerson, type LiveRole, type LiveView } from "@scholar/shared";

/**
 * The heart of a paper's room (docs/design/paper-live.md, section 2), without a Durable Object: what one socket says about its person (kept in the socket's attachment, so it survives the
 * room's hibernation and is gone with the socket), how a `here` changes it, the presence list the others are sent, and the rate limit. Pure, so it is tested in node (live-presence.test.ts).
 */

/** The header in which the Worker hands the room who is connecting (docs/live.ts). The Worker writes it on a request it makes itself; the page's own request never reaches the room. */
export const LIVE_WHO_HEADER = "X-Live-Who";

/** A change signal as a write sends it: what changed, and who made it (an account id). */
export type LiveSignal = { kind: LiveKind; id?: string; rev?: number; by: string };

/** Who a socket is: written by the Worker after its gate (never by the page), and where the page last said it is. */
export type LiveConn = {
  /** The socket's own id (random), for logs and tests only. */
  conn: string;
  userId: string;
  name: string;
  colour: number;
  role: LiveRole;
  /** How the person reaches the paper: their own, a named person (with their row in doc_members), or the link. */
  via: "owner" | "member" | "link";
  memberId: string | null;
  view: LiveView;
  page: number | null;
  notesPage: string | null;
  editingBlock: string | null;
  /** Where their cursor is in `editingBlock` (an offset into its Markdown) and the end of a selection; null when not said. */
  caret?: number | null;
  caretEnd?: number | null;
  active: boolean;
  idle: boolean;
  /** When the room last heard from this socket (ms). */
  seen: number;
};

/** The identity the Worker hands the room (a header it writes itself, on a request it makes itself). */
export type LiveWho = Pick<LiveConn, "userId" | "name" | "colour" | "role" | "via" | "memberId">;

/** A socket that has said nothing for this long counts as idle (its heartbeat is every 20 s; the platform closes a socket that is really gone). */
export const SILENT_IDLE_MS = 65_000;

export function freshConn(conn: string, who: LiveWho, now: number): LiveConn {
  return { conn, ...who, view: "paper", page: null, notesPage: null, editingBlock: null, active: true, idle: false, seen: now };
}

/** A `here` applied: a Viewer or a Commenter never has an `editingBlock` (they cannot edit), nor a caret, whatever the page sent. */
export function applyHere(c: LiveConn, h: LiveHere, now: number): LiveConn {
  const mayEdit = c.role === "editor" || c.role === "owner";
  const editingBlock = mayEdit && h.view === "notes" && h.notesPage ? (h.editingBlock ?? null) : null;
  return {
    ...c,
    view: h.view,
    page: h.page ?? null,
    notesPage: h.notesPage ?? null,
    editingBlock,
    caret: editingBlock ? (h.caret ?? null) : null,
    caretEnd: editingBlock && h.caret !== undefined ? (h.caretEnd ?? null) : null,
    active: h.active,
    idle: h.idle,
    seen: now,
  };
}

/** The validated reader of an attachment: whatever was stored by an older room (or nothing) is no connection. */
export function readConn(v: unknown): LiveConn | null {
  if (!v || typeof v !== "object") return null;
  const c = v as LiveConn;
  return typeof c.userId === "string" && typeof c.conn === "string" && typeof c.colour === "number" ? c : null;
}

/**
 * The people in the room, as the others are sent them: one entry a person (their windows folded: the one heard from last gives the place, and any window typing in a block gives that block),
 * in the order of their colours, then names. A socket silent for SILENT_IDLE_MS is idle.
 */
export function presenceOf(conns: readonly LiveConn[], now: number): LivePerson[] {
  const byUser = new Map<string, LiveConn[]>();
  for (const c of conns) byUser.set(c.userId, [...(byUser.get(c.userId) ?? []), c]);
  const people: LivePerson[] = [];
  for (const [id, list] of byUser) {
    const last = [...list].sort((a, b) => b.seen - a.seen)[0]!;
    const typing = list.find((c) => c.editingBlock && !c.idle);
    const at = typing ?? last;
    const idle = list.every((c) => c.idle || now - c.seen > SILENT_IDLE_MS);
    people.push({
      id,
      name: last.name,
      initial: liveInitial(last.name),
      colour: last.colour,
      role: last.role,
      view: at.view,
      page: at.page,
      notesPage: at.notesPage,
      editingBlock: at.editingBlock,
      ...(at.editingBlock && typeof at.caret === "number" ? { caret: at.caret, ...(typeof at.caretEnd === "number" ? { caretEnd: at.caretEnd } : {}) } : {}),
      active: !idle && list.some((c) => c.active),
      idle,
    });
  }
  return people.sort((a, b) => a.colour - b.colour || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Which sockets an access change closes: one person (by account or by their row in doc_members), everyone who came by the link, or everyone but the owner (or everyone). */
export type LiveRevoke = { userId?: string; memberId?: string; via?: "link" | "others" | "all"; reconnect?: boolean };
export function revokes(c: LiveConn, r: LiveRevoke): boolean {
  if (r.via === "all") return true;
  if (r.via === "others") return c.via !== "owner";
  if (r.via === "link") return c.via === "link";
  if (r.userId && c.userId === r.userId && c.via !== "owner") return true;
  if (r.memberId && c.memberId === r.memberId) return true;
  return false;
}

/* ---------------------------------------------------------------- the rate limit: a token bucket per socket */

export type Bucket = { tokens: number; at: number; dropped: number };
export const freshBucket = (now: number): Bucket => ({ tokens: LIVE_RATE_PER_SECOND, at: now, dropped: 0 });
/** A socket that has had this many messages dropped in a row is closed (it is not a page: a page sends a few a second at most). */
export const DROPS_BEFORE_CLOSE = 3 * LIVE_RATE_PER_SECOND;

/** Takes one message's token: "ok", "drop" (over 20 a second: the message is ignored) or "close" (it keeps on). Refills at 20 a second, up to 20. */
export function take(b: Bucket, now: number): "ok" | "drop" | "close" {
  const elapsed = Math.max(0, now - b.at);
  b.tokens = Math.min(LIVE_RATE_PER_SECOND, b.tokens + (elapsed * LIVE_RATE_PER_SECOND) / 1000);
  b.at = now;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    b.dropped = 0;
    return "ok";
  }
  b.dropped += 1;
  return b.dropped >= DROPS_BEFORE_CLOSE ? "close" : "drop";
}
