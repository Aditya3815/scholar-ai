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
};

/** Providers that are not configured (no binding / no key) are simply absent; routing skips them. */
export function gatewayFromEnv(env: LlmEnv) {
  const providers: Record<string, LlmProvider> = {};
  if (env.AI) providers.workersai = workersAiProvider(env.AI);
  if (env.GEMINI_API_KEY) providers.gemini = geminiProvider(env.GEMINI_API_KEY);
  return createGateway({
    providers,
    ledger: d1Ledger(env.DB),
    cache: d1ResponseCache(env.DB),
    config: DEFAULT_CONFIG,
  });
}

export * from "./gateway";
export * from "./types";
export { NoRouteError, PolicyError, QuotaError } from "./policy";
