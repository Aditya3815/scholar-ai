import type { CacheStore } from "../cache/store";

export type SearchEnv = {
  /** Where provider responses and retraction checks are cached (D1 in production, memory in tests). */
  store: CacheStore;
  OPENALEX_API_KEY?: string;
  NCBI_API_KEY?: string;
  S2_API_KEY?: string;
  CROSSREF_MAILTO: string;
};

/** Provider ka raw result; merge ke baad `Paper` banta hai. */
export type ProviderPaper = {
  doi: string | null;
  pmid: string | null;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  abstract: string | null;
  citationCount: number | null;
  oaUrl: string | null;
  retracted: boolean;
};

export type Provider = {
  name: string;
  search(q: string, limit: number, env: SearchEnv, signal: AbortSignal): Promise<ProviderPaper[]>;
};
