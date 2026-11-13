// The Home page's Trending list, on the real local stack: the Worker (`wrangler dev --test-scheduled`, QA_STUB=1 so OpenAlex, arXiv and the product's own search are the offline stand-ins of
// src/trending/stub.ts), its local KV and D1, and the page's own reader of the file (packages/shared/src/trending-client.ts, compiled here, not copied). `npm run integration -w apps/api` starts everything.
//   node scripts/trending-e2e.mjs
//
// What it proves (docs/design/chatview-and-trending.md, T4 and T12; docs/runbook.md, "The Trending list"):
//   - GET /api/v1/home/trending answers an empty, valid, already expired file when there is nothing in KV, with Cache-Control public, max-age=300 and no cookie, the same for every visitor
//   - a scheduled run (the cron, through /cdn-cgi/handler/scheduled) publishes the list from the stand-ins: what is shown, what is held back, what the file holds and nothing more, how long KV keeps it
//   - the kill switch: the KV flag trending:v1:off (any value) hides the list at once and lets the job keep making it; removing it brings the list back
//   - the page's freshness rule is the server's too: a file past validUntil, a pool too old, a file that says disabled, a file that is not right: all answered as "no list"
//   - a stand-in that fails (a search no source answered, OpenAlex answering 500) fails the run, says so in the heartbeat and /api/v1/health/jobs, and leaves the last file
//     exactly as it was; a weekly scan that fails goes on, in the next run, from where it was
//   - the job's own heartbeat row (migration 0025) and its place in /api/v1/health/jobs
// The stand-ins are made to fail through the dev-only KV route (src/index.ts, /api/v1/dev/kv) and the key trending:v1:stub-fault (src/trending/stub.ts): both exist only with ENABLE_DEV_ROUTES=1 and QA_STUB=1.
//
// The default run of scripts/integration.mjs has TRENDING=off, production's launch state (the other kill switch), and runs only the last section of this file; --run=trending-on runs the rest.
// --run=trending-dark does the same with TRENDING=dark, the step after the committed launch state "off" (wrangler.jsonc): the job runs and makes the list, and the route hides it.
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";
import { APP, ok, countFailure, finish, at, sqlResults } from "./lib/harness.mjs";

// where the switch stands in this run, read as the Worker reads TRENDING (the registry): the default run has production's "off", --run=trending-dark "dark", --run=trending-on the list shown
const VARIABLE_OFF = at("TRENDING", "off");
const VARIABLE_DARK = at("TRENDING", "dark");

// The page's own reader and freshness rule: the very file the browser bundles, turned into JavaScript here.
const clientSource = readFileSync(new URL("../../../packages/shared/src/trending-client.ts", import.meta.url), "utf8");
const { parseTrending, isFresh } = await import(`data:text/javascript;base64,${Buffer.from(transformSync(clientSource, { loader: "ts", format: "esm" }).code).toString("base64")}`);

const DAY_MS = 864e5;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const KEYS = { file: "trending:v1", off: "trending:v1:off", pool: "trending:v1:pool", scan: "trending:v1:scan", fault: "trending:v1:stub-fault" };
/** What the stand-ins give (src/trending/stub.ts): nine phrases are shown; one is in a held (health) subfield, one has a retracted paper in its search, two are shut out by the cap of four a domain. */
const NINE = ["retrieval-augmented generation", "AI literacy", "plant microbiome engineering", "green hydrogen production", "altermagnetism", "central bank digital currency", "predictive coding", "reconfigurable intelligent surfaces", "heritage digitisation"];
const NOT_SHOWN = ["tirzepatide", "environmental DNA", "single-atom catalysts", "solid-state batteries"];

const post = (path, body) => fetch(`${APP}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const sql = async (...statements) => (await sqlResults(statements, { strict: true })).flat();
const kvOp = async (body) => {
  const res = await post("/api/v1/dev/kv", body);
  if (!res.ok) throw new Error(`dev/kv ${body.op} ${body.key ?? body.prefix ?? ""}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
};
const kvGet = async (key) => (await kvOp({ op: "get", key })).value;
const kvPut = (key, value, ttl) => kvOp({ op: "put", key, value, ...(ttl ? { ttl } : {}) });
const kvDel = (key) => kvOp({ op: "delete", key });
const kvList = async () => (await kvOp({ op: "list" })).keys;
const wipe = async () => { for (const k of await kvList()) await kvDel(k.name); };

