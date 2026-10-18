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

export type IdeaSource = "openalex" | "s2";

/** One search that was run, so the report can say exactly what was and was not searched. */
export type IdeaSearched = { source: IdeaSource; kind: "semantic" | "keyword"; query: string; ok: boolean; count: number; error?: string };

export type IdeaPaper = Paper & {
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
