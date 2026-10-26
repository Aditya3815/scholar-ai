// Real-service check of the prompt box's search (W2): the real search sources and the real model, through POST /api/v1/chat. Needs a Worker started WITHOUT QA_STUB,
// with a Workers AI login and the real search keys from .dev.vars:
//   npx wrangler dev --port 8788 --var GOOGLE_CLIENT_ID:dev --var GOOGLE_CLIENT_SECRET:dev-secret --var DEV_IDP_URL:http://localhost:9911 --var ENABLE_DEV_ROUTES:1
//   node scripts/chat-live.mjs ["a question in your own words"]
// Prints, for each question, the papers, the answer, and the sentence behind each mark, so quality can be judged by eye and the groundedness measured:
// how many answers were written, how many marks were backed by a real sentence, how long the first papers and the whole answer took.
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
const QUESTIONS = process.argv[2] && !process.argv[2].startsWith("--")
  ? [process.argv[2]]
  : [
      "glaucoma screening with smartphone fundus photographs in rural India",
      "does intermittent fasting improve insulin sensitivity",
      "transformer models for low-resource Indian languages",
      "मोतियाबिंद की जांच के लिए डीप लर्निंग",
      "mere thesis ke liye graph neural networks ke applications chahiye",
      "how effective is the BCG vaccine against tuberculosis in adults",
    ];

const idp = await startFakeIdp(9911);
idp.setUser({ sub: process.env.LIVE_SUB ?? "chat-live-1", email: `${process.env.LIVE_SUB ?? "chatlive"}@example.edu`, email_verified: true, name: "Live Check" });
const A = createClient(APP);
await A.follow(`${APP}/api/v1/auth/google/start`);
await A.ack();

const stats = { asked: 0, answered: 0, notAnswered: 0, notGrounded: 0, other: 0, marks: 0, firstPapersMs: [], totalMs: [] };
for (const q of QUESTIONS) {
  const t0 = Date.now();
  const res = await A.send(`${APP}/api/v1/chat`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ mode: "search", message: q }) });
  console.log(`\n=== ${q}`);
  if (!res.ok) {
    console.log("   refused:", res.status, await res.text());
    continue;
  }
  const events = [];
  const dec = new TextDecoder();
  let buf = "";
  let firstPapers = null;
  for await (const part of res.body) {
    buf += dec.decode(part, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const data = block.split("\n").find((l) => l.startsWith("data:"));
      if (!data) continue;
      const e = JSON.parse(data.slice(5));
      if (e.type === "papers" && firstPapers === null && e.results.length) firstPapers = Date.now() - t0;
      events.push(e);
    }
  }
  const total = Date.now() - t0;
  const papers = events.filter((e) => e.type === "papers").at(-1)?.results ?? [];
  const answer = events.find((e) => e.type === "answer")?.answer;
  const done = events.find((e) => e.type === "done");
  const notices = events.filter((e) => e.type === "notice");
  stats.asked++;
  stats.firstPapersMs.push(firstPapers ?? total);
  stats.totalMs.push(total);
  console.log(`   ${papers.length} papers (first after ${firstPapers ?? "-"} ms), finished after ${total} ms; ${papers.filter((p) => p.abstract).length} with an abstract`);
  for (const n of notices) console.log(`   notice [${n.kind}]: ${n.text}`);
  if (answer?.grounded) {
    stats.answered++;
    stats.marks += answer.citations.length;
    console.log(`   ANSWER: ${answer.text}`);
    for (const c of answer.citations) console.log(`     [${c.n}] ${papers[c.n - 1]?.title?.slice(0, 70) ?? "?"} (${papers[c.n - 1]?.year ?? "?"}), sentence ${c.sentenceNo}: "${c.sentence.slice(0, 150)}"`);
  } else {
    if (done?.reason === "not_answered") stats.notAnswered++;
    else if (done?.reason === "not_grounded") stats.notGrounded++;
    else stats.other++;
    console.log(`   no answer shown (${done?.reason ?? "?"})`);
  }
  papers.slice(0, 4).forEach((p, i) => console.log(`   ${i + 1}. ${p.title.slice(0, 90)} (${p.year ?? "?"})${p.retracted ? " RETRACTED" : ""}`));
}
const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
console.log(`\n--- ${stats.asked} questions: ${stats.answered} answered with checked sources (${stats.marks} marks), ${stats.notAnswered} "papers do not answer", ${stats.notGrounded} not grounded, ${stats.other} other; median first papers ${med(stats.firstPapersMs)} ms, median finish ${med(stats.totalMs)} ms`);
idp.close();
