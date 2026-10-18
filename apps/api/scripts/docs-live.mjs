// Real-model check of upload -> index -> ask (Workers AI embeddings + gpt-oss-120b). Needs a Worker started WITHOUT QA_STUB and
// with a Workers AI login (the AI binding is remote even in dev):
//   npx wrangler dev --port 8788 --var GOOGLE_CLIENT_ID:dev --var GOOGLE_CLIENT_SECRET:dev-secret --var DEV_IDP_URL:http://localhost:9911
//   node scripts/docs-live.mjs [path/to/paper.pdf] [extracted.txt]
// With no arguments it uses the built-in sample paper. With a real PDF and its text (pdftotext output, pages split by
// "[[page N]]" as in scripts/r2/) it also prints timing so retrieval + answer quality can be judged by eye.
import { readFileSync } from "node:fs";
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";
import { SAMPLE_PAPER, makePdf } from "./lib/make-pdf.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
const [pdfPath, txtPath] = process.argv.slice(2);

let pdf, pageTexts, questions;
if (pdfPath && txtPath) {
  pdf = readFileSync(pdfPath);
  pageTexts = readFileSync(txtPath, "utf8").split(/\[\[page \d+\]\]/).map((t) => t.trim()).filter(Boolean);
  questions = (process.env.QUESTIONS ?? "What is the main contribution of this paper?|What data or participants were used?|What are the limitations?|Who funded this work?").split("|");
} else {
  pdf = makePdf(SAMPLE_PAPER);
  pageTexts = SAMPLE_PAPER;
  questions = ["How were participants recruited?", "What AUC did the model reach?", "What are the limitations?", "Who funded this study?", "ये अध्ययन किस बारे में है?"];
}

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "live-1", email: "live@example.com", email_verified: true, name: "Live Tester" });
const c = createClient(APP);
await c.follow(`${APP}/api/v1/auth/google/start`);

const up = await c.send(`${APP}/api/v1/documents`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/pdf", "X-Filename": "live.pdf" }, body: pdf });
const doc = (await up.json()).document;
console.log("uploaded", doc.id, doc.sizeBytes, "bytes");

let t0 = Date.now();
for (let i = 0; i < pageTexts.length; i += 10) {
  const r = await c.api(`/api/v1/documents/${doc.id}/pages`, { method: "POST", body: { pages: pageTexts.slice(i, i + 10).map((text, k) => ({ page: i + k + 1, text })) } });
  console.log(`pages ${i + 1}-${Math.min(i + 10, pageTexts.length)}:`, r.status, JSON.stringify(await r.json()));
}
const fin = await (await c.api(`/api/v1/documents/${doc.id}/finish`, { method: "POST", body: { pages: pageTexts.length } })).json();
console.log(`indexed in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, fin.document.status, fin.document.chunkCount, "chunks");

for (const q of questions) {
  t0 = Date.now();
  const res = await c.api(`/api/v1/documents/${doc.id}/ask`, { method: "POST", body: { question: q } });
  const j = await res.json();
  console.log(`\nQ: ${q}  (${res.status}, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  if (!res.ok) { console.log("   ", JSON.stringify(j)); continue; }
  const a = j.answer;
  console.log(`   found=${a.found} verified=${a.verified} model=${a.model}`);
  console.log(`   ${a.answer}`);
  for (const ci of a.citations) console.log(`   [${ci.n}] p.${ci.page}: "${ci.quote.slice(0, 120)}"`);
}
await c.api("/api/v1/account", { method: "DELETE", body: { confirm: "DELETE" } });
await idp.close?.();
process.exit(0);
