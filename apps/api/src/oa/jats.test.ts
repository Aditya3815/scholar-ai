import { describe, expect, it } from "vitest";
import REAL from "./fixtures/PMC1182327.xml?raw"; // Ioannidis 2005, PLoS Medicine, CC BY, from Europe PMC
import { MAX_JATS_CHARS, decodeEntities, isPermissiveLicense, normaliseLicense, parseJats } from "./jats";

const wrap = (body: string, front = "") => `<?xml version="1.0"?><article><front>${front}</front><body>${body}</body></article>`;

describe("parseJats on a real Europe PMC file", () => {
  const j = parseJats(REAL);
  it("finds the title, the licence and the summary", () => {
    expect(j.title).toBe("Why Most Published Research Findings Are False");
    expect(j.license).toBe("cc-by");
    expect(j.abstract).toMatch(/^There is increasing concern that most current published research findings are false/);
    expect(j.truncated).toBe(false);
  });
  it("keeps the paragraphs before the first heading, with no heading", () => {
    expect(j.sections[0]!.title).toBeNull();
    expect(j.sections[0]!.text).toMatch(/^Published research findings are sometimes refuted by subsequent evidence/);
  });
  it("has the headings of the paper and their text", () => {
    const titles = j.sections.map((s) => s.title);
    expect(titles).toContain("Modeling the Framework for False Positive Findings");
    expect(titles).toContain("Bias");
    expect(titles.filter((t) => t !== null).length).toBeGreaterThanOrEqual(8);
    const bias = j.sections.find((s) => s.title === "Bias")!;
    expect(bias.text.length).toBeGreaterThan(500);
  });
  it("drops the numbers of citations but keeps the words around them, and italics", () => {
    const all = j.sections.map((s) => s.text).join("\n");
    expect(all).not.toMatch(/\[\s*\d+\s*[–-]\s*\d+\s*\]/);
    expect(all).not.toMatch(/\[\s*\d+\s*(?:,\s*\d+\s*)*\]/);
    expect(all).toMatch(/p-value/);
  });
  it("includes the caption of a table, and its rows", () => {
    const all = j.sections.map((s) => s.text).join("\n");
    expect(all).toMatch(/Table 1\s+Research Findings and True Relationships/);
  });
  it("is a plain text per section with no markup and no run of spaces", () => {
    for (const s of j.sections) {
      expect(s.text).not.toMatch(/<[a-z/][^>]*>/i);
      expect(s.text).not.toMatch(/[ \t]{2,}/);
      expect(s.text.length).toBeGreaterThan(0);
    }
  });
  it("reads about twenty-four thousand characters of body from a 75 KB file", () => {
    const n = j.sections.reduce((a, s) => a + s.text.length, 0);
    expect(n).toBeGreaterThan(20_000);
    expect(n).toBeLessThan(40_000);
  });
});

