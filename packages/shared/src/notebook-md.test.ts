import { describe, expect, it } from "vitest";
import { mdPlainText, parseInline, parseNotebookMd, type MdInline } from "./notebook-md";

const t = (s: string): MdInline => ({ t: "text", s });

describe("the Notebook's Markdown: inline marks", () => {
  it("reads each mark", () => {
    expect(parseInline("a **b** c")).toEqual([t("a "), { t: "b", c: [t("b")] }, t(" c")]);
    expect(parseInline("*i*")).toEqual([{ t: "i", c: [t("i")] }]);
    expect(parseInline("<u>under</u>")).toEqual([{ t: "u", c: [t("under")] }]);
    expect(parseInline("==marked==")).toEqual([{ t: "mark", c: [t("marked")] }]);
  });

  it("nests marks, and reads runs of stars", () => {
    expect(parseInline("**bold *and italic***")).toEqual([{ t: "b", c: [t("bold "), { t: "i", c: [t("and italic")] }] }]);
    expect(parseInline("***x***")).toEqual([{ t: "b", c: [{ t: "i", c: [t("x")] }] }]);
    expect(parseInline("*a **b***")).toEqual([{ t: "i", c: [t("a "), { t: "b", c: [t("b")] }] }]);
    expect(parseInline("==a <u>b</u>==")).toEqual([{ t: "mark", c: [t("a "), { t: "u", c: [t("b")] }] }]);
  });

  it("leaves what is not a mark as text: a lone star, a star before a space, an unclosed mark, an escape", () => {
    expect(parseInline("2 * 3 * 4")).toEqual([t("2 * 3 * 4")]);
    expect(parseInline("**open")).toEqual([t("**open")]);
    expect(parseInline("a ** b **")).toEqual([t("a ** b **")]);
    expect(parseInline("\\*not\\*")).toEqual([t("*not*")]);
    expect(parseInline("== x ==")).toEqual([t("== x ==")]);
  });

  it("a line break is a token of its own", () => {
    expect(parseInline("one\ntwo")).toEqual([t("one"), { t: "br" }, t("two")]);
  });
});

describe("the Notebook's Markdown: blocks", () => {
  it("headings of three levels; a fourth # is text", () => {
    expect(parseNotebookMd("# One\n## Two\n### Three\n#### Four")).toEqual([
      { t: "h", level: 1, c: [t("One")] },
      { t: "h", level: 2, c: [t("Two")] },
      { t: "h", level: 3, c: [t("Three")] },
      { t: "p", c: [t("#### Four")] },
    ]);
    expect(parseNotebookMd("#nospace")).toEqual([{ t: "p", c: [t("#nospace")] }]);
  });

  it("bullet and numbered lists, each a run of its own kind, starting where the first number says", () => {
    expect(parseNotebookMd("- a\n- **b**\n3. c\n4. d")).toEqual([
      { t: "ul", items: [[t("a")], [{ t: "b", c: [t("b")] }]] },
      { t: "ol", start: 3, items: [[t("c")], [t("d")]] },
    ]);
  });

  it("paragraphs keep their line breaks and are parted by blank lines", () => {
    expect(parseNotebookMd("first line\nsecond line\n\n\nnext")).toEqual([
      { t: "p", c: [t("first line"), { t: "br" }, t("second line")] },
      { t: "p", c: [t("next")] },
    ]);
    expect(parseNotebookMd("")).toEqual([]);
    expect(parseNotebookMd("a\r\nb")).toEqual([{ t: "p", c: [t("a"), { t: "br" }, t("b")] }]);
  });

  it("a script tag, an onerror picture and a javascript: link are tokens of plain text (the page draws text, never HTML)", () => {
    const tokens = parseNotebookMd('<script>alert(1)</script>\n<img src=x onerror="alert(1)">\n[x](javascript:alert(1))');
    expect(tokens).toEqual([{ t: "p", c: [t("<script>alert(1)</script>"), { t: "br" }, t('<img src=x onerror="alert(1)">'), { t: "br" }, t("[x](javascript:alert(1))")] }]);
    // nothing but the five marks and text ever comes out
    const kinds = new Set<string>();
    const walk = (c: MdInline[]) => c.forEach((x) => (kinds.add(x.t), "c" in x && walk(x.c)));
    for (const b of parseNotebookMd("<b>x</b> <a href=x>y</a> <U>z</U> <u onclick=1>w</u> ![p](q)")) if (b.t === "p") walk(b.c);
    expect([...kinds]).toEqual(["text"]);
  });

  it("the plain text, for a block's name", () => {
    expect(mdPlainText("# Patches\nare **linear**\n- one\n- two")).toBe("Patches are linear one two");
  });
});
