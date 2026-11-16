import { describe, expect, it } from "vitest";
import { devMode, devOptions, modelOverrides, standIns } from "./dev";

describe("development mode and the stand-ins (platform/dev.ts, untangle F7)", () => {
  it("is on only for ENABLE_DEV_ROUTES exactly \"1\", and the stand-ins only with QA_STUB exactly \"1\" too", () => {
    expect(devMode({})).toBe(false);
    expect(devMode({ ENABLE_DEV_ROUTES: "1" })).toBe(true);
    for (const v of ["0", "true", " 1", "1 ", "yes", ""]) expect(devMode({ ENABLE_DEV_ROUTES: v }), v).toBe(false);
    expect(standIns({ QA_STUB: "1" })).toBe(false);
    expect(standIns({ ENABLE_DEV_ROUTES: "1" })).toBe(false);
    expect(standIns({ ENABLE_DEV_ROUTES: "1", QA_STUB: "true" })).toBe(false);
    expect(standIns({ ENABLE_DEV_ROUTES: "1", QA_STUB: "1" })).toBe(true);
  });

  it("changes nothing in production, whatever the variables say", () => {
    const env = { QA_STUB: "1", QA_TOP_K: "3", SSE_KEEPALIVE_MS: "60", DEV_IDP_URL: "http://localhost:9911", LLM_QA_MODEL: "@cf/a/b", LLM_REASONING: "high" };
    expect(devOptions(env)).toEqual({ on: false, standIns: false, keepAliveMs: undefined, topK: undefined, scanPollsMs: undefined, readingPollMs: undefined, stepRetryDelay: undefined, idpUrl: undefined, models: {} });
  });

  it("in development mode takes the numbers within their bounds only", () => {
    const at = (v: Record<string, string>) => devOptions({ ENABLE_DEV_ROUTES: "1", ...v });
    expect(at({ QA_TOP_K: "12" }).topK).toBe(12);
    expect(at({ QA_TOP_K: "1" }).topK).toBe(1);
    for (const v of ["0", "13", "2.5", "x", ""]) expect(at({ QA_TOP_K: v }).topK, v).toBeUndefined();
    expect(at({ SSE_KEEPALIVE_MS: "50" }).keepAliveMs).toBe(50);
    expect(at({ SSE_KEEPALIVE_MS: "49" }).keepAliveMs).toBeUndefined();
    expect(at({}).scanPollsMs).toEqual([400]);
    expect(at({}).readingPollMs).toBe(150);
    expect(at({}).stepRetryDelay).toBeUndefined();
    expect(at({ QA_STUB: "1" }).stepRetryDelay).toBe("1 second");
    expect(at({ DEV_IDP_URL: "http://localhost:9911" }).idpUrl).toBe("http://localhost:9911");
  });

  it("keeps a development model choice only when it names a Workers AI model, and an effort only when it is one", () => {
    expect(modelOverrides({ ENABLE_DEV_ROUTES: "1", LLM_QA_MODEL: " @cf/x/y ", LLM_CLASSIFY_MODEL: "gpt-4", LLM_VERIFY_MODEL: "@cf/v", LLM_REASONING: "medium" })).toEqual({ qa: "@cf/x/y", verify: "@cf/v", reasoning: "medium" });
    expect(modelOverrides({ ENABLE_DEV_ROUTES: "1", LLM_REASONING: "max" })).toEqual({});
    expect(modelOverrides({ LLM_QA_MODEL: "@cf/x/y", LLM_REASONING: "high" })).toEqual({});
  });
});
