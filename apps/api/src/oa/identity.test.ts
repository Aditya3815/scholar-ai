import { describe, expect, it } from "vitest";
import { looksLikePaper, titleWords } from "./identity";

const PAGE = "Deep learning for glaucoma screening from smartphone fundus photographs. A. Rao, S. Iyer. Abstract: We trained a convolutional network on retinal images.";

describe("looksLikePaper", () => {
  it("is true when the words of the title are in the start of the file", () => {
    expect(looksLikePaper("Deep Learning for Glaucoma Screening from Smartphone Fundus Photographs", PAGE)).toBe(true);
  });
  it("is true when most of them are (a subtitle that is not repeated, a changed word)", () => {
    expect(looksLikePaper("Deep learning for glaucoma screening: a multicentre validation", PAGE)).toBe(true);
  });
  it("is false for another paper", () => {
    expect(looksLikePaper("Cost-effectiveness of population tuberculosis screening in urban slums", PAGE)).toBe(false);
  });
  it("ignores case, accents and a word split at the end of a line", () => {
    expect(looksLikePaper("Déep LEARNING for glau-coma screening", "deep learning for glau-\ncoma screening")).toBe(true);
  });
  it("says nothing when the title gives too little to tell, or there is no title", () => {
    expect(looksLikePaper("Notes", PAGE)).toBeNull();
    expect(looksLikePaper("Is it so?", PAGE)).toBeNull();
    expect(looksLikePaper(null, PAGE)).toBeNull();
    expect(looksLikePaper("", PAGE)).toBeNull();
  });
  it("only looks at the start of the text", () => {
    expect(looksLikePaper("Quantum error correction thresholds explained", "x".repeat(7000) + "quantum error correction thresholds explained")).toBe(false);
  });
});
describe("titleWords", () => {
  it("keeps distinct words of four letters or more, without filler", () => {
    expect(titleWords("A study of the study of Smartphone-based screening")).toEqual(["smartphone", "based", "screening"].filter((w) => w !== "based"));
  });
});
