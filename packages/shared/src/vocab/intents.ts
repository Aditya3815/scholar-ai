/**
 * The intents of a message (docs/design/untangle.md, F4): what the Understand step reads a message as, what a turn of the ledger records and what an `understood` event says acted. One closed list.
 * Imports nothing.
 */
export const INTENTS = ["chat", "search", "refine_search", "ask_results", "ask_paper", "offer_tool", "clarify"] as const;
export type Intent = (typeof INTENTS)[number];
export const isIntent = (v: unknown): v is Intent => typeof v === "string" && (INTENTS as readonly string[]).includes(v);
