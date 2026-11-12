import { Hono } from "hono";
import type { Context } from "hono";
import { ABSTRACTS_NOTICE, FOLLOWUP_UNREAD_NOTICE, FOLLOW_UP_TOKENS_ESTIMATE, MAX_CHAT_BODY_BYTES, MAX_OA_ABSTRACT_CHARS, MIN_SINCE_YEAR, type AskStreamEvent, type ChatRetraction, NOTHING_NOTICE, NO_TOPIC_TEXT, PARTIAL_NOTICE, YEAR_FILTER_FEW, YEAR_FILTER_SEARCH_LIMIT, cleanAutoMessage, cleanChatMessage, detectLanguage, isSearchScope, refTally, isSmallTalk, languageWithContext, needsContext, offlineRoute, ruleRoute, slimForInterim, smallTalkReply, type ChatAnswer, type ChatCitation, type ChatConfig, type ChatContextInfo, type ChatEvent, type TightenResponse, type ChatNoAnswer, type MessageReading as Reading, type Paper, type Route, type SearchResponse, type SearchScope, type SearchSnapshot, type ThinkLine } from "@scholar/shared";
import { currentUser, sameOrigin } from "../auth/http";
import type { Complete, StreamComplete } from "../docs/qa";
import { AllProvidersFailedError, NoRouteError, QuotaError, gatewayFromEnv } from "../llm";
import { DEFAULT_CONFIG } from "../llm/config";
import { d1Ledger } from "../llm/d1";
import { searchService } from "../search/service";
import { sseStream } from "../sse";
import { searchComplete } from "./complete";
import { answerFromResults, pickEvidencePapers, type Picked } from "./answer";
import { judgeAnswer, type JudgeReport } from "./support";
import { readTighten } from "./tighten";
import { answerGeneral } from "./general";
import { askedOf, contextInfo, ownQuestions, routeContextOf, routeFollowUp, routeMessage, routerCallFailed, type FollowUp, type RouterContext } from "./router";
import { errorKind, readHistory, stripInvisible, type ChatHistory } from "./history";
import { stubChatStream, stubJudgeStream, stubSearchFor, stubStrictStream } from "./stub";
import { stubRoute } from "./stub-route";
import { FLOOR_OUTCOMES, FOLLOW_UP_OUTCOMES, UNREAD_OUTCOMES, askOutcome, countOutcome, countOutcomes } from "../outcomes";
import { flag, killSwitch, type FlagPosition, type GateName } from "../platform/switches";
import { NO_PLAN, planLane, safetyRead, type LanePlan } from "../understand/lane";
import { noticeText, replyText } from "../understand/lane-text";
import { inputShape } from "../understand/input-shape";
import { readRequest, type RequestRead } from "../understand/frame";
import { checkReading } from "../understand/reading-check";
import { listState, tiererFor, type ListState, type TierCounts, type Tierer } from "../understand/tiers";
import { fewNotice, noneCloseNotice } from "../understand/tiers-text";
import { asking as thinkAsking, checked as thinkChecked, chosenSearch as thinkChosen, confirmLine as thinkConfirm, fellBack as thinkFellBack, found as thinkFound, fromEarlier as thinkFromEarlier, notSure as thinkNotSure, reading as thinkReading, searchCounts, searched as thinkSearched, understoodChat, understoodModel, understoodSearch, understoodTool, writing as thinkWriting } from "./think";
import { understandTurn, type UnderstandDecision } from "../understand/understand";
import { guards } from "../understand/guards";
import { greetingKind } from "../understand/greeting";
import { templateChatReply, writeChatReply } from "../understand/chat-reply";
import { readLedger, paperRefsToResolve, type LedgerPaper, type LedgerTurn } from "../understand/ledger-input";
import { understandCounters, type OldDecision } from "../understand/understand-counters";
import type { Understanding } from "../understand/understanding";
import { chatReplyCompleteFor, resolveLedgerPapers, stubChatReply, stubUnderstand, takeVisitorCall, understandCompleteFor } from "./understand-wire";
import { searchEnvFrom } from "../search/env";
import { deny } from "../problem";
import { modeOfPlan, pickDoc, planTool, relayAsk, runVerify, type ToolDeps, type ToolPlan } from "./tools";
import { stubVerify } from "./tools-stub";
import { toolAnswered as thinkToolAnswered, toolAsking as thinkToolAsking, toolChecked as thinkToolChecked, toolChecking as thinkToolChecking, toolRetractions as thinkToolRetractions, toolRetractionsDone as thinkToolRetractionsDone, understoodToolRun } from "./think";
import { referenceService } from "../references/service";
import { retractionService } from "../search/retraction-service";
import { oaService } from "../oa/service";
import { describeAskError, embedderFor, streamFor as docStreamFor } from "../docs/routes";
import { answerQuestionStream, type StoredChunk } from "../docs/qa";
import { decodeVec } from "../docs/vector";
import type { Env, HonoEnv } from "../platform/env";

export const chatRoutes = new Hono<HonoEnv>();

chatRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

const stubbed = (env: Env) => env.ENABLE_DEV_ROUTES === "1" && env.QA_STUB === "1";

/**
 * Where a gate flag of the chat stands for this request (platform/switches.ts: unset is off, an off flag reads nothing from KV, and the positions of each name are its row of SWITCHES). A value that is
 * not exactly a position is off, and one line says WHICH FLAG held it (a constant name, never anything of a message): a typo must not turn behaviour on, and must not pass unseen either.
 */
async function gate(env: Env, name: Extract<GateName, `CHAT_${string}`>): Promise<FlagPosition> {
  const r = await flag(env, name);
  if (r.badVariable) console.warn(JSON.stringify({ level: "warn", msg: "flag_bad_value", flag: name }));
  return r.position;
}

/** How the judge did on one answer, for the logs: counts and times only, never a word of the question, the answer or an abstract. */
const logJudged = (r: JudgeReport) =>
  console.log(JSON.stringify({ level: r.error ? "warn" : "info", msg: "chat_judge", ms: r.ms, model: r.model, ...r.counts, leftOut: r.leftOut, rewritten: r.rewritten ?? 0, offered: r.rewrites?.length ?? 0, ...(r.checkMs === undefined ? {} : { checkMs: r.checkMs }), ...(r.error ? { error: r.error } : {}) }));

