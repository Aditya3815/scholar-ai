import { describe, expect, it } from "vitest";
import { buildDocx, type Block } from "./docx";

describe("a page's paper in Word (paper-reader.md 25.12): a section for each page, its paper a picture behind the text in the section's header", () => {
  const p = (t: string): Block => ({ k: "p", runs: [{ t }] });
  const parts = buildDocx({
    title: "Notes",
    author: "Sodhsetu",
    created: new Date(0),
    blocks: [{ k: "section", paper: "paper-grid.png", alt: "Graph paper" }, { k: "title", runs: [{ t: "Notes" }] }, p("graph page"), { k: "section" }, p("plain page"), { k: "section", paper: "paper-ruled.png", alt: "Ruled paper" }, p("ruled page"), { k: "section", paper: "paper-grid.png", alt: "Graph paper" }, p("graph again")],
  });
  const xml = parts["word/document.xml"]!;
  const sects = [...xml.matchAll(/<w:sectPr>([\s\S]*?)<\/w:sectPr>/g)].map((m) => m[1]!);

  it("one section a page, each after the first starting on a new page, each naming its own header (plain paper an empty one)", () => {
    expect(sects).toHaveLength(4);
    expect(sects.map((s) => /r:id="(rIdH\d)"/.exec(s)?.[1])).toEqual(["rIdH1", "rIdH0", "rIdH2", "rIdH1"]);
    expect(sects.map((s) => s.includes('<w:type w:val="nextPage"/>'))).toEqual([false, true, true, true]);
    // the schema's order: headerReference, type, pgSz, pgMar
    expect([...sects[1]!.matchAll(/<w:(\w+)/g)].map((m) => m[1])).toEqual(["headerReference", "type", "pgSz", "pgMar"]);
    // a section ends with a line of 1 pt holding its properties, after its text; the last one's are the body's
    expect(xml.indexOf("graph page")).toBeLessThan(xml.indexOf("<w:sectPr>"));
    expect(xml).toMatch(/<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"\/><w:sectPr>/);
    expect(xml).toMatch(/graph again[\s\S]*<\/w:p><w:sectPr>[\s\S]*<\/w:sectPr><\/w:body>/);
  });

  it("a header for each paper (made once) and an empty one, each a part with its type and relationship", () => {
    expect(Object.keys(parts).filter((k) => /^word\/header\d\.xml$/.test(k)).sort()).toEqual(["word/header0.xml", "word/header1.xml", "word/header2.xml"]);
    expect(parts["word/header0.xml"]).not.toContain("<w:drawing>");
    expect(parts["word/_rels/header0.xml.rels"]).toBeUndefined();
    expect(parts["word/_rels/header1.xml.rels"]).toContain('Target="media/paper-grid.png"');
    expect(parts["word/_rels/header2.xml.rels"]).toContain('Target="media/paper-ruled.png"');
    for (const i of [0, 1, 2]) {
      expect(parts["[Content_Types].xml"]).toContain(`<Override PartName="/word/header${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`);
      expect(parts["word/_rels/document.xml.rels"]).toContain(`Id="rIdH${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header${i}.xml"`);
    }
  });

  it("the paper is the size of the page, at its top left, behind the text, without wrapping, in a header line of 1 pt (so it moves nothing)", () => {
    const h = parts["word/header1.xml"]!;
    const a = /<wp:anchor [^>]*>([\s\S]*?)<\/wp:anchor>/.exec(h)!;
    expect(a[0]).toMatch(/behindDoc="1"/);
    expect([...a[1]!.matchAll(/<wp:(\w+)/g)].map((m) => m[1])).toEqual(["simplePos", "positionH", "posOffset", "positionV", "posOffset", "extent", "effectExtent", "wrapNone", "docPr", "cNvGraphicFramePr"]);
    expect(a[0]).toContain('<wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset>');
    expect(a[0]).toContain('<wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset>');
    expect(a[0]).toContain(`<wp:extent cx="${Math.round(595.3 * 12700)}" cy="${Math.round(841.9 * 12700)}"/>`);
    expect(a[0]).toContain('descr="Graph paper"');
    expect(a[0]).toContain('r:embed="rIdP"');
    expect(h).toContain('<w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>');
  });

  it("without any paper: no header at all, and a file of one page has one section as before", () => {
    const plain = buildDocx({ title: "N", author: "S", created: new Date(0), blocks: [{ k: "section" }, p("a"), { k: "section" }, p("b")] });
    expect(Object.keys(plain).some((k) => k.includes("header"))).toBe(false);
    expect(plain["word/document.xml"]!.match(/<w:sectPr>/g)).toHaveLength(2);
    const one = buildDocx({ title: "N", author: "S", created: new Date(0), blocks: [p("a")] });
    expect(one["word/document.xml"]!.match(/<w:sectPr>/g)).toHaveLength(1);
    expect(one["word/document.xml"]).not.toContain("headerReference");
  });

  it("a paper's name that is not a picture's is ignored", () => {
    const bad = buildDocx({ title: "N", author: "S", created: new Date(0), blocks: [{ k: "section", paper: "../evil.xml" }, p("a")] });
    expect(Object.keys(bad).some((k) => k.includes("header"))).toBe(false);
  });
});
