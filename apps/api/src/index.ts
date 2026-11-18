import { streamSSE } from "hono/streaming";
import type { HealthResponse, JobsHealthResponse } from "@scholar/shared";
import { INVALID_QUERY, searchService } from "./search/service";
import { captureException } from "./monitoring/sentry";
import { runMaintenance } from "./maintenance";
import { recheckRetractions } from "./library/retraction";
import { readJobs, runJob, type JobName } from "./jobs";
import { remoteGate } from "./gate/api-gate";
import { installGates } from "./gate";
import { isMcpPath, mcpMode } from "./mcp/flag";
import { baseUrlOf } from "./mcp/scopes";
import { mcpApiHandlerWith } from "./mcp/server";
import type { Env } from "./platform/env";
import { app } from "./app/mount";
import { devRoutes } from "./app/dev-routes";
import { depsFor, trendingJobFor } from "./app/deps";
import { OaIngestFlow } from "./oa/workflow";
import { LitscanFlow } from "./litscan/workflow";

app.get("/api/v1/health", async (c) => {
  let db: HealthResponse["db"] = "ok";
  let migrations = 0;
  try {
    // Also proves the schema was migrated: a deploy that skipped `db:migrate:remote` reports 0 here.
    const row = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first<{ n: number }>();
    migrations = row?.n ?? 0;
  } catch {
    db = "error";
  }
  const ok = db === "ok" && migrations > 0;
  const body: HealthResponse = {
    ok,
    service: "scholar-api",
    time: new Date().toISOString(),
    db,
    migrations,
    version: c.env.CF_VERSION_METADATA?.id,
  };
  c.header("Cache-Control", "no-store");
  return c.json(body, ok ? 200 : 503);
});

/** The scheduled jobs: 200 when each ran on time and well, 503 when one failed, hung or did not run. Point an uptime check at it (docs/runbook.md). */
app.get("/api/v1/health/jobs", async (c) => {
  c.header("Cache-Control", "no-store");
  if (c.env.EXPECT_CRON !== "1") return c.json({ ok: true, scheduled: false, jobs: [] } satisfies JobsHealthResponse);
  try {
    const jobs = await readJobs(c.env.DB);
    const ok = jobs.every((j) => j.state === "ok");
    // Public: states and times only, never the error text.
    const body: JobsHealthResponse = { ok, scheduled: true, jobs: jobs.map((j) => ({ name: j.name, state: j.state, lastOkAt: j.lastOkAt, runs: j.runs })) };
    return c.json(body, ok ? 200 : 503);
  } catch {
    const body: JobsHealthResponse = { ok: false, scheduled: true, jobs: [], error: "db" };
    return c.json(body, 503);
  }
});

app.get("/api/v1/search", async (c) => {
  const read = searchService.read((k) => c.req.query(k));
  if (!read.ok) return c.json(INVALID_QUERY, 400);
  return c.json(await searchService.run(c.env, read.input));
});

/**
 * SSE: `snapshot` har provider ke baad (merged results + provider statuses), phir `done` (final, retraction flags ke saath).
 * UI pehle results ~1 s mein dikha sakti hai, sabse dheemi source ka wait kiye bina.
 */
app.get("/api/v1/search/stream", (c) => {
  const read = searchService.read((k) => c.req.query(k));
  if (!read.ok) return c.json(INVALID_QUERY, 400);
  const input = read.input;

  return streamSSE(c, async (stream) => {
    let closed = false;
    stream.onAbort(() => {
      closed = true;
    });
    const send = async (event: string, data: unknown) => {
      if (!closed) await stream.writeSSE({ event, data: JSON.stringify(data) });
    };
    try {
      const final = await searchService.run(c.env, input, { onSnapshot: (s) => send("snapshot", s) });
      await send("done", final);
    } catch (err) {
      console.error(err);
      await send("error", { type: "internal_error", title: "Search failed" });
    }
  });
});

// every /api/v1/dev/* route: a plain 404 unless the Worker is in development mode (app/dev-routes.ts)
app.route("/api/v1/dev", devRoutes);

