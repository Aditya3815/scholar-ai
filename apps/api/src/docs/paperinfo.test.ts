import { describe, expect, it } from "vitest";
import {
  analyzePaper,
  bodySize,
  detectHeadings,
  detectIdentifiers,
  detectTitle,
  findArxiv,
  findDoi,
  groupLines,
  lookupDoi,
  compactLong,
  markerNumber,
  printedMax,
  referenceEntries,
  referenceSection,
  referenceLines,
  findReferenceStart,
  stripRunningHeads,
  type Line,
  type OutlineItem,
  type RawItem,
} from "@scholar/shared";
// @ts-expect-error plain .mjs test helper
import { makePdfLines } from "../../scripts/lib/make-pdf.mjs";

const L = (text: string, o: Partial<Line> = {}): Line => ({ text, size: 11, x: 56, y: 700, page: 1, ...o });
/** A column of lines going down the page. */
const column = (texts: string[], o: Partial<Line> = {}, x = 56): Line[] => texts.map((text, i) => L(text, { ...o, x, y: 700 - i * 14 }));

describe("groupLines", () => {
  const it_ = (str: string, x: number, y: number, w = str.length * 5, size = 11): RawItem => ({ str, x, y, w, size });
  it("joins items on the same baseline and separates different baselines", () => {
    const lines = groupLines([it_("Hello", 50, 700), it_("world", 82, 700), it_("Next line", 50, 686)], 3);
    expect(lines.map((l) => l.text)).toEqual(["Hello world", "Next line"]);
    expect(lines[0]).toMatchObject({ page: 3, x: 50, size: 11 });
  });
  it("adds a space only where there is a visible gap", () => {
    expect(groupLines([it_("Atten", 50, 700, 25), it_("tion", 75, 700, 20), it_("Is", 98, 700, 10)], 1)[0]!.text).toBe("Attention Is");
  });
  it("takes the largest size on the line", () => {
    expect(groupLines([it_("A", 50, 700, 6, 20), it_("rest", 58, 700, 20, 10)], 1)[0]!.size).toBe(20);
  });
  it("drops lines that are only whitespace", () => {
    expect(groupLines([it_("   ", 50, 700), it_("real", 50, 680)], 1).map((l) => l.text)).toEqual(["real"]);
  });
});

describe("stripRunningHeads", () => {
  it("removes page numbers and a header that repeats on many pages, keeps real content", () => {
    const lines: Line[] = [];
    const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"];
    for (let p = 1; p <= 10; p++) lines.push(L(`Journal of Examples 12(3), 2021 page ${p}`, { page: p }), L(String(p), { page: p, y: 20 }), L(`Unique ${words[p - 1]} content of this page`, { page: p }));
    const kept = stripRunningHeads(lines, 10).map((l) => l.text);
    expect(kept).toHaveLength(10);
    expect(kept.every((t) => t.startsWith("Unique"))).toBe(true);
  });
  it("is not fooled by short documents (a line on 2 of 3 pages stays)", () => {
    const lines = [L("Repeated", { page: 1 }), L("Repeated", { page: 2 }), L("Other", { page: 3 })];
    expect(stripRunningHeads(lines, 3)).toHaveLength(3);
  });
});

