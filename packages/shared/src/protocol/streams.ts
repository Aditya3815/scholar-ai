/**
 * What every event stream of the API shares (docs/design/untangle.md, F9): the one error event that ends a stream that failed, and the one the server sends when a stream's work ended
 * without its end event (apps/api/src/sse.ts). Which events end each stream is the table of stream-shape.ts (the events of kind "end"). Imports nothing.
 */

/** A stream's error event: the last event of a stream that failed. `code` says what went wrong (not always a ProblemType); `title` and `detail` are for the person. */
export type StreamError = { type: "error"; code: string; title: string; detail?: string };

/** Sent when a stream's work ended, or threw, without sending its end event: the browser never has to guess whether a silent end was a success. */
export const STREAM_FALLBACK: StreamError = { type: "error", code: "internal_error", title: "Something went wrong" };
