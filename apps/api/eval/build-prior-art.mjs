// Builds eval/data/prior_art.json: recent papers whose own reference lists are the ground truth for "prior work an idea check should find".
//   node eval/build-prior-art.mjs            (needs network; an OpenAlex key from .dev.vars or OPENALEX_API_KEY makes it faster)
// Each paper: its abstract (stands in for a well-written idea) and the references it cites that OpenAlex can resolve to a DOI and a title.
// Half have an author at an Indian institution. Papers published 2023 to 2025, English, at least 12 resolvable references.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const HERE = fileURLToPath(new URL(".", import.meta.url));
let key = process.env.OPENALEX_API_KEY;
try {
  key ??= /^OPENALEX_API_KEY=(.+)$/m.exec(readFileSync(HERE + "../.dev.vars", "utf8"))?.[1]?.trim();
} catch { /* no .dev.vars */ }

const SELECT = "id,doi,title,publication_year,abstract_inverted_index,referenced_works";
const get = async (url) => {
  const u = new URL(url);
  if (key) u.searchParams.set("api_key", key);
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(u);
    if (r.ok) return r.json();
    if (r.status !== 429) throw new Error(`OpenAlex ${r.status} for ${url.slice(0, 100)}`);
    await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
  }
  throw new Error("OpenAlex kept answering 429");
};

const abstractOf = (inv) => {
  if (!inv) return "";
  const words = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w;
  return words.filter(Boolean).join(" ");
};
const doiOf = (d) => (d ? d.replace(/^https?:\/\/doi\.org\//i, "").toLowerCase() : null);

async function sample(filter, seed, n) {
  const j = await get(`https://api.openalex.org/works?filter=${filter},type:article,has_abstract:true,has_doi:true,language:en,publication_year:2023-2025,referenced_works_count:>14&sample=${n}&seed=${seed}&per-page=${n}&select=${SELECT}`);
  return j.results;
}

async function resolveRefs(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50).map((x) => x.replace("https://openalex.org/", "")).join("|");
    const j = await get(`https://api.openalex.org/works?filter=openalex:${chunk}&per-page=50&select=id,doi,title`);
    for (const w of j.results) if (w.doi && w.title) out.push({ doi: doiOf(w.doi), title: w.title });
  }
  return out;
}

const WANT = 20;
const picked = [];
for (const [group, filter, seed] of [["india", "authorships.institutions.country_code:IN", 11], ["global", "authorships.institutions.country_code:US|GB|DE|CN|AU|CA|FR|JP|BR|ZA", 12]]) {
  let got = 0;
  for (const w of await sample(filter, seed, 60)) {
    if (got >= WANT) break;
    const abs = abstractOf(w.abstract_inverted_index);
    if (abs.length < 400 || !w.title || !w.doi) continue;
    const refs = await resolveRefs((w.referenced_works ?? []).slice(0, 120));
    if (refs.length < 12) continue;
    picked.push({ group, doi: doiOf(w.doi), title: w.title, year: w.publication_year, abstract: abs.slice(0, 1500), refs: refs.slice(0, 80) });
    got++;
    process.stdout.write(`${group} ${got}/${WANT}  ${w.title.slice(0, 60)}  (${refs.length} refs)\n`);
  }
}
writeFileSync(HERE + "data/prior_art.json", JSON.stringify(picked, null, 1));
console.log(`wrote ${picked.length} papers, ${picked.reduce((n, p) => n + p.refs.length, 0)} references`);
