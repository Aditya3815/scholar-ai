import { Hono } from "hono";
import type { Context } from "hono";
import { FOLLOWUP_UNREAD_NOTICE, FOLLOW_UP_TOKENS_ESTIMATE, MAX_CHAT_BODY_BYTES, MIN_SINCE_YEAR, NOTHING_NOTICE, PARTIAL_NOTICE, YEAR_FILTER_FEW, YEAR_FILTER_SEARCH_LIMIT, cleanAutoMessage, cleanChatMessage, detectLanguage, isSearchScope, isSmallTalk, languageWithContext, needsContext, offlineRoute, ruleRoute, slimForInterim, smallTalkReply, type ChatAnswer, type ChatCitation, type ChatContextInfo, type ChatEvent, type EarlierQuestion, type TightenResponse, type ChatNoAnswer, type Paper, type Route, type SearchResponse, type SearchScope, type SearchSnapshot } from "@scholar/shared";
import { currentUser, sameOrigin } from "../auth/http";
import type { Complete, StreamComplete } from "../docs/qa";
import { AllProvidersFailedError, NoRouteError, QuotaError, gatewayFromEnv } from "../llm";
import { DEFAULT_CONFIG } from "../llm/config";
import { d1Ledger } from "../llm/d1";
import { runSearch } from "../search";
import { sseStream } from "../sse";
import type { S2Throttle } from "../s2-throttle";
import { searchComplete } from "./complete";
import { answerFromResults, pickEvidencePapers, type Picked } from "./answer";
import { judgeAnswer, type JudgeReport } from "./support";
import { readTighten } from "./tighten";
import { answerGeneral } from "./general";
import { askedOf, contextInfo, ownQuestions, routeContextOf, routeFollowUp, routeMessage, routerCallFailed, type FollowUp, type RouterContext } from "./router";
import { errorKind, readEarlier, readHistory, stripInvisible, type ChatHistory, type Refusal } from "./history";
import { stubChatStream, stubJudgeStream, stubSearchFor, stubStrictStream } from "./stub";
import { stubRoute } from "./stub-route";
import { FOLLOW_UP_OUTCOMES, UNREAD_OUTCOMES, countOutcome, countOutcomes } from "../outcomes";
import { flagOf, type FlagPosition } from "../understand/flags";
import { NO_PLAN, planLane, safetyRead, type LanePlan } from "../understand/lane";
import { noticeText, replyText } from "../understand/lane-text";
import { inputShape } from "../understand/input-shape";
import { searchEnvFrom } from "../search/env";
import { deny } from "../problem";

type Bindings = {
  DB: D1Database;
  CACHE?: KVNamespace;
  AI?: Ai;
  S2_THROTTLE: DurableObjectNamespace<S2Throttle>;
  GEMINI_API_KEY?: string;
  CROSSREF_MAILTO: string;
  OPENALEX_API_KEY?: string;
  NCBI_API_KEY?: string;
  S2_API_KEY?: string;
  CORE_API_KEY?: string;
  ENABLE_DEV_ROUTES?: string;
  QA_STUB?: string;
  /** Development only (ENABLE_DEV_ROUTES): another Workers AI model for the private `qa` task, and how long a gpt-oss model thinks. */
  LLM_QA_MODEL?: string;
  LLM_VERIFY_MODEL?: string;
  LLM_REASONING?: string;
  /** "off" switches the support judge off (answers are then shown as the old check leaves them): a Worker variable, for a day when its model is down or its cost must stop. */
  CHAT_JUDGE?: string;
  /** "off" makes the chat ignore the earlier messages of a conversation altogether (`history` and `earlier` are neither read nor refused), as it was before there were any: a Worker variable, a rollback that needs no new code. */
  CHAT_CONTEXT?: string;
  /**
   * R3 (docs/design/intent-and-state.md, 4.4): "on" counts what a message in the prompt box looked like, by closed names and never any of its text (feature `chat_input`). Unset, "off" and "shadow" count
   * nothing: a counter that counts is its own shadow, and nothing new may be stored before the privacy page says so. A gate flag: unset is off (understand/flags.ts).
   */
  CHAT_COUNTERS?: string;
  /**
   * R5 (4.6): "on" gives a follow-up whose router call FAILED the papers and no written answer, with a plain line; "shadow" only counts `followup_unread_shadow`; unset and "off" change nothing.
   * A gate flag: unset is off.
   */
  CHAT_FAILPOLICY?: string;
  /**
   * R4 (4.5): the safety lane. Four positions. Unset, "off" or a value that is not one of them: nothing is read. "shadow": every Auto message is read and only counted (`would_*`, and only with CHAT_COUNTERS "on"), nothing
   * on the wire changes. "core": the unmistakable phrases of an emergency, self-harm and a plain call for help are answered by the page with a fixed text and no search, no router and no model; a search chosen by hand
   * gets a line. "on": every tier. The numbers in the sentences are checked by a person first (lane-text.ts HELPLINE_CHECKED), and a test fails if the committed wrangler.jsonc sets this above "shadow" until they are.
   */
  CHAT_SAFETY?: string;
};
type Env = { Bindings: Bindings };
export const chatRoutes = new Hono<Env>();

chatRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

const stubbed = (env: Bindings) => env.ENABLE_DEV_ROUTES === "1" && env.QA_STUB === "1";

