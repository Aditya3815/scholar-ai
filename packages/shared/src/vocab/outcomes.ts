/**
 * Every counted feature and its closed outcome names, with the labels /admin shows (docs/design/untangle.md, F4): data, not code. The Worker's counter (apps/api/src/outcomes.ts) writes a feature's
 * names through `OUTCOME_COUNTS`, the page's /admin reads its labels and its total from here, and nothing asks "which feature is this" with an `if`. The names and the labels are frozen data: a count's
 * definition stays fixed once counting starts, and a changed definition gets a new name. Imports nothing.
 */

/** The features whose endings are counted (apps/api/src/outcomes.ts writes them, one row a day per feature and name). */
export const OUTCOME_FEATURES = ["chat", "oa_ask", "oa_ask_abstract", "doc_ask", "litscan", "chat_input", "chat_understand", "reader_agent_explain", "reader_agent_critique", "reader_agent_notes"] as const;
export type OutcomeFeature = (typeof OUTCOME_FEATURES)[number];

/**
 * What a message that came with the turns before it (a follow-up, docs/design/chat-actions-context.md; whether or not a model had to read them) counts as, in the place of "answered" and
 * "not_grounded" (every other ending keeps its name):
 * `followup_answered` and `followup_not_grounded` say how the follow-ups went apart from the first messages; `followup_rewrite_failed` is a follow-up whose restatement did not pass the server's
 * checks and was searched as written (so /admin shows how often the model's reading is not used); `followup_context_ignored` is one that carried turns while the CHAT_CONTEXT switch was off. Counts
 * only, at most 40 characters each.
 */
export const FOLLOW_UP_OUTCOMES = {
  answered: "followup_answered",
  notGrounded: "followup_not_grounded",
  rewriteFailed: "followup_rewrite_failed",
  contextIgnored: "followup_context_ignored",
} as const;

/**
 * The two names of the follow-up failure policy (R5, docs/design/intent-and-state.md, 4.6), kept apart from the four above (those belong to the context release and are pinned as four). `followup_unread`
 * (CHAT_FAILPOLICY=on) is a follow-up whose router call FAILED: the papers were shown and no answer was written, so it is neither answered nor refused, and the headline of /admin
 * (`chatRefusalShare`) leaves it out on purpose. `followup_unread_shadow` (CHAT_FAILPOLICY=shadow) counts the same follow-ups while the answer is still written as before, so it is counted IN ADDITION to
 * how that answer ended (a message of it is in two rows). Counts only, at most 40 characters each.
 */
export const UNREAD_OUTCOMES = {
  unread: "followup_unread",
  shadow: "followup_unread_shadow",
} as const;

/**
 * The ending of the relevance floor (R9, docs/design/intent-and-state.md, 4.9), kept apart from the names above: a list in which no paper matched the words closely was not given to the writer. The reply says
 * `not_answered` (the page shows no answer), but `chatRefusalShare` counts `not_answered` as a question the papers could have answered and the model said they could not, and here no model was asked, so
 * the count has a name of its own and the headline of /admin does not move (the share leaves it out, as it leaves out `followup_unread`). Counts only, at most 40 characters.
 */
export const FLOOR_OUTCOMES = {
  skipped: "floor_skipped",
} as const;

/**
 * R3: what a message in the prompt box LOOKS like, as names from a closed list (apps/api/src/understand/input-shape.ts gives them, "R3 definition (frozen for the counter series)"; the route counts
 * the names of R4, R8 and R9 that are listed with them).
 */
