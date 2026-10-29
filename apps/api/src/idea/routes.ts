import { Hono } from "hono";
import { PRIVACY_VERSION, IDEA_PLAN_INPUT_CHARS, MAX_IDEA_CHARS, MAX_IDEA_QUESTION_CHARS, MIN_IDEA_CHARS, type IdeaCompareEvent, type IdeaInsightsEvent, type IdeaPlan, type IdeaSearchEvent } from "@scholar/shared";
import { currentUser, sameOrigin } from "../auth/http";
import { hashEmbedder, workersAiEmbedder, type Embedder } from "../docs/embed";
import type { Complete, StreamComplete } from "../docs/qa";
import { AllProvidersFailedError, NoRouteError, QuotaError, gatewayFromEnv } from "../llm";
import type { S2Throttle } from "../s2-throttle";
import { sseStream } from "../sse";
import { PlanError, planIdea, scrubText } from "./plan";
import { compareIdea, sanitizeCompareRequest } from "./compare";
import { insightsIdea, sanitizeInsightsRequest } from "./insights";
import { runIdeaSearch, sanitizeRequest } from "./search";
import { stubCompareStream, stubInsightsStream, stubPlan, stubSearch } from "./stub";
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
  /** "1" (with ENABLE_DEV_ROUTES) swaps the model, embeddings and literature services for stand-ins in local tests. */
  QA_STUB?: string;
};
type Env = { Bindings: Bindings };
export const ideaRoutes = new Hono<Env>();

ideaRoutes.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});


const stubbed = (env: Bindings) => env.ENABLE_DEV_ROUTES === "1" && env.QA_STUB === "1";

function completeFor(env: Bindings, subject: string): Complete | null {
  if (stubbed(env)) return stubPlan;
  const gateway = gatewayFromEnv(env);
  return async (req) => {
    // The idea is the researcher's own, unpublished work: PRIVATE, so the gateway only uses providers that do not keep or train on it.
    const r = await gateway.complete({ task: "qa", sensitivity: "private", subject, system: req.system, user: req.user, schema: req.schema, maxTokens: req.maxTokens, label: req.label });
    return { json: r.json, model: r.model };
  };
}

function streamFor(env: Bindings, subject: string, abort: AbortSignal, stub: StreamComplete = stubCompareStream, timeoutMs = 90_000): StreamComplete | null {
  if (stubbed(env)) return stub;
  const gateway = gatewayFromEnv(env);
  return async (req, hooks) => {
    // Same PRIVATE route, quota and ledger as the plan; `abort` stops the model when the researcher leaves.
    const r = await gateway.stream({ task: "qa", sensitivity: "private", subject, system: req.system, user: req.user, schema: req.schema, maxTokens: req.maxTokens, timeoutMs, label: req.label }, hooks, abort);
    return { json: r.json, model: r.model };
  };
}

const embedderFor = (env: Bindings): Embedder | null => (stubbed(env) ? hashEmbedder : env.AI ? workersAiEmbedder(env.AI) : null);

/* ---------------------------------------------------------------- plan */

/**
 * The idea text arrives here, goes to the private model, and is not stored: no row, no log line (the request log carries the path only).
 * What comes back is the proposed search, which the researcher edits before anything goes to a search service.
 */
