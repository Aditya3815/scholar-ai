import type { CacheStore } from "../cache/store";
import type { Env } from "../platform/env";

export type SearchEnv = Pick<Env, "OPENALEX_API_KEY" | "NCBI_API_KEY" | "S2_API_KEY" | "CORE_API_KEY" | "CROSSREF_MAILTO" | "SEARCH_PLAINTEXT"> & {
  /** Where provider responses and retraction checks are cached (D1 in production, memory in tests). */
  store: CacheStore;
  /** Reserves a Semantic Scholar slot (1 req/s global). Resolves to ms to wait, or null if the queue is too long. Absent in tests/eval. */
  s2Gate?: (maxWaitMs: number) => Promise<number | null>;
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
  /** What kind of work the index says it is (OpenAlex: article, preprint, dataset, book-chapter, ...). Only some sources know. */
  workType?: string | null;
  /** The record's own page, for a record with no DOI or PMID to link to (a thesis on Shodhganga). Always http(s). */
  url?: string | null;
};

export type Provider = {
  name: string;
  search(q: string, limit: number, env: SearchEnv, signal: AbortSignal): Promise<ProviderPaper[]>;
};