export const INPUT_SHAPE_NAMES = [
  "frame", "frame_polite", "frame_all", "qty", "year", "neg", "order", "long", "first_person",
  "subj0", "subj1", "subj2_6", "subj7p", "id",
  "lane_urgent", "lane_crisis", "lane_decision", "lane_care", "lane_notsearch",
  "cue_paper", "cue_list", "cue_paste", "ask_acronym", "ask_broad", "spell_candidate", "scrub",
  "one_source", "tier_none", "tier_few", "anyway",
  // R4 (4.5): the help tier of the safety lane, and what the lane would have done while it is only being read (`would_*`: shadow, and the phrases that are not yet acted on at `core`). Counted by the route, not given by `inputShape`.
  "lane_help", "would_urgent", "would_crisis", "would_help", "would_decision", "would_care",
  // R8 (4.8): what the request-frame cleaner did to an Auto message (`clean_applied`: CHAT_CLEAN on) or would have done (`would_clean`: shadow). Counted by the route, not given by `inputShape`.
  "would_clean", "clean_applied",
  // R9 (4.9): what the relevance floor would have done to a list while it only reads it (`would_tier_*`: shadow, and the state that the `writer` position does not act on); `tier_none` and `tier_few` are what it did.
  // Counted by the route, not given by `inputShape`.
  "would_tier_none", "would_tier_few",
] as const;
export type InputShapeName = (typeof INPUT_SHAPE_NAMES)[number];
/** The four counts of subject words: exactly one of them is given to every text, so together they are the number of messages counted (and countOutcomes always keeps it, past the cap of names). */
export const SUBJECT_NAMES = ["subj0", "subj1", "subj2_6", "subj7p"] as const satisfies readonly InputShapeName[];

/**
 * What the Understand step is counted by (apps/api/src/understand/understand-counters.ts gives them, in shadow and when on): names from a closed list, never a word of a message.
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
  "und_fix_that_paper_clarify", "und_fix_no_results_to_ask", "und_fix_no_search_to_refine", "und_fix_low_confidence_clarify", "und_fix_chat_greeting_kept", "und_fix_language_switch",
  "und_retry",
  "und_chat_leak",
] as const;
export type UnderstandCounterName = (typeof UNDERSTAND_COUNTER_NAMES)[number];

/**
 * The Paper Reader's agents (docs/design/paper-reader.md, 9.3 and 23), one feature each (`reader_agent_<name>`; Ask is `doc_ask`, as it always was): how each ended, one count per use. Explain ends as
 * an answer does (OUTCOME_LABELS). A critique ends with points (each with a quote that checked out), with none because every point's quote failed the check, or with none written; a Note-taker's
 * draft ends made or empty. Names only, never any text.
 */
export const CRITIQUE_OUTCOMES = ["critique_points", "critique_all_dropped", "critique_none"] as const;
export const NOTES_OUTCOMES = ["notes_drafted", "notes_empty"] as const;

/* ---------------------------------------------------------------- the labels of /admin */

export const FEATURE_LABELS: Record<OutcomeFeature, string> = {
  chat: "Questions in the prompt box",
  oa_ask: "Ask this paper (from its text)",
  oa_ask_abstract: "Ask this paper (from its abstract only)",
  doc_ask: "Questions about papers people uploaded",
  litscan: "Literature scan (each sub-question of each scan)",
  chat_input: "What a first message in the prompt box looked like (a message can have several of these, and Share is of the messages counted; its words are never kept)",
  chat_understand: "The Understand step, in shadow or on (a message can have several of these, and Share is of the messages it read; its words are never kept)",
  reader_agent_explain: "Paper Reader: Explain (a selection or an idea, in plain words)",
  reader_agent_critique: "Paper Reader: Critique (weak points, each with a checked quote)",
  reader_agent_notes: "Paper Reader: Note-taker (a draft page from the highlights)",
};

export const AGENT_OUTCOME_LABELS: Record<(typeof CRITIQUE_OUTCOMES)[number] | (typeof NOTES_OUTCOMES)[number], string> = {
  critique_points: "Points shown, each with a quote that was found in the paper",
  critique_all_dropped: "The model wrote points, but no quote of theirs was found in the paper, so none was shown",
  critique_none: "The model named no weak point in the passages it read",
  notes_drafted: "A draft page was made from the highlights",
  notes_empty: "No draft could be made from the highlights",
};

