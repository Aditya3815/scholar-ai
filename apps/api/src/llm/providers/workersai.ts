import type { LlmProvider, ProviderRequest, ProviderResponse } from "../types";

type AiResult = {
  response?: unknown;
  choices?: { message?: { content?: string } }[];
  output?: { type?: string; content?: { text?: string }[] }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number };
};

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
export function workersAiProvider(ai: Ai): LlmProvider {
  return {
    id: "workersai",
    privateOk: true,
    async complete(model, req: ProviderRequest, signal): Promise<ProviderResponse> {
      const body: Record<string, unknown> = {
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        max_tokens: req.maxTokens ?? 1500,
        temperature: 0,
      };
      if (req.schema) body.response_format = { type: "json_schema", json_schema: { name: "output", schema: req.schema } };
      if (model.includes("gpt-oss")) body.reasoning = { effort: "low" };

      // `signal` is honoured by the caller racing a timeout; Workers AI binding has no abort option.
      const r = (await Promise.race([
        (ai as unknown as { run(m: string, b: unknown): Promise<AiResult> }).run(model, body),
        new Promise<never>((_, rej) => signal.addEventListener("abort", () => rej(new Error("timeout")), { once: true })),
      ])) as AiResult;

      return {
        text: extractText(r),
        tokensIn: r.usage?.prompt_tokens ?? r.usage?.input_tokens ?? null,
        tokensOut: r.usage?.completion_tokens ?? r.usage?.output_tokens ?? null,
      };
    },
  };
}
