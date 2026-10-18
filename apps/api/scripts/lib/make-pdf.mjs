// A tiny but valid PDF writer for tests: one Helvetica text block per page, correct xref table, no dependencies.
// Real enough for pdf.js (text extraction, rendering) and for our own magic-byte check.

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

/** pages: array of strings; each string is wrapped into lines of at most `width` characters. */
export function makePdf(pages, { width = 80, title = "Test paper" } = {}) {
  const objs = []; // objs[i] = body of object i+1
  const add = (body) => objs.push(body) && objs.length;
  const catalog = add(""); // 1, filled below
  const pagesObj = add(""); // 2
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const info = add(`<< /Title (${esc(title)}) /Producer (scholar test writer) >>`);
  const kids = [];
  for (const text of pages) {
    const lines = [];
    for (const para of String(text).split("\n")) {
      let line = "";
      for (const w of para.split(/\s+/)) {
        if ((line + " " + w).trim().length > width) { lines.push(line.trim()); line = w; } else line = (line + " " + w).trim();
      }
      lines.push(line);
    }
    const stream = ["BT", "/F1 11 Tf", "14 TL", "56 780 Td", ...lines.map((l) => `(${esc(l)}) Tj T*`), "ET"].join("\n");
    const content = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** The same text a PDF reader would extract, page by page, for feeding the indexing endpoint in tests. */
export const SAMPLE_PAPER = [
  "Glaucoma Screening with Deep Learning in Rural Clinics\nAbstract. We study automated glaucoma screening from retinal photographs captured on low-cost devices. A convolutional network trained on 12,000 images reaches an AUC of 0.94.",
  "Methods. Participants were recruited from three hospitals in Pune between 2019 and 2021. Follow-up lasted twelve months. Images were graded by two ophthalmologists and disagreements were resolved by a third.",
  "Results. The model reached a sensitivity of 91 percent at a specificity of 88 percent. Performance was lower for images with cataract. Limitations include a single country and a small number of cases of angle closure.",
];