/** M4/M5: the Understand step's counts (apps/api/src/understand/understand-counters.ts): who decided, the intent, the agreement with the rules in shadow, the time it took, why the rules took over. Names only. */
export const UNDERSTAND_LABELS: Record<UnderstandCounterName, string> = {
  und_turn: "Messages the step read (the share of every other row is of these)",
  und_src_guard: "Settled by a fixed check before any model (a DOI, a reference list, a tool chosen by hand)",
  und_src_greeting: "A greeting, answered without any model",
  und_src_model: "Read by the model",
  und_src_fallback: "The model could not be used, so the rules decided",
  und_fb_timeout: "The rules decided: the model did not answer in time",
  und_fb_invalid: "The rules decided: the model's reading was not valid twice",
  und_fb_down: "The rules decided: every model was down",
  und_fb_quota: "The rules decided: the day's AI allowance was used",
  und_fb_no_model: "The rules decided: no model for this person (a visitor past the day's cap)",
  und_int_chat: "Taken as conversation (no search)",
  und_int_search: "Taken as a new search",
  und_int_refine_search: "Taken as a change to the last search",
  und_int_ask_results: "Taken as a question about papers already in the chat",
  und_int_ask_paper: "Taken as a question about an uploaded paper",
  und_int_offer_tool: "Taken as work for another tool (offered as a card)",
  und_int_clarify: "Answered with one question back",
  und_conf_high: "The model was sure (0.75 or more)",
  und_conf_mid: "The model was fairly sure (0.45 to 0.75)",
  und_conf_low: "The model was unsure (under 0.45)",
  und_confirm: "Shown with “Did you want this?”",
  und_ms_lt500: "Took under half a second",
  und_ms_lt1200: "Took half a second to 1.2 seconds",
  und_ms_lt2500: "Took 1.2 to 2.5 seconds",
  und_ms_lt5000: "Took 2.5 to 5 seconds",
  und_ms_ge5000: "Took 5 seconds or more",
  und_agree: "Shadow: the model and the rules agreed on the intent",
  und_disagree: "Shadow: the model and the rules did not agree on the intent",
  und_fix_years_dropped: "A check dropped years the person did not say",
  und_fix_india_dropped: "A check dropped an Indian sources choice the person did not make",
  und_fix_language_rules: "A check corrected the language of the reply",
  und_fix_status_template: "A check replaced the model's status line with a fixed one",
  und_fix_refers_to_dropped: "A check dropped a pointer to a turn or paper that does not exist",
  und_fix_that_paper_resolved: "A check worked out which paper “that paper” meant",
  und_fix_that_paper_clarify: "A check asked which paper “that paper” meant",
  und_fix_no_results_to_ask: "A question about earlier papers with none in the chat: searched instead",
  und_fix_no_search_to_refine: "A change to a search with none in the chat: searched instead",
  und_fix_low_confidence_clarify: "Too unsure for a costly action: asked a question instead",
  und_fix_chat_greeting_kept: "The model asked a question about a greeting: answered as conversation",
  und_fix_language_switch: "Messages like “Hindi mein batao”: the last answer again in that language",
  und_retry: "The model was asked a second time after an invalid reading",
  und_chat_leak: "A conversation reply that cited something was thrown away, and the message searched",
};

export const OUTCOME_LABELS: Readonly<Record<string, string>> = {
  clarify: "Answered with one question back before searching (the Understand step)",
  answered: "Answered, every claim checked",
  not_in_paper: "The paper does not contain it (it said so)",
  unverified: "Found, but a quote did not check out (shown with a warning)",
  not_answered: "The papers do not answer it (it said so)",
  not_grounded: "The model wrote an answer that our own check then refused",
  no_abstracts: "Papers found, none with an abstract to read",
  nothing_found: "No papers were found for it",
  no_relevant: "Papers were found, none of them about it",
  too_slow: "The answer took too long and was stopped",
  quota: "The person's daily allowance was used",
  unavailable: "The AI service was unavailable",
  stopped: "Stopped by the person",
  routed: "Offered another tool",
  small_talk: "A greeting or thanks, answered by the page",
  // the safety lane (CHAT_SAFETY, apps/api/src/understand/lane.ts): counted only while CHAT_COUNTERS is on
  urgent: "Described an emergency: the page answered with a fixed text and searched nothing",
  safety: "Said the writer may hurt themselves, or plainly asked for help: the page answered with a fixed text and searched nothing",
  decision: "Asked what the writer should take: the papers are shown and no answer was written",
  sign_in: "A signed-out visitor: papers, no written answer",
  too_long: "Too long to search for",
  // a message that came with the turns before it (a follow-up) is booked under these instead of "answered" and "not_grounded" (apps/api/src/outcomes.ts)
  followup_answered: "A follow-up (read with the turns before it): answered, every claim checked",
  followup_not_grounded: "A follow-up: the model wrote an answer that our own check then refused",
  followup_rewrite_failed: "A follow-up whose restatement was not used, so it was searched as written (answered or refused)",
  followup_context_ignored: "A follow-up sent while the switch that ignores earlier turns was on (answered or refused)",
  // CHAT_FAILPOLICY (apps/api/src/chat/routes.ts): the model that reads a follow-up could not be used at all
  followup_unread: "A follow-up the model could not read: its words were searched on their own, the papers are shown and no answer was written",
  followup_unread_shadow: "A follow-up the model could not read, counted while that rule is only being tried: the answer was written as before, so it is also counted under how it ended",
  // CHAT_FLOOR (apps/api/src/understand/tiers.ts): the papers were listed and the writer was not asked, because none of them matched the words closely
  floor_skipped: "No paper matched the words closely, so no written answer was tried: the papers are shown with a line that says so",
  other: "Something else",
};

