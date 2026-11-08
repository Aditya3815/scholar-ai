import { MAX_AUTO_CHARS, cleanAutoMessage, looksLikeReferenceList, type RouteMode } from "@scholar/shared";
import { isGreeting } from "./greeting";

/**
 * Stage 1 of a turn (design of 6 Nov 2026, page 3): the deterministic guards that run before any model, for everyone (a visitor too), free and always the same. They settle what is plain and
 * cheap to settle right; everything else goes to Understand. In order:
 *
 *   1. an empty or over-long message is refused (the size limits: 300 for a search chosen by hand is the route's own check; 20,000 for Auto here);
 *   2. the safety lane (R4), when the caller says it matched, comes before everything else;
 *   3. a tool chosen by hand is never overridden: Understand is skipped and that tool runs;
 *   4. a bare DOI or arXiv number is searched as written;
 *   5. a pasted reference list is offered to Check references (a card, never started);
 *   6. a greeting (with the normaliser) is answered as conversation without the Understand call;
 *   7. anything else goes to Understand, after the R11 scrub of e-mail addresses, links and phone numbers (`scrub`, a hook until R11 is on main).
 *
 * Pure: it never calls a model, reads the network or throws.
 */

const DOI = /^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?10\.\d{4,9}\/\S+$/i;
const ARXIV = /^(?:arxiv:\s*)?\d{4}\.\d{4,5}(?:v\d+)?$|^https?:\/\/arxiv\.org\/(?:abs|pdf)\/\S+$/i;

/**
 * R11 HOOK. R11 (leaving e-mail addresses, links and phone numbers out of what is searched) is being built on another branch and is NOT on main. Until it lands, the default is the identity; the
 * wiring step passes R11's `scrub` here, and the same function is applied to Understand's output queries (`scrubQueries`), as the design asks.
 */
export type Scrub = (text: string) => string;
export const NO_SCRUB: Scrub = (t) => t;

export type GuardInput = {
  /** The message as the person sent it. */
  text: string;
  /** "auto", or the tool the person chose by hand. */
  mode: "auto" | RouteMode;
  /** The safety lane matched (R4, computed by the caller under its own switch). */
  safety?: boolean;
  scrub?: Scrub;
};

export type GuardDecision =
  | { kind: "refuse"; reason: "empty_or_too_long" }
  | { kind: "safety" }
  | { kind: "chosen"; mode: RouteMode; text: string }
  | { kind: "identifier"; text: string }
  | { kind: "reference_list"; text: string }
  | { kind: "greeting"; text: string }
  | { kind: "understand"; text: string };

export function guards(input: GuardInput): GuardDecision {
  const text = cleanAutoMessage(input.text);
  if (text === null || text.length > MAX_AUTO_CHARS) return { kind: "refuse", reason: "empty_or_too_long" };
  if (input.safety) return { kind: "safety" };
  if (input.mode !== "auto") return { kind: "chosen", mode: input.mode, text };
  const oneLine = !text.includes("\n");
  if (oneLine && (DOI.test(text) || ARXIV.test(text))) return { kind: "identifier", text };
  if (looksLikeReferenceList(text)) return { kind: "reference_list", text };
  if (isGreeting(text)) return { kind: "greeting", text };
  return { kind: "understand", text: (input.scrub ?? NO_SCRUB)(text) };
}

/** The same scrub on what Understand proposes to search: a query that is empty after it is dropped. */
export function scrubQueries(queries: readonly string[], scrub: Scrub = NO_SCRUB): string[] {
  return queries.map((q) => scrub(q).replace(/\s+/g, " ").trim()).filter((q) => /[\p{L}\p{N}]/u.test(q));
}
