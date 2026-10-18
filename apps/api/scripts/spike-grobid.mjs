// R1 spike: does GROBID turn scholarly PDFs into usable structure (title, authors, abstract, sections, references)?
//   docker run -d --name grobid -p 8070:8070 --init --ulimit core=0 grobid/grobid:0.9.1-crf
//   node scripts/spike-grobid.mjs <dir with *.pdf and optional same-name *.txt from pdftotext> [outDir]
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const dir = process.argv[2];
const out = process.argv[3] ?? join(dir, "grobid-out");
const BASE = process.env.GROBID ?? "http://localhost:8070";
if (!dir) throw new Error("usage: node scripts/spike-grobid.mjs <pdf dir> [outDir]");
mkdirSync(out, { recursive: true });

const strip = (s) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/\s+/g, " ").trim();
const first = (xml, re) => { const m = xml.match(re); return m ? strip(m[1]) : ""; };

function measure(tei, txt) {
  const header = tei.split(/<text[ >]/)[0];
  const body = (tei.match(/<body>([\s\S]*?)<\/body>/) ?? [])[1] ?? "";
  const back = tei.split("<back>")[1] ?? "";
  const refs = back.match(/<biblStruct[\s\S]*?<\/biblStruct>/g) ?? [];
  const heads = [...body.matchAll(/<head[^>]*>([\s\S]*?)<\/head>/g)].map((m) => strip(m[1]));
  const bodyText = strip(body);
  return {
    title: first(header, /<titleStmt>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/),
    authors: (header.match(/<author>[\s\S]*?<\/author>/g) ?? []).map((a) => strip((a.match(/<persName>([\s\S]*?)<\/persName>/) ?? [])[1] ?? "")).filter(Boolean),
    abstractChars: first(header, /<abstract>([\s\S]*?)<\/abstract>/).length,
    sections: heads.length,
    sampleHeads: heads.slice(0, 8),
    bodyChars: bodyText.length,
    bodyVsPdftotext: txt ? +(bodyText.length / txt.length).toFixed(2) : null,
    refs: refs.length,
    refsWithTitle: refs.filter((r) => /<title[^>]*level="a"|<title[^>]*level="m"/.test(r)).length,
    refsWithDoi: refs.filter((r) => /<idno type="DOI"/.test(r)).length,
    refsWithYear: refs.filter((r) => /<date[^>]*when=/.test(r)).length,
    sampleRef: refs[0] ? strip(refs[0]).slice(0, 160) : "",
  };
}

const rows = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith(".pdf")).sort()) {
  const name = basename(f, ".pdf");
  const form = new FormData();
  form.append("input", new Blob([readFileSync(join(dir, f))], { type: "application/pdf" }), f);
  form.append("consolidateCitations", "0"); // 0 = no calls to Crossref/biblio-glutton; we verify references ourselves
  form.append("teiCoordinates", "ref");
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/processFulltextDocument`, { method: "POST", body: form });
  const ms = Date.now() - t0;
  if (!res.ok) { rows.push({ name, ms, error: `HTTP ${res.status}` }); continue; }
  const tei = await res.text();
  writeFileSync(join(out, `${name}.tei.xml`), tei);
  const txtPath = join(dir, `${name}.txt`);
  rows.push({ name, ms, ...measure(tei, existsSync(txtPath) ? readFileSync(txtPath, "utf8") : "") });
}
writeFileSync(join(out, "summary.json"), JSON.stringify(rows, null, 2));
for (const r of rows) console.log(JSON.stringify(r, null, 1));
