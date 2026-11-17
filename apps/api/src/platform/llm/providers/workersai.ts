import type { LlmProvider, ProviderRequest, ProviderResponse, StreamHooks } from "../types";

type AiResult = {
  response?: unknown;
  choices?: { message?: { content?: string } }[];
  output?: { type?: string; content?: { text?: string }[] }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
};

/** Input tokens served from the provider's prompt cache, when it says so (it reports 0 for every model we use today). */
const usageDetail = (u: AiResult["usage"]) => ({ tokensCached: u?.prompt_tokens_details?.cached_tokens ?? null });

function extractText(r: AiResult | string): string {
  if (typeof r === "string") return r;
  if (typeof r.response === "string") return r.response;
  if (r.response && typeof r.response === "object") return JSON.stringify(r.response); // json_schema mode can return a parsed object
  const choice = r.choices?.[0]?.message?.content;
  if (choice) return choice;
  const msg = r.output?.find((o) => o.type === "message");
  return msg?.content?.map((c) => c.text ?? "").join("") ?? "";
}

/**
 * Cloudflare Workers AI: runs inside our own account, so no third party sees the data. Cloudflare's data-usage
 * page (checked 2026-10-17) states it does not train on Customer Content and does not retain inputs/outputs of
 * standard inference. Keep it that way: do NOT route Workers AI calls through AI Gateway to other vendors, and
 * do not enable AI Gateway logging/caching for private requests.
 * Spike R2 finding: without `response_format`, gpt-oss returns raw Harmony tokens instead of JSON,
 * so structured output is always requested through json_schema.
 */
function buildBody(model: string, req: ProviderRequest, reasoning: "low" | "medium" | "high" = "low"): Record<string, unknown> {
  const body: Record<string, unknown> = {
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    max_tokens: req.maxTokens ?? 1500,
    temperature: 0,
  };
  if (req.schema) body.response_format = { type: "json_schema", json_schema: { name: "output", schema: req.schema } };
  if (model.includes("gpt-oss")) body.reasoning = { effort: reasoning };
  return body;
}

type Chunk = {
  choices?: { delta?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
};

/** Reads an OpenAI-style server-sent-events stream: calls the hooks as pieces arrive and returns the whole text and token counts. */
export async function readChatStream(stream: ReadableStream<Uint8Array>, hooks: StreamHooks, signal: AbortSignal): Promise<ProviderResponse> {
  const reader = stream.getReader();
  const onAbort = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", onAbort, { once: true });
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let tokensIn: number | null = null;
  let tokensOut = 0;
  let tokensCached: number | null = null;
  /**
   * Workers AI reports usage twice in a stream: a small amount with nearly every chunk (the tokens of that chunk), and, in the last chunk, the TOTALS for the whole
   * call (measured 23 Oct 2026: 60 chunks, the pieces added up to 66 completion tokens and the last chunk said 66). Adding the totals to the pieces counted every
   * output token twice. A chunk that has both an input and an output count is the totals; when one arrives it replaces what was added up.
   */
  const seen: { totals: { in: number; out: number } | null } = { totals: null };
  let thinking = false;
  const handle = (block: string) => {
    for (const line of block.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let chunk: Chunk;
      try {
        chunk = JSON.parse(data) as Chunk;
      } catch {
        continue; // a keep-alive or a partial line; the next block carries the data
      }
      if (chunk.usage?.prompt_tokens && tokensIn === null) tokensIn = chunk.usage.prompt_tokens;
      tokensOut += chunk.usage?.completion_tokens ?? 0;
      if ((chunk.usage?.prompt_tokens ?? 0) > 0 && (chunk.usage?.completion_tokens ?? 0) > 0) seen.totals = { in: chunk.usage!.prompt_tokens!, out: chunk.usage!.completion_tokens! };
      tokensCached = chunk.usage?.prompt_tokens_details?.cached_tokens ?? tokensCached;
      const d = chunk.choices?.[0]?.delta;
      if (!d) continue;
      if ((d.reasoning || d.reasoning_content) && !thinking) {
        thinking = true;
        hooks.onThinking?.();
      }
      if (d.content) {
        text += d.content;
        hooks.onContent?.(d.content);
      }
    }
  };
  try {
    for (;;) {
      if (signal.aborted) throw new Error("timeout");
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        handle(buf.slice(0, i));
        buf = buf.slice(i + 2);
      }
    }
    if (buf.trim()) handle(buf);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  if (signal.aborted) throw new Error("timeout");
  if (seen.totals) return { text, tokensIn: seen.totals.in, tokensOut: seen.totals.out, tokensCached };
  return { text, tokensIn, tokensOut: tokensOut || null, tokensCached };
}

export function workersAiProvider(ai: Ai, opts: { reasoning?: "low" | "medium" | "high" } = {}): LlmProvider {
  return {
    id: "workersai",
    privateOk: true,
    async complete(model, req: ProviderRequest, signal): Promise<ProviderResponse> {
      const body = buildBody(model, req, opts.reasoning);

      // `signal` is honoured by the caller racing a timeout; Workers AI binding has no abort option.
      const r = (await Promise.race([
        (ai as unknown as { run(m: string, b: unknown): Promise<AiResult> }).run(model, body),
        new Promise<never>((_, rej) => signal.addEventListener("abort", () => rej(new Error("timeout")), { once: true })),
      ])) as AiResult;

      return {
        text: extractText(r),
        tokensIn: r.usage?.prompt_tokens ?? r.usage?.input_tokens ?? null,
        tokensOut: r.usage?.completion_tokens ?? r.usage?.output_tokens ?? null,
        ...usageDetail(r.usage),
      };
    },

    async stream(model, req: ProviderRequest, signal, hooks): Promise<ProviderResponse> {
      const out = (await (ai as unknown as { run(m: string, b: unknown): Promise<unknown> }).run(model, { ...buildBody(model, req, opts.reasoning), stream: true })) as ReadableStream<Uint8Array> | AiResult | string;
      if (out instanceof ReadableStream) return readChatStream(out, hooks, signal);
      // The binding answered without a stream (some models ignore the flag): deliver it as one piece.
      const r = out as AiResult;
      const text = extractText(r);
      hooks.onContent?.(text);
      return { text, tokensIn: typeof r === "object" ? r.usage?.prompt_tokens ?? null : null, tokensOut: typeof r === "object" ? r.usage?.completion_tokens ?? null : null, ...(typeof r === "object" ? usageDetail(r.usage) : {}) };
    },
  };
}
