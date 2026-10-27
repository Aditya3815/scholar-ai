// Quality check of "ask any open-access paper" (W4) with the REAL sources, the REAL embeddings and the REAL model, through POST /api/v1/papers/oa/ask.
//
//   npx wrangler dev --port 8788 --var GOOGLE_CLIENT_ID:dev --var GOOGLE_CLIENT_SECRET:dev-secret --var DEV_IDP_URL:http://localhost:9911 --var ENABLE_DEV_ROUTES:1
//   node scripts/oa-eval.mjs [--gate] [--only=<part of a paper's name>]
//
// A small list of real open-access papers (Europe PMC XML, arXiv PDFs, a closed paper that must fall back to its abstract), each with questions whose answers are known facts,
// some in Hinglish and Hindi, and a control question the paper does not answer. It measures properties, not exact words:
//   readable   how many of the papers that should be readable were read in full (a paper that the publisher blocks counts against it: that is the number that matters)
//   answered   questions about a paper read in full that got a verified answer (every quote found in the text by the server's own check)
//   correct    of those, answers whose words or quotes contain the known fact
//   controls   a question the paper does not answer gets "not in this paper", not an invention
//   scripts    a Hinglish answer is in Roman letters, a Hindi answer mostly in Devanagari
//   closed     a paper that cannot be read is answered from its abstract, with the reason, not refused
//   APP=https://scholar-staging.shodhsetu.workers.dev SESSIONS=<file from scripts/staging-session.mjs> node scripts/oa-eval.mjs   (the same check against a deployed Worker)
// With --gate it exits with 1 when a line is below its limit. Each paper uses its own throwaway account (the daily allowance is counted per account, and an account is found by its e-mail).
import { readFileSync } from "node:fs";
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
const gate = process.argv.includes("--gate");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
const LIMITS = { readable: 0.8, answered: 0.75, correct: 0.7, controls: 0.8, slice: 0.7, script: 0.9 };

/** kind: "full" the paper must be read in full; "closed" it cannot be and must fall back to the abstract. */
const PAPERS = [
  {
    name: "Ioannidis, Why most published research findings are false (PMC XML)", ref: { doi: "10.1371/journal.pmed.0020124" }, kind: "full",
    qs: [
      { q: "What does the probability that a research finding is true depend on?", lang: "en", expect: /power|bias|pre-?study|ratio|number of other studies/i },
      { q: "Is paper ke hisaab se kisi research finding ke sach hone ki probability kin cheezon par depend karti hai?", lang: "hinglish", expect: /power|bias|pre-?study|ratio|number of other studies|study|findings?/i },
      { q: "इस शोध पत्र के अनुसार किसी निष्कर्ष के सच होने की संभावना किन बातों पर निर्भर करती है?", lang: "hi" },
      { q: "Which hospital collected the patient data used in this paper?", lang: "en", control: true },
    ],
  },
  {
    name: "PRISMA statement (PMC XML)", ref: { doi: "10.1371/journal.pmed.1000097" }, kind: "full",
    qs: [{ q: "How many items does the PRISMA checklist have?", lang: "en", expect: /27|twenty-seven/i }],
  },
  {
    name: "WGCNA (PMC XML)", ref: { doi: "10.1186/1471-2105-9-559" }, kind: "full",
    qs: [{ q: "What is WGCNA used for?", lang: "en", expect: /network|correlation|module|gene/i }],
  },
  {
    name: "Deep learning in ophthalmology review (PMC XML)", ref: { doi: "10.1136/bjophthalmol-2018-313173" }, kind: "full",
    qs: [{ q: "Which eye diseases does the review discuss deep learning for?", lang: "en", expect: /diabetic retinopathy/i }],
  },
  {
    name: "Attention Is All You Need (arXiv PDF)", ref: { arxivId: "1706.03762" }, kind: "full",
    qs: [
      { q: "How many attention heads does the base model use?", lang: "en", expect: /\b8\b|eight/i },
      { q: "Base model me kitne attention heads use hue hain?", lang: "hinglish", expect: /\b8\b|eight|aath/i },
      { q: "Which dataset of chest X-rays was the model trained on?", lang: "en", control: true },
    ],
  },
  {
    name: "BERT (arXiv PDF)", ref: { arxivId: "1810.04805" }, kind: "full",
    qs: [{ q: "What are the two pre-training tasks of BERT?", lang: "en", expect: /masked/i }],
  },
  {
    name: "GPT-3, 75 pages (arXiv PDF)", ref: { arxivId: "2005.14165" }, kind: "full",
    qs: [{ q: "How many parameters does the largest GPT-3 model have?", lang: "en", expect: /175/ }],
  },
  {
    name: "LeCun et al., Deep learning, Nature (not open access: abstract only)", ref: { doi: "10.1038/nature14539" }, kind: "closed",
    qs: [{ q: "What does deep learning allow computational models to do?", lang: "en", expect: /levels? of abstraction|representations?/i }],
  },
];

