import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { SESSION_COOKIE } from "./session";

export const isHttps = (c: Context) => new URL(c.req.url).protocol === "https:";

/** On HTTPS the cookie uses the __Host- prefix (Secure, Path=/, no Domain); on http://localhost it is plain "sid". */
export const cookieOpts = (c: Context) => ({ prefix: isHttps(c) ? ("host" as const) : undefined });

export const readSession = (c: Context) => getCookie(c, SESSION_COOKIE, cookieOpts(c).prefix);
