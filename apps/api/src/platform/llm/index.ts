import { DEFAULT_CONFIG } from "./config";
import { cacheStore } from "../../cache";
import { d1Ledger } from "./d1";
import { createGateway } from "./gateway";
import { geminiProvider } from "./providers/gemini";
import { workersAiProvider } from "./providers/workersai";
import type { LlmProvider } from "./types";
import type { EnvPick } from "../env";
import { modelOverrides, type ModelOverrides } from "../dev";

/** What the gateway reads: the ledger and the cache, the providers, and the development-only model choices (platform/env.ts says what each is). */
export type LlmEnv = EnvPick<"DB" | "GEMINI_API_KEY" | "ENABLE_DEV_ROUTES" | "LLM_QA_MODEL" | "LLM_CLASSIFY_MODEL" | "LLM_VERIFY_MODEL" | "LLM_REASONING", "CACHE" | "AI">;

/**
 * Providers that are not configured (no binding / no key) are simply absent; routing skips them. `overrides` are the development model choices (platform/dev.ts: one map, empty outside
 * development mode): each sends its private task to the Workers AI model it names, and `reasoning` sets how long a gpt-oss model thinks.
 */
export function gatewayFromEnv(env: LlmEnv, overrides: ModelOverrides = modelOverrides(env)) {
  const providers: Record<string, LlmProvider> = {};
  if (env.AI) providers.workersai = workersAiProvider(env.AI, { reasoning: overrides.reasoning });
  if (env.GEMINI_API_KEY) providers.gemini = geminiProvider(env.GEMINI_API_KEY);
  let config = DEFAULT_CONFIG;
  for (const task of ["qa", "classify", "verify"] as const) {
    const model = overrides[task];
    if (model) config = { ...config, routes: { ...config.routes, [task]: { ...config.routes[task], private: [{ provider: "workersai", model }] } } };
  }
  return createGateway({
    providers,
    ledger: d1Ledger(env.DB),
    cache: cacheStore(env), // only PUBLIC requests are ever cached by the gateway (private ones never reach it)
    config,
  });
}

/**
 * What is left of `subject`'s daily allowance, by the gateway's own numbers (its quota, DEFAULT_CONFIG, and its ledger): a feature that must know before it starts (a literature scan, a follow-up
 * read with its earlier turns) asks here instead of computing it again. `left` can be below 0 when a last call went over.
 */
export async function allowanceOf(db: D1Database, subject: string): Promise<{ limit: number; used: number; left: number }> {
  const used = await d1Ledger(db).tokensToday(subject);
  return { limit: DEFAULT_CONFIG.dailyTokenQuota, used, left: DEFAULT_CONFIG.dailyTokenQuota - used };
}

export * from "./gateway";
export * from "./types";
export { NoRouteError, PolicyError, QuotaError } from "./policy";
