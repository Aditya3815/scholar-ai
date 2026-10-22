import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHECKS, detailLine, main, runChecks, summary, tryOnce } from "./watchdog.mjs";

const BASE = "https://example.workers.dev";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const html = (body, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/html" } });
const APP_HTML = '<!doctype html><html><body><div id="root"></div></body></html>';
const GOOD = (url) => {
  const p = new URL(url).pathname;
  if (p === "/api/v1/health") return json({ ok: true, db: "ok", migrations: 10 });
  if (p === "/api/v1/health/jobs") return json({ ok: true, scheduled: true, jobs: [{ name: "maintenance", state: "ok" }] });
  return html(APP_HTML);
};
const route = (fn) => async (url) => fn(String(url));
const noWait = async () => {};
const [SERVICE, JOBS, WEB] = CHECKS;

test("all three checks pass on a healthy service, with one try each", async () => {
  const r = await runChecks({ base: BASE, doFetch: route(GOOD), wait: noWait });
  assert.deepEqual(r.map((x) => [x.name, x.ok, x.tries]), [["service", true, 1], ["daily job", true, 1], ["web app", true, 1]]);
});

test("a service that reports itself down is a failure with the reason", async () => {
  const r = await tryOnce(BASE, SERVICE, route(() => json({ ok: false, db: "error", migrations: 0 }, 503)));
  assert.equal(r.ok, false);
  assert.match(r.reason, /HTTP 503 \(ok=false db=error migrations=0\)/);
});

test("200 with ok:false, or with no migrations, or a database error, is still a failure", async () => {
  for (const body of [{ ok: false, db: "ok", migrations: 5 }, { ok: true, db: "error", migrations: 5 }, { ok: true, db: "ok", migrations: 0 }, {}, null]) {
    assert.equal((await tryOnce(BASE, SERVICE, route(() => json(body)))).ok, false, JSON.stringify(body));
  }
});

test("the daily job: overdue is reported by name and state", async () => {
  const r = await tryOnce(BASE, JOBS, route(() => json({ ok: false, scheduled: true, jobs: [{ name: "maintenance", state: "overdue" }] }, 503)));
  assert.match(r.reason, /HTTP 503 \(maintenance: overdue\)/);
});

test("the daily job: a database error answer is reported", async () => {
  const r = await tryOnce(BASE, JOBS, route(() => json({ ok: false, scheduled: true, jobs: [], error: "db" }, 503)));
  assert.match(r.reason, /error=db/);
});

test("an HTML error page from the platform (not JSON) is a failure, not a crash", async () => {
  const r = await tryOnce(BASE, SERVICE, route(() => html("<html>Error 522 connection timed out</html>", 522)));
  assert.equal(r.ok, false);
  assert.equal(r.reason, "HTTP 522");
  const r2 = await tryOnce(BASE, SERVICE, route(() => html("<html>captive portal</html>")));
  assert.equal(r2.reason, "HTTP 200 but the answer is not JSON");
});

test("a redirect is not followed and not accepted", async () => {
  const r = await tryOnce(BASE, SERVICE, route(() => new Response(null, { status: 301, headers: { Location: "https://elsewhere.example" } })));
  assert.equal(r.ok, false);
  assert.match(r.reason, /HTTP 301/);
});

test("the web app check wants the app's own page, not any 200", async () => {
  assert.equal((await tryOnce(BASE, WEB, route(() => html(APP_HTML)))).ok, true);
  assert.equal((await tryOnce(BASE, WEB, route(() => html("<html><body>Welcome to nginx!</body></html>")))).ok, false);
  assert.equal((await tryOnce(BASE, WEB, route(() => html("")))).ok, false);
});

test("a connection that fails or times out is a failure with a plain reason", async () => {
  const refused = await tryOnce(BASE, SERVICE, async () => { throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } }); });
  assert.match(refused.reason, /could not connect \(ECONNREFUSED\)/);
  const slow = await tryOnce(BASE, SERVICE, async () => { throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }); }, 10_000);
  assert.match(slow.reason, /no answer within 10 s/);
});

test("a body that cannot be read is a failure", async () => {
  const res = { status: 200, text: async () => { throw new Error("stream reset"); } };
  assert.match((await tryOnce(BASE, SERVICE, async () => res)).reason, /body unreadable/);
});

test("one dropped request does not count: it is tried again and passes", async () => {
  let n = 0;
  const waits = [];
  const r = await runChecks({ base: BASE, doFetch: route((u) => (u.endsWith("/api/v1/health") && n++ < 1 ? json({ ok: false }, 503) : GOOD(u))), wait: async (ms) => void waits.push(ms) });
  assert.equal(r[0].ok, true);
  assert.equal(r[0].tries, 2);
  assert.deepEqual(waits, [15_000]);
});

test("a check that keeps failing is tried three times, then reported, and the other checks still run", async () => {
  let health = 0;
  const r = await runChecks({ base: BASE, doFetch: route((u) => (u.endsWith("/api/v1/health") ? (health++, json({ ok: false }, 503)) : GOOD(u))), wait: noWait });
  assert.equal(health, 3);
  assert.deepEqual(r.map((x) => x.ok), [false, true, true]);
  assert.match(summary(r), /FAIL service .* after 3 tries/);
  assert.match(detailLine(r), /^service: HTTP 503/);
});

test("the detail line is empty when everything passes, and is bounded", async () => {
  const good = await runChecks({ base: BASE, doFetch: route(GOOD), wait: noWait });
  assert.equal(detailLine(good), "");
  const many = Array.from({ length: 50 }, (_, i) => ({ ok: false, name: `check ${i}`, reason: "x".repeat(30) }));
  assert.ok(detailLine(many).length <= 400);
});

test("main: exit 0 and a summary on success; exit 1 with the detail output on failure; exit 2 for a bad BASE_URL", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wd-"));
  const out = { lines: [], log: (l) => out.lines.push(l), error: (l) => out.lines.push(`E:${l}`) };
  const env = { BASE_URL: BASE, GITHUB_STEP_SUMMARY: join(dir, "sum.md"), GITHUB_OUTPUT: join(dir, "out.txt") };
  assert.equal(await main(env, out, route(GOOD), noWait), 0);
  assert.equal(await main({ ...env, GITHUB_OUTPUT: join(dir, "out2.txt") }, out, route((u) => (u.endsWith("/jobs") ? json({ ok: false, jobs: [{ name: "maintenance", state: "failing" }] }, 503) : GOOD(u))), noWait), 1);
  assert.match(readFileSync(join(dir, "out2.txt"), "utf8"), /^detail=daily job: HTTP 503 \(maintenance: failing\)\n$/);
  assert.match(readFileSync(join(dir, "sum.md"), "utf8"), /### Watchdog/);
  for (const bad of [undefined, "", "http://insecure.example", "https://a.example/path", "not a url"]) assert.equal(await main({ BASE_URL: bad }, out, route(GOOD), noWait), 2, String(bad));
});
