// Browser e2e: library sync, settings, data export and account deletion, in the new look (W6: the Library and Settings pages of the rail). Same setup as e2e/auth.mjs
// (Worker on :8788 with a fake identity provider, `npm run build` done). The old pages' drawer and dialog are tested by e2e/auth.mjs and by default.mjs (the way back). Run:  node e2e/library.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startFakeIdp } from "../../api/scripts/fake-idp.mjs";

const require = createRequire(import.meta.url);
// Injected with evaluate(), which CSP does not apply to, so the policy under test stays strict.
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.argv[2] ?? "http://localhost:8788";
const OUT = fileURLToPath(new URL("./shots/", import.meta.url));
mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "lib-ui-1", email: "meera@example.edu", email_verified: true, name: "Meera Iyer" });

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401)/.test(m.text())) errors.push("console: " + m.text()); });

async function axe(label, p = page) {
  await p.evaluate(axeSource);
  const res = await p.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(" "), msg: v.nodes[0]?.failureSummary?.split("\n")[1] }));
  });
  ok(res.length === 0, `axe [${label}]: ${res.length ? "" : "no violations"}`);
  for (const v of res) console.log(`        ${v.impact} ${v.id} x${v.nodes} ${v.sample} :: ${v.msg}`);
}
const shot = (name, p = page) => p.screenshot({ path: OUT + name + ".png" });
const rail = (p = page) => p.locator(".ws-rail");
/** The number beside Library in the rail ("0" when there is none: the rail shows it only above zero). */
const badge = async (p = page) => { const el = rail(p).locator('a[href="/library"] .ws-count'); return (await el.count()) ? (await el.first().innerText()).trim() : "0"; };
const serverLibrary = async (p = page) => (await (await p.request.get(BASE + "/api/v1/library")).json()).items ?? [];
const localLibrary = (p = page) => p.evaluate(() => JSON.parse(localStorage.getItem("scholar.library.v1") ?? "[]"));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(150); } return false; };
const results = () => page.locator(".result:not(.skeleton)");
const saveBtn = (i) => results().nth(i).getByRole("button", { name: /^(Save|Saved)$/ });
const setTheme = async (t) => { await page.evaluate((t) => { document.documentElement.setAttribute("data-theme", t); }, t); await page.waitForTimeout(500); };
const openLibrary = async () => { await rail().getByRole("link", { name: /^Library/ }).click(); await page.getByRole("heading", { level: 1, name: "Library" }).waitFor(); await page.waitForTimeout(400); };
const openSettings = async () => { await rail().getByRole("link", { name: "Settings", exact: true }).click(); await page.getByRole("heading", { level: 1, name: "Settings" }).waitFor(); await page.waitForTimeout(500); };

