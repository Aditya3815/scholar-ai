import { afterEach, describe, expect, it, vi } from "vitest";
import { testD1 } from "./test-d1";
import { readSearch } from "./search/service";
import { readReference } from "./references/service";
import { checkRetractions, isRetracted } from "./search/retraction-service";
import { findRetracted, findRetractionNotices } from "./search/retraction";
import { stubCrossrefFetch } from "./library/retraction-stub";

/** The service layer (docs/design: "service layer"): what the web routes and the MCP tools both call. Behaviour of the routes themselves is held by their own tests and the goldens. */

afterEach(() => vi.unstubAllGlobals());

const q = (o: Record<string, string>) => (k: string) => o[k];

describe("searchService.read", () => {
  it("reads a search as the route always did: trimmed, limit 1 to 40 (20 by default), scope all or india", () => {
    expect(readSearch(q({ q: "  crispr  " }))).toEqual({ ok: true, input: { q: "crispr", limit: 20, scope: "all" } });
    expect(readSearch(q({ q: "crispr", limit: "500" }))).toEqual({ ok: true, input: { q: "crispr", limit: 40, scope: "all" } });
    expect(readSearch(q({ q: "crispr", limit: "abc" }))).toEqual({ ok: true, input: { q: "crispr", limit: 20, scope: "all" } });
    expect(readSearch(q({ q: "crispr", limit: "-3", scope: "india" }))).toEqual({ ok: true, input: { q: "crispr", limit: 1, scope: "india" } });
  });
  it("refuses one letter, more than 300 characters, and an unknown scope", () => {
    expect(readSearch(q({ q: "a" })).ok).toBe(false);
    expect(readSearch(q({ q: "x".repeat(301) })).ok).toBe(false);
    expect(readSearch(q({ q: "crispr", scope: "mars" })).ok).toBe(false);
  });
});

describe("referenceService.read", () => {
  it("joins white space, refuses an empty or over-long reference", () => {
    expect(readReference("  A.  B.\n(2020) Title. ")).toEqual({ ok: true, text: "A. B. (2020) Title." });
    expect(readReference("   ")).toEqual({ ok: false, why: "empty" });
    expect(readReference(42)).toEqual({ ok: false, why: "empty" });
    expect(readReference("x".repeat(5000))).toEqual({ ok: false, why: "too_long" });
  });
});

describe("findRetracted keeps its answer while the notices are now kept too", () => {
  it("names the retracted DOIs and, separately, the notices that retracted them", async () => {
    const env = { CROSSREF_MAILTO: "t@example.org", fetch: stubCrossrefFetch };
    const signal = AbortSignal.timeout(2000);
    expect(await findRetracted(["10.1234/retracted-a", "10.1234/clear-b"], env, signal)).toEqual(["10.1234/retracted-a"]);
    const notices = await findRetractionNotices(["10.1234/retracted-a", "10.1234/clear-b"], env, signal);
    expect([...notices.entries()]).toEqual([["10.1234/retracted-a", ["10.1234/retracted-a-notice"]]]);
  });
});

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