/**
 * Where a gate flag of the understanding releases stands for this request (understand/flags.ts: unset is off, and an off flag reads nothing from KV). A value that is not exactly a position is off, and
 * one line says WHICH FLAG held it (a constant name, never anything of a message): a typo must not turn behaviour on, and must not pass unseen either.
 */
async function gate(env: Bindings, name: "CHAT_COUNTERS" | "CHAT_FAILPOLICY" | "CHAT_SAFETY"): Promise<FlagPosition> {
  // the safety lane is the one flag with a fourth position, `core`, between shadow and on
  const r = await flagOf(env, name, { allowCore: name === "CHAT_SAFETY" });
  if (r.badVariable) console.warn(JSON.stringify({ level: "warn", msg: "flag_bad_value", flag: name }));
  return r.position;
}

/** How the judge did on one answer, for the logs: counts and times only, never a word of the question, the answer or an abstract. */
const logJudged = (r: JudgeReport) =>
  console.log(JSON.stringify({ level: r.error ? "warn" : "info", msg: "chat_judge", ms: r.ms, model: r.model, ...r.counts, leftOut: r.leftOut, rewritten: r.rewritten ?? 0, offered: r.rewrites?.length ?? 0, ...(r.checkMs === undefined ? {} : { checkMs: r.checkMs }), ...(r.error ? { error: r.error } : {}) }));

/** The model, for the person's own message: PRIVATE, so the gateway only uses providers that do not keep or train on it. `abort` stops it when the reader presses Stop or leaves. */
function streamFor(env: Bindings, subject: string, abort: AbortSignal): StreamComplete {
  if (stubbed(env)) return stubChatStream;
  const gateway = gatewayFromEnv(env);
  return async (req, hooks) => {
    const r = await gateway.stream({ task: "qa", sensitivity: "private", subject, system: req.system, user: req.user, schema: req.schema, maxTokens: req.maxTokens, timeoutMs: 60_000, label: req.label }, hooks, abort);
    return { json: r.json, model: r.model };
  };
}

/**
 * The support judge's model (chat/support.ts): the answer to the person's own question, so PRIVATE. Shorter timeout than the answer's: a judge that takes longer is not waited for
 * (the answer is then shown as written and says it was not checked).
 */
function judgeStreamFor(env: Bindings, subject: string, abort: AbortSignal, timeoutMs = 20_000): StreamComplete {
  if (stubbed(env)) return stubJudgeStream(env);
  const gateway = gatewayFromEnv(env);
  return async (req, hooks) => {
    const r = await gateway.stream({ task: "verify", sensitivity: "private", subject, system: req.system, user: req.user, schema: req.schema, maxTokens: req.maxTokens, timeoutMs, label: req.label }, hooks, abort);
    return { json: r.json, model: r.model };
  };
}

/**
 * The router's model: the person's own free text, so PRIVATE (the gateway only uses providers that do not keep or train on it). `onUsage` hears what a call cost, for the development route that
 * measures a follow-up (scripts/router-eval.mjs); the stream never uses it.
 */
function routeCompleteFor(env: Bindings, subject: string, onUsage?: (u: { tokensIn?: number | null; tokensOut?: number | null }) => void): Complete {
  if (stubbed(env)) return stubRoute;
  const gateway = gatewayFromEnv(env);
  return async (req) => {
    const r = await gateway.complete({ task: "classify", sensitivity: "private", subject, system: req.system, user: req.user, schema: req.schema, maxTokens: req.maxTokens, timeoutMs: 30_000, label: req.label });
    onUsage?.({ tokensIn: r.tokensIn, tokensOut: r.tokensOut });
    return { json: r.json, model: r.model };
  };
}

/**
 * The JSON body of a chat request, with a limit on its size (`MAX_CHAT_BODY_BYTES`): refused by its Content-Length where it has one (as Idea Check and the literature scan do), and by counting the
 * bytes as they arrive where it has not, since a chunked body has no length and a length can be a lie. A body that is not JSON is `null`, as before.
 */
async function readChatBody(c: Context): Promise<{ tooLarge: true } | { tooLarge: false; body: unknown }> {
  if (Number(c.req.header("content-length") ?? 0) > MAX_CHAT_BODY_BYTES) return { tooLarge: true };
  const reader = c.req.raw.body?.getReader();
  if (!reader) return { tooLarge: false, body: null };
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_CHAT_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return { tooLarge: true };
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.byteLength;
  }
  try {
    return { tooLarge: false, body: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { tooLarge: false, body: null };
  }
}

/** Is enough of the day's allowance left for a follow-up that a model reads with the earlier turns? Not being able to tell is not a reason to refuse. */
async function canAfford(db: D1Database, subject: string): Promise<boolean> {
  try {
    return DEFAULT_CONFIG.dailyTokenQuota - (await d1Ledger(db).tokensToday(subject)) >= FOLLOW_UP_TOKENS_ESTIMATE;
  } catch {
    return true;
  }
}

/** "2020 or later", "2015 or earlier", "2019", "2018 to 2020": a year range in words, for the line that says how many papers it left. */
const rangeWords = (from?: number, to?: number): string => (from !== undefined && to !== undefined ? (from === to ? `${from}` : `${from} to ${to}`) : from !== undefined ? `${from} or later` : `${to} or earlier`);

