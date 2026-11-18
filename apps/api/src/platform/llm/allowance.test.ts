import { describe, expect, it } from "vitest";
import { allowanceOf } from "./index";
import { DEFAULT_CONFIG } from "./config";

const db = (t: number) => ({ prepare: () => ({ bind: () => ({ first: async () => ({ t }) }) }) }) as unknown as D1Database;

describe("the day's allowance, asked of the gateway (untangle F8: the literature scan and the chat's follow-ups no longer compute it themselves)", () => {
  it("is the gateway's quota and its ledger's count, and what is left (below 0 after a call that went over)", async () => {
    expect(await allowanceOf(db(0), "u")).toEqual({ limit: DEFAULT_CONFIG.dailyTokenQuota, used: 0, left: DEFAULT_CONFIG.dailyTokenQuota });
    expect(await allowanceOf(db(59_000), "u")).toEqual({ limit: 60_000, used: 59_000, left: 1_000 });
    expect((await allowanceOf(db(61_000), "u")).left).toBe(-1_000);
  });
});
