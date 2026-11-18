import { BadgeCheck, CircleHelp, FileQuestion, SearchX, TriangleAlert, type LucideIcon } from "lucide-react";
import { REF_BUCKETS, REF_STATUS_WORDS, type RefBucket, type RefStatus } from "@scholar/shared";
import type { VerifyItem } from "./verify";

/** The three buckets a scholar acts on (shared vocab/references.ts). Status is always shown as icon + words, never colour alone. */
export type Bucket = RefBucket;
export const BUCKETS = REF_BUCKETS;

/** Every verdict's words, tone, bucket and help (shared vocab/references.ts), with the icon this page draws for it. */
const ICON: Record<RefStatus | "error", LucideIcon> = { verified: BadgeCheck, mismatch: TriangleAlert, not_found: SearchX, unverifiable: CircleHelp, unparsed: FileQuestion, error: CircleHelp };
export const STATUS = Object.fromEntries(Object.entries(REF_STATUS_WORDS).map(([k, w]) => [k, { ...w, Icon: ICON[k as RefStatus | "error"] }])) as Record<
  RefStatus | "error",
  (typeof REF_STATUS_WORDS)[RefStatus | "error"] & { Icon: LucideIcon }
>;

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