const beat = async () => (await sql("SELECT runs, failures, last_result, last_error, last_started_at, last_finished_at, last_ok_at FROM job_runs WHERE name = 'trending'"))[0];
const jobs = async () => { const res = await fetch(`${APP}/api/v1/health/jobs`); return { res, body: await res.json() }; };
const trendingJob = (body) => body.jobs.find((j) => j.name === "trending");

/** The route, as a browser asks it, and what the page's reader makes of the answer. */
async function feed(headers = {}) {
  const res = await fetch(`${APP}/api/v1/home/trending`, { headers });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { res, text, body, file: parseTrending(body) };
}
const chips = (f, g = "global") => f.groups[g].chips.map((c) => c.text);
/** "No list": a file the page accepts, with no chips, that is not fresh (and says whether it was switched off). */
const isEmpty = (r, disabled) =>
  r.res.status === 200 && r.file !== null && r.file.disabled === disabled && r.file.groups.global.chips.length === 0 && r.file.groups.in.chips.length === 0 && !isFresh(r.file, Date.now()) && Date.parse(r.file.validUntil) <= Date.now();
const sameChips = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** Fires the schedule like the cron would (at `time`, now unless told), and waits until the job's heartbeat says that run is over. */
async function run(time = Date.now(), ms = 20_000) {
  // the heartbeat's own clock counts whole seconds, so "finished" is made unmistakable: the finish time and result are cleared first, and only this run's end can write them again
  await sql("UPDATE job_runs SET last_finished_at = NULL, last_result = NULL WHERE name = 'trending'");
  const before = await beat();
  const t0 = Date.now();
  const res = await fetch(`${APP}/cdn-cgi/handler/scheduled?format=json&time=${time}`);
  const asked = Date.now() - t0;
  const outcome = res.ok ? (await res.json()).outcome : `HTTP ${res.status}`;
  let after = await beat();
  const blocked = after.last_finished_at !== null; // the request came back when the job was over
  while (Date.now() - t0 < ms && after.last_finished_at === null) {
    await new Promise((r) => setTimeout(r, 200));
    after = await beat();
  }
  return { outcome, asked, blocked, before, after, ranOnce: after.runs === before.runs + 1 && after.last_finished_at !== null };
}

