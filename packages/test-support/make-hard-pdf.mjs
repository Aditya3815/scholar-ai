// A one-page, two-column "paper" made the way TeX makes them, for the tests of highlights and of the passages an answer cites (docs/design/paper-reader.md):
// ligature glyphs (fi, fl, ff), a word hyphenated across two lines, a TeX accent drawn as a glyph of its own (the circumflex over z, the dieresis over a dotless i),
// sub- and superscripts in a smaller font (r1, rK, z^(k-1), l-script k), Greek and a minus from the Symbol font, and a figure caption in the right column.
// Every piece of a line in another font or size is a text item of its own for pdf.js, so the text layer has the many small spans a real arXiv paper has.
// The words are our own (no published paper is copied). No dependencies: the same small writer as make-pdf.mjs.

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** Codes of the glyphs that WinAnsi does not have, given names through /Differences (pdf.js maps the names to Unicode: fi U+FB01, circumflex U+02C6, afii61289 U+2113 ...). */
const G = { fi: "\x01", fl: "\x02", ff: "\x03", circumflex: "\x04", dieresis: "\x05", dotlessi: "\x06", lscript: "\x07" };
const DIFF = "[1 /fi /fl /ff /circumflex /dieresis /dotlessi /afii61289]";

/** One piece of a line: text in a font (R roman, I italic, S Symbol), at a size, raised by `rise` points; `back` moves the pen back (in thousandths of the size) after it, as TeX does for an accent. */
const r = (t, o = {}) => ({ t, f: "R", ...o });
const i = (t, o = {}) => ({ t, f: "I", ...o });
const sub = (t, f = "I") => ({ t, f, size: 6.5, rise: -2 });
const sup = (t, f = "I") => ({ t, f, size: 6.5, rise: 3.6 });
const S = (t, o = {}) => ({ t, f: "S", ...o });

/** The left column: a paragraph with ligatures, a hyphenated word and a TeX dieresis. */
export const HARD_LEFT = [
  [r("1 Introduction", { size: 11 })],
  [r(`We study how a model ${G.fi}nds structure in long documents. A`)],
  [r(`learned code book gives a compact repre-`)],
  [r(`sentation of each passage, and the ${G.fl}ow of`)],
  [r(`information between levels is made explicit. The e${G.ff}ect`)],
  [r(`of a coarse level on a ${G.fi}ner one is easy to read. Unlike a`)],
  [r(`na`), r(G.dieresis, { back: 280 }), r(`${G.dotlessi}ve baseline, the model keeps every level.`)],
  [r(`We train with a single objective and report results`)],
  [r(`on three benchmarks of long scienti${G.fi}c text.`)],
];

/** The right column: a figure caption with math, the hard case of the owner's report. */
export const HARD_RIGHT = [
  [r("Figure 4:", { bold: true }), r(" Two-stage training. (a) A multiscale residual")],
  [r("quantiser encodes the input into codes "), i("r"), sub("1"), r(", "), S("\xbc"), r(", "), i("r"), sub("K")],
  [r("and reconstructs it. (b) The transformer predicts every")],
  [r("code of level "), i("k"), r(" at once from the cumulative reconstruction")],
  [r(G.circumflex, { rise: 1.5, back: 300 }), i("z"), sup("("), sup("k"), sup("\x2d", "S"), sup("1", "R"), sup(")", "R"), r(", resized to "), i(G.lscript), sub("k"), r(" positions. Block-diagonal attention")],
  [r("con"), r(`${G.fi}nes each block to itself, and the loss is a sum over`)],
  [r("levels weighted by "), S("a"), sub("k", "I"), r(" with "), S("a"), sub("k", "I"), r(" > 0.")],
];

/** The text of the caption as a person reads it (what a highlight of the whole caption holds, give or take the glyphs). */
export const HARD_CAPTION =
  "Figure 4: Two-stage training. (a) A multiscale residual quantiser encodes the input into codes r1, …, rK and reconstructs it. (b) The transformer predicts every code of level k at once from the cumulative reconstruction ˆz(k−1), resized to ℓk positions. Block-diagonal attention confines each block to itself, and the loss is a sum over levels weighted by αk with αk > 0.";

const FONTS = { R: "/F1", I: "/F2", S: "/F3", B: "/F4" };

function lineOps(pieces, x, y) {
  const ops = [`1 0 0 1 ${x} ${y.toFixed(1)} Tm`];
  for (const p of pieces) {
    const size = p.size ?? 9;
    ops.push(`${p.bold ? FONTS.B : FONTS[p.f]} ${size} Tf`, `${p.rise ?? 0} Ts`);
    ops.push(p.back ? `[(${esc(p.t)}) ${p.back}] TJ` : `(${esc(p.t)}) Tj`);
  }
  ops.push("0 Ts");
  return ops;
}

/** The PDF: page 1 has the two columns, page 2 a plain paragraph (so a jump has somewhere to come from). */
export function makeHardPdf({ title = "Two-stage training of a multiscale model" } = {}) {
  const objs = [];
  const add = (body) => objs.push(body) && objs.length;
  const catalog = add("");
  const pagesObj = add("");
  const enc = (base) => `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding << /Type /Encoding /BaseEncoding /WinAnsiEncoding /Differences ${DIFF} >> >>`;
  const f1 = add(enc("Times-Roman"));
  const f2 = add(enc("Times-Italic"));
  const f3 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>");
  const f4 = add(enc("Times-Bold"));
  const info = add(`<< /Title (${esc(title)}) /Producer (scholar test writer) >>`);
  const res = `<< /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R /F4 ${f4} 0 R >> >>`;
  const page1 = ["BT", "/F4 15 Tf", "1 0 0 1 56 790 Tm", `(${esc(title)}) Tj`];
  HARD_LEFT.forEach((l, k) => page1.push(...lineOps(l, 56, 750 - k * 13)));
  HARD_RIGHT.forEach((l, k) => page1.push(...lineOps(l, 310, 750 - k * 13)));
  page1.push("ET");
  const page2 = ["BT", "/F1 10 Tf", "14 TL", "56 780 Td", "(2 Method) Tj T*", "(The second page holds the method, so that a jump to page one comes from somewhere else.) Tj T*", "ET"];
  const kids = [];
  for (const ops of [page1, page2]) {
    const stream = ops.join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources ${res} /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets = [];
  objs.forEach((body, n) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${n + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
