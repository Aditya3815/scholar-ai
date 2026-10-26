import type { Context } from "hono";
import { streamSSE } from "hono/streaming";

/**
 * One way to open an event stream, for every endpoint that has one (chat, Idea Check, paper Q&A, and the open-access ingest to come).
 *
 * - **A terminal event, always.** Every stream ends with exactly one event of `terminal` (done, answer or error, whichever that endpoint uses). If the work finishes or
 *   throws without sending one, `fallback` is sent; a second terminal event is dropped. The browser therefore never has to guess whether a silent end was a success.
 * - **A keep-alive line** (a comment, `: keep-alive`, ignored by the browser's reader) every 15 seconds while the stream is open, so a proxy or a mobile network that cuts
 *   an idle connection (the standard's own warning) does not cut an answer the model is still thinking about (the first word of an answer takes 9 to 12 s).
 * - **Leaving stops the work**: when the reader goes away `gone` turns true, nothing more is written and `abort` (if given) is aborted, which cancels the model call.
 */
export const KEEP_ALIVE_MS = 15_000;

export type SseSession<E extends { type: string }> = {
  /** Writes one event. Does nothing once the reader has gone, or after the terminal event. */
  send(e: E): Promise<void>;
  /** True once the reader has left. */
  readonly gone: boolean;
};

type Options<E extends { type: string }> = {
  /** The event types that end the stream. */
  terminal: readonly E["type"][];
  /** Sent if the work ended without a terminal event. Its type must be one of `terminal`. */
  fallback: E;
  /** Aborted when the reader leaves. */
  abort?: AbortController;
};

/** In development and tests the interval can be shortened with the variable SSE_KEEPALIVE_MS (never below 50 ms, and only with the dev switch); otherwise it is fixed. */
function keepAliveMs(c: Context): number {
  const env = (c.env ?? {}) as { ENABLE_DEV_ROUTES?: string; SSE_KEEPALIVE_MS?: string };
  const n = Number(env.SSE_KEEPALIVE_MS);
  return env.ENABLE_DEV_ROUTES === "1" && Number.isFinite(n) && n >= 50 ? n : KEEP_ALIVE_MS;
}

export function sseStream<E extends { type: string }>(c: Context, opts: Options<E>, run: (session: SseSession<E>) => Promise<void>): Response {
  return streamSSE(c, async (sse) => {
    let gone = false;
    let ended = false;
    sse.onAbort(() => {
      gone = true;
      opts.abort?.abort();
    });
    const send = async (e: E) => {
      if (gone) return;
      if (opts.terminal.includes(e.type)) {
        if (ended) return;
        ended = true;
      }
      await sse.writeSSE({ event: e.type, data: JSON.stringify(e) }).catch(() => (gone = true));
    };
    const timer = setInterval(() => {
      if (!gone) void sse.write(": keep-alive\n\n").catch(() => (gone = true));
    }, keepAliveMs(c));
    try {
      await run({ send, get gone() { return gone; } });
    } catch (e) {
      // the endpoints catch their own errors and say what went wrong; this is for the one that did not
      console.error(JSON.stringify({ level: "error", msg: "sse_unhandled", error: e instanceof Error ? e.name : "unknown" }));
    } finally {
      clearInterval(timer);
    }
    if (!ended) await send(opts.fallback);
  });
}
