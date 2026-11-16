import type { Answer, AskStreamEvent, Critique, Legend, NotesDraft } from "@scholar/shared";
import { ApiError, json, request } from "./docs-api";
import { readSse } from "./api/sse";

/**
 * The Paper Reader's agents (docs/design/paper-reader.md, 9.3 and 23), as the drawer asks them. Only the drawer's chunk imports this, so none of it is in the first load.
 *   Explain    POST /documents/:id/ask?stream=1 with mode "explain": a selection of the paper (and its page), or an idea, or both; the stream ends with a checked answer.
 *   Critique   the same route with mode "critique" and an optional focus; the stream ends with the checked points.
 *   Note-taker POST /documents/:id/ask-highlights with mode "notes": a draft page, kept by nobody until the reader adds it.
 */
export type AgentAsk = { mode: "explain"; selection: string; page: number | null; question: string } | { mode: "critique"; question: string };
export type AgentResult = { answer: Answer } | { critique: Critique };

export async function askAgentStream(id: string, ask: AgentAsk, onEvent: (e: AskStreamEvent) => void, signal?: AbortSignal): Promise<AgentResult> {
  const body = ask.mode === "explain" ? { mode: "explain", question: ask.question, ...(ask.selection ? { selection: ask.selection, ...(ask.page ? { page: ask.page } : {}) } : {}) } : { mode: "critique", question: ask.question };
  const res = await fetch(`/api/v1/documents/${id}/ask?stream=1`, { ...json("POST", body), credentials: "same-origin", signal });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { type?: string; title?: string; detail?: string } | null;
    throw new ApiError(res.status, j?.type ?? "error", j?.title ?? `The service answered ${res.status}`, j?.detail);
  }
  let result: AgentResult | null = null;
  let failure: ApiError | null = null;
  await readSse<AskStreamEvent>(
    res,
    (e) => {
      if (e.type === "answer") result = { answer: e.answer };
      else if (e.type === "critique") result = { critique: e.critique };
      else if (e.type === "error") failure = new ApiError(res.status, e.code, e.title, e.detail);
      onEvent(e);
    },
    signal,
  );
  if (failure) throw failure;
  if (!result) throw new TypeError("The answer was cut off. Please try again.");
  return result;
}

/** The Note-taker's draft page from the reader's highlights (`used` of `total` were read; `dropped` bullets named no highlight and were left out). */
export const draftNotes = (id: string, legend: Legend, signal?: AbortSignal) =>
  request<{ draft: NotesDraft; used: number; total: number; dropped: number }>(`/${id}/ask-highlights`, { ...json("POST", { mode: "notes", legend }), signal });
