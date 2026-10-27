// Literature scan (docs/design/litscan.md): the real Worker with a local D1 and a local Workflow, the fake identity provider, and the offline stand-ins for the model and the search
// (QA_STUB=1: src/litscan/stub.ts). `npm run integration -w apps/api` starts everything. The words of a sub-question steer the stand-ins: "nothing" finds no papers, "unanswerable"
// makes the model say the papers do not answer, "hallucinate" makes it cite a sentence that does not exist, "boom" makes the model service fail, "snail" makes the answer take 5 s.
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";
import { checkStream, reportStreams } from "./lib/stream-rule.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const idp = await startFakeIdp(9911);
const login = async (sub, email, name, { ack = true } = {}) => {
  idp.setUser({ sub, email, email_verified: true, name });
  const c = createClient(APP);
  await c.follow(`${APP}/api/v1/auth/google/start`);
  if (ack) await c.ack();
  return c;
};
const sql = async (...statements) => (await (await fetch(`${APP}/api/v1/dev/sql`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: statements }) })).json()).results ?? [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const item = (question, searchQuery = question.toLowerCase().replace(/[^a-z ]/g, "")) => ({ question, searchQuery });
const plan = (c, body, origin = APP) => c.api("/api/v1/litscan/plan", { method: "POST", body, origin });
const start = (c, body, origin = APP) => c.api("/api/v1/litscan", { method: "POST", body, origin });
const get = async (c, id) => (await c.api(`/api/v1/litscan/${id}`)).json();

/** Reads the event stream to its end (or to `stopAfter` events), and checks it against the event rule when it ended by itself. */
async function events(c, id, { after = 0, stopAfter = Infinity, label = "" } = {}) {
  const res = await c.send(`${APP}/api/v1/litscan/${id}/events?after=${after}`, { headers: { Accept: "text/event-stream" } });
  if (!res.ok) return { res, events: [] };
  const out = [];
  const dec = new TextDecoder();
  let buf = "";
  const ctl = res.body.getReader();
  outer: for (;;) {
    const { done, value } = await ctl.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const data = buf.slice(0, i).split("\n").find((l) => l.startsWith("data:"));
      buf = buf.slice(i + 2);
      if (data) out.push(JSON.parse(data.slice(5)));
      if (out.length >= stopAfter) { await ctl.cancel(); break outer; }
    }
  }
  if (out.length < stopAfter) checkStream("litscan", out, label || id.slice(0, 8));
  return { res, events: out };
}
const of = (list, type) => list.filter((e) => e.type === type);
const waitEnded = async (c, id, ms = 60_000) => {
  const t0 = Date.now();
  for (;;) {
    const { scan } = await get(c, id);
    if (scan.state !== "running") return scan;
    if (Date.now() - t0 > ms) throw new Error(`the scan did not end in ${ms} ms`);
    await sleep(300);
  }
};

const PLAIN = [item("How strong is the link?", "air pollution asthma"), item("How is exposure measured?", "traffic exposure measurement")];
const FOUR = [...PLAIN, item("Which pollutants matter?", "pollutants asthma attacks"), item("What helps children?", "interventions asthma children")];

