import type { IndexEntry } from "./chat-state";

/**
 * The list of chats in this browser, and whose they are (docs/design/chat-actions-context.md, section 6). Pure functions, so that they are tested without a browser.
 *
 * Until 6 Nov 2026 this file also chose questions of OTHER chats to send with a message ("Continue from an earlier chat", "Use my earlier chats"), and kept a few words of each chat's questions on its
 * entry (`kw`) and a "do not use as memory" mark (`nomem`) for that. The feature was removed (design PDF "Sodhsetu understanding, follow-ups and MCP", M1): a message leans only on its own chat, and
 * nothing of another chat leaves the device. `parseIndex` drops the two old fields, so the next write of the list takes them out of storage.
 */

/** The chats the rail lists. */
export const RAIL_CHATS = 6;
const MAX_OWNER_CHARS = 100;

/** A chat of the list as the rail reads it: who it belongs to. */
export type MemoryEntry = IndexEntry & { owner?: string };

/* ---------------------------------------------------------------- the list of chats, and whose they are */

/**
 * The list of chats as it comes back out of storage (it can hold anything: another build's fields, a hand edit). An entry needs an id, a title and a time; the owner is kept only when it is what it should
 * be; the two fields of the removed earlier-chats feature (`kw`, the words of the person's questions, and `nomem`) are dropped, so the next write of the list takes them out of the browser; any other field
 * that is not known is kept as it is (a newer build's: touching a chat must not lose it), and at most `max` entries are kept, in the order stored.
 */
export function parseIndex(raw: unknown, max: number): MemoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: MemoryEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") continue;
    const { owner, ...rest } = e as Record<string, unknown>;
    delete rest.kw;
    delete rest.nomem;
    if (typeof rest.id !== "string" || typeof rest.title !== "string" || typeof rest.updatedAt !== "number") continue;
    out.push({
      ...rest,
      id: rest.id,
      title: rest.title,
      updatedAt: rest.updatedAt,
      ...(typeof owner === "string" && owner.length > 0 && owner.length <= MAX_OWNER_CHARS ? { owner } : {}),
    });
    if (out.length === max) break;
  }
  return out;
}

/**
 * The chats of this browser that belong to whoever is here. A chat is stamped with the id of the person who made it (`owner`); one made before that was kept, or by a visitor, has none, and stays: it
 * becomes the first signed-in person's who opens it.
 * - A chat of a DIFFERENT signed-in person is `dropped` (it goes: that is positive evidence that somebody else is at this browser, the shared-computer case).
 * - When nobody is signed in (`null`) the chats of any person are `held`, not dropped: a session that ends by running out (the cookie lasts 30 days) is not a sign-out, and the person's chats must still be
 *   there when they sign in again. Held chats are not shown, not drawn on and not offered to anyone, and they stay in storage until their person is back or another person signs in. Only an explicit
 *   sign-out and "Delete all" remove them without a person to compare with.
 * While it is not yet known who is here (`undefined`: the page has not asked) nothing is hidden or taken away. Pure; the list it is given is not changed.
 */
export function ownedBy<E extends { owner?: string }>(index: readonly E[], owner: string | null | undefined): { kept: E[]; dropped: E[]; held: E[] } {
  if (owner === undefined) return { kept: [...index], dropped: [], held: [] };
  const kept: E[] = [];
  const dropped: E[] = [];
  const held: E[] = [];
  for (const e of index) (e.owner === undefined || e.owner === owner ? kept : owner === null ? held : dropped).push(e);
  return { kept, dropped, held };
}

/**
 * The list as it is written back when this page can see only part of it: what it shows, then the chats it holds back (those of a person who is not here, and those of another person that a tab with an
 * old idea of who is here cannot see), at most `max` in all. Writing only what a page shows would delete the rest from the browser's list; when there is no room for all of it the held chats go first, the
 * oldest first, and come back as `dropped` so that their records can be deleted with them. Pure.
 */
export function withHeld<E extends { updatedAt: number }>(visible: readonly E[], held: readonly E[], max: number): { list: E[]; dropped: E[] } {
  const room = Math.max(0, max - visible.length);
  const newest = [...held].sort((a, b) => b.updatedAt - a.updatedAt);
  return { list: [...visible, ...newest.slice(0, room)], dropped: newest.slice(room) };
}

/**
 * The chats an open page holds in memory that another tab has since taken out of the list (it deleted one, cleared them, or signed out): they must not stay on this page, where the next save would write them
 * back. A chat being answered here and a private one (never in the list) are not let go.
 */
export function goneFromIndex(held: Iterable<string>, index: readonly { id: string }[], keep: ReadonlySet<string>): string[] {
  const listed = new Set(index.map((e) => e.id));
  return [...held].filter((id) => !listed.has(id) && !keep.has(id));
}