// Against a deployed Worker (staging) there is no fake identity provider: SESSIONS is a file of session cookies made by scripts/staging-session.mjs, one account per paper.
const SESSIONS = process.env.SESSIONS ? JSON.parse(readFileSync(process.env.SESSIONS, "utf8")) : null;
const idp = SESSIONS ? { close() {} } : await startFakeIdp(9911);
const run = Date.now();
let n = 0;
async function client() {
  if (SESSIONS) {
    const cookie = SESSIONS[n++];
    if (!cookie) throw new Error("SESSIONS has fewer accounts than there are papers");
    const c = createClient(APP);
    const [k, ...v] = cookie.split("=");
    c.jar.set(k, v.join("="));
    return c;
  }
  idp.setUser({ sub: `oa-eval-${run}-${n}`, email: `oaeval${run}x${n++}@example.edu`, email_verified: true, name: "OA Eval" });
  const c = createClient(APP);
  await c.follow(`${APP}/api/v1/auth/google/start`);
  await c.ack();
  return c;
}

async function ask(c, ref, question) {
  const t0 = Date.now();
  const res = await c.send(`${APP}/api/v1/papers/oa/ask`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ ...ref, question }) });
  const events = [];
  if (res.ok) {
    const dec = new TextDecoder();
    let buf = "";
    try {
      for await (const part of res.body) {
        buf += dec.decode(part, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const data = buf.slice(0, i).split("\n").find((l) => l.startsWith("data:"));
          buf = buf.slice(i + 2);
          if (data) events.push(JSON.parse(data.slice(5)));
        }
      }
    } catch (e) {
      // a stream cut by the network is a result of the check (the question was not answered), not a reason to stop it
      events.push({ type: "error", code: "stream_cut", message: String(e?.cause?.code ?? e?.message ?? e) });
    }
  }
  return { status: res.status, events, ms: Date.now() - t0 };
}

const share = (s, re) => {
  const letters = s.match(/\p{L}/gu) ?? [];
  return letters.length ? letters.filter((c) => re.test(c)).length / letters.length : 0;
};
const rows = [];
const papers = [];
for (const p of PAPERS) {
  if (only && !p.name.toLowerCase().includes(only.toLowerCase())) continue;
  const c = await client();
  const outs = [];
  for (const q of p.qs) {
    const r = await ask(c, p.ref, q.q);
    const paper = r.events.find((e) => e.type === "paper");
    const last = r.events.at(-1);
    const answer = last?.type === "answer" ? last.answer : null;
    const ingests = r.events.filter((e) => e.type === "ingest");
    const text = answer ? `${answer.answer} ${answer.citations.map((x) => x.quote).join(" ")}` : "";
    outs.push({ q, source: paper?.source ?? null, reason: paper?.reason ?? null, answer, error: last?.type === "error" ? last : null, text, ms: r.ms, waited: ingests.some((e) => e.started === true) });
    rows.push({ paper: p.name, kind: p.kind, ...q, source: paper?.source ?? null, found: answer?.found ?? null, verified: answer?.verified ?? null, text, answer: answer?.answer ?? "", error: last?.type === "error" ? last.code : null, ms: r.ms });
  }
  const first = outs[0];
  papers.push({ name: p.name, kind: p.kind, source: first.source, reason: first.reason, firstMs: first.ms });
  console.log(`${p.kind === "full" ? (first.source && first.source !== "abstract" ? "read " : "NOT READ") : first.source === "abstract" ? "closed" : "closed?"}  ${first.source ?? first.error?.code ?? "?"}${first.reason ? " (" + first.reason + ")" : ""}  first answer in ${(first.ms / 1000).toFixed(1)} s  ${p.name}`);
}
idp.close();