try {
  const A = await login("ls-a", "ls-a@example.com", "Asha");
  const B = await login("ls-b", "ls-b@example.com", "Bimal");
  const raw = await login("ls-raw", "ls-raw@example.com", "Chitra", { ack: false });
  const anon = createClient(APP);

  console.log("who may use it");
  ok((await plan(anon, { topic: "air pollution and asthma" })).status === 401 && (await start(anon, { topic: "air pollution and asthma", language: "en", items: PLAIN })).status === 401, "a person who is not signed in is refused");
  ok((await anon.api("/api/v1/litscan")).status === 401 && (await anon.api("/api/v1/litscan/00000000-0000-4000-8000-000000000000")).status === 401, "the list and a scan are not shown to a visitor");
  ok((await plan(A, { topic: "air pollution and asthma" }, null)).status === 403 && (await start(A, { topic: "air pollution and asthma", language: "en", items: PLAIN }, null)).status === 403, "a cross-origin request is refused");
  const noAck = await plan(raw, { topic: "air pollution and asthma" });
  ok(noAck.status === 403 && (await noAck.json()).type === "privacy_ack_required", "the privacy note has to be read first (the topic is the person's own text)");
  ok((await start(raw, { topic: "air pollution and asthma", language: "en", items: PLAIN })).status === 403, "...before a scan can be started as well");

  console.log("what is accepted");
  ok((await plan(A, { topic: "short" })).status === 400 && (await plan(A, { topic: "x".repeat(401) })).status === 400 && (await plan(A, {})).status === 400, "a topic that is too short, too long or missing is refused");
  const bad = async (b) => (await start(A, b)).status;
  ok((await bad({ topic: "air pollution and asthma", language: "en", items: [item("Only one?", "only one here")] })) === 400, "a plan with one sub-question is refused (a scan needs two or more)");
  ok((await bad({ topic: "air pollution and asthma", language: "en", items: "nope" })) === 400 && (await bad({ language: "en", items: PLAIN })) === 400, "a plan that is not a list, or without a topic, is refused");
  ok((await bad({ topic: "air pollution and asthma", language: "en", items: [item("Same?", "same words"), item("Same again?", "same words")] })) === 400, "two sub-questions with the same search words count as one");
  ok((await A.api("/api/v1/litscan", { method: "POST", body: undefined })).status === 400, "garbage is refused");
  ok((await sql("SELECT COUNT(*) AS n FROM litscans"))[0][0].n === 0, "none of that started a scan");
  ok((await A.api("/api/v1/litscan/not-an-id")).status === 404 && (await A.api("/api/v1/litscan/00000000-0000-4000-8000-000000000000")).status === 404, "a scan that does not exist is not found");

  console.log("the plan");
  const p = await (await plan(A, { topic: "air pollution and childhood asthma" })).json();
  ok(p.plan?.items?.length >= 2 && p.plan.items.every((i) => i.question && i.searchQuery), "the topic becomes sub-questions, each with its question and its search words");
  ok(p.plan.language === "en" && p.plan.topic === "air pollution and childhood asthma", "an English topic is answered in English by default");
  ok(p.plan.allowance.limit === 60000 && p.plan.allowance.used === 0 && p.plan.allowance.estimate === p.plan.items.length * 3000, "it says what the scan is expected to use, of what the person has today");
  ok((await (await plan(A, { topic: "kya air pollution se bachchon me asthma hota hai", language: "auto" })).json()).plan.language === "hinglish", "a Hinglish topic is answered in Hinglish when the language is left on automatic");
  ok((await (await plan(A, { topic: "kya air pollution se bachchon me asthma hota hai", language: "en" })).json()).plan.language === "en", "...and in English when the person chooses English");
  ok((await sql("SELECT COUNT(*) AS n FROM litscans"))[0][0].n === 0, "planning stores nothing");

  console.log("a scan from start to end");
  const mixed = [
    item("How strong is the link?", "air pollution asthma"),
    item("nothing found for this one?", "nothing here at all"),
    item("unanswerable question about causes?", "unanswerable causes"),
    item("hallucinate a claim please?", "hallucinate claim"),
    item("boom the model fails?", "boom failure words"),
  ];
  const started = await start(A, { topic: "air pollution and childhood asthma", language: "hinglish", items: mixed });
  const { id } = await started.json();
  ok(started.status === 201 && /^[0-9a-f-]{36}$/.test(id), "an approved plan starts a scan and gives its id");
  const s1 = await events(A, id, { label: "full scan" });
  const types = s1.events.map((e) => e.type);
  ok(s1.res.status === 200 && types[0] === "progress" && types.at(-1) === "done" && types.filter((t) => t === "done").length === 1, "the stream begins with the progress and ends with exactly one done");
  ok(of(s1.events, "started")[0]?.total === 5 && of(s1.events, "part").length === 5, "it says how many sub-questions there are and delivers one part for each");
  const prog = of(s1.events, "progress");
  ok(prog.length === 6 && prog.every((e, i) => e.done === i && e.total === 5), "progress counts 0 to 5 and never goes back");
  ok(of(s1.events, "worker").every((e) => e.idx >= 0 && e.idx < 5 && ["searching", "reading"].includes(e.stage) && Object.keys(e).sort().join() === "idx,seq,stage,type"), "worker events carry a place and a stage and no words");
  const parts = Object.fromEntries(of(s1.events, "part").map((e) => [e.part.idx, e.part]));
  ok(parts[0].status === "answered" && parts[0].text.includes("[1]") && parts[0].sources[0]?.doi === "10.1000/glaucoma.1" && parts[0].citations[0]?.sentence.length > 10, "a sub-question the papers answer has a checked answer, its sentence and a real source");
  ok(parts[1].reason === "nothing_found" && parts[1].found === 0, "no papers found: a gap that says so");
  ok(parts[2].reason === "not_answered" && parts[3].reason === "not_grounded", "an answer the papers do not support is a gap, and a claim with no sentence behind it is never shown");
  ok(parts[4].status === "gap" && parts[4].reason === "unavailable", "a model that keeps failing is a gap after its tries, and the other four are not touched");
  const done = s1.events.at(-1);
  ok(done.state === "completed" && done.answered === 1 && done.gaps === 4, "the scan completes, with the count of answers and gaps (gaps are normal, not a failure)");
  ok(!JSON.stringify(s1.events).includes("A made-up claim"), "the made-up claim does not appear anywhere in the stream");

  console.log("the page after a reload, and a second look");
  const snap = (await get(A, id)).scan;
  ok(snap.state === "completed" && snap.total === 5 && snap.done === 5 && snap.parts.length === 5 && snap.language === "hinglish" && snap.topic === "air pollution and childhood asthma", "the scan can be read again with everything in it");
  ok(JSON.stringify(snap.parts) === JSON.stringify(Object.values(parts)), "it is the same parts the stream delivered");
  ok(snap.items.length === 5 && snap.estimate === 5 * 3000 && Date.parse(snap.expiresAt) - Date.parse(snap.createdAt) === 24 * 3600_000, "it keeps the approved plan, what it was expected to use, and one day");
  const third = s1.events.filter((e) => e.seq).at(2).seq;
  const again = await events(A, id, { after: third, label: "reconnect" });
  ok(again.events[0].type === "progress" && again.events[0].done === of(s1.events, "part").filter((e) => e.seq <= third).length, "a reader that comes back after an event gets the progress so far first");
  ok(again.events.filter((e) => e.seq).every((e) => e.seq > third) && again.events.at(-1).type === "done", "...then only what it has not seen, up to the end");
  const lastSeq = s1.events.at(-1).seq;
  const after = await events(A, id, { after: lastSeq, label: "after the end" });
  ok(after.events.length === 2 && after.events[1].type === "done" && after.events[1].state === "completed" && after.events[1].answered === 1, "asking after the last event of a finished scan still gets its end, so the page never waits for nothing");
  const list = await (await A.api("/api/v1/litscan")).json();
  ok(list.scans.length === 1 && list.scans[0].id === id && list.scans[0].state === "completed" && list.scans[0].done === 5, "the list shows the scan of the last day");

  console.log("how answers went (counts only)");
  const outcomes = Object.fromEntries((await sql("SELECT outcome, n FROM answer_outcomes WHERE feature = 'litscan'"))[0].map((r) => [r.outcome, r.n]));
  ok(outcomes.answered === 1 && outcomes.nothing_found === 1 && outcomes.not_answered === 1 && outcomes.not_grounded === 1 && outcomes.unavailable === 1, "each sub-question is counted once, by how it went");

  console.log("whose it is");
  ok((await B.api(`/api/v1/litscan/${id}`)).status === 404 && (await B.send(`${APP}/api/v1/litscan/${id}/events`)).status === 404, "another person cannot read it or its stream");
  ok((await B.api(`/api/v1/litscan/${id}/cancel`, { method: "POST" })).status === 404 && (await B.api(`/api/v1/litscan/${id}`, { method: "DELETE" })).status === 404, "...or stop or delete it");
  ok((await (await B.api("/api/v1/litscan")).json()).scans.length === 0, "...or see it in their list");
  ok((await A.api(`/api/v1/litscan/${id}/cancel`, { method: "POST", origin: null })).status === 403, "stopping a scan from another origin is refused");

  console.log("one at a time, and cancel");
  const slow = [item("snail one?", "snail words one"), item("snail two?", "snail words two"), item("quick one?", "quick words")];
  const r2 = await start(B, { topic: "a slow topic of research", language: "en", items: slow });
  const id2 = (await r2.json()).id;
  ok(r2.status === 201, "a scan with slow sub-questions starts");
  const second = await start(B, { topic: "another topic of research", language: "en", items: PLAIN });
  const sj = await second.json();
  ok(second.status === 409 && sj.type === "scan_running" && sj.id === id2, "a second scan is refused while one is running, and the answer names the running one");
  await sleep(1500);
  const live = await events(B, id2, { stopAfter: 6, label: "live" });
  ok(live.events.length >= 3 && live.events.some((e) => e.type === "worker"), "while it runs the stream shows where the workers are");
  const mid = (await get(B, id2)).scan;
  ok(mid.state === "running" && mid.done < 3, "the page reads a running scan with its sub-questions still open");
  const cancel = await B.api(`/api/v1/litscan/${id2}/cancel`, { method: "POST" });
  ok(cancel.status === 200 && (await cancel.json()).state === "canceled", "cancel stops it");
  const canceled = (await get(B, id2)).scan;
  const partsAtCancel = canceled.parts.length;
  await sleep(7000);
  const later = (await get(B, id2)).scan;
  ok(later.state === "canceled" && later.parts.length === partsAtCancel, "answers that were still being written when it was canceled are not added afterwards");
  const endEvents = (await events(B, id2, { label: "canceled" })).events;
  ok(endEvents.at(-1).type === "done" && endEvents.at(-1).state === "canceled" && of(endEvents, "done").length === 1, "its stream ends with one done that says canceled");
  ok((await B.api(`/api/v1/litscan/${id2}/cancel`, { method: "POST" })).status === 200, "canceling it again is harmless");
  const r3 = await start(B, { topic: "a third topic of research", language: "en", items: PLAIN });
  ok(r3.status === 201, "after a cancel another scan can be started");
  await waitEnded(B, (await r3.json()).id);

  console.log("limits");
  // B has started 2 scans today (r2, r3); two more fit, the fifth does not: use fresh scans that end quickly
  for (let i = 0; i < 2; i++) {
    const r = await start(B, { topic: `topic number ${i} of research`, language: "en", items: PLAIN });
    ok(r.status === 201, `scan ${i + 3} of 4 today is accepted`);
    await waitEnded(B, (await r.json()).id);
  }
  const fifth = await start(B, { topic: "one scan too many today", language: "en", items: PLAIN });
  ok(fifth.status === 429 && (await fifth.json()).type === "scan_limit", "the fifth scan of a day is refused");
  ok((await sql("SELECT n FROM litscan_daily"))[0].find((r) => r.n >= 4), "the day's count is kept apart from the scans, so deleting a scan does not give it back");
  const C = await login("ls-c", "ls-c@example.com", "Chandra");
  const cid = (await sql("SELECT id FROM users WHERE email = 'ls-c@example.com'"))[0][0].id;
  await sql(`INSERT INTO llm_usage (subject, task, sensitivity, provider, model, tokens_in, tokens_out, cost_cents, ok, ms, label) VALUES ('${cid}', 'qa', 'private', 'workersai', 'm', 30000, 20000, 0, 1, 10, 'x')`);
  const poor = await start(C, { topic: "a topic with little allowance left", language: "en", items: FOUR });
  const pj = await poor.json();
  ok(poor.status === 429 && pj.type === "quota" && /10,000 left/.test(pj.detail) && /12,000 tokens/.test(pj.detail), "a scan that today's allowance cannot cover is refused before anything runs, saying what it needs and what is left");
  ok((await sql("SELECT COUNT(*) AS n FROM litscans WHERE user_id = '" + cid + "'"))[0][0].n === 0 && (await sql("SELECT COUNT(*) AS n FROM litscan_daily WHERE user_id = '" + cid + "'"))[0][0].n === 0, "...and it does not use up one of the day's scans");
  const three = await start(C, { topic: "a cheaper scan with fewer parts", language: "en", items: FOUR.slice(0, 3) });
  ok(three.status === 201, "...while a smaller plan that the allowance does cover (9,000 of 10,000) is accepted");
  await waitEnded(C, (await three.json()).id);

  const offTopic = await start(C, { topic: "a topic with one sub-question off the subject", language: "en", items: [item("An off-topic question?", "irrelevant words here"), item("An ordinary question?", "ordinary words here")] });
  ok(offTopic.status === 201, "a scan with a sub-question whose papers are not about it starts");
  const off = await waitEnded(C, (await offTopic.json()).id);
  const byIdx = Object.fromEntries(off.parts.map((x) => [x.idx, x]));
  ok(byIdx[0].status === "gap" && byIdx[0].reason === "no_relevant" && byIdx[0].found === 5 && byIdx[1].status === "answered", "papers that are not about the sub-question are not read: a gap that says so, and the other sub-question is answered");

  console.log("a scan whose workflow was lost");
  const dead = "11111111-2222-4333-8444-555555555555";
  const uid = (await sql("SELECT id FROM users WHERE email = 'ls-a@example.com'"))[0][0].id;
  await sql(
    `INSERT INTO litscans (id, user_id, topic, language, plan, state, est_tokens, updated_at, expires_at) VALUES ('${dead}', '${uid}', 'a topic that stalled', 'en', '${JSON.stringify(PLAIN).replace(/'/g, "''")}', 'running', 4400, datetime('now', '-20 minutes'), datetime('now', '+1 day'))`,
    `INSERT INTO litscan_events (scan_id, seq, key, type, data) VALUES ('${dead}', 1, 'started', 'started', '{"type":"started","total":2}')`,
  );
  const stale = (await get(A, dead)).scan;
  ok(stale.state === "failed", "a running scan that has not moved for twelve minutes is called failed when it is read, so nobody waits for it");
  ok((await events(A, dead, { label: "failed" })).events.at(-1).state === "failed", "...and its stream ends with that");

  console.log("removing, the export, deleting the account");
  const del = await A.api(`/api/v1/litscan/${id}`, { method: "DELETE" });
  ok(del.status === 200 && (await A.api(`/api/v1/litscan/${id}`)).status === 404, "a person can delete a scan");
  ok((await sql(`SELECT COUNT(*) AS n FROM litscan_events WHERE scan_id = '${id}'`))[0][0].n === 0, "its events go with it");
  const keep = await (await start(A, { topic: "a topic kept for the export", language: "hinglish", items: PLAIN })).json();
  await waitEnded(A, keep.id);
  const exp = await (await A.api("/api/v1/account/export")).json();
  ok(exp.literatureScans?.length >= 1 && exp.literatureScans.at(-1).topic === "a topic kept for the export" && exp.literatureScans.at(-1).results.length === 2 && exp.literatureScans.at(-1).subQuestions.length === 2, "the export holds the scan: topic, the approved plan and the results");
  const erased = await A.api("/api/v1/account", { method: "DELETE", body: { confirm: "DELETE" } });
  const left = (await sql(`SELECT (SELECT COUNT(*) FROM litscans WHERE user_id = '${uid}') AS scans, (SELECT COUNT(*) FROM litscan_daily WHERE user_id = '${uid}') AS daily`))[0][0];
  ok(erased.status === 200 || erased.status === 204, "the account can be deleted");
  ok(left.scans === 0 && left.daily === 0, "deleting the account removes its scans and its counters");
  const orphan = (await sql("SELECT COUNT(*) AS n FROM litscan_events WHERE scan_id NOT IN (SELECT id FROM litscans)"))[0][0].n;
  ok(orphan === 0, "no events are left without a scan");

  reportStreams(ok);
} catch (e) {
  console.error(e);
  failures++;
} finally {
  idp.close?.();
}

console.log(failures === 0 ? "\nall literature scan checks passed" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
