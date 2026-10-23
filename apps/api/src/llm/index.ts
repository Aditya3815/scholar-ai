import { DEFAULT_CONFIG } from "./config";
import { d1Ledger, d1ResponseCache } from "./d1";
import { createGateway } from "./gateway";
import { geminiProvider } from "./providers/gemini";
import { workersAiProvider } from "./providers/workersai";
import type { LlmProvider } from "./types";

export type LlmEnv = {
  DB: D1Database;
  AI?: Ai;
  GEMINI_API_KEY?: string;
  /**
   * Cost and quality experiments only (docs/spikes/R5-cost.md), and only where ENABLE_DEV_ROUTES is "1" (never in production): `LLM_QA_MODEL` sends the private
   * `qa` task to another Workers AI model, `LLM_REASONING` (low, medium, high) sets how long a gpt-oss model thinks. Neither exists in a deployed Worker.
   */
  ENABLE_DEV_ROUTES?: string;
  LLM_QA_MODEL?: string;
  LLM_REASONING?: string;
};

/** Providers that are not configured (no binding / no key) are simply absent; routing skips them. */
export function gatewayFromEnv(env: LlmEnv) {
  const providers: Record<string, LlmProvider> = {};
  const dev = env.ENABLE_DEV_ROUTES === "1";
  const effort = dev && ["low", "medium", "high"].includes(env.LLM_REASONING ?? "") ? (env.LLM_REASONING as "low" | "medium" | "high") : undefined;
  if (env.AI) providers.workersai = workersAiProvider(env.AI, { reasoning: effort });
  if (env.GEMINI_API_KEY) providers.gemini = geminiProvider(env.GEMINI_API_KEY);
  const model = dev ? env.LLM_QA_MODEL?.trim() : undefined;
  const config = model && /^@cf\/[\w.\-/]+$/.test(model) ? { ...DEFAULT_CONFIG, routes: { ...DEFAULT_CONFIG.routes, qa: { ...DEFAULT_CONFIG.routes.qa, private: [{ provider: "workersai", model }] } } } : DEFAULT_CONFIG;
  return createGateway({
    providers,
    ledger: d1Ledger(env.DB),
    cache: d1ResponseCache(env.DB),
    config,
  });
}

export * from "./gateway";
export * from "./types";
export { NoRouteError, PolicyError, QuotaError } from "./policy";
