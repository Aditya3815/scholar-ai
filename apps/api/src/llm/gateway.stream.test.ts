import { describe, expect, it, vi } from "vitest";
import { AllProvidersFailedError, createGateway, type GatewayConfig } from "./gateway";
import { NoRouteError } from "./policy";
import { readChatStream } from "./providers/workersai";
import type { Ledger, LlmProvider, LlmRequest, ProviderResponse, StreamHooks, UsageRow } from "./types";

const config = (chain: { provider: string; model: string }[]): GatewayConfig => ({
  routes: Object.fromEntries(["classify", "summarize_public", "qa", "review"].map((t) => [t, { public: chain, private: chain }])) as GatewayConfig["routes"],
  dailyTokenQuota: 1000,
  perCallTimeoutMs: 5000,
  publicCacheTtlSeconds: 60,
  maxPromptChars: 10_000,
});
const req = (over: Partial<LlmRequest> = {}): LlmRequest => ({ task: "qa", sensitivity: "private", subject: "u", system: "s", user: "u", ...over });
const ledger = () => {
  const rows: UsageRow[] = [];
  const l: Ledger = { tokensToday: async () => 0, record: async (r) => void rows.push(r) };
  return { l, rows };
};
const done = (text: string): ProviderResponse => ({ text, tokensIn: 7, tokensOut: 3 });

describe("gateway.stream", () => {
  it("passes thinking and content through, records usage, and returns the whole text", async () => {
    const p: LlmProvider = {
      id: "workersai", privateOk: true,
      complete: vi.fn(),
      stream: async (_m, _r, _s, h: StreamHooks) => { h.onThinking?.(); h.onContent?.('{"a":'); h.onContent?.("1}"); return done('{"a":1}'); },
    };
    const { l, rows } = ledger();
    const gw = createGateway({ providers: { workersai: p }, ledger: l, config: config([{ provider: "workersai", model: "m" }]) });
    const events: string[] = [];
    const r = await gw.stream(req({ schema: { type: "object" } }), { onThinking: () => events.push("think"), onContent: (d) => events.push(d) });
    expect(events).toEqual(["think", '{"a":', "1}"]);
    expect(r.json).toEqual({ a: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ok: true, tokensIn: 7, tokensOut: 3, sensitivity: "private" });
    expect(p.complete).not.toHaveBeenCalled();
  });

  it("delivers a provider without streaming as one piece", async () => {
    const p: LlmProvider = { id: "workersai", privateOk: true, complete: async () => done("whole answer") };
    const gw = createGateway({ providers: { workersai: p }, ledger: ledger().l, config: config([{ provider: "workersai", model: "m" }]) });
    const pieces: string[] = [];
    await gw.stream(req(), { onContent: (d) => pieces.push(d) });
    expect(pieces).toEqual(["whole answer"]);
  });

  it("never streams private data to a provider that is not private-safe (same rule as complete)", async () => {
    const gemini: LlmProvider = { id: "gemini", privateOk: false, complete: vi.fn(), stream: vi.fn() };
    const gw = createGateway({ providers: { gemini }, ledger: ledger().l, config: config([{ provider: "gemini", model: "g" }]) });
    await expect(gw.stream(req(), {})).rejects.toBeInstanceOf(NoRouteError);
    expect(gemini.stream).not.toHaveBeenCalled();
    expect(gemini.complete).not.toHaveBeenCalled();
  });

  it("falls back to the next provider if the first fails before any text was shown", async () => {
    const first: LlmProvider = { id: "workersai", privateOk: true, complete: vi.fn(), stream: async (_m, _r, _s, h) => { h.onThinking?.(); throw new Error("boom"); } };
    const second: LlmProvider = { id: "other", privateOk: true, complete: async () => done("from second") };
    const gw = createGateway({ providers: { workersai: first, other: second }, ledger: ledger().l, config: config([{ provider: "workersai", model: "a" }, { provider: "other", model: "b" }]) });
    const pieces: string[] = [];
    const r = await gw.stream(req(), { onContent: (d) => pieces.push(d) });
    expect(r.provider).toBe("other");
    expect(pieces).toEqual(["from second"]);
  });

  it("does NOT start over on another provider once text has already reached the reader", async () => {
    const first: LlmProvider = { id: "workersai", privateOk: true, complete: vi.fn(), stream: async (_m, _r, _s, h) => { h.onContent?.("partial"); throw new Error("connection lost"); } };
    const second: LlmProvider = { id: "other", privateOk: true, complete: vi.fn(async () => done("never")) };
    const gw = createGateway({ providers: { workersai: first, other: second }, ledger: ledger().l, config: config([{ provider: "workersai", model: "a" }, { provider: "other", model: "b" }]) });
    await expect(gw.stream(req(), { onContent: () => {} })).rejects.toBeInstanceOf(AllProvidersFailedError);
    expect(second.complete).not.toHaveBeenCalled();
  });

  it("hands the provider a signal that fires when the caller aborts", async () => {
    let seen: AbortSignal | undefined;
    const p: LlmProvider = { id: "workersai", privateOk: true, complete: vi.fn(), stream: async (_m, _r, signal) => { seen = signal; return done("x"); } };
    const gw = createGateway({ providers: { workersai: p }, ledger: ledger().l, config: config([{ provider: "workersai", model: "m" }]) });
    const ctl = new AbortController();
    await gw.stream(req(), {}, ctl.signal);
    expect(seen!.aborted).toBe(false);
    ctl.abort();
    expect(seen!.aborted).toBe(true);
  });
});

