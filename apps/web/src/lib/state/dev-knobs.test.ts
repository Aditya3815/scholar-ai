import { afterEach, describe, expect, it, vi } from "vitest";
import { storage } from "../../test/fake-storage";
import { QUIET_MS, QUIET_MS_KEY, quietMs } from "./dev-knobs";

afterEach(() => vi.unstubAllGlobals());

describe("the page's test knobs (untangle F7)", () => {
  it("is the production wait unless a test set a usable shorter one", () => {
    expect(quietMs()).toBe(QUIET_MS); // no storage at all (node)
    const s = storage();
    vi.stubGlobal("sessionStorage", s);
    expect(quietMs()).toBe(15_000);
    s.setItem(QUIET_MS_KEY, "1500");
    expect(quietMs()).toBe(1500);
    for (const v of ["499", "x", "", "-1"]) {
      s.setItem(QUIET_MS_KEY, v);
      expect(quietMs(), v).toBe(15_000);
    }
  });
});
