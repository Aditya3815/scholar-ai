// Browser e2e for "download a copy with my marks" (My Workspace): highlights, highlighter and pen drawn into a copy of the paper.
// What it proves: the copy is a valid PDF with one more page (the notes), the original in storage is byte for byte the same, and on pages that are
// turned (/Rotate 90) or cropped (CropBox with an offset) the marks land where they were on screen. The last one is checked by reading pixels:
// the copy is uploaded as a paper, shown by pdf.js, and the colour is read from the canvas where each stroke should be.
//   node e2e/annotated.mjs [baseUrl]    (default http://localhost:8788; `npm run integration -w apps/api -- --browser` starts the Worker)
import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { startFakeIdp } from "../../api/scripts/fake-idp.mjs";
import { SAMPLE_PAPER, makePdf } from "../../api/scripts/lib/make-pdf.mjs";
import { PDFDocument, degrees } from "@cantoo/pdf-lib";

const BASE = process.argv[2] ?? "http://localhost:8788";
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };
const sha = (b) => createHash("sha256").update(b).digest("hex");

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "ws-annot-1", email: "ravi.k@example.edu", email_verified: true, name: "Ravi K" });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
const errors = [];
const failedCalls = [];

/** a three page paper: page 2 turned a quarter round, page 3 cropped with the corner not at (0, 0) */
async function makePaper() {
  const doc = await PDFDocument.load(makePdf([...SAMPLE_PAPER], { title: "Marked copy" }));
  doc.getPage(1).setRotation(degrees(90));
  doc.getPage(2).setCropBox(20, 30, 535, 760);
  return Buffer.from(await doc.save());
}

// the pen strokes: a straight line (many points) at a given height, fractions of the page width as the reader sees the page
const line = (id, page, color, x0, x1, y, tool = "pen", w = 0.006) => ({ id, page, tool, color, w, pts: Array.from({ length: 24 }, (_, i) => [x0 + ((x1 - x0) * i) / 23, y, 0.5]).flat() });
const STROKES = [
  line("s1", 1, "blue", 0.25, 0.65, 0.3),
  line("s2", 2, "red", 0.3, 0.7, 0.2),
  line("s3", 3, "green", 0.3, 0.6, 0.45),
  line("s4", 1, "yellow", 0.25, 0.65, 0.55, "highlighter", 0.03),
  // shapes, a text box and a sticky note: a red rectangle on page 1, a blue arrow on the turned page, a text box on the cropped page, a yellow sticky note on page 1
  { id: "r1", page: 1, tool: "shape", kind: "rect", color: "red", w: 0.006, pts: [0.2, 0.62, 0.5, 0.5, 0.74, 0.5] },
  { id: "a1", page: 2, tool: "shape", kind: "arrow", color: "blue", w: 0.006, pts: [0.3, 0.4, 0.5, 0.7, 0.4, 0.5] },
  { id: "t1", page: 3, tool: "text", color: "ink", x: 0.2, y: 0.6, w: 0.4, h: 0.05, size: 0.027, text: "Check this table" },
  { id: "n1", page: 1, tool: "sticky", color: "yellow", x: 0.7, y: 0.35, text: "ask the supervisor" },
];
const HEX = { blue: [43, 76, 207], red: [209, 52, 43], green: [31, 138, 82], yellow: [255, 216, 77] };

