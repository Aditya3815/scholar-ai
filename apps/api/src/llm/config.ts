import type { GatewayConfig } from "./gateway";
import type { ModelRef } from "./types";

/**
 * The Understand step's models, first to last. Set from the recorded eval (apps/api/eval/understand.eval.ts, docs/eval/understand/REPORT.md), not from the design's guess: see that report for the
 * accuracy and latency of each model measured on the same sets.
 */
export const UNDERSTAND_CHAIN: ModelRef[] = [{ provider: "workersai", model: "@cf/openai/gpt-oss-120b" }];

/**
 * Routing table: task x sensitivity -> ordered fallback chain.
 *
 * RULES (enforced by tests in gateway.test.ts):
 *  - Every "private" chain contains only privateOk providers (workersai). Never gemini, never OpenRouter free.
 *  - Only models that passed spike R2 (docs/spikes/R2-llm.md) are listed: workersai gpt-oss-120b (private-eligible)
 *    and gemini 3.5-flash-lite (public only). Re-run `scripts/r2/run.mjs` before adding or swapping a model.
 *  - Private chains have a single model for now (the `verify` task has two: both were benchmarked on the same labelled claims, scripts/support-eval.mjs): a second private fallback must be benchmarked first.
 */
export const DEFAULT_CONFIG: GatewayConfig = {
  routes: {
    classify: {
      public: [
        { provider: "gemini", model: "gemini-3.5-flash-lite" },
        { provider: "workersai", model: "@cf/openai/gpt-oss-120b" },
      ],
      private: [{ provider: "workersai", model: "@cf/openai/gpt-oss-120b" }],
    },
    summarize_public: {
      public: [
        { provider: "gemini", model: "gemini-3.5-flash-lite" },
        { provider: "workersai", model: "@cf/openai/gpt-oss-120b" },
      ],
      private: [{ provider: "workersai", model: "@cf/openai/gpt-oss-120b" }],
    },
    qa: {
      public: [
        { provider: "gemini", model: "gemini-3.5-flash-lite" },
        { provider: "workersai", model: "@cf/openai/gpt-oss-120b" },
      ],
      private: [{ provider: "workersai", model: "@cf/openai/gpt-oss-120b" }],
    },
    // The support judge (chat/support.ts, docs/design/claim-support.md): reads an answer's claims next to the abstracts they cite and says which sentences support each. Always PRIVATE (it
    // reads the answer to a person's question). Not gpt-oss-120b: it thinks for 10 s or more and its calls timed out; measured on 238 hand-labelled claims, Llama 3.3 70B found 40 of 41
    // unsupported claims in about 6.5 s, Mistral Small 3.1 38 of 41 in about 4 s (it is the fallback).
    verify: {
      public: [
        { provider: "workersai", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
        { provider: "workersai", model: "@cf/mistralai/mistral-small-3.1-24b-instruct" },
      ],
      private: [
        { provider: "workersai", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" },
        { provider: "workersai", model: "@cf/mistralai/mistral-small-3.1-24b-instruct" },
      ],
    },
    review: {
      public: [{ provider: "workersai", model: "@cf/openai/gpt-oss-120b" }],
      private: [{ provider: "workersai", model: "@cf/openai/gpt-oss-120b" }],
    },
    // The Understand step (understand/understand.ts; design of 6 Nov 2026): reads the person's own message and this chat's ledger, so PRIVATE, and Workers AI only in both chains (never the public
    // Gemini lane, also for a visitor). UNDERSTAND_CHAIN above says which models and why.
    understand: {
      public: UNDERSTAND_CHAIN,
      private: UNDERSTAND_CHAIN,
    },
  },
  // Free Workers AI is 10k neurons/day for the whole account, so per-user quota stays small until paid.
  dailyTokenQuota: 60_000,
  perCallTimeoutMs: 25_000,
  publicCacheTtlSeconds: 7 * 24 * 3600,
  maxPromptChars: 60_000,
};
