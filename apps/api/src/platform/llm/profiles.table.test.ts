import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { modelOverrides } from "../dev";
import { gatewayModels } from "./models";
import { PROFILES, modelFor, withTimeout, type ProfileName } from "./profiles";
import type { Complete, StreamComplete } from "./port";
import type { Env } from "../env";

/**
 * The model of every use, as the gateway asks it (untangle F8): for each profile (platform/llm/profiles.ts), the request that reaches Workers AI (the model, the messages, the token limit, the JSON schema, the reasoning
 * effort), the time limit the gateway gives the call, and the ledger's row (task, sensitivity, label). Written from the code before the model port (each feature's own adapter); after it, each
 * profile is asked for through the port, and the table must hold byte for byte. The development overrides (LLM_QA_MODEL, LLM_CLASSIFY_MODEL, LLM_VERIFY_MODEL, LLM_REASONING) and the development
 * judge's own model and time limit are rows too.
 *
 * Run with WRITE_PROFILE_TABLE=1 to write the table again (only when a profile is meant to change: say so in the commit).
 */

const TABLE_FILE = fileURLToPath(new URL("./profiles.table.json", import.meta.url));

type Call = { model: string; body: Record<string, unknown> };
type Row = { kind: "complete" | "stream"; ai: Call[]; timeoutsMs: number[]; ledger: { task: unknown; sensitivity: unknown; subject: unknown; label: unknown; model: unknown; ok: unknown }[] };

/** A Workers AI binding that answers every call with a small JSON object, and remembers what it was asked. */
function fakeAi(calls: Call[]) {
  return {
    run: async (model: string, body: Record<string, unknown>) => {
      calls.push({ model, body: JSON.parse(JSON.stringify(body)) as Record<string, unknown> });
      return { response: { ok: true }, usage: { prompt_tokens: 11, completion_tokens: 7 } };
    },
  };
}

/** The ledger's table: nothing used today, and the rows the gateway writes. */
function fakeDb(rows: Row["ledger"]) {
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => ({ t: 0 }),
        run: async () => {
          if (/INSERT INTO llm_usage/.test(sql)) rows.push({ subject: args[0], task: args[1], sensitivity: args[2], model: args[4], ok: args[8], label: args[10] });
          return {};
        },
      }),
    }),
  };
}

const REQ = { system: "SYSTEM TEXT", user: "USER TEXT", schema: { type: "object", properties: { ok: { type: "boolean" } } }, maxTokens: 123, label: "the_caller_label" };

type Env0 = Record<string, unknown>;
type Use = { kind: "complete"; make: (env: Env0) => Complete } | { kind: "stream"; make: (env: Env0, abort: AbortSignal) => StreamComplete };

const SUBJECT = "user-1";
const asEnv = (e: Env0) => e as unknown as Env;
const models = (env: Env0) => ({ models: gatewayModels(asEnv(env)) });

/** Every model use of the API, by its profile (platform/llm/profiles.ts), asked through the port. */
const byProfile = (name: ProfileName): Use => {
  const p = PROFILES[name];
  return p.kind === "complete" ? { kind: "complete", make: (env) => modelFor(models(env), p, SUBJECT) } : { kind: "stream", make: (env, abort) => modelFor(models(env), p, SUBJECT, abort) };
};
const USES: Record<string, Use> = {
  route: byProfile("route"),
  understand: byProfile("understand"),
  chatReply: byProfile("chatReply"),
  write: byProfile("write"),
  judge: byProfile("judge"),
  strict: byProfile("strict"),
  // check_claim's strict reading is the strict profile (before the port it had an adapter of its own)
  "strict (check_claim)": byProfile("strict"),
  docsAsk: byProfile("docsAsk"),
  docsAskStream: byProfile("docsAskStream"),
  ideaPlan: byProfile("ideaPlan"),
  ideaCompare: byProfile("ideaCompare"),
  ideaInsights: byProfile("ideaInsights"),
  litscanPlan: byProfile("litscanPlan"),
  litscanAnswer: byProfile("litscanAnswer"),
  litscanJudge: byProfile("litscanJudge"),
  // the development judge (POST /api/v1/chat/judge): the judge with the model and the reasoning the request names, and its time limit
  "devJudge (model, reasoning, 7000 ms)": {
    kind: "stream",
    make: (env, abort) =>
      modelFor({ models: gatewayModels(asEnv(env)).withOverrides(modelOverrides(asEnv({ ...env, LLM_VERIFY_MODEL: "@cf/test/judge-model", LLM_REASONING: "high" }))) }, withTimeout(PROFILES.judge, 7000), SUBJECT, abort),
  },
};

