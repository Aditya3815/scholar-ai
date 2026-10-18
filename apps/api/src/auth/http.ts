import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE, userFromSession } from "./session";
import type { SessionUser } from "./users";

export const isHttps = (c: Context) => new URL(c.req.url).protocol === "https:";

/** On HTTPS the cookie uses the __Host- prefix (Secure, Path=/, no Domain); on http://localhost it is plain "sid". */
export const cookieOpts = (c: Context) => ({ prefix: isHttps(c) ? ("host" as const) : undefined });

export const readSession = (c: Context) => getCookie(c, SESSION_COOKIE, cookieOpts(c).prefix);

/** State-changing requests must come from our own pages (SameSite=Lax is the first line; this is the second). */
export function sameOrigin(c: Context): boolean {
  const origin = c.req.header("origin");
  if (origin) return origin === new URL(c.req.url).origin;
  const site = c.req.header("sec-fetch-site");
  return site === "same-origin" || site === "none";
}

// Any route's context works as long as its bindings include the D1 database (hence the loose Context type).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function currentUser(c: Context<any>): Promise<SessionUser | null> {
  return userFromSession((c.env as { DB: D1Database }).DB, readSession(c));
}
