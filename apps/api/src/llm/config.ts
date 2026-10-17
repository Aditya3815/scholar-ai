import type { GatewayConfig } from "./gateway";

/**
 * Routing table: task x sensitivity -> ordered fallback chain.
 *
 * RULES (enforced by tests in gateway.test.ts):
 *  - Every "private" chain contains only privateOk providers (workersai). Never gemini, never OpenRouter free.
 *  - Only models that passed spike R2 (docs/spikes/R2-llm.md) are listed: workersai gpt-oss-120b (private-eligible)
 *    and gemini 3.5-flash-lite (public only). Re-run `scripts/r2/run.mjs` before adding or swapping a model.
 *  - Private chains have a single model for now: a second private fallback must be benchmarked first.
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
    review: {
      public: [{ provider: "workersai", model: "@cf/openai/gpt-oss-120b" }],
      private: [{ provider: "workersai", model: "@cf/openai/gpt-oss-120b" }],
    },
  },
  // Free Workers AI is 10k neurons/day for the whole account, so per-user quota stays small until paid.
  dailyTokenQuota: 60_000,
  perCallTimeoutMs: 25_000,
  publicCacheTtlSeconds: 7 * 24 * 3600,
  maxPromptChars: 60_000,
};
