import { describe, expect, it } from "vitest";
import { MAX_TAG_CHARS, cleanTag, tagKey } from "@scholar/shared";
import { searchWords } from "./routes";

describe("cleanTag", () => {
  it("tidies spaces and control characters, cuts to length, and drops what is empty", () => {
    expect(cleanTag("  Methods   to\tread \n")).toBe("Methods to read");
    expect(cleanTag("a\u0000b\u007fc")).toBe("a b c");
    expect(cleanTag("x".repeat(80))).toBe("x".repeat(MAX_TAG_CHARS));
    expect(cleanTag("   ")).toBeNull();
    expect(cleanTag("\u0000\u0001")).toBeNull();
    expect(cleanTag(42)).toBeNull();
    expect(cleanTag(null)).toBeNull();
  });
  it("keeps Hindi and other scripts as they are", () => {
    expect(cleanTag("  शोध पद्धति ")).toBe("शोध पद्धति");
  });
  it("two spellings that differ only in case are one tag", () => {
    expect(tagKey("Thesis")).toBe(tagKey("thesis"));
    expect(tagKey("Thesis")).not.toBe(tagKey("theses"));
  });
});

describe("searchWords", () => {
  it("splits on anything that is not a letter or number, lower-cases, drops one-letter words and repeats", () => {
    expect(searchWords("Glaucoma, screening; a  smartphone-based AI AI")).toEqual(["glaucoma", "screening", "smartphone", "based", "ai"]);
  });
  it("is limited to six words", () => {
    expect(searchWords("one two three four five six seven eight")).toHaveLength(6);
  });
  it("works for Devanagari and for an empty search", () => {
    expect(searchWords("मोतियाबिंद परीक्षण")).toEqual(["मोतियाबिंद", "परीक्षण"]);
    expect(searchWords("  ? ! ")).toEqual([]);
    expect(searchWords("")).toEqual([]);
  });
});
