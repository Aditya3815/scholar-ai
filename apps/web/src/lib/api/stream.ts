import { isAbort, send, streamError, type ApiError, type Req } from "./client";
import { readSse } from "./sse";

/**
 * The page's event streams (docs/design/untangle.md, F9): opening one, reading one that ends in a single result, applying events once per frame, and the endings of a stream that did not
 * finish. The reader itself is ./sse.ts (imported by the integration suites as it is).
 */
export { readSse };

/** POSTs `json` and resolves with the reply, whose body is the event stream; a refusal (a reply that is not ok) rejects with its ApiError, before any event. */
export const postStream = (path: string, json: unknown, req: Omit<Req, "json" | "body" | "method"> = {}): Promise<Response> => send(path, { ...req, method: "POST", json });

/**
 * Reads a stream that ends with one result event (`end`) or an error event, as Idea Check's and a paper's question do: every event goes to `onEvent`; resolves with `take` of the last
 * `end` event, rejects with the error event as an ApiError (after the stream ended), or with a TypeError saying `cutOff` when the stream closed with neither.
 */
export async function streamResult<E extends { type: string }, R>(
  res: Response,
  end: E["type"],
  take: (e: E) => R,
  cutOff: string,
  onEvent?: (e: E) => void,
  signal?: AbortSignal,
): Promise<R> {
  let result: R | null = null;
  let failure: ApiError | null = null;
  await readSse<E>(
    res,
    (e) => {
      if (e.type === end) result = take(e);
      else if (e.type === "error") failure = streamError(res.status, e as unknown as { code: string; title: string; detail?: string });
      onEvent?.(e);
    },
    signal,
  );
  if (failure) throw failure;
  if (!result) throw new TypeError(cutOff);
  return result;
}

/**
 * Events that arrive many times a second, applied together once per frame (the chat, Ask this paper): `push` queues one and asks for a frame; `flush` applies what is queued now and cancels
 * the frame asked for (at the end of the stream, or when it failed).
 */
export function perFrame<E>(apply: (batch: E[]) => void): { push: (e: E) => void; flush: () => void } {
  let queue: E[] = [];
  let raf = 0;
  const drain = () => {
    raf = 0;
    const batch = queue;
    queue = [];
    if (batch.length) apply(batch);
  };
  return {
    push(e) {
      queue.push(e);
      if (!raf) raf = requestAnimationFrame(drain);
    },
    flush() {
      if (raf) cancelAnimationFrame(raf);
      drain();
    },
  };
}

/**
 * How a stream that is still working ended, so each surface can say it in its own words: closed before its end event (cut_off), stopped by the person (an abort), the connection lost
 * (fetch's TypeError), or anything else (failed: a refusal, an error thrown while reading).
 */
export type Ending = "cut_off" | "stopped" | "connection_lost" | "failed";
export const endingOf = (e: unknown): Exclude<Ending, "cut_off"> => (isAbort(e) ? "stopped" : e instanceof TypeError ? "connection_lost" : "failed");
