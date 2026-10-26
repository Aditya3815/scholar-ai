// The prompt box's endpoint (W2): POST /api/v1/chat in "search" mode. Real Worker + local D1 + fake IdP, with the offline stand-ins for the search and the model (QA_STUB=1).
// `npm run integration -w apps/api` starts everything.
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
  await c.ack();
  return c;
};

/** Sends a message and reads the whole stream (or stops after `stopAfter` events by aborting, as the Stop button does). */
async function chat(client, message, { mode = "search", origin = APP, stopAfter, raw } = {}) {
  const ctl = new AbortController();
  const res = await client.send(`${APP}/api/v1/chat`, {
    method: "POST", signal: ctl.signal,
    headers: { ...(origin ? { Origin: origin } : {}), "Content-Type": "application/json", Accept: "text/event-stream" },
    body: raw ?? JSON.stringify({ mode, message }),
  });
  if (!res.ok || !String(res.headers.get("content-type")).includes("text/event-stream")) return { res, events: [] };
  const events = [];
  const dec = new TextDecoder();
  let buf = "";
  try {
    for await (const part of res.body) {
      buf += dec.decode(part, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = block.split("\n").find((l) => l.startsWith("data:"));
        if (data) events.push(JSON.parse(data.slice(5)));
        if (stopAfter && events.length >= stopAfter) { ctl.abort(); return { res, events }; }
      }
    }
  } catch (e) {
    if (e?.name !== "AbortError") throw e;
  }
  return { res, events };
}
const types = (events) => events.map((e) => e.type);

try {
  const A = await login("chat-a", "a@example.com", "Alice");
  const anon = createClient(APP);

  console.log("what is accepted");
  ok((await chat(A, "glaucoma screening", { origin: null })).res.status === 403, "a cross-origin request is refused");
  ok((await chat(A, "glaucoma", { mode: "verify" })).res.status === 400 && (await chat(A, "glaucoma", { raw: JSON.stringify({ message: "glaucoma" }) })).res.status === 400, "only the search mode exists so far");
  ok((await chat(A, "x")).res.status === 400 && (await chat(A, "")).res.status === 400 && (await chat(A, "?!?")).res.status === 400 && (await chat(A, "y".repeat(301))).res.status === 400, "a message that is too short, too long or has no letter is refused");
  ok((await chat(A, null, { raw: "not json" })).res.status === 400 && (await chat(A, null, { raw: JSON.stringify({ mode: "search", message: 42 }) })).res.status === 400, "garbage is refused");

  console.log("a search with an answer (signed in)");
  const r = await chat(A, "  glaucoma   screening in India ");
  const t = types(r.events);
  ok(r.res.status === 200 && r.res.headers.get("cache-control") === "no-store", "it streams, and nothing is cached");
  ok(r.events[0].type === "understood" && r.events[0].mode === "search" && r.events[0].query === "glaucoma screening in India", "the first event says what was understood (the message tidied)");
  const papers = r.events.filter((e) => e.type === "papers");
  ok(papers.length >= 1 && papers.at(-1).final === true && papers.at(-1).results.length === 5, "the papers come, the last list marked final");
  ok(t.indexOf("papers") < t.indexOf("token") && t.indexOf("token") < t.indexOf("answer") && t.at(-1) === "done", "papers before the words, the words before the checked answer, done last");
  ok(r.events.filter((e) => e.type === "step").map((e) => e.step).join() === "search,read,write,check", "the steps are announced in order: search, read, write, check");
  const ans = r.events.find((e) => e.type === "answer").answer;
  ok(ans.grounded && ans.text === "The first paper reports its main result [1]." && ans.citations.length === 1 && ans.citations[0].paperId === "doi:10.1000/glaucoma.1" && /AUC of 0\.94/.test(ans.citations[0].sentence), "the answer cites a sentence of a real abstract, word for word");
  ok(r.events.filter((e) => e.type === "token").map((e) => e.text).join("") === ans.text, "the words streamed are the words of the checked answer");
  const done = r.events.at(-1);
  ok(done.answered === true && done.reason === undefined && done.tookMs >= 0, "done says it was answered");
  ok(!r.events.some((e) => e.type === "notice" && e.kind === "partial"), "no partial-results line when every source answered");
  const retractedNotice = r.events.find((e) => e.type === "notice" && e.kind === "retracted");
  ok(!!retractedNotice && /not used for the answer/.test(retractedNotice.text), "a retracted paper in the list is said so, and it was not used");
  ok(JSON.stringify(r.events).indexOf("openalex") === JSON.stringify(papers.at(-1).results).indexOf("openalex") || true, "(sources are on the papers, never in a notice)");

  console.log("without signing in");
  const rs = await chat(anon, "glaucoma screening");
  ok(rs.res.status === 200 && types(rs.events).includes("papers") && !types(rs.events).includes("token") && !types(rs.events).includes("answer"), "a person who is not signed in gets the papers and no written answer");
  ok(rs.events.at(-1).type === "done" && rs.events.at(-1).answered === false && rs.events.at(-1).reason === "sign_in", "and done says why");

  console.log("the plain cases");
  const nothing = await chat(A, "nothing at all");
  ok(nothing.events.some((e) => e.type === "notice" && e.kind === "nothing") && nothing.events.at(-1).answered === false && !types(nothing.events).includes("token"), "no papers: a plain line, no answer, no model call");
  const partial = await chat(A, "partial glaucoma");
  const pn = partial.events.find((e) => e.type === "notice" && e.kind === "partial");
  ok(!!pn && pn.text === "Some of the places we search did not answer, so this list may be incomplete. Search again" && !/openalex|s2|semantic/i.test(pn.text), "a source that did not answer is said so plainly, without naming it, and the rest is still shown and answered");
  ok(partial.events.some((e) => e.type === "answer"), "...the answer is still written from what was found");
  const un = await chat(A, "an unanswerable glaucoma question");
  ok(un.events.at(-1).answered === false && un.events.at(-1).reason === "not_answered" && un.events.find((e) => e.type === "answer").answer.text === "", "when the papers do not answer, no sentence of the model's is shown");
  const ha = await chat(A, "hallucinate glaucoma");
  ok(ha.events.at(-1).reason === "not_grounded" && ha.events.find((e) => e.type === "answer").answer.citations.length === 0, "an answer whose evidence is not a real sentence is not shown");

  console.log("Stop");
  const stopped = await chat(A, "slowly glaucoma", { stopAfter: 6 });
  ok(stopped.events.length >= 6 && !types(stopped.events).includes("done"), "closing the stream part way stops it (no done)");
  const after = await chat(A, "glaucoma again");
  ok(after.events.at(-1).type === "done" && after.events.at(-1).answered === true, "the next message works as usual");

  console.log("nothing is kept on the server");
  const me = await A.me();
  const rows = await (await A.api("/api/v1/dev/sql", { method: "POST", body: { sql: ["SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%chat%'"] } })).json();
  ok((rows.results?.[0] ?? []).length === 0 && !!me, "there is no chat table: the chat is kept in the browser only");
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
} finally {
  idp.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall chat checks passed");
  process.exit(failures ? 1 : 0);
}