try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401|403|404|409)/.test(m.text())) errors.push("console: " + m.text()); });
  page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/api/")) failedCalls.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });

  console.log("sign in and upload a turned, cropped paper");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
  await page.getByRole("button", { name: "Continue with Google" }).last().click();
  await page.locator("#hm-h").waitFor({ timeout: 20000 });
  await page.locator(".ws-rail").getByRole("link", { name: /My Workspace/ }).click();
  const note = page.getByRole("region", { name: /how your papers are handled/ });
  await note.waitFor();
  await note.getByRole("button", { name: "I understand, continue" }).click();
  await note.waitFor({ state: "detached", timeout: 8000 });
  const original = await makePaper();
  await page.locator('input[type="file"]').waitFor({ state: "attached" });
  await page.locator('input[type="file"]').setInputFiles({ name: "turned.pdf", mimeType: "application/pdf", buffer: original });
  await page.waitForFunction(() => document.querySelector(".dc")?.getAttribute("data-status") === "ready", null, { timeout: 60000 });
  const docs = (await (await page.request.get(BASE + "/api/v1/documents")).json()).items;
  const id = docs[0].id;
  const beforeBytes = Buffer.from(await (await page.request.get(`${BASE}/api/v1/documents/${id}/file`)).body());
  ok(sha(beforeBytes) === sha(original), "the paper is stored as it was uploaded");

  const H = { headers: { Origin: BASE } };
  const put = await page.request.put(`${BASE}/api/v1/documents/${id}/ink`, { ...H, data: { strokes: STROKES, rev: 0 } });
  ok(put.ok(), "(drawings saved with the paper: a pen on each of three pages, a highlighter, a rectangle and an arrow: six drawings; a text box and a sticky note: two written notes)");
  const q1 = "Glaucoma Screening with Deep Learning in Rural Clinics";
  const q3 = "Limitations include a single country and a small number of cases of angle closure";
  ok((await page.request.post(`${BASE}/api/v1/documents/${id}/notes`, { ...H, data: { page: 1, quote: q1, color: "yellow", note: "title of the paper" } })).ok()
    && (await page.request.post(`${BASE}/api/v1/documents/${id}/notes`, { ...H, data: { page: 3, quote: q3, color: "pink", note: "Ñandú — ok; मोतियाबिंद" } })).ok()
    && (await page.request.post(`${BASE}/api/v1/documents/${id}/notes`, { ...H, data: { page: 2, quote: "words that are not anywhere on this page at all", color: "blue" } })).ok(), "(three text highlights: one placeable on page 1, one on page 3, one that is not on its page; the notes have non-Western letters)");

  console.log("download the copy");
  await page.locator(".dc .dc-open").first().click();
  await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  const btn = page.getByRole("button", { name: "Download a copy with my marks" });
  ok(await btn.isVisible() && await btn.isEnabled(), "the reader has a button for it");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 30000 }), btn.click()]);
  const path = await dl.path();
  const copy = readFileSync(path);
  ok(/-marked\.pdf$/.test(dl.suggestedFilename()), `it is named after the paper (${dl.suggestedFilename()})`);
  ok(copy.subarray(0, 5).toString() === "%PDF-" && copy.length > beforeBytes.length, "it is a PDF, larger than the original");
  const copyDoc = await PDFDocument.load(copy);
  ok(copyDoc.getPageCount() === 4, "it has the three pages and one more, the notes");
  ok(copyDoc.getPage(1).getRotation().angle === 90 && copyDoc.getPage(2).getCropBox().x === 20, "the turned and the cropped page keep their turn and their crop");
  const notice = await page.locator("[role=status], .notice").allInnerTexts();
  ok(notice.some((t) => /Your copy is ready \(6 drawings?, 2 written notes and 2 highlights? marked, notes on the last page\)/.test(t) && /1 highlight could not be found on the page/.test(t) && /could not be shown on the notes page/.test(t)), `it says what was marked and what was not (${JSON.stringify(notice.filter((t) => /copy/.test(t)))})`);
  const afterBytes = Buffer.from(await (await page.request.get(`${BASE}/api/v1/documents/${id}/file`)).body());
  ok(sha(afterBytes) === sha(original), "the paper in storage is still byte for byte the original");

  console.log("the marks are where they were on screen (the copy is read back as a paper, pixels are checked)");
  await page.getByRole("button", { name: /My Workspace/ }).first().click();
  await page.locator('input[type="file"]').setInputFiles({ name: "marked.pdf", mimeType: "application/pdf", buffer: copy });
  await page.waitForFunction(() => document.querySelectorAll(".dc").length === 2 && [...document.querySelectorAll(".dc")].every((c) => c.getAttribute("data-status") === "ready"), null, { timeout: 60000 });
  const all = (await (await page.request.get(BASE + "/api/v1/documents")).json()).items;
  const copyId = all.find((d) => d.id !== id).id;
  await page.goto(`${BASE}/papers/${copyId}`, { waitUntil: "networkidle" });
  await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  // the colour at the middle of a stroke, taking the closest of the pixels around it (a line a few pixels thick)
  const probe = async (n, fx, fy, want) => {
    await page.evaluate((n) => { const el = document.querySelector(`[data-page="${n}"]`); el.scrollIntoView({ block: "center" }); }, n);
    await page.waitForFunction((n) => document.querySelector(`[data-page="${n}"] .pdfp-canvas[data-painted=true]`) !== null, n, { timeout: 15000 });
    await page.waitForTimeout(500);
    return page.evaluate(({ n, fx, fy, want }) => {
      const cv = document.querySelector(`[data-page="${n}"] .pdfp-canvas`);
      const ctx2 = cv.getContext("2d");
      const cx = Math.round(fx * cv.width), cy = Math.round(fy * cv.width);
      let best = 9999, at = null;
      for (let dx = -6; dx <= 6; dx++) for (let dy = -6; dy <= 6; dy++) {
        const d = ctx2.getImageData(cx + dx, cy + dy, 1, 1).data;
        const dist = Math.abs(d[0] - want[0]) + Math.abs(d[1] - want[1]) + Math.abs(d[2] - want[2]);
        if (dist < best) { best = dist; at = [d[0], d[1], d[2]]; }
      }
      return { best, at, w: cv.width, h: cv.height };
    }, { n, fx, fy, want });
  };
  const checks = [
    ["page 1 (plain): the blue pen", 1, 0.45, 0.3, HEX.blue],
    ["page 1: the yellow highlighter", 1, 0.45, 0.55, HEX.yellow],
    ["page 2 (turned a quarter round): the red pen", 2, 0.5, 0.2, HEX.red],
    ["page 3 (cropped, corner at 20, 30): the green pen", 3, 0.45, 0.45, HEX.green],
    ["page 1: the top edge of the red rectangle", 1, 0.35, 0.62, HEX.red],
    ["page 2 (turned): the line of the blue arrow", 2, 0.4, 0.4, HEX.blue],
    ["page 2 (turned): the head of the blue arrow", 2, 0.69, 0.4, HEX.blue],
    ["page 1: the yellow sticky note", 1, 0.717, 0.367, HEX.yellow],
  ];
  for (const [label, n, fx, fy, want] of checks) {
    const r = await probe(n, fx, fy, want);
    ok(r.best <= 70, `${label} is on the page where it was drawn (nearest pixel ${JSON.stringify(r.at)}, wanted about ${JSON.stringify(want)})`);
  }
  // the text box on the cropped page: dark letters where it was written, nothing where it was not
  const textPixels = async (n, f) => {
    await page.evaluate((n) => document.querySelector(`[data-page="${n}"]`).scrollIntoView({ block: "center" }), n);
    await page.waitForTimeout(700);
    return page.evaluate(({ n, f }) => {
      const cv = document.querySelector(`[data-page="${n}"] .pdfp-canvas`);
      const ctx2 = cv.getContext("2d");
      const x0 = Math.round(f[0] * cv.width), y0 = Math.round(f[1] * cv.width), w = Math.round((f[2] - f[0]) * cv.width), h = Math.round((f[3] - f[1]) * cv.width);
      const d = ctx2.getImageData(x0, y0, w, h).data;
      let dark = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 100) dark++;
      return dark;
    }, { n, f });
  };
  const inBox = await textPixels(3, [0.2, 0.6, 0.6, 0.65]);
  const outBox = await textPixels(3, [0.2, 0.7, 0.6, 0.75]);
  ok(inBox > 30 && outBox === 0, `page 3: the text box's letters are on the page where it was written (${inBox} dark pixels there, ${outBox} below it)`);
  // and where nothing was drawn it is not: the same height, away from the stroke, is white or text
  const off = await probe(1, 0.8, 0.3, HEX.blue);
  ok(off.best > 150, "far from the stroke the page is as it was");

  console.log("the notes page");
  const lastText = await page.evaluate(async () => {
    const el = document.querySelector('[data-page="4"]');
    el?.scrollIntoView({ block: "start" });
    await new Promise((r) => setTimeout(r, 1200));
    return [...document.querySelectorAll('[data-page="4"] .textLayer span')].map((s) => s.textContent).join(" ");
  });
  ok(/Notes on turned/.test(lastText) && /Page 1/.test(lastText) && /title of the paper/.test(lastText) && /Page 3/.test(lastText), `the last page lists the highlights and the notes (${lastText.slice(0, 120)}…)`);
  ok(/Sticky notes/.test(lastText) && /ask the supervisor/.test(lastText), "the words of the sticky note are on the notes page (the square on the page has no room for them)");
  ok(/\?/.test(lastText) && !/मोतियाबिंद/.test(lastText), "letters the font cannot show appear as '?', not as wrong letters");

  ok(failedCalls.filter((c) => !/409/.test(c)).length === 0, `no failed calls (${failedCalls.join(", ")})`);
  ok(errors.length === 0, `no console or page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
  for (const d of (await (await page.request.get(BASE + "/api/v1/documents")).json()).items) await page.request.delete(`${BASE}/api/v1/documents/${d.id}`, H);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
} finally {
  await browser.close();
  idp.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall annotated PDF checks passed");
  process.exit(failures ? 1 : 0);
}
