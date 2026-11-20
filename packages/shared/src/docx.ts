/**
 * A small Word (.docx) writer (docs/design/docx-export.md). A .docx is a zip of XML parts; this module makes the parts as strings and knows nothing about zip, so it is pure and
 * tested without a browser (the page zips them with fflate, which it already has). Only what a literature review needs: a title, headings, paragraphs with italic, bold, superscript,
 * links and jumps to a bookmark, bulleted and numbered lists, a table with a repeating header row, and a note in a box. Everything the person's text can contain is escaped, and
 * characters that XML cannot hold are taken out, because one of them makes Word say the file is unreadable.
 *
 * The order of the children of every element follows the schema (Word is strict about it, a viewer is not).
 */

export type DocRun = {
  t: string;
  i?: boolean;
  b?: boolean;
  /** underlined (a note's ++underline++) */
  u?: boolean;
  sup?: boolean;
  /** An address outside the document: only http(s) and mailto are linked, anything else is written as text. */
  link?: string;
  /** A bookmark in this document to jump to. */
  anchor?: string;
};

/**
 * A picture floating in front of a paragraph's text without moving it (ink on the pages of notes, docs/design/paper-reader.md, 25.8): anchored to the paragraph (it moves with it), `x` from
 * the column's left edge and `y` from the paragraph's top, its size `w` by `h`, all in points (`y` may be negative: ink above the first line). `media` is its PNG's name in word/media.
 */
export type DocFloat = { media: string; x: number; y: number; w: number; h: number; alt: string };

export type Block =
  | { k: "title"; runs: DocRun[] }
  | { k: "h1" | "h2" | "h3"; runs: DocRun[]; bookmark?: string; floats?: DocFloat[] }
  | { k: "p"; runs: DocRun[]; bookmark?: string; floats?: DocFloat[] }
  /** A paragraph that stands out (a caution): shaded, with a bar at its left edge. */
  | { k: "note"; runs: DocRun[]; floats?: DocFloat[] }
  | { k: "bullet"; runs: DocRun[]; floats?: DocFloat[] }
  /** A numbered paragraph of a list that keeps its own numbers (the references): the number is written, so it matches the marks in the text. */
  | { k: "ref"; no: number; runs: DocRun[]; bookmark?: string; floats?: DocFloat[] }
  /** Blank room `h` points high (a space block of the notes, 25), holding its drawing. */
  | { k: "space"; h: number; floats?: DocFloat[] }
  | { k: "table"; widths: number[]; head: string[]; rows: DocRun[][][] }
  /**
   * A picture on a line of its own (the Notebook's captures and sketches): `media` is its file's name in the zip's word/media folder ("image1.png"), which the caller adds, as this module
   * makes text only; `w` and `h` its size in CSS pixels (made smaller to fit the page's width), `alt` what it shows.
   */
  | { k: "image"; media: string; w: number; h: number; alt: string; /** shown at this fraction of the text's width (a picture the reader made narrower) */ frac?: number; floats?: DocFloat[] };

export type DocxDoc = {
  title: string;
  author: string;
  /** Written in the file's properties. */
  created: Date;
  /** The language of the text, for spell checking (BCP 47: en-IN, hi-IN). */
  lang?: string;
  blocks: Block[];
  /**
   * The notes have ink on them (25.8): the text is Arial (Helvetica's widths, which the page's line-breaker knows, so its predicted lines are Word's), its lines exactly 1.4 times the size,
   * and its width the PDF's (56 pt margins), so that a paragraph's drawing lands where it was drawn.
   */
  ink?: boolean;
};

/** What Word sees as the first line of a file: the parts of the zip, by path. */
export type DocxParts = Record<string, string>;

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Characters XML 1.0 cannot hold (controls except tab, line feed and carriage return; U+FFFE and U+FFFF; a lone surrogate) are dropped. */
export function xmlSafe(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x9 || c === 0xa || c === 0xd || (c >= 0x20 && c <= 0xd7ff) || (c >= 0xe000 && c <= 0xfffd)) out += s[i];
    else if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        out += s[i]! + s[i + 1]!;
        i++;
      }
    }
  }
  return out;
}

