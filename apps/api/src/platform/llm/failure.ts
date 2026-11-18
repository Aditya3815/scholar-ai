import type { ProblemType } from "@scholar/shared";

/**
 * What a failed model call was, said once (docs/design/untangle.md, F8). Read from the error's NAME and its attempts, never by `instanceof`, so that this module imports nothing: understand/ may
 * reach it through port.ts (legal-match.test.ts, rule 3), and the gateway's errors (QuotaError, NoRouteError, AllProvidersFailedError with `attempts`) set their names.
 */

/** malformed: every model answered with something that is not JSON; timeout: the call ran out of time; quota: the day's allowance is used; no_route: no model may take this request; down: anything else. */
export type ModelFailure = "malformed" | "timeout" | "quota" | "no_route" | "down";

type Attempt = { provider?: unknown; model?: unknown; ok?: unknown; error?: unknown };

const nameOf = (e: unknown): string => (e instanceof Error ? e.name : "");
const attemptsOf = (e: unknown): Attempt[] | null => {
  const a = (e as { attempts?: unknown } | null)?.attempts;
  return Array.isArray(a) ? (a as Attempt[]) : null;
};
const JSON_FAILURE = /JSON|Unexpected token|Unterminated|Unexpected end/i;
const TIMEOUT = /timeout|timed out|abort/i;

/** Did every model of the chain answer with something that is not JSON at all? Asking again is cheap and usually works (a timeout, a refusal or a used allowance is not this). */
export function isMalformed(e: unknown): boolean {
  const attempts = attemptsOf(e);
  return nameOf(e) === "AllProvidersFailedError" && !!attempts && attempts.length > 0 && attempts.every((a) => JSON_FAILURE.test(String(a?.error ?? "")));
}

/** The kind of a model failure. */
export function classifyFailure(e: unknown): ModelFailure {
  const name = nameOf(e);
  if (name === "QuotaError") return "quota";
  if (isMalformed(e)) return "malformed";
  const message = e instanceof Error ? e.message : "";
  const errors = (attemptsOf(e) ?? []).map((a) => String(a?.error ?? ""));
  if (TIMEOUT.test(message) || errors.some((x) => TIMEOUT.test(x))) return "timeout";
  if (name === "NoRouteError") return "no_route";
  return "down";
}

/**
 * What kind of failure ONE provider reported, as one of five words, for a log line about a message that came with earlier turns: a provider's own error text can echo what it was sent (a rejected
 * prompt, a schema that did not fit), so nothing of it is logged for such a message, only this.
 */
export const errorKind = (message?: string): "timeout" | "malformed" | "quota" | "unavailable" | "error" =>
  !message ? "error" : /time(?:d)? ?out|abort/i.test(message) ? "timeout" : /json|unterminated|parse/i.test(message) ? "malformed" : /quota/i.test(message) ? "quota" : /unavailable|overload|rate|5\d\d/i.test(message) ? "unavailable" : "error";

/**
 * The attempts of a failed call for a log line, "provider:ok" or "provider:<what failed>", or null when the error carries none. `raw` keeps the provider's own error text (for a feature whose
 * prompt is not a person's earlier turns); without it the text is reduced to errorKind's word.
 */
export function attemptsForLog(e: unknown, o: { raw?: boolean } = {}): string[] | null {
  if (nameOf(e) !== "AllProvidersFailedError") return null;
  return (attemptsOf(e) ?? []).map((a) => `${String(a.provider)}:${a.ok ? "ok" : o.raw ? String(a.error) : errorKind(a.error as string | undefined)}`);
}

/** The words of one surface for each failure it tells a person about (each surface keeps its own: nothing a person reads changes). */
export type FailureWords<C extends ProblemType = ProblemType> = { status: 429 | 502 | 503; code: C; title: string; detail?: string | ((e: Error) => string) };

/**
 * The problem a surface answers a model failure with: the quota, no model and every-model-failed cases by the surface's own words, or null for an error that is not a model failure (the caller
 * throws it on). A failure every model reported is logged once, with the attempts, under the surface's `log` name.
 */
export function problemFor<C extends ProblemType>(
  e: unknown,
  words: { quota?: FailureWords<C>; noRoute?: FailureWords<C>; failed?: FailureWords<C>; log: string },
): { status: 429 | 502 | 503; code: C; title: string; detail?: string } | null {
  const name = nameOf(e);
  const pick = name === "QuotaError" ? words.quota : name === "NoRouteError" ? words.noRoute : name === "AllProvidersFailedError" ? words.failed : undefined;
  if (!pick) return null;
  if (name === "AllProvidersFailedError") console.error(JSON.stringify({ level: "error", msg: words.log, attempts: attemptsForLog(e, { raw: true }) }));
  const detail = typeof pick.detail === "function" ? pick.detail(e as Error) : pick.detail;
  return { status: pick.status, code: pick.code, title: pick.title, ...(detail === undefined ? {} : { detail }) };
}
