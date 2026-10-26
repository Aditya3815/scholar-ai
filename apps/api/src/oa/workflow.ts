import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { workersAiEmbedder, hashEmbedder, type Embedder } from "../docs/embed";
import { remoteGate, type ApiGate } from "../gate/api-gate";
import { installGates, withGate } from "../gate";
import { EMBED_BATCH, IngestError, recordFailure, stepEmbed, stepFetch, stepFinish, stepRead, type IngestDeps } from "./ingest";
import { sourceDepsFor } from "./deps";

/**
 * The reading of one open-access paper as a Cloudflare Workflow (spike R9): named steps, each retried by the engine on its own and checkpointed, so a failure in the middle
 * (the embedding service, a memory limit in the extraction) repeats that step and not the download before it. One instance per try: the instance id is
 * `oa-<hash of the paper>-<attempt>`, so a second person asking for the same paper while it is being read finds the instance that exists and joins it.
 * The row in D1 (oa_papers) is what the screen reads; the Workflow's own state is not looked at.
 */
export type OaEnv = {
  DB: D1Database;
  FILES: R2Bucket;
  AI?: Ai;
  API_GATE?: DurableObjectNamespace<ApiGate>;
  ENABLE_DEV_ROUTES?: string;
  QA_STUB?: string;
  CROSSREF_MAILTO: string;
  OPENALEX_API_KEY?: string;
};
export type OaParams = { key: string; attempt: number };

const embedderFor = (env: OaEnv): Embedder => (env.ENABLE_DEV_ROUTES === "1" && env.QA_STUB === "1" ? hashEmbedder : workersAiEmbedder(env.AI!));

/** The error as the engine should see it: a reason that waiting cannot cure stops the retries at once. */
async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof IngestError && !e.retryable) throw new NonRetryableError(e.message);
    throw e;
  }
}

export class OaIngest extends WorkflowEntrypoint<OaEnv, OaParams> {
  async run(event: WorkflowEvent<OaParams>, step: WorkflowStep): Promise<{ key: string; chunks: number }> {
    const env = this.env;
    installGates(env.API_GATE ? remoteGate(env.API_GATE) : null);
    const deps: IngestDeps = { db: env.DB, files: env.FILES, embed: embedderFor(env), source: sourceDepsFor(env, withGate) };
    const { key } = event.payload;
    // the local end-to-end run waits a second between tries instead of the real delays (a test cannot wait twenty seconds)
    const fast = env.ENABLE_DEV_ROUTES === "1" && env.QA_STUB === "1";
    const wait = (real: string) => (fast ? "1 second" : real) as `${number} ${"second" | "seconds"}`;
    try {
      await step.do("fetch", { retries: { limit: 3, delay: wait("20 seconds"), backoff: "exponential" }, timeout: "2 minutes" }, () => guard(() => stepFetch(deps, key)));
      const read = await step.do("read", { retries: { limit: 1, delay: wait("5 seconds") }, timeout: "3 minutes" }, () => guard(() => stepRead(deps, key)));
      for (let i = 0; i < Math.ceil(read.total / EMBED_BATCH); i++) {
        await step.do(`embed-${i}`, { retries: { limit: 4, delay: wait("10 seconds"), backoff: "exponential" }, timeout: "2 minutes" }, () => guard(() => stepEmbed(deps, key)));
      }
      await step.do("finish", { retries: { limit: 2, delay: wait("5 seconds") }, timeout: "1 minute" }, () => guard(() => stepFinish(deps, key)));
      return { key, chunks: read.total };
    } catch (e) {
      await step.do("record-failure", async () => ({ reason: await recordFailure(deps, key, e) }));
      throw e;
    }
  }
}
