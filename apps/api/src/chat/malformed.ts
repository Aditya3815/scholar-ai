import { AllProvidersFailedError } from "../llm";

/**
 * The model now and then answers with something that is not JSON at all (a stray "[assistant]", a cut-off string). That is a malformed reply, not a wrong choice and not an
 * outage, and asking again is cheap and usually works. A timeout, a refusal or the allowance being used up is not this: those are not asked again.
 */
export function isMalformedReply(e: unknown): boolean {
  return e instanceof AllProvidersFailedError && e.attempts.length > 0 && e.attempts.every((a) => /JSON|Unexpected token|Unterminated|Unexpected end/i.test(a.error ?? ""));
}
