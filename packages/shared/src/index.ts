export type HealthResponse = {
  ok: boolean;
  service: string;
  time: string;
  db: "ok" | "error";
  /** Applied D1 migrations; 0 or missing means the schema is not what this build expects. */
  migrations?: number;
  /** Deployed Worker version id (Workers version metadata), absent locally. */
  version?: string;
};

export type Theme = "light" | "dark" | "read";

/** Signed-in user as returned by GET /api/v1/auth/me (never contains tokens). */
export type AuthUser = {
  id: string;
  name: string | null;
  email: string | null;
  orcid: string | null;
  avatarUrl: string | null;
  role: "scholar" | "professor" | "admin";
  providers: ("google" | "orcid")[];
  /** The privacy text this person has agreed to (see PRIVACY_VERSION), or null if they have not yet. */
  privacyAck: string | null;
};

export type AuthProviderInfo = { id: "google" | "orcid"; label: string };

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
  /** What kind of work the index says it is (article, preprint, dataset, ...), when one of the sources knows. */
  workType?: string | null;
  /** The record's own page, when it has no DOI or PMID to link to (a thesis on Shodhganga). Always http(s). */
  url?: string | null;
  /**
   * Result of the DOI check run on every search result: "verified" (registered with Crossref and the title agrees, or resolves
   * at doi.org), "unchecked" (could not be checked, kept), or "dropped_*" (the DOI did not exist or belonged to a different
   * record, so it was removed and `doi` is null).
   */
  doiStatus?: "verified" | "unchecked" | "dropped_unresolvable" | "dropped_conflict";
};

/**
 * A notice about a paper in someone's library: it was retracted after they saved it (found by the daily re-check, apps/api/src/library/retraction.ts).
 * Shown until they dismiss it or remove the paper.
 */
export type LibraryAlert = { paperId: string; title: string; kind: "retracted"; at: string };

export type ProviderStatus = {
  ok: boolean;
  count: number;
  ms: number;
  cached: boolean;
  error?: string;
};

/** Search providers: id (API ke status keys) aur UI label. */
export const PROVIDER_LABELS = {
  openalex: "OpenAlex",
  s2: "Semantic Scholar",
  crossref: "Crossref",
  pubmed: "PubMed",
  arxiv: "arXiv",
  "doaj-all": "DOAJ (open access journals)",
  doaj: "DOAJ (journals published in India)",
  shodhganga: "Shodhganga theses (listed by OpenAlex)",
  "openalex-india": "OpenAlex (authors at Indian institutions)",
} as const;

/** The sources of the regular search, in the order their answers are merged (apps/api/src/search/index.ts, SCOPES.all). */
export const REGULAR_SOURCES = ["openalex", "s2", "crossref", "pubmed", "doaj-all"] as const satisfies readonly (keyof typeof PROVIDER_LABELS)[];
/** Sources whose failure alone does not make a search "incomplete": a supplement that answers from a lane two requests a second for everyone. */
export const OPTIONAL_SOURCES: readonly string[] = ["doaj-all"];

/**
 * Where a search looks. "all": the regular sources. "india": only Indian sources, the reader's choice (spike R12, docs/design/india-sources.md): journals
 * published in India (DOAJ), theses on Shodhganga (as OpenAlex lists them) and papers with an author at an Indian institution (OpenAlex).
 */
export const SEARCH_SCOPES = ["all", "india"] as const;
export type SearchScope = (typeof SEARCH_SCOPES)[number];
export const isSearchScope = (v: unknown): v is SearchScope => typeof v === "string" && (SEARCH_SCOPES as readonly string[]).includes(v);
/** The words the screen uses for the Indian scope, in one place. */
export const INDIA_SCOPE_LABEL = "Indian sources";
export const INDIA_SCOPE_HELP = "Only journals published in India (DOAJ), theses on Shodhganga, and papers by authors at Indian institutions.";

/** SSE `snapshot` event payload: har provider ke baad merged results (retraction flags `done` mein aate hain). */
export type SearchSnapshot = {
  results: Paper[];
  providers: Record<string, ProviderStatus>;
  /** Other spellings that were searched too because the search as written found few papers (for example "SwinYolo" also as "Swin Yolo"). */
  alsoSearched?: string[];
};

export type SearchResponse = {
  query: string;
  results: Paper[];
  providers: Record<string, ProviderStatus>;
  /** `count` = DOIs removed because they do not exist or belong to another record. */
  doiCheck: ProviderStatus;
  retractionCheck: ProviderStatus;
  tookMs: number;
  alsoSearched?: string[];
  /** Present when the search was not the regular one (only "india" today). */
  scope?: SearchScope;
};
export * from "./references";
export * from "./documents";
export * from "./text";
export * from "./zoom";
export * from "./paperinfo";
export * from "./idea";
export * from "./idea-m3";
export * from "./ideafile";
export * from "./feedback";
export * from "./jobs";
export * from "./monitoring";
export * from "./legal";
export * from "./ocr";
export * from "./scan-info";
export * from "./sentences";
export * from "./ink";
export * from "./notes-md";
export * from "./quote-quads";
export * from "./palette";
export * from "./rive";
export * from "./ask-source";
export * from "./stream-shape";
export * from "./chat";
export * from "./chat-state";
export * from "./route";
export * from "./oa";
export * from "./litscan";
export * from "./litscan-review";
export * from "./docx";
export * from "./litscan-docx";
