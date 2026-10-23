// Answer-quality check for paper Q&A with the REAL models, on the 35 gold questions from the R2 spike (5 papers, one Hindi
// question per paper). Each paper is uploaded and indexed through the real pipeline (browser-style page batches), each question
// is asked through the real endpoint, and the answer is scored the way the spike did: every `must` pattern has to match.
//
//   npx wrangler dev --port 8788 --var GOOGLE_CLIENT_ID:dev --var GOOGLE_CLIENT_SECRET:dev-secret --var DEV_IDP_URL:http://localhost:9911
//   node scripts/qa-eval.mjs <folder with <paper>.pdf and <paper>.txt>   [--only=attention,milk]
//
// The .txt files are pdftotext output with pages separated by "[[page N]]" (see scripts/r2/README.md). Each paper uses its own
// throwaway account, so the per-user daily token quota does not interrupt a run. Needs a Workers AI login; costs free-tier neurons.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
const dir = process.argv[2];
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
// --tag=<name> names the result file, so runs of different models or settings (docs/spikes/R5-cost.md) sit side by side
const tag = process.argv.find((a) => a.startsWith("--tag="))?.slice(6);

// What each answer really used, read from the ledger through the dev-only SQL route (needs ENABLE_DEV_ROUTES=1 on the Worker; without it the numbers are left out).
const sql = async (statement) => {
  try {
    const r = await fetch(`${APP}/api/v1/dev/sql`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: [statement] }) });
    return r.ok ? (await r.json()).results[0] : null;
  } catch {
    return null;
  }
};
const lastUsageId = async () => (await sql("SELECT COALESCE(MAX(id), 0) AS n FROM llm_usage"))?.[0]?.n ?? null;
if (!dir) throw new Error("usage: node scripts/qa-eval.mjs <folder with pdf + txt> [--only=a,b]");

const { questions } = JSON.parse(readFileSync(fileURLToPath(new URL("./r2/questions.json", import.meta.url)), "utf8"));
const papers = [...new Set(questions.map((q) => q.paper))].filter((p) => !only || only.includes(p));
const idp = await startFakeIdp(9911);