describe("title and identifiers", () => {
  const body = 11;
  it("takes the largest text on page 1, even over several lines", () => {
    const lines = [L("arXiv:1810.05823v1 [q-bio.PE] 13 Oct 2018", { size: 20 }), L("A cholera model with vaccination", { size: 18 }), L("and the biggest outbreak", { size: 18 }), L("A. Author, B. Writer", { size: 12 }), L("Abstract", { size: 11 })];
    expect(detectTitle(lines, body)).toBe("A cholera model with vaccination and the biggest outbreak");
  });
  it("falls back to a run of capital letters when the title is set at body size", () => {
    const lines = [L("WORKING PAPER SERIES", { size: 11 }), L("PREVENTION IS BETTER THAN CURE: EVIDENCE FROM", { size: 11 }), L("DAIRY ANIMALS OF HARYANA, INDIA", { size: 11 }), L("Abstract", { size: 11 })];
    expect(detectTitle(lines, body)).toMatch(/^WORKING PAPER SERIES PREVENTION IS BETTER/);
  });
  it("returns null when nothing stands out", () => {
    expect(detectTitle([L("some body text of the page", { size: 11 }), L("more body text of the page", { size: 11 })], body)).toBeNull();
  });
  it("finds a DOI without the punctuation around it", () => {
    expect(findDoi("see https://doi.org/10.1000/ABC.def-1)."))
      .toBe("10.1000/abc.def-1");
    expect(findDoi("no identifier here")).toBeNull();
  });
  it("finds arXiv ids, new and old style, and maps them to the DataCite DOI", () => {
    expect(findArxiv("arXiv:1706.03762v7 [cs.CL] 2 Aug 2023")).toBe("1706.03762");
    expect(findArxiv("arXiv:hep-th/9901001v2")).toBe("hep-th/9901001");
    expect(lookupDoi({ doi: null, arxiv: "1706.03762" })).toBe("10.48550/arxiv.1706.03762");
    expect(lookupDoi({ doi: "10.1/x", arxiv: "1706.03762" })).toBe("10.1/x");
  });
  it("reads identifiers from page 1, and from page 2 only when page 1 has none", () => {
    expect(detectIdentifiers([L("DOI: 10.1234/page.one", { page: 1 }), L("10.9999/other", { page: 2 })]).doi).toBe("10.1234/page.one");
    expect(detectIdentifiers([L("nothing", { page: 1 }), L("10.9999/second.page", { page: 2 })]).doi).toBe("10.9999/second.page");
  });
});

describe("detectHeadings", () => {
  it("finds numbered, known and capital-letter headings and ignores captions, authors and sentences", () => {
    const lines = [
      L("Abstract", { size: 11 }), L("We study a thing and report what we found in plain words.", { size: 11 }),
      L("1 Introduction", { size: 14 }), L("Body text goes here and keeps going for a while.", { size: 11 }),
      L("2.1 Method details", { size: 11 }), L("Figure 3: A caption that should be ignored", { size: 11 }),
      L("RESULTS AND DISCUSSION", { size: 11 }), L("This sentence ends with a period.", { size: 11 }),
    ];
    expect(detectHeadings(lines, 11, null).map((h) => h.title)).toEqual(["Abstract", "1 Introduction", "2.1 Method details", "RESULTS AND DISCUSSION"]);
  });
  it("gives numbered headings their depth", () => {
    const heads = detectHeadings([L("1 Intro", { size: 14 }), L("3.2.1 Deep one", { size: 12 })], 11, null);
    expect(heads.map((h) => h.level)).toEqual([1, 3]);
  });
  it("joins a heading that wraps onto a second line", () => {
    const lines = [L("THE GROUPS THAT WERE", { size: 11, y: 700 }), L("ADMINISTERED THE SURVEY", { size: 11, y: 688 }), L("Body text of the section starts right here.", { size: 11, y: 670 })];
    expect(detectHeadings(lines, 11, null).map((h) => h.title)).toEqual(["THE GROUPS THAT WERE ADMINISTERED THE SURVEY"]);
  });
  it("skips the title block above the abstract and anything after the reference heading", () => {
    const lines = [L("A Big Title", { size: 20 }), L("AUTHOR NAME", { size: 12 }), L("Abstract", { size: 11 }), L("Introduction", { size: 14 }), L("References", { size: 14 }), L("Appendix", { size: 14 })];
    expect(detectHeadings(lines, 11, "A Big Title", 5).map((h) => h.title)).toEqual(["Abstract", "Introduction", "References"]);
  });
});

