import type { Embedder } from "./port";
import { runWorkersAi } from "./workers-ai";

/**
 * The one embedder (docs/design/untangle.md, F8): texts to vectors with Workers AI, for the papers of one's own, Idea Check and the open-access index. Which embedder a request gets
 * (this one, or a test run's hashing stand-in, docs/testing/embed.ts) is the deps' (app/deps.ts).
 */
export type { Embedder };

/** Multilingual (Hindi, Odia and other Indian-language papers included), 1024 dimensions. */
export const EMBED_MODEL = "@cf/baai/bge-m3";
const BATCH = 40;

export function workersAiEmbedder(ai: Ai): Embedder {
  return async (texts) => {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH) {
      const run = () => runWorkersAi<{ data?: number[][] }>(ai, EMBED_MODEL, { text: texts.slice(i, i + BATCH) }, { privacy: "private" });
      // One retry: the AI binding occasionally drops a connection, and a failed batch would otherwise fail the whole upload step.
      const res = await run().catch(() => new Promise<{ data?: number[][] }>((resolve, reject) => setTimeout(() => run().then(resolve, reject), 400)));
      if (!res.data || res.data.length !== Math.min(BATCH, texts.length - i)) throw new Error("embedding service returned an unexpected result");
      out.push(...res.data);
    }
    return out;
  };
}
