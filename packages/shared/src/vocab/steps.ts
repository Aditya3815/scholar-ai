/** The steps of a reply in the prompt box, in the order they happen (docs/design/untangle.md, F4). `route` and `general` are steps only when they really happened. Imports nothing. */
export const STEP_ORDER = ["route", "search", "read", "write", "check", "general"] as const;
export type ChatStep = (typeof STEP_ORDER)[number];
