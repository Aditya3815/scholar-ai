// Browser e2e: library sync, settings, data export and account deletion. Same setup as e2e/auth.mjs (Worker on :8788 with
// a fake identity provider, `npm run build` done). Run:  node e2e/library.mjs [baseUrl]
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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
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
const badge = (p = page) => p.locator(".lib-trigger .count-badge").innerText();
const serverLibrary = async (p = page) => (await (await p.request.get(BASE + "/api/v1/library")).json()).items ?? [];
const localLibrary = (p = page) => p.evaluate(() => JSON.parse(localStorage.getItem("scholar.library.v1") ?? "[]"));
const until = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(150); } return false; };
const results = () => page.locator(".result:not(.skeleton)");
const saveBtn = (i) => results().nth(i).getByRole("button", { name: /^(Save|Saved)$/ });

try {
  console.log("save while signed out (device-local)");
  await page.goto(BASE + "?q=" + encodeURIComponent("graph neural networks"), { waitUntil: "networkidle" });
  await page.waitForFunction(() => /papers in/.test(document.querySelector(".src-summary")?.textContent ?? ""), null, { timeout: 40000 });
  await saveBtn(0).click();
  await saveBtn(1).click();
  ok((await badge()) === "2", "library badge shows 2");
  ok((await localLibrary()).length === 2, "both papers are in this browser's storage");
  await page.getByRole("button", { name: /^Library, 2 saved/ }).click();
  await page.waitForTimeout(500);
  ok(/Saved on this device only/.test(await page.locator(".drawer-note").innerText()), "drawer says the library is device-only");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  console.log("sign in: device library is imported once, then cleared");
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByRole("button", { name: /^Account:/ }).waitFor({ timeout: 15000 });
  ok(await until(async () => (await serverLibrary()).length === 2), "the 2 papers now exist on the server");
  ok(await until(async () => (await localLibrary()).length === 0), "the browser's local copy was cleared after import");
  ok((await badge()) === "2", "badge still shows 2 (now from the server)");

  console.log("sync and reload");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^Account:/ }).waitFor();
  ok(await until(async () => (await badge()) === "2"), "after a reload the library still has 2 (loaded from the server)");
  await page.waitForFunction(() => /papers in/.test(document.querySelector(".src-summary")?.textContent ?? ""), null, { timeout: 40000 });
  await saveBtn(2).click();
  ok(await until(async () => (await serverLibrary()).length === 3), "saving a third paper reaches the server");
  await saveBtn(0).click(); // un-save
  ok(await until(async () => (await serverLibrary()).length === 2), "un-saving reaches the server");
  await page.getByRole("button", { name: /^Library, 2 saved/ }).click();
  await page.waitForTimeout(500);
  ok(/Synced to your account/.test(await page.locator(".drawer-note").innerText()), "drawer says the library is synced");
  await shot("30-library-synced");
  await axe("library drawer (signed in)");
  await page.getByRole("button", { name: /^Remove .* from library/ }).first().click();
  ok(await until(async () => (await serverLibrary()).length === 1), "removing from the drawer reaches the server");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  console.log("settings dialog");
  await page.getByRole("button", { name: /^Account:/ }).click();
  await page.getByRole("button", { name: /Settings and data/ }).click();
  const dlg = page.getByRole("dialog", { name: "Account settings" });
  await dlg.waitFor();
  await page.waitForTimeout(500);
  const txt = await dlg.innerText();
  ok(/Meera Iyer/.test(txt) && /meera@example\.edu/.test(txt) && /Google/.test(txt), "shows name, email and sign-in method");
  await shot("31-settings");
  await axe("settings dialog");
  const exportHref = await dlg.getByRole("link", { name: /Export my data/ }).getAttribute("href");
  const exp = await page.request.get(BASE + exportHref);
  const expJson = await exp.json();
  ok(exp.status() === 200 && expJson.library.length === 1 && expJson.account.email === "meera@example.edu", "export link downloads this user's data");

  console.log("dark theme settings (contrast of the danger zone)");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Dark theme" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /^Account:/ }).click();
  await page.getByRole("button", { name: /Settings and data/ }).click();
  await dlg.waitFor();
  await page.waitForTimeout(500);
  await shot("32-settings-dark");
  await axe("settings dialog (dark)");

  console.log("account deletion");
  const del = dlg.getByRole("button", { name: "Delete my account" });
  ok(await del.isDisabled(), "delete is disabled until the word is typed");
  await dlg.getByLabel(/Type DELETE/).fill("delete");
  ok(await del.isDisabled(), "lowercase does not unlock it");
  await dlg.getByLabel(/Type DELETE/).fill("DELETE");
  ok(await del.isEnabled(), "typing DELETE unlocks it");
  await del.click();
  await page.getByRole("alert").filter({ hasText: "have been deleted" }).waitFor({ timeout: 10000 });
  ok(true, "a confirmation notice is shown");
  await page.getByRole("button", { name: /^Sign in$/ }).waitFor();
  ok(true, "the UI is signed out");
  ok((await (await page.request.get(BASE + "/api/v1/auth/me")).json()).user === null, "server session is gone");
  ok((await badge()) === "0", "library badge is 0");
  await page.getByRole("button", { name: "Light theme" }).click();

  console.log("signing in again gives a brand-new empty account");
  await page.getByRole("button", { name: /^Sign in$/ }).click();
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByRole("button", { name: /^Account:/ }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  ok((await badge()) === "0" && (await serverLibrary()).length === 0, "nothing survived the deletion");

  console.log("mobile settings dialog");
  const mctx = await browser.newContext({ viewport: { width: 390, height: 780 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  await mp.goto(BASE, { waitUntil: "networkidle" });
  await mp.getByRole("button", { name: /^Sign in$/ }).click();
  await mp.getByRole("button", { name: "Continue with Google" }).click();
  await mp.getByRole("button", { name: /^Account:/ }).waitFor({ timeout: 15000 });
  await mp.getByRole("button", { name: /^Account:/ }).click();
  await mp.getByRole("button", { name: /Settings and data/ }).click();
  const mdlg = mp.getByRole("dialog", { name: "Account settings" });
  await mdlg.waitFor();
  await mp.waitForTimeout(600);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const fits = await mdlg.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  ok(!overflow && fits, "390px: settings dialog fits without horizontal scrolling");
  await mp.screenshot({ path: OUT + "33-settings-mobile.png" });
  await axe("settings dialog (mobile)", mp);
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
