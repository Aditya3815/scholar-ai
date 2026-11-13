// Record / replay for language-model calls, beside FetchLayer (fetch-layer.ts), which does the same for HTTP. Every eval that runs real prompts through a model reads its answers here.
//   replay: each prompt is answered from the recording (a .json.gz in eval/data); a prompt with no recording is listed in `missing` and its call throws, and a recording file that is not there
//           fails the eval at once (a lost recording must never turn a gate into a pass).
//   record: a prompt the recording does not hold is asked live (Workers AI through wrangler's own login, `npx wrangler whoami`: no key is read from any file), and the file is written again
//           at `close()` when something was added. Prompts that are recorded already are replayed, so a run records only what changed.
//   live:   replayed, as in replay. A live model run needs a Workers AI login that the weekly live run of the HTTP eval (eval-live.yml) does not have; the real models are checked every week by
//           qa-eval.yml instead. Record mode is the way to ask the model again.
// The mode is EVAL_MODE (mode.ts). A recording keeps the error of a failed call (its class and a short reason, never the prompt), so replay fails that call the same way.
//
// Two layouts, so that the recordings made before this file existed are read and written byte for byte as before:
//   "flat"      { version, recordedAt, model, note, calls: { [key]: call } }, key = sha256(`${model}\n${system}\n${user}`) cut to 32 hex: one model, one answer per prompt (claim.eval.ts)
//   "by-model"  { version, recordedAt, note, calls: { [model]: { [key]: call[] } } }, key = sha256(system + NUL + user) cut to 24 hex: several models, and the n-th call of a prompt within one
//               session is its n-th recorded answer (a retry is the second call of the same prompt) (understand.eval.ts, understand-route.eval.ts)
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { evalMode } from "./mode";

/** One recorded answer. The "flat" layout keeps no token counts. */
export type ModelCall = { ok: boolean; json?: unknown; error?: string; ms: number; tokensIn?: number | null; tokensOut?: number | null };
/** What the app's model ports (`Complete`, `StreamComplete` in src/docs/qa.ts) are asked. */
export type ModelRequest = { system: string; user: string; schema: Record<string, unknown>; maxTokens: number; label?: string };
export type ModelHooks = { onThinking?: () => void; onContent?: (delta: string) => void };
/** One live call of `model`, made only while recording. */
export type Ask = (model: string, req: ModelRequest, hooks?: ModelHooks) => Promise<{ json: unknown; tokensIn?: number | null; tokensOut?: number | null }>;
/** Answers prompts as the app's model port does; one session counts the calls per prompt (see "by-model"). */
export type ModelSession = (req: ModelRequest, hooks?: ModelHooks) => Promise<{ json: unknown; model: string }>;

export type ModelLayerOptions = {
  /** The recording, a .json.gz file. */
  file: string;
  layout: { kind: "flat"; model: string } | { kind: "by-model" };
  /** Written into the recording when it is saved: where and how it was made. */
  note: string;
  /** Given the AI binding of a throwaway Worker config (the binding only: nothing of the app is started), how to ask a model. Used only while recording. */
  ask: (ai: Ai) => Ask;
  /** A rule of the eval that turns an answer into an error before it is returned (a recorded one, or one just recorded), e.g. one slower than the step's give-up point. */
  replayRule?: (call: ModelCall, req: ModelRequest) => void;
};

type Flat = { version: 1; recordedAt: string; model: string; note: string; calls: Record<string, ModelCall> };
type ByModel = { version: 1; recordedAt: string; note: string; calls: Record<string, Record<string, ModelCall[]>> };

export class ModelLayer {
  /** "record" or "replay" (live replays, above). */
  readonly mode: "record" | "replay";
  /** `<model> <key>` of every prompt that had no recording. */
  readonly missing = new Set<string>();
  private readonly data: Flat | ByModel;
  private added = 0;
  private live: Promise<Ask> | null = null;
  private dispose: (() => Promise<void>) | null = null;

  constructor(private readonly opts: ModelLayerOptions) {
    this.mode = evalMode() === "record" ? "record" : "replay";
    if (existsSync(opts.file)) this.data = JSON.parse(gunzipSync(readFileSync(opts.file)).toString("utf8")) as Flat | ByModel;
    else if (this.mode === "record") this.data = opts.layout.kind === "flat" ? { version: 1, recordedAt: "", model: opts.layout.model, note: "", calls: {} } : { version: 1, recordedAt: "", note: "", calls: {} };
    else throw new Error(`No model recording at ${opts.file}: record it with EVAL_MODE=record (see the eval's header)`);
  }

  /** When the recording was made, and (flat) of which model. */
  get recordedAt(): string {
    return this.data.recordedAt;
  }
  get recordedModel(): string | undefined {
    return "model" in this.data ? this.data.model : undefined;
  }

