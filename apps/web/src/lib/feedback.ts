import { IDEMPOTENCY_HEADER, type FeedbackRequest } from "@scholar/shared";
import { ApiError, send } from "./api/client";
import { retry, type RetryPolicy } from "./api/retry";

/** A report whose connection was lost is sent once more after 900 ms, with the same key; a refusal is not. */
const REPORT_RETRY: RetryPolicy = { tries: 2, delayMs: () => 900, again: (e) => !(e instanceof ApiError) };

/**
 * Sends a "report a problem". Throws an ApiError with a message fit to show to the researcher. The report carries a random Idempotency-Key, sent again unchanged if the
 * connection is lost and the report is tried once more, so a reply that never arrived cannot file it twice.
 */
export async function sendReport(req: FeedbackRequest): Promise<void> {
  const key = crypto.randomUUID();
  await retry(REPORT_RETRY, () => send("/api/v1/feedback", { method: "POST", headers: { [IDEMPOTENCY_HEADER]: key }, json: req, fallback: "The report could not be sent" }));
}
