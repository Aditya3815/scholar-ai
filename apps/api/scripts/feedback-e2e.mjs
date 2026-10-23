// "Report a problem" and the admin overview: real Worker + local D1 + fake IdP. `npm run integration -w apps/api` starts everything.
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const idp = await startFakeIdp(9911);
const login = async (sub, email, name) => {
  idp.setUser({ sub, email, email_verified: true, name });
  const c = createClient(APP);
  await c.follow(`${APP}/api/v1/auth/google/start`);
  return c;
};
const report = (c, body, origin = APP) => c.api("/api/v1/feedback", { method: "POST", body, origin });

try {
  const anon = createClient(APP);
  const U = await login("fb-user", "fb@example.edu", "Fay Bose");

  console.log("sending a report");
  ok((await report(anon, { kind: "other", problem: "other", note: "hi" })).status === 401, "needs sign-in");
  ok((await report(U, { kind: "other", problem: "other" }, null)).status === 403, "has the cross-origin check");
  ok((await report(U, { kind: "nonsense", problem: "other" })).status === 400, "an unknown kind is refused");
  ok((await report(U, { kind: "reference", problem: "wrong_verdict", reference: "short" })).status === 400, "a reference report needs the reference text");
  const ref = "Kumar, V., & Iyer, S. (2015). Deep learning. Nature, 521, 436-444. Contact kumar@example.org for the PDF.";
  const r1 = await report(U, { kind: "reference", problem: "wrong_verdict", note: "This is a real paper, see https://doi.org/10.1038/nature14539", reference: ref, status: "mismatch", reason: "details differ" });
  ok(r1.status === 201, "a reference verdict can be reported");
  ok((await report(U, { kind: "idea", problem: "missed_paper", note: "Missing the 2019 survey", semanticQuery: "graph networks for fraud detection in banks", keywordQueries: ["graph fraud", "bank invoice fraud"] })).status === 201, "an idea search can be reported");
  ok((await report(U, { kind: "other", problem: "other", note: "x".repeat(5000) })).status === 201, "an overlong note is accepted but cut, not rejected");

  console.log("the admin page");
  ok((await anon.api("/api/v1/admin/overview")).status === 404, "signed-out visitors are told it does not exist");
  ok((await U.api("/api/v1/admin/overview")).status === 404, "so are ordinary users");
  ok((await U.api("/api/v1/dev/make-admin", { method: "POST" })).status === 200, "(the test makes this user an admin)");
  const res = await U.api("/api/v1/admin/overview");
  const o = await res.json();
  ok(res.status === 200 && res.headers.get("cache-control") === "no-store", "an admin gets the overview, never cached");
  ok(o.users.total >= 1 && typeof o.documents.total === "number" && Array.isArray(o.usage) && Array.isArray(o.byModel), "it has users, papers, usage and models");
  ok(Array.isArray(o.byFeature) && o.scans && typeof o.scans.costCents === "number", "...and cost by feature and for scanned pages");
  // cost is read from the ledger: three calls of two kinds, one scanned-page day
  await fetch(`${APP}/api/v1/dev/sql`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: [
    "INSERT INTO llm_usage (subject, task, sensitivity, provider, model, tokens_in, tokens_out, cost_cents, ok, ms, label) VALUES ('t', 'qa', 'private', 'workersai', '@cf/openai/gpt-oss-120b', 1000, 300, 0.05, 1, 100, 'doc_qa')",
    "INSERT INTO llm_usage (subject, task, sensitivity, provider, model, tokens_in, tokens_out, cost_cents, ok, ms, label) VALUES ('t', 'qa', 'private', 'workersai', '@cf/openai/gpt-oss-120b', 2000, 3000, 0.3, 1, 100, 'idea_compare')",
    "INSERT INTO llm_usage (subject, task, sensitivity, provider, model, tokens_in, tokens_out, cost_cents, ok, ms, label) VALUES ('t', 'qa', 'private', 'workersai', '@cf/openai/gpt-oss-120b', 0, 0, 0, 0, 100, 'idea_compare')",
    "INSERT INTO ocr_usage (user_id, day, pages, neurons) SELECT id, date('now'), 10, 1800 FROM users LIMIT 1",
  ] }) });
  const o2 = await (await U.api("/api/v1/admin/overview")).json();
  const cmp = o2.byFeature.find((f) => f.feature === "idea_compare");
  ok(cmp && cmp.calls === 2 && cmp.failed === 1 && cmp.tokensOut === 3000 && Math.abs(cmp.costCents - 0.3) < 1e-6, "cost by feature adds up what each step used, failed calls included");
  ok(o2.byFeature[0].feature === "idea_compare", "the dearest feature is listed first");
  ok(o2.byModel.find((m) => m.model === "@cf/openai/gpt-oss-120b" && Math.abs(m.costCents - 0.35) < 1e-6), "cost by model adds up too");
  ok(o2.scans.pages >= 10 && o2.scans.neurons >= 1800 && Math.abs(o2.scans.costCents - o2.scans.neurons * 0.0011) < 1e-3, "scanned pages are priced from their neurons ($0.011 per 1,000)");
  const fr = o.feedback.find((f) => f.kind === "reference");
  ok(fr && fr.context.reference.includes("Deep learning") && !/kumar@example\.org/.test(JSON.stringify(fr)) && !/https?:/.test(fr.note), "a report shows what was reported, without e-mail addresses or links");
  ok(o.feedback.find((f) => f.problem === "other" && f.note?.length === 1000), "the long note was cut to 1,000 characters");
  ok(o.feedback.every((f) => /^[0-9a-f]{8}$/.test(f.user)), "the user is shown as a short id, not a name or e-mail");
  ok(!JSON.stringify(o).includes("fb@example.edu"), "no e-mail address appears anywhere in the overview");
  ok((await U.api(`/api/v1/admin/feedback/${fr.id}`, { method: "DELETE", origin: null })).status === 403, "removing a report has the cross-origin check");
  ok((await U.api(`/api/v1/admin/feedback/${fr.id}`, { method: "DELETE" })).status === 200, "an admin can remove a handled report");
  ok(!(await (await U.api("/api/v1/admin/overview")).json()).feedback.some((f) => f.id === fr.id), "...and it is gone");

  console.log("error reporting");
  ok((await anon.api("/api/v1/monitoring", { method: "POST", body: { type: "TypeError", message: "x", path: "/papers" } })).status === 204, "the browser can report an error, and is told 204 whether or not Sentry is set up");
  ok((await anon.api("/api/v1/monitoring", { method: "POST", body: { message: "x" }, origin: "https://evil.example" })).status === 403, "another site cannot post to it");
  const test = await U.api("/api/v1/admin/monitoring-test", { method: "POST" });
  ok(test.status === 200 && (await test.json()).configured === false, "an admin can run the test, which says not set up while there is no DSN");
  ok((await anon.api("/api/v1/admin/monitoring-test", { method: "POST" })).status === 404, "anyone else is told the test does not exist");

  console.log("the daily limit and deletion");
  let last = 201;
  for (let i = 0; i < 40 && last === 201; i++) last = (await report(U, { kind: "other", problem: "other", note: `n${i}` })).status;
  ok(last === 429, "a user cannot send more than 30 reports a day");
  ok((await U.api("/api/v1/account", { method: "DELETE", body: { confirm: "DELETE" } })).status === 200, "deleting the account succeeds");
  const U2 = await login("fb-user", "fb@example.edu", "Fay Bose");
  await U2.api("/api/v1/dev/make-admin", { method: "POST" });
  const after = await (await U2.api("/api/v1/admin/overview")).json();
  ok(after.feedback.length === 0, "deleting the account removed every report it had sent");
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
}
await idp.close?.();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall feedback checks passed");
process.exit(failures ? 1 : 0);