describe("parseJats on small files", () => {
  it("nests headings: 'Methods > Participants', in reading order, with the text before a sub-section kept", () => {
    const j = parseJats(wrap(`<sec><title>Methods</title><p>We did it.</p><sec><title>Participants</title><p>Adults.</p></sec><sec><title>Analysis</title><p>Stats.</p></sec><p>After.</p></sec>`));
    expect(j.sections.map((s) => [s.title, s.text])).toEqual([["Methods", "We did it."], ["Methods > Participants", "Adults."], ["Methods > Analysis", "Stats."], ["Methods", "After."]]);
  });

  it("a section without a title takes its parent's; paragraphs outside any section come first", () => {
    const j = parseJats(wrap(`<p>Lead.</p><sec><p>No heading.</p></sec><sec><title>Results</title><sec><p>Deep.</p></sec></sec>`));
    expect(j.sections.map((s) => [s.title, s.text])).toEqual([[null, "Lead."], [null, "No heading."], ["Results", "Deep."]]);
  });

  it("decodes entities, numeric ones too, and CDATA, and ignores comments and processing instructions", () => {
    const j = parseJats(wrap(`<sec><title>A &amp; B</title><p>5 &lt; 6 &#x3B1; &#946; &nbsp;fine <![CDATA[<raw & text>]]><!-- hidden --><?pi ignored?> end&unknown; &#0; &#xD800;.</p></sec>`));
    expect(j.sections[0]!.title).toBe("A & B");
    expect(j.sections[0]!.text).toBe("5 < 6 α β fine <raw & text> end&unknown; .");
  });

  it("drops bibliography citations and formulas, keeps figure references and links", () => {
    const j = parseJats(wrap(`<sec><title>R</title><p>As shown <xref ref-type="bibr" rid="b1">[1]</xref> and in <xref ref-type="fig" rid="f1">Figure 1</xref>, <ext-link xlink:href="x">the site</ext-link> says <inline-formula><mml:math><mml:mi>x</mml:mi></mml:math></inline-formula>that <sup>2</sup>H is rare.</p></sec>`));
    expect(j.sections[0]!.text).toBe("As shown and in Figure 1, the site says that 2H is rare.");
  });

  it("figure captions and boxed text are text of the paper; graphics and supplementary links are not", () => {
    const j = parseJats(wrap(`<sec><title>R</title><fig id="f1"><label>Figure 2</label><caption><title>Survival</title><p>By group.</p></caption><graphic xlink:href="f.jpg"/></fig><boxed-text><caption><title>Box 1</title></caption><p>An example.</p></boxed-text><supplementary-material><p>Download the data</p></supplementary-material></sec>`));
    const t = j.sections[0]!.text;
    expect(t).toMatch(/Figure 2 Survival By group\./);
    expect(t).toMatch(/Box 1 An example\./);
    expect(t).not.toMatch(/Download the data/);
  });

  it("a table gives its caption and its first forty rows, cells joined with bars", () => {
    const rows = Array.from({ length: 60 }, (_, i) => `<tr><td>row ${i}</td><td>${i * 2}</td></tr>`).join("");
    const j = parseJats(wrap(`<sec><title>T</title><table-wrap><label>Table 3</label><caption><title>Doses</title></caption><table><thead><tr><th>Name</th><th>Dose</th></tr></thead><tbody>${rows}</tbody></table></table-wrap></sec>`));
    const lines = j.sections[0]!.text.split("\n");
    expect(lines[0]).toBe("Table 3 Doses");
    expect(lines[1]).toBe("Name | Dose");
    expect(lines.length).toBe(1 + 40);
    expect(lines.at(-1)).toBe("row 38 | 76");
  });

  it("leaves out the reference list and anything after the body", () => {
    const xml = `<article><front/><body><sec><title>Intro</title><p>Body text.</p></sec></body><back><ref-list><ref><mixed-citation>Smith J. 2001. Old paper.</mixed-citation></ref></ref-list><ack><p>Thanks to all.</p></ack></back></article>`;
    const all = parseJats(xml).sections.map((s) => s.text).join(" ");
    expect(all).toBe("Body text.");
  });

  it("takes the licence from a link, a type, or the wording; the first real one wins over 'other'", () => {
    const lic = (inner: string) => parseJats(`<article><front><article-meta><permissions>${inner}</permissions></article-meta></front><body/></article>`).license;
    expect(lic(`<license xlink:href="https://creativecommons.org/licenses/by/4.0/"><license-p>x</license-p></license>`)).toBe("cc-by");
    expect(lic(`<license license-type="open-access"><license-p>Free to read.</license-p></license><ali:license_ref>https://creativecommons.org/licenses/by-nc/4.0/</ali:license_ref>`)).toBe("cc-by-nc");
    expect(lic(`<license><license-p>Distributed under the Creative Commons Attribution-NonCommercial-NoDerivs License.</license-p></license>`)).toBe("cc-by-nc-nd");
    expect(lic(`<license><license-p>Creative Commons Attribution License</license-p></license>`)).toBe("cc-by");
    expect(lic(`<license><license-p>All rights reserved.</license-p></license>`)).toBe("other");
    expect(lic("")).toBeNull();
  });

  it("uses the summary abstract, not a table-of-contents blurb or a graphical one", () => {
    const j = parseJats(`<article><front><article-meta><abstract abstract-type="toc"><p>Teaser.</p></abstract><abstract abstract-type="graphical"><p>Picture.</p></abstract><abstract><title>Summary</title><p>The real one.</p><p>Second part.</p></abstract></article-meta></front><body/></article>`);
    expect(j.abstract).toBe("The real one. Second part.");
  });

  it("a file with no body, no tags, or nothing at all gives an empty result, never an error", () => {
    for (const xml of ["", "just text", "<article/>", "<article><front><article-meta></article-meta></front></article>", "<<<>>>", "&&&"]) {
      const j = parseJats(xml);
      expect(j.sections).toEqual([]);
      expect(j.title).toBeNull();
    }
  });

  it("a broken file (unclosed tags, a stray closing tag, a cut-off ending) gives what could be read", () => {
    const j = parseJats(`<article><body><sec><title>Intro</title><p>First paragraph.</p></p></em><p>Second <b>bold paragraph.</sec><sec><title>Next</title><p>Cut off mid-sen`);
    expect(j.sections.map((s) => s.title)).toEqual(["Intro", "Next"]);
    expect(j.sections[0]!.text).toContain("First paragraph.");
    expect(j.sections[0]!.text).toContain("Second bold paragraph.");
    expect(j.sections[1]!.text).toBe("Cut off mid-sen");
  });

  it("an absurdly deep file does not overflow the stack", () => {
    const deep = "<sec>".repeat(5000) + "<p>deep</p>" + "</sec>".repeat(5000);
    expect(() => parseJats(wrap(deep))).not.toThrow();
  });

  it("caps the text and says so", () => {
    const para = `<p>${"word ".repeat(2000)}</p>`;
    const j = parseJats(wrap(Array.from({ length: 80 }, (_, i) => `<sec><title>S${i}</title>${para}</sec>`).join("")));
    const n = j.sections.reduce((a, s) => a + s.text.length, 0);
    expect(j.truncated).toBe(true);
    expect(n).toBeLessThanOrEqual(MAX_JATS_CHARS);
    expect(j.sections.length).toBeGreaterThan(10);
  });

  it("takes an XML declaration, a doctype and a namespace prefix on the root without trouble", () => {
    const j = parseJats(`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE article PUBLIC "-//NLM//DTD JATS//EN" "x.dtd"><article xmlns:xlink="http://www.w3.org/1999/xlink" xml:lang="en"><body><sec><title>A</title><p>Text.</p></sec></body></article>`);
    expect(j.sections).toEqual([{ title: "A", text: "Text." }]);
  });
});

