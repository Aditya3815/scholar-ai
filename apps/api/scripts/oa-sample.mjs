// How many open-access papers that a person might really ask about become readable (not only the hand-picked ones of oa-eval.mjs)? It takes a random sample of open-access articles
// with a DOI from OpenAlex, on the topics the R8 spike used (docs/spikes/R8-server-extraction.md), asks each one a plain question through POST /api/v1/papers/oa/ask, and counts
// what the paper was read from (Europe PMC XML, arXiv, a free PDF) or why it fell back to its abstract.
//
//   APP=https://scholar-staging.shodhsetu.workers.dev SESSIONS=<file from scripts/staging-session.mjs> node scripts/oa-sample.mjs [--per=6] [--seed=27] [--dois=<doi>,<doi>]
//
// Needs one account per 20 new papers (the daily limit per person); `staging-session.mjs make 4 <file>` gives enough for 80. Run it on staging, not on production.
import { readFileSync } from "node:fs";
import { createClient } from "./test-client.mjs";

const APP = process.env.APP;
if (!APP || !process.env.SESSIONS) throw new Error("set APP and SESSIONS (see the top of this file)");
const SESSIONS = JSON.parse(readFileSync(process.env.SESSIONS, "utf8"));
const arg = (name, dflt) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt);
const PER = arg("per", 6);
const SEED = arg("seed", 27);
const TOPICS = ["glaucoma screening", "diabetes exercise", "tuberculosis vaccine", "machine learning crop yield", "air pollution asthma children", "mindfulness student anxiety", "NEP 2020 higher education India"];
const PER_ACCOUNT = 18; // under the daily limit of 20 new papers a person

async function sample() {
  const out = [];
  for (const topic of TOPICS) {
    const url = `https://api.openalex.org/works?search=${encodeURIComponent(topic)}&filter=is_oa:true,has_doi:true,type:article&sample=${PER}&seed=${SEED}&per-page=${PER}&select=doi,title&mailto=${process.env.CROSSREF_MAILTO ?? "ci@example.com"}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OpenAlex ${res.status} for ${topic}`);
    for (const w of (await res.json()).results) out.push({ topic, doi: w.doi.replace(/^https?:\/\/doi\.org\//i, ""), title: w.title });
  }
  return out;
}

async function ask(c, doi) {
  const t0 = Date.now();
  const res = await c.send(`${APP}/api/v1/papers/oa/ask`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ doi, question: "What is this paper about, in one or two sentences?" }) });
  const events = [];
  let lastAt = t0;
  let bytes = 0;
  if (res.ok) {
    try {
      const dec = new TextDecoder();
      let buf = "";
      for await (const part of res.body) {
        lastAt = Date.now();
        bytes += part.length;
        buf += dec.decode(part, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const data = buf.slice(0, i).split("\n").find((l) => l.startsWith("data:"));
          buf = buf.slice(i + 2);
          if (data) events.push(JSON.parse(data.slice(5)));
        }
      }
    } catch (e) {
      events.push({ type: "error", code: "stream_cut", message: `${e?.cause?.code ?? e?.message ?? e}; ${Math.round((Date.now() - lastAt) / 100) / 10} s without a byte, ${bytes} bytes and ${events.length} events before it, ${Math.round((Date.now() - t0) / 100) / 10} s in` });
    }
  }
  const paper = events.find((e) => e.type === "paper");
  const last = events.at(-1);
  return { status: res.status, source: paper?.source ?? null, reason: paper?.reason ?? null, answered: last?.type === "answer", detail: last?.type === "error" ? last.message : undefined, error: last?.type === "error" ? last.code : res.ok ? null : `http_${res.status}`, ms: Date.now() - t0 };
}

const only = process.argv.find((a) => a.startsWith("--dois="))?.slice(7);
const papers = only ? only.split(",").map((doi) => ({ topic: "given", doi, title: "" })) : await sample();
console.log(`${papers.length} open-access articles sampled from OpenAlex (seed ${SEED})`);
const rows = [];
let account = -1;
let client;
for (const [i, p] of papers.entries()) {
  if (i % PER_ACCOUNT === 0) {
    const cookie = SESSIONS[++account];
    if (!cookie) throw new Error("SESSIONS has too few accounts");
    client = createClient(APP);
    const [k, ...v] = cookie.split("=");
    client.jar.set(k, v.join("="));
  }
  const r = await ask(client, p.doi);
  rows.push({ ...p, ...r });
  console.log(`${String(i + 1).padStart(2)}/${papers.length}  ${(r.source ?? r.error ?? "-").padEnd(9)} ${(r.reason ?? "").padEnd(18)} ${String(Math.round(r.ms / 1000)).padStart(3)} s  ${p.doi}${r.error === "stream_cut" ? "   <- " + r.detail : ""}`);
}

const count = (f) => rows.filter(f).length;
const full = count((r) => r.source && r.source !== "abstract");
console.log("\n--- readable in full on the deployed Worker");
console.log(`read in full: ${full} of ${rows.length} (${Math.round((100 * full) / rows.length)}%)`);
for (const s of ["europepmc", "arxiv", "pdf"]) console.log(`  ${s.padEnd(10)} ${count((r) => r.source === s)}`);
const fallbacks = rows.filter((r) => r.source === "abstract");
console.log(`abstract only: ${fallbacks.length}`);
const why = new Map();
for (const r of fallbacks) why.set(r.reason ?? "?", (why.get(r.reason ?? "?") ?? 0) + 1);
for (const [k, n] of [...why].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${n}`);
const errs = rows.filter((r) => r.error);
console.log(`errors: ${errs.length}${errs.length ? " (" + errs.map((r) => r.error).join(", ") + ")" : ""}`);
console.log(`answered with some text: ${count((r) => r.answered)} of ${rows.length}`);
const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
console.log(`median ${Math.round(ms[Math.floor(ms.length / 2)] / 1000)} s, slowest ${Math.round(ms.at(-1) / 1000)} s`);
