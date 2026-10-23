// Many reference checks at once against a deployed Worker: how many come back as a verdict, how many as "could not check" (a 429 or a refusal reaching the person), and how long they take.
//   node scripts/crossref-burst.mjs <base url> <papers|heldout|refs> [count=40] [parallel=12] [offset=0]
// The references are real records from the eval data (each needs fresh Crossref lookups: the cache has not seen them), so use a data set once per deployment you compare.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { formatRef } from "../eval/lib/text.mjs";

const [base, set = "papers", count = "40", par = "12", offset = "0"] = process.argv.slice(2);
if (!base) throw new Error("usage: node scripts/crossref-burst.mjs <base url> <papers|heldout|refs> [count] [parallel]");
const data = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../eval/data/${name}.json`, import.meta.url)), "utf8"));
// "refs": real references from the prior-art data, by title only (about 1,700 of them: a fresh set for every run)
const all = set === "refs" ? data("prior_art").flatMap((p) => p.refs).filter((r) => r.title && r.title.length > 25) : data(set === "heldout" ? "heldout_papers" : "papers");
const papers = all.slice(Number(offset), Number(offset) + Number(count));
const text = (p, i) => (set === "refs" ? p.title : formatRef(p, i));

const verify = async (p, i) => {
  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/api/v1/references/verify`, { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ reference: text(p, i) }) });
    const j = await res.json();
    return { ms: Date.now() - t0, status: res.ok ? j.status : `http ${res.status}`, detail: j.detail ?? j.reason };
  } catch (e) {
    return { ms: Date.now() - t0, status: "network error" };
  }
};

const queue = papers.map((p, i) => [p, i]);
const out = [];
const t0 = Date.now();
await Promise.all(Array.from({ length: Number(par) }, async () => { for (let it; (it = queue.shift()); ) out.push(await verify(...it)); }));
const counts = {};
for (const r of out) counts[r.status] = (counts[r.status] ?? 0) + 1;
const ms = out.map((r) => r.ms).sort((a, b) => a - b);
console.log(`${out.length} references, ${par} at a time, ${((Date.now() - t0) / 1000).toFixed(1)} s in all`);
console.log("verdicts:", JSON.stringify(counts));
console.log(`time per reference: median ${ms[Math.floor(ms.length / 2)]} ms, 90th percentile ${ms[Math.floor(ms.length * 0.9)]} ms, slowest ${ms.at(-1)} ms`);