try {
  console.log("save while signed out (device-local)");
  await page.goto(BASE + "/?q=" + encodeURIComponent("graph neural networks"), { waitUntil: "networkidle" });
  await page.waitForFunction(() => /papers in/.test(document.querySelector(".src-summary")?.textContent ?? ""), null, { timeout: 40000 });
  await saveBtn(0).click();
  await saveBtn(1).click();
  ok((await badge()) === "2", "the number beside Library in the rail shows 2");
  ok((await localLibrary()).length === 2, "both papers are in this browser's storage");
  await openLibrary();
  ok(/Saved on this device only/.test(await page.locator(".ws-page-lead").innerText()), "the Library page says the library is device-only");
  ok(await page.locator(".ws-library .drawer-item-open").count() === 2, "and lists the two");

  console.log("sign in: device library is imported once, then cleared");
  await rail().getByRole("button", { name: /^Sign in$/ }).click();
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.locator(".ws-who").waitFor({ timeout: 15000 });
  ok(await until(async () => (await serverLibrary()).length === 2), "the 2 papers now exist on the server");
  ok(await until(async () => (await localLibrary()).length === 0), "the browser's local copy was cleared after import");
  ok(await until(async () => (await badge()) === "2"), "the number still shows 2 (now from the server)");

  console.log("sync and reload");
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".ws-who").waitFor();
  ok(await until(async () => (await badge()) === "2"), "after a reload the library still has 2 (loaded from the server)");
  await page.goto(BASE + "/?q=" + encodeURIComponent("graph neural networks"), { waitUntil: "networkidle" });
  await page.waitForFunction(() => /papers in/.test(document.querySelector(".src-summary")?.textContent ?? ""), null, { timeout: 40000 });
  await saveBtn(2).click();
  ok(await until(async () => (await serverLibrary()).length === 3), "saving a third paper reaches the server");
  await saveBtn(0).click(); // un-save
  ok(await until(async () => (await serverLibrary()).length === 2), "un-saving reaches the server");
  await openLibrary();
  ok(/Synced to your account/.test(await page.locator(".ws-page-lead").innerText()), "the Library page says the library is synced");
  await shot("30-library-synced");
  await axe("library page (signed in)");
  await page.getByRole("button", { name: /^Remove .* from library/ }).first().click();
  ok(await until(async () => (await serverLibrary()).length === 1), "removing from the Library page reaches the server");

  console.log("a retraction found after a paper was saved");
  const gone = { id: "doi:10.5555/retracted.ui", doi: "10.5555/retracted.ui", pmid: null, title: "A paper that is retracted after it was saved", authors: ["R. Writer"], year: 2024, venue: "Journal of Tests", abstract: "An abstract.", citationCount: 1, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 0.05 };
  ok((await page.request.put(`${BASE}/api/v1/library/${encodeURIComponent(gone.id)}`, { data: gone, headers: { Origin: BASE } })).ok(), "(the test saves a paper, as a search result with no mark)");
  ok((await page.request.get(`${BASE}/cdn-cgi/handler/scheduled`)).ok(), "(and runs the daily job)");
  await page.reload({ waitUntil: "networkidle" });
  const marker = rail().locator('a[href="/library"] .ws-alert');
  await marker.waitFor({ timeout: 15000 });
  ok(/1 retraction notice/.test(await rail().locator('a[href="/library"]').innerText()), "the rail's Library link carries a marker, with words for a screen reader");
  await openLibrary();
  const notice = page.getByRole("region", { name: /A paper you saved has been retracted/ });
  await notice.waitFor({ timeout: 8000 });
  ok(await notice.getByText("A paper that is retracted after it was saved").isVisible(), "the Library page says which paper, above the list");
  ok(/Retracted\./.test(await page.locator(".ws-library .drawer-item", { hasText: "retracted after it was saved" }).innerText()), "the paper in the list is marked as retracted");
  await axe("library with a retraction notice, light");
  await setTheme("dark");
  await axe("library with a retraction notice, dark");
  await setTheme("light");
  await shot("34-library-retraction");
  await notice.getByRole("button", { name: "Got it" }).click();
  await notice.waitFor({ state: "detached", timeout: 5000 });
  ok(await marker.count() === 0, "'Got it' takes the notice and the marker away");
  await page.reload({ waitUntil: "networkidle" });
  await openLibrary();
  ok(await page.getByRole("region", { name: /has been retracted/ }).count() === 0 && /Retracted\./.test(await page.locator(".ws-library .drawer-item", { hasText: "retracted after it was saved" }).innerText()), "after a reload the notice stays away, and the paper is still marked");
  await page.getByRole("button", { name: /^Remove A paper that is retracted after it was saved from library/ }).click();
  ok(await until(async () => (await serverLibrary()).length === 1), "(the test removes it again)");

  console.log("settings page");
  await openSettings();
  const set = page.locator("main");
  const txt = await set.innerText();
  ok(/Meera Iyer/.test(txt) && /meera@example\.edu/.test(txt) && /Google/.test(txt), "shows name, email and sign-in method");
  await shot("31-settings");
  await axe("settings page");
  const exportHref = await set.getByRole("link", { name: /Export my data/ }).getAttribute("href");
  const exp = await page.request.get(BASE + exportHref);
  const expJson = await exp.json();
  ok(exp.status() === 200 && expJson.library.length === 1 && expJson.account.email === "meera@example.edu", "export link downloads this user's data");

  console.log("dark theme settings (contrast of the danger zone)");
  await setTheme("dark");
  await shot("32-settings-dark");
  await axe("settings page (dark)");

  console.log("account deletion");
  const del = set.getByRole("button", { name: "Delete my account" });
  ok(await del.isDisabled(), "delete is disabled until the word is typed");
  await set.getByLabel(/Type DELETE/).fill("delete");
  ok(await del.isDisabled(), "lowercase does not unlock it");
  await set.getByLabel(/Type DELETE/).fill("DELETE");
  ok(await del.isEnabled(), "typing DELETE unlocks it");
  await del.click();
  await page.getByRole("alert").filter({ hasText: "have been deleted" }).waitFor({ timeout: 10000 });
  ok(true, "a confirmation notice is shown");
  await page.getByRole("button", { name: /^Sign in$/ }).first().waitFor({ timeout: 10000 });
  ok(true, "the UI is signed out");
  ok((await (await page.request.get(BASE + "/api/v1/auth/me")).json()).user === null, "server session is gone");
  ok((await badge()) === "0" || (await rail().count()) === 0, "the library count is 0");
  await setTheme("light");

  console.log("signing in again gives a brand-new empty account");
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  await rail().getByRole("button", { name: /^Sign in$/ }).click();
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.locator(".ws-who").waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  ok((await badge()) === "0" && (await serverLibrary()).length === 0, "nothing survived the deletion");

  console.log("mobile settings page");
  const mctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  await mp.goto(BASE + "/home", { waitUntil: "networkidle" });
  await mp.getByRole("button", { name: "Open the menu" }).click();
  await mp.getByRole("dialog").getByRole("button", { name: /^Sign in$/ }).click();
  await mp.getByRole("button", { name: "Continue with Google" }).last().click();
  await mp.getByRole("button", { name: "Open the menu" }).waitFor({ timeout: 15000 });
  await mp.waitForTimeout(1500);
  await mp.getByRole("button", { name: "Open the menu" }).click();
  await mp.getByRole("dialog").getByRole("link", { name: "Settings", exact: true }).click();
  await mp.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
  await mp.waitForTimeout(800);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!overflow, "390px: the settings page fits without horizontal scrolling");
  await mp.screenshot({ path: OUT + "33-settings-mobile.png" });
  await axe("settings page (mobile)", mp);
  await mctx.close();

  ok(errors.length === 0, `no console/page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
} finally {
  await browser.close();
  idp.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall library/settings browser checks passed");
process.exit(failures ? 1 : 0);
