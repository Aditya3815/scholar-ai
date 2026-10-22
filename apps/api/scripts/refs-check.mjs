// How many references does the browser-side extraction find in a real PDF, and how does that compare with what the PDF itself shows?
//   node scripts/refs-check.mjs <folder or file.pdf> [--dump <folder>]
// Runs the same code the browser runs (pdf.js text items -> lines -> analyzePaper from packages/shared), in Node, so it can be iterated on without a Worker.
// For each paper it prints the number of references found, the highest reference number printed in the list ("expected", for numbered styles) and entries that look wrong
// (very long = probably two merged; very short = probably a piece). --dump writes the reference block text and the entries to a folder for reading.
import { build } from "esbuild";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const args = process.argv.slice(2);
const dump = args.includes("--dump") ? args[args.indexOf("--dump") + 1] : null;
const target = args.find((a) => !a.startsWith("--") && a !== dump);
if (!target) throw new Error("usage: node scripts/refs-check.mjs <folder or file.pdf> [--dump <folder>]");

// bundle the shared package (TypeScript) once, to a temporary module
const tmp = mkdtempSync(join(tmpdir(), "refs-check-"));
await build({ entryPoints: [join(root, "packages/shared/src/index.ts")], bundle: true, format: "esm", platform: "node", outfile: join(tmp, "shared.mjs"), logLevel: "silent" });
const shared = await import(pathToFileURL(join(tmp, "shared.mjs")).href);
const pdfjs = await import(pathToFileURL(join(root, "node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href);

async function read(file) {
  const data = new Uint8Array(readFileSync(file));
  const pdf = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true, standardFontDataUrl: pathToFileURL(join(root, "node_modules/pdfjs-dist/standard_fonts/")).href }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const content = await (await pdf.getPage(p)).getTextContent();
    lines.push(...shared.groupLines(shared.rawItems(content.items), p));
  }
  return { lines, pages: pdf.numPages };
}

/** The highest number printed at the start of an entry in the list: [12], 12. or (12). */
function expectedCount(block) {
  let max = 0;
  for (const l of block) {
    const m = /^\s*(?:\[\s*(\d{1,3})\s*\]|\(\s*(\d{1,3})\s*\)|(\d{1,3})\s*[.)])\s+\S/.exec(l.text);
    const n = Number(m?.[1] ?? m?.[2] ?? m?.[3] ?? 0);
    if (n > max && n < 500) max = n;
  }
  return max;
}

const files = statSync(target).isDirectory() ? readdirSync(target).filter((f) => f.toLowerCase().endsWith(".pdf")).sort().map((f) => join(target, f)) : [target];
if (dump) mkdirSync(dump, { recursive: true });
let bad = 0;
for (const f of files) {
  const { lines, pages } = await read(f);
  const info = shared.analyzePaper({ lines, pages });
  const stripped = shared.stripRunningHeads(lines, pages);
  const block = shared.referenceLines(stripped, shared.bodySize(stripped));
  const exp = expectedCount(block);
  const refs = info.references;
  const long = refs.filter((r) => r.length > 450).length;
  const short = refs.filter((r) => r.length < 40).length;
  const flag = exp && refs.length < exp ? "  <-- FEWER than printed" : exp && refs.length > exp + 2 ? "  <-- MORE than printed" : "";
  if (flag) bad++;
  console.log(`${basename(f).padEnd(36)} pages ${String(pages).padStart(3)}  lines ${String(lines.length).padStart(5)}  refblock ${String(block.length).padStart(4)} lines  found ${String(refs.length).padStart(3)}  printed up to ${String(exp || "?").padStart(3)}  long ${long} short ${short}${flag}`);
  if (dump) {
    writeFileSync(join(dump, basename(f, ".pdf") + ".block.txt"), block.map((l) => `p${l.page} x=${l.x} s=${l.size}  ${l.text}`).join("\n"));
    writeFileSync(join(dump, basename(f, ".pdf") + ".refs.txt"), refs.map((r, i) => `${String(i + 1).padStart(3)}. ${r}`).join("\n"));
  }
}
console.log(bad ? `\n${bad} paper(s) with a reference count that disagrees with the list` : "\nevery count agrees with what the list prints");
process.exit(0);
