import { describe, expect, it } from "vitest";
import { normalisedQuery } from "./index";

describe("normalisedQuery (what a search is remembered by)", () => {
  it("the same words in any case or spacing are the same search", () => {
    const a = normalisedQuery("Deep  Learning\tfor   Glaucoma ");
    expect(a).toBe("deep learning for glaucoma");
    expect(normalisedQuery("deep learning for glaucoma")).toBe(a);
    expect(normalisedQuery("DEEP\nLEARNING for glaucoma")).toBe(a);
  });
  it("different words are different searches, and punctuation still counts", () => {
    expect(normalisedQuery("glaucoma screening")).not.toBe(normalisedQuery("glaucoma screen"));
    expect(normalisedQuery("c++ code")).not.toBe(normalisedQuery("c code"));
  });
  it("an empty or blank text stays empty", () => {
    expect(normalisedQuery("   ")).toBe("");
  });
});
