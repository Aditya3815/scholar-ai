export type HealthResponse = {
  ok: boolean;
  service: string;
  time: string;
  db: "ok" | "error";
};

export type Theme = "light" | "dark" | "read";

/** Ek deduplicated paper. Sab fields kisi API record se aate hain, LLM se kabhi nahi. */
export type Paper = {
  /** doi:<doi> | pmid:<pmid> | t:<hash>; stable dedup key */
  id: string;
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
  /** kaun si service ne retraction bataya, e.g. ["openalex", "crossref-retraction-watch"] */
  retractionSources: string[];
  /** kin providers ne ye paper diya */
  sources: string[];
  /** reciprocal-rank-fusion score */
  score: number;
};

export type ProviderStatus = {
  ok: boolean;
  count: number;
  ms: number;
  cached: boolean;
  error?: string;
};

export type SearchResponse = {
  query: string;
  results: Paper[];
  providers: Record<string, ProviderStatus>;
  retractionCheck: ProviderStatus;
  tookMs: number;
};