  /** The models the recording holds answers of. */
  models(): string[] {
    return this.opts.layout.kind === "flat" ? [this.opts.layout.model] : Object.keys((this.data as ByModel).calls);
  }

  /** The key of a prompt in the recording. */
  keyOf(model: string, system: string, user: string): string {
    return this.opts.layout.kind === "flat"
      ? createHash("sha256").update(`${model}\n${system}\n${user}`).digest("hex").slice(0, 32)
      : createHash("sha256").update(system).update("\u0000").update(user).digest("hex").slice(0, 24);
  }

  /** The recorded answers of one prompt (all of them, in order), or of every prompt of a model when no key is given. */
  recorded(model: string, key?: string): ModelCall[] {
    if (this.opts.layout.kind === "flat") {
      const calls = (this.data as Flat).calls;
      return key === undefined ? Object.values(calls) : calls[key] ? [calls[key]] : [];
    }
    const store = (this.data as ByModel).calls[model] ?? {};
    return key === undefined ? Object.values(store).flat() : (store[key] ?? []);
  }

  /** A model port for one evaluation: each call is answered by the recording (the n-th call of a prompt by its n-th answer); in record mode a prompt that has none is asked live. */
  session(model: string): ModelSession {
    const used = new Map<string, number>();
    return async (req, hooks) => {
      const key = this.keyOf(model, req.system, req.user);
      const i = used.get(key) ?? 0;
      used.set(key, i + 1);
      let call = this.find(model, key, i);
      if (!call && this.mode === "record") {
        call = await this.ask(model, req, hooks);
        this.store(model, key, call);
      }
      if (!call) {
        this.missing.add(`${model} ${key}`);
        throw new Error("no recording");
      }
      this.opts.replayRule?.(call, req);
      if (!call.ok) {
        const err = new Error(call.error ?? "failed");
        if (/AllProvidersFailedError/.test(call.error ?? "")) err.name = "AllProvidersFailedError";
        throw err;
      }
      return { json: call.json, model };
    };
  }

  /** Writes the recording when this run added to it, and stops the live connection. */
  async close(): Promise<void> {
    try {
      if (this.mode === "record" && this.added > 0) {
        this.data.recordedAt = new Date().toISOString();
        if (this.opts.layout.kind === "flat") (this.data as Flat).model = this.opts.layout.model;
        this.data.note = this.opts.note;
        writeFileSync(this.opts.file, gzipSync(JSON.stringify(this.data)));
      }
    } finally {
      await this.dispose?.();
      this.dispose = null;
      this.live = null;
    }
  }

  private find(model: string, key: string, i: number): ModelCall | undefined {
    if (this.opts.layout.kind === "flat") return (this.data as Flat).calls[key];
    return (this.data as ByModel).calls[model]?.[key]?.[i];
  }

  private store(model: string, key: string, call: ModelCall) {
    this.added++;
    if (this.opts.layout.kind === "flat") (this.data as Flat).calls[key] = call;
    else (((this.data as ByModel).calls[model] ??= {})[key] ??= []).push(call);
  }

  private async ask(model: string, req: ModelRequest, hooks?: ModelHooks): Promise<ModelCall> {
    const ask = await (this.live ??= this.startLive());
    const flat = this.opts.layout.kind === "flat";
    const t0 = Date.now();
    try {
      const r = await ask(model, req, hooks);
      return flat ? { ok: true, json: r.json, ms: Date.now() - t0 } : { ok: true, json: r.json, ms: Date.now() - t0, tokensIn: r.tokensIn ?? null, tokensOut: r.tokensOut ?? null };
    } catch (e) {
      // the error's class and a short reason only: never the prompt
      const error = e instanceof Error ? `${e.name}: ${e.message}`.replace(/\s+/g, " ").slice(0, 160) : "error";
      return flat ? { ok: false, error, ms: Date.now() - t0 } : { ok: false, error, ms: Date.now() - t0, tokensIn: null, tokensOut: null };
    }
  }

  private async startLive(): Promise<Ask> {
    // a config of its own with the AI binding only: no D1, KV or Durable Object of the app is started, and wrangler's own login is used
    const dir = mkdtempSync(join(tmpdir(), "model-record-"));
    const config = join(dir, "wrangler.jsonc");
    writeFileSync(config, JSON.stringify({ name: "model-record", compatibility_date: "2026-10-01", ai: { binding: "AI", remote: true } }));
    const { getPlatformProxy } = await import("wrangler");
    const proxy = await getPlatformProxy<{ AI: Ai }>({ configPath: config });
    this.dispose = () => proxy.dispose();
    return this.opts.ask(proxy.env.AI);
  }
}
