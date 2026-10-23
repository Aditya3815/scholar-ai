// Test fixtures for scanned papers: page pictures (JPEG) and a PDF made only of page pictures (no text layer), like a scanner produces.
import sharp from "sharp";

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/**
 * A JPEG that looks like a scanned page: off-white paper, a few lines of dark text, a little grain. `blank` = an empty sheet (no text, no marks).
 * `comment` goes into the JPEG's comment segment, which the offline reader (src/ocr/stub.ts) understands. Size defaults to what the browser sends (150 dpi A4).
 */
export async function makePageJpeg({ width = 1240, height = 1754, lines = [], blank = false, comment = null, quality = 80 } = {}) {
  const text = lines
    .map((l, i) => `<text x="110" y="${160 + i * 46}" font-family="Georgia, serif" font-size="30" fill="#1a1a1a">${esc(l)}</text>`)
    .join("");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${blank ? "" : text}</svg>`);
  let img = sharp({ create: { width, height, channels: 3, background: blank ? "#ffffff" : "#f4efe3" } }).composite([{ input: svg }]);
  let buf = await img.jpeg({ quality }).toBuffer();
  if (comment) {
    const t = Buffer.from(comment, "utf8");
    const seg = Buffer.concat([Buffer.from([0xff, 0xfe, (t.length + 2) >> 8, (t.length + 2) & 0xff]), t]);
    buf = Buffer.concat([buf.subarray(0, 2), seg, buf.subarray(2)]);
  }
  return buf;
}

/** A PDF whose every page is one picture (JPEG, DCTDecode) of the given pixel size, at 150 dpi. No text layer anywhere. */
export function makeScanPdf(jpegs, { title = "Scanned report", dpi = 150 } = {}) {
  const parts = [];
  let length = 0;
  const offsets = [];
  const push = (b) => {
    const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, "latin1");
    parts.push(buf);
    length += buf.length;
  };
  const obj = (n, body) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    push(body);
    push("\nendobj\n");
  };
  const sizeOf = (jpeg) => {
    let i = 2;
    while (i < jpeg.length) {
      const m = jpeg[i + 1];
      const len = (jpeg[i + 2] << 8) | jpeg[i + 3];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (jpeg[i + 5] << 8) | jpeg[i + 6], w: (jpeg[i + 7] << 8) | jpeg[i + 8], comps: jpeg[i + 9] };
      i += 2 + len;
    }
    throw new Error("not a JPEG");
  };
  push("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n");
  // objects: 1 catalog, 2 pages, 3 info, then per page: image, content, page
  const kids = jpegs.map((_, i) => 4 + i * 3 + 2);
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${jpegs.length} >>`);
  obj(3, `<< /Title (${title.replace(/[()\\]/g, "")}) /Producer (scholar test scanner) >>`);
  jpegs.forEach((jpeg, i) => {
    const { w, h, comps } = sizeOf(jpeg);
    const pw = ((w * 72) / dpi).toFixed(2);
    const ph = ((h * 72) / dpi).toFixed(2);
    const img = 4 + i * 3;
    offsets[img] = length;
    push(`${img} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace ${comps === 1 ? "/DeviceGray" : "/DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    push("\nendstream\nendobj\n");
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    obj(img + 1, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    obj(img + 2, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${img + 1} 0 R >>`);
  });
  const count = 4 + jpegs.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.concat(parts);
}
