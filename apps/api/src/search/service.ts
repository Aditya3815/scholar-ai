import { isSearchScope, type SearchResponse, type SearchScope } from "@scholar/shared";
import { MAX_QUERY_LENGTH, runSearch, type SearchHooks } from "./index";
import { searchEnvFrom, type SearchBindings } from "./env";

/**
 * The search as a service (docs/design: "service layer"): the web's /api/v1/search routes, the chat and the MCP tool `search_papers` all call these functions, never each other over HTTP.
 * What a request is checked against lives here once, so a search from Claude or ChatGPT is held to the same rules as one typed on the page.
 */

export type SearchInput = { q: string; limit: number; scope: SearchScope };

/** The most papers a search may ask for (the year filter of the prompt box asks for 40). */
export const MAX_SEARCH_LIMIT = 40;

export const INVALID_QUERY = {
  type: "invalid_query",
  title: "Invalid query",
  detail: `q must be 2-${MAX_QUERY_LENGTH} characters; scope, when given, is "all" or "india"`,
} as const;

/** Reads a search from named parameters (a query string): the words trimmed, the limit kept between 1 and 40 (20 when absent or not a number), an unknown scope refused rather than quietly widened. */
export function readSearch(query: (k: string) => string | undefined): { ok: true; input: SearchInput } | { ok: false } {
  const q = (query("q") ?? "").trim();
  const limit = Math.min(Math.max(Number(query("limit") ?? 20) || 20, 1), MAX_SEARCH_LIMIT);
  const rawScope = query("scope") ?? "all";
  if (q.length < 2 || q.length > MAX_QUERY_LENGTH || !isSearchScope(rawScope)) return { ok: false };
  return { ok: true, input: { q, limit, scope: rawScope } };
}

/** One search over the sources of its scope, with every DOI checked and retractions marked (src/search/index.ts). `hooks.onSnapshot` sees the list grow as each source answers. */
export const runSearchService = (env: SearchBindings, input: SearchInput, hooks: SearchHooks = {}): Promise<SearchResponse> =>
  runSearch(searchEnvFrom(env), input.q, input.limit, hooks, input.scope);

export const searchService = { read: readSearch, run: runSearchService };
