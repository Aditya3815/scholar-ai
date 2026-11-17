import type { Context, MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";
import { deny } from "../../problem";
import type { ProblemType } from "@scholar/shared";
import type { Env } from "../env";

/** A refusal in words: what `deny` sends. */
export type Refusal = { status: 401 | 403 | 404; type: ProblemType; title: string; detail?: string };

export const refuse = (c: Context, r: Refusal) => deny(c, r.status, r.type, r.title, r.detail);

/** A request that changes something must come from our own pages (SameSite=Lax on the session cookie is the first line; this is the second). */
export function sameOrigin(c: Context): boolean {
  const origin = c.req.header("origin");
  if (origin) return origin === new URL(c.req.url).origin;
  const site = c.req.header("sec-fetch-site");
  return site === "same-origin" || site === "none";
}

export const CROSS_ORIGIN: Refusal = { status: 403, type: "forbidden", title: "Cross-origin request blocked" };

/** A route as Hono matched it: "METHOD /full/path/:param". */
export type RouteKey = `${string} /${string}`;

export type SameOriginRules = {
  /** Writes that are not checked, each with the reason (every other write is). */
  skip: Readonly<Record<RouteKey, string>>;
  /** Development routes: they answer 404 before anything else unless ENABLE_DEV_ROUTES is 1, and are checked after that. */
  devFirst: readonly RouteKey[];
  /** A router whose refusal is not the JSON problem, by the address it is mounted at. */
  refusals?: Readonly<Record<string, (c: Context) => Response>>;
};

const READS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Every request that is not a read, to a route that exists, must come from our own pages, unless the route is on the list of the ones that skip the check. A request that names no route
 * passes on to the 404 (a guard does not answer for a route that is not there). Mounted once for /api/* (app/mount.ts), so a new route is checked without a line of its own.
 */
export function sameOriginWrites(rules: SameOriginRules): MiddlewareHandler<{ Bindings: Pick<Env, "ENABLE_DEV_ROUTES"> }> {
  return async (c, next) => {
    if (READS.has(c.req.method)) return next();
    const route = matchedRoutes(c).find((r) => r.method === c.req.method);
    if (!route) return next();
    const key = `${route.method} ${route.path}` as RouteKey;
    if (key in rules.skip) return next();
    if (rules.devFirst.includes(key) && c.env.ENABLE_DEV_ROUTES !== "1") return next();
    if (sameOrigin(c)) return next();
    return rules.refusals?.[route.basePath]?.(c) ?? refuse(c, CROSS_ORIGIN);
  };
}
