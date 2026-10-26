import { describe, expect, it } from "vitest";
import { SAMPLE_PAPER, makePdf } from "../../scripts/lib/make-pdf.mjs";
import { PdfReadError, dehyphenate, extractPdfPages } from "./pdf-text";

const fail = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as PdfReadError;
  }
  throw new Error("it did not fail");
};
const LONG = "The model was trained on twelve thousand fundus photographs and tested on a held-out set from three clinics, reaching an area under the curve of 0.94. ";

describe("extractPdfPages", () => {
  it("reads every page of a real PDF in order, with its text", async () => {
    const bytes = makePdf(SAMPLE_PAPER);
    const r = await extractPdfPages(bytes);
    expect(r.totalPages).toBe(SAMPLE_PAPER.length);
    expect(r.pages.map((p) => p.page)).toEqual(SAMPLE_PAPER.map((_, i) => i + 1));
    expect(r.pages.every((p) => p.text.length > 20)).toBe(true);
    expect(r.pages.map((p) => p.text).join(" ")).toMatch(/\S+/);
    expect(bytes.length).toBeGreaterThan(0); // the caller's bytes are still there (pdf.js takes over a buffer it is given; a copy is used)
  });

  it("keeps the words of a page, whatever the line breaks", async () => {
    const r = await extractPdfPages(makePdf([LONG.repeat(6), LONG.repeat(6)], { width: 60 }));
    const t = r.pages[0]!.text.replace(/\s+/g, " ");
    expect(t).toContain("area under the curve of 0.94");
    expect(t).toContain("three clinics");
  });

  it("refuses a paper with more pages than the cap, instead of reading the first part and answering as if it were the whole", async () => {
    const e = await fail(extractPdfPages(makePdf(Array.from({ length: 6 }, () => LONG.repeat(4))), 5));
    expect(e).toBeInstanceOf(PdfReadError);
    expect(e.reason).toBe("too_long");
    expect((await extractPdfPages(makePdf(Array.from({ length: 5 }, () => LONG.repeat(4))), 5)).totalPages).toBe(5);
  });

  it("says a scan is a scan: most pages have no text", async () => {
    expect((await fail(extractPdfPages(makePdf(["", "", "", ""])))).reason).toBe("scanned");
    expect((await fail(extractPdfPages(makePdf([LONG.repeat(5), "", "", ""])))).reason).toBe("scanned");
  });

  it("a paper with one empty page of four (a figure page) is still a paper", async () => {
    const r = await extractPdfPages(makePdf([LONG.repeat(5), "", LONG.repeat(5), LONG.repeat(5)]));
    expect(r.totalPages).toBe(4);
    expect(r.pages[1]!.text).toBe("");
  });

  it("says when there is almost no text at all", async () => {
    expect((await fail(extractPdfPages(makePdf(["A short note of about forty characters.", "Another short note of some forty characters."])))).reason).toBe("empty");
  });

  it("says a file that is not a PDF is not one, and does not throw anything else", async () => {
    for (const junk of [new TextEncoder().encode("<html>not a pdf</html>"), new Uint8Array(0), new TextEncoder().encode("%PDF-1.4\n garbage with no structure"), makePdf([LONG]).slice(0, 200)]) {
      const e = await fail(extractPdfPages(junk));
      expect(e).toBeInstanceOf(PdfReadError);
      expect(["not_a_pdf", "empty"]).toContain(e.reason);
    }
  });
});

describe("dehyphenate", () => {
  it("joins a word split at a line end, and leaves real hyphens", () => {
    expect(dehyphenate("a conv-\nolutional network")).toBe("a convolutional network");
    expect(dehyphenate("state-of-the-art")).toBe("state-of-the-art");
    expect(dehyphenate("COVID-\n19 and Self-\nSupervised")).toBe("COVID-\n19 and Self-\nSupervised");
    expect(dehyphenate("well -\nknown")).toBe("well -\nknown");
  });
});
