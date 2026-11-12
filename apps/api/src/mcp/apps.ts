import { Hono } from "hono";
import type { ConnectedApp, ConnectedApps } from "@scholar/shared";
import { currentUser, sameOrigin } from "../auth/http";
import { deny } from "../problem";
import { mcpMode } from "./flag";
import { SCOPES, baseUrlOf } from "./scopes";
import type { Env, EnvPick, HonoEnv } from "../platform/env";

/** The OAuth library's helpers, loaded when a request needs them (the library imports the Workers runtime, which a unit test of the account code cannot load). */
const oauthApi = async (env: Pick<Env, "OAUTH_KV">, base: string) => (await import("./oauth")).oauthApi(env, base);

/**
 * Settings, "Connected apps" (docs "Sodhsetu understanding, follow-ups and MCP (design)", page 12): the AI apps a person allowed to use Sodhsetu for them, and a button that disconnects one (its
 * grant and every token of it are revoked at once, by the OAuth library). While the MCP server is off the list does not exist (404), so the page shows nothing about it.
 */

export const connectedAppsRoutes = new Hono<HonoEnv>();

connectedAppsRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

connectedAppsRoutes.get("/", async (c) => {
  const mode = await mcpMode(c.env);
  if (mode === "off") return deny(c, 404, "not_found", "Not found");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const api = await oauthApi(c.env, baseUrlOf(c.env, c.req.raw));
  const apps: ConnectedApp[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const r = await api.listUserGrants(user.id, cursor ? { cursor } : {});
    for (const g of r.items) {
      const meta = (g.metadata ?? {}) as { client?: unknown };
      apps.push({
        id: g.id,
        name: typeof meta.client === "string" && meta.client ? meta.client : "An app",
        scopes: g.scope.map((s) => (s in SCOPES ? SCOPES[s as keyof typeof SCOPES] : s)),
        connectedAt: new Date(g.createdAt * 1000).toISOString(),
      });
    }
    if (!r.cursor) break;
    cursor = r.cursor;
  }
  apps.sort((a, b) => b.connectedAt.localeCompare(a.connectedAt));
  return c.json({ mode, apps } satisfies ConnectedApps);
});

connectedAppsRoutes.delete("/:id", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  if ((await mcpMode(c.env)) === "off") return deny(c, 404, "not_found", "Not found");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in first");
  const id = c.req.param("id");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return deny(c, 400, "invalid_id", "Unknown app");
  // revokeGrant takes the account too, so one person can never disconnect another's app
  await (await oauthApi(c.env, baseUrlOf(c.env, c.req.raw))).revokeGrant(id, user.id);
  return c.json({ ok: true });
});

/** Every app an account connected, disconnected: when the account is erased (src/account/erase.ts). Works whatever the switch says; a namespace that cannot be read is reported to the caller. */
export async function revokeAllApps(env: EnvPick<"PUBLIC_BASE_URL", "OAUTH_KV">, userId: string): Promise<number> {
  if (!env.OAUTH_KV) return 0;
  const api = await oauthApi(env as Pick<Env, "OAUTH_KV">, (env.PUBLIC_BASE_URL ?? "https://sodhsetu.in").replace(/\/+$/, ""));
  let n = 0;
  for (let round = 0; round < 20; round++) {
    const r = await api.listUserGrants(userId);
    if (r.items.length === 0) break;
    for (const g of r.items) {
      await api.revokeGrant(g.id, userId);
      n++;
    }
  }
  return n;
}
