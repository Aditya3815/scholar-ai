/**
 * Live presence and live updates in a shared paper (docs/design/paper-live.md): the messages of the paper's room (one Durable Object a paper, `PaperRoom`) and its limits, read by both apps.
 * The socket carries SIGNALS only: who is here and where, and "this changed". The content itself always comes through the normal routes and their role checks. Nothing here is stored.
 * Imports nothing (a module of shared: text, ids, vocab and the types of protocol/ only; the role names are written out, as share.ts has them).
 */

/** A message is at most this many bytes (UTF-8), either way. */
export const LIVE_MAX_MESSAGE_BYTES = 2048;
/** A socket may send this many messages a second (a token bucket of the same size); past it, messages are dropped, and a socket that keeps on is closed. */
export const LIVE_RATE_PER_SECOND = 20;
/** At most this many sockets in one paper's room (the platform allows about 32,768). */
export const LIVE_ROOM_CAP = 50;
/** The page says where it is again at least this often, so the room knows it is still there. */
export const LIVE_HEARTBEAT_MS = 20_000;
/** A person is active (the green dot) when they did something in the last 30 s, and idle (faded) after 2 minutes of nothing. */
export const LIVE_ACTIVE_MS = 30_000;
export const LIVE_IDLE_MS = 120_000;
/** The quiet "Reconnecting…" shows only after this long without a connection. */
export const LIVE_RECONNECT_LINE_MS = 5_000;
/** How many presence colours there are (each person one, by their order in the share). */
export const LIVE_COLOURS = 6;
/** A caret is an offset into the block's Markdown: at most this (a text block's cap, NOTEBOOK_LIMITS.text; live.test.ts keeps them equal). */
export const LIVE_CARET_MAX = 8000;
/** While typing or moving, the page sends where its caret is at most this often (the last place always goes). */
export const LIVE_CARET_SEND_MS = 120;
/** Another person's caret fades this long after it last moved. */
export const LIVE_CARET_FADE_MS = 3000;

/** How the room closes a socket: 4403 when access has ended (the page shows "You no longer have access" once the paper says so too); 4001 when the role changed (the page connects again at once). */
export const LIVE_CLOSE = { noAccess: 4403, reconnect: 4001, full: 4429, tooBig: 1009, abuse: 1008, gone: 1001 } as const;

export const LIVE_VIEWS = ["paper", "notes", "comments"] as const;
export type LiveView = (typeof LIVE_VIEWS)[number];
export type LiveRole = "viewer" | "commenter" | "editor" | "owner";
export const LIVE_KINDS = ["notebook", "highlights", "comments", "pages"] as const;
/** What changed: a page of notes (its blocks: `id` and `rev`), the highlights, the comments, or the list of pages (a rename, a move, a delete). */
export type LiveKind = (typeof LIVE_KINDS)[number];

/**
 * Client to room: where this window is. Sent on a change and every LIVE_HEARTBEAT_MS. `active`: something was done in the last LIVE_ACTIVE_MS; `idle`: nothing for LIVE_IDLE_MS.
 * `caret` (with `editingBlock` only): where the cursor is in that block, an offset into its Markdown; `caretEnd`: the end of a selection from `caret` (larger than it).
 */
export type LiveHere = { t: "here"; view: LiveView; page?: number; notesPage?: string; editingBlock?: string; caret?: number; caretEnd?: number; active: boolean; idle: boolean };

/** One person in the room, as the others see them (one entry a person, whatever the number of their windows). */
export type LivePerson = {
  id: string;
  name: string;
  initial: string;
  /** 0 .. LIVE_COLOURS - 1 */
  colour: number;
  role: LiveRole;
  view: LiveView;
  page: number | null;
  notesPage: string | null;
  editingBlock: string | null;
  /** Where their cursor is in `editingBlock` (an offset into its Markdown), and the end of their selection; absent when not known. */
  caret?: number;
  caretEnd?: number;
  active: boolean;
  idle: boolean;
};

/** Room to client. `hello` once on joining (who this window is); `presence` whenever someone comes, goes or moves; `changed` after a write succeeded (a signal: fetch it through the route). */
export type LiveServerMessage =
  | { t: "hello"; you: string; colour: number; role: LiveRole }
  | { t: "presence"; people: LivePerson[] }
  | { t: "changed"; kind: LiveKind; id?: string; rev?: number; by: string };

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const bytes = (s: string): number => {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
};
/** The size of a message in UTF-8 bytes (what the 2 KB cap counts). */
export const liveMessageBytes = bytes;

