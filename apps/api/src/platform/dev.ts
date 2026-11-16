import type { Env } from "./env";

/**
 * Development mode and the stand-ins, decided here and nowhere else (docs/design/untangle.md, F7). Two Worker variables, never set in production (scripts/push-secrets.mjs refuses them):
 *   - ENABLE_DEV_ROUTES=1 is development mode: the /api/v1/dev/* routes and the development routes of a feature answer (app/dev-routes.ts), and the options below may change a few numbers
 *     so that a test need not wait the real ones;
 *   - QA_STUB=1 together with it is a test run: the composition root (app/stand-ins.ts) hands every feature the stand-ins of the model, the embeddings, the page reader and the outside services.
 * Nothing else reads either variable.
 */

type DevEnv = Partial<
  Pick<Env, "ENABLE_DEV_ROUTES" | "QA_STUB" | "QA_TOP_K" | "SSE_KEEPALIVE_MS" | "DEV_IDP_URL" | "LLM_QA_MODEL" | "LLM_CLASSIFY_MODEL" | "LLM_VERIFY_MODEL" | "LLM_REASONING">
>;

/** Development mode: ENABLE_DEV_ROUTES is "1". */
export const devMode = (env: Partial<Pick<Env, "ENABLE_DEV_ROUTES">>): boolean => env.ENABLE_DEV_ROUTES === "1";

/** A test run: development mode with QA_STUB "1", where every outside service and every model is a stand-in. */
export const standIns = (env: Partial<Pick<Env, "ENABLE_DEV_ROUTES" | "QA_STUB">>): boolean => devMode(env) && env.QA_STUB === "1";

export type Reasoning = "low" | "medium" | "high";

/**
 * The development model choices, one map (cost and quality experiments, docs/spikes/R5-cost.md): the private `qa`, `classify` and `verify` tasks to another Workers AI model, and how long a
 * gpt-oss model thinks. Empty outside development mode; a value that is not a Workers AI model name (`@cf/...`) or an effort is left out.
 */
export type ModelOverrides = { qa?: string; classify?: string; verify?: string; reasoning?: Reasoning };

const MODEL = /^@cf\/[\w.\-/]+$/;
const modelOf = (raw: string | undefined): string | undefined => {
  const m = raw?.trim();
  return m && MODEL.test(m) ? m : undefined;
};

/** The model overrides of an environment (development mode only). */
export function modelOverrides(env: DevEnv): ModelOverrides {
  if (!devMode(env)) return {};
  const out: ModelOverrides = {};
  const qa = modelOf(env.LLM_QA_MODEL);
  const classify = modelOf(env.LLM_CLASSIFY_MODEL);
  const verify = modelOf(env.LLM_VERIFY_MODEL);
  if (qa) out.qa = qa;
  if (classify) out.classify = classify;
  if (verify) out.verify = verify;
  if (["low", "medium", "high"].includes(env.LLM_REASONING ?? "")) out.reasoning = env.LLM_REASONING as Reasoning;
  return out;
}

/** What development mode may change; in production every field is "as built" (false, undefined or empty). */
export type DevOptions = {
  /** Development mode (ENABLE_DEV_ROUTES=1). The raw-output logs of the prompt tuning (a model's whole JSON and what it was shown) are written only then. */
  on: boolean;
  /** A test run (with QA_STUB=1): the stand-ins are in place. */
  standIns: boolean;
  /** The keep-alive interval of a stream (SSE_KEEPALIVE_MS, 50 ms or more), so a test need not wait the real one. */
  keepAliveMs: number | undefined;
  /** Passages shown to the model for a question about a paper (QA_TOP_K, a whole number from 1 to 12; the cost experiments). */
  topK: number | undefined;
  /** How often a literature scan's stream reads the database (one short interval in development). */
  scanPollsMs: readonly number[] | undefined;
  /** How often "Ask this paper" looks at a reading that is going (150 ms in development). */
  readingPollMs: number | undefined;
  /** The wait between two tries of a Workflow step in a test run ("1 second": a test cannot wait the real delays). */
  stepRetryDelay: "1 second" | undefined;
  /** The local fake identity provider that Google sign-in is pointed at (DEV_IDP_URL). */
  idpUrl: string | undefined;
  /** The development model choices (one map). */
  models: ModelOverrides;
};

export function devOptions(env: DevEnv): DevOptions {
  const on = devMode(env);
  const keepAlive = Number(env.SSE_KEEPALIVE_MS);
  const topK = Number(env.QA_TOP_K);
  const test = standIns(env);
  return {
    on,
    standIns: test,
    keepAliveMs: on && Number.isFinite(keepAlive) && keepAlive >= 50 ? keepAlive : undefined,
    topK: on && Number.isInteger(topK) && topK >= 1 && topK <= 12 ? topK : undefined,
    scanPollsMs: on ? [400] : undefined,
    readingPollMs: on ? 150 : undefined,
    stepRetryDelay: test ? "1 second" : undefined,
    idpUrl: on ? env.DEV_IDP_URL : undefined,
    models: modelOverrides(env),
  };
}
