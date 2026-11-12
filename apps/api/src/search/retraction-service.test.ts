import { afterEach, describe, expect, it, vi } from "vitest";
import { testD1 } from "../test-d1";
import { checkRetractions, isRetracted } from "./retraction-service";

/** The service layer (docs/design: "service layer"): what the web routes and the MCP tools both call. Behaviour of the routes themselves is held by their own tests and the goldens. */

afterEach(() => vi.unstubAllGlobals());

describe("retractionService", () => {
  const env = () => ({ DB: testD1().db, CROSSREF_MAILTO: "t@example.org", ENABLE_DEV_ROUTES: "1", QA_STUB: "1" });

  it("answers each DOI once, in order, with the notice of a retracted one; what is not a DOI is listed apart", async () => {
    const r = await checkRetractions(env(), ["https://doi.org/10.1234/Retracted-A", "10.1234/clear-b", "10.1234/retracted-a", "not a doi"]);
    expect(r).toEqual({
      checked: [
        { doi: "10.1234/retracted-a", status: "retracted", notices: ["10.1234/retracted-a-notice"] },
        { doi: "10.1234/clear-b", status: "not_retracted", notices: [] },
      ],
      invalid: ["not a doi"],
    });
  });

  it("says unknown, never not retracted, when Crossref cannot be asked", async () => {
    const r = await checkRetractions(env(), ["10.1234/outage-x", "10.1234/clear-b"]);
    expect(r.checked.map((c) => c.status)).toEqual(["unknown", "unknown"]);
  });

  it("isRetracted is quiet (false) on a failure, as the page needs", async () => {
    expect(await isRetracted(env(), "10.1234/retracted-q")).toBe(true);
    expect(await isRetracted(env(), "10.1234/outage-q")).toBe(false);
  });
});
