/**
 * The kinds of a notice above a reply (docs/design/untangle.md, F4): the kinds the server sends, and the one the page makes itself (`unfinished`, R22: the reply before a follow-up did not finish),
 * kept apart so that what the server may send is a list of its own. The safety lane's four kinds are among the server's. Imports nothing.
 */
export const SAFETY_NOTICE_KINDS = ["safety_crisis", "safety_urgent", "safety_decision", "safety_care"] as const;
export type SafetyNoticeKind = (typeof SAFETY_NOTICE_KINDS)[number];

/** Every kind, in the order the reply state has always listed them. */
export const NOTICE_KINDS = ["partial", "nothing", "retracted", "years", "weak", "unfinished", "abstracts", ...SAFETY_NOTICE_KINDS] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
/** The page's own kind, never sent by the server. */
export const PAGE_NOTICE_KINDS = ["unfinished"] as const satisfies readonly NoticeKind[];
export type ServerNoticeKind = Exclude<NoticeKind, (typeof PAGE_NOTICE_KINDS)[number]>;
export const SERVER_NOTICE_KINDS = NOTICE_KINDS.filter((k): k is ServerNoticeKind => !(PAGE_NOTICE_KINDS as readonly string[]).includes(k));