type YearRange = { from?: number; to?: number };

/**
 * `sinceYear` of a request (docs/design/chatview-and-trending.md, T9): the year a Trending chip says "from this year on" about. The year itself when it is a whole number from `MIN_SINCE_YEAR` to
 * `thisYear`, `undefined` when the request has none, `null` for anything else (a string, a fraction, `null`, a year out of range): that is a 400, nothing is repaired.
 */
function readSinceYear(raw: unknown, thisYear: number): number | undefined | null {
  if (raw === undefined) return undefined;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= MIN_SINCE_YEAR && raw <= thisYear ? raw : null;
}

/**
 * The year range the papers are cut to: the router's own (a follow-up's "only after 2020") and the chip's `sinceYear` as one. The larger of the two starts; the router's end stays as it is. A chip that
 * starts after the end the person's own words asked for ("papers before 2015") cannot be met together with it: the person's words win and the chip is dropped, so that the range that is shown is the range
 * that was applied and is never one that holds no paper at all. Without a chip it is the router's range exactly as it was.
 */
function withSince(own: YearRange | null, since: number | undefined): YearRange | null {
  if (since === undefined) return own;
  if (!own) return { from: since };
  if (own.to !== undefined && since > own.to) return own;
  return { from: Math.max(own.from ?? since, since), to: own.to };
}


/**
 * One message, one stream. `mode: "search"` is the reader's own choice (the words are searched as written); `mode: "auto"` lets the router choose the tool (router.ts). For a
 * search: the papers (the first as soon as one source has answered, the list again as each source does), a plain line if a source did not answer, and for a signed-in person a
 * short answer made from the papers with every claim tied to a sentence of an abstract (answer.ts). For any other tool the stream says what was understood and ends: the tools
 * open on their own pages, and Idea Check never starts without a click. The server keeps no chat.
 */
