// The Understand eval (design of 6 Nov 2026, page 14; docs/eval/understand/GUIDE.md, with the results). It runs the REAL step (`understandTurn`, guards, checks, confidence and fail policy) and the real
// conversation-reply writer over the three label sets, with the model's answers RECORDED once from live Workers AI and replayed here, so `npm run eval` (and CI) checks the gates offline.
//
//   npm run eval                                                       replay (CI): fails if a prompt has no recording (re-record after any prompt change)
//   UNDERSTAND_EVAL=record UNDERSTAND_MODELS=@cf/openai/gpt-oss-120b,@cf/openai/gpt-oss-20b npx vitest run -c vitest.eval.config.ts eval/understand.eval.ts
//                                                                      record: live Workers AI through `wrangler`'s own login (no key is read from any file), then replay
//
// The gates apply to the model the step ships with (UNDERSTAND_CHAIN[0] in src/llm/config.ts); every other recorded model is measured and printed for comparison only.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import type { Complete } from "../src/docs/qa";
import { DEFAULT_CONFIG, UNDERSTAND_CHAIN } from "../src/llm/config";
import { createGateway } from "../src/llm/gateway";
import { workersAiProvider } from "../src/llm/providers/workersai";
import { chatReplyLeaks, writeChatReply } from "../src/understand/chat-reply";
import { understandTurn, UNDERSTAND_TIMEOUT_MS, type UnderstandDecision } from "../src/understand/understand";
import {
  agreedLabel,
  fieldMisses,
  goldLedger,
  intentOk,
  isSearch,
  leaks,
  percentile,
  UNDERSTAND_GATES,
  type ChatItem,
  type MultiChat,
  type SingleItem,
} from "./lib/understand-score";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const SETS = HERE + "../../../docs/eval/understand/";
const RECORDING = HERE + "data/understand-recorded.json.gz";
const YEAR = 2026;
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;
// UNDERSTAND_LIMIT=n: the first n of each set only (a smoke run while recording; the gates are not meant for it)
const LIMIT = Number(process.env.UNDERSTAND_LIMIT ?? 0) || Infinity;
const single = readJson<{ items: SingleItem[] }>(SETS + "single.json").items.slice(0, LIMIT);
const multi = readJson<{ chats: MultiChat[] }>(SETS + "multi.json").chats.slice(0, LIMIT);
const chats = readJson<{ items: ChatItem[] }>(SETS + "chat.json").items.slice(0, LIMIT);

type Call = { ok: boolean; json?: unknown; error?: string; ms: number; tokensIn: number | null; tokensOut: number | null };
type Recording = { version: 1; recordedAt: string; note: string; calls: Record<string, Record<string, Call[]>> };
const keyOf = (system: string, user: string) => createHash("sha256").update(system).update("\u0000").update(user).digest("hex").slice(0, 24);

const recording: Recording = existsSync(RECORDING)
  ? (JSON.parse(gunzipSync(readFileSync(RECORDING)).toString("utf8")) as Recording)
  : { version: 1, recordedAt: "", note: "", calls: {} };
const RECORD = process.env.UNDERSTAND_EVAL === "record";
const MODELS = RECORD ? (process.env.UNDERSTAND_MODELS ?? UNDERSTAND_CHAIN[0]!.model).split(",").map((m) => m.trim()).filter(Boolean) : Object.keys(recording.calls);
const SHIPPED = UNDERSTAND_CHAIN[0]!.model;

/* ---------------------------------------------------------------- the model: live (record) or recorded (replay) */

