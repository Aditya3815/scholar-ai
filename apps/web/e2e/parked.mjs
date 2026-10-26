// Browser e2e for the two features that are built but set aside (decision of 25 Oct): naming the highlight colours, and two papers side by side.
// They are off for everyone; this test switches them on in its own browser (localStorage "scholar.parked") to keep them working until they are brought back.
//   node e2e/parked.mjs [baseUrl]
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { startFakeIdp } from "../../api/scripts/fake-idp.mjs";
import { SAMPLE_PAPER, makePdf } from "../../api/scripts/lib/make-pdf.mjs";

const BASE = process.argv[2] ?? "http://localhost:8788";
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };
const idp = await startFakeIdp(9911);
idp.setUser({ sub: "ws-parked-1", email: "dev.p@example.edu", email_verified: true, name: "Dev P" });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(() => { try { localStorage.setItem("scholar.ws", "1"); localStorage.setItem("scholar.parked", "names,split"); } catch {} });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401|403|404|409)/.test(m.text())) errors.push("console: " + m.text()); });
  const H = { headers: { Origin: BASE } };

  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
  await page.getByRole("button", { name: "Continue with Google" }).last().click();
  await page.locator("#hm-h").waitFor({ timeout: 20000 });
  await page.locator(".ws-rail").getByRole("link", { name: /My Workspace/ }).click();
  const note = page.getByRole("region", { name: /how your papers are handled/ });
  await note.waitFor();
  await note.getByRole("button", { name: "I understand, continue" }).click();
  await note.waitFor({ state: "detached", timeout: 8000 });
  await page.locator('input[type="file"]').setInputFiles({ name: "glaucoma_screening.pdf", mimeType: "application/pdf", buffer: makePdf(SAMPLE_PAPER, { title: "Glaucoma screening" }) });
  await page.waitForFunction(() => document.querySelectorAll(".dc").length === 1 && document.querySelector(".dc")?.getAttribute("data-status") === "ready", null, { timeout: 60000 });
  await page.locator('input[type="file"]').setInputFiles({ name: "methods_paper.pdf", mimeType: "application/pdf", buffer: makePdf(["Methods of the second study. We interviewed forty farmers."], { title: "Methods paper" }) });
  await page.waitForFunction(() => document.querySelectorAll(".dc").length === 2 && [...document.querySelectorAll(".dc")].every((c) => c.getAttribute("data-status") === "ready"), null, { timeout: 60000 });
  const items = (await (await page.request.get(BASE + "/api/v1/documents")).json()).items;
  const glaucoma = items.find((d) => /glaucoma/i.test(d.title));
  const quote = "Images were graded by two ophthalmologists and disagreements were resolved by a third";
  await page.request.post(`${BASE}/api/v1/documents/${glaucoma.id}/notes`, { ...H, data: { page: 2, quote, color: "green" } });
  await page.request.post(`${BASE}/api/v1/documents/${glaucoma.id}/notes`, { ...H, data: { page: 3, quote: "Limitations include a single country and a small number of cases of angle closure", color: "pink" } });

  console.log("naming the colours (parked)");
  await page.goto(`${BASE}/papers/${glaucoma.id}`, { waitUntil: "networkidle" });
  await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  await page.locator(".dw-sidetabs").getByRole("tab", { name: /Notes/ }).click();
  await page.getByRole("button", { name: "Name the colours" }).click();
  await page.getByLabel("What green means").fill("How they did it");
  await page.getByLabel("What green means").press("Enter");
  await page.getByRole("button", { name: /How they did it 1/ }).waitFor();
  await page.getByRole("group", { name: "Order of the list" }).getByRole("button", { name: "By colour" }).click();
  ok(await page.locator(".hl-group-sec h3").filter({ hasText: "How they did it" }).count() === 1, "a colour can be given a name of the reader's own, shown in the filter and the sections");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
  const md = readFileSync(await dl.path(), "utf8");
  ok(/## How they did it \(green, 1\)/.test(md) && /## Pink \(1\)/.test(md), "the Markdown uses the names (and the plain name for a colour that has none)");
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".dw-sidetabs").getByRole("tab", { name: /Notes/ }).click();
  await page.getByRole("button", { name: /How they did it 1/ }).waitFor();
  ok(true, "the names are remembered on this device");

  console.log("two papers side by side (parked)");
  await page.getByRole("button", { name: "Open another paper beside this one" }).click();
  await page.getByText("Compare with").waitFor();
  ok(await page.getByRole("button", { name: /methods.paper/i }).isVisible() && !(await page.getByRole("button", { name: /glaucoma screening/i }).count()), "the picker offers the other papers, not this one");
  await page.getByRole("button", { name: /methods.paper/i }).click();
  await page.locator(".dw-second .pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  ok(await page.locator(".dw-second").isVisible() && await page.locator(".dw-viewer .pdfv").count() === 2, "a second paper opens beside the first, each with its own viewer");
  ok(await page.getByRole("region", { name: /Second paper: methods paper/i }).isVisible() && await page.locator("#pdfv2-page").count() === 1, "it is a region of its own, and its ids do not clash with the first");
  const two = await page.evaluate(() => [...document.querySelectorAll(".dw-paper > .dw-viewer, .dw-paper > .dw-second")].map((e) => Math.round(e.getBoundingClientRect().width)));
  ok(two.length === 2 && Math.abs(two[0] - two[1]) < 40, `they share the width (${two.join(" and ")} px)`);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), "no sideways scroll with two papers");
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search commands, papers and pages" }).fill("second");
  ok(await page.getByRole("option", { name: /Close the second paper/ }).isVisible(), "the palette offers to close it");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Close the second paper" }).first().click();
  ok(await page.locator(".dw-second").count() === 0, "the second paper can be closed");
  await page.setViewportSize({ width: 900, height: 800 });
  await page.waitForTimeout(400);
  ok(await page.locator(".dw-split-btn").evaluate((el) => getComputedStyle(el).display) === "none", "on a narrow window the button is not offered");
  for (const d of (await (await page.request.get(BASE + "/api/v1/documents")).json()).items) await page.request.delete(`${BASE}/api/v1/documents/${d.id}`, H);
  ok(errors.length === 0, `no console or page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
} finally {
  await browser.close();
  idp.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall parked-feature checks passed");
  process.exit(failures ? 1 : 0);
}
