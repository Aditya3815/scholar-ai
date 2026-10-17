// Builds eval/data/fake_refs.json (30 fabricated references) and validates eval/data/topical.json. Run once; output is frozen.
//   CROSSREF_MAILTO=you@example.org node eval/build-fakes.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatRef } from "./lib/text.mjs";

const D = fileURLToPath(new URL("./data/", import.meta.url));
const papers = JSON.parse(readFileSync(D + "papers.json", "utf8"));
const MAIL = process.env.CROSSREF_MAILTO ?? "eval@example.org";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tok = (s) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

// Deterministic randomness so the frozen file is reproducible.
let seed = 20261017;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const FIRST = ["A.", "R.", "S.", "K.", "M.", "P.", "V.", "N.", "D.", "T.", "J.", "L."];
const FAMS = ["Rao", "Iyer", "Banerjee", "Kulkarni", "Mukherjee", "Chatterjee", "Nair", "Patel", "Singh", "Sharma", "Okafor", "Tanaka", "Haddad", "Silva", "Petrov", "Novak", "Kim", "Lindqvist"];
const JOURNALS = ["Journal of Applied Computational Research", "International Journal of Emerging Technologies and Society", "Asian Journal of Data Science", "Journal of Sustainable Systems and Policy", "Review of Interdisciplinary Applied Sciences", "Transactions on Intelligent Rural Systems"];
const authorsList = (n) => Array.from({ length: n }, () => `${pick(FAMS)}, ${pick(FIRST)}`).filter((v, i, a) => a.indexOf(v) === i).join(", ");
const apaAuthors = (s) => { const p = s.split(", ").reduce((acc, x, i, arr) => (i % 2 === 0 ? [...acc, `${x}, ${arr[i + 1]}`] : acc), []); return p.length > 1 ? `${p.slice(0, -1).join(", ")}, & ${p.at(-1)}` : p[0]; };
const fakeAuthors = (n) => apaAuthors(authorsList(n));
const pages = () => { const a = 100 + Math.floor(rnd() * 900); return `${a}-${a + 8 + Math.floor(rnd() * 15)}`; };

const INVENTED = [
  "Adaptive Federated Graph Attention for Monsoon-Aware Crop Yield Forecasting in Semi-Arid Regions",
  "Neuro-symbolic Reinforcement Scheduling of Rural Microgrids under Stochastic Demand",
  "Quantum-Inspired Optimization of Supply Chain Resilience in Small Manufacturing Clusters",
  "A Bayesian Framework for Estimating Learning Loss Recovery after Prolonged School Closures",
  "Self-supervised Representation Learning for Low-Resource Odia Handwritten Manuscript Dating",
  "Longitudinal Effects of Millet-Based Midday Meals on Anaemia in Adolescent Girls: A Cluster Trial",
  "Blockchain-Anchored Provenance of Peer Review Reports in Regional Journals",
  "Thermodynamic Limits of Biochar-Amended Groundwater Recharge Basins",
  "Hybrid Transformer Ensembles for Early Detection of Predatory Journal Solicitation Emails",
  "Socioeconomic Determinants of Telemedicine Uptake among Informal Workers in Peri-Urban Clusters",
  "Large-Scale Assessment of Federated Fine-Tuning for Clinical Triage Dialogue Agents",
  "Regional Disparities in Open-Access Publishing Costs among Doctoral Researchers",
  "Spatiotemporal Attention Networks for Urban Heat Island Mitigation Planning",
  "Citation Network Signatures of Coordinated Self-Citation Rings in Engineering Journals",
  "Machine Learning Surrogates for Wastewater Treatment Plant Energy Auditing",
  "Participatory Mapping of Seed Banks and Smallholder Climate Adaptation in the Deccan Plateau",
  "Interpretable Survival Models for Rural Cardiac Event Risk Stratification",
  "Low-Cost Spectroscopic Screening of Adulterated Edible Oils Using Smartphone Cameras",
];

async function json(url) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { "User-Agent": `ScholarEval/0.1 (mailto:${MAIL})` } });
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    await sleep(1200 * (i + 1));
  }
  throw new Error("failed " + url);
}
const doiResolves = async (doi) => (await json(`https://doi.org/api/handles/${encodeURIComponent(doi).replace(/%2F/g, "/")}`))?.responseCode === 1;