const rows = [];
for (const paper of papers) {
  const pdf = readFileSync(join(dir, `${paper}.pdf`));
  const pages = readFileSync(join(dir, `${paper}.txt`), "utf8").split(/\[\[page \d+\]\]/).map((t) => t.trim()).filter(Boolean);
  idp.setUser({ sub: `qa-${paper}`, email: `qa-${paper}@example.com`, email_verified: true, name: `QA ${paper}` });
  const c = createClient(APP);
  await c.follow(`${APP}/api/v1/auth/google/start`);
  await c.ack(); // the privacy note has to be agreed to before an upload (since 22 Oct); without it the weekly run fails with a 403

  const up = await c.send(`${APP}/api/v1/documents`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/pdf", "X-Filename": `${paper}.pdf` }, body: pdf });
  const upBody = await up.text();
  if (!up.ok) {
    console.error(`could not upload ${paper}: HTTP ${up.status} ${upBody.slice(0, 300)} (signed in as: ${JSON.stringify(await c.me().catch(() => null))})`);
    process.exit(1);
  }
  const doc = JSON.parse(upBody).document;
  const t0 = Date.now();
  for (let i = 0; i < pages.length; i += 10) {
    const send = () => c.api(`/api/v1/documents/${doc.id}/pages`, { method: "POST", body: { pages: pages.slice(i, i + 10).map((text, k) => ({ page: i + k + 1, text })) } });
    let r = await send();
    if (!r.ok) r = await send(); // the browser client retries a failed batch once too
    if (!r.ok) throw new Error(`indexing failed: ${r.status} ${await r.text()}`);
  }
  const fin = (await (await c.api(`/api/v1/documents/${doc.id}/finish`, { method: "POST", body: { pages: pages.length } })).json()).document;
  console.log(`\n${paper}: ${pages.length} pages, ${fin.chunkCount} chunks, indexed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  for (const q of questions.filter((x) => x.paper === paper)) {
    const before = await lastUsageId();
    const t1 = Date.now();
    const res = await c.api(`/api/v1/documents/${doc.id}/ask`, { method: "POST", body: { question: q.q } });
    const body = await res.json();
    const ms = Date.now() - t1;
    const use = before === null ? null : (await sql(`SELECT SUM(tokens_in) AS tin, SUM(tokens_out) AS tout, SUM(tokens_cached) AS cached, SUM(cost_cents) AS cents, COUNT(*) AS calls FROM llm_usage WHERE id > ${before}`))?.[0] ?? null;
    if (!res.ok) {
      rows.push({ id: q.id, lang: q.lang, answerable: q.answerable, error: `${res.status} ${body.type}`, ms });
      console.log(`  ${q.id} ERROR ${res.status} ${body.type}: ${body.detail ?? body.title}`);
      continue;
    }
    const a = body.answer;
    const haystack = `${a.answer} ${a.citations.map((x) => x.quote).join(" ")}`;
    const correct = q.answerable ? a.found && q.must.every((re) => new RegExp(re, "i").test(haystack)) : !a.found;
    const cited = q.answerable && q.evidence ? a.citations.some((x) => new RegExp(q.evidence, "i").test(x.quote)) : null;
    rows.push({ id: q.id, lang: q.lang, answerable: q.answerable, found: a.found, verified: a.verified, correct, cited, ms, use, answer: a.answer.slice(0, 300) });
    console.log(`  ${q.id} ${correct ? "ok  " : "MISS"} ${a.found ? (a.verified ? "verified" : "UNVERIFIED") : "not-found"}  ${(ms / 1000).toFixed(1)}s  ${a.answer.replace(/\s+/g, " ").slice(0, 110)}`);
  }
  await c.api("/api/v1/account", { method: "DELETE", body: { confirm: "DELETE" } });
}
await idp.close?.();

const done = rows.filter((r) => !r.error);
function usageSummary(list) {
  const used = list.filter((r) => r.use?.calls);
  const sum = (k) => used.reduce((a, r) => a + (r.use[k] ?? 0), 0);
  const mean = (k) => Math.round(sum(k) / used.length);
  return {
    tokens_in_per_answer: mean("tin"),
    tokens_out_per_answer: mean("tout"),
    tokens_cached_per_answer: mean("cached"),
    cost_per_answer_cents: (sum("cents") / used.length).toFixed(4),
    model_calls_per_answer: (sum("calls") / used.length).toFixed(2),
  };
}
const ans = done.filter((r) => r.answerable);
const un = done.filter((r) => !r.answerable);
const found = done.filter((r) => r.found);
const pct = (a, b) => (b ? `${a}/${b} (${Math.round((a / b) * 100)}%)` : "n/a");
const summary = {
  answerable_correct: pct(ans.filter((r) => r.correct).length, ans.length),
  hindi_correct: pct(ans.filter((r) => r.lang === "hi" && r.correct).length, ans.filter((r) => r.lang === "hi").length),
  unanswerable_declined: pct(un.filter((r) => r.correct).length, un.length),
  answers_with_verified_sources: pct(found.filter((r) => r.verified).length, found.length),
  supporting_passage_cited: pct(ans.filter((r) => r.cited).length, ans.filter((r) => r.cited !== null).length),
  errors: rows.length - done.length,
  ...(done.some((r) => r.use?.calls) ? usageSummary(done) : {}),
  median_seconds: done.length ? (done.map((r) => r.ms).sort((a, b) => a - b)[Math.floor(done.length / 2)] / 1000).toFixed(1) : "n/a",
};
console.log("\n=== Q&A quality (real models) ===");
for (const [k, v] of Object.entries(summary)) console.log(`${k.padEnd(32)} ${v}`);
const out = fileURLToPath(new URL("./r2/results/", import.meta.url));
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `qa-eval-${new Date().toISOString().slice(0, 10)}${tag ? `-${tag}` : ""}.json`), JSON.stringify({ tag: tag ?? null, summary, rows }, null, 1));

// --gate: exit 1 when quality is below the Phase 1 exit gate (answerable >= 85% correct, unanswerable >= 90% declined, every answer's
// sources verified, no request errors). The weekly workflow uses it, so a regression in the model or the prompt is noticed within a week.
if (process.argv.includes("--gate")) {
  const share = (a, b) => (b ? a / b : 1);
  const checks = [
    ["answerable questions answered correctly >= 85%", share(ans.filter((r) => r.correct).length, ans.length) >= 0.85],
    ["unanswerable questions declined >= 90%", share(un.filter((r) => r.correct).length, un.length) >= 0.9],
    ["answers with every source verified >= 90%", share(found.filter((r) => r.verified).length, found.length) >= 0.9],
    ["at most 2 of the questions failed to get an answer from the service (one transient hiccup is normal)", rows.length - done.length <= 2],
  ];
  for (const [name, pass] of checks) console.log(`${pass ? "  pass" : "  FAIL"}  ${name}`);
  process.exit(checks.every(([, pass]) => pass) ? 0 : 1);
}
process.exit(0);
