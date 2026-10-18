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
  referenceEntries,
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
