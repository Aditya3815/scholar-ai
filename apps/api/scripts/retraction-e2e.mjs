// S3: saved papers are looked at again for retractions, and the person is told. Real Worker + local D1 + fake identity provider; the Worker runs with --test-scheduled and the offline
// Crossref stand-in (src/library/retraction-stub.ts: a DOI containing "retracted" is retracted, "reject" is refused by the service). `npm run integration -w apps/api` starts everything.
//   node scripts/retraction-e2e.mjs
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const paper = (doi, over = {}) => ({
  id: `doi:${doi}`, doi, pmid: null, title: `About ${doi}`, authors: ["A. Author"], year: 2024, venue: "Journal of Tests", abstract: "An abstract.", citationCount: 1,
  oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 0.05, ...over,
});
const enc = encodeURIComponent;
const sql = async (...statements) => (await (await fetch(`${APP}/api/v1/dev/sql`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: statements }) })).json()).results ?? [];

const idp = await startFakeIdp(9911);
const login = async (sub, email, name) => {
  idp.setUser({ sub, email, email_verified: true, name });
  const c = createClient(APP);
  await c.follow(`${APP}/api/v1/auth/google/start`);
  return c;
};
const read = async (c) => (await c.api("/api/v1/library")).json();
const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };
const runJob = async () => (await fetch(`${APP}/cdn-cgi/handler/scheduled`)).status;

try {
  const A = await login("ret-a", "ret-a@example.com", "Asha");
  const B = await login("ret-b", "ret-b@example.com", "Bela");
  const fine = paper("10.5555/fine.e2e");
  const gone = paper("10.5555/retracted.e2e");
  const odd = paper("10.5555/reject.e2e");
  for (const p of [fine, gone, odd]) await A.api(`/api/v1/library/${enc(p.id)}`, { method: "PUT", body: p });
  await B.api(`/api/v1/library/${enc(gone.id)}`, { method: "PUT", body: { ...gone, doi: "10.5555/RETRACTED.e2e" } }); // spelled differently
  await B.api(`/api/v1/library/${enc(fine.id)}`, { method: "PUT", body: fine });

  console.log("before the re-check");
  let a = await read(A);
  ok(a.items.length === 3 && Array.isArray(a.alerts) && a.alerts.length === 0 && a.items.every((i) => i.retracted === false), "a saved paper is not marked, and there is no notice");

  console.log("the daily job");
  ok((await runJob()) === 200, "the scheduled job ran");
  ok(await until(async () => (await read(A)).alerts.length === 1), "a notice appears for the person who saved the retracted paper");
  a = await read(A);
  ok(a.alerts[0].paperId === gone.id && a.alerts[0].title === gone.title && a.alerts[0].kind === "retracted" && !Number.isNaN(Date.parse(a.alerts[0].at)), "it names the paper, with its title and the time it was found");
  const g = a.items.find((i) => i.id === gone.id);
  ok(g.retracted === true && g.retractionSources.includes("crossref-retraction-watch"), "the paper in the library now shows as retracted, with the source named");
  ok(a.items.filter((i) => i.retracted).length === 1, "the other two papers are not marked (a DOI the service refused is not called retracted)");
  const b = await read(B);
  ok(b.alerts.length === 1 && b.alerts[0].paperId === gone.id && b.items.find((i) => i.id === fine.id).retracted === false, "the other person who saved it (a different spelling of the DOI) gets a notice too, for that paper only");
  const rows = (await sql("SELECT doi, state FROM paper_retraction ORDER BY doi"))[0];
  ok(JSON.stringify(rows.map((r) => [r.doi, r.state])) === JSON.stringify([["10.5555/fine.e2e", "clear"], ["10.5555/reject.e2e", "unknown"], ["10.5555/retracted.e2e", "retracted"]]), `what was learned is kept by DOI: ${JSON.stringify(rows.map((r) => [r.doi, r.state]))}`);
  ok(Object.keys((await sql("SELECT * FROM paper_retraction LIMIT 1"))[0][0] ?? {}).sort().join() === "checked_at,doi,retracted_at,state", "the shared table has no person in it");
  const health = await (await fetch(`${APP}/api/v1/health/jobs`)).json();
  ok(health.jobs?.some((j) => j.name === "retraction_check" && j.state === "ok"), "the admin and uptime view list the job, as on time");

  console.log("a second run");
  await runJob();
  await new Promise((r) => setTimeout(r, 1500));
  ok((await read(A)).alerts.length === 1 && (await read(B)).alerts.length === 1, "makes no second notice");

  console.log("dismissing");
  ok((await A.api("/api/v1/library/alerts/seen", { method: "POST", body: { paperIds: [gone.id] }, origin: null })).status === 403, "needs the same origin (CSRF)");
  ok((await createClient(APP).api("/api/v1/library/alerts/seen", { method: "POST", body: {} })).status === 401, "needs a signed-in person");
  const other = await (await B.api("/api/v1/library/alerts/seen", { method: "POST", body: { paperIds: ["doi:not-mine"] } })).json();
  ok(other.dismissed === 0 && (await read(A)).alerts.length === 1, "someone else cannot dismiss a person's notice");
  const done = await (await A.api("/api/v1/library/alerts/seen", { method: "POST", body: { paperIds: [gone.id] } })).json();
  ok(done.dismissed === 1 && (await read(A)).alerts.length === 0, "dismissing removes it from what is shown");
  ok((await read(A)).items.find((i) => i.id === gone.id).retracted === true, "...but the paper stays marked as retracted");
  ok((await read(B)).alerts.length === 1, "...and the other person's notice is still there");
  await runJob();
  await new Promise((r) => setTimeout(r, 1500));
  ok((await read(A)).alerts.length === 0, "a dismissed notice does not come back with the next run");

  console.log("the export and removing the paper");
  const exp = await (await A.api("/api/v1/account/export")).json();
  ok(exp.retractionNotices?.length === 1 && exp.retractionNotices[0].paperId === gone.id && exp.retractionNotices[0].dismissedAt, "the data export lists the notice, with when it was dismissed");
  ok((await B.api(`/api/v1/library/${enc(gone.id)}`, { method: "DELETE" })).status === 200 && (await read(B)).alerts.length === 0, "taking the paper out of the library settles its notice");
  const left = (await sql(`SELECT COUNT(*) AS n FROM library_alerts WHERE paper_id = '${gone.id}' AND user_id = '${(await B.me()).id}'`))[0][0].n;
  ok(left === 0, "and removes the row");

  console.log("erasing the account");
  const aid = (await A.me()).id;
  ok((await A.api("/api/v1/account", { method: "DELETE", body: { confirm: "DELETE" } })).status === 200, "deleted");
  ok((await sql(`SELECT COUNT(*) AS n FROM library_alerts WHERE user_id = '${aid}'`))[0][0].n === 0, "no notice of that person is left");
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
} finally {
  idp.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall retraction re-check checks passed");
process.exit(failures ? 1 : 0);
