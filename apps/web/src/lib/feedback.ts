import type { FeedbackRequest } from "@scholar/shared";
import { ApiError } from "./documents";

/** Sends a "report a problem". Throws an ApiError with a message fit to show to the researcher. */
export async function sendReport(req: FeedbackRequest): Promise<void> {
  const res = await fetch("/api/v1/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req), credentials: "same-origin" });
  if (res.ok) return;
  const j = (await res.json().catch(() => null)) as { type?: string; title?: string; detail?: string } | null;
  throw new ApiError(res.status, j?.type ?? "error", j?.title ?? "The report could not be sent", j?.detail);
}
