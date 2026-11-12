import { describe, expect, it } from "vitest";
import { findAll, words } from "@scholar/shared";

const hay = words("The Transformer model uses attention. Attention is all you need; self-attention layers and attention heads.");

describe("findAll", () => {
  it("finds every occurrence of a word, whatever its case", () => {
    expect(findAll(words("attention"), hay)).toHaveLength(4);
  });
  it("finds a phrase only when its words are together and in order", () => {
    expect(findAll(words("attention is all"), hay)).toHaveLength(1);
    expect(findAll(words("all attention"), hay)).toHaveLength(0);
    expect(findAll(words("model uses"), hay)).toEqual([2]);
  });
  it("lets the last word be a beginning, so a search works while it is typed", () => {
    expect(findAll(words("transfor"), hay)).toEqual([1]);
    expect(findAll(words("model us"), hay)).toEqual([2]);
    expect(findAll(words("mod uses"), hay)).toEqual([]); // only the last word may be cut short
  });
  it("finds nothing for nothing, or for a word that is not there", () => {
    expect(findAll([], hay)).toEqual([]);
    expect(findAll(words("zebra"), hay)).toEqual([]);
    expect(findAll(words("attention"), [])).toEqual([]);
  });
});
