import { Hono, type Context } from "hono";
import { authRoutes } from "../auth/routes";
import { libraryRoutes } from "../library/routes";
import { accountRoutes } from "../account/routes";
import { referenceRoutes } from "../references/routes";
import { documentRoutes } from "../docs/routes";
import { shareRoutes } from "../docs/share-routes";
import { ideaRoutes } from "../idea/routes";
import { chatRoutes } from "../chat/routes";
import { oaRoutes } from "../oa/routes";
import { litscanRoutes } from "../litscan/routes";
import { feedbackRoutes } from "../feedback/routes";
import { adminRoutes } from "../admin/routes";
import { monitoringRoutes, refuseCrossOrigin } from "../monitoring/routes";
import { meter, writeCacheRows } from "../cache";
import { apiSecurityHeaders, noStore, requestLog } from "../middleware";
import { rateLimit } from "../ratelimit";
import { remoteGate } from "../gate/api-gate";
import { installGates } from "../gate";
import { trendingRoutes } from "../trending/routes";
import { connectedAppsRoutes } from "../mcp/apps";
import { sameOriginWrites, type RouteKey } from "../platform/http/guards";
import type { Env, HonoEnv } from "../platform/env";
import { withRequestDeps } from "./deps";

/** The Worker's HTTP app: the middleware every request passes, and each feature's router mounted at its address. src/index.ts adds the routes of its own and serves it. */
export const app = new Hono<{ Bindings: Env; Variables: { requestId: string } }>();

type Mount = {
  at: string;
  routes: Hono<HonoEnv>;
  /** Its answers, refusals included, carry `Cache-Control: no-store` (everything a signed-in person reads, and every write). */
  noStore?: true;
  /** How it refuses a write from another origin, when not with the JSON problem. */
  crossOrigin?: (c: Context) => Response;
};

/** Each feature's router, where it is mounted, and its defaults. */
export const MOUNTS: readonly Mount[] = [
  { at: "/api/v1/auth", routes: authRoutes, noStore: true },
  { at: "/api/v1/library", routes: libraryRoutes, noStore: true },
  { at: "/api/v1/account", routes: accountRoutes, noStore: true },
  { at: "/api/v1/references", routes: referenceRoutes },
  { at: "/api/v1/documents", routes: documentRoutes, noStore: true },
  // sharing a paper's workspace (docs/design/paper-share.md): 404 everywhere while SHARE is off
  { at: "/api/v1/share", routes: shareRoutes, noStore: true },
  { at: "/api/v1/idea", routes: ideaRoutes, noStore: true },
  { at: "/api/v1/chat", routes: chatRoutes, noStore: true },
  { at: "/api/v1/papers/oa", routes: oaRoutes, noStore: true },
  { at: "/api/v1/litscan", routes: litscanRoutes, noStore: true },
  { at: "/api/v1/feedback", routes: feedbackRoutes, noStore: true },
  { at: "/api/v1/admin", routes: adminRoutes, noStore: true },
  // the browser's error reports: a beacon, answered with an empty body whatever happens (src/monitoring/routes.ts)
  { at: "/api/v1/monitoring", routes: monitoringRoutes, crossOrigin: refuseCrossOrigin },
  // the Home page's Trending list: one public file, outside the search bucket of the rate limiter (src/trending/routes.ts)
  { at: "/api/v1/home", routes: trendingRoutes },
  // the apps a person connected through the MCP server, and the button that disconnects one (Settings, Connected apps; 404 while the server is off)
  { at: "/api/v1/connected-apps", routes: connectedAppsRoutes, noStore: true },
];

const DEV = "development only (404 unless ENABLE_DEV_ROUTES=1); the test scripts call it from Node, which sends no Origin";

/**
 * The writes that are NOT checked for where they come from (taken from the code before the check moved here: none of these checked it). Every other request to /api that is not a read is.
 */
export const SAME_ORIGIN_SKIPS: Readonly<Record<RouteKey, string>> = {
  "POST /api/v1/dev/llm": DEV,
  "PUT /api/v1/dev/r2-object": DEV,
  "DELETE /api/v1/dev/r2-object": DEV,
  "POST /api/v1/dev/sql": DEV,
  "POST /api/v1/dev/cache": DEV,
  "POST /api/v1/dev/kv": DEV,
  "POST /api/v1/dev/gate": DEV,
  "POST /api/v1/dev/make-admin": DEV,
};

/** Development routes of a feature: a plain 404 unless ENABLE_DEV_ROUTES=1, and then checked like any write. */
export const DEV_FIRST: readonly RouteKey[] = ["POST /api/v1/chat/route", "POST /api/v1/chat/judge"];

app.use("*", requestLog());
// every call to Crossref and CORE asks the shared lane first (the binding is the same for the life of an isolate)
app.use("/api/*", async (c, next) => {
  installGates(c.env.API_GATE ? remoteGate(c.env.API_GATE) : null);
  await next();
});
// cache hit and miss counts are written to the database after the response, in small batches (src/cache/meter.ts)
app.use("/api/*", async (c, next) => {
  try {
    meter.attach(c.executionCtx, (rows) => writeCacheRows(c.env.DB, rows));
  } catch {
    /* no execution context (a test calling the app directly): counts stay in memory */
  }
  await next();
});
// the deps of the request (app/deps.ts): the real services and models, or a test run's stand-ins, decided once, before any router
app.use("/api/*", withRequestDeps);
app.use("/api/*", apiSecurityHeaders);
app.use("/api/*", rateLimit());
// inside the limiter (a 429 is not marked) and around the origin check (its refusal is)
for (const m of MOUNTS) if (m.noStore) app.use(`${m.at}/*`, noStore);
app.use(
  "/api/*",
  sameOriginWrites({
    skip: SAME_ORIGIN_SKIPS,
    devFirst: DEV_FIRST,
    refusals: Object.fromEntries(MOUNTS.flatMap((m) => (m.crossOrigin ? [[m.at, m.crossOrigin]] : []))),
  }),
);
for (const m of MOUNTS) app.route(m.at, m.routes);
