import type { Context } from "hono";
import { roleAtLeast, type ShareRole } from "@scholar/shared";
import { currentUser, requireUser } from "../auth/service";
import type { SessionUser } from "../auth/users";
import { refuse, type Refusal } from "../platform/http/guards";
import type { HonoEnv } from "../platform/env";
import { accessTo, readLinkToken, type DocAccess } from "./access";
import { shareSwitchedOn } from "./share-flag";

/**
 * The door of every paper route (docs/design/paper-share.md, section 6): F10's `requireUser` for the person (its words, in its order: sign-in, then the privacy note), then the ONE gate
 * (`accessTo`, docs/access.ts) for the paper, with the role the route needs. In this order:
 *   signIn   nobody is signed in, and this request holds no link to the paper (or the route needs the owner, or sharing is off): 401 with the route's words;
 *   ack      the person has not read this version of the privacy note (a route that asks for it);
 *   missing  the paper does not exist, or this person has no role on it: 404 with the route's words (a paper that is not shared with someone does not exist for them);
 *   role     the person's role is lower than the route needs: 403.
 * With SHARE off nobody but the owner has a role, so every cell of the route-guard table is what it was when each route asked `requireUser` with `owns` (the owner's own row).
 */
export type PaperDoor = { signIn: string | Refusal; ack?: { title: string; detail: string }; missing: string };
export type Paper<R> = { user: SessionUser | null; row: R; access: DocAccess };

const NEEDS: Record<ShareRole, string> = {
  viewer: "You cannot open this paper",
  commenter: "Your access to this paper is to view it",
  editor: "Your access to this paper does not let you change it",
  owner: "Only the paper's owner can do this",
};

export async function requirePaper<R extends { id: string; user_id: string }>(c: Context<HonoEnv>, door: PaperDoor, need: ShareRole, load: (id: string) => Promise<R | null>): Promise<Paper<R> | Response> {
  const id = c.req.param("id") ?? "";
  // a visitor who holds the paper's link and is not signed in: the gate decides (a link gives at most Viewer to someone not signed in)
  const link = need === "owner" ? null : readLinkToken(c, id);
  const visitor = link !== null && (await shareSwitchedOn(c.env)) && !(await currentUser(c));
  let user: SessionUser | null = null;
  if (!visitor) {
    const got = await requireUser(c, { signIn: door.signIn, ...(door.ack ? { ack: door.ack } : {}) });
    if (got instanceof Response) return got;
    user = got.user;
  }
  const row = await load(id);
  const access = row ? await accessTo(c, row, user) : null;
  if (!row || !access) return refuse(c, { status: 404, type: "not_found", title: door.missing });
  if (!roleAtLeast(access.role, need)) return refuse(c, { status: 403, type: "forbidden", title: NEEDS[need] });
  return { user, row, access };
}
