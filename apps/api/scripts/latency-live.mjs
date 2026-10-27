// P7: how long until the first words of an answer, measured on the DEPLOYED STAGING Worker with the real model (docs/design/p7-latency.md). Staging only.
//   node scripts/staging-session.mjs make 3 <file>      (erase afterwards: node scripts/staging-session.mjs cleanup)
//   APP=https://scholar-staging.shodhsetu.workers.dev SESSIONS=<file> node scripts/latency-live.mjs <folder with PDFs> [--chat] [--docs]
// A question about a paper of your own (POST /documents/:id/ask?stream=1) and a question in the prompt box (POST /chat) are asked several times each; for every answer the time of each
// event is kept: the first event, the passages (`sources`), the first word of the answer (`delta` / `token`), the checked answer. Prints the median and the slowest.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getDocumentProxy, extractText } from "unpdf";
import { createClient } from "./test-client.mjs";

const APP = process.env.APP;
if (!APP || !/staging/.test(APP) || !process.env.SESSIONS) throw new Error("set APP to the staging address and SESSIONS to a file made by staging-session.mjs: this runs against staging only");
const SESSIONS = JSON.parse(readFileSync(process.env.SESSIONS, "utf8"));
const dir = process.argv[2];
const wantChat = process.argv.includes("--chat");
const wantDocs = process.argv.includes("--docs") || !wantChat;
const clientFor = (i) => {
  const c = createClient(APP);
  const [k, ...v] = SESSIONS[i % SESSIONS.length].split("=");
  c.jar.set(k, v.join("="));
  return c;
};

async function readEvents(res, t0, kinds) {
  const at = {};
  const dec = new TextDecoder();
  let buf = "";
  for await (const part of res.body) {
    buf += dec.decode(part, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const data = buf.slice(0, i).split("\n").find((l) => l.startsWith("data:"));
      buf = buf.slice(i + 2);
      if (!data) continue;
      const e = JSON.parse(data.slice(5));
      const t = Date.now() - t0;
      at.first ??= t;
      const key = kinds(e);
      if (key) at[key] ??= t;
    }
  }
  at.end = Date.now() - t0;
  return at;
}

const DOC_QUESTIONS = ["What is the main contribution of this paper?", "What data or experiments does the paper use?", "What are the main limitations the authors mention?", "Summarise the method in two sentences.", "What results do the authors report?"];
const CHAT_QUERIES = ["How effective is the BCG vaccine against adult tuberculosis?", "What are the effects of intermittent fasting on weight loss?", "How accurate is deep learning for diabetic retinopathy screening?", "Does mindfulness reduce anxiety in students?", "What causes antibiotic resistance in hospitals?"];

const rows = { doc: [], chat: [] };

if (wantDocs) {
  if (!dir) throw new Error("give the folder with PDFs");
  const pdfs = readdirSync(dir).filter((f) => /\.pdf$/i.test(f)).slice(0, 3);
  for (const [n, file] of pdfs.entries()) {
    const c = clientFor(n);
    const pdf = readFileSync(join(dir, file));
    const doc = await getDocumentProxy(new Uint8Array(pdf));
    const { text } = await extractText(doc, { mergePages: false });
    const pages = text.map((t) => t.trim()).filter(Boolean).slice(0, 60);
    const up = await c.send(`${APP}/api/v1/documents`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/pdf", "X-Filename": file }, body: pdf });
    if (!up.ok) { console.log(`upload ${file}: HTTP ${up.status} ${(await up.text()).slice(0, 200)}`); continue; }
    const id = (await up.json()).document.id;
    for (let i = 0; i < pages.length; i += 10) {
      const r = await c.api(`/api/v1/documents/${id}/pages`, { method: "POST", body: { pages: pages.slice(i, i + 10).map((t, k) => ({ page: i + k + 1, text: t })) } });
      if (!r.ok) throw new Error(`indexing failed ${r.status}`);
    }
    await c.api(`/api/v1/documents/${id}/finish`, { method: "POST", body: { pages: pages.length } });
    console.log(`${file}: ${pages.length} pages indexed`);
    for (const q of DOC_QUESTIONS.slice(0, 4)) {
      const t0 = Date.now();
      const res = await c.send(`${APP}/api/v1/documents/${id}/ask?stream=1`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ question: q }) });
      if (!res.ok) { console.log(`  ask failed ${res.status}`); continue; }
      const at = await readEvents(res, t0, (e) => (e.type === "sources" ? "sources" : e.type === "stage" && e.stage === "thinking" ? "thinking" : e.type === "delta" ? "firstWord" : e.type === "answer" ? "answer" : null));
      rows.doc.push(at);
      console.log(`  ${file.slice(0, 14).padEnd(14)} sources ${at.sources ?? "-"} ms, first word ${at.firstWord ?? "-"} ms, answer ${at.answer ?? "-"} ms | ${q.slice(0, 40)}`);
    }
  }
}

if (wantChat) {
  const c = clientFor(0);
  for (const q of CHAT_QUERIES) {
    const t0 = Date.now();
    const res = await c.send(`${APP}/api/v1/chat`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ mode: "search", message: q }) });
    const at = await readEvents(res, t0, (e) => (e.type === "papers" && e.final ? "papers" : e.type === "token" ? "firstWord" : e.type === "answer" ? "answer" : null));
    rows.chat.push(at);
    console.log(`  chat papers ${at.papers ?? "-"} ms, first word ${at.firstWord ?? "-"} ms, answer ${at.answer ?? "-"} ms | ${q.slice(0, 40)}`);
  }
}

const med = (xs) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
for (const [name, list] of Object.entries(rows)) {
  if (list.length === 0) continue;
  const f = (k) => list.map((r) => r[k]).filter((x) => typeof x === "number");
  console.log(`\n${name}: ${list.length} questions. median / slowest (ms): sources ${med(f("sources"))} / ${Math.max(0, ...f("sources"))}; first word ${med(f("firstWord"))} / ${Math.max(0, ...f("firstWord"))}; answer ${med(f("answer"))} / ${Math.max(0, ...f("answer"))}`);
}
