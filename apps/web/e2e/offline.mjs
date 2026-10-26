// Browser e2e for offline reading (My Workspace): switched on in Settings, the app and the papers that are opened are kept on the device; with the network cut,
// the app opens, the paper is read and drawn on; what is drawn is kept on the device and reaches the server when the connection is back; signing out removes it all.
//   node e2e/offline.mjs [baseUrl]    (default http://localhost:8788; `npm run integration -w apps/api -- --browser` starts the Worker)
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { startFakeIdp } from "../../api/scripts/fake-idp.mjs";
import { SAMPLE_PAPER, makePdf } from "../../api/scripts/lib/make-pdf.mjs";

const BASE = process.argv[2] ?? "http://localhost:8788";
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "ws-offline-1", email: "meera.s@example.edu", email_verified: true, name: "Meera S" });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
const errors = [];
let offline = false;

try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, serviceWorkers: "allow" });
  await ctx.addInitScript(() => { try { localStorage.setItem("scholar.ws", "1"); } catch {} });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    // with the network cut the browser itself reports each request that could not be made
    if (m.type() === "error" && !(offline && /ERR_INTERNET_DISCONNECTED|Failed to load resource|Failed to fetch/.test(m.text())) && !/Failed to load resource.*(401|403|404|409)/.test(m.text())) errors.push("console: " + m.text());
  });
  const cacheKeys = (name) => page.evaluate(async (n) => ((await caches.has(n)) ? (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname) : []), name);
  const pending = () => page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open("scholar"); // the version the app made it at (the app creates the stores)
    req.onerror = () => resolve(-1);
    req.onsuccess = () => {
      const db = req.result;
      const c = db.transaction("pendingInk").objectStore("pendingInk").count();
      c.onsuccess = () => { db.close(); resolve(c.result); };
      c.onerror = () => { db.close(); resolve(-1); };
    };
  }));
  const until = async (fn, what, ms = 15000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await page.waitForTimeout(200); } throw new Error("timed out waiting for " + what); };

  console.log("sign in, switch offline reading on");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
  await page.getByRole("button", { name: "Continue with Google" }).last().click();
  await page.locator("#hm-h").waitFor({ timeout: 20000 });
  await page.locator(".ws-rail").getByRole("link", { name: "Settings" }).click();
  const chk = page.getByRole("checkbox", { name: /Keep the papers I open on this device/ });
  await chk.waitFor();
  ok(!(await chk.isChecked()) && (await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))) === 0, "it is off until it is switched on: no worker, nothing kept");
  await chk.check();
  await until(() => page.evaluate(() => localStorage.getItem("scholar.offline") === "1" && !!navigator.serviceWorker.controller), "the worker to take control");
  ok(true, "switching it on registers the worker, and it takes control of the page");
  await until(async () => (await cacheKeys("scholar-shell-v1")).includes("/") && (await cacheKeys("scholar-shell-v1")).some((k) => k.startsWith("/assets/")), "the app to be kept");
  ok(true, "the app itself (the page and its scripts) is kept");
  ok(/No paper is kept yet/.test(await page.locator(".offline-list").innerText()), "Settings says no paper is kept yet");

  console.log("a paper that is opened is kept");
  await page.locator(".ws-rail").getByRole("link", { name: /My Workspace/ }).click();
  const note = page.getByRole("region", { name: /how your papers are handled/ });
  await note.waitFor();
  await note.getByRole("button", { name: "I understand, continue" }).click();
  await note.waitFor({ state: "detached", timeout: 8000 });
  await page.locator('input[type="file"]').setInputFiles({ name: "offline_paper.pdf", mimeType: "application/pdf", buffer: makePdf(SAMPLE_PAPER, { title: "Offline paper" }) });
  await page.waitForFunction(() => document.querySelector(".dc")?.getAttribute("data-status") === "ready", null, { timeout: 60000 });
  await page.locator(".dc .dc-open").first().click();
  await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  const docId = new URL(page.url()).pathname.split("/").pop();
  await until(async () => (await cacheKeys("scholar-papers-v1")).length === 1, "the paper's file to be kept");
  ok((await cacheKeys("scholar-papers-v1"))[0] === `/api/v1/documents/${docId}/file`, "opening a paper keeps its file");
  const dataKeys = await cacheKeys("scholar-data-v1");
  ok(dataKeys.includes(`/api/v1/documents/${docId}`) && dataKeys.includes(`/api/v1/documents/${docId}/notes`) && dataKeys.includes(`/api/v1/documents/${docId}/ink`), "with the small reads the reader needs: details, notes, drawing");
  ok(!dataKeys.some((k) => /\/(ask|search|remember|progress)/.test(k)) && !(await cacheKeys("scholar-data-v1")).some((k) => /ask/.test(k)), "and nothing else: no question, no search, no answer");
  await page.getByRole("button", { name: /My Workspace/ }).first().click();
  await page.locator(".dc").first().waitFor();
  await until(async () => await page.locator(".dc-offline").count() === 1, "the card to say it is on this device", 8000);
  ok(true, "the paper's card says 'On this device'");

  console.log("without a connection");
  await ctx.setOffline(true);
  offline = true;
  await page.goto(`${BASE}/papers/${docId}`, { waitUntil: "domcontentloaded" });
  await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  ok(await page.locator(".dw-title").innerText().then((t) => /offline paper/i.test(t)), "with the network cut, the app opens and so does the paper");
  ok(await page.getByText(/You are offline/).isVisible(), "and says it is offline");
  await page.screenshot({ path: fileURLToPath(new URL("./shots/offline-1-reader.png", import.meta.url)) }).catch(() => {});
  await page.getByRole("button", { name: /^Draw$/ }).click();
  const bar = page.getByRole("toolbar", { name: "Draw on the paper" });
  await bar.waitFor();
  await page.keyboard.press("p");
  const box = await page.locator('.pdfp[data-page="1"]').boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.width * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.width * 0.34, { steps: 12 });
  await page.mouse.up();
  await bar.locator("[role=status]").filter({ hasText: /Offline: kept on this device/ }).waitFor({ timeout: 15000 });
  ok(true, "a stroke drawn offline is accepted, and the toolbar says it is kept on this device");
  await until(async () => (await pending()) === 1, "the drawing to be kept on the device");
  ok(true, "it is in the device's own storage");
  await page.goto(`${BASE}/papers/${docId}`, { waitUntil: "domcontentloaded" });
  await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  await page.locator('.pdfp[data-page="1"] .ink-pen path[fill]:not(.ink-live)').first().waitFor({ timeout: 10000 });
  ok(await page.locator('.pdfp[data-page="1"] .ink-pen path[fill]:not(.ink-live)').count() === 1, "after a reload, still offline, the stroke is still there");

  console.log("back online");
  await ctx.setOffline(false);
  offline = false;
  const seen = async () => (await (await page.request.get(`${BASE}/api/v1/documents/${docId}/ink`)).json()).strokes.length;
  await until(async () => (await seen()) === 1, "the drawing to reach the server", 30000);
  ok(true, "the connection returns and the drawing is sent by itself");
  await until(async () => (await pending()) === 0, "the copy on the device to be removed");
  ok(true, "and the copy kept on the device is removed");
  ok(await page.getByText(/You are offline/).count() === 0, "the offline notice goes");

  console.log("drawn offline while the paper was changed elsewhere");
  const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  await page.getByRole("button", { name: /^Draw$/ }).click();
  await page.getByRole("toolbar", { name: "Draw on the paper" }).waitFor();
  await page.keyboard.press("p");
  await ctx.setOffline(true);
  offline = true;
  const b2 = await page.locator('.pdfp[data-page="1"]').boundingBox();
  await page.mouse.move(b2.x + b2.width * 0.2, b2.y + b2.width * 0.5);
  await page.mouse.down();
  await page.mouse.move(b2.x + b2.width * 0.6, b2.y + b2.width * 0.52, { steps: 10 });
  await page.mouse.up();
  await until(async () => (await pending()) === 1, "the second drawing to be kept on the device");
  // meanwhile another window (here: a plain request with the same sign-in) saves a different stroke
  const cur = await (await fetch(`${BASE}/api/v1/documents/${docId}/ink`, { headers: { Cookie: cookie } })).json();
  const elsewhere = await fetch(`${BASE}/api/v1/documents/${docId}/ink`, { method: "PUT", headers: { Cookie: cookie, Origin: BASE, "Content-Type": "application/json" }, body: JSON.stringify({ strokes: [...cur.strokes, { id: "elsewhere1", page: 1, tool: "pen", color: "red", w: 0.0034, pts: [0.3, 0.7, 0.5, 0.5, 0.7, 0.5] }], rev: cur.rev }) });
  ok(elsewhere.ok, "(meanwhile another window saves a stroke of its own)");
  await ctx.setOffline(false);
  offline = false;
  await until(async () => (await seen()) === 3, "both drawings to be on the server", 30000);
  const ids3 = (await (await page.request.get(`${BASE}/api/v1/documents/${docId}/ink`)).json()).strokes.map((s) => s.id);
  ok(ids3.includes("elsewhere1") && ids3.length === 3 && new Set(ids3).size === 3, "the connection returns: the other window's stroke is kept and so is the one drawn offline, none twice");
  await until(async () => (await pending()) === 0, "the copy on the device to be removed");
  ok(true, "and the copy kept on the device is removed");
  await page.keyboard.press("Escape");

  console.log("a paper that was not opened is not available offline");
  await page.getByRole("button", { name: /My Workspace/ }).first().click();
  await page.locator('input[type="file"]').setInputFiles({ name: "never_opened.pdf", mimeType: "application/pdf", buffer: makePdf(["A paper that is only uploaded."], { title: "Never opened" }) });
  await page.waitForFunction(() => document.querySelectorAll(".dc").length === 2 && [...document.querySelectorAll(".dc")].every((c) => c.getAttribute("data-status") === "ready"), null, { timeout: 60000 });
  const ids = (await (await page.request.get(BASE + "/api/v1/documents")).json()).items.map((d) => d.id);
  const other = ids.find((i) => i !== docId);
  await ctx.setOffline(true);
  offline = true;
  await page.goto(`${BASE}/papers/${other}`, { waitUntil: "domcontentloaded" });
  await page.getByText(/We could not load this paper/).waitFor({ timeout: 20000 });
  ok(true, "opening it says so, plainly, and does not hang");
  await ctx.setOffline(false);
  offline = false;

  console.log("remove, switch off, sign out");
  await page.goto(BASE + "/settings", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Remove .* from this device/ }).first().click();
  await until(async () => (await cacheKeys("scholar-papers-v1")).length === 0, "the paper's copy to be removed");
  ok((await cacheKeys("scholar-data-v1")).every((k) => !k.includes(docId)), "'Remove from this device' deletes the paper's file and the reads kept with it");
  // open it again so that there is something to clear, then sign out
  await page.goto(`${BASE}/papers/${docId}`, { waitUntil: "networkidle" });
  await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  await until(async () => (await cacheKeys("scholar-papers-v1")).length === 1, "the paper to be kept again");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator(".ws-rail").getByRole("button", { name: "Sign out" }).click();
  await page.locator("#in-h1").waitFor({ timeout: 20000 });
  await until(async () => (await cacheKeys("scholar-papers-v1")).length === 0 && !(await cacheKeys("scholar-data-v1")).some((k) => k.startsWith("/api/v1/documents")), "everything of the person's to be removed at sign-out");
  ok(true, "signing out removes the papers and the reads of their papers that were kept");
  ok((await pending()) === 0, "and any drawing waiting on the device");
  ok(await page.evaluate(() => localStorage.getItem("scholar.offline")) === "1", "the switch itself stays as the person set it");

  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
  await page.getByRole("button", { name: "Continue with Google" }).last().click();
  await page.locator("#hm-h").waitFor({ timeout: 20000 });
  await page.locator(".ws-rail").getByRole("link", { name: "Settings" }).click();
  const chk2 = page.getByRole("checkbox", { name: /Keep the papers I open on this device/ });
  await chk2.waitFor();
  await chk2.uncheck();
  await until(async () => (await page.evaluate(() => localStorage.getItem("scholar.offline"))) === null && (await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))) === 0, "the worker to go");
  ok(true, "switching it off removes the worker and everything it kept");
  for (const d of (await (await page.request.get(BASE + "/api/v1/documents")).json()).items) await page.request.delete(`${BASE}/api/v1/documents/${d.id}`, { headers: { Origin: BASE } });
  ok(errors.length === 0, `no console or page errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
} finally {
  await browser.close();
  idp.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall offline checks passed");
  process.exit(failures ? 1 : 0);
}
