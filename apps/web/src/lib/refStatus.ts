import { BadgeCheck, CircleHelp, FileQuestion, SearchX, TriangleAlert, type LucideIcon } from "lucide-react";
import type { RefStatus } from "@scholar/shared";
import type { VerifyItem } from "./verify";

/** The three buckets a scholar acts on. Status is always shown as icon + words, never colour alone. */
export type Bucket = "verified" | "attention" | "unchecked";

export const BUCKETS: { id: Bucket; label: string }[] = [
  { id: "verified", label: "Verified" },
  { id: "attention", label: "Needs attention" },
  { id: "unchecked", label: "Could not check" },
];

export const STATUS: Record<RefStatus | "error", { label: string; Icon: LucideIcon; tone: "ok" | "danger" | "warn" | "muted"; bucket: Bucket; help?: string }> = {
  verified: { label: "Verified", Icon: BadgeCheck, tone: "ok", bucket: "verified" },
  mismatch: { label: "Details don’t match", Icon: TriangleAlert, tone: "warn", bucket: "attention" },
  not_found: {
    label: "Not found",
    Icon: SearchX,
    tone: "danger",
    bucket: "attention",
    help: "This can mean the reference is wrong or made up. It can also mean the source is not in Crossref: books, theses, reports and many regional journals are not. Check it at the source before deciding.",
  },
  unverifiable: { label: "Could not verify", Icon: CircleHelp, tone: "muted", bucket: "unchecked" },
  unparsed: { label: "Not a full reference", Icon: FileQuestion, tone: "muted", bucket: "unchecked" },
  error: { label: "Check failed", Icon: CircleHelp, tone: "muted", bucket: "unchecked" },
};

export const statusOf = (it: VerifyItem) => (it.state === "done" && it.verdict ? STATUS[it.verdict.status] : STATUS.error);
export const bucketOf = (it: VerifyItem): Bucket | null => (it.state === "done" || it.state === "error" ? statusOf(it).bucket : null);

export function tally(items: VerifyItem[]) {
  const t = { verified: 0, attention: 0, unchecked: 0, pending: 0, retracted: 0 };
  for (const it of items) {
    const b = bucketOf(it);
    if (b) t[b]++;
    else t.pending++;
    if (it.verdict?.retracted) t.retracted++;
  }
  return t;
}
