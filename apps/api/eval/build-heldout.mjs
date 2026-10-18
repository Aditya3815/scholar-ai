// Builds the HELD-OUT eval set: papers and references the verifier was never tuned on. Run once; the output is frozen.
//   OPENALEX_API_KEY=... CROSSREF_MAILTO=you@example.org node eval/build-heldout.mjs
//
// Why it differs from papers.json: that set is the 4 most-cited papers of 25 hand-picked topics, which flatters the tool
// (famous papers are everywhere and have clean metadata). Here papers are a seeded RANDOM sample, half with an Indian
// institution (the actual user base: lower citation counts, regional journals, names with one word or many), half global.
// Nothing in the matcher may be changed to fix a miss in this set; misses are reported as the honest accuracy.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cleanTitle, formatRef } from "./lib/text.mjs";

const D = fileURLToPath(new URL("./data/", import.meta.url));
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
const oa = (params) => getJson(`https://api.openalex.org/works?${new URLSearchParams({ ...params, ...(KEY ? { api_key: KEY } : {}) })}`);
const crossref = (doi) => getJson(`https://api.crossref.org/works/${encodeURIComponent(doi).replace(/%2F/g, "/")}?mailto=${encodeURIComponent(MAIL)}`).then((j) => j?.message ?? null);
const isRetracted = async (doi) =>
  ((await getJson(`https://api.crossref.org/works?filter=updates:${encodeURIComponent(doi)},update-type:retraction&rows=1&select=DOI&mailto=${encodeURIComponent(MAIL)}`))?.message?.["total-results"] ?? 0) > 0;

const tuned = new Set(
  ["papers.json", "retracted.json"].flatMap((f) => JSON.parse(readFileSync(D + f, "utf8")).map((p) => p.doi)),
);

const GROUPS = [
  { group: "india", seed: "7", filter: "authorships.institutions.country_code:IN,type:article,has_doi:true,publication_year:1995-2024,cited_by_count:3-60" },
  { group: "global", seed: "11", filter: "type:article,has_doi:true,publication_year:1990-2024,cited_by_count:3-200" },
];
const PER_GROUP = 30;

const papers = [];
for (const g of GROUPS) {
  const r = await oa({ filter: g.filter, sample: "160", seed: g.seed, "per-page": "160", select: "doi" });
  let taken = 0;
  for (const w of r?.results ?? []) {
    if (taken >= PER_GROUP) break;
    const doi = doiOf(w.doi);
    if (!doi || tuned.has(doi) || papers.some((p) => p.doi === doi)) continue;
    const rec = await crossref(doi);
    await sleep(120);
    const title = rec?.title?.[0] ? cleanTitle(rec.title[0]) : undefined;
    const authors = (rec?.author ?? []).filter((a) => a.family);
    const year = rec?.issued?.["date-parts"]?.[0]?.[0];
    const words = title?.split(/\s+/).length ?? 0;
    if (!rec || !title || authors.length === 0 || !year || words < 3 || words > 40) continue;
    if (await isRetracted(doi)) continue;
    papers.push({
      doi, title, year,
      authors: authors.slice(0, 6).map((a) => ({ given: a.given ?? "", family: a.family })),
      venue: rec["container-title"]?.[0] ?? null,
      topic: "random sample", field: g.group, group: g.group,
    });
    taken++;
  }
  console.log(`${g.group}: ${taken}`);
}
writeFileSync(D + "heldout_papers.json", JSON.stringify(papers, null, 1));

/* ---------- fabricated references derived mechanically from the held-out papers (no hand tuning) ---------- */
let seed = 20261018;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const FIRST = ["A.", "R.", "S.", "K.", "M.", "P.", "V.", "N.", "D.", "T."];
const FAMS = ["Rao", "Iyer", "Banerjee", "Kulkarni", "Mukherjee", "Nair", "Patel", "Singh", "Okafor", "Tanaka", "Haddad", "Silva", "Petrov", "Novak"];
const JOURNALS = ["Journal of Applied Computational Research", "Asian Journal of Data Science", "Review of Interdisciplinary Applied Sciences", "Transactions on Intelligent Rural Systems"];
const fakeAuthors = (n) => {
  const names = Array.from({ length: n }, () => `${pick(FAMS)}, ${pick(FIRST)}`).filter((v, i, a) => a.indexOf(v) === i);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")}, & ${names.at(-1)}` : names[0];
};

const fakes = [];
papers.forEach((p, i) => {
  if (i % 3 === 0) {
    // real title, invented authors and journal
    fakes.push({ id: `h${fakes.length + 1}`, kind: "chimera_title", expect: ["mismatch", "not_found"], text: `${fakeAuthors(3)} (${p.year}). ${p.title}. ${pick(JOURNALS)}, ${10 + (i % 9)}, ${100 + i}-${112 + i}.`, note: `real title of ${p.doi}, invented authors` });
  } else if (i % 3 === 1) {
    // the genuine reference, but the year moved by 4+ years
    const wrong = { ...p, year: p.year + 4 + (i % 3) };
    fakes.push({ id: `h${fakes.length + 1}`, kind: "altered_year", expect: ["mismatch", "not_found", "unverifiable"], text: formatRef(wrong, i + 2).replace(/ (https:\/\/doi\.org\/|doi: )\S+/, ""), note: `${p.doi} with the year changed from ${p.year}` });
  }
});
console.log("held-out fakes:", fakes.length);
writeFileSync(D + "heldout_fakes.json", JSON.stringify(fakes, null, 1));
