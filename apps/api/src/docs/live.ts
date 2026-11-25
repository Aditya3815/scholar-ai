import type { Context } from "hono";
import { liveColour, liveSlotOfId, type LiveRole } from "@scholar/shared";
import type { EnvPick, HonoEnv } from "../platform/env";
import { liveOnFor, liveSwitchedOn } from "./live-flag";
import { LIVE_WHO_HEADER, type LiveRevoke, type LiveSignal, type LiveWho } from "./live-presence";
import { deny } from "../problem";

/**
 * The Worker's side of a paper's room (docs/design/paper-live.md, section 2): joining it after the paper's gate, and telling it, after a write, that something changed or that someone's access
 * ended. Every call is skipped while LIVE is off (or off for the paper's owner), and none of them can fail the request that made it: a room that does not answer is only logged.
 */

/** What closing a room needs of the environment (a request's, or the account deletion's). */
export type RoomEnv = EnvPick<"DB", "PAPER_ROOM" | "LIVE" | "SHARE" | "SHARE_BETA_USERS" | "CACHE">;

/** The colour of a person by their place in the share (the owner 0, then the people named in the order they were invited), or from their id for someone who came by the link. */
async function colourOf(db: D1Database, docId: string, who: { userId: string; via: "owner" | "member" | "link"; memberId: string | null }): Promise<number> {
  if (who.via === "owner") return liveColour(0);
  if (who.via === "member" && who.memberId) {
    const r = await db
      .prepare("SELECT COUNT(*) AS n FROM doc_members m, doc_members me WHERE me.doc_id = ?1 AND me.id = ?2 AND m.doc_id = ?1 AND (m.invited_at < me.invited_at OR (m.invited_at = me.invited_at AND m.rowid < me.rowid))")
      .bind(docId, who.memberId)
      .first<{ n: number }>();
    return liveColour(1 + (r?.n ?? 0));
  }
  return liveColour(liveSlotOfId(who.userId));
}

/**
 * Joins the room of a paper the person may open (the route checked it), and answers the room's 101 with the socket. The identity is written here, on a request made here: nothing the page
 * sent (a header, a query) reaches the room. The display name is the account's name ("Someone" without one), never the e-mail address.
 */
export async function joinRoom(
  c: Context<HonoEnv>,
  q: { docId: string; user: { id: string; name: string | null }; role: LiveRole; via: "owner" | "member" | "link"; memberId: string | null },
): Promise<Response> {
  const ns = c.env.PAPER_ROOM;
  if (!ns) return deny(c, 503, "unavailable", "Live updates are not available here");
  const colour = await colourOf(c.env.DB, q.docId, { userId: q.user.id, via: q.via, memberId: q.memberId });
  const who: LiveWho = { userId: q.user.id, name: (q.user.name ?? "").trim().slice(0, 80) || "Someone", colour, role: q.role, via: q.via, memberId: q.memberId };
  const res = await ns.getByName(q.docId).fetch(new Request("https://paper-room/connect", { headers: { Upgrade: "websocket", [LIVE_WHO_HEADER]: JSON.stringify(who) } }));
  // a fresh response (its headers can be changed by the app's middleware), with the room's socket
  if (res.status !== 101 || !res.webSocket) return deny(c, res.status === 429 ? 429 : 503, res.status === 429 ? "rate_limited" : "unavailable", res.status === 429 ? "This paper has as many people open as it can hold" : "Live updates are not available now");
  return new Response(null, { status: 101, webSocket: res.webSocket });
}

/** Runs `job` after the response when the request has an execution context (a test calling the app directly has none: then it simply runs). Never throws. */
function later(c: Context<HonoEnv> | null, job: Promise<unknown>): void {
  const safe = job.catch((e: unknown) => console.error(JSON.stringify({ level: "warn", msg: "live_room_unreachable", error: e instanceof Error ? e.name : "error" })));
  if (!c) return void safe;
  try {
    c.executionCtx.waitUntil(safe);
  } catch {
    void safe;
  }
}

/** After a write: the paper's room is told what changed. Nothing is sent while LIVE is off for the paper's owner. */
export function liveChanged(c: Context<HonoEnv>, doc: { id: string; user_id: string }, s: LiveSignal): void {
  const ns = c.env.PAPER_ROOM;
  if (!ns) return;
  later(
    c,
    (async () => {
      if (!(await liveOnFor(c.env, doc.user_id))) return;
      await ns.getByName(doc.id).signal(s);
    })(),
  );
}

/**
 * Someone's access ended (a person removed, the link reset or restricted, sharing stopped, the paper deleted), or their role changed (`reconnect`): their sockets are closed. With a request,
 * after the response; with none (deleting a paper with an account), awaited, and still never throws. Checked against the switch for anybody, not the owner: a room opened while LIVE was on for
 * this owner must still be closed after the owner left the dark list.
 */
export async function liveRevoke(c: Context<HonoEnv> | null, env: RoomEnv, docId: string, r: LiveRevoke): Promise<void> {
  const ns = env.PAPER_ROOM;
  if (!ns) return;
  const job = (async () => {
    if (!(await liveSwitchedOn(env))) return;
    // A Durable Object call can fail now and then (the object was moved, reset, or the connection dropped); a stub that threw is not used again, so each try makes a new one.
    // Closing the sockets of people who lost access matters, so it is tried three times, and a failure is logged instead of being swallowed.
    for (let attempt = 1; ; attempt++) {
      try {
        await ns.getByName(docId).revoke(r);
        return;
      } catch (e) {
        console.warn(JSON.stringify({ level: "warn", msg: "live_revoke_failed", attempt, error: e instanceof Error ? e.message : String(e) }));
        if (attempt >= 3) return;
        await new Promise((ok) => setTimeout(ok, 100 * attempt));
      }
    }
  })();
  if (c) return later(c, job);
  await job.catch(() => {});
}