const baseline = await beat();
try {
  if (VARIABLE_DARK) {
    console.log("the variable TRENDING=dark (the Worker was started with it): the launch state");
    await wipe();
    const run1 = await run();
    ok(run1.outcome === "ok" && run1.ranOnce && run1.after.last_result === "ok" && run1.after.last_error === null, "the scheduled run records a good heartbeat");
    const made = parseTrending(JSON.parse((await kvGet(KEYS.file)) ?? "null"));
    ok(made !== null && isFresh(made, Date.now()) && sameChips(chips(made), NINE), "the job still ran: the file in KV is a fresh list the page's reader accepts, with the nine phrases");
    const r = await feed();
    ok(isEmpty(r, true), "the route answers disabled:true with no chips although that fresh file is in KV (the owner reads it with wrangler; nobody is shown it)");
    ok(r.res.headers.get("cache-control") === "public, max-age=300", "...with the same Cache-Control");
    ok(trendingJob((await jobs()).body).state === "ok", "/api/v1/health/jobs lists the job as on time");
  } else if (VARIABLE_OFF) {
    console.log("the variable TRENDING=off (the Worker was started with it)");
    await wipe();
    const now = Date.now();
    const chip = (text) => ({ text, sinceYear: new Date(now).getUTCFullYear() - 1, a: 300, b: 100, field: "Computer Science" });
    const good = { version: 1, asOf: isoDay(now), generatedAt: new Date(now).toISOString(), validUntil: new Date(now + 48 * 3_600_000).toISOString(), poolAsOf: isoDay(now), disabled: false, groups: { global: { chips: NINE.map(chip) }, in: { chips: [] } } };
    await kvPut(KEYS.file, JSON.stringify(good));
    ok(parseTrending(good) !== null && isFresh(parseTrending(good), Date.now()), "(a good, fresh file is in KV: the page's own reader would show it)");
    const r = await feed();
    ok(isEmpty(r, true), "the route answers disabled:true with no chips, although a good file is in KV (the variable wins, and KV is not read)");
    ok(r.res.headers.get("cache-control") === "public, max-age=300", "...with the same Cache-Control");
    const run1 = await run();
    ok(run1.outcome === "ok" && run1.ranOnce && run1.after.last_result === "ok" && run1.after.last_error === null, "the scheduled run records a good heartbeat");
    const names = (await kvList()).map((k) => k.name);
    ok(names.length === 1 && names[0] === KEYS.file && (await kvGet(KEYS.file)) === JSON.stringify(good), "...and the job did nothing: no key made, the file untouched");
    ok(trendingJob((await jobs()).body).state === "ok", "/api/v1/health/jobs lists the job as on time");
  } else {
    console.log("the migration, and the job in the health view");
    {
      const names = (await sql("SELECT name FROM job_runs ORDER BY name")).map((r) => r.name);
      ok(JSON.stringify(names) === JSON.stringify(["maintenance", "retraction_check", "trending"]), `the migration seeded the job's heartbeat row: ${JSON.stringify(names)}`);
      const { res, body } = await jobs();
      ok(res.status === 200 && body.jobs.map((j) => j.name).join() === "maintenance,retraction_check,trending", "/api/v1/health/jobs lists the three jobs, the Trending job last");
      ok(trendingJob(body).state === "ok" && typeof trendingJob(body).runs === "number", "...and the Trending job is on time");
      ok(!("lastError" in trendingJob(body)) && !("failures" in trendingJob(body)), "...with no error text in the public answer");
    }

    console.log("nothing in KV yet");
    {
      await wipe();
      const r = await feed();
      ok(isEmpty(r, false), "an empty, valid, already expired file: the page's reader accepts it, it has no chips and is not fresh, and it does not say it was switched off");
      ok(r.res.headers.get("cache-control") === "public, max-age=300", "Cache-Control: public, max-age=300");
      ok((r.res.headers.get("content-type") ?? "").startsWith("application/json"), "content-type is JSON (not the single-page app's HTML)");
      ok(!r.res.headers.has("set-cookie") && !/cookie|authorization|origin/i.test(r.res.headers.get("vary") ?? ""), "no cookie is set, and the answer does not vary with the visitor");
      const other = await feed({ cookie: "sid=somebody-else", authorization: "Bearer x", "accept-language": "hi-IN" });
      ok(!other.res.headers.has("set-cookie") && isEmpty(other, false) && JSON.stringify(Object.keys(other.body)) === JSON.stringify(Object.keys(r.body)), "a visitor with a cookie and a language gets the same kind of answer and no cookie");
      const w = await fetch(`${APP}/api/v1/home/trending`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      ok(w.status === 404, `only GET is answered (POST: HTTP ${w.status})`);
    }

    console.log("a run that fails before there is a list publishes nothing");
    {
      await kvPut(KEYS.fault, "openalex");
      const r1 = await run();
      ok(r1.outcome === "ok" && r1.ranOnce && r1.after.last_result === "failed", `the schedule fired and the heartbeat says the job failed: ${r1.after.last_result} (${r1.after.last_error})`);
      ok(/openalex/i.test(r1.after.last_error ?? "") && !/@|https?:/.test(r1.after.last_error ?? ""), "...saying which source, as short cleaned text");
      ok((await kvGet(KEYS.file)) === null, "no file was written");
      ok(isEmpty(await feed(), false), "the route still answers no list");
      const { res, body } = await jobs();
      ok(res.status === 503 && body.ok === false && trendingJob(body).state === "failing" && body.jobs.filter((j) => j.state === "ok").length === 2, "/api/v1/health/jobs answers 503 for it, and the other two jobs are on time");
      ok(!("lastError" in trendingJob(body)), "...still with no error text in the public answer");
      ok((await fetch(`${APP}/api/v1/health`)).status === 200, "the service's own health check is not affected");
      await kvDel(KEYS.fault);
    }

    console.log("a scheduled run publishes the list from the stand-ins");
    let published;
    const t1 = Date.now();
    {
      const r1 = await run(t1);
      ok(r1.outcome === "ok" && r1.ranOnce && r1.after.last_result === "ok" && r1.after.last_error === null, `the run finished well (${r1.asked} ms; the request came back ${r1.blocked ? "when the job was over" : "BEFORE the job was over"})`);
      const { res, body } = await jobs();
      ok(res.status === 200 && trendingJob(body).state === "ok", "/api/v1/health/jobs is back to 200 and lists the job as on time");
      const r = await feed();
      published = r.file;
      ok(r.res.status === 200 && r.res.headers.get("cache-control") === "public, max-age=300" && !r.res.headers.has("set-cookie"), "the route answers 200 with Cache-Control public, max-age=300 and no cookie");
      ok(published !== null && isFresh(published, Date.now()), "the page's reader accepts the file and calls it fresh");
      ok(published && sameChips(chips(published), NINE), `the nine phrases the stand-ins give, and no others: ${published ? chips(published).join(" | ") : "no file"}`);
      ok(published && NOT_SHOWN.every((p) => !chips(published).includes(p) && !chips(published, "in").includes(p)), "the held (health) phrase, the one with a retracted paper and the two the domain cap shuts out are in neither list");
      const rag = published?.groups.global.chips.find((c) => c.text === "retrieval-augmented generation");
      ok(JSON.stringify(rag) === JSON.stringify({ text: "retrieval-augmented generation", sinceYear: new Date(t1).getUTCFullYear() - 1, a: 452, b: 176, field: "Computer Science" }), `a chip is the keyword's own text with its two counts and the year it searches from: ${JSON.stringify(rag)}`);
      ok(published?.groups.global.chips.find((c) => c.text === "altermagnetism")?.b === 22, "a phrase that was not in last year's list has its exact count (22), not an estimate");
      ok(published && published.groups.in.chips.length > 0 && chips(published, "in").every((t) => NINE.includes(t)), `the India list is made too, from phrases the global list has: ${published ? chips(published, "in").length : 0} of them`);
      ok(published && published.asOf === isoDay(t1) && published.poolAsOf === isoDay(t1) && published.disabled === false && Date.parse(published.validUntil) - Date.parse(published.generatedAt) === 48 * 3_600_000, "asOf and poolAsOf are the day, and the file is valid for 48 hours");
      const raw = JSON.parse(r.text);
      ok(JSON.stringify(Object.keys(raw)) === JSON.stringify(["version", "asOf", "generatedAt", "validUntil", "poolAsOf", "disabled", "groups"]) && raw.groups.global.chips.every((c) => JSON.stringify(Object.keys(c)) === JSON.stringify(["text", "sinceYear", "a", "b", "field"])), "the file holds the contract's fields and nothing else");
      ok(r.text.length < 8_000, `and it is small (${r.text.length} bytes)`);
    }

    console.log("what the job keeps in KV");
    {
      const list = await kvList();
      const names = list.map((k) => k.name);
      const day = isoDay(t1);
      ok([KEYS.file, KEYS.pool, KEYS.scan, `trending:v1:scan:${day}:0`, `trending:v1:scan:${day}:1`].every((k) => names.includes(k)) && !names.includes(KEYS.off), `the file, the pool, the scan's progress and its two batches, and no kill flag: ${names.join(", ")}`);
      const ttl = (name) => { const e = list.find((k) => k.name === name)?.expiration; return e ? e - Date.now() / 1000 : NaN; };
      const near = (v, days) => Math.abs(v - days * 86_400) < 600;
      ok(near(ttl(KEYS.file), 14) && near(ttl(KEYS.pool), 30) && near(ttl(KEYS.scan), 30) && near(ttl(`trending:v1:scan:${day}:0`), 10), "they expire by themselves: the file after 14 days, the pool and the progress after 30, a batch after 10");
      const pool = JSON.parse(await kvGet(KEYS.pool));
      ok(pool.poolAsOf === day && pool.global.length >= 9 && pool.held.includes("tirzepatide") && !pool.global.some((c) => c.text === "tirzepatide"), "the pool holds the candidates, and the health phrase only in its 'held' log");
      const scan = JSON.parse(await kvGet(KEYS.scan));
      ok(scan.done === true && scan.next === scan.batches && scan.leaseUntil === 0, "the scan is marked done and its lease is released");
    }

    console.log("a second run on the same day");
    {
      const before = await kvGet(KEYS.file);
      const r2 = await run(t1 + 60_000);
      const r = await feed();
      ok(r2.outcome === "ok" && r2.ranOnce && r2.after.last_result === "ok", "runs well");
      ok(r.file && sameChips(chips(r.file), NINE) && (await kvGet(KEYS.file)) !== null && JSON.parse(before).asOf === r.file.asOf, "the same nine phrases are kept (nothing scores 1.25 times higher than what was shown)");
      ok(JSON.parse(await kvGet(KEYS.scan)).asOf === isoDay(t1) && (await kvList()).filter((k) => k.name.startsWith("trending:v1:scan:")).length === 2, "and no second scan is made: the day's batches are the only ones");
    }

    console.log("the kill switch in KV");
    {
      const live = await kvGet(KEYS.file);
      for (const value of ["1", "0", "on", "false"]) {
        await kvPut(KEYS.off, value);
        const r = await feed();
        ok(isEmpty(r, true), `the flag with the value "${value}" hides the list at once: no chips, disabled:true (its presence is what counts)`);
        if (value === "1") ok(r.res.headers.get("cache-control") === "public, max-age=300", "...with the usual Cache-Control");
      }
      ok((await kvGet(KEYS.file)) === live, "the flag hides the file and does not touch it");
      const r1 = await run(t1 + 120_000);
      ok(r1.outcome === "ok" && r1.ranOnce && r1.after.last_result === "ok", "with the flag on, the job still runs (that is how the list is read before it is shown)");
      const made = parseTrending(JSON.parse(await kvGet(KEYS.file)));
      ok(made && made.generatedAt > published.generatedAt && sameChips(chips(made), NINE), "...and still makes the list: a newer file with the same phrases");
      ok(isEmpty(await feed(), true), "...which the route keeps hidden");
      await kvDel(KEYS.off);
      const back = await feed();
      ok(back.file && isFresh(back.file, Date.now()) && sameChips(chips(back.file), NINE) && back.file.generatedAt === made.generatedAt, "removing the flag brings the list back (the newest file), with no deploy (a real edge keeps a read for up to 60 seconds: the runbook says so)");
    }

    console.log("a file the page would not show is not passed on");
    {
      const good = JSON.parse(await kvGet(KEYS.file));
      const swap = async (changes) => { await kvPut(KEYS.file, typeof changes === "string" ? changes : JSON.stringify({ ...good, ...changes })); return feed(); };
      const dayAgo = (n) => isoDay(Date.now() - n * DAY_MS);
      const hours = (n) => new Date(Date.now() + n * 3_600_000).toISOString();

      let r = await swap({ validUntil: hours(-0.001) });
      ok(isEmpty(r, false), "a file past its validUntil is answered as no list (the page checks the same rule: isFresh)");
      r = await swap({ validUntil: hours(1) });
      ok(r.file && isFresh(r.file, Date.now()) && sameChips(chips(r.file), NINE), "(the same file with an hour left is passed on unchanged)");
      r = await swap({ poolAsOf: dayAgo(15), validUntil: hours(24) });
      ok(isEmpty(r, false), "a weekly pool 15 days old is no list, though the file itself is not old");
      r = await swap({ poolAsOf: dayAgo(13), validUntil: hours(24) });
      ok(r.file && isFresh(r.file, Date.now()) && sameChips(chips(r.file), NINE), "a pool 13 days old is still passed on");
      r = await swap({ poolAsOf: dayAgo(14), validUntil: hours(24) });
      ok(isEmpty(r, false), "a pool dated 14 days ago is no list either: the page counts the 14 days from that day's midnight (UTC), so a pool dated 13 days ago is the oldest it shows");
      r = await swap({ disabled: true, validUntil: hours(24) });
      ok(isEmpty(r, true), "a file that says disabled:true is answered as switched off, with no chips");
      r = await swap({ groups: { global: { chips: [...good.groups.global.chips, ...good.groups.global.chips.map((c) => ({ ...c, text: `${c.text} again` }))] }, in: { chips: [] } }, validUntil: hours(24) });
      ok(isEmpty(r, false), "a file with more than 12 chips is not accepted by the page's reader, so it is no list");
      r = await swap({ groups: { global: { chips: [{ ...good.groups.global.chips[0], text: `a${String.fromCharCode(0x200b)}b phrase` }] }, in: { chips: [] } }, validUntil: hours(24) });
      ok(isEmpty(r, false), "a chip with an invisible character is not accepted either");
      r = await swap({ version: 2, validUntil: hours(24) });
      ok(isEmpty(r, false), "another version is no list");
      for (const [what, text] of [["text that is not JSON", "<html>not a list</html>"], ["JSON that is not a file", "{}"], ["null", "null"], ["a list", "[1,2,3]"]]) {
        r = await swap(text);
        ok(isEmpty(r, false), `${what} in KV is no list, and no error`);
      }
      await kvPut(KEYS.file, JSON.stringify(good));
      r = await feed();
      ok(r.file && r.file.generatedAt === good.generatedAt && sameChips(chips(r.file), NINE), "(the real file put back: the list is served again)");

      // the job's own output ages out the same way: a run the schedule made for a day that is already past (it was late) publishes a file that has expired
      let past = Date.now() - 3 * DAY_MS;
      if (new Date(past).getUTCDay() === 1) past -= DAY_MS; // not a Monday: that would be a scan day
      const late = await run(past);
      const made = parseTrending(JSON.parse(await kvGet(KEYS.file)));
      ok(late.after.last_result === "ok" && made && made.asOf === isoDay(past) && Date.parse(made.validUntil) < Date.now(), `a run made for a day that is already past (${isoDay(past)}) publishes a file that has already expired (the run's time is the schedule's, not the clock's)`);
      ok(isEmpty(await feed(), false), "...and the route does not show it");
      await run();
      r = await feed();
      ok(r.file && isFresh(r.file, Date.now()) && sameChips(chips(r.file), NINE), "(the next run of the day: the list is served again)");
    }

    console.log("a stand-in that fails leaves the last file exactly as it was");
    {
      const last = await kvGet(KEYS.file);
      const failing = async (fault, expectMessage, label) => {
        await kvPut(KEYS.fault, fault);
        const r = await run(Date.now() + 5 * 60_000);
        await kvDel(KEYS.fault);
        ok(r.outcome === "ok" && r.ranOnce && r.after.last_result === "failed" && expectMessage.test(r.after.last_error ?? ""), `${label}: the run is recorded as failed (${r.after.last_error})`);
        ok((await kvGet(KEYS.file)) === last, "...and the file in KV is byte for byte what it was");
        const { res, body } = await jobs();
        ok(res.status === 503 && trendingJob(body).state === "failing", "...and /api/v1/health/jobs says the Trending job is failing (503)");
        const seen = await feed();
        ok(seen.file && isFresh(seen.file, Date.now()) && sameChips(chips(seen.file), NINE), "...while the page is still served the last list");
      };
      await failing("search", /no source answered/i, "the product's own search is answered by no source");
      const good = await run(Date.now() + 10 * 60_000);
      const { res, body } = await jobs();
      ok(good.after.last_result === "ok" && good.after.last_error === null && res.status === 200 && trendingJob(body).state === "ok", "the next good run clears the failure and its error text");
      ok(good.after.failures === good.before.failures, "(the count of failures is kept)");
    }

    console.log("a weekly scan that fails is made up in the next run");
    {
      // the pool is a week and a day old and today's scan has not begun: the daily file comes first, then the scan is tried and fails
      const pool = JSON.parse(await kvGet(KEYS.pool));
      const old = isoDay(Date.now() - 8 * DAY_MS);
      await kvPut(KEYS.pool, JSON.stringify({ ...pool, poolAsOf: old }), 30 * 86_400);
      await kvDel(KEYS.scan);
      await kvPut(KEYS.fault, "openalex");
      const r1 = await run();
      await kvDel(KEYS.fault);
      ok(r1.outcome === "ok" && r1.after.last_result === "failed" && /openalex/i.test(r1.after.last_error ?? ""), `the scan fails on OpenAlex and the run is recorded as failed (${r1.after.last_error})`);
      const f1 = (await feed()).file;
      ok(f1 && isFresh(f1, Date.now()) && sameChips(chips(f1), NINE) && f1.poolAsOf === old, "the day's file was made first, from the pool there was, and is served");
      ok(JSON.parse(await kvGet(KEYS.pool)).poolAsOf === old, "the old pool was not replaced by half of a scan");
      const r2 = await run();
      ok(r2.after.last_result === "ok" && r2.after.last_error === null, "the next run goes on and finishes well");
      ok(JSON.parse(await kvGet(KEYS.pool)).poolAsOf === isoDay(Date.now()), "...and the new pool is today's");
      const r3 = await run();
      const f3 = (await feed()).file;
      ok(r3.after.last_result === "ok" && f3 && f3.poolAsOf === isoDay(Date.now()) && sameChips(chips(f3), NINE), "the file made after it is made from the new pool");
    }

    console.log("arXiv that cannot answer costs the phrases it was asked about their place for the night, not the file");
    {
      // the stand-ins' pool has two phrases from computing and physics: two in a row that arXiv cannot answer is a hiccup (three would be an outage that fails the run: job.test.ts), so the file is made from the others
      await kvPut(KEYS.fault, "arxiv");
      const r = await run(Date.now() + 15 * 60_000);
      await kvDel(KEYS.fault);
      ok(r.outcome === "ok" && r.ranOnce && r.after.last_result === "ok" && r.after.last_error === null, `the run is recorded as good (${r.after.last_result})`);
      const made = parseTrending(JSON.parse(await kvGet(KEYS.file)));
      ok(made && isFresh(made, Date.now()) && !chips(made).includes("retrieval-augmented generation") && !chips(made).includes("altermagnetism") && chips(made).length >= 8, `the file is new and has neither of the two phrases arXiv could not confirm (${made ? chips(made).length : 0} phrases)`);
      ok(trendingJob((await jobs()).body).state === "ok", "/api/v1/health/jobs lists the job as on time");
    }

    console.log("the job that has not run in time");
    {
      await sql("UPDATE job_runs SET last_ok_at = datetime('now', '-29 hours'), last_started_at = datetime('now', '-29 hours'), last_finished_at = datetime('now', '-29 hours') WHERE name = 'trending'");
      ok((await jobs()).res.status === 200, "29 hours since its last good run is within the day plus its grace");
      await sql("UPDATE job_runs SET last_ok_at = datetime('now', '-31 hours'), last_started_at = datetime('now', '-31 hours'), last_finished_at = datetime('now', '-31 hours') WHERE name = 'trending'");
      const { res, body } = await jobs();
      ok(res.status === 503 && trendingJob(body).state === "overdue" && body.jobs.filter((j) => j.state === "ok").length === 2, "31 hours without a run is reported as overdue (503), and only for this job");
      const r = await run();
      ok(r.after.last_result === "ok" && (await jobs()).res.status === 200, "the next run puts it right");
    }
  }
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  countFailure();
} finally {
  // leave the stack as the other suites expect it: no flag, no stand-in fault, a good heartbeat
  try {
    if (!VARIABLE_OFF && !VARIABLE_DARK) {
      await kvDel(KEYS.off);
      await kvDel(KEYS.fault);
      const last = await run();
      if (last.after.last_result !== "ok") { console.log(" FAIL the final run did not end well:", last.after.last_error); countFailure(); }
    }
    await sql(`UPDATE job_runs SET failures = ${Number(baseline?.failures ?? 0)} WHERE name = 'trending'`); // the failures this suite caused on purpose are not the next suite's
  } catch (e) {
    console.log(" FAIL cleanup:", e);
    countFailure();
  }
}
finish("all trending list checks passed", (n) => `${n} check(s) FAILED`);
