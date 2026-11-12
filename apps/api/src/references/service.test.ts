import { describe, expect, it } from "vitest";
import { readReference } from "./service";

/** The service layer (docs/design: "service layer"): what the web routes and the MCP tools both call. Behaviour of the routes themselves is held by their own tests and the goldens. */

describe("referenceService.read", () => {
  it("joins white space, refuses an empty or over-long reference", () => {
    expect(readReference("  A.  B.\n(2020) Title. ")).toEqual({ ok: true, text: "A. B. (2020) Title." });
    expect(readReference("   ")).toEqual({ ok: false, why: "empty" });
    expect(readReference(42)).toEqual({ ok: false, why: "empty" });
    expect(readReference("x".repeat(5000))).toEqual({ ok: false, why: "too_long" });
  });
});
