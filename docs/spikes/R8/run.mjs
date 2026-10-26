// Spike R8 runner: downloads each open-access PDF in papers.json (once, into ./pdfs, which is not committed), posts it to the spike Worker and prints a table.
//   npx wrangler dev --port 8799   (in this folder, in another terminal)
//   node run.mjs [--only=name] [--all]
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";

const BASE = process.env.SPIKE ?? "http://localhost:8799";
let papers = JSON.parse(readFileSync(new URL("./papers.json", import.meta.url), "utf8"));
// --all also reads every PDF that fetchability.mjs saved
if (process.argv.includes("--all")) {
  const known = new Set(papers.map((p) => p.name));
  for (const f of readdirSync(new URL("./pdfs/", import.meta.url))) if (f.endsWith(".pdf") && !known.has(f.slice(0, -4))) papers.push({ name: f.slice(0, -4), kind: "from OpenAlex", url: "" });
}
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
mkdirSync(new URL("./pdfs/", import.meta.url), { recursive: true });
const UA = "scholar-ai-spike/1.0 (mailto:tiadiaditya@gmail.com)";

const rows = [];
for (const p of papers) {
  if (only && !p.name.includes(only)) continue;
  const file = new URL(`./pdfs/${p.name}.pdf`, import.meta.url);
  if (!existsSync(file)) {
    const r = await fetch(p.url, { headers: { "User-Agent": UA }, redirect: "follow" });
    const buf = new Uint8Array(await r.arrayBuffer());
    const magic = new TextDecoder().decode(buf.slice(0, 5));
    if (!r.ok || magic !== "%PDF-") { rows.push({ name: p.name, error: `download ${r.status} ${magic}` }); continue; }
    writeFileSync(file, buf);
    await new Promise((res) => setTimeout(res, p.url.includes("arxiv") ? 3200 : 800)); // polite: arXiv asks for one request every three seconds
  }
  const body = readFileSync(file);
  const t0 = Date.now();
  let out;
  try {
    const r = await fetch(`${BASE}/?maxPages=120`, { method: "POST", body });
    out = await r.json();
  } catch (e) {
    out = { ok: false, error: String(e.message ?? e) };
  }
  rows.push({ name: p.name, kind: p.kind, mb: +(body.length / 1048576).toFixed(2), ms: Date.now() - t0, ...out, sample: undefined });
  console.log(JSON.stringify(rows.at(-1)));
}
const ok = rows.filter((r) => r.ok);
console.log(`\n${ok.length} of ${rows.length} read. median ${ok.length ? ok.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(ok.length / 2)] : "-"} ms, slowest ${Math.max(0, ...ok.map((r) => r.ms))} ms`);
writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify(rows, null, 2));
