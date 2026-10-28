// What DOAJ would add to the REGULAR search (docs/design/doaj-regular.md). Real services, no Worker, no cache:
//   node scripts/doaj-live.mjs [--json=<file>]
// Needs the keys of apps/api/.dev.vars (OpenAlex, Semantic Scholar). For each of 34 topics it runs the four regular sources and DOAJ asked in three ways, and measures:
//   - per DOAJ variant: records, with an abstract, with a DOI, on topic (a rough check: two thirds of the topic's words, by their first five letters, are in the title or abstract),
//     new to the regular search's twenty (by DOI or by title), topics with nothing;
//   - the merged first twenty without and with DOAJ: how many have an abstract (the answer is written only from those), how many of the first ten are on topic, how many of the
//     regular first ten are pushed out, and how many of the twenty are DOAJ's.
// The topics were written before the first run (12 of the prompt box's own test questions and 22 from other fields) and were not changed after it.
import { build } from "esbuild";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TOPICS = [
  "glaucoma screening with smartphone fundus photographs in rural India",
  "does intermittent fasting improve insulin sensitivity",
  "transformer models for low-resource Indian languages",
  "how effective is the BCG vaccine against tuberculosis in adults",
  "effect of yoga on blood pressure in hypertensive patients",
  "machine learning for crop yield prediction in India",
  "microplastics in drinking water and human health",
  "retrieval augmented generation for question answering over scientific papers",
  "solar powered irrigation for smallholder farmers",
  "mindfulness based interventions for student anxiety",
  "graph neural networks for drug discovery",
  "air pollution and childhood asthma in Delhi",
  "effect of screen time on children's language development",
  "statin therapy for primary prevention of cardiovascular disease",
  "remote sensing for flood mapping",
  "gender pay gap in India",
  "blockchain in supply chain management",
  "ayurveda for arthritis",
  "green roofs and urban heat island mitigation",
  "large language models for code generation",
  "effects of minimum wage on employment",
  "online learning outcomes in higher education during COVID-19",
  "deep learning for medical image segmentation",
  "vitamin D supplementation and COVID-19 outcomes",
  "climate change impact on monsoon rainfall",
  "mobile phone use and adolescent sleep quality",
  "systematic review of teacher professional development",
  "antimicrobial resistance in hospital acquired infections",
  "renewable energy policy and carbon emissions",
  "social media and political polarisation",
  "bilingual education and cognitive development",
  "microfinance and women's empowerment",
  "wetland biodiversity conservation",
  "cost effectiveness of telemedicine",
];

const root = fileURLToPath(new URL("../../../", import.meta.url));
const vars = {};
try {
  for (const line of readFileSync(join(root, "apps/api/.dev.vars"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) vars[m[1]] = m[2].trim().replace(/^"|"$/g, "");
  }
} catch {}
const tmp = mkdtempSync(join(tmpdir(), "doaj-live-"));
await build({ entryPoints: { search: join(root, "apps/api/src/search/index.ts"), india: join(root, "apps/api/src/search/india.ts"), merge: join(root, "apps/api/src/search/merge.ts"), store: join(root, "apps/api/src/cache/store.ts"), norm: join(root, "apps/api/src/search/normalize.ts"), openalex: join(root, "apps/api/src/search/openalex.ts"), s2: join(root, "apps/api/src/search/s2.ts"), crossref: join(root, "apps/api/src/search/crossref.ts"), pubmed: join(root, "apps/api/src/search/pubmed.ts") }, bundle: true, format: "esm", platform: "node", outdir: tmp, logLevel: "silent", splitting: true });
const imp = (n) => import(pathToFileURL(join(tmp, `${n}.js`)).href);
const [{ runProvider }, india, { mergeAndRank }, { memoryStore }, { normalizeTitle }, { openalex }, { s2 }, { crossref }, { pubmed }] = await Promise.all(["search", "india", "merge", "store", "norm", "openalex", "s2", "crossref", "pubmed"].map(imp));

const STOP = new Set(["the", "and", "of", "in", "for", "on", "a", "an", "to", "with", "is", "are", "does", "how", "what", "do", "effect", "effects"]);
const words = (q) => [...new Set(normalizeTitle(q).split(" ").filter((w) => w.length > 2 && !STOP.has(w)))];
const stems = (s) => [...new Set(words(s).map((w) => w.slice(0, 5)))];
const onTopic = (topic, p) => {
  const want = stems(topic);
  const have = new Set(normalizeTitle(`${p.title} ${p.abstract ?? ""}`).split(" ").map((w) => w.slice(0, 5)));
  return want.filter((w) => have.has(w)).length >= Math.ceil((want.length * 2) / 3);
};
const keyOf = (p) => (p.doi ? `doi:${p.doi}` : `t:${normalizeTitle(p.title)}`);

// DOAJ asked in three ways. `and`: every word must be in the record (what the Indian scope does). `most`: the topic's words joined with OR, DOAJ ranks by how many match.
// `core`: the first four words with AND, then the rest as optional (a record must have the core words).
const DOAJ = "https://doaj.org/api/v4/search/articles";
const doajWith = (name, build) => ({
  name,
  async search(q, limit, _env, signal) {
    const query = build(words(q).slice(0, 8));
    if (!query) return [];
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(`${DOAJ}/${encodeURIComponent(query)}?pageSize=${limit}`, { signal, headers: { Accept: "application/json" } });
      if (res.status === 429) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      if (!res.ok) throw new Error(`DOAJ HTTP ${res.status}`);
      return india.toDoajPapers(((await res.json()).results) ?? []);
    }
    throw new Error("DOAJ 429");
  },
});
const VARIANTS = [
  doajWith("and", (w) => w.join(" AND ")),
  doajWith("and5", (w) => w.slice(0, 5).join(" AND ")),
  doajWith("and4", (w) => w.slice(0, 4).join(" AND ")),
  doajWith("core", (w) => (w.length <= 3 ? w.join(" AND ") : `${w.slice(0, 3).join(" AND ")} AND (${w.slice(3).join(" OR ")})`)),
];
const REGULAR = [openalex, s2, crossref, pubmed];

