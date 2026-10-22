// Running the service: the scheduled-job heartbeat (/api/v1/health/jobs), the file-and-record check, and deletions that survive a restore.
// Real Worker + local D1 + local R2 + fake IdP. `npm run integration -w apps/api` starts everything (the Worker runs with --test-scheduled).
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";
import { SAMPLE_PAPER, makePdf } from "./lib/make-pdf.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

/**
 * Runs SQL statements through the Worker itself (a dev-only route). Not with `wrangler d1 execute --local` from a second process: writing to the
 * database file while `wrangler dev` has it open left the dev server spinning at 100% CPU and answering nothing.
 */
async function sql(...statements) {
  const res = await fetch(`${APP}/api/v1/dev/sql`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: statements }) });
  if (!res.ok) throw new Error(`sql failed: HTTP ${res.status} ${await res.text()}`);
  return (await res.json()).results.flat();
}

const idp = await startFakeIdp(9911);
const login = async (sub, email, name) => {
  idp.setUser({ sub, email, email_verified: true, name });
  const c = createClient(APP);
  await c.follow(`${APP}/api/v1/auth/google/start`);
  await c.ack();
  return c;
};
const jobsHealth = async () => {
  const res = await fetch(`${APP}/api/v1/health/jobs`);
  return { res, body: await res.json() };
};
/** Fires the daily job like the cron would, and waits until the heartbeat shows it ran. */
async function runCron() {
  const before = (await jobsHealth()).body.jobs?.[0]?.runs ?? 0;
  const res = await fetch(`${APP}/cdn-cgi/handler/scheduled`);
  for (let i = 0; i < 40; i++) {
    const { body } = await jobsHealth();
    if ((body.jobs?.[0]?.runs ?? 0) > before) return res.status;
    await new Promise((r) => setTimeout(r, 250));
  }
  return -1;
}
const overview = async (admin) => (await admin.api("/api/v1/admin/overview")).json();