describe("readChatStream (Workers AI / OpenAI-style server-sent events)", () => {
  const sse = (...chunks: object[]) => chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  const streamOf = (text: string, size = 17) =>
    new ReadableStream<Uint8Array>({
      start(ctrl) {
        const bytes = new TextEncoder().encode(text);
        for (let i = 0; i < bytes.length; i += size) ctrl.enqueue(bytes.slice(i, i + size)); // cut anywhere, even inside a character
        ctrl.close();
      },
    });

  it("separates reasoning from content, survives arbitrary packet boundaries, and sums usage", async () => {
    const text = sse(
      { choices: [{ delta: { role: "assistant", content: "" } }], usage: { prompt_tokens: 85, completion_tokens: 0 } },
      { choices: [{ delta: { reasoning: "We", reasoning_content: "We" } }], usage: { prompt_tokens: 0, completion_tokens: 4 } },
      { choices: [{ delta: { reasoning: " need" } }], usage: { completion_tokens: 1 } },
      { choices: [{ delta: { content: '{"answer":"नमस्ते' } }], usage: { completion_tokens: 2 } },
      { choices: [{ delta: { content: '"}' } }], usage: { completion_tokens: 1 } },
    );
    const events: string[] = [];
    const r = await readChatStream(streamOf(text), { onThinking: () => events.push("think"), onContent: (d) => events.push(d) }, new AbortController().signal);
    expect(events).toEqual(["think", '{"answer":"नमस्ते', '"}']);
    expect(r).toEqual({ text: '{"answer":"नमस्ते"}', tokensIn: 85, tokensOut: 8, tokensCached: null });
  });

  it("does not count output tokens twice: the last usage chunk is the totals for the whole call (measured on Workers AI, 23 Oct 2026)", async () => {
    // a real stream: the pieces ("completion_tokens": 4, 1, 1 ... = 66 in all), then one chunk with both counts, which IS the whole call
    const pieces = [4, 1, 1, 10, 25, 25];
    const text = sse(
      { choices: [{ delta: { role: "assistant", content: "" } }], usage: { prompt_tokens: 76, completion_tokens: 0, total_tokens: 76 } },
      ...pieces.map((n, i) => ({ choices: [{ delta: i < 2 ? { reasoning: "t" } : { content: "x" } }], usage: { prompt_tokens: 0, completion_tokens: n, total_tokens: n } })),
      { choices: [], usage: { prompt_tokens: 76, completion_tokens: 66, total_tokens: 142, prompt_tokens_details: { cached_tokens: 0 } } },
    );
    const r = await readChatStream(streamOf(text), {}, new AbortController().signal);
    expect(r).toMatchObject({ tokensIn: 76, tokensOut: 66, tokensCached: 0 });
  });

  it("reports cached input tokens when the provider says so", async () => {
    const text = sse({ choices: [{ delta: { content: "{}" } }], usage: { prompt_tokens: 300, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 128 } } });
    const r = await readChatStream(streamOf(text), {}, new AbortController().signal);
    expect(r).toMatchObject({ tokensIn: 300, tokensOut: 40, tokensCached: 128 });
  });

  it("reports thinking only once, and ignores junk lines", async () => {
    const text = ": keep-alive\n\ndata: not json\n\n" + sse({ choices: [{ delta: { reasoning: "a" } }] }, { choices: [{ delta: { reasoning: "b" } }] });
    let thinking = 0;
    await readChatStream(streamOf(text, 5), { onThinking: () => thinking++ }, new AbortController().signal);
    expect(thinking).toBe(1);
  });

  it("stops with an error when aborted", async () => {
    const ctl = new AbortController();
    const slow = new ReadableStream<Uint8Array>({ pull: () => new Promise(() => {}) });
    const p = readChatStream(slow, {}, ctl.signal);
    ctl.abort();
    await expect(p).rejects.toThrow();
  });
});
