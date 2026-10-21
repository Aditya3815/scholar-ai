import { Hono } from "hono";
import { sameOrigin } from "../auth/http";
import { allowEvent, parseDsn, routeOf, scrubMessage, sendEvent, type SentryEnv } from "./sentry";

type Env = { Bindings: SentryEnv & { CF_VERSION_METADATA?: WorkerVersionMetadata } };
export const monitoringRoutes = new Hono<Env>();

const MAX_BODY = 12_000;

/**
 * The browser reports its own errors here, not to Sentry directly: the Sentry key stays on the server, the page's Content-Security-Policy
 * stays strict, and what is forwarded is chosen here (a short message, the stack, a route pattern), never the page's content.
 * Always answers 204, so the page never learns whether monitoring is on and a reporting problem can never break it.
 */
monitoringRoutes.post("/", async (c) => {
  if (!sameOrigin(c)) return c.body(null, 403);
  if (!parseDsn(c.env.SENTRY_DSN)) return c.body(null, 204);
  if (Number(c.req.header("content-length") ?? 0) > MAX_BODY) return c.body(null, 413);

  const text = await c.req.text().catch(() => "");
  if (text.length > MAX_BODY) return c.body(null, 413);
  let b: Record<string, unknown> = {};
  try {
    b = (JSON.parse(text) ?? {}) as Record<string, unknown>;
  } catch {
    return c.body(null, 400);
  }
  if (!allowEvent()) return c.body(null, 204);

  const str = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");
  c.executionCtx.waitUntil(
    sendEvent(c.env, {
      type: scrubMessage(str(b.type, 80)) || "Error",
      message: str(b.message, 400),
      stack: str(b.stack, 6000),
      route: routeOf(str(b.path, 200) || "/"),
      source: "browser",
      release: c.env.CF_VERSION_METADATA?.id,
    }),
  );
  return c.body(null, 204);
});
