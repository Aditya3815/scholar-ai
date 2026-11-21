import { describe, expect, it } from "vitest";
import { mdCaret, mdPlain, mdPlainText, mdSourceRuns, parseInline, parseNotebookMd, type MdInline } from "./notebook-md";

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

describe("underline: one syntax (++), and the old <u> still read", () => {
  const u = (c: unknown[]) => ({ t: "u", c });
  it("++words++ and <u>words</u> are both an underline, inside other marks too", () => {
    expect(parseInline("ddd++dddd++")).toEqual([{ t: "text", s: "ddd" }, u([{ t: "text", s: "dddd" }])]);
    expect(parseInline("ddd<u>dddd</u>")).toEqual([{ t: "text", s: "ddd" }, u([{ t: "text", s: "dddd" }])]);
    expect(parseInline("**a ++b++**")).toEqual([{ t: "b", c: [{ t: "text", s: "a " }, u([{ t: "text", s: "b" }])] }]);
  });
  it("C++ and a lone ++ stay text; a backslash keeps them plain", () => {
    expect(parseInline("C++ and C++")).toEqual([{ t: "text", s: "C++ and C++" }]);
    expect(parseInline("a ++ b")).toEqual([{ t: "text", s: "a ++ b" }]);
    expect(mdPlainText(String.raw`\++x\++`)).toBe("++x++");
  });
});

describe("the source, styled, for the field being written in", () => {
  it("keeps every character, in order, and says which are marks and how the rest is styled", () => {
    const md = "# Head\nddd++dddd++ and **b** ==m== <u>old</u>\n- item *i*";
    const runs = mdSourceRuns(md);
    expect(runs.map((l) => l.map((r) => r.s).join("")).join("\n")).toBe(md);
    const line = runs[1]!;
    expect(line.filter((r) => r.mark).map((r) => r.s)).toEqual(["++", "++", "**", "**", "==", "==", "<u>", "</u>"]);
    expect(line.find((r) => r.s === "dddd")).toMatchObject({ mark: false, u: true });
    expect(line.find((r) => r.s === "old")).toMatchObject({ u: true });
    expect(line.find((r) => r.s === "b")).toMatchObject({ b: true });
    expect(line.find((r) => r.s === "m")).toMatchObject({ hl: true });
    expect(runs[0]![0]).toMatchObject({ s: "# ", mark: true });
    expect(runs[0]![1]).toMatchObject({ s: "Head", h: true });
    expect(runs[2]![0]).toMatchObject({ s: "- ", mark: true });
  });
});

describe("long runs stay fast (CodeQL, 20 Nov 2026)", () => {
  it("a heading or list sign followed by many spaces is read quickly and whole", () => {
    const sp = " ".repeat(50_000);
    const t = performance.now();
    const runs = mdSourceRuns(`#${sp}x\n-${sp}y\n1.${sp}z`);
    expect(performance.now() - t).toBeLessThan(500);
    expect(runs.map((r) => r[0]!.s.length)).toEqual([50_001, 50_001, 50_002]);
  });
});

describe("a heading line with many spaces and a stray carriage return stays fast (CodeQL)", () => {
  it("is read in linear time", () => {
    const line = `#${" ".repeat(50_000)}\r`;
    const t = performance.now();
    mdSourceRuns(line);
    parseNotebookMd(line);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe("mdCaret: a cursor in the source, in the text as drawn (another person's caret)", () => {
  // the text as drawn, with "|" where the caret stands ("|" after a character when `after`)
  const show = (md: string, at: number) => {
    const c = mdCaret(md, at);
    const p = mdPlain(md);
    return `${p.slice(0, c.at)}|${p.slice(c.at)}${c.after ? " (after)" : ""}`;
  };
  it("plain text: the same offset", () => {
    expect(show("Who was recruited", 4)).toBe("Who |was recruited");
    expect(show("Who was recruited", 0)).toBe("|Who was recruited");
    expect(show("Who was recruited", 17)).toBe("Who was recruited| (after)");
  });
  it("skips the marks: bold, italic, underline (++ and <u>), mark", () => {
    expect(show("a **bold** word", 6)).toBe("a bo|ld word");
    expect(show("a **bold** word", 2)).toBe("a |bold word");
    expect(show("a **bold** word", 10)).toBe("a bold| word");
    expect(show("x ++under++ y", 7)).toBe("x und|er y");
    expect(show("x <u>under</u> y", 8)).toBe("x und|er y");
    expect(show("*it* ==hl==", 8)).toBe("it h|l");
    expect(show("*it* ==hl==", 9)).toBe("it hl| (after)");
    // an escaped star inside a bold: the bold's own stars are marks, the escaped one is drawn
    expect(show(String.raw`**\*b**`, 4)).toBe("*|b");
  });
  it("headings and lists: their signs are not drawn", () => {
    expect(show("# Methods\nWho", 4)).toBe("Me|thodsWho");
    expect(show("# Methods\nWho", 0)).toBe("|MethodsWho");
    expect(show("- one\n- two", 9)).toBe("onet|wo");
    expect(show("1. one\n2. two", 3)).toBe("|onetwo");
  });
  it("at a line's end the caret stays on that line", () => {
    expect(show("first\nsecond", 5)).toBe("first|second (after)");
    expect(show("first\nsecond", 6)).toBe("first|second");
    expect(show("- one\n- two", 5)).toBe("one|two (after)");
    expect(show("para\n\nnext", 4)).toBe("para|next (after)");
  });
  it("past the text (typing not saved yet): at its end; never negative", () => {
    expect(show("short", 400)).toBe("short| (after)");
    expect(show("short", -3)).toBe("|short");
    expect(mdCaret("", 5)).toEqual({ at: 0, after: false });
  });
  it("Hindi: never between a letter and its vowel sign", () => {
    // "नमस्ते": न म स ् त े; a cursor after त (before its vowel sign े) is drawn after the sign
    expect(show("नमस्ते दुनिया", 5)).toBe("नमस्ते| दुनिया");
    expect(show("**नमस्ते** दुनिया", 4)).toBe("नम|स्ते दुनिया");
    expect(show("😀 ok", 1)).toBe("😀| ok");
  });
});
