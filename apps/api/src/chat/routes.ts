import { Hono, type Context } from "hono";
import { NOTHING_NOTICE, PARTIAL_NOTICE, SMALL_TALK_REPLY, cleanAutoMessage, cleanChatMessage, detectLanguage, isSmallTalk, ruleRoute, slimForInterim, type ChatEvent, type ChatNoAnswer, type Route, type SearchResponse, type SearchSnapshot } from "@scholar/shared";
import { currentUser, sameOrigin } from "../auth/http";
import { cacheStore } from "../cache";
import type { Complete, StreamComplete } from "../docs/qa";
import { AllProvidersFailedError, NoRouteError, QuotaError, gatewayFromEnv } from "../llm";
import { runSearch } from "../search";
import { sseStream } from "../sse";
import type { SearchEnv } from "../search/types";
import type { S2Throttle } from "../s2-throttle";
import { answerFromResults, pickEvidencePapers } from "./answer";
import { answerGeneral } from "./general";
import { routeMessage } from "./router";
import { stubChatStream, stubSearchFor } from "./stub";
import { stubRoute } from "./stub-route";
import { countOutcome } from "../outcomes";

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
};
type Env = { Bindings: Bindings };
export const chatRoutes = new Hono<Env>();

chatRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

const deny = (c: Context<Env>, status: 400 | 403, type: string, title: string, detail?: string) => c.json({ type, title, ...(detail ? { detail } : {}) }, status);
const stubbed = (env: Bindings) => env.ENABLE_DEV_ROUTES === "1" && env.QA_STUB === "1";

const searchEnv = (env: Bindings): SearchEnv => ({
  store: cacheStore(env),
  OPENALEX_API_KEY: env.OPENALEX_API_KEY,
  NCBI_API_KEY: env.NCBI_API_KEY,
  S2_API_KEY: env.S2_API_KEY,
  CORE_API_KEY: env.CORE_API_KEY,
  CROSSREF_MAILTO: env.CROSSREF_MAILTO,
  s2Gate: (maxWaitMs) => env.S2_THROTTLE.getByName("global").reserve(maxWaitMs),
});

/** The model, for the person's own message: PRIVATE, so the gateway only uses providers that do not keep or train on it. `abort` stops it when the reader presses Stop or leaves. */
function streamFor(env: Bindings, subject: string, abort: AbortSignal): StreamComplete {
  if (stubbed(env)) return stubChatStream;
  const gateway = gatewayFromEnv(env);
  return async (req, hooks) => {
    const r = await gateway.stream({ task: "qa", sensitivity: "private", subject, system: req.system, user: req.user, schema: req.schema, maxTokens: req.maxTokens, timeoutMs: 60_000, label: req.label }, hooks, abort);
    return { json: r.json, model: r.model };
  };
}

/** The router's model: the person's own free text, so PRIVATE (the gateway only uses providers that do not keep or train on it). */
function routeCompleteFor(env: Bindings, subject: string): Complete {
  if (stubbed(env)) return stubRoute;
  const gateway = gatewayFromEnv(env);
  return async (req) => {
    const r = await gateway.complete({ task: "classify", sensitivity: "private", subject, system: req.system, user: req.user, schema: req.schema, maxTokens: req.maxTokens, timeoutMs: 30_000, label: req.label });
    return { json: r.json, model: r.model };
  };
}

/** Did every place that was asked answer? (A place that was not asked, because it is not in this search, is not counted.) */
const complete = (r: SearchResponse) => Object.values(r.providers).every((p) => p.ok);

/**
 * One message, one stream. `mode: "search"` is the reader's own choice (the words are searched as written); `mode: "auto"` lets the router choose the tool (router.ts). For a
 * search: the papers (the first as soon as one source has answered, the list again as each source does), a plain line if a source did not answer, and for a signed-in person a
 * short answer made from the papers with every claim tied to a sentence of an abstract (answer.ts). For any other tool the stream says what was understood and ends: the tools
 * open on their own pages, and Idea Check never starts without a click. The server keeps no chat.
 */
