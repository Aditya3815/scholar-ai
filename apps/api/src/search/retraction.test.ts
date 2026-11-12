import { afterEach, describe, expect, it, vi } from "vitest";
import { findRetractionNotices } from "./retraction";
import { stubCrossrefFetch } from "../library/retraction-stub";

afterEach(() => vi.unstubAllGlobals());

describe("findRetractionNotices", () => {
  it("names the retracted DOIs (its keys) and the notices that retracted them", async () => {
    const env = { CROSSREF_MAILTO: "t@example.org", fetch: stubCrossrefFetch };
    const signal = AbortSignal.timeout(2000);
    expect([...(await findRetractionNotices(["10.1234/retracted-a", "10.1234/clear-b"], env, signal)).keys()]).toEqual(["10.1234/retracted-a"]);
    const notices = await findRetractionNotices(["10.1234/retracted-a", "10.1234/clear-b"], env, signal);
    expect([...notices.entries()]).toEqual([["10.1234/retracted-a", ["10.1234/retracted-a-notice"]]]);
  });
});
