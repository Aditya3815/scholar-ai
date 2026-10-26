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
    if (url.pathname === "/status") {
      const inst = await env.INGEST.get(key);
      return Response.json(await inst.status());
    }
    return new Response("/start?key=x[&fail][&slow=ms]  /status?key=x");
  },
};
