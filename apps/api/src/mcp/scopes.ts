/**
 * The parts of the MCP server's OAuth that do not need the OAuth library (which imports the Workers runtime): the scopes, the props a grant carries, the deployment's address. Kept apart so that
 * the tools and their tests can use them without loading it.
 */

/** What a grant lets an app do. Phase 1 (search, reference and retraction checks) uses the first two; the library scopes are named now so that a later phase adds tools, not a new consent. */
export const SCOPES = {
  "papers:read": "Search scholarly papers and read their details",
  "references:verify": "Check references and look up retractions",
  "library:read": "See the papers saved in your Sodhsetu library",
  "library:write": "Save papers to your Sodhsetu library",
} as const;
export type Scope = keyof typeof SCOPES;
/** The scopes this release can grant. A request for another is shown as "not available yet" and left out of the grant. */
export const GRANTABLE: readonly Scope[] = ["papers:read", "references:verify"];

/** The props kept, encrypted, with every token of a grant: who allowed it and the name of the app, for the counts (src/mcp/calls.ts). Nothing else. */
export type McpProps = { userId: string; client: string };

/** The public address of this deployment: PUBLIC_BASE_URL when set (production: https://sodhsetu.in), otherwise the address the request came to (a local run). */
export const baseUrlOf = (env: { PUBLIC_BASE_URL?: string }, request: Request): string => (env.PUBLIC_BASE_URL ?? new URL(request.url).origin).replace(/\/+$/, "");

/** The scopes to grant: what was asked for and can be granted; all of Phase 1's when the app named none. */
export function grantedScopes(requested: string[]): Scope[] {
  const asked = requested.filter((s): s is Scope => (GRANTABLE as readonly string[]).includes(s));
  return requested.length === 0 ? [...GRANTABLE] : asked;
}

