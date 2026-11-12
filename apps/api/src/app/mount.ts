import { Hono } from "hono";
import { authRoutes } from "../auth/routes";
import { libraryRoutes } from "../library/routes";
import { accountRoutes } from "../account/routes";
import { referenceRoutes } from "../references/routes";
import { documentRoutes } from "../docs/routes";
import { ideaRoutes } from "../idea/routes";
import { chatRoutes } from "../chat/routes";
import { oaRoutes } from "../oa/routes";
import { litscanRoutes } from "../litscan/routes";
import { feedbackRoutes } from "../feedback/routes";
import { adminRoutes } from "../admin/routes";
import { monitoringRoutes } from "../monitoring/routes";
import { meter, writeCacheRows } from "../cache";
import { apiSecurityHeaders, requestLog } from "../middleware";
import { rateLimit } from "../ratelimit";
import { remoteGate } from "../gate/api-gate";
import { installGates } from "../gate";
import { trendingRoutes } from "../trending/routes";
import { connectedAppsRoutes } from "../mcp/apps";
import type { Env } from "../platform/env";

/** The Worker's HTTP app: the middleware every request passes, and each feature's router mounted at its address. src/index.ts adds the routes of its own and serves it. */
export const app = new Hono<{ Bindings: Env; Variables: { requestId: string } }>();

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
app.use("/api/*", apiSecurityHeaders);
app.use("/api/*", rateLimit());

app.route("/api/v1/auth", authRoutes);
app.route("/api/v1/library", libraryRoutes);
app.route("/api/v1/account", accountRoutes);
app.route("/api/v1/references", referenceRoutes);
app.route("/api/v1/documents", documentRoutes);
app.route("/api/v1/idea", ideaRoutes);
app.route("/api/v1/chat", chatRoutes);
app.route("/api/v1/papers/oa", oaRoutes);
app.route("/api/v1/litscan", litscanRoutes);
app.route("/api/v1/feedback", feedbackRoutes);
app.route("/api/v1/admin", adminRoutes);
app.route("/api/v1/monitoring", monitoringRoutes);
// the Home page's Trending list: one public file, outside the search bucket of the rate limiter (src/trending/routes.ts)
app.route("/api/v1/home", trendingRoutes);
// the apps a person connected through the MCP server, and the button that disconnects one (Settings, Connected apps; 404 while the server is off)
app.route("/api/v1/connected-apps", connectedAppsRoutes);
