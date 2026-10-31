import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync, zipSync, strToU8 } from "fflate";
import { assembleReport, buildDocx, buildReviewDocx, bookmarkName, referenceRuns, marked, reviewFileName, safeLink, xmlEscape, xmlSafe, type Block, type DocxDoc, type LitscanItem, type LitscanPart } from "@scholar/shared";

/** A small XML well-formedness check: tags nest and close, attributes are quoted, entities are the five known ones. Enough to catch what makes Word say "unreadable content". */
function wellFormed(xml: string): string | null {
  const body = xml.replace(/^<\?xml[^>]*\?>\s*/, "");
  const stack: string[] = [];
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|([^<]+)/g;
  let pos = 0;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    if (m.index !== pos) return `junk at ${pos}: ${body.slice(pos, pos + 40)}`;
    pos = re.lastIndex;
    if (m[5] !== undefined) {
      if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(m[5]) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(m[5])) return `bad text: ${m[5].slice(0, 40)}`;
      continue;
    }
    if (m[1]) {
      if (stack.pop() !== m[2]) return `mismatched </${m[2]}>`;
    } else if (!m[4]) stack.push(m[2]!);
  }
  if (pos !== body.length) return `junk at end: ${body.slice(pos, pos + 40)}`;
  return stack.length ? `unclosed <${stack.at(-1)}>` : null;
}
const texts = (xml: string) => [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]!.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
const doc = (blocks: Block[], extra: Partial<DocxDoc> = {}): DocxDoc => ({ title: "T", author: "Sodhsetu", created: new Date("2026-10-29T10:00:00Z"), blocks, ...extra });

