import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { remoteGate } from "../gate/api-gate";
import { installGates } from "../gate";
import { EMBED_BATCH, IngestError, recordFailure, stepEmbed, stepFetch, stepFinish, stepRead, type IngestDeps } from "./ingest";
import { keepOld } from "./store";
import { OA_REFRESH_DAYS } from "@scholar/shared";
import { sourceDepsFor } from "./deps";
import type { Env } from "../platform/env";
import type { Deps } from "../platform/deps";

/**
 * The reading of one open-access paper as a Cloudflare Workflow (spike R9): named steps, each retried by the engine on its own and checkpointed, so a failure in the middle
 * (the embedding service, a memory limit in the extraction) repeats that step and not the download before it. One instance per try: the instance id is
 * `oa-<hash of the paper>-<attempt>`, so a second person asking for the same paper while it is being read finds the instance that exists and joins it.
 * The row in D1 (oa_papers) is what the screen reads; the Workflow's own state is not looked at.
 */
/** `refresh`: the paper is ready already and is being fetched again because it was read long ago (it keeps answering meanwhile; a failure to fetch leaves it as it is). */
export type OaParams = { key: string; attempt: number; refresh?: boolean };


/** The error as the engine should see it: a reason that waiting cannot cure stops the retries at once. */
async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof IngestError && !e.retryable) throw new NonRetryableError(e.message);
    throw e;
  }
}

/** The Workflow, with its deps (the embeddings, the network, a test run's short retries) taken from the composition root: index.ts exports it as OaIngest with depsFor (app/deps.ts). */
export abstract class OaIngestFlow extends WorkflowEntrypoint<Env, OaParams> {
  protected abstract depsFor(env: Env): Deps;

  async run(event: WorkflowEvent<OaParams>, step: WorkflowStep): Promise<{ key: string; chunks: number }> {
    const env = this.env;
    installGates(env.API_GATE ? remoteGate(env.API_GATE) : null);
    const d = this.depsFor(env);
    const deps: IngestDeps = { db: env.DB, files: env.FILES, embed: d.embedder!, source: sourceDepsFor(env, d.fetch.papers) };
    const { key, refresh = false } = event.payload;
    // the local end-to-end run waits a second between tries instead of the real delays (a test cannot wait twenty seconds)
    const wait = (real: string) => (d.dev.stepRetryDelay ?? real) as `${number} ${"second" | "seconds"}`;
    // a refresh that cannot fetch the new file leaves the copy that works (it is looked at again in thirty days); once the new file is being read, a failure is a failure like any other
    let fetching = true;
    try {
      const fetched = await step.do("fetch", { retries: { limit: 3, delay: wait("20 seconds"), backoff: "exponential" }, timeout: "2 minutes" }, () => guard(() => stepFetch(deps, key, { refresh })));
      if (refresh && fetched.unchanged) return { key, chunks: 0 };
      fetching = false;
      const read = await step.do("read", { retries: { limit: 1, delay: wait("5 seconds") }, timeout: "3 minutes" }, () => guard(() => stepRead(deps, key)));
      for (let i = 0; i < Math.ceil(read.total / EMBED_BATCH); i++) {
        await step.do(`embed-${i}`, { retries: { limit: 4, delay: wait("10 seconds"), backoff: "exponential" }, timeout: "2 minutes" }, () => guard(() => stepEmbed(deps, key)));
      }
      await step.do("finish", { retries: { limit: 2, delay: wait("5 seconds") }, timeout: "1 minute" }, () => guard(() => stepFinish(deps, key)));
      return { key, chunks: read.total };
    } catch (e) {
      if (refresh && fetching) {
        await step.do("keep-old", async () => ({ kept: await keepOld(env.DB, key, Date.now(), OA_REFRESH_DAYS).then(() => true) }));
        return { key, chunks: 0 };
      }
      await step.do("record-failure", async () => ({ reason: await recordFailure(deps, key, e) }));
      throw e;
    }
  }
}
