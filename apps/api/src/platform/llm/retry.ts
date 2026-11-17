import { isMalformed } from "./failure";

/**
 * The one "ask the model once more" (docs/design/untangle.md, F8). A reply that is not JSON at all (a stray "[assistant]", a cut-off string) is a malformed reply, not a wrong choice and not an
 * outage, and asking again is cheap and usually works; a timeout, a refusal or a used allowance is not asked again. `call` is told which attempt it is (1 or 2).
 *   - `shown`: true once any word of the reply reached the screen; then a failure is not asked again (a second try would repeat the words).
 *   - `retryIf`: what else is worth a second try (the Understand step's reading that does not pass its checks); a malformed reply always is.
 *   - `onFailure`: hears every failed attempt (a log line), before it is retried or thrown.
 * The second failure is thrown as it is.
 */
export async function withMalformedRetry<T>(
  call: (attempt: 1 | 2) => Promise<T>,
  o: { shown?: () => boolean; retryIf?: (e: unknown) => boolean; onFailure?: (e: unknown, attempt: 1 | 2) => void } = {},
): Promise<T> {
  try {
    return await call(1);
  } catch (e) {
    o.onFailure?.(e, 1);
    if (o.shown?.() || !(isMalformed(e) || o.retryIf?.(e))) throw e;
  }
  try {
    return await call(2);
  } catch (e) {
    o.onFailure?.(e, 2);
    throw e;
  }
}
