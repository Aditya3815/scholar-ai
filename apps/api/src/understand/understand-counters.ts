import type { FollowUpIntent, Route } from "@scholar/shared";
import type { UnderstandDecision } from "./understand";
import type { UnderstandIntent } from "./understanding";

/**
 * What the Understand step is counted by, in shadow and when on (design of 6 Nov 2026, pages 9 and 13): names from a closed list, never a word of a message, a status line or a query. The same
 * rule as R3's input shape: a definition stays fixed once counting starts, and a changed definition gets a new name.
 *
 *   und_turn            every turn that reached the step (one per message: the sum of the source names below)
 *   und_src_*           who decided: a guard, the greeting list, the model, or the rules after a failure
 *   und_fb_*            why the rules decided (timeout, invalid JSON twice, every model down, no allowance, no model for this person)
 *   und_int_*           the intent that acts
 *   und_conf_*          the model's confidence band (high 0.75 and above, mid 0.45 to 0.75, low under 0.45): model readings only
 *   und_confirm         "Did you want this? Change" was shown prominently
 *   und_ms_*            how long the step took (model readings and fallbacks): under 500 ms, 1.2 s, 2.5 s, 5 s, and longer
 *   und_agree / und_disagree   shadow: the intent the old rules acted on, against Understand's (model readings only)
 *   und_fix_*           a check changed the model's reading (closed names of `Correction`)
 *   und_retry           the first reading was invalid and the model was asked once more
 *   und_chat_leak       a conversation reply was thrown away by the post-check (counted by the caller of writeChatReply)
 *   und_change          the person pressed Change on the reading (counted by the page's report, not here)
 */
export const UNDERSTAND_COUNTER_NAMES = [
  "und_turn",
  "und_src_guard", "und_src_greeting", "und_src_model", "und_src_fallback",
  "und_fb_timeout", "und_fb_invalid", "und_fb_down", "und_fb_quota", "und_fb_no_model",
  "und_int_chat", "und_int_search", "und_int_refine_search", "und_int_ask_results", "und_int_ask_paper", "und_int_offer_tool", "und_int_clarify",
  "und_conf_high", "und_conf_mid", "und_conf_low",
  "und_confirm",
  "und_ms_lt500", "und_ms_lt1200", "und_ms_lt2500", "und_ms_lt5000", "und_ms_ge5000",
  "und_agree", "und_disagree",
  "und_fix_years_dropped", "und_fix_india_dropped", "und_fix_language_rules", "und_fix_status_template", "und_fix_refers_to_dropped", "und_fix_that_paper_resolved",
  "und_fix_that_paper_clarify", "und_fix_no_results_to_ask", "und_fix_no_search_to_refine", "und_fix_low_confidence_clarify", "und_fix_chat_greeting_kept",
  "und_retry",
  "und_chat_leak",
  "und_change",
] as const;
export type UnderstandCounterName = (typeof UNDERSTAND_COUNTER_NAMES)[number];
/** Is this a name of the closed list? For a writer that takes names from elsewhere (the page's report of `und_change`). */
export const isUnderstandCounterName = (name: unknown): name is UnderstandCounterName => typeof name === "string" && (UNDERSTAND_COUNTER_NAMES as readonly string[]).includes(name);

/** What today's pipeline did with the same message, as an intent of the new list (for the shadow comparison). */
export type OldDecision = { smallTalk: true } | { smallTalk: false; route: Route; followUp?: FollowUpIntent | null };

export function oldIntentOf(old: OldDecision): UnderstandIntent {
  if (old.smallTalk) return "chat";
  if (old.followUp === "refine") return "refine_search";
  if (old.followUp === "same_papers") return "ask_results";
  switch (old.route.mode) {
    case "verify":
    case "idea":
      return "offer_tool";
    case "paper":
      return "ask_paper";
    default:
      return "search";
  }
}

const msName = (ms: number): UnderstandCounterName => (ms < 500 ? "und_ms_lt500" : ms < 1200 ? "und_ms_lt1200" : ms < 2500 ? "und_ms_lt2500" : ms < 5000 ? "und_ms_lt5000" : "und_ms_ge5000");

/**
 * The names one turn gives. A guard that refuses, routes to the safety lane or runs a tool chosen by hand is counted only as `und_turn` + `und_src_guard` (it never reached the step's reading).
 * Pure; never a piece of text in what it returns.
 */
export function understandCounters(d: UnderstandDecision, old?: OldDecision): UnderstandCounterName[] {
  const names: UnderstandCounterName[] = ["und_turn", `und_src_${d.source}`];
  if (d.fallback) names.push(`und_fb_${d.fallback.reason}`);
  if (d.understanding) names.push(`und_int_${d.understanding.intent}`);
  if (d.source === "model" && d.understanding) {
    const c = d.understanding.confidence;
    names.push(c >= 0.75 ? "und_conf_high" : c >= 0.45 ? "und_conf_mid" : "und_conf_low");
    if (old) names.push(oldIntentOf(old) === d.understanding.intent ? "und_agree" : "und_disagree");
  }
  if (d.confirm) names.push("und_confirm");
  if (d.source === "model" || d.source === "fallback") names.push(msName(d.ms));
  for (const f of d.corrections) names.push(`und_fix_${f}`);
  if (d.invalid.length > 0) names.push("und_retry");
  return [...new Set(names)];
}
