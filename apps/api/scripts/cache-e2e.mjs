// Public cache integration test: the real Worker with its KV binding (a local KV that behaves like the real one), through the dev-only route /api/v1/dev/cache, plus the
// hit and miss counts reaching the database and the admin page. `npm run integration -w apps/api` starts everything.
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const post = async (body) => (await fetch(`${APP}/api/v1/dev/cache`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
const sql = async (...s) => (await (await fetch(`${APP}/api/v1/dev/sql`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: s }) })).json()).results;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const run = Date.now().toString(36);
const k = (name) => `dev:${run}-${name}`;

try {
  console.log("the binding");
  const probe = await post({ op: "get", key: k("none") });
  ok(probe.ok && probe.driver === "kv", `the Worker keeps its public cache in KV (driver: ${probe.driver})`);
  ok(probe.value === null, "a key that was never written is null");
  const bad = await fetch(`${APP}/api/v1/dev/cache`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "nonsense" }) });
  ok(bad.status === 400, "an unknown operation is refused");

  console.log("values");
  ok((await post({ op: "set", key: k("a"), value: '{"n":1}', ttl: 3600 })).ok, "a value is written");
  ok((await post({ op: "get", key: k("a") })).value === '{"n":1}', "and read back exactly");
  const uni = JSON.stringify({ title: "छत्तीसगढ़ी जागरण गीत — “quotes” ✓ 𝒳" });
  await post({ op: "set", key: k("uni"), value: uni, ttl: 3600 });
  ok((await post({ op: "get", key: k("uni") })).value === uni, "Hindi, quotes and characters outside the basic plane come back unchanged");
  await post({ op: "set", key: k("a"), value: "second", ttl: 3600 });
  ok((await post({ op: "get", key: k("a") })).value === "second", "a key written again holds the new value");
  await post({ op: "set", key: k("empty"), value: "", ttl: 3600 });
  ok((await post({ op: "get", key: k("empty") })).value === "", "an empty string is a value, not a missing key");
  await post({ op: "set", key: k("short"), value: "x", ttl: 5 });
  ok((await post({ op: "get", key: k("short") })).value === "x", "a lifetime under a minute is not refused: it is rounded up to the 60 seconds KV accepts");
  await post({ op: "set", key: k("big"), value: "x".repeat(1_000_001), ttl: 3600 });
  ok((await post({ op: "get", key: k("big") })).value === null, "a value over a million characters is not kept");
  await post({ op: "set", key: k("edge"), value: "y".repeat(1_000_000), ttl: 3600 });
  ok((await post({ op: "get", key: k("edge") })).value?.length === 1_000_000, "one of exactly a million is");

  console.log("many keys at once");
  const keys = Array.from({ length: 250 }, (_, i) => k(`m${i}`));
  await Promise.all(keys.filter((_, i) => i % 3 === 0).map((key, j) => post({ op: "set", key, value: `v${j}`, ttl: 3600 })));
  const many = await post({ op: "getMany", keys });
  const values = many.values;
  ok(Object.keys(values).length === 250, "250 keys (more than the 100 KV answers in one operation) all come back");
  ok(keys.every((key, i) => (i % 3 === 0 ? typeof values[key] === "string" : values[key] === null)), "each is its value, or null where nothing was written");

  console.log("hits and misses are counted and reach the database");
  const before = (await sql(`SELECT COALESCE(SUM(hits), 0) AS h, COALESCE(SUM(misses), 0) AS m FROM cache_stats WHERE source = 'dev'`))[0][0];
  const day = (await sql(`SELECT date('now') AS d`))[0][0].d;
  await wait(2200); // the counts of the earlier steps are written in the background; let them land first
  const settled = (await sql(`SELECT COALESCE(SUM(hits), 0) AS h, COALESCE(SUM(misses), 0) AS m FROM cache_stats WHERE source = 'dev'`))[0][0];
  ok(settled.h + settled.m > before.h + before.m, "the counts of the steps above were written to the database after their responses");
  for (let i = 0; i < 5; i++) await post({ op: "get", key: k("a") }); // 5 hits
  for (let i = 0; i < 3; i++) await post({ op: "get", key: k(`never${i}`) }); // 3 misses
  await wait(2500);
  const after = (await sql(`SELECT COALESCE(SUM(hits), 0) AS h, COALESCE(SUM(misses), 0) AS m FROM cache_stats WHERE source = 'dev'`))[0][0];
  ok(after.h - settled.h === 5 && after.m - settled.m === 3, `five hits and three misses were counted exactly (${after.h - settled.h} and ${after.m - settled.m})`);
  const rows = (await sql(`SELECT COUNT(*) AS n FROM cache_stats WHERE source = 'dev' AND day = '${day}'`))[0][0].n;
  ok(rows === 1, "one row per source per day, however many lookups there were");

  console.log("the admin page");
  const idp = await startFakeIdp(9911);
  idp.setUser({ sub: "cache-admin", email: "cache@example.com", email_verified: true, name: "Cache Admin" });
  const A = createClient(APP);
  await A.follow(`${APP}/api/v1/auth/google/start`);
  await A.api("/api/v1/dev/make-admin", { method: "POST" });
  const o = await (await A.api("/api/v1/admin/overview")).json();
  const dev = o.cache.find((c) => c.source === "dev");
  ok(Array.isArray(o.cache) && dev && dev.hits >= 5 && dev.misses >= 3, `the overview lists the public cache by source (dev: ${dev?.hits} kept, ${dev?.misses} asked)`);
  ok(o.cache.every((c) => typeof c.source === "string" && c.hits >= 0 && c.misses >= 0), "every row has a source and non-negative counts");
  ok(!JSON.stringify(o.cache).includes(run), "no key or value appears in it: only the name of the source");
  idp.close?.();
} catch (e) {
  console.error(e);
  failures++;
}
console.log(failures === 0 ? "\npublic cache: all passed" : `\npublic cache: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