chatRoutes.post("/", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const body = (await c.req.json().catch(() => null)) as { mode?: unknown; message?: unknown } | null;
  if (!body || (body.mode !== "search" && body.mode !== "auto")) return deny(c, 400, "invalid_mode", "That mode is not available");
  const auto = body.mode === "auto";
  const text = auto ? cleanAutoMessage(body.message) : cleanChatMessage(body.message);
  if (!text) return deny(c, 400, "invalid_message", auto ? "Write something, at most 20,000 characters" : "Write 2 to 300 characters");
  const user = await currentUser(c);
  const started = Date.now();

  const abort = new AbortController();
  return sseStream<ChatEvent>(c, { terminal: ["done", "error"], fallback: { type: "error", code: "internal_error", title: "Something went wrong" }, abort }, async (s) => {
    const send = s.send;
    // how this question went is counted once, as it ends (counts only, src/outcomes.ts): what the papers did, or what stopped it
    let outcome: string | null = null;
    const done = async (answered: boolean, reason?: ChatNoAnswer) => {
      await countOutcome(c.env.DB, "chat", outcome ?? (answered ? "answered" : (reason ?? "other")));
      return send({ type: "done", answered, ...(reason ? { reason } : {}), tookMs: Date.now() - started });
    };
    /**
     * Background from general knowledge, when the papers did not answer (general.ts): a separate call, its own step, its own event, shown under a label on every screen.
     * If the allowance is used or the service is down it is simply not given: the plain line about the papers is already there.
     */
    const background = async (subject: string, language: Route["language"]) => {
      if (s.gone) return;
      try {
        await send({ type: "step", step: "general" });
        const g = await answerGeneral({
          question: text.replace(/\s+/g, " ").slice(0, 600),
          language,
          stream: streamFor(c.env, subject, abort.signal),
          emit: send,
          onRaw: c.env.ENABLE_DEV_ROUTES === "1" && !stubbed(c.env) ? (raw) => console.log(JSON.stringify({ msg: "chat_general_debug", raw })) : undefined,
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
      // a greeting, thanks or "what can you do" is answered by the box itself: no router, no search, no model, the same for a visitor who is not signed in
      const talk = isSmallTalk(text);
      if (auto && !talk) {
        // the rules settle most messages without a model; only when they cannot, a step says so while the model looks
        if (user && !ruleRoute(text)) await send({ type: "step", step: "route" });
        route = await routeMessage(text, user ? routeCompleteFor(c.env, user.id) : null);
        if (s.gone) return;
      } else {
        route = { mode: "search", how: auto ? "rules" : "chosen", confidence: 1, language: detectLanguage(text) };
      }
      const shown = text.replace(/\s+/g, " ").slice(0, 300);
      await send({ type: "understood", mode: route.mode, query: shown, language: route.language, auto, how: route.how, confidence: route.confidence, ...(route.searchQuery ? { searchQuery: route.searchQuery } : {}) });
      if (talk) {
        outcome = "small_talk";
        await send({ type: "general", kind: "not_research", text: SMALL_TALK_REPLY });
        return void (await done(false));
      }
      // another tool: nothing runs here; the browser offers to open it
      if (route.mode !== "search") return void (await done(false, "routed"));
      // what the indexes are asked: the model's English words, or the message as written (at most 300 characters)
      const query = route.searchQuery ?? text.replace(/\s+/g, " ");
      if (query.length > 300) return void (await done(false, "too_long"));

      await send({ type: "step", step: "search" });
      // while the sources answer, each list carries only the start of the abstracts; the final one below carries all of them (slimForInterim)
      const interim = (r: SearchResponse | SearchSnapshot) => send({ type: "papers", results: slimForInterim(r.results), final: false });
      let found: SearchResponse;
      if (stubbed(c.env)) {
        if (/\bstalled\b/i.test(query)) await new Promise((r) => setTimeout(r, 3500)); // a silent wait, to see the keep-alive line and the "still working" hint
        found = stubSearchFor(query);
        if (found.results.length > 0) await interim(found);
      } else {
        found = await runSearch(searchEnv(c.env), query, 20, { onSnapshot: interim });
      }
      if (s.gone) return;
      await send({ type: "papers", results: found.results, final: true });
      if (!complete(found)) await send({ type: "notice", kind: "partial", text: PARTIAL_NOTICE });
      if (found.results.length === 0) {
        await send({ type: "notice", kind: "nothing", text: NOTHING_NOTICE });
        if (user) await background(user.id, route.language);
        return void (await done(false));
      }
      if (found.results.some((p) => p.retracted)) await send({ type: "notice", kind: "retracted", text: "At least one paper in this list has been retracted. It is marked, and it was not used for the answer." });
      if (!user) return void (await done(false, "sign_in"));
      const picked = pickEvidencePapers(found.results);
      if (picked.length === 0) {
        await background(user.id, route.language);
        return void (await done(false, "no_abstracts"));
      }

      await send({ type: "step", step: "read" });
      let answer;
      try {
        // the question the answer is for is what the person wrote (so it is answered in their language), not the English words the indexes were asked
        answer = await answerFromResults({ question: text.replace(/\s+/g, " ").slice(0, 600), language: route.language, picked, stream: streamFor(c.env, user.id, abort.signal), emit: send, onRaw: c.env.ENABLE_DEV_ROUTES === "1" ? (raw) => console.log(JSON.stringify({ msg: "chat_debug", raw, shown: picked.map((p) => p.n) })) : undefined });
      } catch (e) {
        if (s.gone) return;
        if (e instanceof QuotaError) return void (await done(false, "quota"));
        if (e instanceof NoRouteError || e instanceof AllProvidersFailedError) {
          if (e instanceof AllProvidersFailedError) console.error(JSON.stringify({ level: "error", msg: "chat_failed", attempts: e.attempts.map((a) => `${a.provider}:${a.ok ? "ok" : a.error}`) }));
          return void (await done(false, "unavailable"));
        }
        throw e;
      }
      if (s.gone) return;
      await send({ type: "step", step: "check" });
      await send({ type: "answer", answer: { text: answer.text, citations: answer.citations, grounded: answer.grounded } });
      // papers first: only when they do not answer, and the model itself says so (not when an answer was written and could not be checked), a labelled background follows
      if (!answer.grounded && !answer.enough) await background(user.id, route.language);
      await done(answer.grounded, answer.grounded ? undefined : answer.enough ? "not_grounded" : "not_answered");
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "chat_stream_failed", error: e instanceof Error ? e.name : "unknown" }));
      await send({ type: "error", code: "internal_error", title: "Something went wrong" });
    }
  });
});

/**
 * Development only (ENABLE_DEV_ROUTES=1; the deployed Workers do not set it, so this is a plain 404 there): the router's choice for one message, with the real model and no
 * search, so `scripts/router-eval.mjs` can measure the router over a labelled list without spending the search sources.
 */
chatRoutes.post("/route", async (c) => {
  if (c.env.ENABLE_DEV_ROUTES !== "1") return c.notFound();
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const body = (await c.req.json().catch(() => null)) as { message?: unknown } | null;
  const text = cleanAutoMessage(body?.message);
  if (!text) return deny(c, 400, "invalid_message", "Write something, at most 20,000 characters");
  const user = await currentUser(c);
  const route = await routeMessage(text, user ? routeCompleteFor(c.env, user.id) : null);
  return c.json(route);
});
