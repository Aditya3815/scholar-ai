// Real-service check of Idea Check (Workers AI plan + OpenAlex semantic/keyword + Semantic Scholar + DOI/retraction checks). Needs a Worker
// started WITHOUT QA_STUB, with a Workers AI login and the real search keys from .dev.vars:
//   npx wrangler dev --port 8788 --var GOOGLE_CLIENT_ID:dev --var GOOGLE_CLIENT_SECRET:dev-secret --var DEV_IDP_URL:http://localhost:9911 --var ENABLE_DEV_ROUTES:1
//   node scripts/idea-live.mjs ["an idea in your own words"]
// Prints the plan and the closest papers for a few ideas so their quality can be judged by eye. Each idea costs about 4k model tokens
// and a few OpenAlex / Semantic Scholar calls.
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
const IDEAS = process.argv[2] && !process.argv[2].startsWith("--")
  ? [process.argv[2]]
  : [
      "I want to screen for glaucoma in rural clinics with no ophthalmologist. A health worker takes a photo of the back of the eye with a smartphone and a low-cost lens attachment, and a convolutional neural network on the phone flags eyes that need referral. I would test it on a few hundred patients against an ophthalmologist's reading.",
      "Using large language models to check whether the references in a PhD thesis really exist, by looking each one up in Crossref and OpenAlex, and flagging the ones whose authors or year do not match the real record.",
      "Can sensors on a tractor measure soil moisture while it ploughs, so that irrigation can be planned per field strip for smallholder farmers in semi-arid India?",
    ];

const IDEA_QUESTIONS = {};
// What each step used, read from the ledger (needs ENABLE_DEV_ROUTES=1 on the Worker), and a result file per run so models and settings can be compared:
//   node scripts/idea-live.mjs --tag=gptoss120b      (docs/spikes/R5-cost.md)
const tag = process.argv.find((a) => a.startsWith("--tag="))?.slice(6);
const sql = async (statement) => {
  try {
    const r = await fetch(`${APP}/api/v1/dev/sql`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: [statement] }) });
    return r.ok ? (await r.json()).results[0] : null;
  } catch {
    return null;
  }
};
const results = [];
// --dump=<folder> saves what each check searched and read (plan, the papers' abstracts, the question) so scripts/r5-replay.mjs can replay the model steps
// with other models or prompts without searching again. Abstracts are public text; keep the folder outside the repository.
const dumpDir = process.argv.find((a) => a.startsWith("--dump="))?.slice(7);
let dumpN = 0;
const idp = await startFakeIdp(9911);
idp.setUser({ sub: process.env.LIVE_SUB ?? "idea-live-1", email: `${process.env.LIVE_SUB ?? "live"}@example.edu`, email_verified: true, name: "Live Check" });
const A = createClient(APP);
await A.follow(`${APP}/api/v1/auth/google/start`);
await A.ack();

async function events(res) {
  const out = [];
  const dec = new TextDecoder();
  let buf = "";
  for await (const part of res.body) {
    buf += dec.decode(part, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const data = buf.slice(0, i).split("\n").find((l) => l.startsWith("data:"));
      buf = buf.slice(i + 2);
      if (data) out.push(JSON.parse(data.slice(5)));
    }
  }
  return out;
}