describe("referenceEntries", () => {
  it("splits a numbered list and strips the numbers, joining wrapped lines", () => {
    const e = referenceEntries(column(["[1] Smith, J. (2020). A study of studies.", "Journal of Examples, 4(2), 1-10.", "[2] Jones, K. and Lee, M. (2019). Another long paper title.", "Proc. of Things, pp. 5-9.", "[3] Rao, P. (2018). Third paper about something else. Nature, 5."]));
    expect(e).toHaveLength(3);
    expect(e[0]).toBe("Smith, J. (2020). A study of studies. Journal of Examples, 4(2), 1-10.");
    expect(e[2]).toMatch(/^Rao, P\./);
  });

  it("splits a hanging-indent (APA) list by indentation, even when the text gives no clue", () => {
    const flush = (t: string, i: number) => L(t, { x: 56, y: 700 - i * 14 });
    const ind = (t: string, i: number) => L(t, { x: 70, y: 700 - i * 14 });
    const e = referenceEntries([
      flush("Barratt, A.S., Arnoult, M.H., and Stott, A.W. 2018. A framework for estimating", 0), ind("society's economic welfare following an animal disease. Prev Vet Med 15: 1-9.", 1),
      flush("Blanc, C.D., Van Der List, M., and Rossow, H.A. 2014. Blood calcium dynamics after", 2), ind("prophylactic treatment. J Dairy Sci 97: 2-8.", 3),
      flush("Cariappa, A.G.A., Mani, V., and Meena, B.S. 2021. Milk fever and income", 4), ind("effects in India. Agric Econ 52: 3-7.", 5),
    ]);
    expect(e).toHaveLength(3);
    expect(e[1]).toBe("Blanc, C.D., Van Der List, M., and Rossow, H.A. 2014. Blood calcium dynamics after prophylactic treatment. J Dairy Sci 97: 2-8.");
  });

  it("handles two columns: each column has its own left edge, and an entry may continue in the next column or page", () => {
    const left = [L("Aaa, A. 2001. First paper title that is long enough to wrap", { x: 56, y: 700 }), L("onto a second line. Journal A 1: 1-2.", { x: 66, y: 686 }), L("Bbb, B. 2002. Second paper title that also wraps around", { x: 56, y: 672 }), L("again. Journal B 2: 3-4.", { x: 66, y: 658 })];
    const right = [L("Ccc, C. 2003. Third paper title that wraps onto", { x: 310, y: 700 }), L("another line. Journal C 3: 5-6.", { x: 320, y: 686 }), L("Ddd, D. 2004. Fourth paper title, short. Journal D 4: 7-8.", { x: 310, y: 672 })];
    const e = referenceEntries([...left, ...right]);
    expect(e).toHaveLength(4);
    expect(e[2]).toMatch(/^Ccc, C\. 2003\..*Journal C 3: 5-6\.$/);
  });

  it("falls back to reading the text when there is no indentation and no numbers", () => {
    const e = referenceEntries(column(["Smith, J., & Doe, A. (2020). First paper about a thing. Journal One, 3, 1-5.", "Rao, P., & Iyer, S. (2019). Second paper about another thing. Journal Two, 8, 9-20.", "Kumar, V. (2018). Third paper on something else. Journal Three, 1, 1-2."]));
    expect(e).toHaveLength(3);
  });

  it("drops fragments that cannot be a reference", () => {
    expect(referenceEntries(column(["[1] x", "[2] 12", "[3] Smith, J. (2020). A real reference with enough text in it. Journal, 1."]))).toHaveLength(1);
  });
  it("returns nothing for an empty block", () => {
    expect(referenceEntries([])).toEqual([]);
  });
});

describe("markerNumber", () => {
  it("reads [12], (12), 12. and 12) at the start of a line", () => {
    expect(markerNumber("[12] Smith, J.")).toBe(12);
    expect(markerNumber("[ 7 ]Smith, J.")).toBe(7);
    expect(markerNumber("(3) Smith, J.")).toBe(3);
    expect(markerNumber("45. Smith, J.")).toBe(45);
    expect(markerNumber("9) Smith, J.")).toBe(9);
  });
  it("does not take a year, a decimal, a page count or a dash for a marker", () => {
    for (const t of ["2024 IEEE International Conference", "1.5 times faster", "19 pages.", "- 2024 IEEE", "(1953), 975-979.", "[cs.CV] https://arxiv.org/abs/1", "12", "Smith 12. later", "[1234] Too many digits"]) expect(markerNumber(t), t).toBeNull();
  });
});