describe("licences", () => {
  it.each([
    ["cc by", "cc-by"], ["cc by-nc", "cc-by-nc"], ["CC BY-NC-ND 4.0", "cc-by-nc-nd"], ["cc-by-sa", "cc-by-sa"], ["cc0", "cc0"], ["CC0 1.0", "cc0"],
    ["https://creativecommons.org/licenses/by-nc-sa/4.0/", "cc-by-nc-sa"], ["https://creativecommons.org/publicdomain/zero/1.0/", "cc0"],
    ["publisher's own terms", "other"], ["open access", "other"], ["", null], [null, null], [undefined, null],
  ])("%s -> %s", (raw, want) => expect(normaliseLicense(raw as string | null)).toBe(want));
  it("only cc0, cc-by and cc-by-sa allow showing the PDF itself", () => {
    expect(["cc0", "cc-by", "cc-by-sa"].every(isPermissiveLicense)).toBe(true);
    for (const l of ["cc-by-nc", "cc-by-nd", "cc-by-nc-nd", "cc-by-nc-sa", "other", null, undefined]) expect(isPermissiveLicense(l)).toBe(false);
  });
});

describe("decodeEntities", () => {
  it("handles the five XML entities, numbers, and leaves what it does not know", () => {
    expect(decodeEntities("&amp;&lt;&gt;&quot;&apos;&#65;&#x42;&bogus;")).toBe(`&<>"'AB&bogus;`);
    expect(decodeEntities("&#1114112;&#xD800;&#0;")).toBe("");
  });
});