app.notFound((c) =>
  c.json({ type: "not_found", title: "Not found", detail: c.req.path }, 404),
);

app.onError((err, c) => {
  captureException(c.env, err, { route: c.req.routePath, release: c.env.CF_VERSION_METADATA?.id, waitUntil: (p) => c.executionCtx.waitUntil(p) });
  console.error(JSON.stringify({ level: "error", msg: "unhandled", requestId: c.get("requestId"), error: err.name }));
  return c.json({ type: "internal_error", title: "Internal error", requestId: c.get("requestId") }, 500);
});

export { S2Throttle } from "./s2-throttle";
export { ApiGate } from "./gate/api-gate";
/** The reading of an open-access paper (oa/workflow.ts), with the deps of each run. */
export class OaIngest extends OaIngestFlow {
  protected depsFor(env: Env) {
    return depsFor(env);
  }
}
/** A literature scan (litscan/workflow.ts), with the deps of each run. */
export class LitscanRun extends LitscanFlow {
  protected depsFor(env: Env) {
    return depsFor(env);
  }
}

/**
 * The MCP server and its OAuth endpoints (src/mcp) own a few paths of their own (MCP_PATHS); everything else goes to the app as before. With the switch off those paths go to the app too, which has no
 * route for them: they answer 404 exactly as they did before the server existed.
 */
async function fetchWorker(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!isMcpPath(new URL(request.url).pathname) || (await mcpMode(env)) === "off") return app.fetch(request, env, ctx);
  // the MCP tools call Crossref through the same shared lanes as every /api request
  installGates(env.API_GATE ? remoteGate(env.API_GATE) : null);
  // loaded only here: the OAuth library imports the Workers runtime, and nothing else of the Worker needs it
  const { oauthPages, providerFor } = await import("./mcp/oauth");
  return providerFor(baseUrlOf(env, request), mcpApiHandlerWith((e) => depsFor(e as Env)), { fetch: (r, e, x) => oauthPages.fetch(r, e, x) }).fetch(request, env, ctx);
}

export default {
  fetch: fetchWorker,
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // the calls to Crossref take their turn in the shared lane, as they do in a request
    installGates(env.API_GATE ? remoteGate(env.API_GATE) : null);
    // the deps of this run (app/deps.ts): Crossref's network for the re-check, and which Trending job runs (a test run's runs on its stand-ins)
    const deps = depsFor(env);
    const runTrendingFromEnv = trendingJobFor(env);
    const cron = <T,>(name: JobName, job: () => Promise<T>) =>
      runJob(env.DB, name, job).then(
        (result) => console.log(JSON.stringify({ level: "info", msg: name, result })),
        (err) => {
          console.error(JSON.stringify({ level: "error", msg: `${name}_failed`, error: String(err) }));
          captureException(env, err, { route: `cron:${name}`, source: "cron", release: env.CF_VERSION_METADATA?.id, waitUntil: (p) => ctx.waitUntil(p) });
        },
      );
    // independent of each other: a failing re-check must not stop the clean-up, and the other way round (and neither stops the Trending list)
    // The handler AWAITS them: the runtime waits for the promise it returns for up to the 15 minutes a Cron Trigger may last, and the Trending job takes minutes. Work left to ctx.waitUntil
    // after the handler has returned is documented only as work that "should settle before the invocation completes" (the 30 seconds are for a response that was sent). cron() never rejects.
    await Promise.all([
      cron("maintenance", () => runMaintenance(env.DB)),
      cron("retraction_check", () =>
        recheckRetractions(env.DB, { CROSSREF_MAILTO: env.CROSSREF_MAILTO, ...(deps.fetch.crossref ? { fetch: deps.fetch.crossref } : {}) }),
      ),
      // the Home page's Trending list: its daily file and, on Mondays, the weekly scan it is made from (src/trending/job.ts); a failure leaves the last good file
      cron("trending", () => runTrendingFromEnv(env, controller.scheduledTime)),
    ]);
  },
} satisfies ExportedHandler<Env>;
