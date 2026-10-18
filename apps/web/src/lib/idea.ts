import type { IdeaPlan, IdeaSearchEvent, IdeaSearchRequest, IdeaSearchResult } from "@scholar/shared";
import { ApiError } from "./documents";
import { readSse } from "./sse";

const post = (body: unknown, signal?: AbortSignal): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin", signal });

async function fail(res: Response): Promise<never> {
  const j = (await res.json().catch(() => null)) as { type?: string; title?: string; detail?: string } | null;
  throw new ApiError(res.status, j?.type ?? "error", j?.title ?? `The service answered ${res.status}`, j?.detail);
}

/** The idea goes to the private model and is not stored; what comes back is the search plan to review. */
export async function planIdea(text: string, question: string, signal?: AbortSignal): Promise<IdeaPlan> {
  const res = await fetch("/api/v1/idea/plan", post({ text, question }, signal));
  if (!res.ok) await fail(res);
  return ((await res.json()) as { plan: IdeaPlan }).plan;
}

/** Runs the approved plan; `onEvent` receives the stages and the closest papers so far. Resolves with the final result. */
export async function searchIdea(req: IdeaSearchRequest, onEvent: (e: IdeaSearchEvent) => void, signal?: AbortSignal): Promise<IdeaSearchResult> {
  const res = await fetch("/api/v1/idea/search", post(req, signal));
  if (!res.ok) await fail(res);
  let result: IdeaSearchResult | null = null;
  let failure: ApiError | null = null;
  await readSse<IdeaSearchEvent>(
    res,
    (e) => {
      if (e.type === "done") result = e.result;
      else if (e.type === "error") failure = new ApiError(res.status, e.code, e.title, e.detail);
      onEvent(e);
    },
    signal,
  );
  if (failure) throw failure;
  if (!result) throw new TypeError("The search was cut off. Please try again.");
  return result;
}