export const xmlEscape = (s: string): string => xmlSafe(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Only a web address (or a mail address) is made a link: `javascript:` and the like stay text. */
export function safeLink(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** A bookmark name Word accepts: starts with a letter, letters digits and underscores only, at most 40 characters. */
export const bookmarkName = (raw: string): string => `b${raw.replace(/[^A-Za-z0-9_]/g, "_")}`.slice(0, 40);

const BODY_FONT = "Calibri";
const COMPLEX_FONT = "Nirmala UI"; // Hindi and other Indian scripts in Word

/* ---------------------------------------------------------------- runs */

type Ctx = { links: string[]; bookmarkId: number; images: string[]; ink: boolean; layer: number };

function runXml(r: DocRun, ctx: Ctx): string {
  const text = xmlSafe(r.t);
  if (text === "") return "";
  // properties in schema order: rStyle, rFonts, b, i, color, sz, u, vertAlign
  const props = [
    r.b ? "<w:b/><w:bCs/>" : "",
    r.i ? "<w:i/><w:iCs/>" : "",
    safeLink(r.link) || r.anchor ? '<w:color w:val="1F4E8C"/><w:u w:val="single"/>' : r.u ? '<w:u w:val="single"/>' : "",
    r.sup ? '<w:vertAlign w:val="superscript"/>' : "",
  ].join("");
  const parts = text.split(/\r\n|\r|\n/);
  const body = parts.map((p, i) => `${i > 0 ? "<w:br/>" : ""}${p === "" ? "" : `<w:t xml:space="preserve">${xmlEscape(p)}</w:t>`}`).join("");
  const run = `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}${body}</w:r>`;
  const link = safeLink(r.link);
  if (link) {
    let i = ctx.links.indexOf(link);
    if (i < 0) i = ctx.links.push(link) - 1;
    return `<w:hyperlink r:id="rIdL${i + 1}" w:history="1">${run}</w:hyperlink>`;
  }
  if (r.anchor) return `<w:hyperlink w:anchor="${xmlEscape(bookmarkName(r.anchor))}" w:history="1">${run}</w:hyperlink>`;
  return run;
}

const runsXml = (runs: DocRun[], ctx: Ctx) => runs.map((r) => runXml(r, ctx)).join("");

function withBookmark(inner: string, name: string | undefined, ctx: Ctx): string {
  if (!name) return inner;
  const id = ctx.bookmarkId++;
  return `<w:bookmarkStart w:id="${id}" w:name="${xmlEscape(bookmarkName(name))}"/>${inner}<w:bookmarkEnd w:id="${id}"/>`;
}

/* ---------------------------------------------------------------- blocks */

const para = (style: string | null, inner: string, extra = "") => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${extra}</w:pPr>${inner}</w:p>`;

/** EMU in a point. */
const PT = 12700;
const emu = (pt: number) => Math.round(pt * PT);

/** A float (25.8): wp:anchor with its children in the schema's order, relative to the column and the paragraph, no wrapping, in front of the text; each one later is on top. */
function floatXml(f: DocFloat, ctx: Ctx): string {
  if (!MEDIA.test(f.media) || !(f.w > 0) || !(f.h > 0) || ![f.x, f.y].every(Number.isFinite)) return "";
  let i = ctx.images.indexOf(f.media);
  if (i < 0) i = ctx.images.push(f.media) - 1;
  const id = 1000 + ctx.bookmarkId++;
  const cx = emu(f.w);
  const cy = emu(f.h);
  const alt = xmlEscape(f.alt);
  return (
    `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${251660000 + ctx.layer++}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">` +
    '<wp:simplePos x="0" y="0"/>' +
    `<wp:positionH relativeFrom="column"><wp:posOffset>${emu(f.x)}</wp:posOffset></wp:positionH>` +
    `<wp:positionV relativeFrom="paragraph"><wp:posOffset>${emu(f.y)}</wp:posOffset></wp:positionV>` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>` +
    `<wp:docPr id="${id}" name="Drawing ${id}" descr="${alt}"/><wp:cNvGraphicFramePr/>` +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${f.media}" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="rIdI${i + 1}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    "</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>"
  );
}
const floatsXml = (b: { floats?: DocFloat[] }, ctx: Ctx) => (b.floats ?? []).map((f) => floatXml(f, ctx)).join("");
/** With ink, a paragraph's lines are exactly 1.4 times its size (in twentieths of a point), as the PDF's and the page's prediction of Word's are. */
const exact = (ctx: Ctx, size: number) => (ctx.ink ? `<w:spacing w:line="${Math.round(size * 1.4 * 20)}" w:lineRule="exact"/>` : "");

function tableXml(b: Extract<Block, { k: "table" }>, ctx: Ctx): string {
  const total = b.widths.reduce((a, c) => a + c, 0) || 1;
  const widths = b.widths.map((w) => Math.max(400, Math.round((w / total) * 9638))); // A4 text width: 9638 twentieths of a point
  const cell = (w: number, inner: string, head: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="E8EEF6"/>' : ""}</w:tcPr>${inner}</w:tc>`;
  const headRow = `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${b.head.map((h, i) => cell(widths[i] ?? 1000, para("TableText", runXml({ t: h, b: true }, ctx)), true)).join("")}</w:tr>`;
  const rows = b.rows
    .map((r) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${b.head.map((_, i) => cell(widths[i] ?? 1000, para("TableText", runsXml(r[i] ?? [], ctx)), false)).join("")}</w:tr>`)
    .join("");
  return (
    `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="${widths.reduce((a, c) => a + c, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
    '<w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>' +
    `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${headRow}${rows}</w:tbl>${para(null, "")}`
  );
}

function blockXml(b: Block, ctx: Ctx): string {
  switch (b.k) {
    case "title":
      return para("Title", runsXml(b.runs, ctx));
    case "h1":
    case "h2":
    case "h3":
      return para(b.k === "h1" ? "Heading1" : b.k === "h2" ? "Heading2" : "Heading3", floatsXml(b, ctx) + withBookmark(runsXml(b.runs, ctx), b.bookmark, ctx), b.k === "h1" ? "" : exact(ctx, b.k === "h2" ? 13 : 11.5));
    case "p":
      return para(null, floatsXml(b, ctx) + withBookmark(runsXml(b.runs, ctx), b.bookmark, ctx), exact(ctx, 11));
    case "note":
      return para("Note", floatsXml(b, ctx) + runsXml(b.runs, ctx), exact(ctx, 10));
    case "bullet":
      return para("ListBullet", floatsXml(b, ctx) + runsXml(b.runs, ctx), `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>${exact(ctx, 11)}`);
    case "ref":
      return para("Reference", floatsXml(b, ctx) + withBookmark(`${runXml({ t: `${b.no}.`, b: true }, ctx)}<w:r><w:tab/></w:r>${runsXml(b.runs, ctx)}`, b.bookmark, ctx), exact(ctx, 11));
    case "space":
      // the room is the line's own exact height (Word holds at most 1,584 pt a line)
      return para(null, floatsXml(b, ctx), `<w:spacing w:before="0" w:after="0" w:line="${Math.max(20, Math.min(31_680, Math.round(b.h * 20)))}" w:lineRule="exact"/>`);
    case "table":
      return tableXml(b, ctx);
    case "image":
      return imageXml(b, ctx);
  }
}

/** The page's text width, in EMU (A4 less its margins: 9638 twentieths of a point); a CSS pixel is 9525 EMU. */
const TEXT_WIDTH_EMU = Math.round((9638 / 1440) * 914400);
const MEDIA = /^[A-Za-z0-9_-]{1,40}\.png$/;

function imageXml(b: Extract<Block, { k: "image" }>, ctx: Ctx): string {
  if (!MEDIA.test(b.media) || !(b.w > 0) || !(b.h > 0)) return "";
  let i = ctx.images.indexOf(b.media);
  if (i < 0) i = ctx.images.push(b.media) - 1;
  const frac = b.frac !== undefined && b.frac > 0 && b.frac < 1 ? b.frac : null;
  const scale = frac ? (TEXT_WIDTH_EMU * frac) / (b.w * 9525) : Math.min(1, TEXT_WIDTH_EMU / (b.w * 9525));
  const cx = Math.round(b.w * 9525 * scale);
  const cy = Math.round(b.h * 9525 * scale);
  const id = 1000 + ctx.bookmarkId++;
  const alt = xmlEscape(b.alt);
  return (
    `<w:p><w:pPr><w:keepNext/></w:pPr>${floatsXml(b, ctx)}<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}" descr="${alt}"/>` +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="${b.media}" descr="${alt}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="rIdI${i + 1}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    "</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"
  );
}

/* ---------------------------------------------------------------- parts */

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function stylesXml(lang: string, ink: boolean): string {
  const FONT = ink ? "Arial" : BODY_FONT;
  const style = (id: string, name: string, ppr: string, rpr: string, based = "Normal", next = "Normal") =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="${based}"/><w:next w:val="${next}"/><w:qFormat/>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ""}${rpr ? `<w:rPr>${rpr}</w:rPr>` : ""}</w:style>`;
  return (
    `${XML}<w:styles ${NS}>` +
    `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}" w:cs="${COMPLEX_FONT}"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="${xmlEscape(lang)}" w:eastAsia="en-US" w:bidi="hi-IN"/></w:rPr></w:rPrDefault>` +
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>' +
    style("Title", "Title", '<w:spacing w:before="0" w:after="200"/>', '<w:b/><w:bCs/><w:color w:val="1F3A5F"/><w:sz w:val="44"/><w:szCs w:val="44"/>') +
    style("Heading1", "heading 1", '<w:keepNext/><w:keepLines/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/>', '<w:b/><w:bCs/><w:color w:val="1F3A5F"/><w:sz w:val="32"/><w:szCs w:val="32"/>') +
    style("Heading2", "heading 2", '<w:keepNext/><w:keepLines/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="1"/>', '<w:b/><w:bCs/><w:color w:val="1F3A5F"/><w:sz w:val="26"/><w:szCs w:val="26"/>') +
    style("Heading3", "heading 3", '<w:keepNext/><w:keepLines/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="2"/>', '<w:b/><w:bCs/><w:sz w:val="23"/><w:szCs w:val="23"/>') +
    style("Note", "Note", '<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="9AA7B8"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="F2F5F9"/><w:spacing w:before="120" w:after="200"/><w:ind w:left="200"/>', '<w:i/><w:iCs/><w:color w:val="44546A"/><w:sz w:val="20"/><w:szCs w:val="20"/>') +
    style("ListBullet", "List Bullet", '<w:spacing w:after="60"/><w:ind w:left="720" w:hanging="360"/>', "") +
    style("Reference", "Reference", '<w:tabs><w:tab w:val="left" w:pos="480"/></w:tabs><w:spacing w:after="100"/><w:ind w:left="480" w:hanging="480"/>', "") +
    style("TableText", "Table Text", '<w:spacing w:before="40" w:after="40" w:line="240" w:lineRule="auto"/>', '<w:sz w:val="18"/><w:szCs w:val="18"/>') +
    '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>' +
    '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="B7C0CC"/><w:left w:val="single" w:sz="4" w:space="0" w:color="B7C0CC"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="B7C0CC"/><w:right w:val="single" w:sz="4" w:space="0" w:color="B7C0CC"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="B7C0CC"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="B7C0CC"/></w:tblBorders></w:tblPr></w:style>' +
    "</w:styles>"
  );
}

