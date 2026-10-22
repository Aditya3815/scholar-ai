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
  const early = await A.api("/api/v1/idea/plan", { method: "POST", body: { text: IDEA } });
  ok(early.status === 403 && (await early.json()).type === "privacy_ack_required", "a first check is refused until the privacy note has been read");
  ok((await A.ack()).status === 200, "(the privacy note is read)");
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

  console.log("comparing and reading the closest papers");
  const papers = done.result.papers.filter((p) => p.kind !== "data").slice(0, 8).map((p) => ({ id: p.id, title: p.title, year: p.year, abstract: p.abstract }));
  const body = { title: plan.title, summary: plan.summary, facets: plan.facets, question: "Does it work with low-cost hardware?", papers };
  for (const [name, path, finalType] of [["comparing", "/api/v1/idea/compare", "comparison"], ["reading", "/api/v1/idea/insights", "insights"]]) {
    ok((await anon.api(path, { method: "POST", body })).status === 401, `${name} needs sign-in`);
    ok((await A.api(path, { method: "POST", body, origin: null })).status === 403, `${name} has the cross-origin check`);
    const empty = await A.api(path, { method: "POST", body: { papers: [] } });
    ok(empty.status === 400, `${name} with nothing to read is refused before a stream starts`);
    ok((await A.api(path, { method: "POST", body: "not json" })).status === 400, `${name} refuses garbage`);
    ok((await A.send(`${APP}${path}`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/json" }, body: JSON.stringify({ x: "y".repeat(200_000) }) })).status === 413, `${name} refuses an absurdly large body`);
    const stream = await A.api(path, { method: "POST", body });
    ok(stream.status === 200 && /text\/event-stream/.test(stream.headers.get("content-type") ?? "") && stream.headers.get("cache-control") === "no-store", `${name} starts an event stream that is not cacheable`);
    const evs = await events(stream);
    ok(evs.some((e) => e.type === "stage") && evs.at(-1)?.type === "done" && !!evs.at(-1)[finalType], `${name} reports stages and ends with its result`);
  }
  const reading = (await events(await A.api("/api/v1/idea/insights", { method: "POST", body }))).at(-1).insights;
  ok(reading.papersRead === papers.length && reading.readings.length === papers.length, "every paper that has an abstract was read once");
  ok(reading.readings[0].outcome.kind === "positive" && !!reading.readings[0].outcome.quote, "a result is shown with its sentence");
  ok(reading.readings[2].outcome.kind === "not_stated", "a paper that states no result says so");
  ok(reading.openProblems.length === 2 && reading.droppedClaims === 1, "stated open problems are kept, and a claim whose sentence is not in the abstract is dropped and counted");
  ok(reading.answer?.statements.length === 2 && reading.answer.statements[0].text && reading.answer.statements[0].cites.length === 1, "the answer keeps the statement that its sentence supports");
  ok(reading.answer.statements[1].text === null && reading.answer.statements[1].cites[0].quote.length > 20, "...and a statement that its sentence does not support is dropped, while the sentence itself is kept as evidence");
  ok(reading.opinion.length === 2 && !reading.opinion.some((t) => /novel/i.test(t)), "an opinion that says the idea is new is not shown");
  const noQ = (await events(await A.api("/api/v1/idea/insights", { method: "POST", body: { ...body, question: undefined } }))).at(-1).insights;
  ok(noQ.answer === null, "with no question there is no answer");
  const privacyless = createClient(APP);
  idp.setUser({ sub: "idea-api-2", email: "noack@example.edu", email_verified: true, name: "No Ack" });
  await privacyless.follow(`${APP}/api/v1/auth/google/start`);
  const refused = await privacyless.api("/api/v1/idea/insights", { method: "POST", body });
  ok(refused.status === 403 && (await refused.json()).type === "privacy_ack_required", "reading is refused until the privacy note has been read");

  console.log("nothing is kept");
  const lib = await (await A.api("/api/v1/library")).json();
  ok(!JSON.stringify(lib).includes("cooperative"), "the idea is not written into the library");
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
}
await idp.close?.(); // the next suite starts its own identity provider on the same port
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall idea integration checks passed");
process.exit(failures ? 1 : 0);
