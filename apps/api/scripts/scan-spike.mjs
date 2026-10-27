// Spike R11: what would a "literature scan" cost, and does running its workers at the same time help? (docs/design/research-patterns.md, section 4; docs/spikes/R11-scan-cost.md)
//
// A scan would split a question into sub-questions and give each to a worker that searches and writes a checked answer, then merge. This does not build that. It measures the worker step
// with the real thing, the prompt box's own search-and-answer (POST /api/v1/chat, real search providers, the real model, the real checks), on the DEPLOYED STAGING Worker:
//   one run with the five sub-questions one after the other (what the sum of five answers costs in time),
//   one run with the same five at the same time, from one account (what parallel workers would do to the shared Crossref lane, the model and the person's allowance).
// For each worker: time to the first event, to the papers, to the written answer, and the tokens the model used (read from the staging database, by account and time).
//
//   node scripts/staging-session.mjs make 2 <file>        (staging only; erase afterwards with: node scripts/staging-session.mjs cleanup)
//   APP=https://scholar-staging.shodhsetu.workers.dev SESSIONS=<file> node scripts/scan-spike.mjs [--topic="..."]
//
// What it cannot say: the planning and merging calls (small, estimated from the answers' size), a scan on a production-sized load, or how good a merged report would be.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "./test-client.mjs";

const APP = process.env.APP;
if (!APP || !/staging/.test(APP) || !process.env.SESSIONS) throw new Error("set APP to the staging address and SESSIONS to a file made by staging-session.mjs: this runs against staging only");
const SESSIONS = JSON.parse(readFileSync(process.env.SESSIONS, "utf8"));
if (SESSIONS.length < 2) throw new Error("two accounts are needed (one for each run: the daily allowance is counted per account)");
const topic = process.argv.find((a) => a.startsWith("--topic="))?.slice(8);

const SET_A = [
  "How strong is the link between air pollution and asthma in children?",
  "Which air pollutants are most associated with childhood asthma attacks?",
  "How is exposure to traffic pollution measured in studies of asthma?",
  "What do studies find about indoor air quality and asthma in children?",
  "What interventions reduce air pollution exposure for children with asthma?",
];
const SET_B = [
  "How effective is the BCG vaccine against adult tuberculosis?",
  "What new tuberculosis vaccine candidates are in clinical trials?",
  "How does BCG vaccination protect infants in high-burden countries?",
  "What are the main obstacles to developing a better tuberculosis vaccine?",
  "What correlates of protection have been proposed for tuberculosis vaccines?",
];
const SUBQUESTIONS = SET_A;

const api = fileURLToPath(new URL("..", import.meta.url));
const WRANGLER = fileURLToPath(new URL("../../../node_modules/wrangler/bin/wrangler.js", import.meta.url));
const d1 = (sql) => {
  const r = spawnSync(process.execPath, [WRANGLER, "d1", "execute", "scholar-db-staging", "--remote", "--env", "staging", "--json", "--command", sql], { cwd: api, encoding: "utf8", maxBuffer: 20_000_000 });
  if (r.status !== 0) throw new Error("wrangler failed: " + (r.stderr || r.stdout).slice(-400));
  return JSON.parse(r.stdout.slice(r.stdout.indexOf("[")))[0]?.results ?? [];
};

const clientFor = (i) => {
  const c = createClient(APP);
  const [k, ...v] = SESSIONS[i].split("=");
  c.jar.set(k, v.join("="));
  return c;
};

/** One worker: the question through the prompt box, with the time of each step. */
async function worker(c, question) {
  const t0 = Date.now();
  const res = await c.send(`${APP}/api/v1/chat`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ mode: "search", message: question }) });
  const out = { question, status: res.status, tFirst: null, tPapers: null, tAnswer: null, tDone: null, papers: 0, words: 0, answered: null, reason: null, steps: {}, error: null };
  if (!res.ok) return { ...out, error: `http_${res.status}` };
  try {
    const dec = new TextDecoder();
    let buf = "";
    for await (const part of res.body) {
      buf += dec.decode(part, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const data = buf.slice(0, i).split("\n").find((l) => l.startsWith("data:"));
        buf = buf.slice(i + 2);
        if (!data) continue;
        const e = JSON.parse(data.slice(5));
        const t = Date.now() - t0;
        out.tFirst ??= t;
        if (e.type === "step") out.steps[e.step] ??= t;
        if (e.type === "papers" && e.final) { out.tPapers = t; out.papers = e.results.length; }
        if (e.type === "answer") { out.tAnswer = t; out.words = e.answer.text.split(/\s+/).filter(Boolean).length; }
        if (e.type === "done") { out.tDone = t; out.answered = e.answered; out.reason = e.reason ?? null; }
        if (e.type === "error") out.error = e.code;
      }
    }
  } catch (e) {
    out.error = `stream_cut (${e?.cause?.code ?? e?.message})`;
  }
  return out;
}

