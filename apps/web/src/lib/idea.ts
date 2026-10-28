import type { IdeaCompareEvent, IdeaCompareRequest, IdeaComparison, IdeaInsights, IdeaInsightsEvent, IdeaInsightsRequest, IdeaPaper, IdeaPlan, IdeaSearchEvent, IdeaSearchRequest, IdeaSearchResult } from "@scholar/shared";
import { ApiError } from "./documents";
import { readSse } from "./sse";

/** Dataset and software deposits are not prior art the way a paper is: hidden by default and never sent to the comparison. */
export const isData = (p: IdeaPaper) => p.kind === "data";

const post =(body: unknown, signal?: AbortSignal): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin", signal });

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

/** Compares the closest papers with the idea (the private AI reads their abstracts). `onStage` reports progress; resolves with the checked comparison. */
export async function compareIdea(req: IdeaCompareRequest, onStage: (s: "reading" | "comparing" | "checking") => void, signal?: AbortSignal): Promise<IdeaComparison> {
  const res = await fetch("/api/v1/idea/compare", post(req, signal));
  if (!res.ok) await fail(res);
  let result: IdeaComparison | null = null;
  let failure: ApiError | null = null;
  await readSse<IdeaCompareEvent>(
    res,
    (e) => {
      if (e.type === "stage") onStage(e.stage);
      else if (e.type === "done") result = e.comparison;
      else if (e.type === "error") failure = new ApiError(res.status, e.code, e.title, e.detail);
    },
    signal,
  );
  if (failure) throw failure;
  if (!result) throw new TypeError("The comparison was cut off. Please try again.");
  return result;
}

/** Reads the closest papers a second time for what is still open, what each reports, an answer and notes on feasibility. Resolves with the checked result. */
export async function insightsIdea(req: IdeaInsightsRequest, onStage: (s: "reading" | "analysing" | "checking") => void, signal?: AbortSignal): Promise<IdeaInsights> {
  const res = await fetch("/api/v1/idea/insights", post(req, signal));
  if (!res.ok) await fail(res);
  let result: IdeaInsights | null = null;
  let failure: ApiError | null = null;
  await readSse<IdeaInsightsEvent>(
    res,
    (e) => {
      if (e.type === "stage") onStage(e.stage);
      else if (e.type === "done") result = e.insights;
      else if (e.type === "error") failure = new ApiError(res.status, e.code, e.title, e.detail);
    },
    signal,
  );
  if (failure) throw failure;
  if (!result) throw new TypeError("Reading the papers was cut off. Please try again.");
  return result;
}

/** "idea-check-smartphone-glaucoma-screening-2026-10-22.md": letters and digits only, so every system accepts it. */
export function reportFileName(title: string, now = new Date()): string {
  const slug = title.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40).replace(/-+$/, "");
  return `idea-check-${slug ? `${slug}-` : ""}${now.toISOString().slice(0, 10)}.md`;
}

