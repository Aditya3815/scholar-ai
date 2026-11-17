import { modelOverrides, type ModelOverrides } from "../dev";
import { gatewayFromEnv, type LlmEnv } from "./index";
import type { ModelProfile, ModelRequest, Models } from "./port";
import type { LlmRequest } from "./types";

/**
 * The model of every profile through the gateway (docs/design/untangle.md, F8): the profile's task, sensitivity and time limit, the profile's token limit or else the caller's, and `subject`,
 * whose daily allowance the call uses. The gateway is made once, on the first call (with the development model choices, `overrides`). The composition root (app/deps.ts) hands this to every
 * feature outside a test run.
 */
export function gatewayModels(env: LlmEnv, overrides: ModelOverrides = modelOverrides(env)): Models {
  let gateway: ReturnType<typeof gatewayFromEnv> | null = null;
  const g = () => (gateway ??= gatewayFromEnv(env, overrides));
  const request = (p: ModelProfile, subject: string, req: ModelRequest): LlmRequest => ({
    task: p.task,
    sensitivity: p.sensitivity,
    subject,
    system: req.system,
    user: req.user,
    schema: req.schema,
    maxTokens: p.maxTokens ?? req.maxTokens,
    ...(p.timeoutMs === undefined ? {} : { timeoutMs: p.timeoutMs }),
    label: req.label,
  });
  return {
    complete: (p, subject) => async (req) => {
      const r = await g().complete(request(p, subject, req));
      return { json: r.json, model: r.model, usage: { tokensIn: r.tokensIn, tokensOut: r.tokensOut } };
    },
    stream: (p, subject, abort) => async (req, hooks) => {
      const r = await g().stream(request(p, subject, req), hooks, abort);
      return { json: r.json, model: r.model, usage: { tokensIn: r.tokensIn, tokensOut: r.tokensOut } };
    },
    withOverrides: (o) => gatewayModels(env, o),
  };
}