let live: ((model: string) => Complete) | null = null;
let dispose: (() => Promise<void>) | null = null;
async function startLive() {
  // a config of its own with the AI binding only: no D1, KV or Durable Object of the app is started, and wrangler's own login is used
  const dir = mkdtempSync(join(tmpdir(), "understand-record-"));
  const config = join(dir, "wrangler.jsonc");
  writeFileSync(config, JSON.stringify({ name: "understand-record", compatibility_date: "2026-10-01", ai: { binding: "AI", remote: true } }));
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy<{ AI: Ai }>({ configPath: config });
  dispose = () => proxy.dispose();
  const provider = workersAiProvider(proxy.env.AI);
  live = (model) => {
    const gateway = createGateway({
      providers: { workersai: provider },
      ledger: { tokensToday: async () => 0, record: async () => {} },
      config: { ...DEFAULT_CONFIG, routes: { ...DEFAULT_CONFIG.routes, understand: { public: [{ provider: "workersai", model }], private: [{ provider: "workersai", model }] } } },
    });
    return async (req) => {
      const r = await gateway.complete({ task: "understand", sensitivity: "private", subject: "eval", system: req.system, user: req.user, schema: req.schema, maxTokens: req.maxTokens, timeoutMs: 30_000, label: req.label });
      return { json: r.json, model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut } as Awaited<ReturnType<Complete>>;
    };
  };
}

const missing = new Set<string>();
/** A Complete for one evaluation: each call is answered by the recording (in order, per prompt); in record mode a prompt that has none is asked live and recorded. */
function completeFor(model: string): Complete {
  const used = new Map<string, number>();
  const store = (recording.calls[model] ??= {});
  return async (req) => {
    const key = keyOf(req.system, req.user);
    const i = used.get(key) ?? 0;
    used.set(key, i + 1);
    let call = store[key]?.[i];
    if (!call && RECORD && live) {
      const t0 = Date.now();
      try {
        const r = (await live(model)(req)) as { json: unknown; tokensIn?: number | null; tokensOut?: number | null };
        call = { ok: true, json: r.json, ms: Date.now() - t0, tokensIn: r.tokensIn ?? null, tokensOut: r.tokensOut ?? null };
      } catch (e) {
        // the error's class and a short reason only: never the prompt
        const msg = e instanceof Error ? `${e.name}: ${e.message}`.replace(/\s+/g, " ").slice(0, 160) : "error";
        call = { ok: false, error: msg, ms: Date.now() - t0, tokensIn: null, tokensOut: null };
      }
      (store[key] ??= []).push(call);
    }
    if (!call) {
      missing.add(`${model} ${key}`);
      throw new Error("no recording");
    }
    // a recorded call slower than the step's give-up point is a timeout here too, so replay decides as live would
    if (call.ms > UNDERSTAND_TIMEOUT_MS && req.label === "chat_understand") throw new Error("understand timeout (recorded)");
    if (!call.ok) {
      const err = new Error(call.error ?? "failed");
      if (/AllProvidersFailedError/.test(call.error ?? "")) err.name = "AllProvidersFailedError";
      throw err;
    }
    return { json: call.json, model };
  };
}

/** Recorded milliseconds of the Understand calls one evaluation made. */
function msOf(model: string, keys: string[]): number {
  return keys.reduce((s, k) => s + (recording.calls[model]?.[k] ?? []).reduce((a, c) => a + c.ms, 0), 0);
}

/* ---------------------------------------------------------------- running the sets */

type Result = { model: string; single: SingleScore; multi: MultiScore; chat: ChatScore };
type SingleScore = { n: number; dropped: number; correct: number; greetingSearches: number; wrong: string[]; fieldMiss: Record<string, number>; fieldWrong: string[]; fallbacks: number; latencies: number[] };
type MultiScore = { n: number; dropped: number; correct: number; newTopicLeaks: number; switchLeaks: number; wrong: string[] };
type ChatScore = { n: number; finalLeaks: number; rawLeaks: number; failed: number; overWords: number };

