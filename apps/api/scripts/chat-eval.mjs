// Quality check of the prompt box's search answer (W2) with the REAL search sources and the REAL model, through POST /api/v1/chat.
//
//   npx wrangler dev --port 8788 --var GOOGLE_CLIENT_ID:dev --var GOOGLE_CLIENT_SECRET:dev-secret --var DEV_IDP_URL:http://localhost:9911 --var ENABLE_DEV_ROUTES:1
//   node scripts/chat-eval.mjs [--gate]
//
// What it measures, over a fixed list of questions (the papers found change from week to week, so it checks properties, not exact words):
//   answered      on questions with plenty of literature, how many get a written answer (the model may decline; too many declines is a regression)
//   real          every sentence shown as evidence really is a sentence of that paper's abstract (re-checked here, apart from the server's own check)
//   not retracted no mark ever points at a retracted paper
//   clean marks   every [n] in the text is one of the checked citations, and no sentence label (S3), round-bracket number or 【】 token is left in the words
//   controls      for nonsense questions that find nothing useful, no answer is written
// With --gate it exits with 1 when a line below its limit. Each question uses its own throwaway account so the daily allowance does not stop a run.
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
const gate = process.argv.includes("--gate");

const ON_TOPIC = [
  "glaucoma screening with smartphone fundus photographs in rural India",
  "does intermittent fasting improve insulin sensitivity",
  "transformer models for low-resource Indian languages",
  "how effective is the BCG vaccine against tuberculosis in adults",
  "effect of yoga on blood pressure in hypertensive patients",
  "machine learning for crop yield prediction in India",
  "microplastics in drinking water and human health",
  "retrieval augmented generation for question answering over scientific papers",
  "solar powered irrigation for smallholder farmers",
  "mindfulness based interventions for student anxiety",
  "graph neural networks for drug discovery",
  "air pollution and childhood asthma in Delhi",
];
const CONTROLS = ["qwertyuiop asdfghjkl zxcvbnm", "blorptide xylonase quizzlefrump"];
// informational only for now: the indexes are searched with the words as written, so a Hindi or Hinglish question finds little (the router, W3, translates it)
const LANGUAGES = ["मधुमेह में व्यायाम का प्रभाव", "diabetes me exercise ka kya asar hota hai"];

const idp = await startFakeIdp(9911);
const results = [];
let n = 0;

async function ask(message, group) {
  idp.setUser({ sub: `chat-eval-${Date.now()}-${n++}`, email: `chateval${n}@example.edu`, email_verified: true, name: "Chat Eval" });
  const A = createClient(APP);
  await A.follow(`${APP}/api/v1/auth/google/start`);
  await A.ack();
  const t0 = Date.now();
  const res = await A.send(`${APP}/api/v1/chat`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ mode: "search", message }) });
  const events = [];
  if (res.ok) {
    const dec = new TextDecoder();
    let buf = "";
    for await (const part of res.body) {
      buf += dec.decode(part, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const data = buf.slice(0, i).split("\n").find((l) => l.startsWith("data:"));
        buf = buf.slice(i + 2);
        if (data) events.push(JSON.parse(data.slice(5)));
      }
    }
  }
  const papers = events.filter((e) => e.type === "papers").at(-1)?.results ?? [];
  const answer = events.find((e) => e.type === "answer")?.answer;
  const done = events.find((e) => e.type === "done");
  const row = { group, message, ms: Date.now() - t0, papers: papers.length, withAbstract: papers.filter((p) => p.abstract).length, reason: done?.reason ?? (answer?.grounded ? "answered" : "?"), answered: !!answer?.grounded, problems: [] };
  if (answer?.grounded) {
    const flat = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();
    for (const c of answer.citations) {
      const p = papers[c.n - 1];
      if (!p || p.id !== c.paperId) row.problems.push(`citation ${c.n} does not point at its paper`);
      else if (!flat(p.abstract ?? "").includes(flat(c.sentence))) row.problems.push(`citation ${c.n}: the sentence is not in the abstract`);
      if (p?.retracted) row.problems.push(`citation ${c.n} points at a retracted paper`);
    }
    const cited = new Set(answer.citations.map((c) => c.n));
    for (const m of answer.text.matchAll(/\[(\d{1,2})\]/g)) if (!cited.has(Number(m[1]))) row.problems.push(`mark [${m[1]}] is not a checked citation`);
    const left = /.{0,30}(?:\bS\d{1,3}\b|【|】|\(\s*\d{1,2}\s*\)).{0,15}/.exec(answer.text);
    if (left) row.problems.push(`a label or token is left in the words: …${left[0]}…`);
    row.marks = answer.citations.length;
    row.words = answer.text.split(/\s+/).length;
  }
  results.push(row);
  console.log(`${row.answered ? "answered" : "no answer"} (${row.reason}) ${String(row.ms).padStart(6)} ms  ${row.papers}/${row.withAbstract} papers  ${row.marks ?? 0} marks  ${group}: ${message}${row.problems.length ? `\n      PROBLEMS: ${row.problems.join("; ")}` : ""}`);
}

for (const q of ON_TOPIC) await ask(q, "topic");
for (const q of CONTROLS) await ask(q, "control");
for (const q of LANGUAGES) await ask(q, "language");
idp.close();

const topic = results.filter((r) => r.group === "topic");
const controls = results.filter((r) => r.group === "control");
const answered = topic.filter((r) => r.answered).length;
const answerable = topic.filter((r) => r.withAbstract >= 2).length;
const problems = results.flatMap((r) => r.problems);
const ms = topic.map((r) => r.ms).sort((a, b) => a - b);
const lines = [
  ["answered", `${answered} of ${answerable} questions that found at least two abstracts`, answerable === 0 || answered / answerable >= 0.75],
  ["real, not retracted, clean marks", `${problems.length} problems in ${results.filter((r) => r.answered).length} answers`, problems.length === 0],
  ["controls", `${controls.filter((r) => r.answered).length} of ${controls.length} nonsense questions got an answer (must be 0)`, controls.every((r) => !r.answered)],
];
console.log("\n--- chat eval");
for (const [name, what, pass] of lines) console.log(`${pass ? "PASS" : "FAIL"}  ${name}: ${what}`);
console.log(`info  median reply ${ms[Math.floor(ms.length / 2)] ?? 0} ms; languages (not gated): ${results.filter((r) => r.group === "language").map((r) => `${r.answered ? "answered" : r.reason}`).join(", ")}`);
if (gate && lines.some(([, , pass]) => !pass)) process.exit(1);