const blank = () => ({ n: 0, abstract: 0, doi: 0, onTopic: 0, newRecords: 0, empty: 0, failed: 0 });
const totals = Object.fromEntries(VARIANTS.map((v) => [v.name, blank()]));
const merged = Object.fromEntries(["without", ...VARIANTS.map((v) => v.name)].map((n) => [n, { abstracts: 0, top10OnTopic: 0, top10: 0, doajIn20: 0, regularTop10Kept: 0, regularTop10: 0 }]));
const rows = [];
for (const topic of TOPICS) {
  const env = { store: memoryStore(), OPENALEX_API_KEY: vars.OPENALEX_API_KEY, S2_API_KEY: vars.S2_API_KEY, NCBI_API_KEY: vars.NCBI_API_KEY, CROSSREF_MAILTO: vars.CROSSREF_MAILTO ?? "t@example.org" };
  const lists = {};
  await Promise.all(REGULAR.map(async (p) => { try { lists[p.name] = (await runProvider(p, topic, env)).value; } catch (e) { console.error(`  ${p.name} failed on "${topic}": ${e.message}`); } }));
  const order = (l) => Object.fromEntries(REGULAR.filter((p) => l[p.name]).map((p) => [p.name, l[p.name]]));
  const base = mergeAndRank(order(lists), 20);
  const seen = new Set(base.map(keyOf));
  const tally = (m, list) => {
    m.abstracts += list.filter((p) => p.abstract && p.abstract.length > 80).length;
    m.top10 += Math.min(10, list.length);
    m.top10OnTopic += list.slice(0, 10).filter((p) => onTopic(topic, p)).length;
  };
  tally(merged.without, base);
  const row = { topic, regular: base.length };
  for (const v of VARIANTS) {
    let list = null;
    const t0 = Date.now();
    try { list = await runProvider(v, topic, env).then((r) => r.value); (totals[v.name].ms ??= []).push(Date.now() - t0); } catch (e) { console.error(`  doaj ${v.name} failed on "${topic}": ${e.message}`); }
    const t = totals[v.name];
    if (!list) { t.failed++; row[v.name] = "failed"; continue; }
    if (list.length === 0) t.empty++;
    t.n += list.length;
    t.abstract += list.filter((p) => p.abstract && p.abstract.length > 80).length;
    t.doi += list.filter((p) => p.doi).length;
    t.onTopic += list.filter((p) => onTopic(topic, p)).length;
    t.newRecords += list.filter((p) => !seen.has(keyOf(p))).length;
    const withDoaj = mergeAndRank({ ...order(lists), doaj: list }, 20);
    const m = merged[v.name];
    tally(m, withDoaj);
    const top10 = new Set(withDoaj.slice(0, 10).map(keyOf));
    m.regularTop10 += Math.min(10, base.length);
    m.regularTop10Kept += base.slice(0, 10).filter((p) => top10.has(keyOf(p))).length;
    m.doajIn20 += withDoaj.filter((p) => list.some((d) => keyOf(d) === keyOf(p))).length;
    row[v.name] = list.length;
  }
  rows.push(row);
  console.log(`${topic.slice(0, 60).padEnd(60)} regular ${String(row.regular).padStart(2)} | ${VARIANTS.map((v) => `${v.name} ${row[v.name]}`).join(" | ")}`);
}

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "-");
console.log(`\n${TOPICS.length} topics. DOAJ alone, per way of asking: records, with abstract, with DOI, on topic, new to the regular first twenty, topics with nothing, failures`);
for (const [name, t] of Object.entries(totals)) console.log(`  ${name.padEnd(6)} ${String(t.n).padStart(4)}  abstract ${pct(t.abstract, t.n).padStart(4)}  DOI ${pct(t.doi, t.n).padStart(4)}  on topic ${pct(t.onTopic, t.n).padStart(4)}  new ${pct(t.newRecords, t.n).padStart(4)}  empty ${t.empty}  failed ${t.failed}  median ${[...(t.ms ?? [0])].sort((a, b) => a - b)[Math.floor((t.ms?.length ?? 1) / 2)]} ms`);
console.log("\nThe merged first twenty: with an abstract, first ten on topic, the regular first ten still in the first ten, DOAJ's share of the twenty");
for (const [name, m] of Object.entries(merged)) console.log(`  ${name.padEnd(8)} abstracts ${String(m.abstracts).padStart(4)}  top-10 on topic ${pct(m.top10OnTopic, m.top10).padStart(4)}  regular top-10 kept ${m.regularTop10 ? pct(m.regularTop10Kept, m.regularTop10).padStart(4) : "   -"}  DOAJ in the 20: ${m.doajIn20}`);
const out = process.argv.find((a) => a.startsWith("--json="))?.slice(7);
if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), totals, merged, rows }, null, 2));