/** The model, for the person's own message: PRIVATE, so the gateway only uses providers that do not keep or train on it. `abort` stops it when the reader presses Stop or leaves. */
function streamFor(env: Env, subject: string, abort: AbortSignal): StreamComplete {
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
function judgeStreamFor(env: Env, subject: string, abort: AbortSignal, timeoutMs = 20_000): StreamComplete {
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
function routeCompleteFor(env: Env, subject: string, onUsage?: (u: { tokensIn?: number | null; tokensOut?: number | null }) => void): Complete {
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
 * R9: has the message a request frame ("can you search about", "please", "all papers") that the cleaner of R8 would take off? Where the cleaner is not on, the frame's words would be counted as topic words and a good list
 * would look weak, so a message that has one is not judged ("interpret first, gate second", plan 4.9). A failure of the reading counts as a frame: the page then abstains.
 */
function hasFrameLeft(text: string, route: Route): boolean {
  try {
    const r = readRequest(text, route, {});
    return !!r && (!r.searchable || r.reading.topic !== text.replace(/\s+/g, " ").trim());
  } catch {
    return true;
  }
}

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
 * M4/M5: where the Understand step stands for THIS requester: CHAT_UNDERSTAND's position for a person who is signed in; for a visitor, the same only while CHAT_UNDERSTAND_VISITORS is "on" (else "off").
 * Unset flags read nothing (platform/switches.ts), so with both unset nothing at all is looked up.
 */
async function understandFor(env: Env, signedIn: boolean): Promise<FlagPosition> {
  const position = await gate(env, "CHAT_UNDERSTAND");
  if (position === "off" || signedIn) return position;
  return (await gate(env, "CHAT_UNDERSTAND_VISITORS")) === "on" ? position : "off";
}

/** Work that must not hold the reply (shadow, counts): on the response's waitUntil, or (a test, which has no execution context) left to run on its own. Never throws. */
function later(c: Context, work: Promise<unknown>): void {
  const safe = work.catch(() => {});
  try {
    c.executionCtx.waitUntil(safe);
  } catch {
    void safe;
  }
}

/** The ledger turn a message's papers come from: the one the reading points at, or else the latest that listed papers. */
function papersTurnOf(ledger: readonly LedgerTurn[], u: Understanding): LedgerTurn | null {
  if (u.refers_to) return ledger.find((t) => t.turn === u.refers_to!.turn) ?? null;
  return [...ledger].reverse().find((t) => t.papers.length > 0) ?? null;
}
/** The papers to look up again for an `ask_results` reading: the numbered ones it names, or the whole turn when it names none ("explain that simpler", "Hindi mein batao"). */
function askedPapers(ledger: readonly LedgerTurn[], u: Understanding): LedgerPaper[] {
  if (u.refers_to && u.refers_to.papers.length > 0) return paperRefsToResolve(ledger, u.refers_to);
  return papersTurnOf(ledger, u)?.papers ?? [];
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
  const body = read.body as { mode?: unknown; message?: unknown; scope?: unknown; anyway?: unknown; history?: unknown; sinceYear?: unknown; ledger?: unknown } | null;
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
  // `earlier` (questions of OTHER chats) is never read: that feature was removed on 6 Nov 2026 (design PDF "Sodhsetu understanding, follow-ups and MCP", M1). A tab opened before the release may still send
  // it; it is ignored, not refused, so that tab's messages are answered as a message without it, and nothing of it reaches a model or a log.
  const contextOn = killSwitch(c.env, "CHAT_CONTEXT") === "on";
  const carries = body.history !== undefined && body.history !== null;
  if (carries && contextOn && !auto) return deny(c, 400, "invalid_flag", "That option is not available");
  let history: ChatHistory | null = null;
  if (carries && contextOn) {
    const h = readHistory(body.history);
    if (!h.ok) {
      // a count, so that abuse shows in the logs; never a word of what was sent
      console.warn(JSON.stringify({ level: "warn", msg: "chat_history_refused" }));
      return deny(c, 400, "invalid_history", "The earlier messages could not be used", h.detail);
    }
    history = h.history;
  }
  const cleaned = auto ? cleanAutoMessage(body.message) : cleanChatMessage(body.message);
  if (!cleaned) return deny(c, 400, "invalid_message", auto ? "Write something, at most 20,000 characters" : "Write 2 to 300 characters");
  const user = await currentUser(c);
  // M4/M5: where the Understand step stands for this requester, and the turn ledger it reads. The ledger is read only then: with the step off the field is not even looked at (as a server that did not know it
  // would ignore it), and a bad one is refused only where it would be read (the page sends the message again without it, as for `history`). It is untrusted data: understand/ledger-input.ts.
  const understand: FlagPosition = auto ? await understandFor(c.env, !!user) : "off";
  let ledger: LedgerTurn[] = [];
  if (understand !== "off" && body.ledger !== undefined && body.ledger !== null) {
    const l = readLedger(body.ledger);
    if (!l.ok) {
      console.warn(JSON.stringify({ level: "warn", msg: "chat_ledger_refused" }));
      return deny(c, 400, "invalid_ledger", "The earlier messages could not be used", l.detail);
    }
    ledger = l.turns;
  }
  const ctx: RouterContext | null = auto && user && history && history.turns > 0 ? { history } : null;
  // read with turns before it, the message loses its invisible characters too (they hide an instruction from a person's eyes and not from a model's)
  const text = ctx ? cleanAutoMessage(stripInvisible(cleaned)) : cleaned;
  if (!text) return deny(c, 400, "invalid_message", "Write something, at most 20,000 characters");
  const ignored = carries && !contextOn;
  const started = Date.now();

  const abort = new AbortController();
  return sseStream<ChatEvent>(c, { terminal: ["done", "error"], fallback: { type: "error", code: "internal_error", title: "Something went wrong" }, abort }, async (s) => {
    const send = s.send;
    // M2: the Thinking block's lines, only with CHAT_THINK "on" (with it off nothing below sends one, and the stream is what it was). A line is never logged: it goes to the page and nowhere else.
    const thinkOn = (await gate(c.env, "CHAT_THINK")) === "on";
    const think = async (line: ThinkLine | null) => {
      if (thinkOn && line && !s.gone) await send({ type: "think", ...line });
    };
    // how this question went is counted once, as it ends (counts only, src/outcomes.ts): what the papers did, or what stopped it
    let outcome: string | null = null;
    // what the router made of a message that was read with turns before it (null for any other message)
    let follow: FollowUp | null = null;
    // the day cannot pay for a model to read the earlier turns: the message is searched as written and no answer is written
    let poor = false;
    // R3: whether exactly one provider contributed a paper to the list (known only once the search has answered)
    let oneSource = false;
    // R9 (4.9): the name that is counted for what the relevance floor made of the list (`tier_none` and `tier_few` for what it did, `would_tier_*` for what it only read), null when it said nothing
    let tierName: string | null = null;
    // R5: where the follow-up failure policy stands for this message; read only when the router call failed, and "off" for every other message
    let failPolicy: FlagPosition = "off";
    // R4 (4.5): what the safety lane does for this message (nothing, while its flag is off), and which of the two care lines it would show
    let lane: LanePlan = NO_PLAN;
    let careKind: "health" | "distress" | null = null;
    // R8 (4.8): the name that is counted for what the cleaner did (`would_clean` in shadow, `clean_applied` on), null when it did nothing
    let cleanName: string | null = null;
    /**
     * R3 (docs/design/intent-and-state.md, 4.4), once, as the message ends whatever the ending (so also a message that was left, or one that failed): with CHAT_COUNTERS=on the SHAPE of an Auto message
     * that carries no earlier turns is counted by closed names, in one batch, with `one_source` once a list was found; a search chosen by hand counts only `anyway` when it carries it. Never any text of
     * the message, and never anything when the flag is not exactly "on": the flag is read here, at the end, so that no message waits for it. A failure is swallowed (and logged without a word by countOutcomes).
     */
    const countMessage = async () => {
      if (!anyway && !(auto && !carries)) return;
      try {
        if ((await gate(c.env, "CHAT_COUNTERS")) !== "on") return;
        await countOutcomes(c.env.DB, "chat_input", anyway ? ["anyway"] : [...lane.names, ...(cleanName ? [cleanName] : []), ...inputShape(text), ...(oneSource ? ["one_source"] : []), ...(tierName ? [tierName] : [])]);
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
        await think(thinkWriting(language, true));
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
    /**
     * CHAT_TOOLS (docs/design/chat-tools.md): one tool, run in the reply, by the same service functions the tool's own page calls. Its result goes out as `tool*` events (never as a written chat answer), its
     * lines in the Thinking block say what it did from its own counts, and the reply ends `tool`. A tool that fails says so in its own place and never shows a made-up result.
     */
    const runPlan = async (plan: ToolPlan, doc: { id: string; title: string } | null, language: Route["language"], unsure: boolean) => {
      const ip = c.req.header("cf-connecting-ip") ?? "unknown";
      const allowed = (b?: Pick<RateLimit, "limit">) => async () => !b || (await b.limit({ key: ip }).then((r) => r.success, () => true));
      const env = c.env;
      const deps: ToolDeps = {
        verify: stubbed(c.env) ? stubVerify : async (t) => (await referenceService.verify(env, t)).result,
        verifyAllowed: allowed(c.env.VERIFY_LIMITER),
        retractions: async (dois) => {
          const r = await retractionService.check(env, dois);
          return { checked: r.checked, invalid: r.invalid };
        },
        askPaper: async (a, sendAsk) => {
          const embed = embedderFor(env);
          if (!embed) return void (await sendAsk({ type: "error", code: "ai_unavailable", title: "Answering is unavailable right now" }));
          await oaService.ask(env, { userId: user!.id, ref: a.ref, key: a.key, question: a.question, clientAbstract: a.clientAbstract, embed, abort }, { get gone() { return s.gone; }, send: sendAsk });
        },
        askDoc: async (docId, question, sendAsk) => {
          const embed = embedderFor(env);
          const stream = docStreamFor(env, user!.id, abort.signal);
          if (!embed || !stream) return void (await sendAsk({ type: "error", code: "ai_unavailable", title: "Answering is unavailable right now" }));
          try {
            const rows = await c.env.DB.prepare("SELECT idx, page, text, embedding FROM doc_chunks WHERE doc_id = ?1 ORDER BY idx").bind(docId).all<{ idx: number; page: number; text: string; embedding: string | null }>();
            const chunks: StoredChunk[] = (rows.results ?? []).map((r) => ({ idx: r.idx, page: r.page, text: r.text, embedding: r.embedding ? decodeVec(r.embedding) : null }));
            const id = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, "0")).join("");
            const answer = await answerQuestionStream({ question, chunks, embed, stream, meta: { id, createdAt: Date.now() }, emit: sendAsk });
            if (s.gone) return;
            // kept with the paper's own questions, as a question asked on the paper's page is (the privacy page says so)
            await c.env.DB.prepare("INSERT INTO doc_qa (id, doc_id, question, answer) VALUES (?1, ?2, ?3, ?4)").bind(answer.id, docId, question, JSON.stringify(answer)).run();
            await countOutcome(c.env.DB, "doc_ask", askOutcome(answer));
            await sendAsk({ type: "answer", answer });
          } catch (e) {
            if (s.gone) return;
            const d = describeAskError(e);
            if (!d) console.error(JSON.stringify({ level: "error", msg: "chat_tool_ask_doc_failed", error: e instanceof Error ? e.name : "unknown" }));
            await sendAsk({ type: "error", code: d?.code ?? "internal_error", title: d?.title ?? "Something went wrong", ...(d?.detail ? { detail: d.detail } : {}) });
          }
        },
        askAllowed: allowed(c.env.ASK_LIMITER),
        gone: () => s.gone,
      };
      const kind = plan.kind;
      await think(understoodToolRun(language, kind, unsure));
      outcome = `tool_${kind}`;
      if (plan.kind === "verify") {
        await send({ type: "tool", tool: "verify", total: plan.refs.length, skipped: plan.skipped });
        await think(thinkToolChecking(language, plan.refs.length, plan.skipped));
        const items = await runVerify(plan.refs, deps, send);
        if (s.gone) return;
        await think(thinkToolChecked(language, refTally(items)));
      } else if (plan.kind === "retractions") {
        await send({ type: "tool", tool: "retractions", dois: plan.dois.length });
        await think(thinkToolRetractions(language, plan.dois.length));
        let r: { checked: ChatRetraction[]; invalid: string[] };
        try {
          r = await deps.retractions(plan.dois);
        } catch {
          // a check that could not run says "unknown" for every DOI, never "not retracted"
          r = { checked: plan.dois.map((doi) => ({ doi, status: "unknown" as const, notices: [] })), invalid: [] };
        }
        if (s.gone) return;
        await send({ type: "tool_retractions", checked: r.checked, invalid: r.invalid });
        await think(thinkToolRetractionsDone(language, { retracted: r.checked.filter((x) => x.status === "retracted").length, clear: r.checked.filter((x) => x.status === "not_retracted").length, unknown: r.checked.filter((x) => x.status === "unknown").length }));
      } else {
        const own = plan.kind === "ask_doc";
        const paper = plan.kind === "ask_paper" ? { title: plan.paper.title, ...(plan.ref.doi ? { doi: plan.ref.doi } : {}), ...(plan.ref.arxivId ? { arxivId: plan.ref.arxivId } : {}) } : { title: doc?.title ?? null };
        // the paper the question is about is shown as its card, as the papers of a search are
        if (plan.kind === "ask_paper") await send({ type: "papers", results: [plan.paper], final: true });
        await send({ type: "tool", tool: plan.kind, paper, question: plan.question });
        await think(thinkToolAsking(language, paper.title, own));
        let end: Awaited<ReturnType<typeof relayAsk>>;
        if (!(await deps.askAllowed())) {
          end = await relayAsk(async (e) => e({ type: "error", code: "rate_limited", title: "Too many questions just now", detail: "Please wait a minute and try again." }), send);
        } else if (plan.kind === "ask_paper") {
          const p = plan;
          end = await relayAsk((e) => deps.askPaper({ ref: p.ref, key: p.key, question: p.question, clientAbstract: (p.paper.abstract ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_OA_ABSTRACT_CHARS) }, e), send);
        } else {
          const q = plan.question;
          end = await relayAsk((e) => deps.askDoc(doc!.id, q, e as (x: AskStreamEvent) => Promise<void>), send);
        }
        if (s.gone) return;
        await think(thinkToolAnswered(language, end.answer ? { quotes: end.answer.citations.length, found: end.answer.found, verified: end.answer.verified } : null));
        if (!end.answer) outcome = `tool_${kind}_failed`;
      }
      return void (await done(false, "tool"));
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
      // M5 (CHAT_UNDERSTAND "on"): the Understand step decides (understand/understand.ts). Its guards run first and need no model: a greeting is conversation, a bare DOI is searched as written, a pasted
      // reference list is offered to Check references. A visitor's call is counted against their day's cap only when the model would really be asked; past the cap the rules decide. When the model cannot be
      // used (timeout, invalid twice, down, no allowance) the rules decide too, and the reply says so. Counts only, after the reply (never its text).
      let und: UnderstandDecision | null = null;
      let u: Understanding | null = null;
      let visitorCapped = false;
      let chatReply: string | null = null;
      let preset: Paper[] | null = null;
      let where: SearchScope = scope;
      if (understand === "on") {
        let complete: Complete | null = null;
        let replyComplete: Complete | null = null;
        if (guards({ text, mode: "auto" }).kind === "understand") {
          let subject: string | null = user ? user.id : null;
          if (!user) {
            const v = await takeVisitorCall(c.env.DB, c.req.header("cf-connecting-ip") ?? "unknown");
            if (v.ok) subject = `visitor:${v.code}`;
            else visitorCapped = true;
          }
          if (subject) {
            complete = stubbed(c.env) ? stubUnderstand : understandCompleteFor(c.env, subject);
            replyComplete = stubbed(c.env) ? stubChatReply : chatReplyCompleteFor(c.env, subject);
          }
        }
        und = await understandTurn({ text, mode: "auto" }, { ledger, visitor: !user, year: thisYear }, { complete });
        if (s.gone) return;
        const names: string[] = understandCounters(und);
        if (und.source !== "fallback") u = und.understanding;
        // the conversation reply: fixed text for a greeting (no model), else the model's few lines, checked; one that cites anything is thrown away and the message is searched instead
        if (u?.intent === "chat") {
          const kind = greetingKind(text);
          if (und.source === "greeting" || !replyComplete) chatReply = templateChatReply(kind, u.language);
          else {
            const r = await writeChatReply(text, u.language, replyComplete);
            if (s.gone) return;
            if (r.ok) chatReply = r.reply;
            else if (r.discarded) {
              names.push("und_chat_leak");
              u = { ...u, intent: "search", search: { queries: [(u.standalone || text).replace(/\s+/g, " ").slice(0, 120)], year_from: null, year_to: null, indian_sources: null } };
            } else chatReply = templateChatReply(kind, u.language);
          }
        }
        // a question about papers already in this chat: they are looked up again by DOI (the page's copy of a paper is never used); with none found, what was asked is searched instead
        if (u?.intent === "ask_results") {
          const refs = askedPapers(ledger, u);
          const again = refs.length > 0 ? await resolveLedgerPapers(searchEnvFrom(c.env), refs, stubbed(c.env)) : [];
          if (s.gone) return;
          if (again.length > 0) preset = again;
          else u = { ...u, intent: "search", refers_to: null, search: { queries: [(u.standalone || text).replace(/\s+/g, " ").slice(0, 120)], year_from: null, year_to: null, indian_sources: null } };
        }
        if (u?.search?.indian_sources === true) where = "india";
        else if (u?.search?.indian_sources === false) where = "all";
        later(c, countOutcomes(c.env.DB, "chat_understand", names));
      }
      const talk = u ? u.intent === "chat" : !anyway && isSmallTalk(text, rctx);
      if (u) {
        // what the step decided, as the route the rest of the stream reads: another tool's card, the person's paper, or a search (of the step's English words when they are not the message itself)
        const words = u.search?.queries[0];
        const tool = u.intent === "offer_tool" && u.tool !== "litscan" ? u.tool : null;
        route = {
          mode: tool ?? (u.intent === "ask_paper" ? "paper" : "search"),
          how: und!.source === "model" ? "model" : "rules",
          confidence: u.confidence,
          language: u.language,
          ...(words && !talk && words !== text.replace(/\s+/g, " ").trim() ? { searchQuery: words } : {}),
        };
      } else if (auto && !talk) {
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
      // M4 (CHAT_UNDERSTAND "shadow"): the Understand step reads the same message beside the rules, AFTER they decided and on the response's waitUntil, so the person never waits for it and nothing on the
      // wire changes; only counts are kept (who decided, the intent, agreement with what the rules did, latency, fallback). A visitor's call is counted against their day's cap like a real one.
      if (understand === "shadow") {
        const old: OldDecision = talk ? { smallTalk: true } : { smallTalk: false, route, followUp: follow?.intent ?? null };
        const needsModel = guards({ text, mode: "auto" }).kind === "understand";
        later(
          c,
          (async () => {
            let complete: Complete | null = null;
            if (needsModel) {
              const v = user ? null : await takeVisitorCall(c.env.DB, c.req.header("cf-connecting-ip") ?? "unknown");
              const subject = user ? user.id : v?.ok ? `visitor:${v.code}` : null;
              if (subject) complete = stubbed(c.env) ? stubUnderstand : understandCompleteFor(c.env, subject);
            }
            const d = await understandTurn({ text, mode: "auto" }, { ledger, visitor: !user, year: thisYear }, { complete });
            await countOutcomes(c.env.DB, "chat_understand", understandCounters(d, old));
          })(),
        );
      }
      // R5 (4.6): the policy is looked up only for a follow-up whose router call FAILED (router.ts, routerCallFailed): for every other message the flag is not even read
      if (routerCallFailed(follow)) failPolicy = await gate(c.env, "CHAT_FAILPOLICY");
      // CHAT_TOOLS (docs/design/chat-tools.md): a tool that is cheap and safe to run is run in the reply instead of being offered (Idea Check and the literature scan stay a card). Auto only, never for a
      // conversation reply, a question back or a search chosen by hand; the switch is not even read otherwise. A failure here keeps the card (or the search) as it was.
      let plan: ToolPlan | null = null;
      let planDoc: { id: string; title: string } | null = null;
      if (auto && !talk && route.how !== "chosen" && u?.intent !== "clarify" && !(u?.intent === "offer_tool" && u.tool === "litscan") && (await gate(c.env, "CHAT_TOOLS")) === "on") {
        try {
          plan = planTool({ text, mode: route.mode, intent: u?.intent ?? null, preset, question: u?.standalone || text, signedIn: !!user });
          if (plan?.kind === "ask_doc") {
            const docs = await c.env.DB.prepare("SELECT id, title FROM documents WHERE user_id = ?1 AND status = 'ready' ORDER BY created_at DESC LIMIT 50").bind(user!.id).all<{ id: string; title: string }>();
            planDoc = pickDoc(plan.question, docs.results ?? []);
            if (!planDoc) plan = null;
          }
        } catch {
          plan = null;
        }
        if (s.gone) return;
        if (plan) route = { mode: modeOfPlan(plan), how: route.how, confidence: route.confidence, language: route.language };
      }
      // R8 (4.8): what the message is, and what is only a request in it. Auto only, after the route is settled and before what the page is told: a message that goes to the indexes with the words that only make a
      // request left out carries them as `route.searchQuery`, which is what "I searched for" and "Use my exact words" already show. Never for a search chosen by hand, a follow-up that was read with its turns, a
      // message whose search words a model wrote, or one the day could not pay a model for. The raw message still goes to the writer and the background (`asked`). A failure of the cleaner never stops a message.
      let reading: Reading | null = null;
      let nothingToSearch = false;
      if (auto && !talk && !u && route.mode === "search" && !route.searchQuery && !follow && !poor) {
        const clean = await gate(c.env, "CHAT_CLEAN");
        if (clean !== "off") {
          let read: RequestRead | null = null;
          try {
            // the lane's two lines for a health message (decision, care), where it acts: the words that say who the person is stay out of what the indexes are sent
            const person = lane.withhold || lane.notices.some((k) => k === "safety_decision" || k === "safety_care");
            read = readRequest(text, route, { person });
            if (read && !checkReading(read.reading, text)) read = null;
          } catch {
            read = null;
          }
          if (read) {
            cleanName = clean === "on" ? "clean_applied" : "would_clean";
            if (clean === "on") {
              if (!read.searchable) nothingToSearch = true;
              else {
                reading = read.reading;
                if (reading.topic !== text.replace(/\s+/g, " ").trim()) route = { ...route, searchQuery: reading.topic };
              }
            }
          }
        }
      }
      // a year range ("only after 2020", a Trending chip's `sinceYear`) is applied to the papers' own years before they are numbered, so that card numbers and marks stay true; the search asks for more, so that
      // what is left is not thin. It is the router's range and the chip's as one (`withSince`), and only a message that is searched has one: small talk and another tool's offer are not cut by anything.
      const said = u?.search && (u.search.year_from !== null || u.search.year_to !== null) ? { from: u.search.year_from ?? undefined, to: u.search.year_to ?? undefined } : null;
      const own: YearRange | null = said ?? (follow && (follow.yearFrom !== undefined || follow.yearTo !== undefined) ? { from: follow.yearFrom, to: follow.yearTo } : null);
      // M5: a question about papers already in the chat is answered from those papers, whatever years a chip asked a search for
      const years = preset ? null : route.mode === "search" && !talk ? withSince(own, sinceYear) : own;
      // what the page reads a year chip from is `context.yearFrom` and `yearTo`: the same fields whether the router or the chip gave the range, so that there is one chip for both. When the chip changed the
      // range, the context says the range that is applied (and a reading that fell back says nothing of its own then, since the page hides the whole of a context that did: the filter must not be hidden with it).
      const widened = years !== null && (years.from !== own?.from || years.to !== own?.to);
      let context: ChatContextInfo | undefined;
      if (follow && ctx) context = contextInfo(widened ? { ...follow, yearFrom: years.from, yearTo: years.to, fellBack: false } : follow, ctx);
      // M5: what the Understand step read of the earlier turns (a refinement, a question about the papers above) says so the way a follow-up always has: the question it was read as, and a year chip
      else if (u && (u.intent === "refine_search" || u.intent === "ask_results") && ledger.length > 0)
        context = { turns: ledger.length, intent: u.intent === "refine_search" ? "refine" : "same_papers", rewrote: !!u.standalone, ...(u.standalone ? { question: u.standalone.slice(0, 200) } : {}), ...(years?.from === undefined ? {} : { yearFrom: years.from }), ...(years?.to === undefined ? {} : { yearTo: years.to }) };
      else if (u && years) context = { turns: 0, intent: "new", rewrote: false, ...(years.from === undefined ? {} : { yearFrom: years.from }), ...(years.to === undefined ? {} : { yearTo: years.to }) };
      else if (widened) context = { turns: 0, intent: "new", rewrote: false, ...(years.from === undefined ? {} : { yearFrom: years.from }), ...(years.to === undefined ? {} : { yearTo: years.to }) };
      await send({
        type: "understood", mode: route.mode, query: shown, language: route.language, auto, how: route.how, confidence: route.confidence, ...(route.searchQuery ? { searchQuery: route.searchQuery } : {}), ...(where !== "all" && route.mode === "search" ? { scope: where } : {}), ...(context ? { context } : {}), ...(reading ? { reading } : {}),
        // M5: what the Understand step said (only when it decided, or when it could not and the rules did)
        ...(u ? { intent: u.intent, statusLine: u.status, ...(und?.confirm ? { confirm: true as const } : {}), ...(u.clarify ? { clarify: u.clarify } : {}), ...(u.intent === "offer_tool" && u.tool === "litscan" ? { offer: "litscan" as const } : {}) } : {}),
        // (a tool the rules chose after the step could not be used asks nothing: the rules decided, so its one line is "I understood this as ..." with Change)
        ...(und?.source === "fallback" ? { fallback: true as const, ...(plan ? {} : { confirm: true as const }) } : {}),
      });
      // counts and short names only: how many turns were read and what came of them, never a word of them
      if (follow && ctx) console.log(JSON.stringify({ level: "info", msg: "chat_followup", turns: ctx.history.turns, mode: route.mode, intent: follow.intent, rewrote: follow.rewrote, fellBack: follow.fellBack, check: follow.check, years: follow.yearFrom !== undefined || follow.yearTo !== undefined }));
      // R4: the lines of the lane go right after what the message was understood as, above the answer and the papers (a search chosen by hand gets only these)
      if (lane.notices.length > 0) {
        const language = detectLanguage(text);
        for (const kind of lane.notices) await send({ type: "notice", kind, text: noticeText(kind, language, { auto, careKind, searched: !nothingToSearch }) });
      }
      // R8: a health message whose personal words are all that it had to say: nothing is searched (a personal clause is never sent for lack of a better topic), and the page asks what to look up
      if (nothingToSearch) {
        outcome = "small_talk";
        await send({ type: "general", kind: "not_research", text: NO_TOPIC_TEXT });
        return void (await done(false, "small_talk"));
      }
      if (talk) {
        outcome = "small_talk";
        await think(understoodChat(route.language));
        if (und?.confirm && u) await think(thinkConfirm(route.language));
        await send({ type: "general", kind: "not_research", text: chatReply ?? smallTalkReply(text, route.language, rctx) });
        return void (await done(false, "small_talk"));
      }
      // M5: one question back instead of a guess (the page shows its choices and "Search anyway"); nothing is searched
      if (u?.intent === "clarify") {
        outcome = "clarify";
        await think(understoodModel(u.status, ["change"]));
        await think(thinkAsking(route.language));
        return void (await done(false, "clarify"));
      }
      // M5: the literature scan has no mode of the box: it is offered as a card (`offer`), never started
      if (u?.intent === "offer_tool" && u.tool === "litscan") {
        await think(understoodModel(u.status, ["change"]));
        return void (await done(false, "routed"));
      }
      // CHAT_TOOLS: the tool runs here, in the reply
      // the confidence policy of every other reply: "Did you want this?" only when the Understand step was between 0.45 and 0.75 sure (`und.confirm`); a sure reading, or a decision of the rules, has only its
      // understood line with Change. Either way ONE line (the question replaces the plain line, it is not a second one).
      if (plan) return void (await runPlan(plan, planDoc, route.language, !!(und?.confirm && u)));
      // another tool: nothing runs here; the browser offers to open it
      if (route.mode !== "search") {
        await think(u ? understoodModel(u.status, ["change"]) : understoodTool(route.language, route.mode));
        if (und?.confirm && u) await think(thinkConfirm(route.language));
        return void (await done(false, "routed"));
      }
      // what the indexes are asked: the model's English words, or the message as written (at most 300 characters)
      const query = route.searchQuery ?? text.replace(/\s+/g, " ");
      if (query.length > 300 && !preset) return void (await done(false, "too_long"));
      // M2: what is looked for (a follow-up's restated question, which a model may have written, else the words searched), with the page's own controls: Change, and the exact words when other words were searched
      if (route.how === "fallback") await think(thinkNotSure(route.language));
      // M5: the rules decided because the model could not be used (or a visitor's free readings of the day are used): said, with Change
      if (und?.source === "fallback") await think(thinkFellBack(route.language, visitorCapped));
      if (u) await think(understoodModel(u.status, route.searchQuery ? ["change", "exact_words"] : ["change"]));
      // a search chosen by hand: nothing was understood, so no "I understood" line (the page without the block says "Searching papers, as you chose." too)
      else if (route.how === "chosen") await think(thinkChosen(route.language));
      else await think(understoodSearch(route.language, follow?.rewrote && follow.question ? follow.question : query, route.searchQuery ? ["change", "exact_words"] : ["change"]));
      if (und?.confirm && u) await think(thinkConfirm(route.language));

      // what the answer is for and in what language: the standalone question of a follow-up (the message as written for any other message, so that it is answered in the person's language),
      // and the language the person asked for ("in Hindi") before the one the rules found. M5: when the Understand step decided, the writer gets its standalone question (never the ledger) and is told the
      // language to answer in.
      const asked = u ? (u.standalone || text).replace(/\s+/g, " ").slice(0, 600) : askedOf(follow, text.replace(/\s+/g, " ").slice(0, 600));
      const spoken = u ? u.language : (follow?.answerLanguage ?? reading?.answerLanguage ?? route.language);
      // R9 (4.9): the relevance floor. Read only for an Auto message (a search chosen by hand is never judged: its exact words are what it searched), and only where the page can judge the words: a follow-up whose router call
      // failed (or that the day could not pay a model for) was searched on words nobody read, a message that still has a request frame the cleaner is not on to take off would count the frame as topic, and more than six
      // content words (or none, or a script the tokeniser cuts in the middle of a word) is a ramble the page does not claim to read (tiers.ts: the trust rule). Then the page abstains and the list is what it was.
      // This is also what keeps the one notice kind `weak` with one line: the failure policy's line (R5) belongs to exactly the follow-ups that are never judged here.
      let floor: FlagPosition = "off";
      let tierer: Tierer | null = null;
      if (auto && !preset) {
        floor = await gate(c.env, "CHAT_FLOOR");
        if (floor !== "off" && !poor && !follow?.fellBack) {
          try {
            if (!(!reading && !route.searchQuery && hasFrameLeft(text, route))) tierer = tiererFor(query);
          } catch {
            tierer = null;
          }
        }
      }
      // the lists are cut to the years, and (only with the floor on) listed strong, then medium, then weak, each in the order it had; the cut is made first, so the twenty are the same twenty with the floor off. A failure of the
      // order makes the page abstain for the rest of the reply (the list stays as it was).
      const shape = (list: Paper[]): Paper[] => {
        const cut = years ? list.filter((p) => p.year !== null && (years.from === undefined || p.year >= years.from) && (years.to === undefined || p.year <= years.to)).slice(0, 20) : list;
        if (floor !== "on" || !tierer) return cut;
        try {
          return tierer.order(cut);
        } catch {
          tierer = null;
          return cut;
        }
      };

      // while the sources answer, each list carries only the start of the abstracts; the final one below carries all of them (slimForInterim). With CHAT_THINK on, a line says how many sources have answered so far.
      const interim = async (r: SearchResponse | SearchSnapshot) => {
        const shaped = shape(r.results);
        await send({ type: "papers", results: slimForInterim(shaped), final: false });
        await think(thinkFound(route.language, searchCounts(r.providers, shaped.length, shaped.filter((p) => p.retracted).length), false));
      };
      let found: SearchResponse;
      if (preset) {
        // M5: no search at all: the papers the chat already listed, as they were looked up again by DOI (understand-wire.ts), are what the answer is written from
        const none = { ok: true, count: 0, ms: 0, cached: false };
        found = { query, results: preset, providers: {}, doiCheck: none, retractionCheck: none, tookMs: 0 };
        await think(thinkFromEarlier(spoken, preset.length));
      } else {
        await send({ type: "step", step: "search" });
        await think(thinkSearched(route.language, query));
        if (stubbed(c.env)) {
          if (/\bstalled\b/i.test(query)) await new Promise((r) => setTimeout(r, 3500)); // a silent wait, to see the keep-alive line and the "still working" hint
          found = stubSearchFor(query, where, { topical: c.env.QA_STUB_TOPIC === "1" });
          if (found.results.length > 0) await interim(found);
        } else {
          found = await searchService.run(c.env, { q: query, limit: years ? YEAR_FILTER_SEARCH_LIMIT : 20, scope: where }, { onSnapshot: interim });
        }
      }
      if (s.gone) return;
      if (auto && !carries) oneSource = new Set(found.results.flatMap((p) => p.sources)).size === 1;
      const beforeYears = found.results.length;
      if (years || (floor === "on" && tierer)) found = { ...found, results: shape(found.results) };
      await send({ type: "papers", results: found.results, final: true });
      if (preset) await send({ type: "notice", kind: "abstracts", text: ABSTRACTS_NOTICE });
      else await think(thinkFound(route.language, searchCounts(found.providers, found.results.length, found.results.filter((p) => p.retracted).length), true));
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
      // R9 (4.9): how the list reads against the words that were searched. Counted in every position but off; said (one line of the kind `weak`) only with the floor on; and the writer's gate below reads it for `writer` and `on`.
      // The line is the failure policy's when both could be said: a follow-up that was not read is never judged, so there is nothing to choose between here and the kind has one line.
      let counts: TierCounts | null = null;
      let state: ListState | null = null;
      if (tierer) {
        try {
          counts = tierer.counts(found.results);
          state = listState(counts);
        } catch {
          counts = null;
          state = null;
          tierer = null;
        }
      }
      if (counts && state === "none") tierName = floor === "shadow" ? "would_tier_none" : "tier_none";
      else if (counts && state === "few") tierName = floor === "on" ? "tier_few" : "would_tier_few";
      if (floor === "on" && !unread && counts && state === "none") await send({ type: "notice", kind: "weak", text: noneCloseNotice(query, route.language) });
      else if (floor === "on" && !unread && counts && state === "few") await send({ type: "notice", kind: "weak", text: fewNotice(counts.strong, route.language) });
      if (unread) return void (await endUnread());
      // R4: a question about what the person should take: the papers of the topic are shown, and no answer is written (for a visitor too: signing in would not give one), and no background
      if (lane.withhold) return void (await done(false, "decision"));
      // R9: with `writer` or `on` the writer reads the strong papers only, and with none it is not asked at all (about 9,000 tokens kept): a written answer is never made over a list in which no paper matches the words closely
      const gating = (floor === "writer" || floor === "on") && tierer !== null && counts !== null;
      const floorSkips = gating && counts!.strong === 0;
      if (!user) {
        // a visitor is never given a written answer, and signing in would not give one here either, so the reply does not invite it; it is counted as a visitor's reply has always been counted
        if (floorSkips) outcome = "sign_in";
        return void (await done(false, floorSkips ? "not_answered" : "sign_in"));
      }
      if (poor) return void (await done(false, "quota"));
      if (floorSkips) {
        await background(user.id, spoken, asked);
        outcome = FLOOR_OUTCOMES.skipped;
        return void (await done(false, "not_answered"));
      }
      const picked = pickEvidencePapers(found.results, gating ? (p) => tierer!.tier(p) === "strong" : undefined);
      if (picked.length === 0) {
        await background(user.id, spoken, asked);
        return void (await done(false, "no_abstracts"));
      }

      await send({ type: "step", step: "read" });
      await think(thinkReading(spoken, picked.length));
      // M2: the judge's counts, for the line that says how many claims were read against their sentences (only when it gave verdicts)
      let judged: JudgeReport | null = null;
      let answer;
      try {
        // the question the answer is for is what the person wrote (so it is answered in their language), not the English words the indexes were asked; for a follow-up it is the standalone question,
        // and for the same papers only, the earlier answer goes with it as context the writer is told is not evidence. The judge is given neither (it reads claims and the abstracts they cite).
        // The debug log of what a model said is for the first message in development; a follow-up never uses it.
        answer = await answerFromResults({ question: asked, language: spoken, languageAsked: u ? u.language !== "en" : !!(follow?.answerLanguage ?? reading?.answerLanguage), earlierAnswer: follow?.intent === "same_papers" ? (ctx?.history.lastAnswer ?? undefined) : undefined, picked, stream: streamFor(c.env, user.id, abort.signal), judge: killSwitch(c.env, "CHAT_JUDGE") === "off" ? undefined : judgeStreamFor(c.env, user.id, abort.signal), onJudged: (r) => { judged = r; logJudged(r); }, emit: async (e) => { await send(e); if (e.type === "step" && e.step === "write") await think(thinkWriting(spoken)); }, onRaw: c.env.ENABLE_DEV_ROUTES === "1" && !ctx ? (raw) => console.log(JSON.stringify({ msg: "chat_debug", raw, shown: picked.map((p) => p.n) })) : undefined });
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
      const report = judged as JudgeReport | null;
      const claims = report && !report.error ? Object.values(report.counts ?? {}).reduce((n, v) => n + (Number.isFinite(v) ? v : 0), 0) : 0;
      if (answer.checked === true && claims > 0) await think(thinkChecked(spoken, { claims, leftOut: answer.leftOut ?? 0, rewritten: answer.rewritten ?? 0 }));
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
 * M4 (design PDF, "Follow-ups: sirf usi chat se"): what the page needs to know before it sends a message: whether to send the turn ledger of the chat with it. Only while the Understand step reads it for this
 * requester (CHAT_UNDERSTAND shadow or on; for a visitor also CHAT_UNDERSTAND_VISITORS on): a page that always sent it would send replies and paper titles nobody reads, which the privacy page does not allow.
 * A page that has not asked, or could not, sends none. Never cached.
 */
chatRoutes.get("/config", async (c) => {
  const user = await currentUser(c);
  return c.json({ ledger: (await understandFor(c.env, !!user)) !== "off" } satisfies ChatConfig);
});

/**
 * Development only (ENABLE_DEV_ROUTES=1; the deployed Workers do not set it, so this is a plain 404 there): the router's choice for one message, with the real model and no
 * search, so `scripts/router-eval.mjs` can measure the router over a labelled list without spending the search sources. With `history` (as the stream reads it) it reads
 * the message as a follow-up would be read and answers with the route plus `followUp` (what the checks made of the model's reading: intent, standalone question, search words, years, and the
 * reason if they did not pass) and `usage` (what the calls cost), so that `--followup` can score them. Without them the answer is the route and nothing more, as it always was.
 */
chatRoutes.post("/route", async (c) => {
  if (c.env.ENABLE_DEV_ROUTES !== "1") return c.notFound();
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const read = await readChatBody(c);
  if (read.tooLarge) return deny(c, 413, "too_large", "That is too much text", "Send a shorter message.");
  const body = read.body as { message?: unknown; history?: unknown } | null;
  const text = cleanAutoMessage(body?.message);
  if (!text) return deny(c, 400, "invalid_message", "Write something, at most 20,000 characters");
  const user = await currentUser(c);
  const carries = body?.history !== undefined && body.history !== null;
  if (!carries) return c.json(await routeMessage(text, user ? routeCompleteFor(c.env, user.id) : null));
  const h = readHistory(body?.history);
  if (!h.ok) return deny(c, 400, "invalid_history", "The earlier messages could not be used", h.detail);
  const usage = { calls: 0, tokensIn: 0, tokensOut: 0 };
  const complete = user
    ? routeCompleteFor(c.env, user.id, (u) => {
        usage.calls++;
        usage.tokensIn += u.tokensIn ?? 0;
        usage.tokensOut += u.tokensOut ?? 0;
      })
    : null;
  const routed = await routeFollowUp(cleanAutoMessage(stripInvisible(text)) ?? text, complete, { history: h.history });
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
  const quick = judgeStreamFor(env, user.id, c.req.raw.signal, typeof body?.timeoutMs === "number" ? Math.min(120_000, Math.max(5_000, body.timeoutMs)) : 20_000);
  const result = await judgeAnswer({ answer: { text, citations }, picked, judge: strict ? strictStreamFor(env, user.id, c.req.raw.signal, () => {}) : quick, recheck: strict ? (body?.recheck === "strong" ? strictStreamFor(env, user.id, c.req.raw.signal, () => {}) : judgeStreamFor(env, user.id, c.req.raw.signal)) : undefined, strict, onResult: (r) => (detail = r) });
  return c.json({ result, detail });
});

/** The strict check's model: the stronger one that wrote the answer (it thinks before it answers: 20 to 45 s), always PRIVATE. */
function strictStreamFor(env: Env, subject: string, abort: AbortSignal, onQuota: () => void): StreamComplete {
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
  if (killSwitch(c.env, "CHAT_JUDGE") === "off") return c.json({ type: "unavailable", title: "The strict check is switched off", detail: "Try again later." }, 503);
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
