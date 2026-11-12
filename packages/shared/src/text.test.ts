import { describe, expect, it } from "vitest";
import { findRun, words } from "@scholar/shared";

describe("words", () => {
  it("lower-cases, folds accents and drops punctuation", () => {
    expect(words("Résumé: AUC of 0.94 (p < .05)!")).toEqual(["resume", "auc", "of", "0", "94", "p", "05"]);
  });
  it("keeps non-Latin scripts", () => {
    expect(words("ग्रामीण क्लीनिकों").length).toBeGreaterThan(0);
  });
});

describe("findRun", () => {
  const hay = words("We recruited 214 participants from three hospitals in Pune between 2019 and 2021");
  it("finds where the longest unbroken run starts", () => {
    expect(findRun(words("three hospitals in Pune"), hay)).toEqual({ len: 4, start: 5 });
  });
  it("returns only the unbroken part when words are missing in the middle", () => {
    const r = findRun(words("from three clinics in Pune"), hay);
    expect(r.len).toBe(2);
    expect(r.start).toBe(4);
  });
  it("returns zero when nothing matches", () => {
    expect(findRun(words("completely unrelated"), hay).len).toBe(0);
  });
});
