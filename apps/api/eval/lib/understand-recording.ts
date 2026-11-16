// The recording of the Understand step's model calls (data/understand-recorded.json.gz), read by understand.eval.ts (every set, every recorded model) and understand-route.eval.ts (the multi-turn
// set through the wired chat route, the shipped model). One place, so that both replay a call the same way.
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG } from "../../src/llm/config";
import { createGateway } from "../../src/llm/gateway";
import { workersAiProvider } from "../../src/llm/providers/workersai";
import { UNDERSTAND_TIMEOUT_MS } from "../../src/understand/understand";
import { ModelLayer } from "./model-layer";

const FILE = fileURLToPath(new URL("../data/understand-recorded.json.gz", import.meta.url));

export function understandRecording(): ModelLayer {
  return new ModelLayer({
    file: FILE,
    layout: { kind: "by-model" },
    note: "Live Workers AI through wrangler's remote proxy from a laptop: latency includes that round trip and is higher than inside a Worker.",
    ask: (ai) => {
      const provider = workersAiProvider(ai);
      return async (model, req) => {
        const gateway = createGateway({
          providers: { workersai: provider },
          ledger: { tokensToday: async () => 0, record: async () => {} },
          config: { ...DEFAULT_CONFIG, routes: { ...DEFAULT_CONFIG.routes, understand: { public: [{ provider: "workersai", model }], private: [{ provider: "workersai", model }] } } },
        });
        const r = await gateway.complete({ task: "understand", sensitivity: "private", subject: "eval", system: req.system, user: req.user, schema: req.schema, maxTokens: req.maxTokens, timeoutMs: 30_000, label: req.label });
        return { json: r.json, tokensIn: r.tokensIn, tokensOut: r.tokensOut };
      };
    },
    // a recorded call slower than the step's give-up point is a timeout here too, so replay decides as live would
    replayRule: (call, req) => {
      if (call.ms > UNDERSTAND_TIMEOUT_MS && req.label === "chat_understand") throw new Error("understand timeout (recorded)");
    },
  });
}
