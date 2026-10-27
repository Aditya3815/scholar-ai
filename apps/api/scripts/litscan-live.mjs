// Literature scan on the DEPLOYED STAGING Worker with the real model and the real search sources (docs/design/litscan.md, "Measured"). Staging only: it refuses any other address.
//   node scripts/staging-session.mjs make 2 <file>        (erase afterwards with: node scripts/staging-session.mjs cleanup)
//   APP=https://scholar-staging.shodhsetu.workers.dev SESSIONS=<file> node scripts/litscan-live.mjs [--only=english|hinglish|cancel]
// For each scenario it plans, starts and follows a scan to its end, and prints what a person would see (the plan, the time to each part, every section), the tokens the model used
// by what the call was for (read from the staging database), and checks the stream against the event rule. Nothing here is a pass/fail test of quality: it is for a person to read.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient } from "./test-client.mjs";
import { checkStream, reportStreams } from "./lib/stream-rule.mjs";
import { assembleReport } from "../../../packages/shared/src/litscan.ts";

const APP = process.env.APP;
if (!APP || !/staging/.test(APP) || !process.env.SESSIONS) throw new Error("set APP to the staging address and SESSIONS to a file made by staging-session.mjs: this runs against staging only");
const SESSIONS = JSON.parse(readFileSync(process.env.SESSIONS, "utf8"));
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
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
const emails = d1("SELECT email, id FROM users WHERE email LIKE 'oa-check-%@example.invalid' ORDER BY created_at, email");
const userIdOf = (i) => emails[i].id;
const s = (ms) => (ms / 1000).toFixed(1).padStart(5);
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

async function follow(c, id, { stopAfterParts = Infinity, label = "" } = {}) {
  const t0 = Date.now();
  const res = await c.send(`${APP}/api/v1/litscan/${id}/events`, { headers: { Accept: "text/event-stream" } });
  const events = [];
  const dec = new TextDecoder();
  let buf = "";
  let parts = 0;
  const reader = res.body.getReader();
  loop: for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const data = buf.slice(0, i).split("\n").find((l) => l.startsWith("data:"));
      buf = buf.slice(i + 2);
      if (!data) continue;
      const e = JSON.parse(data.slice(5));
      e.t = Date.now() - t0;
      events.push(e);
      if (e.type === "part" && ++parts >= stopAfterParts) { await reader.cancel(); break loop; }
    }
  }
  if (stopAfterParts === Infinity) checkStream("litscan", events.map(({ t, ...e }) => e), label);
  return events;
}

const tokens = (userId, from) => d1(`SELECT COALESCE(label, '-') AS label, COUNT(*) AS calls, COALESCE(SUM(tokens_in), 0) AS tin, COALESCE(SUM(tokens_out), 0) AS tout, COALESCE(SUM(ok), 0) AS good FROM llm_usage WHERE subject = '${userId}' AND ts >= '${from}' GROUP BY label ORDER BY label`);
const stamp = () => d1("SELECT datetime('now') AS t")[0].t;

async function scan(c, userId, topic, language, { edit } = {}) {
  const from = stamp();
  const t0 = Date.now();
  const planRes = await c.api("/api/v1/litscan/plan", { method: "POST", body: { topic, language } });
  const planBody = await planRes.json();
  if (!planRes.ok) throw new Error(`plan failed: ${JSON.stringify(planBody)}`);
  const plan = planBody.plan;
  const tPlan = Date.now() - t0;
  console.log(`\nTOPIC: ${topic}\nplan in ${s(tPlan)} s, language ${plan.language}, estimate ${plan.allowance.estimate} of ${plan.allowance.limit} (used ${plan.allowance.used})`);
  plan.items.forEach((i, k) => console.log(`  ${k + 1}. ${i.question}\n       search: ${i.searchQuery}`));
  const items = edit ? edit(plan.items) : plan.items;
  const startRes = await c.api("/api/v1/litscan", { method: "POST", body: { topic: plan.topic, language: plan.language, items } });
  const started = await startRes.json();
  if (!startRes.ok) throw new Error(`start failed: ${JSON.stringify(started)}`);
  return { id: started.id, plan, items, from, t0: Date.now(), tPlan };
}

function show(r, events, snapshot) {
  const stages = {};
  for (const e of events) if (e.type === "worker") (stages[e.idx] ??= {})[e.stage] = e.t;
  console.log("\ntime of each event (s since the stream opened):");
  for (const e of events) {
    if (e.type === "worker") console.log(`  ${s(e.t)}  worker ${e.idx + 1} ${e.stage}`);
    else if (e.type === "part") console.log(`  ${s(e.t)}  part ${e.part.idx + 1}: ${e.part.status === "answered" ? `answered (${e.part.found} papers, ${e.part.sources.length} cited)` : `gap: ${e.part.reason} (${e.part.found} papers)`}`);
    else if (e.type === "done") console.log(`  ${s(e.t)}  done: ${e.state}, ${e.answered} answered, ${e.gaps} gaps`);
  }
  const report = assembleReport(snapshot.items, Object.fromEntries(snapshot.parts.map((p) => [p.idx, p])));
  console.log("\nTHE REPORT:");
  for (const sec of report.sections) {
    console.log(`\n## ${sec.question}`);
    if (sec.status === "answered") {
      console.log(sec.text);
      for (const ev of sec.evidence) console.log(`   [${ev.g}] “${ev.sentence}”`);
    } else console.log(sec.status === "gap" ? `(no written answer: ${sec.reason})` : "(not finished)");
  }
  console.log("\nSOURCES:");
  for (const src of report.sources) console.log(`  ${src.g}. ${src.title} (${src.year ?? "n.d."}) ${src.doi ? "doi:" + src.doi : ""}`);
}

