// Browser e2e: a scanned paper (a PDF of page pictures). Upload, the pages being read, the banner (what was read well, with doubt, not reliably), questions on a scan,
// pausing and continuing, the daily limit and carrying on the next day, phone width, light and dark.
// Needs the Worker with the fake identity provider, the offline model stand-ins (QA_STUB=1, see apps/api/src/ocr/stub.ts) and OCR_PAGES_PER_DAY=25:
// `npm run integration -w apps/api -- --browser` starts it.
//   node e2e/scan.mjs [baseUrl]    (default http://localhost:8788)
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startFakeIdp } from "../../api/scripts/fake-idp.mjs";
import { makePageJpeg, makeScanPdf } from "../../api/scripts/lib/make-scan-pdf.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.argv[2] ?? "http://localhost:8788";
const OUT = fileURLToPath(new URL("./shots/", import.meta.url));
const PER_DAY = 25;
mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "scan-ui-1", email: "meera@example.edu", email_verified: true, name: "Meera Iyer" });

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401|429)/.test(m.text())) errors.push("console: " + m.text()); });

async function axe(label) {
  await page.evaluate(axeSource);
  const res = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(" "), msg: v.nodes[0]?.failureSummary?.split("\n")[1] }));
  });
  ok(res.length === 0, `axe [${label}]: ${res.length ? "" : "no violations"}`);
  for (const v of res) console.log(`        ${v.impact} ${v.id} x${v.nodes} ${v.sample} :: ${v.msg}`);
}
const shot = (name) => page.screenshot({ path: OUT + name + ".png" });
const setTheme = async (label) => { await page.getByRole("button", { name: `${label} theme` }).click(); await page.waitForTimeout(500); };
const until = async (fn, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(150); } return false; };
const sql = async (...s) => (await (await fetch(`${BASE}/api/v1/dev/sql`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: s }) })).json()).results;
const api = async (path) => (await page.request.get(`${BASE}/api/v1${path}`)).json();
const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

/** A scanned PDF of `n` pages (a picture per page, no text). `blankPages` are empty sheets. */
const scanPdf = async (n, { blankPages = [], title = "Scanned report" } = {}) =>
  makeScanPdf(await Promise.all(Array.from({ length: n }, (_, i) => makePageJpeg({ blank: blankPages.includes(i + 1), lines: [`${title}, page ${i + 1}`, "Soil moisture was measured at 38 sites."] }))), { title });
const upload = async (name, buffer) => page.locator('input[type="file"]').setInputFiles({ name, mimeType: "application/pdf", buffer });
const job = () => page.locator(".job").first();
const card = (name) => page.locator(".dc", { hasText: name });