/**
 * A message from a page, read: a `here` with only known fields of the right shape (an unknown field is dropped, a wrong one refuses the whole message), or null. Never throws. The room then
 * also takes `editingBlock` (and its caret) away from a person who may not edit (a Viewer or a Commenter), whatever the page sent.
 */
export function readLiveHere(raw: unknown): LiveHere | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    if (bytes(raw) > LIVE_MAX_MESSAGE_BYTES) return null;
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const m = v as Record<string, unknown>;
  if (m.t !== "here" || !(LIVE_VIEWS as readonly unknown[]).includes(m.view)) return null;
  const out: LiveHere = { t: "here", view: m.view as LiveView, active: m.active === true, idle: m.idle === true };
  if (m.page !== undefined && m.page !== null) {
    if (typeof m.page !== "number" || !Number.isInteger(m.page) || m.page < 1 || m.page > 100_000) return null;
    out.page = m.page;
  }
  for (const k of ["notesPage", "editingBlock"] as const) {
    if (m[k] === undefined || m[k] === null) continue;
    if (typeof m[k] !== "string" || !ID.test(m[k] as string)) return null;
    out[k] = m[k] as string;
  }
  if (out.editingBlock && !out.notesPage) return null;
  for (const k of ["caret", "caretEnd"] as const) {
    if (m[k] === undefined || m[k] === null) continue;
    if (typeof m[k] !== "number" || !Number.isInteger(m[k]) || (m[k] as number) < 0 || (m[k] as number) > LIVE_CARET_MAX) return null;
    out[k] = m[k] as number;
  }
  // a caret only in the block typed in; a selection's end only after its start (an empty one is a caret)
  if (out.caret !== undefined && !out.editingBlock) return null;
  if (out.caretEnd !== undefined && (out.caret === undefined || out.caretEnd < out.caret)) return null;
  if (out.caretEnd === out.caret) delete out.caretEnd;
  if (out.active && out.idle) out.active = false;
  return out;
}

/** A message from the room, read by the page: null for anything it does not know (a newer room's message is ignored, not an error). */
export function readLiveServer(raw: unknown): LiveServerMessage | null {
  if (typeof raw !== "string" || bytes(raw) > 64 * 1024) return null;
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!m || typeof m !== "object") return null;
  if (m.t === "hello" && typeof m.you === "string" && typeof m.colour === "number" && typeof m.role === "string") return m as LiveServerMessage;
  if (m.t === "presence" && Array.isArray(m.people)) return m as LiveServerMessage;
  if (m.t === "changed" && (LIVE_KINDS as readonly unknown[]).includes(m.kind) && typeof m.by === "string") return m as LiveServerMessage;
  return null;
}

/** The colour of the person at `slot` in the share (the owner 0, then the people named, in the order they were invited; a visitor by link from their id): 0 .. LIVE_COLOURS - 1. */
export function liveColour(slot: number): number {
  return ((Math.trunc(slot) % LIVE_COLOURS) + LIVE_COLOURS) % LIVE_COLOURS;
}
/** A stable slot for someone with no place in the share (a person who opened the link): from their id, after the named people. */
export function liveSlotOfId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % LIVE_COLOURS;
}
/** The initial shown in an avatar: the first letter of the name (a letter or a digit, any script), upper-cased; "?" when there is none. */
export function liveInitial(name: string): string {
  const m = /[\p{L}\p{N}]/u.exec(name);
  return m ? m[0].toLocaleUpperCase() : "?";
}

/** What a person is doing, in words: "Editing Methods", "Viewing p. 3", "In Comments", "Reading the notes", "Viewing the paper". `pageTitle` names a notes page (null: not known here). */
export function liveDoing(p: Pick<LivePerson, "view" | "page" | "notesPage" | "editingBlock">, pageTitle: (id: string) => string | null): string {
  if (p.view === "comments") return "In Comments";
  if (p.view === "notes") {
    // a page this window does not know (its notes are not loaded) is "the notes", not a wrong name
    const t = p.notesPage ? pageTitle(p.notesPage) : null;
    const name = t === null ? "the notes" : t.trim() || "Untitled page";
    return `${p.editingBlock ? "Editing" : "Reading"} ${name}`;
  }
  return p.page ? `Viewing p. ${p.page}` : "Viewing the paper";
}
