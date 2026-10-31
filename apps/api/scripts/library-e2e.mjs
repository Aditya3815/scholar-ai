// Library + account integration test: real Worker + local D1 + fake IdP. Same setup as auth-e2e.mjs:
//   npx wrangler d1 migrations apply scholar-db --local
//   npx wrangler dev --port 8788 --var GOOGLE_CLIENT_ID:dev --var GOOGLE_CLIENT_SECRET:dev-secret \
//     --var DEV_IDP_URL:http://localhost:9911
//   node scripts/library-e2e.mjs
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const paper = (n, over = {}) => ({
  id: `doi:10.1000/test.${n}`, doi: `10.1000/test.${n}`, pmid: null, title: `Test paper ${n}`, authors: ["A. Author", "B. Writer"],
  year: 2024, venue: "Journal of Tests", abstract: "An abstract.", citationCount: 7, oaUrl: "https://example.org/p.pdf",
  retracted: false, retractionSources: [], sources: ["openalex", "s2"], score: 0.05, ...over,
});
const enc = (id) => encodeURIComponent(id);

const idp = await startFakeIdp(9911);
const login = async (sub, email, name) => {
  idp.setUser({ sub, email, email_verified: true, name });
  const c = createClient(APP);
  await c.follow(`${APP}/api/v1/auth/google/start`);
  return c;
};

try {
  console.log("anonymous access is refused");
  const anon = createClient(APP);
  ok((await anon.api("/api/v1/library")).status === 401, "GET /library -> 401");
  ok((await anon.api(`/api/v1/library/${enc("doi:x")}`, { method: "PUT", body: paper(1) })).status === 401, "PUT -> 401");
  ok((await anon.api("/api/v1/account/export")).status === 401, "GET /account/export -> 401");
  ok((await anon.api("/api/v1/account", { method: "DELETE", body: { confirm: "DELETE" } })).status === 401, "DELETE /account -> 401");

  console.log("add, list, update, remove");
  const A = await login("lib-a", "a@example.com", "Alice");
  const lib = async (c) => (await (await c.api("/api/v1/library")).json()).items;
  ok((await lib(A)).length === 0, "new account has an empty library");
  const p1 = paper(1);
  ok((await A.api(`/api/v1/library/${enc(p1.id)}`, { method: "PUT", body: p1 })).status === 200, "PUT a paper");
  let items = await lib(A);
  ok(items.length === 1 && items[0].title === "Test paper 1" && typeof items[0].savedAt === "number", "listed with a savedAt timestamp");
  await A.api(`/api/v1/library/${enc(p1.id)}`, { method: "PUT", body: { ...p1, title: "Test paper 1 (edited)" } });
  items = await lib(A);
  ok(items.length === 1 && items[0].title.endsWith("(edited)"), "PUT is idempotent (updates, no duplicate)");
  ok((await A.api(`/api/v1/library/${enc("doi:other")}`, { method: "PUT", body: p1 })).status === 400, "id in URL must match the body");
  ok((await A.api(`/api/v1/library/${enc("doi:bad")}`, { method: "PUT", body: paper(2, { id: "doi:bad", oaUrl: "javascript:alert(1)" }) })).status === 400, "javascript: oaUrl rejected");
  ok((await A.api(`/api/v1/library/${enc("doi:bad")}`, { method: "PUT", body: { id: "doi:bad", title: "x" } })).status === 400, "incomplete paper rejected");
  ok((await A.api(`/api/v1/library/${enc(p1.id)}`, { method: "PUT", body: p1, origin: null })).status === 403, "mutation without an Origin is blocked (CSRF)");
  ok((await A.api(`/api/v1/library/${enc(p1.id)}`, { method: "PUT", body: p1, origin: "http://evil.example" })).status === 403, "mutation from another origin is blocked");
  ok((await A.api(`/api/v1/library/${enc(p1.id)}`, { method: "DELETE" })).status === 200 && (await lib(A)).length === 0, "DELETE removes it");

  console.log("one-time import of a device-local library");
  const batch = [paper(10, { savedAt: Date.UTC(2025, 0, 5) }), paper(11, { savedAt: Date.UTC(2025, 0, 6) }), { id: "evil", title: "bad" }];
  let r = await (await A.api("/api/v1/library/import", { method: "POST", body: { items: batch } })).json();
  ok(r.imported === 2 && r.skipped === 1, `imported 2, skipped 1 invalid (${JSON.stringify(r)})`);
  items = await lib(A);
  ok(items.length === 2 && items[0].id.endsWith(".11"), "keeps the original savedAt order (newest first)");
  r = await (await A.api("/api/v1/library/import", { method: "POST", body: { items: batch.slice(0, 2) } })).json();
  ok(r.imported === 0, "re-importing the same items adds nothing");
  ok((await A.api("/api/v1/library/import", { method: "POST", body: { items: Array.from({ length: 501 }, (_, i) => paper(i)) } })).status === 400, "more than 500 items per import is refused");

  console.log("isolation between users");
  const B = await login("lib-b", "b@example.com", "Bob");
  ok((await lib(B)).length === 0, "Bob sees none of Alice's papers");
  await B.api(`/api/v1/library/${enc(paper(10).id)}`, { method: "DELETE" });
  ok((await lib(A)).length === 2, "Bob deleting Alice's paper id changes nothing for Alice");
  await B.api(`/api/v1/library/${enc(paper(10).id)}`, { method: "PUT", body: paper(10, { title: "Bob's own copy" }) });
  ok((await lib(A)).find((x) => x.id === paper(10).id).title === "Test paper 10", "Bob saving the same paper id does not touch Alice's copy");

  console.log("data export");
  const exp = await A.api("/api/v1/account/export");
  const expJson = await exp.json();
  ok(exp.status === 200 && /attachment; filename="sodhsetu-export-/.test(exp.headers.get("content-disposition") ?? ""), "export is a file download");
  ok(expJson.account.email === "a@example.com" && expJson.library.length === 2, "export has the account and both papers");
  ok(!JSON.stringify(expJson).includes("Bob"), "export contains nothing from Bob");
  ok(!/token|sid|session/i.test(Object.keys(expJson.account).join()), "export contains no session or token fields");

  console.log("account deletion");
  const oldId = (await A.me()).id;
  ok((await A.api("/api/v1/account", { method: "DELETE", body: {} })).status === 400, "refused without the confirm word");
  ok((await A.api("/api/v1/account", { method: "DELETE", body: { confirm: "delete" } })).status === 400, "confirm is case-sensitive");
  ok((await A.api("/api/v1/account", { method: "DELETE", body: { confirm: "DELETE" }, origin: "http://evil.example" })).status === 403, "refused from another origin");
  ok((await A.me()) !== null, "still signed in after the refused attempts");
  const del = await A.api("/api/v1/account", { method: "DELETE", body: { confirm: "DELETE" } });
  ok(del.status === 200, "deleted");
  ok((await A.me()) === null, "session is gone");
  ok((await A.api("/api/v1/library")).status === 401, "library is no longer reachable");
  ok((await lib(B)).length === 1, "Bob's data is untouched");
  const A2 = await login("lib-a", "a@example.com", "Alice");
  const newId = (await A2.me()).id;
  ok(newId !== oldId && (await lib(A2)).length === 0, "signing in again creates a brand-new empty account (nothing survived deletion)");
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
} finally {
  idp.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall library/account checks passed");
process.exit(failures ? 1 : 0);