try {
  /* ---------- sign in ---------- */
  await page.goto(BASE + "/papers", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.locator("button[aria-label^=\"Account:\"], .ws-who").first().waitFor({ timeout: 15000 });
  const note = page.getByRole("region", { name: /how your papers are handled/ });
  await note.waitFor();
  await note.getByRole("button", { name: "I understand, continue" }).click();
  await note.waitFor({ state: "detached", timeout: 8000 });
  await page.waitForTimeout(800);

  /* ---------- a scanned paper: upload and reading ---------- */
  console.log("a scanned paper is read, not refused");
  await page.route("**/api/v1/documents/*/ocr**", async (route) => { await new Promise((r) => setTimeout(r, 450)); await route.continue(); });
  await upload("scanned_report.pdf", await scanPdf(7, { blankPages: [6] }));
  await job().waitFor();
  ok(await until(async () => (await page.locator(".job-steps li").allInnerTexts()).join("|") === "Read|Upload|Read the pages"), "a scan shows its own steps: Read, Upload, Read the pages");
  ok(await until(async () => (await page.locator(".job-steps li[data-state='now']").innerText().catch(() => "")) === "Read the pages"), "the step that is running is 'Read the pages'");
  ok(await until(async () => /Read \d+ of 7 pages/.test(await job().locator(".job-detail").innerText().catch(() => ""))), "the job says how many pages have been read");
  ok(await page.getByRole("button", { name: "Pause" }).isVisible(), "there is a Pause button while pages are read");
  await page.waitForTimeout(900); // a card that has just appeared is still fading in; axe must not read it half way
  await shot("80-scan-job-running");
  await axe("scan job running");
  await page.locator('.job[data-state="done"]').waitFor({ timeout: 60000 });
  ok(/7 pages read from the scan/.test(await job().locator(".job-detail").innerText()), "it finishes: 7 pages read from the scan");
  await page.unroute("**/api/v1/documents/*/ocr**");
  await page.locator(".job").first().waitFor({ state: "detached", timeout: 10000 });
  const c1 = card("scanned report");
  await c1.waitFor();
  ok(/Scan/.test(await c1.locator(".dc-meta").innerText()), "the paper in the list is marked as a scan");
  ok((await c1.locator(".dc-open").count()) === 1 && (await c1.getByRole("button", { name: "Open and ask" }).count()) === 0, "it is ready: the cover opens it (there is no Open and ask button)");
  const list = await api("/documents");
  const d1 = list.items.find((d) => d.title === "scanned report");
  ok(d1.scanned === true && d1.status === "ready" && d1.scanPending === 0 && d1.chunkCount >= 3, `the server has it as a ready scan (${d1.chunkCount} passages)`);
  const used = (await sql("SELECT pages FROM ocr_usage"))[0][0]?.pages;
  ok(used === 6, `the blank page was found by the browser and not sent: 6 of 7 pages used today (${used})`);
  await shot("81-scan-card");
  await axe("papers with a scan");

  /* ---------- the workspace and its banner ---------- */
  console.log("the banner");
  await c1.locator(".dc-open").click();
  await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  const banner = page.locator(".scan");
  await banner.waitFor();
  ok(/Read from a scan/.test(await banner.innerText()) && /check numbers against the page/i.test(await banner.innerText()), "the banner says the paper is a scan and to check numbers on the page");
  ok(/4 pages of 7 could be used, 2 pages had nothing on them/.test(await banner.locator(".scan-sub").innerText()), `it counts: ${(await banner.locator(".scan-sub").innerText()).trim()}`);
  ok((await banner.locator(".scan-note[data-tone='warn'] .scan-chip").allInnerTexts()).join() === "p.3", "pages read with doubt are named (p.3)");
  ok((await banner.locator(".scan-note[data-tone='bad'] .scan-chip").allInnerTexts()).join() === "p.4", "pages that were not read reliably are named (p.4) and said to be left out");
  ok(/left out of answers and the reference check/.test(await banner.innerText()), "...with what that means");
  ok(/different numbers on page 3 \(2019 or 2018\)/.test(await banner.innerText()), "numbers the two readings gave differently are listed with the page");
  ok(/Highlighting and notes need selectable text/.test(await banner.innerText()), "it says that highlighting needs selectable text");
  ok(/passages read from a scan/.test(await page.locator(".dw-meta").innerText()), "the header says the passages were read from a scan");
  await page.waitForTimeout(700);
  await shot("82-scan-workspace");
  await axe("scan workspace");
  await setTheme("Dark"); await shot("83-scan-workspace-dark"); await axe("scan workspace, dark"); await setTheme("Light");
  await banner.locator(".scan-note[data-tone='bad'] .scan-chip").click();
  ok(await until(async () => (await page.locator("#pdfv-page").inputValue()) === "4"), "a page chip opens that page of the PDF");

  /* ---------- questions on a scan ---------- */
  console.log("questions on a scan");
  await page.locator(".dw-sidetab", { hasText: "Ask" }).click();
  ok(/passages read from the scan/.test(await page.locator('section[aria-label="Ask this paper"] .ask-sub').innerText()), "the question box says its passages were read from the scan");
  await page.getByRole("button", { name: "What research question does it ask?" }).click();
  await page.locator(".ask-answer").first().waitFor({ timeout: 30000 });
  ok(/Sources match the text read from the scan/.test(await page.locator(".ask-status").first().innerText()), "it does not claim the sources were 'checked against the paper': they match the text that was read");
  ok(await page.locator(".ask-warn[data-kind='scan']").first().isVisible(), "a note says the words and numbers were read from page pictures and names the pages to check");
  ok(/This paper is a scan/.test(await page.locator(".ask-warn[data-kind='scan']").first().innerText()), "...");
  const chip = page.locator(".cite-chip").first();
  const citedPage = Number(/p\.(\d+)/.exec(await chip.innerText())?.[1]);
  ok([1, 2, 3, 7].includes(citedPage), `the answer cites a page that was read well enough (page ${citedPage}), never page 4`);
  await chip.click();
  ok(await until(async () => (await page.locator("#pdfv-page").inputValue()) === String(citedPage)), "a source opens its page (a scan has no text to highlight, and nothing breaks)");
  await shot("84-scan-answer");
  await axe("scan answer");

  /* ---------- references of a scan ---------- */
  console.log("references of a scan");
  await page.locator(".dw-sidetab", { hasText: "References" }).click();
  await page.locator(".refs-panel").waitFor();
  await page.waitForFunction(() => /No reference list was found/.test(document.querySelector(".refs-panel .ask-sub")?.textContent ?? ""), null, { timeout: 15000 });
  ok(true, "a scan with no reference list says so");
  ok(/text that was read/.test(await page.locator(".refs-panel .ask-hint, .refs-panel .ask-empty").first().innerText()), "...and that it looked in the text that was read");
  await page.locator(".refsec summary").click();
  await page.locator(".refsec-where").waitFor({ timeout: 15000 });
  ok(/No heading such as/.test(await page.locator(".refsec-where").innerText()), "the reference section panel works from the text that was read");
  await page.locator(".refsec-text").fill("Adamson, H. D. & Regan, V. M. (1991). The acquisition of community speech norms by Asian immigrants learning English as a second language. Studies in Second Language Acquisition, 13: 1–22.\n\nAnderson, J. R. (1976). Language, Memory and Thought. Hillsdale, NJ: Lawrence Erlbaum.");
  await page.getByRole("button", { name: "Check this list" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".refs-panel .ref").length === 2, null, { timeout: 20000 });
  ok(true, "a list typed in by hand is checked, as for any paper");

  /* ---------- pausing and continuing ---------- */
  console.log("pause and continue");
  await page.goto(BASE + "/papers", { waitUntil: "networkidle" });
  await page.route("**/api/v1/documents/*/ocr**", async (route) => { await new Promise((r) => setTimeout(r, 900)); await route.continue(); });
  await upload("thesis_chapter.pdf", await scanPdf(12, { title: "Thesis chapter" }));
  await page.getByRole("button", { name: "Pause" }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Pause" }).click();
  await page.locator('.job[data-state="paused"]').waitFor({ timeout: 30000 });
  const pausedText = await job().locator(".job-detail").innerText();
  ok(/Paused\. \d+ pages? left to read/.test(pausedText), `pausing keeps what was read and says what is left (${pausedText.split("·")[0].trim()})`);
  const left1 = Number(/(\d+) pages? left/.exec(pausedText)[1]);
  ok(left1 >= 1 && left1 <= 12, "some pages are still to be read");
  await page.waitForTimeout(2500); // pages that were already on their way to the server when Pause was pressed are finished by it
  const c2 = card("thesis chapter");
  await c2.waitFor();
  ok(/still to be read/.test(await c2.innerText()) && (await c2.getByRole("button", { name: "Continue reading" }).count()) === 1, "the paper in the list says so and offers 'Continue reading'");
  ok((await c2.locator(".dc-open").count()) === 1, "it can still be opened");
  await shot("85-scan-paused");
  await axe("paused job and card");
  const midDoc = (await api("/documents")).items.find((d) => d.title === "thesis chapter");
  ok(midDoc.status === "indexing" && midDoc.scanPending >= 1 && midDoc.scanPending <= left1 && midDoc.scanPending >= left1 - 3, `the server agrees: not ready, ${midDoc.scanPending} pages left (the job said ${left1}; up to 3 pages were already on their way)`);
  // opening a paper whose reading is part way: the banner offers to go on, and questions wait
  await c2.locator(".dc-open").click();
  await page.locator(".scan").waitFor();
  ok((await page.locator(".scan").getByRole("button", { name: "Continue reading" }).count()) === 1, "the paper's banner has 'Continue reading'");
  ok(/still to be read/.test(await page.locator('section[aria-label="Ask this paper"] .ask-sub').innerText()) && (await page.locator("#ask-input").isDisabled()), "questions are switched off until every page is read");
  await page.locator(".dw-sidetab", { hasText: "References" }).click();
  ok(/looked for when every page has been read/.test(await page.locator(".refs-panel .ask-sub").innerText()), "references say they wait for the pages");
  await page.locator(".scan").getByRole("button", { name: "Continue reading" }).click();
  await page.locator(".scan .spin").waitFor({ timeout: 15000 });
  ok(await page.locator(".scan").getByRole("button", { name: "Pause" }).isVisible(), "reading goes on and the banner shows Pause");
  await page.unroute("**/api/v1/documents/*/ocr**");
  ok(await until(async () => (await page.locator(".dw-meta").innerText()).includes("passages read from a scan"), 60000), "when the last page is read the paper becomes ready");
  const fin = (await api("/documents")).items.find((d) => d.title === "thesis chapter");
  ok(fin.status === "ready" && fin.scanPending === 0, "the server: ready, nothing pending");
  ok((await sql(`SELECT COUNT(*) AS n FROM doc_ocr WHERE doc_id = '${fin.id}' AND status != 'pending'`))[0][0].n === 12, "all 12 pages were tried once (none twice)");
  await page.waitForFunction(() => !document.querySelector("#ask-input")?.disabled, null, { timeout: 15000 });
  ok(true, "questions are open again");

  /* ---------- the daily limit ---------- */
  console.log("the daily limit");
  await page.goto(BASE + "/papers", { waitUntil: "networkidle" });
  const before = (await sql("SELECT pages FROM ocr_usage"))[0][0].pages;
  await upload("long_thesis.pdf", await scanPdf(30, { title: "Long thesis" }));
  await page.locator('.job[data-state="paused"]').waitFor({ timeout: 90000 });
  const limitText = await job().locator(".job-detail").innerText();
  ok(/Today's limit for reading scanned pages is used\. \d+ pages? left: continue tomorrow, what is read is kept/.test(limitText), `the job stops at the limit and says what happens next (${limitText.split("·")[0].trim()})`);
  const afterLimit = (await sql("SELECT pages FROM ocr_usage"))[0][0].pages;
  ok(afterLimit === PER_DAY && before < PER_DAY, `exactly ${PER_DAY} pages were used today, no more (${before} before this paper)`);
  const long = (await api("/documents")).items.find((d) => d.title === "long thesis");
  ok(long.status === "indexing" && long.scanPending === 30 - (PER_DAY - before), `${PER_DAY - before} pages of it were read, ${long.scanPending} are left`);
  await shot("86-scan-limit");
  await axe("daily limit reached");
  await page.locator(".dc", { hasText: "long thesis" }).locator(".dc-open").click();
  await page.locator(".scan").waitFor();
  const cont = page.locator(".scan").getByRole("button", { name: /Continue tomorrow/ });
  ok((await cont.count()) === 1 && (await cont.isDisabled()), "in the paper, the button says 'Continue tomorrow' and is off");
  ok(new RegExp(`${PER_DAY} of ${PER_DAY} pages used today`).test(await page.locator(".scan-sub").innerText()), "the banner shows today's use against the limit");
  await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(700);
  await shot("87-scan-limit-banner");
  await axe("limit banner");

  /* ---------- the next day ---------- */
  console.log("the next day");
  await sql("UPDATE ocr_usage SET day = '2000-01-01'");
  await page.goto(BASE + "/papers", { waitUntil: "networkidle" });
  const c3 = card("long thesis");
  await c3.getByRole("button", { name: "Continue reading" }).click();
  await page.locator('.job[data-state="done"]').waitFor({ timeout: 90000 });
  const done3 = (await api("/documents")).items.find((d) => d.title === "long thesis");
  ok(done3.status === "ready" && done3.scanPending === 0, "the next day 'Continue reading' reads the rest and the paper is ready");
  const used2 = (await sql(`SELECT pages FROM ocr_usage WHERE day != '2000-01-01'`))[0][0]?.pages;
  ok(used2 === 30 - (PER_DAY - before), `only the pages that were left were used today (${used2})`);

  /* ---------- phone width ---------- */
  console.log("phone width");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + "/papers", { waitUntil: "networkidle" });
  ok(await noSideways(), "the papers page does not scroll sideways at 390 px");
  await card("scanned report").locator(".dc-open").click();
  await page.locator(".scan").waitFor();
  await page.waitForTimeout(700);
  ok(await noSideways(), "the banner does not make the paper scroll sideways at 390 px");
  await shot("88-scan-mobile");
  await axe("scan banner, phone");
  await setTheme("Dark"); await shot("89-scan-mobile-dark"); await axe("scan banner, phone, dark"); await setTheme("Light");

  ok(errors.length === 0, `no errors in the browser console${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  await shot("89-scan-failure").catch(() => {});
  failures++;
}
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall scanned-paper browser checks passed");
process.exit(failures ? 1 : 0);
