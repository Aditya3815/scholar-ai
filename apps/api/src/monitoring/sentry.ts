/**
 * A thin Sentry client: we build the event ourselves and post it to Sentry's envelope endpoint. No SDK, so we decide exactly what leaves:
 * an error's type, a shortened message, the stack frames (file, function, line) and where in the app it happened (a route pattern, never
 * a URL with ids or a query). No request body, headers, cookies, IP address, user id or e-mail is ever added, because those can hold a
 * researcher's idea, question or manuscript text. Without `SENTRY_DSN` every function here does nothing.
 */

export type SentryEnv = { SENTRY_DSN?: string; SENTRY_ENVIRONMENT?: string };

export type Dsn = { key: string; host: string; project: string; protocol: string };

/** `https://<public key>@<host>/<project id>`: null when it is not one. */
export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+|\/+$/g, "");
    if (!u.username || !/^\d+$/.test(project) || (u.protocol !== "https:" && u.protocol !== "http:")) return null;
    return { key: u.username, host: u.host, project, protocol: u.protocol.slice(0, -1) };
  } catch {
    return null;
  }
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const LINK = /\bhttps?:\/\/\S+/gi;
const LONG_ID = /\b[0-9a-f]{16,}\b/gi;

/** A message that is safe to send: no e-mail addresses, links or long ids, and short. */
export function scrubMessage(message: unknown, max = 300): string {
  const s = typeof message === "string" ? message : message instanceof Error ? message.message : String(message ?? "");
  return s.replace(EMAIL, "[email]").replace(LINK, "[link]").replace(LONG_ID, ":id").replace(/\s+/g, " ").trim().slice(0, max);
}

/** `/papers/3f9a...` becomes `/papers/:id`; the query and the fragment are dropped. */
export function routeOf(pathOrUrl: string): string {
  let path = pathOrUrl;
  try {
    path = new URL(pathOrUrl, "https://x.invalid").pathname;
  } catch {
    /* keep what we have */
  }
  return path.replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, "/:id").slice(0, 120);
}

export type Frame = { filename: string; function?: string; lineno?: number; colno?: number };

const FRAME_CHROME = /^\s*at (?:(.+?) \()?(.*?):(\d+):(\d+)\)?\s*$/;
const FRAME_FIREFOX = /^(.*?)@(.*?):(\d+):(\d+)\s*$/;

/** Stack text to Sentry frames (oldest call first, as Sentry wants), keeping file names but not any query string. */
export function parseStack(stack: unknown): Frame[] {
  if (typeof stack !== "string") return [];
  const frames: Frame[] = [];
  for (const line of stack.split("\n").slice(0, 60)) {
    const m = FRAME_CHROME.exec(line) ?? FRAME_FIREFOX.exec(line);
    if (!m) continue;
    const [, fn, file, l, c] = m;
    frames.push({ filename: (file ?? "").replace(/[?#].*$/, "").slice(0, 200), function: fn ? fn.slice(0, 100) : undefined, lineno: Number(l), colno: Number(c) });
  }
  return frames.reverse();
}

export type EventInput = {
  type: string;
  message: string;
  stack?: string;
  /** Where it happened: a route pattern such as `/api/v1/documents/:id/ask`, or a page path. */
  route: string;
  source: "worker" | "browser" | "cron" | "test";
  level?: "error" | "warning" | "info";
  release?: string;
  tags?: Record<string, string>;
};

const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

export function buildEvent(input: EventInput, env: SentryEnv) {
  return {
    event_id: hex(16),
    timestamp: Date.now() / 1000,
    platform: "javascript",
    level: input.level ?? "error",
    environment: env.SENTRY_ENVIRONMENT ?? "production",
    release: input.release,
    server_name: "scholar-ai",
    logger: input.source,
    exception: { values: [{ type: scrubMessage(input.type, 80) || "Error", value: scrubMessage(input.message), stacktrace: { frames: parseStack(input.stack) } }] },
    tags: { source: input.source, route: input.route, ...input.tags },
    // Group the same failure together whatever the message says.
    fingerprint: [input.source, input.route, scrubMessage(input.type, 80), scrubMessage(input.message, 80)],
  };
}

export function envelopeFor(event: ReturnType<typeof buildEvent>, dsn: Dsn): string {
  const header = { event_id: event.event_id, sent_at: new Date().toISOString(), dsn: `${dsn.protocol}://${dsn.key}@${dsn.host}/${dsn.project}` };
  return `${JSON.stringify(header)}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}`;
}

/** Sends one event. Resolves with the HTTP status, or null when monitoring is off or the request could not be made. Never throws. */
export async function sendEvent(env: SentryEnv, input: EventInput, send: typeof fetch = fetch): Promise<number | null> {
  const dsn = parseDsn(env.SENTRY_DSN);
  if (!dsn) return null;
  try {
    const res = await send(`${dsn.protocol}://${dsn.host}/api/${dsn.project}/envelope/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${dsn.key}, sentry_client=scholar-ai/1` },
      body: envelopeFor(buildEvent(input, env), dsn),
      signal: AbortSignal.timeout(4000),
    });
    await res.body?.cancel().catch(() => {});
    return res.status;
  } catch {
    return null;
  }
}

/* One isolate sends at most this many events a minute, so a failure loop cannot exhaust the free quota (5,000 a month) or the Worker's time. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
let windowStart = 0;
let sent = 0;
export function allowEvent(now = Date.now()): boolean {
  if (now - windowStart > WINDOW_MS) {
    windowStart = now;
    sent = 0;
  }
  return ++sent <= MAX_PER_WINDOW;
}
/** Tests only. */
export const resetEventLimit = () => {
  windowStart = 0;
  sent = 0;
};

/** The one call the Worker makes for a failure it did not expect. */
export function captureException(env: SentryEnv, err: unknown, ctx: { route: string; source?: EventInput["source"]; release?: string; waitUntil?: (p: Promise<unknown>) => void; tags?: Record<string, string> }): void {
  if (!parseDsn(env.SENTRY_DSN) || !allowEvent()) return;
  const e = err instanceof Error ? err : new Error(String(err));
  const p = sendEvent(env, { type: e.name, message: e.message, stack: e.stack, route: routeOf(ctx.route), source: ctx.source ?? "worker", release: ctx.release, tags: ctx.tags });
  ctx.waitUntil?.(p);
}
