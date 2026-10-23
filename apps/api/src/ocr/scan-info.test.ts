import { describe, expect, it } from "vitest";
import { analyzeScan, scanLines, scanReferenceSection } from "@scholar/shared";

// Text in the shape the models give back for a page picture: paragraphs separated by a blank line.
const BODY = "We measured soil moisture at 38 sites and found that it rose between 2018 and 2019.\n\nThe discussion relates this to earlier surveys.";
const APA = [
  "References",
  "Adamson, H. D. & Regan, V. M. (1991). The acquisition of community speech norms by Asian immigrants learning English as a second language. Studies in Second Language Acquisition, 13: 1–22.",
  "Anderson, J. R. (1976). Language, Memory and Thought. Hillsdale, NJ: Lawrence Erlbaum.",
  "Baker, M. (2001). The Atoms of Language. New York: Basic Books.",
  "Bates, E. & MacWhinney, B. (1981). Second language acquisition from a functional perspective: pragmatic, semantic and perceptual strategies. In H. Winitz (ed.), Native Language and Foreign Language Acquisition (pp. 190–214). New York: New York Academy of Sciences.",
].join("\n\n");
const NUMBERED = ["References", "[1] A. Author, B. Writer. A study of things. Journal of Studies, 12(3):45-67, 2019.", "[2] C. Person. Another study of other things. Proceedings of the Conference, pages 1-9, 2020.", "[3] D. Someone and E. Else. A third study. Nature, 580:1-5, 2021.", "[4] F. Fourth. Fourth study of things. Science, 2022."].join("\n");

describe("scanLines", () => {
  it("makes a line of every line, keeps one blank line between paragraphs and none at the top of a page", () => {
    const lines = scanLines([{ page: 1, text: "\n\none\ntwo\n\n\n\nthree\n" }]);
    expect(lines.map((l) => l.text)).toEqual(["one", "two", "", "three", ""]);
    expect(lines.every((l) => l.page === 1)).toBe(true);
  });
  it("puts pages in order, whatever order they come in", () => {
    expect(scanLines([{ page: 3, text: "c" }, { page: 1, text: "a" }, { page: 2, text: "b" }]).map((l) => `${l.page}:${l.text}`)).toEqual(["1:a", "2:b", "3:c"]);
  });
  it("copes with nothing, with Windows line ends, and with runs of spaces", () => {
    expect(scanLines([])).toEqual([]);
    expect(scanLines([{ page: 1, text: "" }])).toEqual([]);
    expect(scanLines([{ page: 1, text: "a   b\r\nc" }]).map((l) => l.text)).toEqual(["a b", "c"]);
  });
});

describe("scanReferenceSection", () => {
  it("cuts a list whose references are separated by blank lines", () => {
    const s = scanReferenceSection([{ page: 1, text: BODY }, { page: 2, text: APA }]);
    expect(s).toMatchObject({ found: true, firstPage: 2, lastPage: 2, printedMax: 0 });
    expect(s.entries).toHaveLength(4);
    expect(s.entries[0]).toMatch(/^Adamson, H\. D\./);
    expect(s.entries[3]).toMatch(/Native Language and Foreign Language Acquisition \(pp\. 190–214\)/);
  });
  it("cuts a numbered list and reports the number it prints", () => {
    const s = scanReferenceSection([{ page: 4, text: NUMBERED }]);
    expect(s.printedMax).toBe(4);
    expect(s.entries).toHaveLength(4);
    expect(s.entries[1]).toBe("C. Person. Another study of other things. Proceedings of the Conference, pages 1-9, 2020.");
  });
  it("a reference that stops half way carries on at the top of the next page; one that is finished does not", () => {
    const half = scanLines([{ page: 5, text: "Adamson, H. D. & Regan, V. M. (1991). The acquisition of community speech norms by Asian immigrants learning English as a second" }, { page: 6, text: "language. Studies in Second Language Acquisition, 13: 1–22." }]);
    expect(half.map((l) => l.text)).toEqual(["Adamson, H. D. & Regan, V. M. (1991). The acquisition of community speech norms by Asian immigrants learning English as a second", "language. Studies in Second Language Acquisition, 13: 1–22."]);
    const done = scanLines([{ page: 5, text: "Anderson, J. R. (1976). Language, Memory and Thought. Hillsdale, NJ: Lawrence Erlbaum." }, { page: 6, text: "Baker, M. (2001). The Atoms of Language. New York: Basic Books." }]);
    expect(done.map((l) => l.text)).toEqual(["Anderson, J. R. (1976). Language, Memory and Thought. Hillsdale, NJ: Lawrence Erlbaum.", "", "Baker, M. (2001). The Atoms of Language. New York: Basic Books."]);
    const numbered = scanLines([{ page: 1, text: "[1] A. Author. Title. Journal 12, 2019" }, { page: 2, text: "[2] B. Writer. Title. Journal 13, 2020" }]);
    expect(numbered.map((l) => l.text)).toEqual(["[1] A. Author. Title. Journal 12, 2019", "", "[2] B. Writer. Title. Journal 13, 2020"]);
  });
  it("follows a list over two pages", () => {
    const s = scanReferenceSection([{ page: 5, text: APA.split("\n\n").slice(0, 3).join("\n\n") }, { page: 6, text: APA.split("\n\n").slice(3).join("\n\n") }]);
    expect(s).toMatchObject({ found: true, firstPage: 5, lastPage: 6 });
    expect(s.entries).toHaveLength(4);
  });
  it("finds nothing when there is no list", () => {
    expect(scanReferenceSection([{ page: 1, text: BODY }])).toEqual({ found: false, firstPage: 0, lastPage: 0, printedMax: 0, entries: [] });
    expect(scanReferenceSection([])).toMatchObject({ found: false });
  });
  it("stops at an appendix", () => {
    const s = scanReferenceSection([{ page: 7, text: APA + "\n\nAppendix A\n\nThe questionnaire had twelve items and was given in the first week." }]);
    expect(s.entries).toHaveLength(4);
  });
});

describe("analyzeScan", () => {
  it("finds the DOI printed on the first page and the references, and does not guess a title", () => {
    const info = analyzeScan([{ page: 1, text: "Journal of Studies 12 (2019) 45-67\nhttps://doi.org/10.1234/jos.2019.045\n\n" + BODY }, { page: 2, text: APA }], 2);
    expect(info.doi).toBe("10.1234/jos.2019.045");
    expect(info.title).toBeNull();
    expect(info.references).toHaveLength(4);
    expect(info.referencesSource).toBe("pdf");
    expect(info).toMatchObject({ pages: 2, outline: [], headings: [], metadata: null, arxiv: null });
  });
  it("says there are no references when there are none", () => {
    expect(analyzeScan([{ page: 1, text: BODY }], 5)).toMatchObject({ references: [], referencesSource: "none", doi: null, pages: 5 });
  });
  it("copes with no pages at all", () => {
    expect(analyzeScan([], 3)).toMatchObject({ references: [], referencesSource: "none", pages: 3 });
  });
});