const report = (rows) => rows.map((x) => `${x.label} x${x.calls} (${x.good} ok) ${x.tin}/${x.tout}`).join("; ");
const total = (rows) => rows.reduce((n, x) => n + x.tin + x.tout, 0);

try {
  if (!only || only === "english") {
    console.log("=== ENGLISH TOPIC");
    const c = clientFor(0);
    const r = await scan(c, userIdOf(0), "air pollution and childhood asthma", "auto");
    const ev = await follow(c, r.id, { label: "english" });
    const wall = Date.now() - r.t0;
    const snap = (await (await c.api(`/api/v1/litscan/${r.id}`)).json()).scan;
    show(r, ev, snap);
    await new Promise((x) => setTimeout(x, 1500));
    const tk = tokens(userIdOf(0), r.from);
    console.log(`\nwall time from start to done: ${s(wall)} s; tokens: ${total(tk)} (${report(tk)})`);
    ok(snap.state === "completed", "the scan completed");
    ok(ev.at(-1).type === "done", "the stream ended with done");
    ok(total(tk) <= r.plan.allowance.estimate, `it used no more than the estimate it showed (${total(tk)} of ${r.plan.allowance.estimate})`);
  }

  if (!only || only === "hinglish") {
    console.log("\n=== HINGLISH TOPIC");
    const c = clientFor(1);
    const r = await scan(c, userIdOf(1), "kya mobile phone ka zyada use bachchon ki aankhon ko nuksan pahunchata hai", "auto");
    ok(r.plan.language === "hinglish", "the language was chosen as Hinglish from the topic");
    const ev = await follow(c, r.id, { label: "hinglish" });
    const wall = Date.now() - r.t0;
    const snap = (await (await c.api(`/api/v1/litscan/${r.id}`)).json()).scan;
    show(r, ev, snap);
    await new Promise((x) => setTimeout(x, 1500));
    const tk = tokens(userIdOf(1), r.from);
    console.log(`\nwall time from start to done: ${s(wall)} s; tokens: ${total(tk)} (${report(tk)})`);
    ok(snap.state === "completed", "the scan completed");
  }

  if (!only || only === "cancel") {
    console.log("\n=== CANCEL AND COME BACK (real Workflow)");
    const c = clientFor(0);
    const r = await scan(c, userIdOf(0), "tuberculosis vaccines for adults", "en");
    const first = await follow(c, r.id, { stopAfterParts: 1, label: "partial" });
    const seen = first.at(-1);
    console.log(`  read until the first part (${s(seen.t)} s), then closed the stream like a closed tab`);
    const snapMid = (await (await c.api(`/api/v1/litscan/${r.id}`)).json()).scan;
    ok(snapMid.parts.length >= 1, "a second look at the scan, while it runs, already has that part");
    const lastSeq = snapMid.seq;
    const back = await follow(c, r.id, { label: "reconnect" }).catch(() => []);
    ok(back.length > 0, "a stream opened again later still works (it replays from the start, then goes on)");
    // second scan to cancel: the first has ended by now; start a fresh one and cancel it quickly
    const r2 = await scan(c, userIdOf(0), "malaria vaccine trials in children", "en");
    // cancel once at least one sub-question is finished, while others are still being written
    for (let i = 0; i < 60; i++) {
      const s0 = (await (await c.api(`/api/v1/litscan/${r2.id}`)).json()).scan;
      if (s0.parts.length >= 1 && s0.parts.length < s0.total) break;
      await new Promise((x) => setTimeout(x, 1500));
    }
    const t1 = Date.now();
    const cancel = await c.api(`/api/v1/litscan/${r2.id}/cancel`, { method: "POST" });
    console.log(`  cancel answered ${cancel.status} in ${Date.now() - t1} ms`);
    const at = (await (await c.api(`/api/v1/litscan/${r2.id}`)).json()).scan;
    await new Promise((x) => setTimeout(x, 25_000));
    const later = (await (await c.api(`/api/v1/litscan/${r2.id}`)).json()).scan;
    ok(at.state === "canceled" && later.state === "canceled", "the scan is canceled");
    ok(at.parts.length >= 1 && later.parts.length === at.parts.length, `nothing was added after the cancel (${at.parts.length} parts then, ${later.parts.length} 25 s later)`);
    const inst = spawnSync(process.execPath, [WRANGLER, "workflows", "instances", "describe", "scholar-litscan-staging", `litscan-${r2.id}`], { cwd: api, encoding: "utf8" });
    console.log("  the workflow instance after the cancel:", (inst.stdout || inst.stderr).split(/\r?\n/).filter((l) => /status|Status/.test(l)).slice(0, 2).join(" | ").slice(0, 200));
    void lastSeq;
  }
  reportStreams(ok);
} catch (e) {
  console.error(e);
  failures++;
}
console.log(failures === 0 ? "\nlive run finished, no check failed" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