ideaRoutes.post("/plan", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in to check an idea");
  if (user.privacyAck !== PRIVACY_VERSION) return deny(c, 403, "privacy_ack_required", "Please read how your ideas are handled first", "A short note appears before your first check.");

  // 60,000 characters of text, even all multi-byte, fits well inside this; anything bigger is not an idea.
  if (Number(c.req.header("content-length") ?? 0) > 300_000) return deny(c, 413, "too_large", "That is too much text", "Use a shorter file or paste the key parts.");
  const body = (await c.req.json().catch(() => null)) as { text?: unknown; question?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.replace(/\r/g, "").trim().slice(0, MAX_IDEA_CHARS) : "";
  const question = scrubText(body?.question, MAX_IDEA_QUESTION_CHARS);
  if (text.length < MIN_IDEA_CHARS) return deny(c, 400, "invalid_idea", "Describe your idea in a few sentences", `At least ${MIN_IDEA_CHARS} characters, or add a file.`);

  const complete = completeFor(c.env, user.id);
  if (!complete) return deny(c, 503, "ai_unavailable", "Planning is unavailable right now");
  try {
    const { plan } = await planIdea({ text: text.slice(0, IDEA_PLAN_INPUT_CHARS), question, complete });
    return c.json<{ plan: IdeaPlan }>({ plan });
  } catch (e) {
    if (e instanceof QuotaError) return deny(c, 429, "quota", "You have used today's AI allowance", e.message);
    if (e instanceof NoRouteError) return deny(c, 503, "ai_unavailable", "Planning is unavailable right now");
    if (e instanceof PlanError) return deny(c, 502, "plan_failed", "We could not turn this into a search", "Try adding a sentence about the goal and the method.");
    if (e instanceof AllProvidersFailedError) {
      console.error(JSON.stringify({ level: "error", msg: "idea_plan_failed", attempts: e.attempts.map((a) => `${a.provider}:${a.ok ? "ok" : a.error}`) }));
      return deny(c, 502, "ai_failed", "The AI service could not read the idea just now", "Please try again in a moment.");
    }
    throw e;
  }
});

/* ---------------------------------------------------------------- search */

/**
 * Runs the approved plan. The answer is a server-sent-events stream (`stage`, `papers`, then `done`), so the closest papers appear while
 * the slower services are still answering.
 */
ideaRoutes.post("/search", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in to check an idea");

  const req = sanitizeRequest(await c.req.json().catch(() => null));
  if (!req) return deny(c, 400, "invalid_plan", "The search plan is empty", "Keep at least one keyword search, or a description of a few sentences.");

  return sseStream<IdeaSearchEvent>(c, { terminal: ["done", "error"], fallback: { type: "error", code: "internal_error", title: "Something went wrong" } }, async (sse) => {
    const send = sse.send;
    try {
      if (stubbed(c.env)) {
        await send({ type: "stage", stage: "searching" });
        await new Promise((r) => setTimeout(r, 150));
        await send({ type: "stage", stage: "checking" });
        await send({ type: "done", result: stubSearch(req) });
        return;
      }
      const result = await runIdeaSearch({ env: searchEnvFrom(c.env), embed: embedderFor(c.env), req, emit: send });
      await send({ type: "done", result });
    } catch (e) {
      console.error(JSON.stringify({ level: "error", msg: "idea_search_failed", error: e instanceof Error ? e.name : "unknown" }));
      await send({ type: "error", code: "internal_error", title: "The search failed", detail: "Please try again in a moment." });
    }
  });
});

/* ---------------------------------------------------------------- compare (M2) */

/**
 * Compares the closest papers with each part of the idea. The researcher asks for it (it costs AI use), the answer streams as stages, and every
 * match in it has a quote that was checked to be in the paper's abstract. Nothing is stored.
 */
ideaRoutes.post("/compare", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in to check an idea");
  if (user.privacyAck !== PRIVACY_VERSION) return deny(c, 403, "privacy_ack_required", "Please read how your ideas are handled first", "A short note appears before your first check.");
  if (Number(c.req.header("content-length") ?? 0) > 120_000) return deny(c, 413, "too_large", "That is too much text");

  const req = sanitizeCompareRequest(await c.req.json().catch(() => null));
  if (!req) return deny(c, 400, "invalid_compare", "There is nothing to compare", "Send the idea's plan and the papers to compare.");
  const abort = new AbortController();
  const stream = streamFor(c.env, user.id, abort.signal);
  if (!stream) return deny(c, 503, "ai_unavailable", "Comparing is unavailable right now");

  return sseStream<IdeaCompareEvent>(c, { terminal: ["done", "error"], fallback: { type: "error", code: "internal_error", title: "Something went wrong" }, abort }, async (sse) => {
    const send = sse.send;
    try {
      const comparison = await compareIdea({
        req,
        stream,
        hooks: { onStage: (stage) => void send({ type: "stage", stage }) },
        // Only with the local dev switch: show why a quote was dropped, to tune the prompt. Never in production.
        onDropped: c.env.ENABLE_DEV_ROUTES === "1" && !stubbed(c.env) ? (d) => console.log(JSON.stringify({ msg: "compare_dropped", facet: d.facet, quote: d.quote, abstract: d.abstract.slice(0, 700) })) : undefined,
      });
      await send({ type: "done", comparison });
    } catch (e) {
      if (e instanceof QuotaError) await send({ type: "error", code: "quota", title: "You have used today's AI allowance", detail: e.message });
      else if (e instanceof NoRouteError) await send({ type: "error", code: "ai_unavailable", title: "Comparing is unavailable right now" });
      else if (e instanceof AllProvidersFailedError) {
        console.error(JSON.stringify({ level: "error", msg: "idea_compare_failed", attempts: e.attempts.map((a) => `${a.provider}:${a.ok ? "ok" : a.error}`) }));
        await send({ type: "error", code: "ai_failed", title: "The AI service could not compare just now", detail: "Please try again in a moment." });
      } else {
        console.error(JSON.stringify({ level: "error", msg: "idea_compare_unexpected", error: e instanceof Error ? e.name : "unknown" }));
        await send({ type: "error", code: "internal_error", title: "The comparison failed", detail: "Please try again in a moment." });
      }
    }
  });
});

