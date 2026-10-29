import type { Context } from "hono";

/** The statuses the API answers with when it refuses or fails a request. */
export type ProblemStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 502 | 503;

/**
 * The API's error reply: `{ type, title }`, with a `detail` (what to do about it) and any `extra` fields when given. The browser reads `type` to decide what to say;
 * `title` and `detail` are for the person. One place, so every route answers a refusal in the same shape.
 */
export const deny = (c: Context, status: ProblemStatus, type: string, title: string, detail?: string, extra?: Record<string, unknown>) =>
  c.json({ type, title, ...(detail ? { detail } : {}), ...extra }, status);
