import type { LlmProvider, ProviderRequest, ProviderResponse } from "../types";

/**
 * Google AI Studio (Gemini API), UNPAID tier: Google may use prompts and responses to improve its products and
 * humans may read them. Therefore privateOk = false: only PUBLIC data (search queries, public abstracts).
 * If this key is ever moved to a paid Cloud billing account with the Paid Services terms, flip this deliberately
 * and update docs/llm-providers.md; do not flip it just to make a test pass.
 */
export function geminiProvider(apiKey: string): LlmProvider {
  return {
    id: "gemini",
    privateOk: false,
    async complete(model, req: ProviderRequest, signal): Promise<ProviderResponse> {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        signal,
        headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: req.user }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: req.maxTokens ?? 2048,
            ...(req.schema ? { responseMimeType: "application/json" } : {}),
          },
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        throw new Error(`Gemini HTTP ${res.status}: ${j.error?.message ?? "error"}`);
      }
      const j = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const text = (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
      return { text, tokensIn: j.usageMetadata?.promptTokenCount ?? null, tokensOut: j.usageMetadata?.candidatesTokenCount ?? null };
    },
  };
}
