import { OCR_MAX_TOKENS, OCR_MODEL_CHECK, OCR_MODEL_PRIMARY, OCR_PROMPT, type Reading } from "@scholar/shared";

/**
 * Reads one page picture with two different models, side by side. Both run inside our own Cloudflare account (Workers AI), which is the only route
 * a person's own files may take (see llm/providers/workersai.ts and docs/llm-providers.md); nothing here can reach another provider. The picture is
 * sent to the models and then forgotten: it is not stored, and neither it nor the text is logged.
 */
export type PageRead = {
  /** The primary model's reading; null if that call failed. */
  first: Reading | null;
  /** The checking model's reading; null if that call failed. */
  second: Reading | null;
  /** What Workers AI says the two calls used (for cost review). */
  neurons: number;
  /** Short error names of the calls that failed (never page text). */
  errors: string[];
};

export type PageReader = (image: Uint8Array, ctx: { page: number; comment: string | null }) => Promise<PageRead>;

type AiChat = {
  response?: unknown;
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { completion_tokens?: number; neurons?: number };
};

const CALL_TIMEOUT_MS = 75_000;

export function toDataUri(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/jpeg;base64,${btoa(bin)}`;
}

async function callModel(ai: Ai, model: string, uri: string): Promise<{ reading: Reading; neurons: number }> {
  const run = () =>
    Promise.race([
      (ai as unknown as { run(m: string, b: unknown): Promise<AiChat | string> }).run(model, {
        messages: [{ role: "user", content: [{ type: "text", text: OCR_PROMPT }, { type: "image_url", image_url: { url: uri } }] }],
        max_tokens: OCR_MAX_TOKENS,
        temperature: 0,
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), CALL_TIMEOUT_MS)),
    ]);
  // One retry: the AI binding occasionally drops a call, and a page is worth one more try before it is called unreadable.
  const out = await run().catch(() => new Promise<AiChat | string>((resolve, reject) => setTimeout(() => run().then(resolve, reject), 500)));
  if (typeof out === "string") return { reading: { text: out, cutOff: false }, neurons: 0 };
  const text = typeof out.response === "string" ? out.response : (out.choices?.[0]?.message?.content ?? "");
  const cutOff = (out.usage?.completion_tokens ?? 0) >= OCR_MAX_TOKENS || out.choices?.[0]?.finish_reason === "length";
  return { reading: { text, cutOff }, neurons: out.usage?.neurons ?? 0 };
}

export function workersAiReader(ai: Ai): PageReader {
  return async (image) => {
    const uri = toDataUri(image);
    const [a, b] = await Promise.allSettled([callModel(ai, OCR_MODEL_PRIMARY, uri), callModel(ai, OCR_MODEL_CHECK, uri)]);
    const errors: string[] = [];
    const fail = (r: PromiseRejectedResult, which: string) => errors.push(`${which}:${r.reason instanceof Error ? r.reason.message.slice(0, 80) : "error"}`);
    if (a.status === "rejected") fail(a, "first");
    if (b.status === "rejected") fail(b, "second");
    return {
      first: a.status === "fulfilled" ? a.value.reading : null,
      second: b.status === "fulfilled" ? b.value.reading : null,
      neurons: (a.status === "fulfilled" ? a.value.neurons : 0) + (b.status === "fulfilled" ? b.value.neurons : 0),
      errors,
    };
  };
}
