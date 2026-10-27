// Spike R9: a Workflow shaped like the open-access ingest: fetch -> read -> embed in batches -> finish. Steps are named, retried, and write under keys they can overwrite.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";

type Params = { key: string; failReadOnce?: boolean; slowMs?: number };
const attempts: Record<string, number> = {}; // in-memory: counts how often a step body really ran (a restart shows as a repeat)

export class Ingest extends WorkflowEntrypoint<{ INGEST: any }, Params> {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const { key, failReadOnce, slowMs } = event.payload;
    const fetched = await step.do("fetch", async () => {
      attempts[`${key}:fetch`] = (attempts[`${key}:fetch`] ?? 0) + 1;
      return { r2Key: `oa/${key}.pdf`, bytes: 1234 };
    });
    const read = await step.do("read", { retries: { limit: 3, delay: "200 milliseconds", backoff: "exponential" }, timeout: "30 seconds" }, async () => {
      attempts[`${key}:read`] = (attempts[`${key}:read`] ?? 0) + 1;
      if (failReadOnce && attempts[`${key}:read`] === 1) throw new Error("extraction ran out of memory (simulated)");
      return { pages: 12, chunks: 45, from: fetched.r2Key };
    });
    for (let i = 0; i < Math.ceil(read.chunks / 20); i++) {
      await step.do(`embed-${i}`, async () => {
        attempts[`${key}:embed-${i}`] = (attempts[`${key}:embed-${i}`] ?? 0) + 1;
        if (slowMs) await new Promise((r) => setTimeout(r, slowMs));
        return { batch: i };
      });
    }
    return await step.do("finish", async () => ({ key, status: "ready", chunks: read.chunks, ranOnce: Object.fromEntries(Object.entries(attempts).filter(([k]) => k.startsWith(key + ":"))) }));
  }
}

export default {
  async fetch(req: Request, env: { INGEST: any }): Promise<Response> {
    const url = new URL(req.url);
    const key = url.searchParams.get("key") ?? "paper-1";
    if (url.pathname === "/start") {
      try {
        const inst = await env.INGEST.create({ id: key, params: { key, failReadOnce: url.searchParams.has("fail"), slowMs: Number(url.searchParams.get("slow") ?? 0) } });
        return Response.json({ started: inst.id });
      } catch (e) {
        // the instance ID is the paper key: a second request for the same paper lands here and joins the first
        const inst = await env.INGEST.get(key).catch(() => null);
        return Response.json({ joined: key, status: inst ? await inst.status() : null, error: String((e as Error).message ?? e) }, { status: 200 });
      }
    }
    if (url.pathname === "/scan/start") {
      const inst = await (env as unknown as { SCAN: any }).SCAN.create({ id: key, params: { key, workers: Number(url.searchParams.get("n") ?? 4), failWorker: url.searchParams.has("fail") ? Number(url.searchParams.get("fail")) : undefined, slowMs: Number(url.searchParams.get("slow") ?? 0) } });
      return Response.json({ started: inst.id });
    }
    if (url.pathname === "/scan/events") return Response.json(scanEvents(key, Number(url.searchParams.get("after") ?? 0)));
    if (url.pathname === "/scan/status") return Response.json(await (await (env as unknown as { SCAN: any }).SCAN.get(key)).status());
    if (url.pathname === "/status") {
      const inst = await env.INGEST.get(key);
      return Response.json(await inst.status());
    }
    return new Response("/start?key=x[&fail][&slow=ms]  /status?key=x");
  },
};

/**
 * Spike R10: a literature-scan shaped Workflow: plan -> N workers IN PARALLEL (one fails for good, one is slow) -> merge -> finish. Every worker writes its own progress event
 * (an append-only list with a sequence number, as a database table would) so that a late reader can replay from any point. Which step ran when is recorded, to see whether the
 * workers really overlapped.
 */
const events: { seq: number; at: number; key: string; type: string; data: unknown }[] = [];
const emit = (key: string, type: string, data: unknown) => events.push({ seq: events.filter((e) => e.key === key).length + 1, at: Date.now(), key, type, data });

export class Scan extends WorkflowEntrypoint<{ SCAN: any }, { key: string; workers: number; failWorker?: number; slowMs?: number }> {
  async run(event: WorkflowEvent<{ key: string; workers: number; failWorker?: number; slowMs?: number }>, step: WorkflowStep) {
    const { key, workers, failWorker, slowMs } = event.payload;
    const plan = await step.do("plan", async () => {
      const topics = Array.from({ length: workers }, (_, i) => `subtopic-${i + 1}`);
      emit(key, "progress", { phase: "plan", done: 1, total: 1 });
      return { topics };
    });
    emit(key, "status", { state: "working", phase: "workers" });
    // fan-out: every worker is a named step, retried on its own; a worker that fails for good must not stop the others (allSettled)
    const settled = await Promise.allSettled(
      plan.topics.map((topic, i) =>
        step.do(`worker-${i + 1}`, { retries: { limit: 2, delay: "200 milliseconds" }, timeout: "30 seconds" }, async () => {
          const started = Date.now();
          emit(key, "progress", { phase: "worker", worker: i + 1, state: "started" });
          if (slowMs && i === 0) await new Promise((r) => setTimeout(r, slowMs));
          else await new Promise((r) => setTimeout(r, 400));
          if (failWorker === i + 1) throw new Error(`worker ${i + 1} cannot read its papers`);
          emit(key, "progress", { phase: "worker", worker: i + 1, state: "done" });
          return { topic, claims: 3, ms: Date.now() - started };
        }),
      ),
    );
    const ok = settled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    const gaps = settled.flatMap((r, i) => (r.status === "rejected" ? [{ worker: i + 1, why: String((r.reason as Error)?.message ?? r.reason) }] : []));
    const merged = await step.do("merge", async () => {
      emit(key, "progress", { phase: "merge", done: ok.length, total: workers });
      return { sections: ok.map((o) => o.topic), gaps };
    });
    emit(key, "status", { state: "completed" });
    return { key, merged, startedAt: events.filter((e) => e.key === key).map((e) => e.at)[0] };
  }
}

export const scanEvents = (key: string, after = 0) => events.filter((e) => e.key === key && e.seq > after);
