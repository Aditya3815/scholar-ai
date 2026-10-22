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

/** Server-sent events from POST /documents/:id/ask?stream=1, in this order (delta repeats; `error` replaces `answer`). */
export type AskStage = "retrieving" | "thinking" | "writing" | "checking";
export type AskStreamEvent =
  | { type: "stage"; stage: AskStage }
  /** pages of the passages the answer will be based on, known about half a second in */
  | { type: "sources"; pages: number[] }
  /** more of the answer text. Provisional: the final `answer` event is what has been verified. */
  | { type: "delta"; text: string }
  | { type: "answer"; answer: Answer }
  | { type: "error"; code: string; title: string; detail?: string };

/* ---------------------------------------------------------------- highlights and notes */

export const NOTE_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];
export const MAX_NOTES_PER_DOC = 500;
export const MAX_NOTE_CHARS = 2000;
export const MAX_NOTE_QUOTE_CHARS = 600;
export const MIN_NOTE_QUOTE_CHARS = 3;

/** A highlight (a quote with no note text) or a note (a quote with the researcher's own words), on one page of a paper. */
export type DocNote = { id: string; page: number; quote: string; note: string; color: NoteColor; createdAt: number; updatedAt: number };
