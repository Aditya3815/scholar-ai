import { flagOf, type FlagEnv } from "../understand/flags";

/**
 * The switch of the MCP server (docs "Sodhsetu understanding, follow-ups and MCP (design)", page 13): the Worker variable `MCP` is `off`, `beta` or `on`, and unset is off. It is read through the
 * same reader as the understanding flags (src/understand/flags.ts): a value that is not exactly one of the three is off, and the KV key `flag:MCP` can only lower it (`off` there shuts the server
 * within about a minute, without a deploy).
 *
 *   off   /mcp, the OAuth endpoints, the consent page and the "Connected apps" list answer as if they did not exist (404), and nothing else in the Worker changes.
 *   beta  the server runs for the accounts named in `MCP_BETA_USERS` (account ids, separated by commas or spaces) and for no one else: anyone else is told it is a closed beta.
 *   on    every signed-in account may connect an app.
 */
export type McpMode = "off" | "beta" | "on";
export type McpFlagEnv = FlagEnv & { MCP?: string; MCP_BETA_USERS?: string; OAUTH_KV?: KVNamespace };

/** Where the switch stands. Without the OAUTH_KV binding (a namespace of its own, which the owner creates: wrangler.jsonc) the server has nowhere to keep its grants, so it is off whatever MCP says. */
export async function mcpMode(env: McpFlagEnv | undefined): Promise<McpMode> {
  if (!env?.OAUTH_KV) return "off";
  const r = await flagOf(env, "MCP", { allowBeta: true });
  return r.position === "beta" || r.position === "on" ? r.position : "off";
}

/** The account ids of the beta, as the variable lists them (commas or white space between them). */
export const betaUsers = (env: McpFlagEnv | undefined): string[] => (env?.MCP_BETA_USERS ?? "").split(/[\s,]+/).filter(Boolean);

/** May this account use the MCP server in this position of the switch? */
export const mcpAllowedFor = (mode: McpMode, env: McpFlagEnv | undefined, userId: string): boolean => mode === "on" || (mode === "beta" && betaUsers(env).includes(userId));

/**
 * The paths the MCP server owns. Only these reach it; every other path of the Worker is served exactly as before. The Worker's static assets answer everything but /api/* unless wrangler.jsonc's
 * `run_worker_first` names a path, so these patterns are listed there too (and a test holds the two lists together).
 */
export const MCP_PATHS = ["/mcp", "/oauth/authorize", "/oauth/token", "/oauth/register", "/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"] as const;

export const isMcpPath = (pathname: string): boolean => (MCP_PATHS as readonly string[]).includes(pathname.replace(/\/+$/, "") || "/");
