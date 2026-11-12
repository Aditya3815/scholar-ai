import { DEFAULT_CONFIG } from "./config";
import { cacheStore } from "../cache";
import { d1Ledger } from "./d1";
import { createGateway } from "./gateway";
import { geminiProvider } from "./providers/gemini";
import { workersAiProvider } from "./providers/workersai";
import type { LlmProvider } from "./types";
import type { EnvPick } from "../platform/env";

/** What the gateway reads: the ledger and the cache, the providers, and the development-only model choices (platform/env.ts says what each is). */
export type LlmEnv = EnvPick<"DB" | "GEMINI_API_KEY" | "ENABLE_DEV_ROUTES" | "LLM_QA_MODEL" | "LLM_CLASSIFY_MODEL" | "LLM_VERIFY_MODEL" | "LLM_REASONING", "CACHE" | "AI">;

/** Providers that are not configured (no binding / no key) are simply absent; routing skips them. */
export function gatewayFromEnv(env: LlmEnv) {
  const providers: Record<string, LlmProvider> = {};
  const dev = env.ENABLE_DEV_ROUTES === "1";
  const effort = dev && ["low", "medium", "high"].includes(env.LLM_REASONING ?? "") ? (env.LLM_REASONING as "low" | "medium" | "high") : undefined;
  if (env.AI) providers.workersai = workersAiProvider(env.AI, { reasoning: effort });
  if (env.GEMINI_API_KEY) providers.gemini = geminiProvider(env.GEMINI_API_KEY);
  const model = dev ? env.LLM_QA_MODEL?.trim() : undefined;
  const classify = dev ? env.LLM_CLASSIFY_MODEL?.trim() : undefined;
  const verify = dev ? env.LLM_VERIFY_MODEL?.trim() : undefined;
  const MODEL = /^@cf\/[\w.\-/]+$/;
  let config = DEFAULT_CONFIG;
  if (model && MODEL.test(model)) config = { ...config, routes: { ...config.routes, qa: { ...config.routes.qa, private: [{ provider: "workersai", model }] } } };
  if (classify && MODEL.test(classify)) config = { ...config, routes: { ...config.routes, classify: { ...config.routes.classify, private: [{ provider: "workersai", model: classify }] } } };
  if (verify && MODEL.test(verify)) config = { ...config, routes: { ...config.routes, verify: { ...config.routes.verify, private: [{ provider: "workersai", model: verify }] } } };
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