async function evaluate(model: string): Promise<Result> {
  const s: SingleScore = { n: 0, dropped: 0, correct: 0, greetingSearches: 0, wrong: [], fieldMiss: {}, fieldWrong: [], fallbacks: 0, latencies: [] };
  const run = async (text: string, ledger: ReturnType<typeof goldLedger>) => {
    const seen: string[] = [];
    const base = completeFor(model);
    const complete: Complete = async (req) => (seen.push(keyOf(req.system, req.user)), base(req));
    const d: UnderstandDecision = await understandTurn({ text, mode: "auto" }, { ledger, year: YEAR }, { complete, timeoutMs: RECORD ? 60_000 : UNDERSTAND_TIMEOUT_MS });
    return { d, ms: msOf(model, [...new Set(seen)]), called: seen.length > 0 };
  };

  // single messages, a few at a time when recording
  const pool = async <T,>(items: T[], f: (t: T) => Promise<void>) => {
    const width = RECORD ? 6 : 1;
    let next = 0;
    await Promise.all(Array.from({ length: width }, async () => {
      while (next < items.length) await f(items[next++]!);
    }));
  };
  await pool(single, async (item) => {
    const label = agreedLabel(item.labeller_1, item.labeller_2);
    if (!label) return void s.dropped++;
    s.n++;
    const { d, ms, called } = await run(item.text, []);
    if (called) s.latencies.push(ms);
    if (d.source === "fallback") s.fallbacks++;
    const got = d.understanding?.intent;
    if (intentOk(label, got)) s.correct++;
    else s.wrong.push(`${item.id} [${item.group}] want ${label.intent} got ${got ?? d.guard?.kind}${d.fallback ? ` (fallback ${d.fallback.reason})` : ""}: ${item.text.slice(0, 60)}`);
    if (item.group === "greeting" && isSearch(d)) s.greetingSearches++;
    for (const f of fieldMisses(label, d)) {
      s.fieldMiss[f] = (s.fieldMiss[f] ?? 0) + 1;
      s.fieldWrong.push(`${item.id} ${f}: want ${String(label[f as keyof typeof label])} got ${f === "language" ? d.understanding?.language : f === "tool" ? d.understanding?.tool : JSON.stringify(d.understanding?.search?.[f as "year_from"])}: ${item.text.slice(0, 50)}`);
    }
  });

  const m: MultiScore = { n: 0, dropped: 0, correct: 0, newTopicLeaks: 0, switchLeaks: 0, wrong: [] };
  await pool(multi, async (chat) => {
    let afterNewTopic = false;
    for (let k = 0; k < chat.turns.length; k++) {
      const t = chat.turns[k]!;
      if (t.labeller_1.newTopicBefore) afterNewTopic = true;
      const label = agreedLabel(t.labeller_1, t.labeller_2);
      if (!label) {
        m.dropped++;
        continue;
      }
      m.n++;
      const { d } = await run(t.user, goldLedger(chat, k));
      const misses = fieldMisses(label, d);
      const ok = intentOk(label, d.understanding?.intent) && misses.length === 0;
      if (ok) m.correct++;
      else m.wrong.push(`${chat.id}#${t.turn} want ${label.intent}${label.papers ? ` ${label.papers}` : ""} got ${d.understanding?.intent ?? d.guard?.kind}${d.understanding?.refers_to ? ` ${d.understanding.refers_to.papers}` : ""}${misses.length ? ` miss ${misses}` : ""}${d.fallback ? ` (fallback ${d.fallback.reason})` : ""}${d.invalid.length ? ` (invalid ${d.invalid})` : ""}: ${t.user.slice(0, 50)}`);
      const leaked = leaks(label, d);
      if (leaked.length) {
        if (afterNewTopic) m.newTopicLeaks++;
        else m.switchLeaks++;
        m.wrong.push(`${chat.id}#${t.turn} LEAK ${leaked.join(",")}`);
      }
    }
  });

  const c: ChatScore = { n: 0, finalLeaks: 0, rawLeaks: 0, failed: 0, overWords: 0 };
  await pool(chats, async (item) => {
    c.n++;
    const r = await writeChatReply(item.message, item.language, completeFor(model));
    if (r.ok) {
      if (chatReplyLeaks(r.reply).length) c.finalLeaks++;
      if (r.reply.split(/\s+/).length > 80) c.overWords++;
    } else if (r.discarded) c.rawLeaks++;
    else c.failed++;
  });
  return { model, single: s, multi: m, chat: c };
}