describe("finding and ending the reference list", () => {
  it("starts after the last 'References' heading, in any of its usual spellings", () => {
    for (const h of ["References", "REFERENCES", "7 References", "VII. REFERENCES", "Bibliography", "Literature cited", "References and Notes", "Notes and references", "Works Cited", "List of references", "R EFERENCES", "7 R EFERENCES", "B IBLIOGRAPHY", "References:"]) {
      const lines = [L("Contents ... References", { y: 700 }), L(h, { y: 600 }), L("[1] Smith, J. (2020). A paper. Journal, 1.", { y: 580 })];
      expect(findReferenceStart(lines), h).toBe(1);
    }
  });
  it("without any heading, a numbered list that begins with [1] and runs on in order is found", () => {
    const lines = [L("Some body text of the conclusion paragraph."), L("[1] Smith, J. (2020). First paper. Journal, 1."), L("[2] Jones, K. (2019). Second paper. Journal, 2."), L("[3] Rao, P. (2018). Third paper. Journal, 3."), L("[4] Lee, M. (2017). Fourth paper. Journal, 4."), L("[5] Das, N. (2016). Fifth paper. Journal, 5.")];
    expect(findReferenceStart(lines)).toBe(0);
    expect(referenceEntries(referenceLines(lines))).toHaveLength(5);
  });
  it("a sentence that merely mentions references is not a heading", () => {
    for (const x of ["References are listed at the end of the paper", "see References", "Our references include many", "Reference"]) {
      const lines = [L(x), L("body text"), L("more body text")];
      expect(findReferenceStart(lines), x).toBe(x === "Reference" ? 0 : -1);
    }
  });
  it("a lone '[1]' in the text is not mistaken for a list", () => {
    expect(findReferenceStart([L("As shown in [1] Smith found it."), L("[1] this is only a mention"), L("and the text goes on")])).toBe(-1);
  });
  it("ends the list at a heading set larger than the text: an appendix needs no 'Appendix' label", () => {
    const lines = [
      L("References", { size: 14 }),
      L("[1] Smith, J. (2020). A paper. Journal, 1."), L("[2] Jones, K. (2019). Another paper. Journal, 2."), L("[3] Rao, P. (2018). A third paper. Journal, 3."),
      L("A Reporting privacy guarantees", { size: 14.3 }),
      L("This section clarifies the nuances of the reported guarantees following the guidelines."),
      L("1. DP setting. This a central guarantee where the service provider is trusted."),
      L("2. Instantiating the definition"),
    ];
    const block = referenceLines(lines, 10);
    expect(block).toHaveLength(3);
    expect(referenceEntries(block)).toHaveLength(3);
  });
  it("ends the list at 'Paper Checklist' and at a supplementary section", () => {
    for (const h of ["NeurIPS Paper Checklist", "Appendix A", "Supplementary material", "Checklist"]) {
      const lines = [L("References"), L("[1] A, B. (2020). T one. J."), L("[2] C, D. (2019). T two. J."), L("[3] E, F. (2018). T three. J."), L(h), L("1. Claims. Do the claims made in the abstract reflect the paper")];
      expect(referenceLines(lines, 10), h).toHaveLength(3);
    }
  });
  it("without a body size it still ends at the label, and a heading the size of the text does not end it", () => {
    const lines = [L("References"), L("[1] A, B. (2020). T one. J."), L("[2] C, D. (2019). T two. J."), L("[3] E, F. (2018). T three. J."), L("Appendix"), L("text")];
    expect(referenceLines(lines)).toHaveLength(3);
    const same = [L("References", { size: 14 }), L("[1] A, B. (2020). T one. J."), L("Journal of Things"), L("[2] C, D. (2019). T two. J."), L("[3] E, F. (2018). T three. J.")];
    expect(referenceLines(same, 14)).toHaveLength(4);
  });
});

