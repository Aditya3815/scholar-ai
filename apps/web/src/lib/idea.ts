import type { IdeaCompareEvent, IdeaCompareRequest, IdeaComparison, IdeaInsights, IdeaInsightsEvent, IdeaPaper, IdeaPlan, IdeaSearchEvent, IdeaSearchRequest, IdeaSearchResult } from "@scholar/shared";
import { api } from "./api/client";
import { postStream, streamResult } from "./api/stream";

/** Dataset and software deposits are not prior art the way a paper is: hidden by default and never sent to the comparison. */
export const isData = (p: IdeaPaper) => p.kind === "data";

/** The idea goes to the private model and is not stored; what comes back is the search plan to review. */
export async function planIdea(text: string, question: string, signal?: AbortSignal): Promise<IdeaPlan> {
  return (await api<{ plan: IdeaPlan }>("/api/v1/idea/plan", { method: "POST", json: { text, question }, signal })).plan;
}

/** Runs the approved plan; `onEvent` receives the stages and the closest papers so far. Resolves with the final result. */
export async function searchIdea(req: IdeaSearchRequest, onEvent: (e: IdeaSearchEvent) => void, signal?: AbortSignal): Promise<IdeaSearchResult> {
  const res = await postStream("/api/v1/idea/search", req, { signal });
  return streamResult<IdeaSearchEvent, IdeaSearchResult>(res, "done", (e) => (e as Extract<IdeaSearchEvent, { type: "done" }>).result, "The search was cut off. Please try again.", onEvent, signal);
}

/** Compares the closest papers with the idea (the private AI reads their abstracts). `onStage` reports progress; resolves with the checked comparison. */
export async function compareIdea(req: IdeaCompareRequest, onStage: (s: "reading" | "comparing" | "checking") => void, signal?: AbortSignal): Promise<IdeaComparison> {
  const res = await postStream("/api/v1/idea/compare", req, { signal });
  return streamResult<IdeaCompareEvent, IdeaComparison>(res, "done", (e) => (e as Extract<IdeaCompareEvent, { type: "done" }>).comparison, "The comparison was cut off. Please try again.", (e) => e.type === "stage" && onStage(e.stage), signal);
}

/** Reads the closest papers a second time for what is still open, what each reports, an answer and notes on feasibility. Resolves with the checked result. */
export async function insightsIdea(req: IdeaCompareRequest, onStage: (s: "reading" | "analysing" | "checking") => void, signal?: AbortSignal): Promise<IdeaInsights> {
  const res = await postStream("/api/v1/idea/insights", req, { signal });
  return streamResult<IdeaInsightsEvent, IdeaInsights>(res, "done", (e) => (e as Extract<IdeaInsightsEvent, { type: "done" }>).insights, "Reading the papers was cut off. Please try again.", (e) => e.type === "stage" && onStage(e.stage), signal);
}

/** "idea-check-smartphone-glaucoma-screening-2026-10-22.md": letters and digits only, so every system accepts it. */
export function reportFileName(title: string, now = new Date()): string {
  const slug = title.normalize("NFKD").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40).replace(/-+$/, "");
  return `idea-check-${slug ? `${slug}-` : ""}${now.toISOString().slice(0, 10)}.md`;
}

