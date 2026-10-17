// Spike R3: 50 queries, cold run + warm run (cache), DOI validity sample, retraction sanity check.
// Usage: node scripts/spike-r3.mjs [baseUrl]   (default http://localhost:8787)
// Local D1 cache persist hota hai: pehle `rm -r .wrangler/state` ya naye queries se cold run lo.

const BASE = process.argv[2] ?? "http://localhost:8787";

const QUERIES = [
  // CS / AI
  "graph neural networks", "transformer attention mechanism", "federated learning privacy", "large language model hallucination",
  "reinforcement learning robotics", "explainable AI healthcare", "retrieval augmented generation", "computer vision object detection",
  // Medicine / biology
  "CRISPR gene editing off-target effects", "COVID-19 vaccine effectiveness", "type 2 diabetes metformin", "breast cancer immunotherapy",
  "antibiotic resistance mechanisms", "gut microbiome depression", "Alzheimer's disease biomarkers", "tuberculosis drug resistance India",
  // Social science / education / management
  "online learning student engagement", "mental health PhD students", "supervisor student relationship doctoral", "gender gap STEM higher education",
  "microfinance poverty reduction India", "consumer behaviour e-commerce", "teacher professional development", "NEP 2020 higher education India",
  // Engineering / physics / chemistry / environment
  "perovskite solar cells stability", "lithium ion battery degradation", "concrete compressive strength prediction machine learning", "wireless sensor networks energy efficient routing",
  "climate change impact on monsoon", "water quality assessment groundwater", "graphene oxide synthesis", "5G network slicing",
  // Research-integrity topics (platform ke core use cases)
  "plagiarism detection techniques", "predatory journals identification", "retracted papers citation", "research misconduct India",
  "peer review bias", "reproducibility crisis", "AI generated text detection", "citation analysis bibliometrics",
  // Edge cases
  "AI", "C++ & Python: a comparison, (2020)", "10.1038/s43586-024-00294-7", "quantum computing error correction",
  "machine learning", "ileal-lymphoid-nodular hyperplasia non-specific colitis pervasive developmental disorder children",
  "ग्रामीण विकास", "deep learning for medical image segmentation: a survey of methods, datasets, evaluation metrics, and open challenges in low-resource settings",
  "sentiment analysis Hindi tweets", "thesis supervision workload",
];

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : 0;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(q) {
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/api/v1/search?q=${encodeURIComponent(q)}&limit=20`);
    const wall = Date.now() - t0;
    if (!res.ok) return { q, wall, error: `HTTP ${res.status}` };
    return { q, wall, ...(await res.json()) };
  } catch (e) {
    return { q, wall: Date.now() - t0, error: String(e) };
  }
}

async function runAll(label) {
  const out = [];
  const queue = [...QUERIES];
  // S2 key = 1 req/s, isliye default concurrency 1 (CONC=3 se stress test).
  const workers = Array.from({ length: Number(process.env.CONC ?? 1) }, async () => {
    while (queue.length) {
      const q = queue.shift();
      out.push(await search(q));
    }
  });
  await Promise.all(workers);
  console.log(`\n== ${label} ==`);
  return out;
}

function summarize(runs, label) {
  const ok = runs.filter((r) => !r.error);
  const walls = ok.map((r) => r.wall);
  const names = ["openalex", "s2", "crossref", "pubmed"];
  console.log(`requests ok: ${ok.length}/${runs.length}`);
  console.log(`latency ms  p50=${pct(walls, 50)}  p95=${pct(walls, 95)}  max=${Math.max(...walls)}`);
  for (const n of names) {
    const st = ok.map((r) => r.providers[n]).filter(Boolean);
    const good = st.filter((s) => s.ok).length;
    const hits = st.filter((s) => s.cached).length;
    console.log(`  ${n.padEnd(9)} ok ${good}/${st.length}  cache-hit ${hits}/${st.length}  p95=${pct(st.map((s) => s.ms), 95)}ms`);
  }
  const rc = ok.map((r) => r.retractionCheck);
  console.log(`  retraction check ok ${rc.filter((s) => s.ok).length}/${rc.length}  cache-hit ${rc.filter((s) => s.cached).length}`);
  const all = ok.flatMap((r) => r.results);
  console.log(`results: ${all.length} total, ${(all.length / ok.length).toFixed(1)}/query, ` +
    `with DOI ${all.filter((p) => p.doi).length} (${((all.filter((p) => p.doi).length / all.length) * 100).toFixed(0)}%), ` +
    `multi-source ${all.filter((p) => p.sources.length > 1).length}, retracted ${all.filter((p) => p.retracted).length}`);
  const empty = ok.filter((r) => r.results.length === 0).map((r) => r.q);
  if (empty.length) console.log(`empty result queries: ${JSON.stringify(empty)}`);
  const failed = runs.filter((r) => r.error);
  if (failed.length) console.log(`failed: ${JSON.stringify(failed.map((f) => [f.q, f.error]))}`);
  const provErr = ok.flatMap((r) => Object.entries(r.providers).filter(([, s]) => !s.ok).map(([n, s]) => `${n}: ${s.error}`));
  if (provErr.length) console.log(`provider errors: ${[...new Set(provErr)].join(" | ")}`);
  return { ok, all };
}

async function doiResolves(doi) {
  try {
    const res = await fetch(`https://doi.org/api/handles/${encodeURIComponent(doi).replace(/%2F/g, "/")}`);
    if (!res.ok) return false;
    return (await res.json()).responseCode === 1;
  } catch {
    return null; // network error: unknown
  }
}

// ---- run
const cold = await runAll("COLD (cache miss expected)");
const { all } = summarize(cold, "cold");

// Known retracted paper (Wakefield 1998, retracted 2010) ko flag hona chahiye.
const wk = cold.find((r) => r.q.startsWith("ileal-lymphoid"));
const wkHit = wk?.results?.find((p) => p.doi === "10.1016/s0140-6736(97)11096-0");
console.log(`\nretraction sanity (Wakefield 10.1016/s0140-6736(97)11096-0): ` +
  (wkHit ? `found, retracted=${wkHit.retracted}, by=${wkHit.retractionSources.join(",")}` : "paper not in results"));

// DOI validity: random 40 distinct DOIs ko doi.org handle API se verify (har agency ke DOI ke liye).
const dois = [...new Set(all.map((p) => p.doi).filter(Boolean))];
const sample = dois.sort(() => Math.random() - 0.5).slice(0, 40);
let valid = 0, invalid = [], unknown = 0;
for (const d of sample) {
  const ok = await doiResolves(d);
  if (ok === true) valid++;
  else if (ok === false) invalid.push(d);
  else unknown++;
  await sleep(120);
}
console.log(`\nDOI validity sample: ${valid}/${sample.length} resolve` +
  (invalid.length ? `, INVALID: ${JSON.stringify(invalid)}` : "") + (unknown ? `, unknown: ${unknown}` : ""));

await sleep(500);
const warm = await runAll("WARM (cache hit expected)");
summarize(warm, "warm");
