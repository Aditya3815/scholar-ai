// What the "Indian sources" scope adds, on topics an Indian scholar searches (src/search/india.ts, docs/design/india-sources.md). Real services, no Worker, no cache:
//   node scripts/india-live.mjs [--json=<file>]
// Needs OPENALEX_API_KEY in the environment (apps/api/.dev.vars). For each topic it runs the regular search and each Indian source, and counts per source: records,
// with an abstract, with a DOI, on topic (a rough check: at least two thirds of the topic's words, by their first five letters, are in the title or abstract), and new
// (not among the regular search's 20, by DOI or by title). The topics were written before the first run and were not changed after it.
import { build } from "esbuild";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TOPICS = [
  "groundwater quality assessment",
  "panchayati raj women participation",
  "self help groups microfinance rural women",
  "MGNREGA employment impact",
  "anaemia adolescent girls",
  "tuberculosis treatment adherence",
  "diabetic retinopathy screening",
  "paddy straw burning air pollution",
  "monsoon rainfall variability",
  "drip irrigation sugarcane yield",
  "ayurvedic formulation antioxidant",
  "Hindi novel partition",
  "tribal education dropout",
  "National Education Policy 2020 higher education",
  "mobile banking adoption",
  "solar photovoltaic rural electrification",
  "seismic vulnerability buildings",
  "Ganga river water pollution",
  "child malnutrition stunting",
  "teacher education quality",
  "Dalit literature",
  "crop insurance farmers",
  "dengue outbreak",
  "handloom weavers livelihood",
];

const root = fileURLToPath(new URL("../../../", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "india-live-"));
await build({ entryPoints: { search: join(root, "apps/api/src/search/index.ts"), india: join(root, "apps/api/src/search/india.ts"), store: join(root, "apps/api/src/cache/store.ts"), norm: join(root, "apps/api/src/search/normalize.ts") }, bundle: true, format: "esm", platform: "node", outdir: tmp, logLevel: "silent", splitting: true });
const { runSearch, runProvider } = await import(pathToFileURL(join(tmp, "search.js")).href);
const india = await import(pathToFileURL(join(tmp, "india.js")).href);
const { memoryStore } = await import(pathToFileURL(join(tmp, "store.js")).href);
const { normalizeTitle } = await import(pathToFileURL(join(tmp, "norm.js")).href);

const SOURCES = [india.doajIndia, india.shodhganga, india.openalexIndia];
const STOP = new Set(["the", "and", "of", "in", "for", "on", "a", "an", "to", "with"]);
const stems = (s) => [...new Set(normalizeTitle(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w)).map((w) => w.slice(0, 5)))];
const onTopic = (topic, p) => {
  const want = stems(topic);
  const have = new Set(normalizeTitle(`${p.title} ${p.abstract ?? ""}`).split(" ").map((w) => w.slice(0, 5)));
  return want.filter((w) => have.has(w)).length >= Math.ceil((want.length * 2) / 3);
};
const keyOf = (p) => (p.doi ? `doi:${p.doi}` : `t:${normalizeTitle(p.title)}`);

const totals = Object.fromEntries(["regular", ...SOURCES.map((s) => s.name)].map((n) => [n, { n: 0, abstract: 0, doi: 0, onTopic: 0, newRecords: 0, top10: 0, top10OnTopic: 0, failed: 0, empty: 0 }]));
const rows = [];
for (const topic of TOPICS) {
  const env = { store: memoryStore(), OPENALEX_API_KEY: process.env.OPENALEX_API_KEY, S2_API_KEY: process.env.S2_API_KEY, CROSSREF_MAILTO: process.env.CROSSREF_MAILTO ?? "t@example.org" };
  const regular = await runSearch(env, topic, 20).catch(() => null);
  const seen = new Set((regular?.results ?? []).map(keyOf));
  const row = { topic, regular: regular?.results.length ?? -1 };
  const tally = (name, list) => {
    const t = totals[name];
    if (!list) return void t.failed++;
    if (list.length === 0) t.empty++;
    t.n += list.length;
    t.abstract += list.filter((p) => p.abstract && p.abstract.length > 80).length;
    t.doi += list.filter((p) => p.doi).length;
    t.onTopic += list.filter((p) => onTopic(topic, p)).length;
    t.top10 += Math.min(10, list.length);
    t.top10OnTopic += list.slice(0, 10).filter((p) => onTopic(topic, p)).length;
    if (name !== "regular") t.newRecords += list.filter((p) => !seen.has(keyOf(p))).length;
  };
  tally("regular", regular?.results ?? null);
  for (const s of SOURCES) {
    const list = await runProvider(s, topic, env).then((r) => r.value, (e) => (console.error(`  ${s.name} failed on "${topic}": ${e.message}`), null));
    tally(s.name, list);
    row[s.name] = list ? { n: list.length, onTopic: list.filter((p) => onTopic(topic, p)).length, first: list.slice(0, 2).map((p) => `${p.year ?? "----"} ${p.title.slice(0, 70)}`) } : "failed";
  }
  rows.push(row);
  console.log(`${topic}: regular ${row.regular} | ${SOURCES.map((s) => `${s.name} ${row[s.name] === "failed" ? "FAILED" : `${row[s.name].n} (${row[s.name].onTopic} on topic)`}`).join(" | ")}`);
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "-");
console.log(`\n${TOPICS.length} topics. Per source: records, with abstract, with DOI, on topic (all / first ten), new to the regular search, topics with nothing, failures`);
for (const [name, t] of Object.entries(totals)) {
  console.log(`  ${name.padEnd(15)} ${String(t.n).padStart(4)}  abstract ${pct(t.abstract, t.n).padStart(4)}  DOI ${pct(t.doi, t.n).padStart(4)}  on topic ${pct(t.onTopic, t.n).padStart(4)} / top 10 ${pct(t.top10OnTopic, t.top10).padStart(4)}  new ${name === "regular" ? "   -" : pct(t.newRecords, t.n).padStart(4)}  empty ${t.empty}  failed ${t.failed}`);
}
const out = process.argv.find((a) => a.startsWith("--json="))?.slice(7);
if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), totals, rows }, null, 2));
