import { describe, expect, it } from "vitest";
import { dailyQuotaOf } from "./index";
import { DEFAULT_CONFIG } from "./config";

describe("dailyQuotaOf: the daily allowance, from LLM_DAILY_TOKEN_QUOTA or the default", () => {
  it("uses the default when unset", () => {
    expect(dailyQuotaOf()).toBe(DEFAULT_CONFIG.dailyTokenQuota);
    expect(dailyQuotaOf({})).toBe(DEFAULT_CONFIG.dailyTokenQuota);
  });
  it("uses a whole number above 0", () => {
    expect(dailyQuotaOf({ LLM_DAILY_TOKEN_QUOTA: "150000" })).toBe(150_000);
  });
  it("ignores anything else", () => {
    for (const v of ["", "0", "-5", "1.5", "abc", "NaN"]) expect(dailyQuotaOf({ LLM_DAILY_TOKEN_QUOTA: v })).toBe(DEFAULT_CONFIG.dailyTokenQuota);
  });
});
