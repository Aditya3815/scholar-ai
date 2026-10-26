import type { FeedbackRequest } from "@scholar/shared";
import { ApiError } from "./documents";

/**
 * Sends a "report a problem". Throws an ApiError with a message fit to show to the researcher. The report carries a random Idempotency-Key, sent again unchanged if the
 * connection is lost and the report is tried once more, so a reply that never arrived cannot file it twice.
 */
export async function sendReport(req: FeedbackRequest): Promise<void> {
  const key = crypto.randomUUID();
  let res: Response | undefined;
  for (let attempt = 1; !res; attempt++) {
    try {
      res = await fetch("/api/v1/feedback", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(req), credentials: "same-origin" });
    } catch (e) {
      if (attempt >= 2) throw e;
      await new Promise((r) => setTimeout(r, 900));
    }
  }
  if (res.ok) return;
  const j = (await res.json().catch(() => null)) as { type?: string; title?: string; detail?: string } | null;
  throw new ApiError(res.status, j?.type ?? "error", j?.title ?? "The report could not be sent", j?.detail);
}
