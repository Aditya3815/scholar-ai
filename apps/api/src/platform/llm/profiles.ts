import type { Complete, ModelProfile, Models, StreamComplete } from "./port";

/**
 * Every use of a language model, named once (docs/design/untangle.md, F8), with the task, the sensitivity, the time limit and the token limit each had in its own feature before (the numbers
 * are pinned by profiles.table.test.ts). Every one is PRIVATE: each reads a person's own words (a message, an idea, a topic, a question about a paper) or an answer written for them, so the
 * gateway uses only providers that do not keep or train on it.
 */
const complete = (name: string, task: ModelProfile["task"], more: { timeoutMs?: number; maxTokens?: number } = {}): ModelProfile<"complete"> => ({ name, kind: "complete", task, sensitivity: "private", ...more });
const stream = (name: string, task: ModelProfile["task"], more: { timeoutMs?: number; maxTokens?: number } = {}): ModelProfile<"stream"> => ({ name, kind: "stream", task, sensitivity: "private", ...more });

export const PROFILES = {
  /** The router of Auto mode (chat/router.ts): which tool a message is for, and a follow-up read with its earlier turns. */
  route: complete("route", "classify", { timeoutMs: 30_000 }),
  /** The Understand step (understand/understand.ts): the step itself gives up sooner (UNDERSTAND_TIMEOUT_MS) and lets the rules decide. */
  understand: complete("understand", "understand", { timeoutMs: 8_000 }),
  /** The conversation reply of the Understand step (intent `chat`): a few lines. */
  chatReply: complete("chatReply", "understand", { timeoutMs: 15_000 }),
  /** The prompt box's answer from the papers, and the background from general knowledge (chat/answer.ts, chat/general.ts). */
  write: stream("write", "qa", { timeoutMs: 60_000 }),
  /** The support judge (chat/support.ts): shorter than the answer's; a judge that takes longer is not waited for. */
  judge: stream("judge", "verify", { timeoutMs: 20_000 }),
  /** "Check strictly" and the MCP tool check_claim: the stronger model, which thinks before it answers (20 to 45 s), with its own token limit. */
  strict: stream("strict", "qa", { timeoutMs: 75_000, maxTokens: 4500 }),
  /** A question about a paper of one's own, or an open-access paper, and about one's highlights (docs/qa.ts, docs/highlights-qa.ts): the gateway's own time limit. */
  docsAsk: complete("docsAsk", "qa"),
  /** The same, streamed. */
  docsAskStream: stream("docsAskStream", "qa"),
  /** Idea Check's search plan (idea/plan.ts). */
  ideaPlan: complete("ideaPlan", "qa"),
  /** Idea Check's comparison of the closest papers with each part of the idea (idea/compare.ts). */
  ideaCompare: stream("ideaCompare", "qa", { timeoutMs: 90_000 }),
  /** Idea Check's second reading (idea/insights.ts): the longest answer (about 80 s with the real model). */
  ideaInsights: stream("ideaInsights", "qa", { timeoutMs: 150_000 }),
  /** A literature scan's plan (litscan/plan.ts). */
  litscanPlan: complete("litscanPlan", "qa", { timeoutMs: 45_000 }),
  /** The answer of one sub-question of a scan (litscan/worker.ts). */
  litscanAnswer: stream("litscanAnswer", "qa", { timeoutMs: 80_000 }),
  /** The support judge of one sub-question of a scan: its own short time limit. */
  litscanJudge: stream("litscanJudge", "verify", { timeoutMs: 25_000 }),
} as const;

export type ProfileName = keyof typeof PROFILES;

/** A development profile: one of the above with another time limit (the development judge, POST /api/v1/chat/judge, which measures the judge at the limit it is sent). Its name stays the profile's. */
export const withTimeout = <K extends "complete" | "stream">(p: ModelProfile<K>, timeoutMs: number): ModelProfile<K> => ({ ...p, timeoutMs });

/** The model of a profile for `subject` (whose daily allowance it uses): the gateway's, or in a test run its stand-in (app/stand-ins.ts). `abort` stops a streaming call when the reader leaves. */
export function modelFor(d: { models: Models }, profile: ModelProfile<"complete">, subject: string): Complete;
export function modelFor(d: { models: Models }, profile: ModelProfile<"stream">, subject: string, abort?: AbortSignal): StreamComplete;
export function modelFor(d: { models: Models }, profile: ModelProfile, subject: string, abort?: AbortSignal): Complete | StreamComplete {
  return profile.kind === "complete" ? d.models.complete(profile as ModelProfile<"complete">, subject) : d.models.stream(profile as ModelProfile<"stream">, subject, abort);
}
