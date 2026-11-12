import { cacheStore, type CacheEnv } from "../cache";
import type { SearchEnv } from "./types";
import type { Env } from "../platform/env";

/** What the search needs from the Worker's bindings (the Worker's own type, the Workflow's and the tests' all have these). */
export type SearchBindings = CacheEnv & Pick<Env, "S2_THROTTLE" | "CROSSREF_MAILTO" | "OPENALEX_API_KEY" | "NCBI_API_KEY" | "S2_API_KEY" | "CORE_API_KEY" | "SEARCH_PLAINTEXT">;

/** The search's environment from the bindings: the public cache, the keys, and the shared lane for Semantic Scholar. One place, so a new key or source is added once. */
export const searchEnvFrom = (env: SearchBindings): SearchEnv => ({
  store: cacheStore(env),
  OPENALEX_API_KEY: env.OPENALEX_API_KEY,
  NCBI_API_KEY: env.NCBI_API_KEY,
  S2_API_KEY: env.S2_API_KEY,
  CORE_API_KEY: env.CORE_API_KEY,
  CROSSREF_MAILTO: env.CROSSREF_MAILTO,
  SEARCH_PLAINTEXT: env.SEARCH_PLAINTEXT,
  s2Gate: (maxWaitMs) => env.S2_THROTTLE.getByName("global").reserve(maxWaitMs),
});