const s = (ms) => (ms == null ? "   - " : (ms / 1000).toFixed(1).padStart(5));
const show = (label, rows, wall) => {
  console.log(`\n${label}  (wall time ${(wall / 1000).toFixed(1)} s)`);
  console.log("  first  papers  answer  done   papers  words  result");
  for (const r of rows) console.log(`  ${s(r.tFirst)}  ${s(r.tPapers)}   ${s(r.tAnswer)}  ${s(r.tDone)}  ${String(r.papers).padStart(5)}  ${String(r.words).padStart(5)}  ${r.error ?? (r.answered ? "answered" : "not answered: " + r.reason)}  ${r.question.slice(0, 50)}`);
};

async function tokensFor(email, from) {
  const rows = d1(`SELECT COALESCE(label, '-') AS label, COUNT(*) AS calls, COALESCE(SUM(tokens_in), 0) AS tin, COALESCE(SUM(tokens_out), 0) AS tout FROM llm_usage WHERE subject = (SELECT id FROM users WHERE email = '${email}') AND ts >= '${from}' GROUP BY label ORDER BY label`);
  return rows;
}

console.log(`APP ${APP}; ${SUBQUESTIONS.length} sub-questions`);
const emails = d1("SELECT email FROM users WHERE email LIKE 'oa-check-%@example.invalid' ORDER BY created_at, email").map((r) => r.email);
if (emails.length < 2) throw new Error("the two accounts of the sessions file were not found in the staging database");
const stamp = () => d1("SELECT datetime('now') AS t")[0].t;

// phase 1: set A, one after the other, nothing cached yet (account 1)
const fromA = stamp();
let t0 = Date.now();
const seq = [];
const A = clientFor(0);
for (const q of SET_A) seq.push(await worker(A, q));
const seqWall = Date.now() - t0;
const tokA = await tokensFor(emails[0], fromA);

// phase 2: set B, all at once, nothing cached yet either (account 2): the fair comparison
const fromB = stamp();
t0 = Date.now();
const B = clientFor(1);
const par = await Promise.all(SET_B.map((q) => worker(B, q)));
const parWall = Date.now() - t0;
const tokB = await tokensFor(emails[1], fromB);

// phase 3: set A again, all at once: now the searches are kept in the public cache (what a repeated or overlapping scan would see)
t0 = Date.now();
const warm = await Promise.all(SET_A.map((q) => worker(B, q)));
const warmWall = Date.now() - t0;

show("ONE AFTER THE OTHER (set A: air pollution and asthma, searches not kept yet)", seq, seqWall);
show("ALL AT ONCE (set B: tuberculosis vaccines, searches not kept yet)", par, parWall);
show("ALL AT ONCE AGAIN (set A, searches now kept)", warm, warmWall);

const sum = (rows, f) => rows.reduce((n, r) => n + (r[f] ?? 0), 0);
const tot = (rows) => ({ calls: sum(rows, "calls"), tin: sum(rows, "tin"), tout: sum(rows, "tout") });
console.log("\nmodel use (tokens in / out by what the call was for):");
for (const [name, rows] of [["one after the other", tokA], ["all at once", tokB]]) {
  console.log(`  ${name}: ${rows.map((r) => `${r.label} x${r.calls} ${r.tin}/${r.tout}`).join("; ")}`);
}
const a = tot(tokA);
const b = tot(tokB);
const median = (xs) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];
console.log("\nsummary");
console.log(`  time:   one after the other ${(seqWall / 1000).toFixed(1)} s; all at once ${(parWall / 1000).toFixed(1)} s (${(seqWall / parWall).toFixed(1)}x faster, different topics, neither helped by the cache); all at once with the searches kept ${(warmWall / 1000).toFixed(1)} s`);
console.log(`  to the papers (median): alone ${(median(seq.map((r) => r.tPapers ?? 0)) / 1000).toFixed(1)} s, with four others at the same time ${(median(par.map((r) => r.tPapers ?? 0)) / 1000).toFixed(1)} s, with the searches kept ${(median(warm.map((r) => r.tPapers ?? 0)) / 1000).toFixed(1)} s`);
console.log(`  tokens: ${a.tin + a.tout} for ${SUBQUESTIONS.length} answers one after the other (${Math.round((a.tin + a.tout) / SUBQUESTIONS.length)} each), ${b.tin + b.tout} at once; the daily allowance is 60,000 a person`);
console.log(`  answered: ${seq.filter((r) => r.answered).length} of 5 one after the other, ${par.filter((r) => r.answered).length} of 5 at once, ${warm.filter((r) => r.answered).length} of 5 at once with the searches kept; errors: ${[...seq, ...par, ...warm].filter((r) => r.error).map((r) => r.error).join(", ") || "none"}`);
