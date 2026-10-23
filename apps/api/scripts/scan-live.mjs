// Reads real scanned pages with the REAL models through the real route (POST /documents/:id/ocr): the two Workers AI vision models, the gate, the
// stored passages, a question. Costs neurons (about 200 per page). Needs a Worker started WITHOUT QA_STUB and with a Workers AI login:
//   npx wrangler dev --port 8788 --var GOOGLE_CLIENT_ID:dev --var GOOGLE_CLIENT_SECRET:dev-secret --var DEV_IDP_URL:http://localhost:9911 --var ENABLE_DEV_ROUTES:1 --var SENTRY_DSN:
//   node scripts/scan-live.mjs <folder with page JPEGs (<= 1240 x 1754)> [--dump <folder>] [--ask "question" ...]
// Page pictures are never committed: keep them in a folder outside the repository (or a git-ignored one).
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";
import { makeScanPdf } from "./lib/make-scan-pdf.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
const args = process.argv.slice(2);
const folder = args[0] && !args[0].startsWith("--") ? args[0] : null;
const dump = args.includes("--dump") ? args[args.indexOf("--dump") + 1] : null;
const questions = args.includes("--ask") ? args.slice(args.indexOf("--ask") + 1).filter((a) => !a.startsWith("--")) : [];
if (!folder) throw new Error("usage: node scripts/scan-live.mjs <folder with page JPEGs> [--dump <folder>] [--ask \"question\" ...]");
const files = readdirSync(folder).filter((f) => /\.jpe?g$/i.test(f)).sort();
if (files.length === 0) throw new Error("no .jpg files in " + folder);
if (dump) mkdirSync(dump, { recursive: true });

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "scan-live", email: "scanlive@example.com", email_verified: true, name: "Scan Live" });
const c = createClient(APP);
await c.follow(`${APP}/api/v1/auth/google/start`);
await c.ack();

const pictures = files.map((f) => readFileSync(join(folder, f)));
const up = await c.send(`${APP}/api/v1/documents`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/pdf", "X-Filename": "scan-live.pdf" }, body: makeScanPdf(pictures) });
const upJson = await up.json();
if (!up.ok) throw new Error(`upload failed: ${up.status} ${JSON.stringify(upJson)}`);
const doc = upJson.document;
console.log(`uploaded ${files.length} pages as ${doc.id}`);
const reg = await (await c.api(`/api/v1/documents/${doc.id}/scan`, { method: "POST", body: { pages: files.length, scanPages: files.map((_, i) => i + 1) } })).json();
console.log(`registered: ${reg.scan.pending.length} to read, limit ${reg.scan.perDay} a day, used today ${reg.scan.usedToday}\n`);

let spent = 0;
for (const [i, f] of files.entries()) {
  const t0 = Date.now();
  const res = await c.send(`${APP}/api/v1/documents/${doc.id}/ocr?page=${i + 1}`, { method: "POST", headers: { Origin: APP, "Content-Type": "image/jpeg" }, body: pictures[i] });
  const j = await res.json();
  if (!res.ok) {
    console.log(`${f.padEnd(34)} HTTP ${res.status} ${j.type} ${j.detail ?? j.title}`);
    continue;
  }
  const r = j.result;
  console.log(`${f.padEnd(34)} ${r.status.padEnd(10)} ${r.why ?? "".padEnd(0)}${r.why ? " " : ""}differ ${r.disagreement === null ? "-" : (r.disagreement * 100).toFixed(1) + "%"}  ${r.chunks} passages  ${r.text.length} chars  ${((Date.now() - t0) / 1000).toFixed(1)} s${r.disputed.length ? "  numbers: " + r.disputed.join(" / ") : ""}`);
  if (dump && r.text) writeFileSync(join(dump, f.replace(/\.[^.]+$/, ".txt")), r.text);
  spent++;
}
const info = await (await c.api(`/api/v1/documents/${doc.id}`)).json();
console.log(`\npaper: ${info.document.status}${info.document.error ? " (" + info.document.error + ")" : ""}, ${info.document.chunkCount} passages; read ${info.scan.read}, with doubt ${info.scan.warned}, not reliable ${info.scan.unreliable}, empty ${info.scan.empty}; used today ${info.scan.usedToday} of ${info.scan.perDay}`);
for (const q of info.document.status === "ready" ? questions : []) {
  const t0 = Date.now();
  const a = (await (await c.api(`/api/v1/documents/${doc.id}/ask`, { method: "POST", body: { question: q } })).json()).answer;
  console.log(`\nQ: ${q}  (${((Date.now() - t0) / 1000).toFixed(1)} s)\nA: ${a?.answer ?? "(no answer)"}\n   found=${a?.found} verified=${a?.verified} pages=${a?.citations?.map((x) => x.page).join(",")}`);
}
await c.api("/api/v1/account", { method: "DELETE", body: { confirm: "DELETE" } });
idp.close?.();
process.exit(0);
