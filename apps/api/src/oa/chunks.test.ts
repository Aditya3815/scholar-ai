import { describe, expect, it } from "vitest";
import REAL from "./fixtures/PMC1182327.xml?raw";
import { chunksFromPages, chunksFromSections } from "./chunks";
import { parseJats } from "./jats";

const SENT = "The model was trained on twelve thousand fundus photographs and tested on a held-out set. ";

describe("chunksFromSections", () => {
  it("puts the abstract first, then each section, with the section's name on its passages", () => {
    const c = chunksFromSections([{ title: "Methods > Participants", text: SENT.repeat(3) }, { title: null, text: SENT.repeat(2) }], "A short abstract that is long enough to keep.");
    expect(c.map((x) => [x.page, x.section])).toEqual([[1, "Abstract"], [2, "Methods > Participants"], [3, null]]);
    expect(c.map((x) => x.idx)).toEqual([1000, 2000, 3000]);
  });
  it("gives a long section several passages that keep their order and their section", () => {
    const c = chunksFromSections([{ title: "Results", text: SENT.repeat(40) }], null);
    expect(c.length).toBeGreaterThan(2);
    expect(c.every((x) => x.page === 1 && x.section === "Results" && x.text.length <= 1300)).toBe(true);
    expect(c.map((x) => x.idx)).toEqual(c.map((_, i) => 1000 + i));
  });
  it("is empty for nothing, and drops a section with almost no text", () => {
    expect(chunksFromSections([], null)).toEqual([]);
    expect(chunksFromSections([{ title: "Tiny", text: "Hi." }], "")).toEqual([]);
  });
  it("makes a few dozen passages from a real article and every one is plain text with a unique idx", () => {
    const j = parseJats(REAL);
    const c = chunksFromSections(j.sections, j.abstract);
    expect(c.length).toBeGreaterThan(20);
    expect(c.length).toBeLessThan(80);
    expect(new Set(c.map((x) => x.idx)).size).toBe(c.length);
    expect(c[0]!.section).toBe("Abstract");
    expect(c.every((x) => x.text.length > 0 && !/<[a-z/][^>]*>/i.test(x.text))).toBe(true);
  });
});

describe("chunksFromPages", () => {
  it("chunks by page, with no section", () => {
    const c = chunksFromPages([{ page: 1, text: SENT.repeat(3) }, { page: 2, text: "" }, { page: 3, text: SENT.repeat(30) }]);
    expect(c.filter((x) => x.page === 2)).toEqual([]);
    expect(c.every((x) => x.section === null)).toBe(true);
    expect(c.filter((x) => x.page === 3).length).toBeGreaterThan(2);
    expect(c[0]!.idx).toBe(1000);
  });
});
