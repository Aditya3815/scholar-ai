import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDict, PDFDocument, PDFName } from "@cantoo/pdf-lib";
import { unzipSync, strFromU8 } from "fflate";
import type { NotebookBlock } from "@scholar/shared";
import { notesDocx, notesFileName, notesPdf } from "./notes-export";

const names = { yellow: "Key idea", green: "Method", blue: "Question", pink: "Result" } as const;
const text = (id: string, md: string): NotebookBlock => ({ id, kind: "text", md });
const quote: NotebookBlock = { id: "q", kind: "quote", noteId: "n1", page: 3, quote: "A network trained on 12,000 images", color: "yellow" };
const sketch: NotebookBlock = { id: "s", kind: "sketch", height: 200, strokes: [] };
const pages = [{ title: "Methods", blocks: [text("t", "# Head\nPatch embedding is **linear** and *fast*.\n\n- one\n- two\n\n1. first"), quote, sketch] }];
const args = (over: Partial<Parameters<typeof notesPdf>[0]> = {}) => ({ docTitle: "Glaucoma screening", pages, names, pdf: null, ...over });

afterEach(() => vi.unstubAllGlobals());

describe("the notes as a Word file (paper-reader.md 21.1, 4)", () => {
  it("the paper's title, each page as a heading, the text with its headings, marks and lists, a quote with its meaning and page", async () => {
    const blob = await notesDocx(args());
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const xml = strFromU8(files["word/document.xml"]!);
    expect(xml).toContain("Glaucoma screening");
    expect(xml).toMatch(/w:val="Heading1"[\s\S]*Methods/);
    expect(xml).toMatch(/w:val="Heading2"[\s\S]*Head/);
    expect(xml).toMatch(/<w:b\/><w:bCs\/><\/w:rPr><w:t xml:space="preserve">linear/);
    expect(xml).toContain("ListBullet");
    expect(xml).toContain("Key idea, p. 3");
    // no browser here, so the sketch is written as words; with one it is a picture (shots and the browser suite open the file)
    expect(xml).toContain("A sketch");
  });
});

describe("the notes as a PDF", () => {
  it("is a PDF with the paper's title, laid out on A4 pages that follow one another as the text grows", async () => {
    const one = await PDFDocument.load(await notesPdf(args()));
    expect(one.getPageCount()).toBe(1);
    expect(one.getTitle()).toBe("Glaucoma screening: notes");
    const long = [{ title: "Long", blocks: Array.from({ length: 12 }, (_, i) => text(`t${i}`, "A sentence that goes on for a while. ".repeat(30))) }];
    const many = await PDFDocument.load(await notesPdf(args({ pages: long })));
    expect(many.getPageCount()).toBeGreaterThan(2);
    expect(many.getPage(0).getSize().width).toBeCloseTo(595.28);
  });

  it("Devanagari is written in Noto Sans Devanagari, embedded as a subset with its text map (so the words can be copied out), only when there is Devanagari", async () => {
    const face = new Uint8Array(readFileSync(new URL("../../../../node_modules/@fontsource/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-400-normal.woff", import.meta.url)));
    const fetched = vi.fn(async (_url: string) => new Response(face));
    vi.stubGlobal("fetch", fetched);
    const latin = new TextDecoder("latin1").decode(await notesPdf(args()));
    expect(fetched).not.toHaveBeenCalled();
    expect(latin).not.toContain("NotoSansDevanagari");
    const hindi = [{ title: "नोट्स", blocks: [text("t", "यह मॉडल ग्लूकोमा पहचानता है, AUC 0.94.")] }];
    const bytes = await notesPdf(args({ pages: hindi }));
    expect(fetched).toHaveBeenCalledTimes(1);
    const back = await PDFDocument.load(bytes);
    expect(back.getPageCount()).toBe(1);
    // the fonts of the file, read back (pdf-lib packs them into compressed streams): the Devanagari face is there, with a map from its glyphs to the letters
    const fonts = back.context
      .enumerateIndirectObjects()
      .map(([, o]) => o)
      .filter((o): o is PDFDict => o instanceof PDFDict && o.get(PDFName.of("Type")) === PDFName.of("Font") && !!o.get(PDFName.of("BaseFont")));
    const deva = fonts.filter((f) => /^\/NotoSansDevanagari/.test(String(f.get(PDFName.of("BaseFont")))));
    expect(deva.length, fonts.map((f) => String(f.get(PDFName.of("BaseFont")))).join(", ")).toBeGreaterThan(0);
    expect(deva.some((f) => !!f.get(PDFName.of("ToUnicode")))).toBe(true);
    // a subset: the whole face is 68 KB as WOFF; what is embedded for one sentence is much smaller
    expect(bytes.length).toBeLessThan(60_000);
  });
});

it("the files are named as the Markdown is: notes-<paper>[-<page>]-<date>", () => {
  expect(notesFileName("Glaucoma screening: rural", null, "pdf")).toMatch(/^notes-Glaucoma-screening-rural-\d{4}-\d\d-\d\d\.pdf$/);
  expect(notesFileName("Glaucoma", "Methods & data", "docx")).toMatch(/^notes-Glaucoma-Methods-data-\d{4}-\d\d-\d\d\.docx$/);
});

describe("underline, in both exports (one syntax: ++words++, and the old <u> read too)", () => {
  const under = [{ title: "U", blocks: [text("u", "plain ++new underline++ and <u>old underline</u> end")] }];
  it("Word: a real underline on the underlined words, and no mark left in the text", async () => {
    const blob = await notesDocx(args({ pages: under }));
    const xml = strFromU8(unzipSync(new Uint8Array(await blob.arrayBuffer()))["word/document.xml"]!);
    expect(xml).toMatch(/<w:u w:val="single"\/><\/w:rPr><w:t xml:space="preserve">new underline/);
    expect(xml).toMatch(/<w:u w:val="single"\/><\/w:rPr><w:t xml:space="preserve">old underline/);
    expect(xml).not.toMatch(/\+\+|&lt;u&gt;/);
  });
  it("PDF: a line drawn under the underlined words, and none for plain text", async () => {
    const { PDFPage } = await import("@cantoo/pdf-lib");
    const spy = vi.spyOn(PDFPage.prototype, "drawLine");
    await notesPdf(args({ pages: [{ title: "P", blocks: [text("p", "plain words only")] }] }));
    expect(spy).not.toHaveBeenCalled();
    await notesPdf(args({ pages: under }));
    // one line per piece drawn: the words and the spaces between them
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(4);
    spy.mockRestore();
  });
});