chatRoutes.post("/", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const read = await readChatBody(c);
  if (read.tooLarge) return deny(c, 413, "too_large", "That is too much text", "Send a shorter message.");
  const body = read.body as { mode?: unknown; message?: unknown; scope?: unknown; anyway?: unknown; history?: unknown; earlier?: unknown; sinceYear?: unknown } | null;
  if (!body || (body.mode !== "search" && body.mode !== "auto")) return deny(c, 400, "invalid_mode", "That mode is not available");
  // where a search looks: the regular sources, or only Indian ones when the reader turned that on (an unknown value is refused, not quietly widened)
  if (body.scope !== undefined && !isSearchScope(body.scope)) return deny(c, 400, "invalid_scope", "That search scope is not available");
  const scope: SearchScope = isSearchScope(body.scope) ? body.scope : "all";
  // "Search for it anyway": the reader says the words are to be searched as written, whatever they look like (only a search chosen by hand can carry it)
  if (body.anyway !== undefined && (body.anyway !== true || body.mode !== "search")) return deny(c, 400, "invalid_flag", "That option is not available");
  const anyway = body.anyway === true;
  // `sinceYear`: a Trending chip's "from this year on" (T9). Allowed in Auto and in a search by hand (it is a filter on the papers, not words and not context, so it is neither refused with "anyway" nor
  // ignored while CHAT_CONTEXT is "off"); applied below like the router's year filter. A request without it is what it always was.
  const thisYear = new Date().getUTCFullYear();
  const sinceYear = readSinceYear(body.sinceYear, thisYear);
  if (sinceYear === null) return deny(c, 400, "invalid_since_year", "That year is not available", `sinceYear must be a whole year from ${MIN_SINCE_YEAR} to ${thisYear}.`);
  const auto = body.mode === "auto";
  // The earlier turns of the conversation (docs/design/chat-actions-context.md): for Auto only (a search chosen by hand is searched as written, so it refuses them as it refuses `anyway`), checked here
  // whoever sends them, read by a model only for a signed-in person, and not even looked at while CHAT_CONTEXT is "off" (a server that did not know the field would ignore it).
  const contextOn = c.env.CHAT_CONTEXT !== "off";
  const carries = (body.history !== undefined && body.history !== null) || (body.earlier !== undefined && body.earlier !== null);
  if (carries && contextOn && !auto) return deny(c, 400, "invalid_flag", "That option is not available");
  let history: ChatHistory | null = null;
  let earlier: EarlierQuestion[] = [];
  if (carries && contextOn) {
    const h = readHistory(body.history);
    const e = readEarlier(body.earlier);
    const refusal: Refusal | null = !h.ok ? h : !e.ok ? e : null;
    if (refusal) {
      // a count, so that abuse shows in the logs; never a word of what was sent
      console.warn(JSON.stringify({ level: "warn", msg: "chat_history_refused" }));
      return deny(c, 400, "invalid_history", "The earlier messages could not be used", refusal.detail);
    }
    if (h.ok && e.ok) {
      history = h.history;
      earlier = e.earlier;
    }
  }
  const cleaned = auto ? cleanAutoMessage(body.message) : cleanChatMessage(body.message);
  if (!cleaned) return deny(c, 400, "invalid_message", auto ? "Write something, at most 20,000 characters" : "Write 2 to 300 characters");
  const user = await currentUser(c);
  const ctx: RouterContext | null = auto && user && history && (history.turns > 0 || earlier.length > 0) ? { history, earlier } : null;
  // read with turns before it, the message loses its invisible characters too (they hide an instruction from a person's eyes and not from a model's)
  const text = ctx ? cleanAutoMessage(stripInvisible(cleaned)) : cleaned;
  if (!text) return deny(c, 400, "invalid_message", "Write something, at most 20,000 characters");
  const ignored = carries && !contextOn;
  const started = Date.now();

  const abort = new AbortController();
  return sseStream<ChatEvent>(c, { terminal: ["done", "error"], fallback: { type: "error", code: "internal_error", title: "Something went wrong" }, abort }, async (s) => {
    const send = s.send;
    // how this question went is counted once, as it ends (counts only, src/outcomes.ts): what the papers did, or what stopped it
    let outcome: string | null = null;
    // what the router made of a message that was read with turns before it (null for any other message)
    let follow: FollowUp | null = null;
    // the day cannot pay for a model to read the earlier turns: the message is searched as written and no answer is written
    let poor = false;
    // R3: whether exactly one provider contributed a paper to the list (known only once the search has answered)
    let oneSource = false;
    // R5: where the follow-up failure policy stands for this message; read only when the router call failed, and "off" for every other message
    let failPolicy: FlagPosition = "off";
    // R4 (4.5): what the safety lane does for this message (nothing, while its flag is off), and which of the two care lines it would show
    let lane: LanePlan = NO_PLAN;
    let careKind: "health" | "distress" | null = null;
    /**
     * R3 (docs/design/intent-and-state.md, 4.4), once, as the message ends whatever the ending (so also a message that was left, or one that failed): with CHAT_COUNTERS=on the SHAPE of an Auto message
     * that carries no earlier turns is counted by closed names, in one batch, with `one_source` once a list was found; a search chosen by hand counts only `anyway` when it carries it. Never any text of
     * the message, and never anything when the flag is not exactly "on": the flag is read here, at the end, so that no message waits for it. A failure is swallowed (and logged without a word by countOutcomes).
     */
    const countMessage = async () => {
      if (!anyway && !(auto && !carries)) return;
      try {
        if ((await gate(c.env, "CHAT_COUNTERS")) !== "on") return;
        await countOutcomes(c.env.DB, "chat_input", anyway ? ["anyway"] : [...lane.names, ...inputShape(text), ...(oneSource ? ["one_source"] : [])]);
      } catch {
        /* counting never gets in the way of an answer */
      }
    };
    const done = async (answered: boolean, reason?: ChatNoAnswer) => {
      const plain = outcome ?? (answered ? "answered" : (reason ?? "other"));
      // a message that carried turns is counted by name when it ends the way a question ends well or badly: as a follow-up, as one whose restatement was not used, or as one whose turns were ignored
      const counted =
        (ctx || ignored) && (plain === "answered" || plain === "not_grounded")
          ? ignored
            ? FOLLOW_UP_OUTCOMES.contextIgnored
            : follow?.fellBack
              ? FOLLOW_UP_OUTCOMES.rewriteFailed
              : plain === "answered"
                ? FOLLOW_UP_OUTCOMES.answered
                : FOLLOW_UP_OUTCOMES.notGrounded
          : plain;
      // the safety lane's own endings are a new name in a table that is kept: counted only when CHAT_COUNTERS is on, like every other count that is new (the privacy page says what is counted before that is switched on)
      if (reason !== "urgent" && reason !== "safety" && reason !== "decision") await countOutcome(c.env.DB, "chat", counted);
      else if ((await gate(c.env, "CHAT_COUNTERS")) === "on") await countOutcome(c.env.DB, "chat", counted);
      return send({ type: "done", answered, ...(reason ? { reason } : {}), tookMs: Date.now() - started });
    };
    /**
     * Background from general knowledge, when the papers did not answer (general.ts): a separate call, its own step, its own event, shown under a label on every screen.
     * If the allowance is used or the service is down it is simply not given: the plain line about the papers is already there. It is given the question alone (for a follow-up, the
     * standalone question) and never the earlier turns or an earlier answer.
     */
    const background = async (subject: string, language: Route["language"], question: string) => {
      if (s.gone) return;
      try {
        await send({ type: "step", step: "general" });
        const g = await answerGeneral({
          question,
          language,
          stream: streamFor(c.env, subject, abort.signal),
          emit: send,
          onRaw: c.env.ENABLE_DEV_ROUTES === "1" && !stubbed(c.env) && !ctx ? (raw) => console.log(JSON.stringify({ msg: "chat_general_debug", raw })) : undefined,
        });
        if (!s.gone) await send({ type: "general", kind: g.kind, text: g.text });
      } catch (e) {
        if (s.gone) return;
        if (!(e instanceof QuotaError || e instanceof NoRouteError || e instanceof AllProvidersFailedError)) throw e;
        await send({ type: "general", kind: "unsure", text: "" }); // clears any words that were already shown
      }
    };

    try {
      let route: Route;
      const shown = text.replace(/\s+/g, " ").slice(0, 300);
      // with turns before the message the rules know it (routeContextOf): after an answer only the social words are small talk, and only a message that stands alone is settled as a plain search
      const rctx = ctx ? routeContextOf(ctx) : undefined;
      // a greeting, thanks or "what can you do" is answered by the box itself: no router, no search, no model, the same for a visitor who is not signed in (unless the reader asked for the search anyway)
      // R4 (4.5): the safety lane reads the WHOLE message before anything else: before small talk (which answers "help me" with a greeting), before the router and before any search, so that a message that
      // describes an emergency, says the person may hurt themselves or plainly asks for help is answered by the page with a fixed text, no model and no search. Auto only; a search chosen by hand only gets a line
      // (below). Shadow reads every Auto message and only counts. A failure of the lane never stops a message.
      const safety = await gate(c.env, "CHAT_SAFETY");
      if (safety !== "off" && (auto || safety !== "shadow")) {
        try {
          const read = safetyRead(text);
          careKind = read.careKind;
          lane = planLane(read, safety, auto ? "auto" : "hand");
        } catch {
          lane = NO_PLAN;
        }
      }
      if (lane.reply) {
        const language = detectLanguage(text);
        await send({ type: "understood", mode: "search", query: shown, language, auto: true, how: "rules", confidence: 1 });
        await send({ type: "general", kind: "not_research", text: replyText(lane.reply, language) });
        return void (await done(false, lane.reply === "urgent" ? "urgent" : "safety"));
      }
      const talk = !anyway && isSmallTalk(text, rctx);
      if (auto && !talk) {
        // a model is about to read the turns: it is not started for a day that cannot pay for the answer that follows (the quota is checked before each call and is not atomic). The words are then searched as
        // written, as for a visitor (the search is free), and the papers are shown with no answer: the line the screen says for this ("the papers are below") is true, which it was not when nothing was done.
        if (ctx && user && needsContext(text) && !ruleRoute(text, rctx) && !(await canAfford(c.env.DB, user.id))) {
          poor = true;
          route = { ...offlineRoute(text), language: languageWithContext(text, ownQuestions(ctx)) };
        } else {
          // the rules settle most messages without a model; only when they cannot, a step says so while the model looks
          if (user && !ruleRoute(text, rctx)) await send({ type: "step", step: "route" });
          if (ctx) {
            const routed = await routeFollowUp(text, user ? routeCompleteFor(c.env, user.id) : null, ctx);
            route = routed.route;
            follow = routed.followUp;
          } else {
            route = await routeMessage(text, user ? routeCompleteFor(c.env, user.id) : null);
          }
        }
        if (s.gone) return;
      } else {
        route = { mode: "search", how: auto ? "rules" : "chosen", confidence: 1, language: ctx ? languageWithContext(text, ownQuestions(ctx)) : detectLanguage(text) };
      }
      // R5 (4.6): the policy is looked up only for a follow-up whose router call FAILED (router.ts, routerCallFailed): for every other message the flag is not even read
      if (routerCallFailed(follow)) failPolicy = await gate(c.env, "CHAT_FAILPOLICY");
      // a year range ("only after 2020", a Trending chip's `sinceYear`) is applied to the papers' own years before they are numbered, so that card numbers and marks stay true; the search asks for more, so that
      // what is left is not thin. It is the router's range and the chip's as one (`withSince`), and only a message that is searched has one: small talk and another tool's offer are not cut by anything.
      const own: YearRange | null = follow && (follow.yearFrom !== undefined || follow.yearTo !== undefined) ? { from: follow.yearFrom, to: follow.yearTo } : null;
      const years = route.mode === "search" && !talk ? withSince(own, sinceYear) : own;
      // what the page reads a year chip from is `context.yearFrom` and `yearTo`: the same fields whether the router or the chip gave the range, so that there is one chip for both. When the chip changed the
      // range, the context says the range that is applied (and a reading that fell back says nothing of its own then, since the page hides the whole of a context that did: the filter must not be hidden with it).
      const widened = years !== null && (years.from !== own?.from || years.to !== own?.to);
      let context: ChatContextInfo | undefined;
      if (follow && ctx) context = contextInfo(widened ? { ...follow, yearFrom: years.from, yearTo: years.to, fellBack: false } : follow, ctx);
      else if (widened) context = { turns: 0, intent: "new", rewrote: false, ...(years.from === undefined ? {} : { yearFrom: years.from }), ...(years.to === undefined ? {} : { yearTo: years.to }) };
      await send({ type: "understood", mode: route.mode, query: shown, language: route.language, auto, how: route.how, confidence: route.confidence, ...(route.searchQuery ? { searchQuery: route.searchQuery } : {}), ...(scope !== "all" && route.mode === "search" ? { scope } : {}), ...(context ? { context } : {}) });
      // counts and short names only: how many turns were read and what came of them, never a word of them
      if (follow && ctx) console.log(JSON.stringify({ level: "info", msg: "chat_followup", turns: ctx.history.turns, earlier: ctx.earlier.length, mode: route.mode, intent: follow.intent, rewrote: follow.rewrote, fellBack: follow.fellBack, check: follow.check, years: follow.yearFrom !== undefined || follow.yearTo !== undefined }));
      // R4: the lines of the lane go right after what the message was understood as, above the answer and the papers (a search chosen by hand gets only these)
      if (lane.notices.length > 0) {
        const language = detectLanguage(text);
        for (const kind of lane.notices) await send({ type: "notice", kind, text: noticeText(kind, language, { auto, careKind }) });
      }
      if (talk) {
        outcome = "small_talk";
        await send({ type: "general", kind: "not_research", text: smallTalkReply(text, route.language, rctx) });
        return void (await done(false, "small_talk"));
      }
      // another tool: nothing runs here; the browser offers to open it
      if (route.mode !== "search") return void (await done(false, "routed"));
      // what the indexes are asked: the model's English words, or the message as written (at most 300 characters)
      const query = route.searchQuery ?? text.replace(/\s+/g, " ");
      if (query.length > 300) return void (await done(false, "too_long"));

      // what the answer is for and in what language: the standalone question of a follow-up (the message as written for any other message, so that it is answered in the person's language),
      // and the language the person asked for ("in Hindi") before the one the rules found
      const asked = askedOf(follow, text.replace(/\s+/g, " ").slice(0, 600));
      const spoken = follow?.answerLanguage ?? route.language;
      const shape = (list: Paper[]): Paper[] => (years ? list.filter((p) => p.year !== null && (years.from === undefined || p.year >= years.from) && (years.to === undefined || p.year <= years.to)).slice(0, 20) : list);

      await send({ type: "step", step: "search" });
      // while the sources answer, each list carries only the start of the abstracts; the final one below carries all of them (slimForInterim)
      const interim = (r: SearchResponse | SearchSnapshot) => send({ type: "papers", results: slimForInterim(shape(r.results)), final: false });
      let found: SearchResponse;
      if (stubbed(c.env)) {
        if (/\bstalled\b/i.test(query)) await new Promise((r) => setTimeout(r, 3500)); // a silent wait, to see the keep-alive line and the "still working" hint
        found = stubSearchFor(query, scope);
        if (found.results.length > 0) await interim(found);
      } else {
        found = await runSearch(searchEnvFrom(c.env), query, years ? YEAR_FILTER_SEARCH_LIMIT : 20, { onSnapshot: interim }, scope);
      }
      if (s.gone) return;
      if (auto && !carries) oneSource = new Set(found.results.flatMap((p) => p.sources)).size === 1;
      const beforeYears = found.results.length;
      if (years) found = { ...found, results: shape(found.results) };
      await send({ type: "papers", results: found.results, final: true });
      const complete = searchComplete(found);
      if (!complete) await send({ type: "notice", kind: "partial", text: PARTIAL_NOTICE });
      // R5 (4.6): the router call failed, so the words were searched as they stand and nothing says what they refer to. With the policy on, the papers are all there is: no written answer, no judge, no
      // background, the reason not_answered, its own outcome name and one plain line. In shadow the same follow-ups are only counted, and everything below goes on as it did.
      const unread = failPolicy === "on";
      if (failPolicy === "shadow") await countOutcome(c.env.DB, "chat", UNREAD_OUTCOMES.shadow);
      const endUnread = async () => {
        await send({ type: "notice", kind: "weak", text: FOLLOWUP_UNREAD_NOTICE });
        outcome = UNREAD_OUTCOMES.unread;
        return done(false, "not_answered");
      };
      if (found.results.length === 0) {
        // a year range that took every paper away says so under its own kind (the browser must not take it for a source that did not answer); a search that found nothing at all is the ordinary notice
        await send(years && beforeYears > 0 ? { type: "notice", kind: "years", text: `No paper from ${rangeWords(years.from, years.to)} was found for this. Remove the year filter to see more.` } : { type: "notice", kind: "nothing", text: NOTHING_NOTICE });
        if (unread) return void (await endUnread());
        if (user && !lane.withhold) await background(user.id, spoken, asked);
        return void (await done(false, lane.withhold ? "decision" : undefined));
      }
      // a short list is said to be short, under the kind of its own: it is a different thing from a source that did not answer, and both are said
      if (years && found.results.length < YEAR_FILTER_FEW) await send({ type: "notice", kind: "years", text:`Only ${found.results.length} of the papers found ${found.results.length === 1 ? "is" : "are"} from ${rangeWords(years.from, years.to)}, so this list is short. Remove the year filter to see more.` });
      if (found.results.some((p) => p.retracted)) await send({ type: "notice", kind: "retracted", text: "At least one paper in this list has been retracted. It is marked, and it was not used for the answer." });
      if (unread) return void (await endUnread());
      // R4: a question about what the person should take: the papers of the topic are shown, and no answer is written (for a visitor too: signing in would not give one), and no background
      if (lane.withhold) return void (await done(false, "decision"));
      if (!user) return void (await done(false, "sign_in"));
      if (poor) return void (await done(false, "quota"));
      const picked = pickEvidencePapers(found.results);
      if (picked.length === 0) {
        await background(user.id, spoken, asked);
        return void (await done(false, "no_abstracts"));
      }

      await send({ type: "step", step: "read" });
      let answer;
      try {
        // the question the answer is for is what the person wrote (so it is answered in their language), not the English words the indexes were asked; for a follow-up it is the standalone question,
        // and for the same papers only, the earlier answer goes with it as context the writer is told is not evidence. The judge is given neither (it reads claims and the abstracts they cite).
        // The debug log of what a model said is for the first message in development; a follow-up never uses it.
        answer = await answerFromResults({ question: asked, language: spoken, languageAsked: !!follow?.answerLanguage, earlierAnswer: follow?.intent === "same_papers" ? (ctx?.history.lastAnswer ?? undefined) : undefined, picked, stream: streamFor(c.env, user.id, abort.signal), judge: c.env.CHAT_JUDGE === "off" ? undefined : judgeStreamFor(c.env, user.id, abort.signal), onJudged: logJudged, emit: send, onRaw: c.env.ENABLE_DEV_ROUTES === "1" && !ctx ? (raw) => console.log(JSON.stringify({ msg: "chat_debug", raw, shown: picked.map((p) => p.n) })) : undefined });
      } catch (e) {
        if (s.gone) return;
        if (e instanceof QuotaError) return void (await done(false, "quota"));
        if (e instanceof NoRouteError || e instanceof AllProvidersFailedError) {
          // only the kind of failure is logged, for every message: a provider's own error text can echo what it was sent, and the privacy text says no question reaches a log
          if (e instanceof AllProvidersFailedError) console.error(JSON.stringify({ level: "error", msg: "chat_failed", attempts: e.attempts.map((a) => `${a.provider}:${a.ok ? "ok" : errorKind(a.error)}`) }));
          return void (await done(false, "unavailable"));
        }
        throw e;
      }
      if (s.gone) return;
      // the judge's reading already said "check" (answerFromResults); an answer that was not judged says it now
      if (answer.checked === undefined) await send({ type: "step", step: "check" });
      await send({ type: "answer", answer: { text: answer.text, citations: answer.citations, grounded: answer.grounded, ...(answer.checked === undefined ? {} : { checked: answer.checked, leftOut: answer.leftOut ?? 0, rewritten: answer.rewritten ?? 0 }) } });
      // papers first: only when they do not answer, and the model itself says so (not when an answer was written and could not be checked), a labelled background follows
      if (!answer.grounded && !answer.enough) await background(user.id, spoken, asked);
      await done(answer.grounded, answer.grounded ? undefined : answer.enough ? "not_grounded" : "not_answered");
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "chat_stream_failed", error: e instanceof Error ? e.name : "unknown" }));
      await send({ type: "error", code: "internal_error", title: "Something went wrong" });
    } finally {
      await countMessage();
    }
  });
});

