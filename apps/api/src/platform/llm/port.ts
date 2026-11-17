import type { ModelOverrides } from "../dev";
import type { Sensitivity, TaskKind } from "./types";

/**
 * The model port (docs/design/untangle.md, F8): what a feature asks a language model for, with no binding, no gateway and no provider in it, so that understand/ may import it
 * (legal-match.test.ts, rule 3) and every feature asks the same way. The gateway that answers it (gateway.ts, models.ts) and the stand-ins of a test run (app/stand-ins.ts) both implement
 * `Models`; which one a request gets is decided at the composition root (app/deps.ts).
 */

/** One request: the prompts, the JSON schema of the answer, its token limit and the feature's label for the ledger. */
export type ModelRequest = { system: string; user: string; schema: Record<string, unknown>; maxTokens: number; label?: string };

/** The answer: the parsed JSON, the model that gave it, and (from the gateway) what the call used. */
export type ModelReply = { json: unknown; model: string; usage?: { tokensIn: number | null; tokensOut: number | null } };

/** Hooks of a streaming call: a reasoning model thinks silently first (`onThinking`), then the JSON text arrives in pieces (`onContent`). */
export type ModelHooks = { onThinking?: () => void; onContent?: (delta: string) => void };

/** The language model, one call. */
export type Complete = (req: ModelRequest) => Promise<ModelReply>;

/** The language model, streaming: hooks fire as it thinks and as the JSON text arrives. Resolves with the full parsed JSON. */
export type StreamComplete = (req: ModelRequest, hooks: ModelHooks) => Promise<ModelReply>;

/** Texts to vectors (the embeddings model). */
export type Embedder = (texts: string[]) => Promise<number[][]>;

/**
 * One use of a model, named once (profiles.ts): the gateway's task and sensitivity, the time the call may take (the gateway's default when not set) and, when the use fixes it, its token limit
 * (otherwise the caller's request says it).
 */
export type ModelProfile<K extends "complete" | "stream" = "complete" | "stream"> = {
  name: string;
  kind: K;
  task: TaskKind;
  sensitivity: Sensitivity;
  timeoutMs?: number;
  maxTokens?: number;
};

/** Every model use, by profile: the gateway's, or a test run's stand-ins. */
export type Models = {
  complete(profile: ModelProfile<"complete">, subject: string): Complete;
  stream(profile: ModelProfile<"stream">, subject: string, abort?: AbortSignal): StreamComplete;
  /** The same with other development model choices (the development judge's `model` and `reasoning`). A stand-in ignores them. */
  withOverrides(overrides: ModelOverrides): Models;
};

export { classifyFailure, isMalformed, type ModelFailure } from "./failure";
export { withMalformedRetry } from "./retry";