/* ---------------------------------------------------------------- insights (M3) */

/**
 * A second reading of the closest papers' abstracts: what the authors say is still open, what each paper reports, an answer to the researcher's question and a few
 * notes on practical feasibility. The researcher asks for it (it costs AI use). Every claim from a paper has a quote that was checked to be in its abstract; the notes
 * are labelled as the model's opinion. Nothing is stored.
 */
ideaRoutes.post("/insights", async (c) => {
  if (!sameOrigin(c)) return deny(c, 403, "forbidden", "Cross-origin request blocked");
  const user = await currentUser(c);
  if (!user) return deny(c, 401, "unauthorized", "Sign in to check an idea");
  if (user.privacyAck !== PRIVACY_VERSION) return deny(c, 403, "privacy_ack_required", "Please read how your ideas are handled first", "A short note appears before your first check.");
  if (Number(c.req.header("content-length") ?? 0) > 120_000) return deny(c, 413, "too_large", "That is too much text");

  const req = sanitizeInsightsRequest(await c.req.json().catch(() => null));
  if (!req) return deny(c, 400, "invalid_insights", "There is nothing to read", "Send the idea's plan and the papers to read.");
  const abort = new AbortController();
  // the second reading is the longest answer (about 80 s with the real model): a longer allowance than the comparison's
  const stream = streamFor(c.env, user.id, abort.signal, stubInsightsStream, 150_000);
  if (!stream) return deny(c, 503, "ai_unavailable", "Reading the papers is unavailable right now");

  return sseStream<IdeaInsightsEvent>(c, { terminal: ["done", "error"], fallback: { type: "error", code: "internal_error", title: "Something went wrong" }, abort }, async (sse) => {
    const send = sse.send;
    try {
      const insights = await insightsIdea({
        req,
        stream,
        hooks: { onStage: (stage) => void send({ type: "stage", stage }) },
        // Only with the local dev switch: show why a claim was dropped, to tune the prompt. Never in production.
        onDropped: c.env.ENABLE_DEV_ROUTES === "1" && !stubbed(c.env) ? (d) => console.log(JSON.stringify({ msg: "insights_dropped", kind: d.kind, quote: d.quote, statement: d.statement, abstract: d.abstract })) : undefined,
      });
      await send({ type: "done", insights });
    } catch (e) {
      if (e instanceof QuotaError) await send({ type: "error", code: "quota", title: "You have used today's AI allowance", detail: e.message });
      else if (e instanceof NoRouteError) await send({ type: "error", code: "ai_unavailable", title: "Reading the papers is unavailable right now" });
      else if (e instanceof AllProvidersFailedError) {
        console.error(JSON.stringify({ level: "error", msg: "idea_insights_failed", attempts: e.attempts.map((a) => `${a.provider}:${a.ok ? "ok" : a.error}`) }));
        await send({ type: "error", code: "ai_failed", title: "The AI service could not read the papers just now", detail: "Please try again in a moment." });
      } else {
        console.error(JSON.stringify({ level: "error", msg: "idea_insights_unexpected", error: e instanceof Error ? e.name : "unknown" }));
        await send({ type: "error", code: "internal_error", title: "Reading the papers failed", detail: "Please try again in a moment." });
      }
    }
  });
});