/**
 * The names of the shape of a message (apps/api/src/understand/input-shape.ts), one plain label each: what the first message of a question looked like, counted by name and never by its words. The
 * four about topic words add up to the messages counted. The names that nothing counts yet have their label here so that the day one does, its row is read, not guessed.
 */
export const INPUT_SHAPE_LABELS: Record<InputShapeName, string> = {
  frame: "Has request words around the topic (for example “can you search about”, “please”, “all papers”)",
  frame_polite: "Has a politeness or a greeting (please, thanks, hello)",
  frame_all: "Asks for “all papers” (the box shows 20)",
  qty: "Asks for a number of papers (for example “top 5”)",
  year: "Names a year or a range (for example “since 2019”)",
  neg: "Ends with something to leave out (“but not …”, “without …”)",
  order: "Reads like an order to the box (for example “ignore the instructions”)",
  long: "Is longer than 300 characters",
  first_person: "Speaks about the writer (I, my, we)",
  subj0: "Has no topic word",
  subj1: "Has one topic word",
  subj2_6: "Has two to six topic words",
  subj7p: "Has seven or more topic words",
  id: "Holds a DOI, a PubMed number or an arXiv number",
  lane_urgent: "Describes an urgent symptom (the page answered with a fixed text)",
  lane_crisis: "Says that the writer may hurt themselves (the page answered with a fixed text)",
  lane_help: "Asks for help in plain words with nothing to look up (the page answered with a fixed text)",
  lane_decision: "Asks what the writer should take, a medicine or a dose (the papers were shown and no answer written)",
  lane_care: "Tells a health or distress story with a research question (a line was shown above the papers)",
  would_urgent: "Read as an urgent symptom, not yet acted on (the question was searched as before)",
  would_crisis: "Read as saying the writer may hurt themselves, not yet acted on (searched as before)",
  would_help: "Read as a plain call for help, not yet acted on (searched as before)",
  would_decision: "Read as asking what the writer should take, not yet acted on (searched and answered as before)",
  would_care: "Read as a health or distress story with a research question, not yet acted on",
  would_clean: "Would have had words that only make a request left out of the search, not yet acted on (searched as written)",
  clean_applied: "Had words that only make a request left out of the search (the answer says what was left out)",
  would_tier_none: "No paper matched the words closely, not yet acted on (the list was shown and answered as before)",
  would_tier_few: "Only one or two papers matched the words closely, not yet acted on (the list was shown as before)",
  lane_notsearch: "Asks for something the box cannot do (writing, translating, the weather)",
  cue_paper: "Points at a paper (for example “this paper”)",
  cue_list: "Holds a list of references",
  cue_paste: "Is a long text that was pasted",
  ask_acronym: "Has an acronym that could mean two things",
  ask_broad: "Names a whole field with nothing narrower",
  spell_candidate: "Has a word that may be misspelt",
  scrub: "Holds an e-mail address, a web address or a phone number",
  one_source: "The papers found came from one source only",
  tier_none: "No paper matched the words closely",
  tier_few: "Only one or two papers matched the words closely",
  anyway: "A search sent by pressing a “… anyway” button, after the page took the message for something else",
};

/* ---------------------------------------------------------------- how each feature is counted */

