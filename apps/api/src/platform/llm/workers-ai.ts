/**
 * Every call to Workers AI goes through here (docs/design/untangle.md, F8): the gateway's provider (providers/workersai.ts), the OCR page reader (ocr/read.ts) and the embeddings
 * (embedder.ts). Workers AI runs inside our own Cloudflare account, which is the only route a person's own text, files and questions may take (docs/llm-providers.md): Cloudflare does not
 * train on Customer Content and does not keep the inputs or outputs of standard inference. That holds only while a call is made without AI Gateway (the binding's third argument can send it
 * through a gateway that logs and caches), so this function never passes one, and refuses a body that asks for one.
 */

/** What Workers AI says a call used: the token counts under either name it uses (prompt/completion or input/output), the cached part of the input, and the neurons it bills. */
export type WorkersAiUsage = { tokensIn: number | null; tokensOut: number | null; tokensCached: number | null; neurons: number };

type RawUsage = { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; neurons?: number };

/** The usage of an answer, read once (bug B25: the stream's one-piece answer read only prompt/completion tokens, and so counted nothing for a model that says input/output). */
export function usageOf(answer: unknown): WorkersAiUsage {
  const u = (answer && typeof answer === "object" ? (answer as { usage?: RawUsage }).usage : undefined) ?? {};
  return {
    tokensIn: u.prompt_tokens ?? u.input_tokens ?? null,
    tokensOut: u.completion_tokens ?? u.output_tokens ?? null,
    tokensCached: u.prompt_tokens_details?.cached_tokens ?? null,
    neurons: u.neurons ?? 0,
  };
}

/**
 * One Workers AI call: `model` with `body`, as the binding takes them (the one cast of the binding's types is here). `signal` gives up waiting when it aborts (the binding itself has no abort:
 * the call goes on, its answer is dropped), with the error "timeout". `privacy` is what the caller sends: "private" (a person's own text) is the only kind the callers have today, and
 * every call keeps it so (no AI Gateway).
 */
export async function runWorkersAi<T = unknown>(ai: Ai, model: string, body: Record<string, unknown>, o: { signal?: AbortSignal; privacy: "private" }): Promise<T> {
  if ("gateway" in body) throw new Error("a Workers AI call never goes through AI Gateway");
  const run = (ai as unknown as { run(m: string, b: unknown): Promise<T> }).run(model, body);
  const signal = o.signal;
  if (!signal) return run;
  return (await Promise.race([run, new Promise<never>((_, rej) => signal.addEventListener("abort", () => rej(new Error("timeout")), { once: true }))])) as T;
}