/** The development overrides: each sends its task to the model it names, where ENABLE_DEV_ROUTES is "1" (and nowhere else). */
const DEV: Env0 = { ENABLE_DEV_ROUTES: "1", LLM_QA_MODEL: " @cf/test/qa-model ", LLM_CLASSIFY_MODEL: "@cf/test/classify-model", LLM_VERIFY_MODEL: "@cf/test/verify-model", LLM_REASONING: "medium" };
const NOT_A_MODEL: Env0 = { ENABLE_DEV_ROUTES: "1", LLM_QA_MODEL: "gpt-4", LLM_CLASSIFY_MODEL: "@cf/a b", LLM_VERIFY_MODEL: "", LLM_REASONING: "max" };
const REASONING_ONLY: Env0 = { ENABLE_DEV_ROUTES: "1", LLM_REASONING: "high" };
const OVERRIDES_WITHOUT_DEV: Env0 = { LLM_QA_MODEL: "@cf/test/qa-model", LLM_CLASSIFY_MODEL: "@cf/test/classify-model", LLM_VERIFY_MODEL: "@cf/test/verify-model", LLM_REASONING: "high" };

async function rowOf(use: Use, extra: Env0): Promise<Row> {
  const ai: Call[] = [];
  const ledger: Row["ledger"] = [];
  const timeoutsMs: number[] = [];
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    timeoutsMs.push(ms);
    return timeout(ms);
  });
  try {
    const env: Env0 = { DB: fakeDb(ledger), AI: fakeAi(ai), CROSSREF_MAILTO: "t@example.org", ...extra };
    if (use.kind === "complete") await use.make(env)({ ...REQ });
    else await use.make(env, new AbortController().signal)({ ...REQ }, {});
  } finally {
    spy.mockRestore();
  }
  return { kind: use.kind, ai, timeoutsMs, ledger };
}

async function computeTable(): Promise<Record<string, Row>> {
  const out: Record<string, Row> = {};
  for (const [name, use] of Object.entries(USES)) out[name] = await rowOf(use, {});
  for (const [name, use] of Object.entries(USES)) {
    out[`${name} + development overrides`] = await rowOf(use, DEV);
    out[`${name} + overrides that are not models`] = await rowOf(use, NOT_A_MODEL);
    out[`${name} + overrides without ENABLE_DEV_ROUTES`] = await rowOf(use, OVERRIDES_WITHOUT_DEV);
    out[`${name} + reasoning only`] = await rowOf(use, REASONING_ONLY);
  }
  return out;
}

afterEach(() => vi.restoreAllMocks());

describe("the model profiles (untangle F8)", () => {
  it("ask the gateway exactly as the table says, for every profile and every override", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const computed = await computeTable();
    if (process.env.WRITE_PROFILE_TABLE === "1") writeFileSync(TABLE_FILE, JSON.stringify(computed, null, 1) + "\n");
    const table = JSON.parse(readFileSync(TABLE_FILE, "utf8")) as Record<string, Row>;
    expect(Object.keys(computed).sort()).toEqual(Object.keys(table).sort());
    for (const key of Object.keys(table)) expect(computed[key], key).toEqual(table[key]);
  });

  it("names every profile in the table", () => {
    for (const name of Object.keys(PROFILES)) expect(USES, name).toHaveProperty(name);
  });
});
