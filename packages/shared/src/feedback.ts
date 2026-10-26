/** "Report a problem": what the researcher can report, and what the admin page shows. */
import type { JobStatus } from "./jobs";

export const FEEDBACK_KINDS = ["answer", "reference", "idea", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** The problems offered for each kind of thing; the server accepts only these. */
export const FEEDBACK_PROBLEMS: Record<FeedbackKind, { id: string; label: string }[]> = {
  answer: [
    { id: "wrong_answer", label: "The answer is wrong" },
    { id: "wrong_citation", label: "The cited passage does not support it" },
    { id: "missed", label: "The paper does cover this, but it said it does not" },
    { id: "other", label: "Something else" },
  ],
  reference: [
    { id: "wrong_verdict", label: "This reference is real, but it was not verified" },
    { id: "wrong_match", label: "It matched the wrong paper" },
    { id: "wrong_split", label: "The reference text was cut or joined wrongly" },
    { id: "other", label: "Something else" },
  ],
  idea: [
    { id: "missed_paper", label: "A paper I know of is missing" },
    { id: "irrelevant", label: "Many results are not related" },
    { id: "wrong_plan", label: "The search plan misunderstood my idea" },
    { id: "other", label: "Something else" },
  ],
  other: [{ id: "other", label: "Something else" }],
};

export const MAX_FEEDBACK_NOTE_CHARS = 1000;
/** A user can send this many reports a day. */
export const MAX_FEEDBACK_PER_DAY = 30;

/** What the browser sends. For `answer` the server reads the question and answer from the user's own record, so only the ids are sent. */
export type FeedbackRequest =
  | { kind: "answer"; problem: string; note?: string; docId: string; answerId: string }
  | { kind: "reference"; problem: string; note?: string; reference: string; status: string; reason?: string }
  | { kind: "idea"; problem: string; note?: string; semanticQuery?: string; keywordQueries?: string[] }
  | { kind: "other"; problem: string; note?: string };

export type AdminDay = { day: string; calls: number; failed: number; tokens: number; costCents: number };
export type AdminFeedback = { id: string; kind: FeedbackKind; problem: string; note: string | null; context: unknown; createdAt: string; user: string };
export type AdminOverview = {
  users: { total: number; newThisWeek: number };
  documents: { total: number; ready: number; failed: number };
  questions: number;
  usage: AdminDay[];
  byModel: { provider: string; model: string; calls: number; failed: number; tokens: number; costCents: number }[];
  /** The same last seven days by what the call was for (a document question, each Idea Check step ...), dearest first. */
  byFeature: { feature: string; calls: number; failed: number; tokensIn: number; tokensOut: number; costCents: number }[];
  /** Scanned pages read in the last seven days, and what they cost (Workers AI neurons at $0.011 per 1,000). */
  scans: { pages: number; neurons: number; costCents: number };
  /** The shared index of open-access papers (W4): how many are ready, being read, failed for now, or cannot be read, where the text came from, and why papers could not be read. Numbers only. */
  openAccess: { ready: number; working: number; failed: number; unreadable: number; bySource: { source: string; n: number }[]; reasons: { reason: string; n: number }[] };
  /** The public cache over the last seven days: for each source (search results of one provider, DOI checks, retraction checks, each kind of reference lookup) how often an answer was already kept. */
  cache: { source: string; hits: number; misses: number }[];
  feedback: AdminFeedback[];
  /** Scheduled jobs (the daily clean-up) and whether they ran on time. */
  jobs: JobStatus[];
};

/** GET /api/v1/admin/integrity: do the paper records and the stored files agree? Names are short paper ids only. */
export type IntegrityReport = {
  checkedAt: string;
  /** PDF and cover files under docs/ that were looked at. */
  files: number;
  documents: number;
  missingFiles: number;
  missingCovers: number;
  orphanFiles: number;
  /** Keys under docs/ that are not in the shape we write. Reported, never judged. */
  unrecognised: number;
  /** A few short paper ids for each problem, so it can be looked up. */
  samples: { missingFiles: string[]; missingCovers: string[]; orphanFiles: string[] };
  /** The file list was cut short (too many files). The missing and orphan counts are then not reliable and the page says so. */
  truncated: boolean;
  /** Files and records younger than this were not judged: an upload or a delete may still be in progress. */
  graceMinutes: number;
};