for (const idea of IDEAS) {
  const before = (await sql("SELECT COALESCE(MAX(id), 0) AS n FROM llm_usage"))?.[0]?.n ?? null;
  const quality = {};
  console.log("\n=== " + idea.slice(0, 90) + "...");
  const t0 = Date.now();
  const p = await A.api("/api/v1/idea/plan", { method: "POST", body: { text: idea, question: "" } });
  if (!p.ok) { console.log("plan failed", p.status, await p.text()); continue; }
  const { plan } = await p.json();
  console.log(`plan in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${plan.title}`);
  console.log("  facets:", JSON.stringify(plan.facets));
  console.log("  semantic:", plan.semanticQuery.slice(0, 200));
  console.log("  keywords:", plan.keywordQueries.join(" | "));

  const t1 = Date.now();
  const s = await A.api("/api/v1/idea/search", { method: "POST", body: { semanticQuery: plan.semanticQuery, keywordQueries: plan.keywordQueries } });
  const ev = await events(s);
  const done = ev.find((e) => e.type === "done");
  const err = ev.find((e) => e.type === "error");
  if (!done) { console.log("search failed", err ?? s.status); continue; }
  const r = done.result;
  console.log(`search in ${((Date.now() - t1) / 1000).toFixed(1)} s: considered ${r.considered}, kept ${r.papers.length}, searches ${r.searched.filter((x) => x.ok).length}/${r.searched.length} ok, checks ${JSON.stringify(r.checked)}`);
  for (const x of r.searched.filter((y) => !y.ok)) console.log(`  FAILED ${x.source}/${x.kind}: ${x.error}`);
  const tc = Date.now();
  const withAbs = r.papers.filter((x) => (x.abstract?.length ?? 0) >= 80).slice(0, 8).map((x) => ({ id: x.id, title: x.title, year: x.year, abstract: x.abstract }));
  const question0 = IDEA_QUESTIONS[idea.slice(0, 20)] ?? "What results have similar approaches reported, and what data did they use?";
  if (dumpDir) {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(dumpDir, { recursive: true });
    writeFileSync(`${dumpDir}/idea-${++dumpN}.json`, JSON.stringify({ idea, plan, question: question0, papers: withAbs }, null, 1));
  }
  const cres = await A.api("/api/v1/idea/compare", { method: "POST", body: { title: plan.title, summary: plan.summary, facets: plan.facets, ideaExcerpt: idea, papers: withAbs } });
  const cev = await events(cres);
  const cdone = cev.find((e) => e.type === "done");
  if (!cdone) console.log("compare failed", cev.find((e) => e.type === "error") ?? cres.status);
  else {
    const c = cdone.comparison;
    console.log(`compare in ${((Date.now() - tc) / 1000).toFixed(1)} s: ${c.compared} papers, ${c.droppedClaims} claims dropped (quote not in the abstract), model ${c.model}`);
    quality.compare = { papers: c.compared, droppedClaims: c.droppedClaims, matched: c.comparisons.filter((x) => x.level && x.level !== "none").length, levels: c.comparisons.map((x) => x.level).join(","), coverage: c.coverage.map((r) => `${r.facet}:${r.status}`).join(",") };
    for (const row of c.coverage) console.log(`  ${row.facet.padEnd(10)} ${row.status.padEnd(10)} ${row.papers.slice(0, 2).map((p) => `${p.match}: "${p.quote.slice(0, 70)}"`).join(" | ")}`);
    console.log(`  combination: ${c.combination ? `${c.combination.found.length} of ${c.combination.compared}` : "n/a"}`);
    console.log("  levels: " + c.comparisons.map((x) => x.level).join(", "));
  }
  // M3: the second reading of the same papers
  const ti = Date.now();
  const question = IDEA_QUESTIONS[idea.slice(0, 20)] ?? "What results have similar approaches reported, and what data did they use?";
  const ires = await A.api("/api/v1/idea/insights", { method: "POST", body: { title: plan.title, summary: plan.summary, facets: plan.facets, question, papers: withAbs } });
  const iev = await events(ires);
  const idone = iev.find((e) => e.type === "done");
  if (!idone) console.log("insights failed", iev.find((e) => e.type === "error") ?? ires.status);
  else {
    const n = idone.insights;
    console.log(`insights in ${((Date.now() - ti) / 1000).toFixed(1)} s: ${n.papersRead} papers read, ${n.droppedClaims} claims dropped, model ${n.model}`);
    quality.insights = { papersRead: n.papersRead, droppedClaims: n.droppedClaims, openProblems: n.openProblems.length, outcomes: n.readings.reduce((a, x) => ((a[x.outcome.kind] = (a[x.outcome.kind] ?? 0) + 1), a), {}), withMethod: n.readings.filter((x) => x.method).length, withData: n.readings.filter((x) => x.data).length, answerStatements: n.answer?.statements.length ?? 0, opinion: n.opinion.length };
    console.log(`  open problems (${n.openProblems.length}): ` + n.openProblems.slice(0, 3).map((o) => `"${o.quote.slice(0, 80)}"`).join(" | "));
    const kinds = n.readings.reduce((a, x) => ((a[x.outcome.kind] = (a[x.outcome.kind] ?? 0) + 1), a), {});
    console.log(`  outcomes: ${JSON.stringify(kinds)}; with method ${n.readings.filter((x) => x.method).length}, with data ${n.readings.filter((x) => x.data).length}`);
    console.log(`  question: ${question}`);
    console.log(`  answer statements (${n.answer?.statements.length ?? "none asked"}): ` + (n.answer?.statements ?? []).map((s) => `${s.text ? "" : "[sentence only] "}"${(s.text ?? s.cites[0].quote).slice(0, 90)}"`).join(" | "));
    console.log(`  opinion (${n.opinion.length}): ` + n.opinion.map((o) => `"${o.slice(0, 80)}"`).join(" | "));
  }
  if (before !== null) {
    const rows = (await sql(`SELECT label, COUNT(*) AS calls, SUM(tokens_in) AS tin, SUM(tokens_out) AS tout, ROUND(SUM(cost_cents), 4) AS cents, SUM(ok = 0) AS failed FROM llm_usage WHERE id > ${before} GROUP BY label`)) ?? [];
    console.log("  what it used:");
    for (const u of rows) console.log(`    ${String(u.label).padEnd(14)} calls ${u.calls}  in ${String(u.tin).padStart(6)}  out ${String(u.tout).padStart(6)}  ${u.cents} cents${u.failed ? `  (${u.failed} failed)` : ""}`);
    const total = rows.reduce((a, u) => ({ tin: a.tin + u.tin, tout: a.tout + u.tout, cents: a.cents + u.cents }), { tin: 0, tout: 0, cents: 0 });
    console.log(`    TOTAL          in ${total.tin}  out ${total.tout}  ${total.cents.toFixed(3)} cents (about ${(total.cents / 100).toFixed(4)} dollars)`);
    results.push({ idea: idea.slice(0, 60), usage: rows, total, quality });
  }
  for (const [i, x] of r.papers.slice(0, 10).entries()) console.log(`  ${String(i + 1).padStart(2)}. ${x.year ?? "----"} ${x.title.slice(0, 95)}  [${x.foundBy.join(", ")}] ${x.doi ? "doi" : "no-doi"}${x.retracted ? " RETRACTED" : ""}${x.doiStatus?.startsWith("dropped") ? " DOI-DROPPED" : ""}`);
}
if (results.length) {
  const { mkdirSync, writeFileSync } = await import("node:fs");
  const out = new URL("./r2/results/", import.meta.url);
  mkdirSync(out, { recursive: true });
  writeFileSync(new URL(`idea-live-${new Date().toISOString().slice(0, 10)}${tag ? `-${tag}` : ""}.json`, out), JSON.stringify({ tag: tag ?? null, results }, null, 1));
  const mean = (f) => Math.round(results.reduce((a, r) => a + f(r), 0) / results.length);
  console.log(`\nmean per check over ${results.length}: in ${mean((r) => r.total.tin)}, out ${mean((r) => r.total.tout)}, ${(results.reduce((a, r) => a + r.total.cents, 0) / results.length).toFixed(3)} cents`);
}
process.exit(0);
