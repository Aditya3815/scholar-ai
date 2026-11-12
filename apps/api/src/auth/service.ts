import type { Context } from "hono";
import { PRIVACY_VERSION } from "@scholar/shared";
import { refuse, type Refusal } from "../platform/http/guards";
import { readSession } from "./http";
import { userFromSession } from "./session";
import type { SessionUser } from "./users";
import type { Env } from "../platform/env";

/** What another feature may use of sign-in: who is signed in, and the door a route keeps (src/platform/http/guards.ts checks where a write comes from). */

/** The person signed in on this request, or null. Any route's context works as long as its bindings include the D1 database. */
export async function currentUser<E extends { Bindings: Pick<Env, "DB"> }>(c: Context<E>): Promise<SessionUser | null> {
  return userFromSession(c.env.DB, readSession(c));
}

/**
 * What a route lets through, and what it says to everyone else, in this order:
 *   signIn  nobody is signed in (a string is the title of a 401 "unauthorized"; a Refusal is said as it is);
 *   role    the person does not have this role: refused as `signIn` (the admin pages say "Not found" to everyone else);
 *   ack     the person has not read this version of the privacy note (its title and detail, a 403 "privacy_ack_required");
 *   owns    the row the path names is not this person's (`find` gives it or null; `missing` is the title of the 404 "not_found").
 */
export type Door<Row = undefined> = {
  signIn: string | Refusal;
  role?: SessionUser["role"];
  ack?: { title: string; detail: string };
  owns?: { find: (c: Context<{ Bindings: Env }>, userId: string) => Promise<Row | null>; missing: string };
};

export type Admitted<Row> = { user: SessionUser; row: Row };

/** The person and the row the route is about, or the refusal to answer with (`instanceof Response`). */
export async function requireUser<Row = undefined>(c: Context<{ Bindings: Env }>, door: Door<Row>): Promise<Admitted<Row> | Response> {
  const user = await currentUser(c);
  if (!user || (door.role && user.role !== door.role)) return refuse(c, typeof door.signIn === "string" ? { status: 401, type: "unauthorized", title: door.signIn } : door.signIn);
  if (door.ack && user.privacyAck !== PRIVACY_VERSION) return refuse(c, { status: 403, type: "privacy_ack_required", ...door.ack });
  if (!door.owns) return { user, row: undefined as Row };
  const row = await door.owns.find(c, user.id);
  if (!row) return refuse(c, { status: 404, type: "not_found", title: door.owns.missing });
  return { user, row };
}
