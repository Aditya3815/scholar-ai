/**
 * LLM Gateway types.
 *
 * Sensitivity is the core idea: "private" data (a user's unpublished manuscript, their questions about it) may only
 * reach providers marked `privateOk`. Providers whose terms allow training on prompts (Google AI Studio unpaid tier,
 * OpenRouter free models, ...) are never `privateOk`. See docs/llm-providers.md.
 */
export type Sensitivity = "public" | "private";

export type TaskKind = "classify" | "summarize_public" | "qa" | "review";

export type JsonSchema = Record<string, unknown>;

export type LlmRequest = {
  task: TaskKind;
  sensitivity: Sensitivity;
  /** User id or "anon:<hash>"; used for quota and the usage ledger. */
  subject: string;
  system: string;
  user: string;
  /** If set, output must be JSON matching this schema (enforced by the provider where supported, then parsed). */
  schema?: JsonSchema;
  maxTokens?: number;
};

export type ProviderRequest = Pick<LlmRequest, "system" | "user" | "schema" | "maxTokens">;

export type ProviderResponse = {
  text: string;
  tokensIn: number | null;
  tokensOut: number | null;
};

/** Callbacks for streaming a completion. Reasoning models think silently first; `onThinking` tells the caller they are working. */
export type StreamHooks = {
  onThinking?: () => void;
  /** A piece of the model's output text (for a JSON schema request: a piece of the JSON). */
  onContent?: (delta: string) => void;
};

export interface LlmProvider {
  id: string;
  /** True only if the provider's terms forbid training on / human review of API data. */
  privateOk: boolean;
  complete(model: string, req: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse>;
  /** Optional. Providers without it are called with `complete` and their whole answer is delivered as one piece. */
  stream?(model: string, req: ProviderRequest, signal: AbortSignal, hooks: StreamHooks): Promise<ProviderResponse>;
}

export type ModelRef = { provider: string; model: string };

export type Attempt = { provider: string; model: string; ok: boolean; ms: number; error?: string };

export type LlmResult = {
  text: string;
  /** Parsed JSON when `schema` was given. */
  json?: unknown;
  provider: string;
  model: string;
  tokensIn: number | null;
  tokensOut: number | null;
  ms: number;
  cached: boolean;
  attempts: Attempt[];
};

export type UsageRow = {
  subject: string;
  task: TaskKind;
  sensitivity: Sensitivity;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  ok: boolean;
  ms: number;
};

export interface Ledger {
  /** Tokens (in + out) used by `subject` since 00:00 UTC today. */
  tokensToday(subject: string): Promise<number>;
  record(row: UsageRow): Promise<void>;
}

export interface ResponseCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}
