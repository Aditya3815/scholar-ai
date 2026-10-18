// Copies the pdf.js data files the browser fetches on demand (WASM image decoders, CJK character maps, the standard fonts used
// by PDFs that do not embed theirs) into public/pdfjs, so they are served from our own origin (the CSP allows nothing else).
// Runs before dev and build; the target folder is git-ignored.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const from = dirname(require.resolve("pdfjs-dist/package.json"));
const to = join(fileURLToPath(new URL("../public/pdfjs", import.meta.url)));
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
for (const dir of ["wasm", "cmaps", "standard_fonts"]) cpSync(join(from, dir), join(to, dir), { recursive: true });
console.log("pdf.js data files copied to public/pdfjs");
