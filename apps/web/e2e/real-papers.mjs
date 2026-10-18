// Upload a folder of REAL PDFs through the real browser pipeline (pdf.js in Edge/Chrome, the Worker, live Crossref/OpenAlex) and
// print what was found for each: title, DOI, contents, references, registry metadata. For checking extraction quality on papers
// that are not in the repo.
//   REAL_PDFS="C:/path/to/pdfs" npm run integration -w apps/api -- --browser --only="browser: real"   (see scripts/integration.mjs)
//   or against a running Worker with the fake identity provider:  node e2e/real-papers.mjs <folder> [baseUrl]
import { chromium } from "playwright-core";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startFakeIdp } from "../../api/scripts/fake-idp.mjs";

const dir = process.argv[2] ?? process.env.REAL_PDFS;
const BASE = process.argv.find((a, i) => i >= 3 && a.startsWith("http")) ?? "http://localhost:8788";
// --verify also runs every extracted reference through the live Reference Verifier and prints how they came out.
const VERIFY = process.argv.includes("--verify");
const totals = {};
// REAL_DUMP=<file.json> keeps every reference that did not verify, with the verdict and reason, to see what is being missed.
const unresolved = [];
if (!dir) throw new Error("usage: node e2e/real-papers.mjs <folder with .pdf files> [baseUrl]");

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "real-pdfs", email: "real@example.edu", email_verified: true, name: "Real PDFs" });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();

await page.goto(BASE + "/papers", { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Continue with Google" }).click();
await page.getByRole("button", { name: /^Account:/ }).waitFor({ timeout: 15000 });

const rows = [];
for (const f of readdirSync(dir).filter((x) => x.toLowerCase().endsWith(".pdf")).sort()) {
  const t0 = Date.now();
  const before = (await (await page.request.get(BASE + "/api/v1/documents")).json()).items.length;
  await page.locator('input[type="file"]').setInputFiles({ name: f, mimeType: "application/pdf", buffer: readFileSync(join(dir, f)) });
  let doc;
  for (let i = 0; i < 240 && !doc; i++) {
    await page.waitForTimeout(500);
    const items = (await (await page.request.get(BASE + "/api/v1/documents")).json()).items;
    if (items.length > before && items[0].status !== "uploaded" && items[0].status !== "indexing") doc = items[0];
  }
  if (!doc) { rows.push({ file: f, error: "did not finish" }); continue; }
  // The paper is ready as soon as it is indexed; what we learned about it (and the registry lookups) is saved a little later.
  let j = await (await page.request.get(BASE + "/api/v1/documents/" + doc.id)).json();
  for (let i = 0; i < 60 && !j.info; i++) {
    await page.waitForTimeout(500);
    j = await (await page.request.get(BASE + "/api/v1/documents/" + doc.id)).json();
  }
  doc = j.document;
  const info = j.info;
  let verified = null;
  if (VERIFY && info?.references?.length) {
    verified = {};
    const queue = [...info.references];
    // Same pace as the app (two at a time), and wait out a rate-limit answer instead of counting it as a failure.
    await Promise.all(Array.from({ length: 2 }, async () => {
      for (let r = queue.shift(); r !== undefined; r = queue.shift()) {
        let status = "error";
        let body = null;
        for (let attempt = 0; attempt < 4; attempt++) {
          const res = await page.request.post(BASE + "/api/v1/references/verify", { headers: { Origin: BASE, "Content-Type": "application/json" }, data: { reference: r } });
          if (res.status() === 429) { await page.waitForTimeout(Math.min(Number(res.headers()["retry-after"]) || 10, 30) * 1000); continue; }
          body = res.ok() ? await res.json() : null;
          status = body?.status ?? "error";
          break;
        }
        if (status !== "verified") unresolved.push({ file: f, status, reference: r, reason: body?.reason, match: body?.match ? `${body.match.title} (${body.match.year})` : null });
        verified[status] = (verified[status] ?? 0) + 1;
        totals[status] = (totals[status] ?? 0) + 1;
      }
    }));
  }
  rows.push({
    verified,
    file: f, seconds: ((Date.now() - t0) / 1000).toFixed(1), status: doc.status, pages: doc.pages, chunks: doc.chunkCount,
    title: info?.title, doi: info?.doi, arxiv: info?.arxiv, outline: info?.outline?.length, headings: info?.headings?.length,
    references: info?.references?.length, referencesSource: info?.referencesSource,
    metadata: info?.metadata ? `${info.metadata.source}: ${info.metadata.authors.slice(0, 2).join(", ")}${info.metadata.authors.length > 2 ? " et al." : ""} (${info.metadata.year ?? "?"}) ${info.metadata.venue ?? ""}` : null,
    savedTitle: doc.title,
  });
  console.log(JSON.stringify(rows.at(-1)));
}
await page.request.delete(BASE + "/api/v1/account", { headers: { Origin: BASE, "Content-Type": "application/json" }, data: { confirm: "DELETE" } }).catch(() => {});
await browser.close();
if (process.env.REAL_DUMP) writeFileSync(process.env.REAL_DUMP, JSON.stringify(unresolved, null, 1));
if (VERIFY) console.log("\nVERIFIER on all extracted references:", JSON.stringify(totals), `verified ${Math.round(((totals.verified ?? 0) / Math.max(1, Object.values(totals).reduce((a, b) => a + b, 0))) * 100)}%`);
console.log("\n" + rows.map((r) => `${r.file.padEnd(16)} ${r.status ?? ""} ${String(r.pages ?? "").padStart(3)}p  title: ${(r.savedTitle ?? "").slice(0, 60).padEnd(60)} refs ${String(r.references ?? "").padStart(3)} (${r.referencesSource})  contents ${r.outline ?? 0}/${r.headings ?? 0}  doi ${r.doi ?? r.arxiv ?? "-"}  ${r.metadata ?? ""}`).join("\n"));
process.exit(0);