try {
  const admin = await login("ops-admin", "ops@example.edu", "Ops Admin");
  await admin.api("/api/v1/dev/make-admin", { method: "POST" });
  const anon = createClient(APP);

  console.log("scheduled jobs: the heartbeat");
  {
    const { res, body } = await jobsHealth();
    ok(res.status === 200 && body.ok === true && body.scheduled === true, "right after the migration the daily job counts as on time (the migration is its first good run)");
    ok(res.headers.get("cache-control") === "no-store", "the answer is never cached");
    ok(body.jobs[0].name === "maintenance" && body.jobs[0].state === "ok", "it names the job and its state");
    ok(!("lastError" in body.jobs[0]) && !("failures" in body.jobs[0]), "the public answer carries no error text");
    ok((await fetch(`${APP}/api/v1/health`)).status === 200, "the ordinary health check is separate and unaffected");
    const o = await overview(admin);
    ok(Array.isArray(o.jobs) && o.jobs[0].state === "ok", "the admin overview lists the job as well");
  }

  console.log("a run is recorded");
  {
    ok((await runCron()) === 200, "the cron fires");
    const { res, body } = await jobsHealth();
    ok(res.status === 200 && body.jobs[0].runs === 1 && body.jobs[0].state === "ok", "one run recorded, still on time");
    ok(Date.now() - Date.parse(body.jobs[0].lastOkAt) < 120_000, "its last good run is now");
    const row = (await sql("SELECT last_result, last_error, failures, last_finished_at IS NOT NULL AS finished FROM job_runs WHERE name = 'maintenance'"))[0];
    ok(row.last_result === "ok" && row.last_error === null && row.failures === 0 && row.finished === 1, "the row says it finished well, with no error");
  }

  console.log("a job that has not run in time");
  {
    await sql("UPDATE job_runs SET last_ok_at = datetime('now', '-29 hours'), last_started_at = datetime('now', '-29 hours'), last_finished_at = datetime('now', '-29 hours') WHERE name = 'maintenance'");
    ok((await jobsHealth()).res.status === 200, "29 hours since the last good run is still within the day plus its grace");
    await sql("UPDATE job_runs SET last_ok_at = datetime('now', '-31 hours'), last_started_at = datetime('now', '-31 hours'), last_finished_at = datetime('now', '-31 hours') WHERE name = 'maintenance'");
    const { res, body } = await jobsHealth();
    ok(res.status === 503 && body.ok === false && body.jobs[0].state === "overdue", "31 hours without a run is reported as overdue, with a 503 an uptime check can alert on");
    ok((await overview(admin)).jobs[0].state === "overdue", "the admin page says so too");
    await runCron();
    ok((await jobsHealth()).res.status === 200, "the next run puts it right");
  }

  console.log("a job that fails");
  try {
    await sql("ALTER TABLE audit_log RENAME TO audit_log_hidden");
    await runCron();
    const { res, body } = await jobsHealth();
    ok(res.status === 503 && body.jobs[0].state === "failing", "a run that throws is reported as failing");
    const j = (await overview(admin)).jobs[0];
    ok(j.state === "failing" && j.failures >= 1 && /audit_log/.test(j.lastError ?? ""), "the admin page shows what went wrong");
    ok(!/@|https?:/.test(j.lastError ?? ""), "...as short, cleaned text");
    ok((await fetch(`${APP}/api/v1/health`)).status === 200, "a failing job does not make the service look down");
  } finally {
    await sql("ALTER TABLE audit_log_hidden RENAME TO audit_log");
  }
  await runCron();
  {
    const { res, body } = await jobsHealth();
    const j = (await overview(admin)).jobs[0];
    ok(res.status === 200 && body.jobs[0].state === "ok" && j.lastError === null, "the next good run clears the failure and its error");
    ok(j.failures >= 1, "...but the count of failures is kept");
  }

  console.log("a job that started and never finished");
  {
    await sql("UPDATE job_runs SET last_started_at = datetime('now', '-2 hours'), last_finished_at = datetime('now', '-10 hours') WHERE name = 'maintenance'");
    const { res, body } = await jobsHealth();
    ok(res.status === 503 && body.jobs[0].state === "stuck", "a run that began two hours ago and has not ended is stuck");
    await sql("UPDATE job_runs SET last_started_at = datetime('now', '-5 minutes') WHERE name = 'maintenance'");
    ok((await jobsHealth()).res.status === 200, "one that began five minutes ago is simply running");
    await runCron();
  }

  console.log("the heartbeat itself missing or unreadable");
  try {
    await sql("DELETE FROM job_runs");
    const { res, body } = await jobsHealth();
    ok(res.status === 503 && body.jobs[0].state === "overdue", "no record at all is reported, not read as fine");
    await runCron();
    ok((await jobsHealth()).res.status === 200, "a run writes the record again");
    await sql("ALTER TABLE job_runs RENAME TO job_runs_hidden");
    const bad = await jobsHealth();
    ok(bad.res.status === 503 && bad.body.error === "db" && bad.body.ok === false, "an unreadable heartbeat is a 503, with no detail");
    const o = await admin.api("/api/v1/admin/overview");
    ok(o.status === 200 && (await o.json()).jobs.length === 0, "the admin page still opens when the heartbeat cannot be read");
  } finally {
    try { await sql("ALTER TABLE job_runs_hidden RENAME TO job_runs"); } catch { /* it was never renamed */ }
  }

  console.log("files and records agree");
  // The earlier suites leave files behind in the same local storage (their accounts are wiped by SQL, not through the app), which the check rightly
  // finds. So each count is judged against what was already there.
  const base = await (await admin.api("/api/v1/admin/integrity?graceMinutes=0")).json();
  const A = await login("ops-a", "ops-a@example.com", "Alice");
  const up = await A.send(`${APP}/api/v1/documents`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/pdf", "X-Filename": "a.pdf" }, body: makePdf(SAMPLE_PAPER) });
  const doc = (await up.json()).document;
  const check = async (q = "") => {
    const res = await admin.api(`/api/v1/admin/integrity${q}`);
    return { res, r: await res.json() };
  };
  {
    ok((await anon.api("/api/v1/admin/integrity")).status === 404 && (await A.api("/api/v1/admin/integrity")).status === 404, "only an admin can run it");
    const a = await check("?graceMinutes=0");
    ok(a.res.status === 200 && a.r.documents >= 1 && a.r.missingFiles === base.missingFiles && a.r.orphanFiles === base.orphanFiles && a.r.truncated === false, "an upload and its file agree (nothing new is wrong)");
    ok(a.res.headers.get("cache-control") === "no-store", "never cached");
    const young = await check();
    ok(young.r.graceMinutes === 15, "by default files and records younger than 15 minutes are not judged");

    const key = `docs/${(await A.me()).id}/${doc.id}.pdf`;
    await admin.api(`/api/v1/dev/r2-object?key=${encodeURIComponent(key)}`, { method: "DELETE" });
    const miss = await check("?graceMinutes=0");
    ok(miss.r.missingFiles === base.missingFiles + 1 && miss.r.samples.missingFiles.includes(doc.id.slice(0, 8)), "a paper whose file was lost is found, by a short id");
    ok(!JSON.stringify(miss.r).includes((await A.me()).id), "the owner's id is not shown");
    ok((await check()).r.missingFiles === 0, "...but not while the record is younger than the grace period (the check with the default grace sees none)");

    await admin.api(`/api/v1/dev/r2-object?key=${encodeURIComponent("docs/ghost-owner/ghost-paper-0001.pdf")}`, { method: "PUT" });
    await admin.api(`/api/v1/dev/r2-object?key=${encodeURIComponent("docs/readme.txt")}`, { method: "PUT" });
    const orphan = await check("?graceMinutes=0");
    ok(orphan.r.orphanFiles === base.orphanFiles + 1 && (base.orphanFiles >= 10 || orphan.r.samples.orphanFiles.includes("ghost-pa")), "a stored file that no paper points to is found");
    ok(orphan.r.unrecognised === base.unrecognised + 1, "a file that is not in the shape the app writes is counted, not judged");

    ok((await check("?graceMinutes=-5")).r.graceMinutes === 0, "a negative grace is raised to 0");
    ok((await check("?graceMinutes=abc")).r.graceMinutes === 15, "a grace that is not a number falls back to 15");
    ok((await check("?graceMinutes=999999")).r.graceMinutes === 1440, "a huge grace is cut to a day");

    for (const k of ["docs/ghost-owner/ghost-paper-0001.pdf", "docs/readme.txt"]) await admin.api(`/api/v1/dev/r2-object?key=${encodeURIComponent(k)}`, { method: "DELETE" });
    await A.api(`/api/v1/documents/${doc.id}`, { method: "DELETE" });
    const clean = await check("?graceMinutes=0");
    ok(clean.r.missingFiles === base.missingFiles && clean.r.orphanFiles === base.orphanFiles && clean.r.unrecognised === base.unrecognised, "after the clean-up it is back to what it was");
  }

  console.log("a deletion survives a restore");
  {
    const B = await login("ops-b", "ops-b@example.com", "Bela");
    const C = await login("ops-c", "ops-c@example.com", "Chitra");
    const bId = (await B.me()).id;
    const cId = (await C.me()).id;
    const bUp = await B.send(`${APP}/api/v1/documents`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/pdf", "X-Filename": "b.pdf" }, body: makePdf(SAMPLE_PAPER) });
    const bDoc = (await bUp.json()).document;
    const exists = async (key) => (await (await admin.api(`/api/v1/dev/r2-exists?key=${encodeURIComponent(key)}`)).json()).exists;
    ok(!(await exists(`tombstones/${bId}`)), "an account that exists has no deletion marker");

    ok((await B.api("/api/v1/account", { method: "DELETE", body: { confirm: "DELETE" } })).status === 200, "Bela deletes her account");
    ok(await exists(`tombstones/${bId}`), "a deletion marker was left in storage, where a database restore does not reach");
    ok(!(await exists(`docs/${bId}/${bDoc.id}.pdf`)), "her file is gone");
    ok((await sql(`SELECT COUNT(*) AS n FROM users WHERE id = '${bId}'`))[0].n === 0, "and her account row");

    // What a restore does: the database goes back to a moment before the deletion, so her account and paper rows return (the file does not).
    await sql(
      `INSERT INTO users (id, email, email_verified, name) VALUES ('${bId}', 'ops-b@example.com', 1, 'Bela')`,
      `INSERT INTO documents (id, user_id, title, filename, size_bytes, status) VALUES ('${bDoc.id}', '${bId}', 'b', 'b.pdf', 10, 'ready')`,
    );
    ok((await sql(`SELECT COUNT(*) AS n FROM users WHERE id = '${bId}'`))[0].n === 1, "(the test brings her account back, as a restore would)");

    ok((await anon.api("/api/v1/admin/reapply-deletions", { method: "POST" })).status === 404 && (await C.api("/api/v1/admin/reapply-deletions", { method: "POST" })).status === 404, "only an admin can re-apply deletions");
    ok((await admin.api("/api/v1/admin/reapply-deletions", { method: "POST", origin: null })).status === 403, "it has the cross-origin check");
    const first = await (await admin.api("/api/v1/admin/reapply-deletions", { method: "POST" })).json();
    ok(first.erased === 1 && first.failed === 0 && first.markers >= 1, "re-applying erases the one account that came back");
    ok((await sql(`SELECT COUNT(*) AS n FROM users WHERE id = '${bId}'`))[0].n === 0 && (await sql(`SELECT COUNT(*) AS n FROM documents WHERE user_id = '${bId}'`))[0].n === 0, "her account and paper rows are gone again");
    const second = await (await admin.api("/api/v1/admin/reapply-deletions", { method: "POST" })).json();
    ok(second.erased === 0 && second.failed === 0, "a second run finds nothing to do");
    ok((await C.me())?.id === cId && !(await exists(`tombstones/${cId}`)), "an account that was never deleted is untouched, and has no marker");
    ok((await admin.me())?.role === "admin", "...and so is the admin");
  }
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
}
await idp.close?.();
console.log(failures ? `\n${failures} operations check(s) FAILED` : "\nall operations checks passed");
process.exit(failures ? 1 : 0);