const NUMBERING =
  `${XML}<w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>` +
  '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

const isoDate = (d: Date) => (Number.isNaN(d.getTime()) ? new Date(0) : d).toISOString().replace(/\.\d{3}Z$/, "Z");

/** The parts of the file, by path in the zip. */
export function buildDocx(doc: DocxDoc): DocxParts {
  const ctx: Ctx = { links: [], bookmarkId: 1, images: [], ink: !!doc.ink, layer: 0 };
  const lang = doc.lang && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(doc.lang) ? doc.lang : "en-IN";
  const body = doc.blocks.map((b) => blockXml(b, ctx)).join("");
  const documentXml =
    `${XML}<w:document ${NS}><w:body>${body || para(null, "")}` +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1304" w:right="${doc.ink ? 1120 : 1134}" w:bottom="1304" w:left="${doc.ink ? 1120 : 1134}" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const rel = (id: string, type: string, target: string, external = false) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${xmlEscape(target)}"${external ? ' TargetMode="External"' : ""}/>`;
  return {
    "[Content_Types].xml":
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>` +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>',
    "_rels/.rels":
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      rel("rId1", "officeDocument", "word/document.xml") +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      rel("rId3", "extended-properties", "docProps/app.xml") +
      "</Relationships>",
    "word/document.xml": documentXml,
    "word/_rels/document.xml.rels":
      `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      rel("rIdS", "styles", "styles.xml") +
      rel("rIdN", "numbering", "numbering.xml") +
      ctx.links.map((u, i) => rel(`rIdL${i + 1}`, "hyperlink", u, true)).join("") +
      ctx.images.map((m, i) => rel(`rIdI${i + 1}`, "image", `media/${m}`)).join("") +
      "</Relationships>",
    "word/styles.xml": stylesXml(lang, !!doc.ink),
    "word/numbering.xml": NUMBERING,
    "docProps/core.xml":
      `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
      `<dc:title>${xmlEscape(doc.title)}</dc:title><dc:creator>${xmlEscape(doc.author)}</dc:creator><cp:lastModifiedBy>${xmlEscape(doc.author)}</cp:lastModifiedBy>` +
      `<dcterms:created xsi:type="dcterms:W3CDTF">${isoDate(doc.created)}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${isoDate(doc.created)}</dcterms:modified></cp:coreProperties>`,
    "docProps/app.xml": `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>${xmlEscape(doc.author)}</Application></Properties>`,
  };
}
