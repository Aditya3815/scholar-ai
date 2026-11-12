// What does the Reference Verifier say about the references of real PDFs? The browser's own extraction (pdf.js text -> lines -> analyzePaper) and then the real verifier, against the live
// services (Crossref, OpenAlex, doi.org), one line per reference that is not verified. This is the check the eval cannot be: its references are clean records written in five formats; these are
// what a PDF really gives (broken words, wrapped DOIs, Springer-style "Authors: Title", shortened titles, years that differ by an issue).
//   node scripts/archive/refs-live.mjs <folder or file.pdf> [--limit=60] [--out=results.json] [--cache=<folder>] [--all]
// --limit   references checked per paper (the first N; default 60)
// --out     every result as JSON (paper, number, text, status, reason, matched record, checks), for comparing two runs
// --cache   keeps every GET answer by URL in this folder, so a second run asks the services only what it asks newly, and two runs (before and after a change) see the same world
// --all     also lists the verified ones
// Keys come from apps/api/.dev.vars (CROSSREF_MAILTO, OPENALEX_API_KEY). Nothing is sent anywhere but those services; the PDFs stay on this machine.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split("=").slice(1).join("=");
const target = args.find((a) => !a.startsWith("--"));
if (!target) throw new Error("usage: node scripts/archive/refs-live.mjs <folder or file.pdf> [--limit=60] [--out=results.json] [--cache=<folder>] [--all]");
const limit = Number(flag("limit", "60")) || 0;
const out = flag("out", "");
const cacheDir = flag("cache", "");
const showAll = args.includes("--all");

const tmp = mkdtempSync(join(tmpdir(), "refs-live-"));
await build({ entryPoints: [join(root, "packages/shared/src/index.ts")], bundle: true, format: "esm", platform: "node", outfile: join(tmp, "shared.mjs"), logLevel: "silent" });
await build({ entryPoints: [join(root, "apps/api/src/references/verify.ts")], bundle: true, format: "esm", platform: "node", outfile: join(tmp, "verify.mjs"), logLevel: "silent" });
const shared = await import(pathToFileURL(join(tmp, "shared.mjs")).href);
const { verifyReference } = await import(pathToFileURL(join(tmp, "verify.mjs")).href);
const pdfjs = await import(pathToFileURL(join(root, "node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href);

const vars = {};
try {
  for (const line of readFileSync(join(root, "apps/api/.dev.vars"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) vars[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
} catch {
  /* no .dev.vars: the services also answer, more slowly, without a key */
}
vars.CROSSREF_MAILTO ??= process.env.CROSSREF_MAILTO ?? "refs-live@example.org";
vars.OPENALEX_API_KEY ??= process.env.OPENALEX_API_KEY;

let hits = 0;
let misses = 0;
const keyless = (u) => u.replace(/([?&])(api_key|mailto)=[^&]*/g, "$1");
/** The services' answers kept on disk by URL (without the key or the address). Only 200 and 404 are kept: any other answer is a hiccup, not a fact. */
const cachedFetch = async (url, init) => {
  const u = String(url);
  const file = cacheDir ? join(cacheDir, `${createHash("sha1").update(keyless(u)).digest("hex")}.json`) : "";
  if (file && existsSync(file)) {
    const c = JSON.parse(readFileSync(file, "utf8"));
    hits++;
    return new Response(c.body, { status: c.status, headers: { "content-type": "application/json" } });
  }
  misses++;
  const res = await fetch(url, init);
  if (file && (res.status === 200 || res.status === 404)) writeFileSync(file, JSON.stringify({ url: keyless(u), status: res.status, body: await res.clone().text() }));
  return res;
};
if (cacheDir) mkdirSync(cacheDir, { recursive: true });
const env = { CROSSREF_MAILTO: vars.CROSSREF_MAILTO, OPENALEX_API_KEY: vars.OPENALEX_API_KEY, fetch: cachedFetch };

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

const files = statSync(target).isDirectory() ? readdirSync(target).filter((f) => f.toLowerCase().endsWith(".pdf")).sort().map((f) => join(target, f)) : [target];
const rows = [];
for (const f of files) {
  const { lines, pages } = await read(f);
  let refs = shared.analyzePaper({ lines, pages }).references;
  if (limit) refs = refs.slice(0, limit);
  let next = 0;
  // three at a time, as the References tab does; Crossref's own limit is three a second
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= refs.length) return;
      let r;
      try {
        r = await verifyReference(refs[i], env);
      } catch (e) {
        r = { status: "threw", reason: String(e), match: null, checks: null };
      }
      rows.push({ paper: basename(f), n: i + 1, text: refs[i], status: r.status, reason: r.reason, match: r.match, checks: r.checks });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  const mine = rows.filter((r) => r.paper === basename(f));
  console.log(`${basename(f).padEnd(40)} ${String(refs.length).padStart(3)} references  verified ${mine.filter((r) => r.status === "verified").length}`);
}
rows.sort((a, b) => a.paper.localeCompare(b.paper) || a.n - b.n);
if (out) writeFileSync(out, JSON.stringify(rows, null, 1));

for (const r of rows) {
  if (r.status === "verified" && !showAll) continue;
  console.log(`\n[${r.paper} #${r.n}] ${r.status}\n  ${r.text.slice(0, 260)}`);
  console.log(r.match ? `  record: "${r.match.title.slice(0, 90)}" ${r.match.authors[0] ?? "-"} ${r.match.year ?? ""}  checks ${JSON.stringify(r.checks)}` : `  ${String(r.reason).slice(0, 140)}`);
}
const by = {};
for (const r of rows) by[r.status] = (by[r.status] ?? 0) + 1;
console.log(`\n${rows.length} references from ${files.length} paper(s):`, by, cacheDir ? `(cache: ${hits} answered from disk, ${misses} asked of the services)` : "");
process.exit(0);
