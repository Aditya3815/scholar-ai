export type SearchEnv = {
  DB: D1Database;
  OPENALEX_API_KEY?: string;
  NCBI_API_KEY?: string;
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