/**
 * Development only (ENABLE_DEV_ROUTES=1; the deployed Workers do not set it, so this is a plain 404 there): the router's choice for one message, with the real model and no
 * search, so `scripts/router-eval.mjs` can measure the router over a labelled list without spending the search sources. With `history` and/or `earlier` (as the stream reads them) it reads
 * the message as a follow-up would be read and answers with the route plus `followUp` (what the checks made of the model's reading: intent, standalone question, search words, years, and the
 * reason if they did not pass) and `usage` (what the calls cost), so that `--followup` can score them. Without them the answer is the route and nothing more, as it always was.
 */
chatRoutes.post("/route", async (c) => {
  if (c.env.ENABLE_DEV_ROUTES !== "1") return c.notFound();
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const read = await readChatBody(c);
  if (read.tooLarge) return deny(c, 413, "too_large", "That is too much text", "Send a shorter message.");
  const body = read.body as { message?: unknown; history?: unknown; earlier?: unknown } | null;
  const text = cleanAutoMessage(body?.message);
  if (!text) return deny(c, 400, "invalid_message", "Write something, at most 20,000 characters");
  const user = await currentUser(c);
  const carries = (body?.history !== undefined && body.history !== null) || (body?.earlier !== undefined && body.earlier !== null);
  if (!carries) return c.json(await routeMessage(text, user ? routeCompleteFor(c.env, user.id) : null));
  const h = readHistory(body?.history);
  const e = readEarlier(body?.earlier);
  const refusal: Refusal | null = !h.ok ? h : !e.ok ? e : null;
  if (refusal || !h.ok || !e.ok) return deny(c, 400, "invalid_history", "The earlier messages could not be used", refusal?.detail);
  const usage = { calls: 0, tokensIn: 0, tokensOut: 0 };
  const complete = user
    ? routeCompleteFor(c.env, user.id, (u) => {
        usage.calls++;
        usage.tokensIn += u.tokensIn ?? 0;
        usage.tokensOut += u.tokensOut ?? 0;
      })
    : null;
  const routed = await routeFollowUp(cleanAutoMessage(stripInvisible(text)) ?? text, complete, { history: h.history, earlier: e.earlier });
  return c.json({ ...routed.route, followUp: routed.followUp, usage });
});

