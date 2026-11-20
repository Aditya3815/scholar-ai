import { describe, expect, it } from "vitest";
import { buildDocx } from "./docx";

describe("ink on the pages in Word (paper-reader.md 25.8)", () => {
  const f = { media: "ink1.png", x: 120.5, y: -4, w: 60, h: 20, alt: "A drawing on the text: 1 stroke" };
  const parts = buildDocx({ title: "Notes", author: "Sodhsetu", created: new Date(0), ink: true, blocks: [{ k: "p", runs: [{ t: "The baseline was strong" }], floats: [f] }, { k: "space", h: 120, floats: [{ ...f, media: "ink2.png", y: 10 }] }] });
  const xml = parts["word/document.xml"]!;

  it("a paragraph's ink is a picture anchored to it, in front of the text, with no wrapping, its children in the schema's order", () => {
    const a = /<wp:anchor [^>]*>([\s\S]*?)<\/wp:anchor>/.exec(xml)!;
    expect(a[0]).toMatch(/behindDoc="0"/);
    expect(a[0]).toMatch(/allowOverlap="1"/);
    expect([...a[1]!.matchAll(/<wp:(\w+)/g)].map((m) => m[1])).toEqual(["simplePos", "positionH", "posOffset", "positionV", "posOffset", "extent", "effectExtent", "wrapNone", "docPr", "cNvGraphicFramePr"]);
    expect(a[0]).toContain('<wp:positionH relativeFrom="column"><wp:posOffset>1530350</wp:posOffset>');
    expect(a[0]).toContain('<wp:positionV relativeFrom="paragraph"><wp:posOffset>-50800</wp:posOffset>');
    // the picture comes before the paragraph's text, inside the paragraph
    expect(xml.indexOf("<wp:anchor")).toBeLessThan(xml.indexOf("The baseline"));
    expect(parts["word/_rels/document.xml.rels"]).toContain('Target="media/ink1.png"');
  });
  it("later pictures are on top, and a space is a line of its own exact height", () => {
    expect([...xml.matchAll(/relativeHeight="(\d+)"/g)].map((m) => Number(m[1]))).toEqual([251660000, 251660001]);
    expect(xml).toContain('<w:spacing w:before="0" w:after="0" w:line="2400" w:lineRule="exact"/>');
  });
  it("with ink: Arial, exact lines 1.4 times the size, and the PDF's text width; without: as before", () => {
    expect(parts["word/styles.xml"]).toContain('w:ascii="Arial"');
    expect(xml).toContain('<w:spacing w:line="308" w:lineRule="exact"/>');
    expect(xml).toContain('w:right="1120"');
    const plain = buildDocx({ title: "Notes", author: "S", created: new Date(0), blocks: [{ k: "p", runs: [{ t: "x" }] }] });
    expect(plain["word/styles.xml"]).toContain('w:ascii="Calibri"');
    expect(plain["word/document.xml"]).not.toContain("lineRule=\"exact\"");
    expect(plain["word/document.xml"]).toContain('w:right="1134"');
  });
  it("a picture that is not ours is left out", () => {
    const bad = buildDocx({ title: "N", author: "S", created: new Date(0), blocks: [{ k: "p", runs: [{ t: "x" }], floats: [{ ...f, media: "../x.png" }] }] });
    expect(bad["word/document.xml"]).not.toContain("wp:anchor");
  });
});
