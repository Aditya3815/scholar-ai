import { afterEach, describe, expect, it, vi } from "vitest";
import { AllProvidersFailedError, NoRouteError, QuotaError } from "./index";
import { attemptsForLog, classifyFailure, isMalformed, problemFor } from "./failure";
import { withMalformedRetry } from "./retry";

const failed = (...errors: string[]) => new AllProvidersFailedError(errors.map((error) => ({ provider: "workersai", model: "m", ok: false, ms: 1, error })));

afterEach(() => vi.restoreAllMocks());

describe("what a failed model call was (untangle F8: one classifier for the chat, the Understand step and every surface)", () => {
  it("says malformed, timeout, quota, no_route or down, by the error's name and attempts", () => {
    expect(classifyFailure(new QuotaError("daily AI quota reached"))).toBe("quota");
    expect(classifyFailure(failed("no JSON in output", "Unterminated string in JSON"))).toBe("malformed");
    expect(classifyFailure(failed("timed out"))).toBe("timeout");
    expect(classifyFailure(failed("no JSON in output", "timed out"))).toBe("timeout");
    expect(classifyFailure(new Error("understand timeout"))).toBe("timeout");
    expect(classifyFailure(new NoRouteError("no private-safe provider available for this task"))).toBe("no_route");
    expect(classifyFailure(failed("HTTP 500"))).toBe("down");
    expect(classifyFailure(new Error("x"))).toBe("down");
    expect(classifyFailure(null)).toBe("down");
    expect(isMalformed(new AllProvidersFailedError([]))).toBe(false);
  });

  it("logs the attempts as one word each, or with the provider's text where the surface keeps it", () => {
    const e = new AllProvidersFailedError([{ provider: "workersai", model: "m", ok: false, ms: 1, error: "bad request, input was: CANARY" }, { provider: "gemini", model: "g", ok: true, ms: 1 }]);
    expect(attemptsForLog(e)).toEqual(["workersai:error", "gemini:ok"]);
    expect(attemptsForLog(e, { raw: true })).toEqual(["workersai:bad request, input was: CANARY", "gemini:ok"]);
    expect(attemptsForLog(new QuotaError("q"))).toBeNull();
  });

  it("turns a model failure into the surface's own words, logs every-model-failed once, and leaves any other error to the caller", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const words = {
      quota: { status: 429 as const, code: "quota" as const, title: "Used up", detail: (e: Error) => e.message },
      noRoute: { status: 503 as const, code: "ai_unavailable" as const, title: "Unavailable" },
      failed: { status: 502 as const, code: "ai_failed" as const, title: "Failed", detail: "Try again." },
      log: "x_failed",
    };
    expect(problemFor(new QuotaError("daily AI quota reached (1/2 tokens)"), words)).toEqual({ status: 429, code: "quota" as const, title: "Used up", detail: "daily AI quota reached (1/2 tokens)" });
    expect(problemFor(new NoRouteError("none"), words)).toEqual({ status: 503, code: "ai_unavailable" as const, title: "Unavailable" });
    expect(log).not.toHaveBeenCalled();
    expect(problemFor(failed("HTTP 500"), words)).toEqual({ status: 502, code: "ai_failed" as const, title: "Failed", detail: "Try again." });
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toEqual({ level: "error", msg: "x_failed", attempts: ["workersai:HTTP 500"] });
    expect(problemFor(new Error("boom"), words)).toBeNull();
  });
});

describe("withMalformedRetry (the one 'ask once more')", () => {
  it("asks again once for a malformed reply, and not for anything else", async () => {
    let n = 0;
    await expect(withMalformedRetry(async () => (++n === 1 ? Promise.reject(failed("no JSON in output")) : "ok"))).resolves.toBe("ok");
    expect(n).toBe(2);
    n = 0;
    await expect(withMalformedRetry(async () => (n++, Promise.reject(failed("timed out"))))).rejects.toThrow();
    expect(n).toBe(1);
  });

  it("not when words were shown, at most twice, and tells every failure with its attempt", async () => {
    let n = 0;
    await expect(withMalformedRetry(async () => (n++, Promise.reject(failed("no JSON in output"))), { shown: () => true })).rejects.toThrow();
    expect(n).toBe(1);
    const seen: number[] = [];
    n = 0;
    await expect(withMalformedRetry(async (attempt) => (n++, Promise.reject(failed(`no JSON in output ${attempt}`))), { onFailure: (_e, a) => seen.push(a) })).rejects.toThrow(/2/);
    expect([n, seen]).toEqual([2, [1, 2]]);
    n = 0;
    await expect(withMalformedRetry(async (a) => (a === 1 ? Promise.reject(new Error("not usable")) : "second"), { retryIf: (e) => e instanceof Error && e.message === "not usable" })).resolves.toBe("second");
  });
});
