import { describe, expect, it } from "vitest";
import { workersAiProvider } from "./providers/workersai";

/** Bug B25 (docs/design/untangle.md, section 5): the Workers AI provider read a call's usage twice, and its second read (a stream that came back as one piece) knew only prompt/completion tokens. */

const binding = (answer: unknown, calls: { model: string; body: unknown }[] = []) => ({ run: async (model: string, body: unknown) => (calls.push({ model, body }), answer) }) as unknown as Ai;
const req = { system: "s", user: "u", schema: { type: "object" }, maxTokens: 10 };

describe("the Workers AI provider's usage (bug B25)", () => {
  it("counts input/output tokens the same whether the call was one piece or a stream that came back whole", async () => {
    const answer = { response: '{"ok":true}', usage: { input_tokens: 9, output_tokens: 4, prompt_tokens_details: { cached_tokens: 2 } } };
    const p = workersAiProvider(binding(answer));
    const signal = new AbortController().signal;
    const one = await p.complete("@cf/m", req, signal);
    const whole = await p.stream!("@cf/m", req, signal, {});
    expect(one).toEqual({ text: '{"ok":true}', tokensIn: 9, tokensOut: 4, tokensCached: 2 });
    expect(whole).toEqual(one);
  });

  it("and prompt/completion tokens as before", async () => {
    const answer = { response: "x", usage: { prompt_tokens: 3, completion_tokens: 5 } };
    const p = workersAiProvider(binding(answer));
    const signal = new AbortController().signal;
    expect(await p.complete("@cf/m", req, signal)).toEqual({ text: "x", tokensIn: 3, tokensOut: 5, tokensCached: null });
    expect(await p.stream!("@cf/m", req, signal, {})).toEqual({ text: "x", tokensIn: 3, tokensOut: 5, tokensCached: null });
  });
});
