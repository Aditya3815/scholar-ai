/** "Report a problem": what the researcher can report, and what the admin page shows. */

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
  byModel: { provider: string; model: string; calls: number; failed: number; tokens: number }[];
  feedback: AdminFeedback[];
};
