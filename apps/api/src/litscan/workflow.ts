import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { StreamComplete } from "../docs/qa";
import { installGates } from "../gate";
import { remoteGate, type ApiGate } from "../gate/api-gate";
import { countOutcome } from "../outcomes";
import { answerModel, judgeModel, searchFor, stubbed, type ScanEnv } from "./model";
import { appendEvent, endScan, getScanForRun, itemsOf, partsOf } from "./store";
import { answerSubQuestion } from "./worker";

/**
 * A literature scan as a Cloudflare Workflow (spike R10, docs/design/litscan.md): one instance per scan, one named step per sub-question, all started at once. A step that fails is tried
 * again by the engine on its own; one that still fails ends as a plain gap in the report and does not touch the others. The steps write their results to the database as they finish
 * (src/litscan/store.ts), and that is what the page reads: the Workflow's own state is never looked at.
 *
 * The report is not written by a model: the parts are the checked answers, and putting them together (shared/litscan.ts) is a program. So a scan costs the answers and nothing more.
 */
export type LitscanEnv = ScanEnv & { API_GATE?: DurableObjectNamespace<ApiGate> };
export type LitscanParams = { id: string };

/** How long the model may take to write one sub-question's answer, once it has started (the longest seen in a real run was 62 s, the usual 17 to 24 s). */
export const MODEL_LIMIT_MS = 75_000;

export class LitscanRun extends WorkflowEntrypoint<LitscanEnv, LitscanParams> {
  async run(event: WorkflowEvent<LitscanParams>, step: WorkflowStep): Promise<{ id: string }> {
    const env = this.env;
    const db = env.DB;
    const { id } = event.payload;
    const startedAt = Date.now();
    installGates(env.API_GATE ? remoteGate(env.API_GATE) : null);
    // the local end-to-end run waits a second between tries instead of the real delays
    const fast = stubbed(env);
    const wait = (real: string) => (fast ? "1 second" : real) as `${number} ${"second" | "seconds"}`;

    const scan = await step.do("load", async () => {
      const row = await getScanForRun(db, id);
      if (!row || row.state !== "running") throw new NonRetryableError("the scan is not running");
      return { userId: row.user_id, language: row.language, items: itemsOf(row), scope: row.scope === "india" ? ("india" as const) : ("all" as const) };
    });

    await Promise.allSettled(
      scan.items.map((item, idx) =>
        step.do(`worker-${idx}`, { retries: { limit: 2, delay: wait("6 seconds"), backoff: "exponential" }, timeout: "4 minutes" }, async () => {
          // the time limit starts when the model does, not before the search
          const clock = new AbortController();
          let timer: ReturnType<typeof setTimeout> | undefined;
          const model = answerModel(env, scan.userId, clock.signal);
          const judge = judgeModel(env, scan.userId, clock.signal);
          const stream: StreamComplete = (req, hooks) => {
            timer ??= setTimeout(() => clock.abort(), MODEL_LIMIT_MS);
            return model(req, hooks);
          };
          try {
            const part = await answerSubQuestion({
              idx,
              item,
              language: scan.language,
              deps: { search: searchFor(env, scan.scope), stream, judge: env.CHAT_JUDGE === "off" ? undefined : judge },
              onStage: async (stage) => void (await appendEvent(db, id, `w:${idx}:${stage}`, { type: "worker", idx, stage })),
              signal: clock.signal,
            });
            if (await appendEvent(db, id, `part:${idx}`, { type: "part", part })) await countOutcome(db, "litscan", part.status === "answered" ? "answered" : part.reason);
            return { idx, status: part.status };
          } finally {
            if (timer) clearTimeout(timer);
          }
        }),
      ),
    );

    await step.do("finish", { retries: { limit: 2, delay: wait("3 seconds") }, timeout: "1 minute" }, async () => {
      // a sub-question whose step failed for good (or whose result somehow was not stored) is a gap, said plainly, not a missing section
      const have = new Set((await partsOf(db, id)).map((p) => p.idx));
      for (let idx = 0; idx < scan.items.length; idx++) {
        if (have.has(idx)) continue;
        if (await appendEvent(db, id, `part:${idx}`, { type: "part", part: { idx, status: "gap", found: 0, reason: "unavailable" } })) await countOutcome(db, "litscan", "unavailable");
      }
      if (await endScan(db, id, "completed")) {
        // one line a scan, no text and no person: how it went, so a change in how often sub-questions end without an answer can be seen in the logs
        const parts = await partsOf(db, id);
        console.log(JSON.stringify({ level: "info", msg: "litscan_done", subQuestions: scan.items.length, answered: parts.filter((p) => p.status === "answered").length, language: scan.language, ms: Date.now() - startedAt }));
      }
      return { id };
    });
    return { id };
  }
}
