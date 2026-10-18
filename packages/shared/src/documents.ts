/** Uploaded papers and grounded Q&A: types and limits shared by the API and the web app. */

export const MAX_DOC_BYTES = 25 * 1024 * 1024;
export const MAX_DOC_PAGES = 500;
export const MAX_DOCS_PER_USER = 30;
export const MAX_TOTAL_DOC_BYTES = 300 * 1024 * 1024;
export const MAX_COVER_BYTES = 300 * 1024;
export const MAX_QUESTION_CHARS = 600;
/** One page-batch request: bounded so a request stays inside the Worker's CPU and subrequest limits. */
export const MAX_PAGES_PER_BATCH = 10;
export const MAX_CHARS_PER_BATCH = 150_000;

export type DocStatus = "uploaded" | "indexing" | "ready" | "failed";

export type DocumentInfo = {
  id: string;
  title: string;
  filename: string;
  sizeBytes: number;
  pages: number | null;
  status: DocStatus;
  error: string | null;
  hasCover: boolean;
  chunkCount: number;
  createdAt: number;
  updatedAt: number;
};

/** One passage that backs a statement in an answer. `quote` was checked against the stored text of that passage. */
export type Citation = { n: number; page: number; idx: number; quote: string };

export type Answer = {
  id: string;
  question: string;
  /** false = the paper does not contain the answer (the model said so, and nothing was invented). */
  found: boolean;
  /** Text with [n] markers; only markers whose passage was verified remain. */
  answer: string;
  /** true = every cited passage was found verbatim in the paper (or nothing is claimed). false = shown with a warning. */
  verified: boolean;
  citations: Citation[];
  createdAt: number;
  model?: string;
};

export type PageText = { page: number; text: string };