const pct = (a, b) => (b === 0 ? 1 : a / b);
const fmt = (x) => `${(x * 100).toFixed(0)}%`;
const lines = [];
const check = (name, num, den, limit) => lines.push({ name, value: pct(num, den), limit, num, den, pass: pct(num, den) >= limit });

const shouldRead = papers.filter((p) => p.kind === "full");
check("readable", shouldRead.filter((p) => p.source && p.source !== "abstract").length, shouldRead.length, LIMITS.readable);
const full = rows.filter((r) => r.kind === "full" && r.source && r.source !== "abstract" && !r.control);
check("answered", full.filter((r) => r.found && r.verified).length, full.length, LIMITS.answered);
const gotOne = full.filter((r) => r.found && r.verified && r.expect);
check("correct", gotOne.filter((r) => r.expect.test(r.text)).length, gotOne.length, LIMITS.correct);
const controls = rows.filter((r) => r.control && r.source && r.source !== "abstract");
check("controls", controls.filter((r) => r.found === false).length, controls.length, LIMITS.controls);
for (const lang of ["hinglish", "hi"]) {
  const s = full.filter((r) => r.lang === lang);
  check(`${lang} answered`, s.filter((r) => r.found && r.verified).length, s.length, LIMITS.slice);
  const a = s.filter((r) => r.found && r.answer);
  check(`${lang} script`, a.filter((r) => (lang === "hi" ? share(r.answer, /[ऀ-ॿ]/) >= 0.3 : share(r.answer, /[A-Za-z]/) >= 0.9)).length, a.length, LIMITS.script);
}
const closed = rows.filter((r) => r.kind === "closed");
check("closed", closed.filter((r) => r.source === "abstract" && r.found !== null).length, closed.length, 1);

console.log("\n--- open-access eval");
for (const l of lines) console.log(`${l.pass ? "PASS" : "FAIL"}  ${l.name.padEnd(18)} ${fmt(l.value).padStart(5)}  (${l.num} of ${l.den}, limit ${fmt(l.limit)})`);
console.log(`info  median first answer ${Math.round(([...papers].map((p) => p.firstMs).sort((a, b) => a - b)[Math.floor(papers.length / 2)] ?? 0) / 1000)} s; sources: ${["europepmc", "arxiv", "pdf", "abstract"].map((s) => `${s} ${papers.filter((p) => p.source === s).length}`).join(", ")}`);
console.log("\nper question:");
for (const r of rows) console.log(`  ${r.found === null ? "ERR " : r.control ? (r.found === false ? "ok   " : "WRONG") : r.found && r.verified && (!r.expect || r.expect.test(r.text)) ? "ok   " : "MISS "} [${r.lang}] ${r.source ?? "-"}${r.error ? " error:" + r.error : ""}${r.found !== null ? ` found=${r.found} verified=${r.verified}` : ""} ${(r.ms / 1000).toFixed(1)}s  ${r.q.slice(0, 70)}  ->  ${r.answer.replace(/\s+/g, " ").slice(0, 90)}`);
if (gate && lines.some((l) => !l.pass)) process.exit(1);
