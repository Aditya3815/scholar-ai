import { describe, expect, it } from "vitest";
import { numberSentences, sentenceAt, splitSentences } from "@scholar/shared";

describe("splitSentences", () => {
  it("splits plain sentences", () => {
    expect(splitSentences("We built a tool. It works well. Does it scale? Yes!")).toEqual(["We built a tool.", "It works well.", "Does it scale?", "Yes!"]);
  });
  it("does not split inside numbers, decimals, versions or p-values", () => {
    expect(splitSentences("The AUC was 0.94 (p < 0.05) on 12.5 percent of cases. Version 2.1 followed.")).toEqual(["The AUC was 0.94 (p < 0.05) on 12.5 percent of cases.", "Version 2.1 followed."]);
  });
  it("does not split after an abbreviation, an initial or et al.", () => {
    expect(splitSentences("Smith et al. reported a gain, e.g. Fig. 2 shows it. J. R. Smith and A. Kumar agree. Dr. Rao disagrees.")).toEqual([
      "Smith et al. reported a gain, e.g. Fig. 2 shows it.",
      "J. R. Smith and A. Kumar agree.",
      "Dr. Rao disagrees.",
    ]);
  });
  it("does not split before a lower-case word", () => {
    expect(splitSentences("It cost 5 approx. and more. then stopped.")).toEqual(["It cost 5 approx. and more. then stopped."]);
  });
  it("keeps a closing quote or bracket with its sentence", () => {
    expect(splitSentences('He said "it works." Then we tested (twice). Next, results.')).toEqual(['He said "it works."', "Then we tested (twice).", "Next, results."]);
  });
  it("splits Hindi at the danda and English mixed into Hindi", () => {
    expect(splitSentences("यह अध्ययन छत्तीसगढ़ में किया गया। इसमें 38 स्थान थे। We used SPSS. The mean was 4.2.")).toEqual(["यह अध्ययन छत्तीसगढ़ में किया गया।", "इसमें 38 स्थान थे।", "We used SPSS.", "The mean was 4.2."]);
  });
  it("starts a sentence with a number or an opening bracket", () => {
    expect(splitSentences("It ended. 2019 was the year. (See below.) [1] says so.")).toEqual(["It ended.", "2019 was the year.", "(See below.)", "[1] says so."]);
  });
  it("collapses spaces and line breaks, and copes with nothing", () => {
    expect(splitSentences("One   sentence\n here.\n\nAnother one.")).toEqual(["One sentence here.", "Another one."]);
    expect(splitSentences("")).toEqual([]);
    expect(splitSentences("   ")).toEqual([]);
    expect(splitSentences(undefined as unknown as string)).toEqual([]);
  });
  it("a text without a full stop is one sentence", () => {
    expect(splitSentences("no punctuation at all")).toEqual(["no punctuation at all"]);
  });
  it("is deterministic and every sentence is part of the text, in order", () => {
    const abstract = "Background: glaucoma is common. We screened 300 eyes with a phone (Fig. 1). Sensitivity was 91.2%; specificity 88.0%. Limitations include one site, e.g. Pune. Future work will test other sites.";
    const a = splitSentences(abstract);
    expect(splitSentences(abstract)).toEqual(a);
    let from = 0;
    for (const s of a) {
      const at = abstract.indexOf(s, from);
      expect(at).toBeGreaterThanOrEqual(from);
      from = at + s.length;
    }
    expect(a.join(" ")).toBe(abstract);
  });
});

describe("numberSentences and sentenceAt", () => {
  const text = "First one. Second one here. Third.";
  it("numbers from 1", () => {
    expect(numberSentences(text)).toBe("(1) First one. (2) Second one here. (3) Third.");
  });
  it("finds a sentence by its number, and nothing for a number that is not one", () => {
    expect(sentenceAt(text, 2)).toBe("Second one here.");
    expect(sentenceAt(text, 1)).toBe("First one.");
    for (const bad of [0, 4, -1, 1.5, NaN, "2", null, undefined]) expect(sentenceAt(text, bad)).toBe("");
  });
});
