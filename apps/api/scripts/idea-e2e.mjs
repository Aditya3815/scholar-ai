// Idea Check integration test: real Worker + local D1 + fake IdP, with the offline stand-ins (QA_STUB=1) for the model and the
// literature services. `npm run integration -w apps/api` starts everything.
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "idea-api-1", email: "ira@example.edu", email_verified: true, name: "Ira Das" });
const A = createClient(APP);
await A.follow(`${APP}/api/v1/auth/google/start`);

const IDEA = "We want to detect fraudulent invoices in small cooperative banks using graph neural networks on transaction networks, tested on public benchmark data.";

async function events(res) {
  const out = [];
  const dec = new TextDecoder();
  let buf = "";
  for await (const part of res.body) {
    buf += dec.decode(part, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = block.split("\n").find((l) => l.startsWith("data:"));
      if (data) out.push(JSON.parse(data.slice(5)));
    }
  }
  return out;
}

try {
  console.log("access control");
  const anon = createClient(APP);
  ok((await anon.api("/api/v1/idea/plan", { method: "POST", body: { text: IDEA } })).status === 401, "planning needs sign-in");
  ok((await anon.api("/api/v1/idea/search", { method: "POST", body: { semanticQuery: "", keywordQueries: ["graph fraud"] } })).status === 401, "searching needs sign-in");
  ok((await A.api("/api/v1/idea/plan", { method: "POST", body: { text: IDEA }, origin: null })).status === 403, "planning has the cross-origin check");
  ok((await A.api("/api/v1/idea/search", { method: "POST", body: { keywordQueries: ["graph fraud"] }, origin: null })).status === 403, "searching has the cross-origin check");

  console.log("planning");
  const short = await A.api("/api/v1/idea/plan", { method: "POST", body: { text: "too short" } });
  ok(short.status === 400 && (await short.json()).type === "invalid_idea", "a few words are refused with a plain message");
  ok((await A.api("/api/v1/idea/plan", { method: "POST", body: "not json" })).status === 400, "garbage is refused");
  ok((await A.send(`${APP}/api/v1/idea/plan`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/json" }, body: JSON.stringify({ text: "x".repeat(400_000) }) })).status === 413, "an absurdly large body is refused");
  const res = await A.api("/api/v1/idea/plan", { method: "POST", body: { text: IDEA, question: "Has this been done with low-cost hardware?" } });
  const { plan } = await res.json();
  ok(res.status === 200 && res.headers.get("cache-control") === "no-store", "a plan comes back, not cacheable");
  ok(typeof plan?.title === "string" && plan.semanticQuery.length > 30 && plan.keywordQueries.length >= 2, "it has a title, a description to search by meaning and keyword searches");
  ok(["purpose", "mechanism", "evaluation", "domain"].every((k) => typeof plan.facets[k] === "string"), "and the four facets");
  const mail = await (await A.api("/api/v1/idea/plan", { method: "POST", body: { text: `${IDEA} Contact ira@example.edu or https://lab.example.edu/secret for the data.` } })).json();
  ok(!/@|https?:/.test(JSON.stringify(mail.plan)), "e-mail addresses and links never appear in what would be sent out");

  console.log("searching");
  const bad = await A.api("/api/v1/idea/search", { method: "POST", body: { semanticQuery: "short", keywordQueries: [] } });
  ok(bad.status === 400 && (await bad.json()).type === "invalid_plan", "an empty plan is refused before any stream starts");
  const s = await A.api("/api/v1/idea/search", { method: "POST", body: { semanticQuery: plan.semanticQuery, keywordQueries: plan.keywordQueries } });
  ok(s.status === 200 && /text\/event-stream/.test(s.headers.get("content-type") ?? ""), "a valid plan starts an event stream");
  const ev = await events(s);
  const done = ev.find((e) => e.type === "done");
  ok(ev[0]?.type === "stage" && !!done, "the stream has stages and ends with a result");
  ok(done.result.papers.length > 0 && done.result.papers.every((p) => typeof p.title === "string" && Array.isArray(p.foundBy)), "the result lists papers, each with how it was found");
  ok(done.result.searched.length >= 3 && done.result.searched.every((x) => typeof x.query === "string"), "and every search that was run");

  console.log("nothing is kept");
  const lib = await (await A.api("/api/v1/library")).json();
  ok(!JSON.stringify(lib).includes("cooperative"), "the idea is not written into the library");
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall idea integration checks passed");
process.exit(failures ? 1 : 0);
