// Real-service check of Idea Check (Workers AI plan + OpenAlex semantic/keyword + Semantic Scholar + DOI/retraction checks). Needs a Worker
// started WITHOUT QA_STUB, with a Workers AI login and the real search keys from .dev.vars:
//   npx wrangler dev --port 8788 --var GOOGLE_CLIENT_ID:dev --var GOOGLE_CLIENT_SECRET:dev-secret --var DEV_IDP_URL:http://localhost:9911 --var ENABLE_DEV_ROUTES:1
//   node scripts/idea-live.mjs ["an idea in your own words"]
// Prints the plan and the closest papers for a few ideas so their quality can be judged by eye. Each idea costs about 4k model tokens
// and a few OpenAlex / Semantic Scholar calls.
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
const IDEAS = process.argv[2]
  ? [process.argv[2]]
  : [
      "I want to screen for glaucoma in rural clinics with no ophthalmologist. A health worker takes a photo of the back of the eye with a smartphone and a low-cost lens attachment, and a convolutional neural network on the phone flags eyes that need referral. I would test it on a few hundred patients against an ophthalmologist's reading.",
      "Using large language models to check whether the references in a PhD thesis really exist, by looking each one up in Crossref and OpenAlex, and flagging the ones whose authors or year do not match the real record.",
      "Can sensors on a tractor measure soil moisture while it ploughs, so that irrigation can be planned per field strip for smallholder farmers in semi-arid India?",
    ];

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "idea-live-1", email: "live@example.edu", email_verified: true, name: "Live Check" });
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
  const cres = await A.api("/api/v1/idea/compare", { method: "POST", body: { title: plan.title, summary: plan.summary, facets: plan.facets, ideaExcerpt: idea, papers: withAbs } });
  const cev = await events(cres);
  const cdone = cev.find((e) => e.type === "done");
  if (!cdone) console.log("compare failed", cev.find((e) => e.type === "error") ?? cres.status);
  else {
    const c = cdone.comparison;
    console.log(`compare in ${((Date.now() - tc) / 1000).toFixed(1)} s: ${c.compared} papers, ${c.droppedClaims} claims dropped (quote not in the abstract), model ${c.model}`);
    for (const row of c.coverage) console.log(`  ${row.facet.padEnd(10)} ${row.status.padEnd(10)} ${row.papers.slice(0, 2).map((p) => `${p.match}: "${p.quote.slice(0, 70)}"`).join(" | ")}`);
    console.log(`  combination: ${c.combination ? `${c.combination.found.length} of ${c.combination.compared}` : "n/a"}`);
    console.log("  levels: " + c.comparisons.map((x) => x.level).join(", "));
  }
  for (const [i, x] of r.papers.slice(0, 10).entries()) console.log(`  ${String(i + 1).padStart(2)}. ${x.year ?? "----"} ${x.title.slice(0, 95)}  [${x.foundBy.join(", ")}] ${x.doi ? "doi" : "no-doi"}${x.retracted ? " RETRACTED" : ""}${x.doiStatus?.startsWith("dropped") ? " DOI-DROPPED" : ""}`);
}
process.exit(0);
