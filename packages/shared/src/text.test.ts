import { describe, expect, it } from "vitest";
import { cleanNoteText, findRun, words } from "@scholar/shared";

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

describe("cleanNoteText (a note keeps its line breaks)", () => {
  it("keeps line breaks, makes runs of spaces and tabs one space, and trims each line's end", () => {
    expect(cleanNoteText("First line   \nSecond\t\tline\n third  ", 2000)).toBe("First line\nSecond line\n third");
    expect(cleanNoteText("a\r\nb\rc", 2000)).toBe("a\nb\nc");
  });
  it("keeps at most two blank lines together, and none before or after", () => {
    expect(cleanNoteText("\n\n top\n\n\n\n\n\nbottom\n\n", 2000)).toBe(" top\n\n\nbottom");
    expect(cleanNoteText("one\n\ntwo", 2000)).toBe("one\n\ntwo");
  });
  it("takes out control characters, cuts to the limit, and is empty for what is not a string", () => {
    expect(cleanNoteText("a\u0000b\u0007c", 2000)).toBe("abc");
    expect(cleanNoteText("x".repeat(50) + "   ", 20)).toBe("x".repeat(20));
    expect(cleanNoteText(null, 10)).toBe("");
    expect(cleanNoteText(42, 10)).toBe("");
    expect(cleanNoteText("   \n  \n ", 10)).toBe("");
  });
});