describe("a numbered list is split by its numbers", () => {
  it("a line that starts with a year or a dash continues the entry (it is not a new one)", () => {
    const e = referenceEntries(column([
      "[1] Lu, W. 2024. Music Source Separation With Band-Split Rope Transformer. In ICASSP 2024", "- 2024 IEEE International Conference on Acoustics, Speech and Signal Processing", "(ICASSP). 481-485. doi:10.1109/ICASSP48485.2024.10446843",
      "[2] Rao, P. 2023. Another paper title that is long enough. In", "2023 IEEE International Conference on Acoustics, Speech and Signal Processing", "(ICASSP). 1-5. doi:10.1109/ICASSP49357.2023.10094573",
      "[3] Das, N. 2022. A third paper of enough length to count. Journal 3: 1-9. doi:10.1/x",
    ]));
    expect(e).toHaveLength(3);
    expect(e[0]).toContain("(ICASSP). 481-485");
    expect(e[1]).toContain("2023 IEEE International");
  });

  it("copes with a marker that was lost: the next number is accepted even though it skips one", () => {
    const e = referenceEntries(column(["[1] Smith, J. (2020). First paper title here. Journal, 1.", "Jones, K. (2019). Second paper whose number was lost. Journal, 2.", "[4] Rao, P. (2018). Fourth paper title here. Journal, 4.", "[5] Lee, M. (2017). Fifth paper title here. Journal, 5."]));
    expect(e).toHaveLength(3); // [1]+(lost [2]/[3] merged into it), [4], [5]
    expect(e.at(-1)).toMatch(/^Lee/);
  });

  it("a numbered list in an appendix that follows (restarting at 1) is not folded into the last reference", () => {
    const refs = Array.from({ length: 7 }, (_, i) => `[${i + 1}] Author${i}, A. (20${10 + i}). Paper number ${i} with a long enough title. Journal ${i}, 1-9.`);
    const e = referenceEntries(column([...refs, "1. DP setting. This a central guarantee where the service provider is trusted.", "2. Instantiating the definition of the guarantee"]));
    expect(e).toHaveLength(7);
    expect(e[6]).not.toContain("DP setting");
  });

  it("parenthesised numbers and '1.' style lists work the same way", () => {
    expect(referenceEntries(column(["(1) Smith, J. (2020). First paper title here. Journal, 1.", "(2) Jones, K. (2019). Second paper title here. Journal, 2.", "(3) Rao, P. (2018). Third paper title here. Journal, 3."]))).toHaveLength(3);
    expect(referenceEntries(column(["1. Smith, J. (2020). First paper title here. Journal, 1.", "2. Jones, K. (2019). Second paper title here. Journal, 2.", "3. Rao, P. (2018). Third paper title here. Journal, 3."]))).toHaveLength(3);
  });

  it("up to 600 references are kept", () => {
    const many = Array.from({ length: 450 }, (_, i) => `[${i + 1}] Author, A. (2020). A paper number ${i} with a long enough title. Journal, 1-9.`);
    expect(referenceEntries(column(many.slice(0, 120)))).toHaveLength(120);
    expect(referenceEntries(many.map((t, i) => L(t, { y: 700 - (i % 50) * 14, page: 1 + Math.floor(i / 50) }))).length).toBe(450);
  });
});

describe("the reference section as a whole", () => {
  const refs = Array.from({ length: 6 }, (_, i) => `[${i + 1}] Author${i}, A. (20${10 + i}). Paper number ${i} with a long enough title. Journal ${i}, 1-9.`);
  const doc = [L("Body of the paper with some text on the first page.", { page: 1, size: 11 }), L("References", { page: 2, size: 14 }), ...refs.map((r, i) => L(r, { page: 2 + Math.floor(i / 3), y: 700 - (i % 3) * 14 }))];

  it("printedMax is the highest number the list prints, and 0 for a list with no numbers", () => {
    expect(printedMax(column(refs))).toBe(6);
    expect(printedMax(column(["Smith, J. (2020). A paper. Journal, 1.", "Jones, K. (2019). Another. Journal, 2."]))).toBe(0);
    expect(printedMax([])).toBe(0);
    expect(printedMax(column(["[999] odd", "[3] Smith, J. (2020). A paper. Journal, 1."]))).toBe(3);
  });

  it("gives the pages the section is on, its entries, and how many the list says there are", () => {
    const s = referenceSection(doc, 3);
    expect(s).toMatchObject({ found: true, firstPage: 2, lastPage: 3, printedMax: 6 });
    expect(s.entries).toHaveLength(6);
  });

  it("says plainly when there is no reference section", () => {
    expect(referenceSection([L("Just a page of text without any list at the end."), L("More text")], 1)).toEqual({ found: false, firstPage: 0, lastPage: 0, printedMax: 0, entries: [] });
    expect(referenceSection([], 0).found).toBe(false);
  });

  it("agrees with analyzePaper on what the entries are (the panel and the checked list are the same thing)", () => {
    expect(referenceSection(doc, 3).entries).toEqual(analyzePaper({ lines: doc, pages: 3 }).references);
  });
});

describe("an entry with a very long author list", () => {
  const authors = Array.from({ length: 160 }, (_, i) => `Person${i} Surname${i}`).join(", ");
  const entry = `${authors}. Advances and open problems in federated learning. Foundations and Trends in Machine Learning, 14(1-2):1-210, 2021.`;
  it("keeps the first authors and, above all, the title, venue and year", () => {
    const out = compactLong(entry);
    expect(out.length).toBeLessThanOrEqual(920);
    expect(out).toContain("Advances and open problems in federated learning");
    expect(out).toContain("2021");
    expect(out.startsWith("Person0 Surname0")).toBe(true);
  });
  it("leaves a normal entry alone", () => {
    expect(compactLong("Smith, J. (2020). A paper. Journal, 1.")).toBe("Smith, J. (2020). A paper. Journal, 1.");
  });
  it("is applied to every entry of a list", () => {
    const e = referenceEntries(column([`[1] ${entry}`, "[2] Jones, K. (2019). Second paper title here. Journal, 2.", "[3] Rao, P. (2018). Third paper title here. Journal, 3."]));
    expect(e[0]!.length).toBeLessThanOrEqual(920);
    expect(e[0]).toContain("federated learning");
  });
});