/**
 * How a feature's names are written and read. `names`: the closed list a feature keeps to, whoever calls (a name outside it is not written, and one line says how many were left out); `one`: names of
 * which a message writes exactly one, written first so that the cap on names can never take it; `total`: the names whose counts add up to the messages counted (the Share column of /admin), or
 * every row when a message has one ending; `labels`: the words /admin shows for a name.
 */
export type OutcomeCount = { names?: readonly string[]; one?: readonly string[]; total?: readonly string[]; labels: Readonly<Record<string, string>> };

const ANSWER: OutcomeCount = { labels: OUTCOME_LABELS };
export const OUTCOME_COUNTS: Record<OutcomeFeature, OutcomeCount> = {
  chat: ANSWER,
  oa_ask: ANSWER,
  oa_ask_abstract: ANSWER,
  doc_ask: ANSWER,
  litscan: ANSWER,
  chat_input: { names: INPUT_SHAPE_NAMES, one: SUBJECT_NAMES, total: SUBJECT_NAMES, labels: INPUT_SHAPE_LABELS },
  chat_understand: { names: UNDERSTAND_COUNTER_NAMES, total: ["und_turn"], labels: UNDERSTAND_LABELS },
  reader_agent_explain: ANSWER,
  reader_agent_critique: { names: CRITIQUE_OUTCOMES, labels: AGENT_OUTCOME_LABELS },
  reader_agent_notes: { names: NOTES_OUTCOMES, labels: AGENT_OUTCOME_LABELS },
};
const countOf = (feature: string): OutcomeCount => OUTCOME_COUNTS[feature as OutcomeFeature] ?? ANSWER;

/** The words /admin shows for a feature (its own name when the list has no label for it). */
export const featureLabel = (feature: string): string => (FEATURE_LABELS as Record<string, string>)[feature] ?? feature;
/** The labels of a feature's names. */
export const outcomeLabels = (feature: string): Readonly<Record<string, string>> => countOf(feature).labels;

/**
 * What the Share column of /admin is a share of, for one feature. For the outcomes of an answer it is the sum of the rows (every question has one ending). For the shape of messages (`chat_input`) a
 * message has several names at once ("frame", "year", ...), so the sum of the rows is a message several times over and would make every share too small; the four subject counts add up to the messages
 * counted, and that is the total. 0 when there is no subject count yet (only `anyway` has been counted): the page then shows no share. Counts only; no text, no person.
 */
export function outcomeTotal(feature: string, rows: readonly { outcome: string; n: number }[]): number {
  const total = countOf(feature).total;
  return rows.reduce((sum, r) => (!total || total.includes(r.outcome) ? sum + r.n : sum), 0);
}

/**
 * How the prompt box's answers went, for the line at the top of /admin: of the questions that the papers could have answered (the model was asked), how many it answered and how many answers our own
 * check refused. A message that came with the turns before it is booked by the server under `followup_answered` and `followup_not_grounded` (src/outcomes.ts), and they count here exactly as
 * `answered` and `not_grounded` do: left out, the line would cover only the first message of every chat. `followup_rewrite_failed` and `followup_context_ignored` take both endings under one name, so how
 * many of those were refused cannot be said: they are counted apart (`unsplit`) and are not guessed into either number. Counts only; no text, no person.
 *
 * `followup_unread` (a follow-up whose router call failed: the papers were shown and NO answer was written, CHAT_FAILPOLICY=on) is in none of the three numbers on purpose: no model was asked to write an
 * answer, so it is not a question that the papers could have answered, and its ending is known, so it is not unsplit. `followup_unread_shadow` is a second count of messages already in another row (the
 * answer was written as before), so it is left out too. They are in the table below the line, by name.
 */
export function chatRefusalShare(rows: readonly { feature: string; outcome: string; n: number }[]): { attempted: number; refused: number; unsplit: number } {
  let attempted = 0;
  let refused = 0;
  let unsplit = 0;
  for (const r of rows) {
    if (r.feature !== "chat") continue;
    if (r.outcome === "not_grounded" || r.outcome === "followup_not_grounded") {
      attempted += r.n;
      refused += r.n;
    } else if (r.outcome === "answered" || r.outcome === "not_answered" || r.outcome === "followup_answered") attempted += r.n;
    else if (r.outcome === "followup_rewrite_failed" || r.outcome === "followup_context_ignored") unsplit += r.n;
  }
  return { attempted, refused, unsplit };
}