/* ---------------------------------------------------------------- the tests */

const results: Result[] = [];
const hasRecording = RECORD || Object.keys(recording.calls).length > 0;

describe.skipIf(!hasRecording)("Understand eval", () => {
  it("runs every set for every recorded model", { timeout: 3 * 60 * 60 * 1000 }, async () => {
    if (RECORD) await startLive();
    try {
      for (const model of MODELS) results.push(await evaluate(model));
    } finally {
      await dispose?.();
    }
    if (RECORD) {
      recording.recordedAt = new Date().toISOString();
      recording.note = "Live Workers AI through wrangler's remote proxy from a laptop: latency includes that round trip and is higher than inside a Worker.";
      writeFileSync(RECORDING, gzipSync(JSON.stringify(recording)));
    }
    expect(results.length).toBeGreaterThan(0);
  });

  it("has a recording for every prompt (re-record after a prompt change)", () => {
    expect([...missing].slice(0, 5), `${missing.size} prompts have no recording`).toEqual([]);
  });

  it("passes the gates with the model the step ships with", () => {
    const r = results.find((x) => x.model === SHIPPED);
    expect(r, `no recording for ${SHIPPED}`).toBeDefined();
    if (!r) return;
    const acc = r.single.correct / r.single.n;
    expect(acc, `single-message intent accuracy; wrong:\n${r.single.wrong.join("\n")}`).toBeGreaterThan(UNDERSTAND_GATES.singleIntentAccuracyAbove);
    expect(r.single.greetingSearches, "a pure greeting was searched").toBeLessThanOrEqual(UNDERSTAND_GATES.greetingSearchesMax);
    expect(r.multi.correct / r.multi.n, `multi-turn accuracy; wrong:\n${r.multi.wrong.join("\n")}`).toBeGreaterThanOrEqual(UNDERSTAND_GATES.multiTurnAccuracyMin);
    expect(r.multi.newTopicLeaks, "an earlier topic leaked past New topic").toBeLessThanOrEqual(UNDERSTAND_GATES.newTopicLeaksMax);
    expect(r.chat.finalLeaks, "a conversation reply reached the person with a citation").toBeLessThanOrEqual(UNDERSTAND_GATES.chatLeaksMax);
  });

  afterAll(() => {
    for (const r of results) {
      const lat = r.single.latencies;
      console.log(
        [
          `\nUnderstand eval: ${r.model}${r.model === SHIPPED ? " (shipped)" : ""}`,
          `  single   ${r.single.correct}/${r.single.n} = ${((100 * r.single.correct) / r.single.n).toFixed(1)}% (dropped ${r.single.dropped}); greeting searches ${r.single.greetingSearches}; fallbacks ${r.single.fallbacks}; field misses ${JSON.stringify(r.single.fieldMiss)}`,
          `  latency  model calls p50 ${percentile(lat, 50)} ms, p95 ${percentile(lat, 95)} ms (n ${lat.length}; recorded through wrangler's remote proxy)`,
          `  multi    ${r.multi.correct}/${r.multi.n} = ${((100 * r.multi.correct) / r.multi.n).toFixed(1)}%; New topic leaks ${r.multi.newTopicLeaks}; topic-switch leaks ${r.multi.switchLeaks}`,
          `  chat     ${r.chat.n} replies: leaks reaching the person ${r.chat.finalLeaks}; thrown away by the post-check ${r.chat.rawLeaks}; no usable reply ${r.chat.failed}; over 80 words ${r.chat.overWords}`,
          `  wrong single:\n    ${r.single.wrong.join("\n    ") || "(none)"}`,
          `  wrong multi:\n    ${r.multi.wrong.join("\n    ") || "(none)"}`,
          `  field misses (single, not gated):\n    ${r.single.fieldWrong.join("\n    ") || "(none)"}`,
        ].join("\n"),
      );
    }
  });
});
