/**
 * What a model call costs, from the provider's published price per million tokens (USD). Without this the ledger said 0 for everything and cost could not be
 * reviewed. Workers AI prices: https://developers.cloudflare.com/workers-ai/platform/pricing/ (read 2026-10-23; $0.011 per 1,000 neurons above the free 10,000 a day).
 * Re-read the page when a model is added or every few months; `pricing.test.ts` fails if a model that is routed to has no price here.
 */
export type Price = { in: number; out: number; /** per million cached input tokens, when the provider discounts them */ cachedIn?: number };

export const PRICES: Record<string, Price> = {
  "@cf/openai/gpt-oss-120b": { in: 0.35, out: 0.75 },
  "@cf/openai/gpt-oss-20b": { in: 0.2, out: 0.3 },
  "@cf/google/gemma-4-26b-a4b-it": { in: 0.1, out: 0.3 },
  "@cf/qwen/qwen3-30b-a3b-fp8": { in: 0.051, out: 0.335 },
  "@cf/meta/llama-3.1-8b-instruct-fp8-fast": { in: 0.045, out: 0.384 },
  "@cf/meta/llama-4-scout-17b-16e-instruct": { in: 0.27, out: 0.85 },
  "@cf/mistralai/mistral-small-3.1-24b-instruct": { in: 0.351, out: 0.555 },
  "@cf/baai/bge-m3": { in: 0.012, out: 0 },
  // Google AI Studio's unpaid tier (public tasks only): no charge. If this key is ever put on a paid plan, price it here first.
  "gemini-3.5-flash-lite": { in: 0, out: 0 },
};

/** Workers AI bills vision calls (scanned pages) in neurons: $0.011 per 1,000 above the free 10,000 a day. */
export const NEURON_CENTS = 0.0011;

/** Cost of one call in cents (a fraction of a cent for a normal call). A model with no price counts as 0 and `known` says so. */
export function costCents(model: string, tokensIn: number, tokensOut: number, tokensCached = 0): { cents: number; known: boolean } {
  const p = PRICES[model];
  if (!p) return { cents: 0, known: false };
  const cached = Math.min(Math.max(0, tokensCached), tokensIn);
  const dollars = ((tokensIn - cached) * p.in + cached * (p.cachedIn ?? p.in) + tokensOut * p.out) / 1_000_000;
  return { cents: dollars * 100, known: true };
}
