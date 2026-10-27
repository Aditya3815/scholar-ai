import { DEFAULT_CONFIG } from "./config";
import { cacheStore } from "../cache";
import { d1Ledger } from "./d1";
import { createGateway } from "./gateway";
import { geminiProvider } from "./providers/gemini";
import { workersAiProvider } from "./providers/workersai";
import type { LlmProvider } from "./types";

export type LlmEnv = {
  DB: D1Database;
  CACHE?: KVNamespace;
  AI?: Ai;
  GEMINI_API_KEY?: string;
  /**
   * Cost and quality experiments only (docs/spikes/R5-cost.md), and only where ENABLE_DEV_ROUTES is "1" (never in production): `LLM_QA_MODEL` sends the private
   * `qa` task to another Workers AI model, `LLM_REASONING` (low, medium, high) sets how long a gpt-oss model thinks. Neither exists in a deployed Worker.
   */
  ENABLE_DEV_ROUTES?: string;
  LLM_QA_MODEL?: string;
  /** The same for the private `classify` task (the router of Auto mode: docs/design/p7-latency.md). */
  LLM_CLASSIFY_MODEL?: string;
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
  const classify = dev ? env.LLM_CLASSIFY_MODEL?.trim() : undefined;
  const MODEL = /^@cf\/[\w.\-/]+$/;
  let config = DEFAULT_CONFIG;
  if (model && MODEL.test(model)) config = { ...config, routes: { ...config.routes, qa: { ...config.routes.qa, private: [{ provider: "workersai", model }] } } };
  if (classify && MODEL.test(classify)) config = { ...config, routes: { ...config.routes, classify: { ...config.routes.classify, private: [{ provider: "workersai", model: classify }] } } };
  return createGateway({
    providers,
    ledger: d1Ledger(env.DB),
    cache: cacheStore(env), // only PUBLIC requests are ever cached by the gateway (private ones never reach it)
    config,
  });
}

export * from "./gateway";
export * from "./types";
export { NoRouteError, PolicyError, QuotaError } from "./policy";
