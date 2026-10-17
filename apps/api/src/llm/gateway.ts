import { NoRouteError, PolicyError, QuotaError, assertAllowed, selectChain } from "./policy";
import type {
  Attempt,
  Ledger,
  LlmProvider,
  LlmRequest,
  LlmResult,
  ModelRef,
  ResponseCache,
  Sensitivity,
  TaskKind,
} from "./types";

export type GatewayConfig = {
  routes: Record<TaskKind, Record<Sensitivity, ModelRef[]>>;
  /** Tokens (in + out) a subject may use per UTC day, across all tasks. */
  dailyTokenQuota: number;
  perCallTimeoutMs: number;
  /** Responses to PUBLIC requests are cached; private requests are never cached. */
  publicCacheTtlSeconds: number;
  maxPromptChars: number;
};

export type GatewayDeps = {
  providers: Record<string, LlmProvider>;
  ledger: Ledger;
  cache?: ResponseCache;
  config: GatewayConfig;
};

export class AllProvidersFailedError extends Error {
  constructor(public attempts: Attempt[]) {
    super(`all providers failed: ${attempts.map((a) => `${a.provider}/${a.model}: ${a.error}`).join(" | ")}`);
    this.name = "AllProvidersFailedError";
  }
}

/** Models sometimes wrap JSON in prose or markdown; take the outermost {...} or [...]. */
export function extractJson(text: string): unknown {
  const starts = [text.indexOf("{"), text.indexOf("[")].filter((i) => i >= 0);
  if (starts.length === 0) throw new Error("no JSON in output");
  const s = Math.min(...starts);
  const e = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (e <= s) throw new Error("unterminated JSON");
  return JSON.parse(text.slice(s, e + 1));
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createGateway(deps: GatewayDeps) {
  const { providers, ledger, cache, config } = deps;

  async function complete(req: LlmRequest): Promise<LlmResult> {
    if (!req.system.trim() || !req.user.trim()) throw new Error("system and user prompts are required");
    if (req.system.length + req.user.length > config.maxPromptChars) {
      throw new Error(`prompt too long (max ${config.maxPromptChars} characters)`);
    }

    // 1. Quota (cheap D1 read) before spending any provider budget.
    const used = await ledger.tokensToday(req.subject);
    if (used >= config.dailyTokenQuota) {
      throw new QuotaError(`daily AI quota reached (${used}/${config.dailyTokenQuota} tokens); resets 00:00 UTC`);
    }

    // 2. Route. Throws NoRouteError if no provider is allowed for this sensitivity (never silently downgrades).
    const chain = selectChain(config.routes[req.task][req.sensitivity], req.sensitivity, providers);

    // 3. Public-only response cache.
    let cacheKey: string | null = null;
    if (cache && req.sensitivity === "public") {
      cacheKey = `llm:${await sha256(JSON.stringify([req.task, req.system, req.user, req.schema ?? null]))}`;
      const hit = await cache.get(cacheKey);
      if (hit) return { ...(JSON.parse(hit) as LlmResult), cached: true, attempts: [] };
    }

    // 4. Fallback chain.
    const attempts: Attempt[] = [];
    for (const { ref, provider } of chain) {
      assertAllowed(provider, req.sensitivity); // defence in depth: re-checked immediately before the call
      const t0 = Date.now();
      try {
        const r = await provider.complete(
          ref.model,
          { system: req.system, user: req.user, schema: req.schema, maxTokens: req.maxTokens },
          AbortSignal.timeout(config.perCallTimeoutMs),
        );
        let json: unknown;
        if (req.schema) json = extractJson(r.text); // invalid JSON counts as a failed attempt -> next provider
        const ms = Date.now() - t0;
        attempts.push({ provider: ref.provider, model: ref.model, ok: true, ms });

        await ledger
          .record({
            subject: req.subject,
            task: req.task,
            sensitivity: req.sensitivity,
            provider: ref.provider,
            model: ref.model,
            tokensIn: r.tokensIn ?? Math.ceil((req.system.length + req.user.length) / 4),
            tokensOut: r.tokensOut ?? Math.ceil(r.text.length / 4),
            costCents: 0, // free tiers for now; real pricing arrives with paid providers
            ok: true,
            ms,
          })
          .catch((e) => console.warn("ledger write failed", e));

        const result: LlmResult = {
          text: r.text,
          json,
          provider: ref.provider,
          model: ref.model,
          tokensIn: r.tokensIn,
          tokensOut: r.tokensOut,
          ms,
          cached: false,
          attempts,
        };
        if (cache && cacheKey) {
          await cache.set(cacheKey, JSON.stringify(result), config.publicCacheTtlSeconds).catch(() => {});
        }
        return result;
      } catch (e) {
        if (e instanceof PolicyError) throw e; // never swallow a policy violation by moving on
        attempts.push({ provider: ref.provider, model: ref.model, ok: false, ms: Date.now() - t0, error: errMsg(e) });
      }
    }

    const last = attempts[attempts.length - 1]!;
    await ledger
      .record({
        subject: req.subject, task: req.task, sensitivity: req.sensitivity,
        provider: last.provider, model: last.model, tokensIn: 0, tokensOut: 0, costCents: 0, ok: false, ms: last.ms,
      })
      .catch(() => {});
    throw new AllProvidersFailedError(attempts);
  }

  return { complete };
}

export type Gateway = ReturnType<typeof createGateway>;
export { NoRouteError, PolicyError, QuotaError };
