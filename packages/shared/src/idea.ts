import type { Paper } from "./index";

/**
 * Idea Check, step M1: a researcher brings an idea (a file or a paragraph) and we find the papers closest to it.
 * The idea text itself stays in the browser and goes only to the private language model; what the literature services see is the
 * search plan below, which the researcher reads and edits before anything is sent.
 */

/** What the browser keeps from a file: more than this is cut. The language model reads the first IDEA_PLAN_INPUT_CHARS. */
export const MAX_IDEA_CHARS = 60_000;
export const IDEA_PLAN_INPUT_CHARS = 12_000;
export const MAX_IDEA_QUESTION_CHARS = 600;
export const MIN_IDEA_CHARS = 40;
/** OpenAlex's semantic search reads the first 2,000 characters of a query. */
export const MAX_SEMANTIC_QUERY_CHARS = 1500;
export const MAX_KEYWORD_QUERIES = 6;
export const MAX_KEYWORD_QUERY_CHARS = 100;
/** How many closest papers an Idea Check returns. */
export const IDEA_RESULTS = 30;

export type IdeaFacets = { purpose: string; mechanism: string; evaluation: string; domain: string };

/** The proposed search, shown to the researcher: everything a search service will receive is in `semanticQuery` and `keywordQueries`. */
export type IdeaPlan = {
  title: string;
  summary: string;
  facets: IdeaFacets;
  semanticQuery: string;
  keywordQueries: string[];
};

export type IdeaPlanRequest = { text: string; question?: string };

/** The (possibly edited) plan the researcher approved. */
export type IdeaSearchRequest = { semanticQuery: string; keywordQueries: string[] };

/** Where a record was found. */
export type IdeaSource = "openalex" | "s2" | "pubmed" | "arxiv";

/** What a record is. A "data" record (a dataset or software deposit) is hidden by default: it is not prior art the way a paper is. */
export type IdeaKind = "paper" | "preprint" | "book" | "thesis" | "report" | "data";

/** One search that was run, so the report can say exactly what was and was not searched. */
export type IdeaSearched = { source: IdeaSource; kind: "semantic" | "keyword"; query: string; ok: boolean; count: number; error?: string };

export type IdeaPaper = Paper & {
  kind: IdeaKind;
  /** Closeness of the paper's title and abstract to the idea's summary (cosine of embeddings, 0..1). For ordering, not shown as a percentage. */
  relevance: number;
  /** Which searches returned it, e.g. "OpenAlex (meaning)", "Semantic Scholar". */
  foundBy: string[];
};

export type IdeaSearchResult = {
  papers: IdeaPaper[];
  searched: IdeaSearched[];
  /** How many distinct papers the searches returned before the closest were kept. */
  considered: number;
  /** false = that check could not run (the papers are still shown, unchecked). */
  checked: { doi: boolean; retraction: boolean };
  tookMs: number;
};

export type IdeaSearchEvent =
  | { type: "stage"; stage: "searching" | "ranking" | "checking" }
  | { type: "papers"; papers: IdeaPaper[]; searched: IdeaSearched[] }
  | { type: "done"; result: IdeaSearchResult }
  | { type: "error"; code: string; title: string; detail?: string };

/* ---------------------------------------------------------------- M2: compare the closest papers with the idea */

/** The four parts an idea is described by. The researcher's wording is in the plan; a paper is compared with each part separately. */
export const FACET_KEYS = ["purpose", "mechanism", "evaluation", "domain"] as const;
export type FacetKey = (typeof FACET_KEYS)[number];
export const FACET_LABELS: Record<FacetKey, string> = { purpose: "Purpose", mechanism: "Method", evaluation: "Testing", domain: "Field" };

/** How many of the closest papers are compared (each costs the model about 600 tokens of reading). */
export const COMPARE_PAPERS = 8;
export const MAX_COMPARE_ABSTRACT_CHARS = 2000;
export const MAX_COMPARE_IDEA_CHARS = 3000;

/**
 * What one paper says about one part of the idea, judged by the model from the paper's abstract alone:
 *   same        the abstract does essentially what this part of the idea describes
 *   similar     close, but not the same (another method for the same goal, the same method in a neighbouring field, ...)
 *   different   the abstract is about something else for this part
 *   not_stated  the abstract does not say
 * `same` and `similar` count only with a quote from the abstract that was checked to be there; otherwise they are shown as `unverified`.
 */
export type FacetMatch = "same" | "similar" | "different" | "not_stated" | "unverified";

export type FacetEvidence = { match: FacetMatch; /** the sentence from the abstract, present for a verified same/similar */ quote: string | null };

/** How close a paper is overall, worked out from the VERIFIED parts only (never claimed by the model). */
export type PaperLevel = "close" | "partial" | "related" | "unrelated" | "no_abstract";

export type PaperComparison = { id: string; level: PaperLevel; facets: Record<FacetKey, FacetEvidence> };

export type CoverageStatus = "covered" | "similar" | "none" | "not_stated";
export type CoverageRow = {
  facet: FacetKey;
  status: CoverageStatus;
  papers: { id: string; match: "same" | "similar"; quote: string }[];
};

export type IdeaComparison = {
  comparisons: PaperComparison[];
  /** One row per part of the idea: which compared papers cover it, with the checked quote. */
  coverage: CoverageRow[];
  /** Papers that cover BOTH the method and the field (the combination an idea often rests on), by id. */
  combination: { found: string[]; compared: number } | null;
  compared: number;
  /** Claims that sounded like a match but whose quote was not in the abstract, so they were not shown as one. */
  droppedClaims: number;
  model: string;
};

export type IdeaCompareRequest = {
  title: string;
  summary: string;
  facets: IdeaFacets;
  question?: string;
  /** The start of the researcher's own text, for context (the model is private). */
  ideaExcerpt?: string;
  papers: { id: string; title: string; year: number | null; abstract: string }[];
};

export type IdeaCompareEvent =
  | { type: "stage"; stage: "reading" | "comparing" | "checking" }
  | { type: "done"; comparison: IdeaComparison }
  | { type: "error"; code: string; title: string; detail?: string };