/**
 * Development only (ENABLE_DEV_ROUTES=1; a plain 404 in a deployed Worker): the support judge on one answer with the real model and no search, so `scripts/support-eval.mjs` can measure it
 * over a labelled list of claims (docs/design/claim-support.md). The body is the answer text and the papers it cites; `model` and `reasoning` try another Workers AI model for the call.
 */
chatRoutes.post("/judge", async (c) => {
  if (c.env.ENABLE_DEV_ROUTES !== "1") return c.notFound();
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 403, "forbidden", "Sign in first");
  const body = (await c.req.json().catch(() => null)) as { text?: unknown; papers?: unknown; model?: unknown; reasoning?: unknown; timeoutMs?: unknown; strict?: unknown; recheck?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.slice(0, 3000) : "";
  const list = Array.isArray(body?.papers) ? (body!.papers as { n?: unknown; title?: unknown; year?: unknown; abstract?: unknown }[]) : [];
  if (!text || list.length === 0 || list.length > 12) return deny(c, 400, "invalid_message", "text and 1 to 12 papers are needed");
  const picked: Picked[] = list.map((p) => ({
    n: Number(p.n),
    paper: { id: `dev:${Number(p.n)}`, doi: null, pmid: null, title: String(p.title ?? ""), authors: [], year: typeof p.year === "number" ? p.year : null, venue: null, abstract: typeof p.abstract === "string" ? p.abstract : null, citationCount: null, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 1 } as Paper,
  }));
  const marked = new Set([...text.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])));
  const cited = picked.filter((p) => (marked.size ? marked.has(p.n) : true));
  const citations: ChatCitation[] = cited.map((p) => ({ n: p.n, paperId: p.paper.id, sentenceNo: 1, sentence: "" }));
  const env = { ...c.env, LLM_VERIFY_MODEL: typeof body?.model === "string" ? body.model : undefined, LLM_REASONING: typeof body?.reasoning === "string" ? body.reasoning : undefined };
  let detail: unknown = null;
  // `strict`: what "Check strictly" does (the stronger model judges, the quick one reads the shorter claims again), so that it can be measured
  const strict = body?.strict === true;
  const quick = judgeStreamFor(env as Bindings, user.id, c.req.raw.signal, typeof body?.timeoutMs === "number" ? Math.min(120_000, Math.max(5_000, body.timeoutMs)) : 20_000);
  const result = await judgeAnswer({ answer: { text, citations }, picked, judge: strict ? strictStreamFor(env as Bindings, user.id, c.req.raw.signal, () => {}) : quick, recheck: strict ? (body?.recheck === "strong" ? strictStreamFor(env as Bindings, user.id, c.req.raw.signal, () => {}) : judgeStreamFor(env as Bindings, user.id, c.req.raw.signal)) : undefined, strict, onResult: (r) => (detail = r) });
  return c.json({ result, detail });
});

