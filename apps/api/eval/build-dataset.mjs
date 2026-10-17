// Builds the frozen eval datasets from OpenAlex + Crossref. Run ONCE (and when you deliberately want a new set):
//   OPENALEX_API_KEY=... CROSSREF_MAILTO=you@example.org node eval/build-dataset.mjs
// The output (eval/data/*.json) is committed and reviewed by a human; CI never regenerates it.
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanTitle } from "./lib/text.mjs";

const OUT = fileURLToPath(new URL("./data/", import.meta.url));
mkdirSync(OUT, { recursive: true });
const KEY = process.env.OPENALEX_API_KEY;
const MAIL = process.env.CROSSREF_MAILTO ?? "eval@example.org";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const doiOf = (u) => u?.replace(/^https?:\/\/doi\.org\//i, "").toLowerCase() ?? null;

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { "User-Agent": `ScholarEval/0.1 (mailto:${MAIL})` } });
    if (res.status === 404) return null;
    if (res.ok) return res.json();
    await sleep(1500 * (i + 1));
  }
  throw new Error(`failed: ${url}`);
}

const oa = (path, params) => getJson(`https://api.openalex.org${path}?${new URLSearchParams({ ...params, ...(KEY ? { api_key: KEY } : {}) })}`);
const crossref = (doi) =>
  getJson(`https://api.crossref.org/works/${encodeURIComponent(doi).replace(/%2F/g, "/")}?mailto=${encodeURIComponent(MAIL)}`).then((j) => j?.message ?? null);

async function isRetracted(doi) {
  const j = await getJson(`https://api.crossref.org/works?filter=updates:${encodeURIComponent(doi)},update-type:retraction&rows=1&select=DOI&mailto=${encodeURIComponent(MAIL)}`);
  return (j?.message?.["total-results"] ?? 0) > 0;
}

/* ---------- 100 ordinary papers: 25 topics x 4, highly cited 2008-2022, all in Crossref, none retracted ---------- */
const TOPICS = [
  ["deep learning image recognition", "cs"], ["natural language processing pretrained transformers", "cs"], ["CRISPR genome editing", "biology"],
  ["COVID-19 vaccine effectiveness", "medicine"], ["cancer immunotherapy checkpoint", "medicine"], ["climate change impacts on agriculture", "environment"],
  ["perovskite solar cells", "materials"], ["lithium-ion battery materials", "materials"], ["machine learning in healthcare", "cs-health"],
  ["systematic review meta-analysis methodology", "methods"], ["gut microbiome health", "biology"], ["type 2 diabetes treatment", "medicine"],
  ["online learning higher education", "education"], ["mental health university students", "psychology"], ["groundwater depletion India", "india"],
  ["tuberculosis India", "india"], ["Indian monsoon rainfall variability", "india"], ["digital payments financial inclusion India", "india"],
  ["renewable energy policy", "energy"], ["blockchain applications", "cs"], ["internet of things security", "cs"],
  ["corporate governance firm performance", "management"], ["consumer behaviour online shopping", "management"], ["microfinance poverty reduction", "economics"],
  ["antibiotic resistance", "medicine"],
];

const papers = [];
const seen = new Set();
for (const [topic, field] of TOPICS) {
  const r = await oa("/works", {
    filter: `title_and_abstract.search:${topic},type:article,has_doi:true,from_publication_date:2008-01-01,to_publication_date:2022-12-31`,
    sort: "cited_by_count:desc",
    "per-page": "25",
    select: "doi,title",
  });
  let taken = 0;
  for (const w of r?.results ?? []) {
    if (taken >= 4) break;
    const doi = doiOf(w.doi);
    if (!doi || seen.has(doi)) continue;
    const rec = await crossref(doi);
    await sleep(120);
    const title = rec?.title?.[0] ? cleanTitle(rec.title[0]) : undefined;
    const authors = (rec?.author ?? []).filter((a) => a.family);
    const year = rec?.issued?.["date-parts"]?.[0]?.[0];
    const words = title?.trim().split(/\s+/).length ?? 0;
    if (!rec || !title || authors.length === 0 || !year || words < 4 || words > 25) continue;
    if (await isRetracted(doi)) continue;
    seen.add(doi);
    papers.push({
      doi,
      title,
      year,
      authors: authors.slice(0, 6).map((a) => ({ given: a.given ?? "", family: a.family })),
      venue: rec["container-title"]?.[0] ?? null,
      topic,
      field,
    });
    taken++;
  }
  console.log(`${topic}: ${taken}`);
}
console.log("papers:", papers.length);
writeFileSync(OUT + "papers.json", JSON.stringify(papers, null, 1));

/* ---------- 20 retracted papers: flagged by OpenAlex AND listed in Crossref/Retraction Watch ---------- */
const retractedCandidates = await oa("/works", {
  filter: "is_retracted:true,type:article,has_doi:true",
  sort: "cited_by_count:desc",
  "per-page": "80",
  select: "doi,title,publication_year,cited_by_count",
});
const retracted = [];
for (const w of retractedCandidates?.results ?? []) {
  if (retracted.length >= 20) break;
  const doi = doiOf(w.doi);
  if (!doi || seen.has(doi)) continue;
  const rec = await crossref(doi);
  await sleep(120);
  if (!rec?.title?.[0]) continue;
  if (!(await isRetracted(doi))) continue; // must be in Retraction Watch via Crossref too
  retracted.push({ doi, title: cleanTitle(rec.title[0]), year: rec.issued?.["date-parts"]?.[0]?.[0] ?? w.publication_year, citedBy: w.cited_by_count });
}
console.log("retracted:", retracted.length);
writeFileSync(OUT + "retracted.json", JSON.stringify(retracted, null, 1));
