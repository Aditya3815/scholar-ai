import { describe, expect, it } from "vitest";
import { editDistance, mendTypos, mendWord } from "./typo";

describe("editDistance", () => {
  it("counts insert, delete, replace and a swap of neighbours as one", () => {
    expect(editDistance("lerning", "learning", 2)).toBe(1);
    expect(editDistance("detction", "detection", 2)).toBe(1);
    expect(editDistance("teh", "the", 2)).toBe(1);
    expect(editDistance("abcdef", "uvwxyz", 2)).toBe(3);
  });
});

describe("mendTypos: the slips of a search, without a model", () => {
  it("mends the audit's example (AI-01)", () => {
    expect(mendTypos("machin lerning for crop disese detction")).toBe("machine learning for crop disease detection");
  });
  it("mends one slip in a sentence and keeps the rest", () => {
    expect(mendTypos("effect of exercize on diabetis")).toBe("effect of exercise on diabetes");
    expect(mendTypos("impact of pollutoin on children")).toBe("impact of pollution on children");
  });
  it("mends the typos of the chat tests' own messages", () => {
    expect(mendTypos("Can you search about convoluton nueral netwrk all papers")).toBe("Can you search about convolution neural network all papers");
    expect(mendTypos("CRISPR cas9 off targt efects")).toBe("CRISPR cas9 off target effects");
  });
  it("leaves rare words made of words, and real words that are not in the list, alone (pretraining, radiographs, convolutional)", () => {
    for (const t of ["self supervised pretraining speech recognition", "tuberculosis diagnosis using chest radiographs", "convolutional networks medical image segmentation"]) expect(mendTypos(t), t).toBeNull();
  });
  it("leaves words that are right, rare, named or short alone", () => {
    for (const t of ["effect of yoga on blood pressure", "transformers for retrieval augmented generation", "BERT for NLP", "CRISPR off-target effects", "crispr cas9 editing", "demonetisation in Uttar Pradesh", "tulsi ka asar", "asdkjhqwe zxcmnb plorf", "gnn for node classification", "COVID-19 vaccine"]) {
      expect(mendTypos(t), t).toBeNull();
    }
  });
  it("does not touch text with letters of another script", () => {
    expect(mendTypos("मधुमेह lerning")).toBeNull();
  });
  it("does not change a capitalised word (a name)", () => {
    expect(mendWord("Lerning")).toBeNull();
  });
});
