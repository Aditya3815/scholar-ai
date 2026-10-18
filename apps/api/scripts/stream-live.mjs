// Streaming answers with the REAL models: shows when each stage arrives and how the answer text is written.
//   npx wrangler dev --port 8788 --var GOOGLE_CLIENT_ID:dev --var GOOGLE_CLIENT_SECRET:dev-secret --var DEV_IDP_URL:http://localhost:9911
//   node scripts/stream-live.mjs ["a question"]
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";
import { SAMPLE_PAPER, makePdf } from "./lib/make-pdf.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
const questions = process.argv.slice(2).length ? process.argv.slice(2) : ["How were participants recruited?", "What are the limitations?"];
const idp = await startFakeIdp(9911);
idp.setUser({ sub: "stream-live", email: "stream@example.com", email_verified: true, name: "Stream Tester" });
const c = createClient(APP);
await c.follow(`${APP}/api/v1/auth/google/start`);
const doc = (await (await c.send(`${APP}/api/v1/documents`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/pdf", "X-Filename": "s.pdf" }, body: makePdf(SAMPLE_PAPER) })).json()).document;
await c.api(`/api/v1/documents/${doc.id}/pages`, { method: "POST", body: { pages: SAMPLE_PAPER.map((text, i) => ({ page: i + 1, text })) } });
await c.api(`/api/v1/documents/${doc.id}/finish`, { method: "POST", body: { pages: SAMPLE_PAPER.length } });

for (const q of questions) {
  const t0 = Date.now();
  const res = await c.send(`${APP}/api/v1/documents/${doc.id}/ask?stream=1`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/json" }, body: JSON.stringify({ question: q }) });
  console.log(`\nQ: ${q}  (${res.status})`);
  const dec = new TextDecoder();
  let buf = "", deltas = 0, text = "";
  for await (const part of res.body) {
    buf += dec.decode(part, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = block.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const e = JSON.parse(line.slice(5));
      const t = ((Date.now() - t0) / 1000).toFixed(2).padStart(5);
      if (e.type === "delta") { deltas++; text += e.text; if (deltas === 1) console.log(`  ${t}s first words: "${e.text.slice(0, 40)}"`); }
      else if (e.type === "stage") console.log(`  ${t}s stage: ${e.stage}`);
      else if (e.type === "sources") console.log(`  ${t}s sources: pages ${e.pages.join(", ")}`);
      else if (e.type === "answer") console.log(`  ${t}s ANSWER found=${e.answer.found} verified=${e.answer.verified} citations=${e.answer.citations.length}: ${e.answer.answer}`);
      else if (e.type === "error") console.log(`  ${t}s ERROR ${e.code}: ${e.title} ${e.detail ?? ""}`);
    }
  }
  console.log(`  (${deltas} text pieces, streamed text ${text.length} chars)`);
}
await c.api("/api/v1/account", { method: "DELETE", body: { confirm: "DELETE" } });
process.exit(0);
