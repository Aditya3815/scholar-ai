import type { MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";

/** The API only returns JSON/SSE, so nothing it sends should ever be rendered, framed or scripted. */
export const apiSecurityHeaders = secureHeaders({
  contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] },
  strictTransportSecurity: "max-age=63072000; includeSubDomains",
  referrerPolicy: "strict-origin-when-cross-origin",
  crossOriginOpenerPolicy: "same-origin",
  crossOriginResourcePolicy: "same-origin",
  xFrameOptions: "DENY",
  permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [] },
});

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

export type LogLine = {
  level: "info" | "warn" | "error";
  msg: "request";
  requestId: string;
  method: string;
  /** Path only. Query strings carry user search text and OAuth codes, so they are never logged. */
  path: string;
  status: number;
  ms: number;
  cfRay?: string;
};

/**
 * Gives every request an id (echoed in `X-Request-Id` so a user can quote it in a bug report), then writes one structured
 * JSON log line per request. Logs never include query strings, cookies, headers or bodies.
 */
export function requestLog(write: (line: LogLine) => void = (l) => console.log(JSON.stringify(l))): MiddlewareHandler {
  return async (c, next) => {
    const supplied = c.req.header("x-request-id");
    const requestId = supplied && REQUEST_ID.test(supplied) ? supplied : crypto.randomUUID();
    c.set("requestId", requestId);
    const started = Date.now();
    try {
      await next();
    } finally {
      const status = c.res.status;
      c.res.headers.set("X-Request-Id", requestId);
      write({
        level: status >= 500 ? "error" : status >= 400 ? "warn" : "info",
        msg: "request",
        requestId,
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status,
        ms: Date.now() - started,
        cfRay: c.req.header("cf-ray"),
      });
    }
  };
}