/** The strict check's model: the stronger one that wrote the answer (it thinks before it answers: 20 to 45 s), always PRIVATE. */
function strictStreamFor(env: Bindings, subject: string, abort: AbortSignal, onQuota: () => void): StreamComplete {
  const gateway = stubbed(env) ? null : gatewayFromEnv(env);
  return async (req, hooks) => {
    try {
      if (!gateway) return await stubStrictStream(req, hooks);
      const r = await gateway.stream({ task: "qa", sensitivity: "private", subject, system: req.system, user: req.user, schema: req.schema, maxTokens: 4500, timeoutMs: 75_000, label: req.label }, hooks, abort);
      return { json: r.json, model: r.model };
    } catch (e) {
      if (e instanceof QuotaError) onQuota();
      throw e;
    }
  };
}

/**
 * "Check strictly": the reader asks for a slower, stronger second reading of an answer already on the screen (docs/design/claim-support.md). The stronger model judges every claim again,
 * statements that say more than their sentences are cut down to what the sentences say (each only if it adds nothing and a second, quick reading calls it fully supported), and the
 * answer comes back. It is asked for, never automatic: it takes 20 to 45 seconds and about 5,000 tokens of the day's allowance.
 */
chatRoutes.post("/tighten", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 403, "sign_in", "Sign in to check an answer strictly");
  // the switch that turns the support judge off (CHAT_JUDGE=off) turns the strict check off too: a page that was opened before it still shows the button
  if (c.env.CHAT_JUDGE === "off") return c.json({ type: "unavailable", title: "The strict check is switched off", detail: "Try again later." }, 503);
  const read = readTighten(await c.req.json().catch(() => null));
  if (!read.ok) return deny(c, 400, "invalid_request", "That answer cannot be checked", read.detail);
  const { text, picked, citations } = read.input;
  let quota = false;
  let report: JudgeReport | undefined;
  const judged = await judgeAnswer({
    answer: { text, citations },
    picked,
    judge: strictStreamFor(c.env, user.id, c.req.raw.signal, () => (quota = true)),
    recheck: judgeStreamFor(c.env, user.id, c.req.raw.signal),
    strict: true,
    label: "chat_strict",
    onResult: (r) => (report = r),
  });
  if (report) logJudged({ ...report, verdicts: undefined, rewrites: report.rewrites?.map((x) => ({ c: x.c, text: "", ...(x.accepted === undefined ? {} : { accepted: x.accepted }) })) });
  if (!judged) {
    return quota
      ? c.json({ type: "quota", title: "Today's AI allowance is used up", detail: "The strict check uses about 5,000 tokens. It resets at 00:00 UTC." }, 429)
      : c.json({ type: "unavailable", title: "The strict check could not be done", detail: "Try again in a moment." }, 503);
  }
  const answer: ChatAnswer = { text: judged.text, citations: judged.citations, grounded: judged.grounded, checked: judged.checked, leftOut: judged.leftOut, rewritten: judged.rewritten, strict: true };
  const changed = judged.leftOut > 0 || judged.rewritten > 0 || judged.text !== text;
  return c.json({ answer, changed } satisfies TightenResponse);
});
