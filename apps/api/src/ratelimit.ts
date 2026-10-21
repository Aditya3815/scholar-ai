import type { MiddlewareHandler } from "hono";

type Limiter = Pick<RateLimit, "limit">;
export type LimitEnv = { SEARCH_LIMITER?: Limiter; VERIFY_LIMITER?: Limiter; ASK_LIMITER?: Limiter; API_LIMITER?: Limiter };

/**
 * Per-IP request limits using Cloudflare's Rate Limiting binding. Search is the expensive route (it fans out to four
 * upstream APIs), so it has its own tighter bucket. The binding is optional: when it is missing (tests) or errors, requests
 * pass, because a limiter outage must not take the product down. Health checks are never limited.
 */
export function rateLimit(): MiddlewareHandler<{ Bindings: LimitEnv }> {
  return async (c, next) => {
    const path = c.req.path;
    if (path === "/api/v1/health") return next();
    const limiter = path.startsWith("/api/v1/search")
      ? c.env.SEARCH_LIMITER
      : path.startsWith("/api/v1/references")
        ? c.env.VERIFY_LIMITER
        : /^\/api\/v1\/documents\/[^/]+\/ask$/.test(path) || path === "/api/v1/idea/plan" || path === "/api/v1/idea/compare"
          ? c.env.ASK_LIMITER
          : path === "/api/v1/idea/search"
            ? c.env.SEARCH_LIMITER
            : c.env.API_LIMITER;
    if (limiter) {
      const ip = c.req.header("cf-connecting-ip") ?? "unknown";
      const ok = await limiter.limit({ key: ip }).then((r) => r.success, () => true);
      if (!ok) {
        c.header("Retry-After", "60");
        return c.json({ type: "rate_limited", title: "Too many requests", detail: "Please wait a minute and try again." }, 429);
      }
    }
    return next();
  };
}
