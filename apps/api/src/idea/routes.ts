import { Hono } from "hono";
import { scrubText, IDEA_PLAN_INPUT_CHARS, MAX_IDEA_CHARS, MAX_IDEA_QUESTION_CHARS, MIN_IDEA_CHARS, type IdeaCompareEvent, type IdeaInsightsEvent, type IdeaPlan, type IdeaSearchEvent } from "@scholar/shared";
import { requireUser, type Door } from "../auth/service";
import { readJson } from "../platform/http/body";
import { PROFILES, modelFor } from "../platform/llm/profiles";
import { depsOf } from "../platform/deps";
import { AllProvidersFailedError, NoRouteError, QuotaError } from "../platform/llm";
import { sseStream } from "../sse";
import { PlanError, planIdea } from "./plan";
import { compareIdea, sanitizeCompareRequest } from "./compare";
import { insightsIdea } from "./insights";
import { sanitizeRequest } from "./search";
import { deny } from "../problem";
import type { HonoEnv } from "../platform/env";

export const ideaRoutes = new Hono<HonoEnv>();


/** Idea Check is for a signed-in person; what reads the idea's text with a model also needs the privacy note read. */
const IDEA: Door = { signIn: "Sign in to check an idea" };
const IDEA_TEXT: Door = { ...IDEA, ack: { title: "Please read how your ideas are handled first", detail: "A short note appears before your first check." } };

/**
 * Idea Check's models are profiles (platform/llm/profiles.ts), all PRIVATE (the idea is the researcher's own, unpublished work): `ideaPlan`, `ideaCompare` and `ideaInsights` (the second reading:
 * the longest answer, about 80 s with the real model, so the longest time limit). Which model answers, and the search of a plan, are the request's deps (app/deps.ts).
 */

/* ---------------------------------------------------------------- plan */

/**
 * The idea text arrives here, goes to the private model, and is not stored: no row, no log line (the request log carries the path only).
 * What comes back is the proposed search, which the researcher edits before anything goes to a search service.
 */
ideaRoutes.post("/plan", async (c) => {
  const got = await requireUser(c, IDEA_TEXT);
  if (got instanceof Response) return got;
  const { user } = got;

  // 60,000 characters of text, even all multi-byte, fits well inside this; anything bigger is not an idea.
  const sent = await readJson(c, 300_000);
  if (sent.tooLarge) return deny(c, 413, "too_large", "That is too much text", "Use a shorter file or paste the key parts.");
  const body = sent.value as { text?: unknown; question?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.replace(/\r/g, "").trim().slice(0, MAX_IDEA_CHARS) : "";
  const question = scrubText(body?.question, MAX_IDEA_QUESTION_CHARS);
  if (text.length < MIN_IDEA_CHARS) return deny(c, 400, "invalid_idea", "Describe your idea in a few sentences", `At least ${MIN_IDEA_CHARS} characters, or add a file.`);

  const complete = modelFor(depsOf(c), PROFILES.ideaPlan, user.id);
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
  const got = await requireUser(c, IDEA);
  if (got instanceof Response) return got;

  const req = sanitizeRequest(await readJson(c));
  if (!req) return deny(c, 400, "invalid_plan", "The search plan is empty", "Keep at least one keyword search, or a description of a few sentences.");

  const deps = depsOf(c);
  return sseStream<IdeaSearchEvent>(c, { terminal: ["done", "error"], fallback: { type: "error", code: "internal_error", title: "Something went wrong" } }, async (sse) => {
    const send = sse.send;
    try {
      const result = await deps.ideaSearch(req, send);
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
  const got = await requireUser(c, IDEA_TEXT);
  if (got instanceof Response) return got;
  const { user } = got;
  const sent = await readJson(c, 120_000);
  if (sent.tooLarge) return deny(c, 413, "too_large", "That is too much text");

  const req = sanitizeCompareRequest(sent.value);
  if (!req) return deny(c, 400, "invalid_compare", "There is nothing to compare", "Send the idea's plan and the papers to compare.");
  const abort = new AbortController();
  const deps = depsOf(c);
  const stream = modelFor(deps, PROFILES.ideaCompare, user.id, abort.signal);
  if (!stream) return deny(c, 503, "ai_unavailable", "Comparing is unavailable right now");

  return sseStream<IdeaCompareEvent>(c, { terminal: ["done", "error"], fallback: { type: "error", code: "internal_error", title: "Something went wrong" }, abort }, async (sse) => {
    const send = sse.send;
    try {
      const comparison = await compareIdea({
        req,
        stream,
        hooks: { onStage: (stage) => void send({ type: "stage", stage }) },
        // Only with the local dev switch: show why a quote was dropped, to tune the prompt. Never in production.
        onDropped: deps.dev.on && !deps.dev.standIns ? (d) => console.log(JSON.stringify({ msg: "compare_dropped", facet: d.facet, quote: d.quote, abstract: d.abstract.slice(0, 700) })) : undefined,
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
  const got = await requireUser(c, IDEA_TEXT);
  if (got instanceof Response) return got;
  const { user } = got;
  const sent = await readJson(c, 120_000);
  if (sent.tooLarge) return deny(c, 413, "too_large", "That is too much text");

  // the request is the same as the comparison's: the plan, the question, and the papers with their abstracts
  const req = sanitizeCompareRequest(sent.value);
  if (!req) return deny(c, 400, "invalid_insights", "There is nothing to read", "Send the idea's plan and the papers to read.");
  const abort = new AbortController();
  // the second reading is the longest answer (about 80 s with the real model): a longer allowance than the comparison's
  const deps = depsOf(c);
  const stream = modelFor(deps, PROFILES.ideaInsights, user.id, abort.signal);
  if (!stream) return deny(c, 503, "ai_unavailable", "Reading the papers is unavailable right now");

  return sseStream<IdeaInsightsEvent>(c, { terminal: ["done", "error"], fallback: { type: "error", code: "internal_error", title: "Something went wrong" }, abort }, async (sse) => {
    const send = sse.send;
    try {
      const insights = await insightsIdea({
        req,
        stream,
        hooks: { onStage: (stage) => void send({ type: "stage", stage }) },
        // Only with the local dev switch: show why a claim was dropped, to tune the prompt. Never in production.
        onDropped: deps.dev.on && !deps.dev.standIns ? (d) => console.log(JSON.stringify({ msg: "insights_dropped", kind: d.kind, quote: d.quote, statement: d.statement, abstract: d.abstract })) : undefined,
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