describe("what XML can hold", () => {
  it("drops control characters, U+FFFE and U+FFFF and a lone surrogate, and keeps tab, line breaks, Hindi and emoji", () => {
    expect(xmlSafe("a\u0000b\u0001c\u0008d\u000be\u000cf\u001fg")).toBe("abcdefg");
    expect(xmlSafe("tab\there\nnew\rline")).toBe("tab\there\nnew\rline");
    expect(xmlSafe("x￾y￿z")).toBe("xyz");
    expect(xmlSafe("a\ud800b")).toBe("ab");
    expect(xmlSafe("a\udc00b")).toBe("ab");
    expect(xmlSafe("योग 🧘 ok")).toBe("योग 🧘 ok");
  });
  it("escapes the five characters that matter", () => expect(xmlEscape(`<a href="x">Tom & 'Jerry'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;Tom &amp; 'Jerry'&lt;/a&gt;"));
  it("links only web and mail addresses", () => {
    for (const bad of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,x", "vbscript:x", "file:///etc/passwd", "ftp://x.org/a", "/relative/path", "doi.org/10.1/x", "", "   ", undefined]) expect(safeLink(bad)).toBeNull();
    expect(safeLink("https://doi.org/10.1/x")).toBe("https://doi.org/10.1/x");
    expect(safeLink(" http://a.org ")).toBe("http://a.org/");
    expect(safeLink("mailto:a@b.org")).toBe("mailto:a@b.org");
  });
  it("makes a bookmark name Word accepts: a letter first, letters digits and underscores, at most 40", () => {
    expect(bookmarkName("ref12")).toBe("bref12");
    expect(bookmarkName("a b-c.d")).toBe("ba_b_c_d");
    expect(bookmarkName("x".repeat(100))).toHaveLength(40);
    expect(bookmarkName("")).toBe("b");
    expect(bookmarkName("रेफ")).toMatch(/^b_+$/);
  });
});

describe("buildDocx: the file", () => {
  const parts = buildDocx(doc([{ k: "title", runs: [{ t: "Hello" }] }]));
  it("has the parts Word needs, and every part is well-formed XML", () => {
    expect(Object.keys(parts).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "docProps/app.xml", "docProps/core.xml", "word/_rels/document.xml.rels", "word/document.xml", "word/numbering.xml", "word/styles.xml"]);
    for (const [name, xml] of Object.entries(parts)) expect(wellFormed(xml), name).toBeNull();
  });
  it("lists every part in the content types, and the main document and its relationships agree", () => {
    for (const name of ["/word/document.xml", "/word/styles.xml", "/word/numbering.xml", "/docProps/core.xml", "/docProps/app.xml"]) expect(parts["[Content_Types].xml"]).toContain(`PartName="${name}"`);
    expect(parts["_rels/.rels"]).toContain('Target="word/document.xml"');
    expect(parts["word/_rels/document.xml.rels"]).toContain('Target="styles.xml"');
    expect(parts["word/_rels/document.xml.rels"]).toContain('Target="numbering.xml"');
  });
  it("survives a trip through a zip", () => {
    const zip = zipSync(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, strToU8(v)])));
    const back = unzipSync(zip);
    expect(strFromU8(back["word/document.xml"]!)).toBe(parts["word/document.xml"]);
    expect(Object.keys(back)).toHaveLength(8);
  });
  it("puts the title in the file's properties, escaped, with the author and the date", () => {
    const p = buildDocx(doc([], { title: "A & B <c>", author: 'Me "x"', created: new Date("2026-10-29T10:00:00.123Z") }));
    expect(p["docProps/core.xml"]).toContain("<dc:title>A &amp; B &lt;c&gt;</dc:title>");
    expect(p["docProps/core.xml"]).toContain("<dc:creator>Me &quot;x&quot;</dc:creator>");
    expect(p["docProps/core.xml"]).toContain(">2026-10-29T10:00:00Z<");
    expect(wellFormed(p["docProps/core.xml"]!)).toBeNull();
  });
  it("does not throw for an invalid date, an empty document, or an odd language", () => {
    expect(() => buildDocx(doc([], { created: new Date("nope") }))).not.toThrow();
    const empty = buildDocx(doc([]));
    expect(empty["word/document.xml"]).toContain("<w:p>");
    expect(wellFormed(empty["word/document.xml"]!)).toBeNull();
    expect(buildDocx(doc([], { lang: '"><evil/>' }))["word/styles.xml"]).toContain('w:val="en-IN"');
    expect(buildDocx(doc([], { lang: "hi-IN" }))["word/styles.xml"]).toContain('w:val="hi-IN"');
  });
});

describe("buildDocx: the text", () => {
  const body = (blocks: Block[]) => buildDocx(doc(blocks))["word/document.xml"]!;
  it("escapes what the person's text can contain and keeps it whole", () => {
    const xml = body([{ k: "p", runs: [{ t: `5 < 6 & "x" > 'y' </w:t><w:evil/>` }] }]);
    expect(wellFormed(xml)).toBeNull();
    expect(xml).not.toContain("<w:evil/>");
    expect(texts(xml).join("")).toBe(`5 < 6 & "x" > 'y' </w:t><w:evil/>`);
  });
  it("drops what XML cannot hold, so the file is still readable", () => {
    const xml = body([{ k: "p", runs: [{ t: "bad\u0000\u0008\ud800 chars" }] }]);
    expect(wellFormed(xml)).toBeNull();
    expect(texts(xml).join("")).toBe("bad chars");
  });
  it("keeps Hindi, Devanagari digits and emoji, and sets a font for them", () => {
    const p = buildDocx(doc([{ k: "p", runs: [{ t: "योग से रक्तचाप घटता है १२३ 🧘" }] }]));
    expect(texts(p["word/document.xml"]!).join("")).toBe("योग से रक्तचाप घटता है १२३ 🧘");
    expect(p["word/styles.xml"]).toContain('w:cs="Nirmala UI"');
  });
  it("turns line breaks into Word line breaks, and keeps leading and trailing spaces", () => {
    const xml = body([{ k: "p", runs: [{ t: " a\nb\r\nc " }] }]);
    expect((xml.match(/<w:br\/>/g) ?? []).length).toBe(2);
    expect(xml).toContain('xml:space="preserve"');
    expect(texts(xml)).toEqual([" a", "b", "c "]);
  });
  it("writes italic, bold and superscript in the order the schema wants", () => {
    const xml = body([{ k: "p", runs: [{ t: "x", b: true, i: true, sup: true, link: "https://a.org" }] }]);
    expect(xml).toMatch(/<w:rPr><w:b\/><w:bCs\/><w:i\/><w:iCs\/><w:color [^>]*\/><w:u [^>]*\/><w:vertAlign w:val="superscript"\/><\/w:rPr>/);
  });
  it("an empty run writes nothing", () => expect(body([{ k: "p", runs: [{ t: "" }, { t: "\u0000" }] }])).not.toContain("<w:r>"));

  it("links: an address becomes a hyperlink with its relationship, the same address once, and an unsafe one stays plain text", () => {
    const p = buildDocx(doc([{ k: "p", runs: [{ t: "a", link: "https://doi.org/10.1/x" }, { t: "b", link: "https://doi.org/10.1/x" }, { t: "c", link: "https://other.org/?a=1&b=2" }, { t: "d", link: "javascript:alert(1)" }] }]));
    const xml = p["word/document.xml"]!;
    expect((xml.match(/<w:hyperlink /g) ?? []).length).toBe(3);
    const rels = p["word/_rels/document.xml.rels"]!;
    expect((rels.match(/TargetMode="External"/g) ?? []).length).toBe(2);
    expect(rels).toContain('Target="https://other.org/?a=1&amp;b=2"');
    expect(xml).not.toContain("javascript");
    expect(rels).not.toContain("javascript");
    for (const [n, x] of Object.entries(p)) expect(wellFormed(x), n).toBeNull();
    for (const id of xml.match(/r:id="[^"]+"/g)!) expect(rels).toContain(`Id="${id.slice(6, -1)}"`);
  });
  it("jumps to a bookmark, and every bookmark has its own number and a valid name", () => {
    const xml = body([{ k: "p", runs: [{ t: "[1]", anchor: "ref1" }] }, { k: "ref", no: 1, bookmark: "ref1", runs: [{ t: "A" }] }, { k: "ref", no: 2, bookmark: "ref2", runs: [{ t: "B" }] }, { k: "h2", runs: [{ t: "H" }], bookmark: "h" }]);
    expect(xml).toContain('<w:hyperlink w:anchor="bref1"');
    const ids = [...xml.matchAll(/<w:bookmarkStart w:id="(\d+)" w:name="([^"]+)"/g)];
    expect(ids.map((m) => m[2])).toEqual(["bref1", "bref2", "bh"]);
    expect(new Set(ids.map((m) => m[1])).size).toBe(3);
    expect((xml.match(/<w:bookmarkEnd /g) ?? []).length).toBe(3);
    expect(wellFormed(xml)).toBeNull();
  });
  it("styles: the headings, the note, the bullets and the references use styles that the styles part defines", () => {
    const p = buildDocx(doc([{ k: "title", runs: [{ t: "T" }] }, { k: "h1", runs: [{ t: "A" }] }, { k: "h2", runs: [{ t: "B" }] }, { k: "h3", runs: [{ t: "C" }] }, { k: "note", runs: [{ t: "N" }] }, { k: "bullet", runs: [{ t: "L" }] }, { k: "ref", no: 1, runs: [{ t: "R" }] }, { k: "table", widths: [1], head: ["H"], rows: [[[{ t: "c" }]]] }]));
    for (const id of new Set([...p["word/document.xml"]!.matchAll(/<w:(?:pStyle|tblStyle) w:val="([^"]+)"/g)].map((m) => m[1]!))) expect(p["word/styles.xml"], id).toContain(`w:styleId="${id}"`);
    expect(p["word/document.xml"]).toContain('<w:numId w:val="1"/>');
    expect(p["word/numbering.xml"]).toContain('w:numId="1"');
  });
  it("a reference keeps its number written, followed by a tab", () => expect(body([{ k: "ref", no: 12, runs: [{ t: "R" }] }])).toMatch(/<w:t xml:space="preserve">12\.<\/w:t><\/w:r><w:r><w:tab\/><\/w:r>/));
});

describe("buildDocx: a table", () => {
  type Rows = Extract<Block, { k: "table" }>["rows"];
  const t = (rows: Rows, widths = [1, 2, 3]): string =>
    buildDocx(doc([{ k: "table", widths, head: ["A", "B", "C"], rows }]))["word/document.xml"]!;
  it("has a header row that repeats, the widths of its columns summing to the page, and a paragraph after it", () => {
    const xml = t([[[{ t: "1" }], [{ t: "2" }], [{ t: "3" }]]]);
    expect(wellFormed(xml)).toBeNull();
    expect(xml).toContain("<w:tblHeader/>");
    const widths = [...xml.match(/<w:tblGrid>(.*?)<\/w:tblGrid>/)![1]!.matchAll(/w:w="(\d+)"/g)].map((m) => +m[1]!);
    expect(widths).toHaveLength(3);
    expect(widths.reduce((a, b) => a + b, 0)).toBeGreaterThan(9500);
    expect(widths.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(9640);
    expect(xml).toMatch(/<\/w:tbl><w:p>/);
  });
  it("every row has a cell for every column, even when a row is short or long, and every cell has a paragraph", () => {
    const xml = t([[[{ t: "only" }]], [[{ t: "1" }], [{ t: "2" }], [{ t: "3" }], [{ t: "extra" }]], []]);
    expect(wellFormed(xml)).toBeNull();
    for (const row of xml.split("<w:tr>").slice(1)) {
      expect((row.match(/<w:tc>/g) ?? []).length).toBe(3);
      expect((row.match(/<w:tc>.*?<\/w:tc>/g) ?? []).every((c) => c.includes("<w:p>"))).toBe(true);
    }
    expect(texts(xml)).not.toContain("extra");
  });
  it("a table with no rows is only its header", () => expect(wellFormed(t([]))).toBeNull());
  it("zero or odd widths still give a usable table", () => {
    for (const w of [[0, 0, 0], [-5, 1, 1], [1e9, 1, 1], []]) expect(wellFormed(t([[[{ t: "x" }]]], w))).toBeNull();
  });
  it("a very large table does not throw", () => {
    const rows = Array.from({ length: 2000 }, (_, i) => [[{ t: String(i) }], [{ t: "b" }], [{ t: "c" }]]);
    expect(() => t(rows)).not.toThrow();
  });
});

/* ---------------------------------------------------------------- the review */

const items: LitscanItem[] = [
  { title: "Strength of the link", question: "How strong is the link?", searchQuery: "air pollution asthma" },
  { title: "Measuring <exposure> & more", question: "How is exposure measured?", searchQuery: "traffic pollution exposure" },
  { title: "What helps", question: "What helps?", searchQuery: "intervention asthma children" },
];
const src = (n: number, paperId: string, title: string, extra: Partial<{ year: number | null; authors: string[]; venue: string | null; doi: string | null; url: string | null }> = {}) => ({
  n, paperId, title, year: 2020, doi: `10.1/${paperId}`, authors: ["Anjali Rao", "S N Kavitha"], venue: "Indian Journal of Pediatrics", url: `https://doi.org/10.1/${paperId}`, ...extra,
});
const answered = (idx: number, text: string, sources: ReturnType<typeof src>[], sentences: Record<number, string>): LitscanPart => ({
  idx, status: "answered", found: 12, text, sources, citations: sources.map((s) => ({ n: s.n, paperId: s.paperId, sentenceNo: 2, sentence: sentences[s.n]! })),
});
const report = assembleReport(items, {
  0: answered(0, "Pollution is linked to asthma [1][2].", [src(1, "a", "Traffic pollution and childhood asthma: a meta-analysis"), src(2, "b", "Asthma in Delhi schools", { year: 2016, doi: null, url: "https://example.org/b" })], { 1: "The pooled odds ratio was 1.08.", 2: 'A cross-sectional survey of 4,000 children found "more wheeze" near roads.' }),
  1: answered(1, "Exposure is modelled from roads [1].", [src(1, "b", "Asthma in Delhi schools", { year: 2016, doi: null, url: "https://example.org/b" })], { 1: "Exposure was estimated from distance to the nearest road." }),
  2: { idx: 2, status: "gap", found: 0, reason: "nothing_found" },
});
const args = { appName: "Sodhsetu", generatedAt: "2026-10-29T10:00:00.000Z", topic: "Air pollution & asthma", language: "en" as const, report };

describe("the review as a Word document", () => {
  const d = buildReviewDocx(args);
  const parts = buildDocx(d);
  const xml = parts["word/document.xml"]!;
  const all = texts(xml).join("\n");
  it("is well-formed in every part", () => {
    for (const [n, x] of Object.entries(parts)) expect(wellFormed(x), n).toBeNull();
  });
  it("has the title, the made-with line, the note, and the sections in the order of the Markdown review", () => {
    expect(d.title).toBe("Literature review: Air pollution & asthma");
    const headings = d.blocks.filter((b) => b.k === "h1").map((b) => (b as { runs: { t: string }[] }).runs[0]!.t);
    expect(headings).toEqual(["At a glance", "Findings by theme", "Evidence table", "Gaps", "References"]);
    expect(all).toContain("Made with Sodhsetu on 2026-10-29");
    expect(all).toContain("Written in English");
    expect(all).toContain("not a systematic review");
  });
  it("has each theme with its text, and the sentences behind it, with the marks as jumps to the references", () => {
    expect(all).toContain("Strength of the link");
    expect(all).toContain("Measuring <exposure> & more");
    expect(all).toContain("Pollution is linked to asthma ");
    expect(all).toContain("“The pooled odds ratio was 1.08.”");
    expect(all).toContain("“A cross-sectional survey of 4,000 children found \"more wheeze\" near roads.”");
    expect(xml).toContain('<w:hyperlink w:anchor="bref1"');
    expect(xml).toContain('<w:hyperlink w:anchor="bref2"');
  });
  it("every jump has its reference: a bookmark for each mark, and a reference line for each source", () => {
    const anchors = new Set([...xml.matchAll(/w:anchor="([^"]+)"/g)].map((m) => m[1]));
    const marks = new Set([...xml.matchAll(/w:bookmarkStart [^>]*w:name="([^"]+)"/g)].map((m) => m[1]));
    for (const a of anchors) expect(marks.has(a!), a).toBe(true);
    expect(d.blocks.filter((b) => b.k === "ref")).toHaveLength(report.sources.length);
  });
  it("has the evidence table with a row for each paper, and the gap with its reason and search", () => {
    const table = d.blocks.find((b) => b.k === "table") as Extract<Block, { k: "table" }>;
    expect(table.head).toEqual(["No.", "Study", "Design", "Key finding", "Themes"]);
    expect(table.rows).toHaveLength(report.sources.length);
    expect(all).toContain("What helps");
    expect(all).toContain("(searched for: intervention asthma children)");
  });
  it("writes the references in APA with the journal in italics and the DOI as a link, and a link for a source with no DOI", () => {
    expect(xml).toMatch(/<w:i\/><w:iCs\/>[^]*?Indian Journal of Pediatrics/);
    const rels = parts["word/_rels/document.xml.rels"]!;
    expect(rels).toContain('Target="https://doi.org/10.1/a"');
    expect(rels).toContain('Target="https://example.org/b"');
    expect(all).not.toMatch(/[\u0001\u0002]/);
  });
  it("says Indian sources only when it was", () => {
    expect(texts(buildDocx(buildReviewDocx({ ...args, indian: true }))["word/document.xml"]!).join(" ")).toContain("from Indian sources only");
    expect(all).not.toContain("from Indian sources only");
  });
  it("uses the language's spell-check setting", () => {
    expect(buildDocx(buildReviewDocx({ ...args, language: "hi" }))["word/styles.xml"]).toContain('w:val="hi-IN"');
    expect(parts["word/styles.xml"]).toContain('w:val="en-IN"');
  });
  it("is made the same way twice (nothing random in it)", () => expect(buildDocx(buildReviewDocx(args))).toEqual(parts));
  it("copes with a review that has nothing answered", () => {
    const empty = assembleReport(items, { 0: { idx: 0, status: "gap", found: 0, reason: "nothing_found" }, 1: { idx: 1, status: "gap", found: 0, reason: "no_relevant" }, 2: { idx: 2, status: "gap", found: 0, reason: "nothing_found" } });
    const p = buildDocx(buildReviewDocx({ ...args, report: empty }));
    for (const [n, x] of Object.entries(p)) expect(wellFormed(x), n).toBeNull();
    expect(texts(p["word/document.xml"]!).join(" ")).toContain("Gaps");
  });
  it("copes with a hostile topic and hostile abstracts", () => {
    const evil = "</w:t></w:p><script>alert(1)</script>\u0000\u0008 ]]> <!-- x -->";
    const r = assembleReport(items, { 0: answered(0, `${evil} [1].`, [src(1, "a", evil)], { 1: evil }) });
    const p = buildDocx(buildReviewDocx({ ...args, topic: evil, report: r }));
    for (const [n, x] of Object.entries(p)) expect(wellFormed(x), n).toBeNull();
    expect(p["word/document.xml"]).not.toContain("<script>");
  });
  it("copes with a long review (40 themes, 200 papers)", () => {
    const many: LitscanItem[] = Array.from({ length: 40 }, (_, i) => ({ title: `Theme ${i}`, question: `Q${i}?`, searchQuery: `s${i}` }));
    const parts200: Record<number, LitscanPart> = {};
    many.forEach((_, i) => { parts200[i] = answered(i, `Text ${i} [1].`, [src(1, `p${i}`, `Paper ${i}`)], { 1: `Sentence ${i}.` }); });
    const p = buildDocx(buildReviewDocx({ ...args, report: assembleReport(many, parts200) }));
    expect(wellFormed(p["word/document.xml"]!)).toBeNull();
  });
});

describe("marked and referenceRuns", () => {
  it("marked turns [n] into jumps and leaves other brackets", () => {
    expect(marked("A [1] and [23], not [x] or [1234].")).toEqual([{ t: "A " }, { t: "[1]", anchor: "ref1" }, { t: " and " }, { t: "[23]", anchor: "ref23" }, { t: ", not [x] or [1234]." }]);
    expect(marked("")).toEqual([]);
    expect(marked("no marks")).toEqual([{ t: "no marks" }]);
  });
  it("referenceRuns makes italics from the markers and links from addresses, and keeps trailing punctuation out of a link", () => {
    expect(referenceRuns("Rao, A. (2020). T. \u0001J Med\u0002. https://doi.org/10.1/x")).toEqual([{ t: "Rao, A. (2020). T. " }, { t: "J Med", i: true }, { t: ". " }, { t: "https://doi.org/10.1/x", link: "https://doi.org/10.1/x" }]);
    expect(referenceRuns("See https://a.org/p).")).toEqual([{ t: "See " }, { t: "https://a.org/p", link: "https://a.org/p" }, { t: ")." }]);
    expect(referenceRuns("")).toEqual([]);
  });
});

describe("the file name", () => {
  it("ends in .docx and is made of letters and digits", () => expect(reviewFileName("Air pollution & asthma!", "docx", new Date("2026-10-29T00:00:00Z"))).toBe("literature-review-air-pollution-asthma-2026-10-29.docx"));
});
