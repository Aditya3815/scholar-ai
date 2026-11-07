/**
 * The parts of the MCP server's OAuth that do not need the OAuth library (which imports the Workers runtime): the scopes, the props a grant carries, the deployment's address. Kept apart so that
 * the tools and their tests can use them without loading it.
 */

/** What a grant lets an app do. Phase 1 (search, reference and retraction checks) uses the first two; Phase 2 adds the library (get_library reads it, save_paper writes to it). */
export const SCOPES = {
  "papers:read": "Search scholarly papers and read their details",
  "references:verify": "Check references and look up retractions",
  "library:read": "See the papers saved in your Sodhsetu library",
  "library:write": "Save papers to your Sodhsetu library",
} as const;
export type Scope = keyof typeof SCOPES;
/** The scopes this release can grant. A request for another is shown as "not available yet" and left out of the grant. */
export const GRANTABLE: readonly Scope[] = ["papers:read", "references:verify", "library:read", "library:write"];
/**
 * What an app gets when it names no scope, and what the 401 challenge asks for first: Phase 1's two, as before the library tools. The library is granted only to an app that asks for it (by
 * name, or by the step-up challenge when it first calls get_library or save_paper), so a person sees "your library" on the consent page only when an app wants it.
 */
export const DEFAULT_SCOPES: readonly Scope[] = ["papers:read", "references:verify"];

/** The props kept, encrypted, with every token of a grant: who allowed it and the name of the app, for the counts (src/mcp/calls.ts). Nothing else. */
export type McpProps = { userId: string; client: string };

/** The public address of this deployment: PUBLIC_BASE_URL when set (production: https://sodhsetu.in), otherwise the address the request came to (a local run). */
export const baseUrlOf = (env: { PUBLIC_BASE_URL?: string }, request: Request): string => (env.PUBLIC_BASE_URL ?? new URL(request.url).origin).replace(/\/+$/, "");

/** The scopes to grant: what was asked for and can be granted; Phase 1's two (DEFAULT_SCOPES) when the app named none. */
export function grantedScopes(requested: string[]): Scope[] {
  const asked = requested.filter((s): s is Scope => (GRANTABLE as readonly string[]).includes(s));
  return requested.length === 0 ? [...DEFAULT_SCOPES] : asked;
}