// Make sure no "invented" title is accidentally a real paper.
console.log("checking invented titles against Crossref...");
for (const t of INVENTED) {
  const j = await json(`https://api.crossref.org/works?query.title=${encodeURIComponent(t)}&rows=3&select=title&mailto=${encodeURIComponent(MAIL)}`);
  const mine = new Set(tok(t));
  for (const it of j.message.items) {
    const theirs = tok(it.title?.[0] ?? "");
    const cov = theirs.length ? theirs.filter((w) => mine.has(w)).length / theirs.length : 0;
    if (cov >= 0.7) console.log(`  WARNING resembles a real paper (${cov.toFixed(2)}): ${t}  ~  ${it.title[0]}`);
  }
  await sleep(150);
}

const fakes = [];
let n = 0;
const add = (kind, expect, text, note) => fakes.push({ id: `f${String(++n).padStart(2, "0")}`, kind, expect, text, note });

// A. wholly invented (10) -> not_found
for (let i = 0; i < 10; i++) {
  add("invented", ["not_found"], `${fakeAuthors(2 + (i % 3))} (${2015 + (i % 9)}). ${INVENTED[i]}. ${pick(JOURNALS)}, ${10 + i}(${1 + (i % 4)}), ${pages()}.`, "plausible authors, title, journal, year; nothing real behind it");
}

// B. real title with invented authors/venue (8) -> mismatch
[3, 11, 19, 27, 35, 47, 61, 83].forEach((idx, k) => {
  const p = papers[idx];
  const year = k % 2 ? p.year : p.year + 2; // half keep the true year to be harder
  add("chimera_title", ["mismatch"], `${fakeAuthors(3)} (${year}). ${p.title}. ${pick(JOURNALS)}, ${12 + k}(${1 + (k % 4)}), ${pages()}.`, `real title of ${p.doi}, invented authors`);
});

// C. real first author, invented title (4) -> not_found or mismatch (never verified)
[5, 29, 53, 77].forEach((idx, k) => {
  const p = papers[idx];
  const first = `${p.authors[0].family}, ${(p.authors[0].given || "A").split(/[\s.-]+/).filter(Boolean).map((g) => g[0].toUpperCase() + ".").join(" ")}`;
  add("real_author_invented_title", ["not_found", "mismatch"], `${first}, ${pick(FAMS)}, ${pick(FIRST)} (${p.year}). ${INVENTED[10 + k]}. ${p.venue ?? pick(JOURNALS)}.`, `real first author of ${p.doi}`);
});

// D. invented DOI (4) -> not_found (and the DOI must really not resolve)
for (let k = 0; k < 4; k++) {
  let doi;
  do {
    const prefix = pick(["10.1016/j.eswa", "10.1007/s11042", "10.1038/s41598", "10.1371/journal.pone"]);
    doi = `${prefix}.2022.${Math.floor(10 ** 7 + rnd() * 9 * 10 ** 7)}`;
  } while (await doiResolves(doi));
  add("invented_doi", ["not_found"], `${fakeAuthors(3)} (${2019 + k}). ${INVENTED[14 + k]}. ${pick(JOURNALS)}, ${8 + k}, ${pages()}. https://doi.org/${doi}`, `DOI ${doi} does not resolve`);
}

// E. correct reference text but another paper's DOI (4) -> mismatch
[[7, 66], [21, 40], [44, 91], [70, 15]].forEach(([a, b]) => {
  const text = formatRef(papers[a], 0).replace(/ https:\/\/doi\.org\/\S+/, "");
  add("wrong_doi", ["mismatch"], `${text} https://doi.org/${papers[b].doi}`, `text of ${papers[a].doi} with the DOI of ${papers[b].doi}`);
});

console.log("fake refs:", fakes.length, Object.entries(fakes.reduce((a, f) => ({ ...a, [f.kind]: (a[f.kind] ?? 0) + 1 }), {})).map(([k, v]) => `${k}=${v}`).join(", "));
writeFileSync(D + "fake_refs.json", JSON.stringify(fakes, null, 1));

// Validate the hand-written topical landmark list: every expected DOI must really exist.
const topical = JSON.parse(readFileSync(D + "topical.json", "utf8"));
console.log("validating topical.json expected DOIs...");
let bad = 0;
for (const t of topical) {
  const found = [];
  for (const d of t.expect) { if (await doiResolves(d)) found.push(d); await sleep(80); }
  if (found.length === 0) { bad++; console.log(`  NO EXPECTED DOI RESOLVES for "${t.q}": ${t.expect}`); }
}
console.log(bad ? `${bad} topical entries need fixing` : "all topical entries have at least one resolving DOI");
