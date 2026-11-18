import type { LlmProvider, ModelRef, Sensitivity } from "./types";

export class PolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyError";
  }
}

export class NoRouteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoRouteError";
  }
}

export class QuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaError";
  }
}

/** Hard rule: private data never reaches a provider that is not privateOk. Checked again right before every call. */
export function assertAllowed(provider: LlmProvider, sensitivity: Sensitivity): void {
  if (sensitivity === "private" && !provider.privateOk) {
    throw new PolicyError(`provider "${provider.id}" is not allowed to receive private data`);
  }
}

/**
 * Filters a configured fallback chain down to what policy permits. It never "downgrades": a private request whose
 * chain has no private-safe provider fails with NoRouteError instead of silently going to a public-only provider.
 */
export function selectChain(
  chain: ModelRef[],
  sensitivity: Sensitivity,
  providers: Record<string, LlmProvider>,
): { ref: ModelRef; provider: LlmProvider }[] {
  const allowed = chain
    .map((ref) => ({ ref, provider: providers[ref.provider] }))
    .filter((x): x is { ref: ModelRef; provider: LlmProvider } => !!x.provider)
    .filter((x) => sensitivity === "public" || x.provider.privateOk);
  if (allowed.length === 0) {
    throw new NoRouteError(`no ${sensitivity}-safe provider available for this task`);
  }
  return allowed;
}
