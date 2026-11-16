/**
 * What a reference check says (docs/design/untangle.md, F4): the verdicts, and for each the words, the tone and the bucket every view of a verdict shows (the Check references page, the reader's
 * citation cards, the chat's tool card, the feedback form). Each view adds its own icons. Imports nothing.
 */
export const REF_STATUSES = ["verified", "mismatch", "not_found", "unverifiable", "unparsed"] as const;
export type RefStatus = (typeof REF_STATUSES)[number];
export const isRefStatus = (v: unknown): v is RefStatus => typeof v === "string" && (REF_STATUSES as readonly string[]).includes(v);

/** The three buckets a scholar acts on. Status is always shown as icon + words, never colour alone. */
export type RefBucket = "verified" | "attention" | "unchecked";
export const REF_BUCKETS: { id: RefBucket; label: string }[] = [
  { id: "verified", label: "Verified" },
  { id: "attention", label: "Needs attention" },
  { id: "unchecked", label: "Could not check" },
];

export const NOT_FOUND_HELP =
  "This can mean the reference is wrong or made up. It can also mean the source is not in Crossref: books, theses, reports and many regional journals are not. Check it at the source before deciding.";

/** A verdict (or a check that failed: `error`) as every view says it. */
export const REF_STATUS_WORDS: Record<RefStatus | "error", { label: string; tone: "ok" | "danger" | "warn" | "muted"; bucket: RefBucket; help?: string }> = {
  verified: { label: "Verified", tone: "ok", bucket: "verified" },
  mismatch: { label: "Details don’t match", tone: "warn", bucket: "attention" },
  not_found: { label: "Not found", tone: "danger", bucket: "attention", help: NOT_FOUND_HELP },
  unverifiable: { label: "Could not verify", tone: "muted", bucket: "unchecked" },
  unparsed: { label: "Not a full reference", tone: "muted", bucket: "unchecked" },
  error: { label: "Check failed", tone: "muted", bucket: "unchecked" },
};
