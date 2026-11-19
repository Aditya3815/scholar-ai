import { describe, expect, it } from "vitest";
import { buildDocx } from "./docx";

describe("the Word writer's pictures (the Notebook's captures and sketches, paper-reader.md 21.1, 4)", () => {
  const doc = (blocks: Parameters<typeof buildDocx>[0]["blocks"]) => buildDocx({ title: "Notes", author: "Sodhsetu", created: new Date(0), blocks });

  it("a picture is a drawing that points at its file in word/media, sized to fit the page's width", () => {
    const parts = doc([{ k: "image", media: "image1.png", w: 900, h: 300, alt: "A part of page 2: Figure 1" }]);
    expect(parts["[Content_Types].xml"]).toContain('<Default Extension="png" ContentType="image/png"/>');
    expect(parts["word/_rels/document.xml.rels"]).toContain('Id="rIdI1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"');
    const xml = parts["word/document.xml"]!;
    expect(xml).toContain('<a:blip r:embed="rIdI1"/>');
    expect(xml).toContain('descr="A part of page 2: Figure 1"');
    const cx = Number(/<wp:extent cx="(\d+)" cy="(\d+)"/.exec(xml)![1]);
    const cy = Number(/<wp:extent cx="(\d+)" cy="(\d+)"/.exec(xml)![2]);
    expect(cx).toBeLessThanOrEqual(Math.round((9638 / 1440) * 914400));
    expect(cx / cy).toBeCloseTo(3, 2);
    expect(xml).toContain('xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"');
  });

  it("a small picture keeps its size; the same file twice is one relationship; a bad file name or size writes nothing", () => {
    const parts = doc([
      { k: "image", media: "image1.png", w: 200, h: 100, alt: "a" },
      { k: "image", media: "image1.png", w: 200, h: 100, alt: "b" },
      { k: "image", media: "../evil.png", w: 200, h: 100, alt: "c" },
      { k: "image", media: "image2.png", w: 0, h: 100, alt: "d" },
    ]);
    expect(/<wp:extent cx="(\d+)"/.exec(parts["word/document.xml"]!)![1]).toBe(String(200 * 9525));
    expect(parts["word/_rels/document.xml.rels"]!.match(/rIdI\d/g)).toEqual(["rIdI1"]);
    expect(parts["word/document.xml"]!.match(/<w:drawing>/g)).toHaveLength(2);
  });
});