describe("what follows the last reference is not a reference", () => {
  it("a closing paragraph with no year, link or identifier is dropped from the end", () => {
    const e = referenceEntries(column(["[1] Smith, J. (2020). First paper title here. Journal, 1.", "[2] Jones, K. (2019). Second paper title here. Journal, 2.", "[3] Rao, P. (2018). Third paper title here. Journal, 3.", "[4] The authors would like to thank the anonymous reviewers for their helpful comments on the manuscript."]));
    expect(e).toHaveLength(3);
  });
  it("but a reference that has none of those, in the middle, is kept", () => {
    const e = referenceEntries(column(["[1] Smith, J. (2020). First paper title here. Journal, 1.", "[2] Anonymous. Technical report with neither year nor link, but a perfectly real entry.", "[3] Rao, P. (2018). Third paper title here. Journal, 3."]));
    expect(e).toHaveLength(3);
  });
});

describe("analyzePaper on a real PDF read by pdf.js", () => {
  it("finds title, DOI, headings and a hanging-indent reference list in a generated paper", async () => {
    const refs = ["Aaa, A., and Bbb, B. 2001. A first reference with a reasonably long title that wraps", "Ccc, C. 2002. A second reference whose title also needs to wrap around the line", "Ddd, D., Eee, E. 2003. A third and final reference of this small test bibliography"];
    const pdf = makePdfLines([
      [
        { text: "Glaucoma Screening in Rural Clinics", size: 20 }, { text: "A. Author and B. Writer", size: 12, gap: 6 },
        { text: "DOI: 10.1234/glaucoma.2021.5", size: 9, gap: 4 },
        { text: "Abstract", size: 14, gap: 14 }, { text: "We study glaucoma screening on low-cost devices and report what we found.", gap: 2 },
        { text: "1 Introduction", size: 14, gap: 16 }, { text: "Glaucoma is a leading cause of blindness, and screening is hard to scale.", gap: 2 },
        { text: "2 Methods", size: 14, gap: 16 }, { text: "Participants were recruited from three hospitals.", gap: 2 },
      ],
      [
        { text: "3 Results", size: 14 }, { text: "The model reached an AUC of 0.94 on the held-out images.", gap: 2 },
        { text: "References", size: 14, gap: 20 },
        ...refs.flatMap((r, i) => [{ text: r, gap: 6 }, { text: `Journal ${i + 1}, ${i + 3}(2), 1-${i + 9}.`, x: 70 }]),
      ],
    ]);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
    const lines: Line[] = [];
    const { rawItems } = await import("@scholar/shared");
    for (let p = 1; p <= doc.numPages; p++) lines.push(...groupLines(rawItems((await (await doc.getPage(p)).getTextContent()).items as never), p));
    const outline: OutlineItem[] = [];
    const info = analyzePaper({ lines, outline, pages: doc.numPages });

    expect(info.title).toBe("Glaucoma Screening in Rural Clinics");
    expect(info.doi).toBe("10.1234/glaucoma.2021.5");
    expect(info.headings.map((h) => h.title)).toEqual(["Abstract", "1 Introduction", "2 Methods", "3 Results", "References"]);
    expect(info.headings.find((h) => h.title === "3 Results")!.page).toBe(2);
    expect(info.references).toHaveLength(3);
    expect(info.references[1]).toBe("Ccc, C. 2002. A second reference whose title also needs to wrap around the line Journal 2, 4(2), 1-10.");
    expect(info.pages).toBe(2);
  }, 30_000);

  it("copes with a paper that has no references and no outline", async () => {
    const pdf = makePdfLines([[{ text: "A Short Note", size: 18 }, { text: "Just a paragraph of text with nothing else in the whole document.", gap: 8 }]]);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const doc = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: true }).promise;
    const { rawItems } = await import("@scholar/shared");
    const lines = groupLines(rawItems((await (await doc.getPage(1)).getTextContent()).items as never), 1);
    const info = analyzePaper({ lines, pages: 1 });
    expect(info).toMatchObject({ title: "A Short Note", doi: null, references: [], outline: [] });
    expect(bodySize(lines)).toBeGreaterThan(0);
  }, 30_000);
});
