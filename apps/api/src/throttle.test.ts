import { describe, expect, it } from "vitest";
import { reserveSlot } from "./throttle";

describe("reserveSlot", () => {
  it("serves an idle gate immediately", () => {
    expect(reserveSlot(10_000, 0, 5000, 1000)).toEqual({ waitMs: 0, nextFree: 11_000 });
  });

  it("spaces concurrent callers one interval apart", () => {
    let next = 0;
    const waits: number[] = [];
    for (let i = 0; i < 4; i++) {
      const s = reserveSlot(10_000, next, 5000, 1000)!;
      waits.push(s.waitMs);
      next = s.nextFree;
    }
    expect(waits).toEqual([0, 1000, 2000, 3000]);
  });

  it("refuses callers who would wait longer than the cap, without consuming a slot", () => {
    expect(reserveSlot(10_000, 16_000, 5000, 1000)).toBeNull();
    expect(reserveSlot(10_000, 15_000, 5000, 1000)).toEqual({ waitMs: 5000, nextFree: 16_000 });
  });

  it("recovers after a quiet period", () => {
    expect(reserveSlot(100_000, 11_000, 5000, 1000)).toEqual({ waitMs: 0, nextFree: 101_000 });
  });
});
