import type { ProblemType } from "@scholar/shared";

/**
 * The one way the page asks the API (docs/design/untangle.md, F9). `api<T>()` sends a request with the person's cookies (and a JSON body as JSON) and resolves with the JSON reply; a reply
 * that is not ok becomes an `ApiError`, which carries the problem the server sent (packages/shared protocol/problem.ts): its status, `type`, `title`, `detail`, any other fields (`extra`, such
 * as the running scan's `id`) and Retry-After. A surface decides what to say from the status and the type, in its own words: nothing here chooses words except the fallback title a call
 * gives for a reply that carried no problem.
 */

/**
 * What went wrong: the problem's type (the Worker answers only with a ProblemType: deny() takes nothing else), or "error" when the reply carried no problem, or for a stream's error event
 * (whose code is in `extra.code`: a stream's codes are not all problem types).
 */
export type ApiErrorType = ProblemType | "error";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly type: ApiErrorType,
    readonly title: string,
    readonly detail?: string,
    /** The problem's other fields (e.g. `id` of a scan that is already running; `code` of a stream's error event). */
    readonly extra: Readonly<Record<string, unknown>> = {},
    /** The reply's Retry-After header, as sent. */
    readonly retryAfter: string | null = null,
  ) {
    super(detail ? `${title}. ${detail}` : title);
  }
}

/**
 * The ApiError of a reply that is not ok, from its parsed body (null when it was not JSON). `fallback` is the title when the body has none: by default "The service answered <status>".
 */
export function problemError(status: number, body: unknown, fallback?: string | ((status: number) => string), retryAfter: string | null = null): ApiError {
  const j = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const { type, title, detail, ...extra } = j ?? {};
  const fall = typeof fallback === "function" ? fallback(status) : (fallback ?? `The service answered ${status}`);
  return new ApiError(status, typeof type === "string" ? (type as ProblemType) : "error", typeof title === "string" ? title : fall, typeof detail === "string" ? detail : undefined, extra, retryAfter);
}

/** A stream's error event (`{ type: "error", code, title, detail? }`) as an ApiError, with the status of the reply that carried it (200: the stream had begun); its code is in `extra.code`. */
export const streamError = (status: number, e: { code: string; title: string; detail?: string }): ApiError => new ApiError(status, "error", e.title, e.detail, { code: e.code });

export type Req = Omit<RequestInit, "body"> & {
  /** Sent as JSON, with Content-Type application/json. */
  json?: unknown;
  /** Sent as it is (a picture, a PDF). */
  body?: BodyInit | null;
  /** The title of the error when the reply carries no problem. */
  fallback?: string | ((status: number) => string);
};

/** Sends the request (cookies of this site unless `credentials` says otherwise) and resolves with the reply when it is ok; otherwise rejects with its ApiError. A lost connection rejects with fetch's TypeError. */
export async function send(path: string, req: Req = {}): Promise<Response> {
  const { json, fallback, ...init } = req;
  const res = await fetch(path, {
    credentials: "same-origin",
    ...init,
    ...(json === undefined ? {} : { headers: { "Content-Type": "application/json", ...init.headers }, body: JSON.stringify(json) }),
  });
  if (!res.ok) throw problemError(res.status, await res.json().catch(() => null), fallback, res.headers.get("Retry-After"));
  return res;
}

/** `send`, then the reply's JSON. */
export const api = async <T>(path: string, req?: Req): Promise<T> => (await (await send(path, req)).json()) as T;

/** True for the error fetch and the stream reader reject with when the request was stopped. */
export const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === "AbortError";
