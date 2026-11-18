/**
 * The safety lane's replies (docs/design/intent-and-state.md, 4.5; untangle F4): the reasons a reply of the lane ends with, and its notice kinds. Imports nothing.
 *  - every reason of the lane: never carried as context, never in the turn ledger, never counted as an answer's ending;
 *  - the two that leave no trace of the words on the device (`decision` shows papers, so its words may stay), and the two notice kinds that do the same for a search chosen by hand.
 */
export const LANE_REASONS = ["urgent", "safety", "decision"] as const;
export type LaneReason = (typeof LANE_REASONS)[number];
export const NO_TRACE_REASONS = ["urgent", "safety"] as const satisfies readonly LaneReason[];
/** (kinds of SAFETY_NOTICE_KINDS, vocab/notices.ts) */
export const NO_TRACE_NOTICES = ["safety_crisis", "safety_urgent"] as const;

export const isLaneReason = (r: unknown): r is LaneReason => typeof r === "string" && (LANE_REASONS as readonly string[]).includes(r);
export const isNoTraceReason = (r: unknown): boolean => typeof r === "string" && (NO_TRACE_REASONS as readonly string[]).includes(r);
export const isNoTraceNotice = (kind: unknown): boolean => typeof kind === "string" && (NO_TRACE_NOTICES as readonly string[]).includes(kind);
