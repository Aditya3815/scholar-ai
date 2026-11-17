import type { Embedder } from "../platform/llm/port";

export type { Embedder };

/** Multilingual (Hindi, Odia and other Indian-language papers included), 1024 dimensions. */
export const EMBED_MODEL = "@cf/baai/bge-m3";
const BATCH = 40;

export function workersAiEmbedder(ai: Ai): Embedder {
  return async (texts) => {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const run = () => ai.run(EMBED_MODEL as never, { text: texts.slice(i, i + BATCH) } as never) as Promise<{ data?: number[][] }>;
      // One retry: the AI binding occasionally drops a connection, and a failed batch would otherwise fail the whole upload step.
      const res = await run().catch(() => new Promise<{ data?: number[][] }>((resolve, reject) => setTimeout(() => run().then(resolve, reject), 400)));
      if (!res.data || res.data.length !== Math.min(BATCH, texts.length - i)) throw new Error("embedding service returned an unexpected result");
      out.push(...res.data);
    }
    return out;
  };
}
