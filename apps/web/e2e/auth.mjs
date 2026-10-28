// Browser auth e2e against a Worker that runs with a FAKE identity provider (see apps/api/scripts/auth-e2e.mjs for the
// wrangler command). Needs `npm run build` first because the Worker serves apps/web/dist.
// What it checks: the way in for a visitor (the intro page's header and the rail), the sign-in dialog (words, axe, Escape and focus), coming back to the same search, linking
// the other way to sign in, signing out (the server's session is gone), the banner after a refused sign-in, and a phone's width.
//   node e2e/auth.mjs [baseUrl]    (default http://localhost:8788)
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
idp.setUser({ sub: "ui-1", email: "asha.rao@example.edu", email_verified: true, name: "Asha Rao" });

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

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
/** The intro page's header button (a visitor's way in at "/"). */
const introSignIn = (p = page) => p.locator(".in-head").getByRole("button", { name: /^Sign in$/ });
/** The rail's button (everywhere else a visitor goes). */
const railSignIn = (p = page) => p.locator(".ws-anon").getByRole("button", { name: /^Sign in$/ });
const who = () => page.locator(".ws-who");

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await introSignIn().waitFor({ timeout: 15000 });
  ok(true, "a visitor sees a Sign in button on the intro page (providers are configured)");
  await shot("20-auth-anon");

  // The dialog
  await introSignIn().click();
  const dialog = page.getByRole("dialog", { name: /Sign in to Scholar/ });
  await dialog.waitFor();
  await page.waitForTimeout(500);
  ok(await dialog.getByRole("button", { name: "Continue with Google" }).isVisible(), "the dialog offers Continue with Google");
  ok(await dialog.getByRole("button", { name: "Continue with ORCID" }).isVisible(), "the dialog offers Continue with ORCID");
  ok(/never used to train AI/.test(await dialog.innerText()), "the dialog states the privacy promise");
  await shot("21-signin-modal");
  await axe("sign-in dialog");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  ok(await introSignIn().evaluate((el) => el === document.activeElement), "Escape closes the dialog and returns focus to the button that opened it");

  // The rail's button, on a page that is not the intro
  await page.goto(BASE + "/privacy", { waitUntil: "networkidle" });
  await railSignIn().waitFor({ timeout: 10000 });
  ok(true, "a visitor on any other page has Sign in in the rail");

  // Sign in from a search: the search must survive the round trip
  await page.goto(BASE + "/?q=" + encodeURIComponent("graph neural networks"), { waitUntil: "networkidle" });
  await railSignIn().click();
  await page.getByRole("button", { name: "Continue with Google" }).last().click();
  await who().waitFor({ timeout: 20000 });
  ok(page.url().includes("q=graph+neural+networks") || page.url().includes("q=graph%20neural%20networks"), `returned to the same search (${page.url().replace(BASE, "")})`);
  ok(!page.url().includes("auth_error"), "no auth error in the URL");
  await page.waitForFunction(() => /papers in/.test(document.querySelector(".src-summary")?.textContent ?? ""), null, { timeout: 40000 });
  await page.waitForTimeout(1000);
  await shot("22-signed-in-results");

  // The rail says who is signed in
  const whoText = await who().innerText();
  ok(/Asha Rao/.test(whoText) && /asha\.rao@example\.edu/.test(whoText), "the rail shows the name and the e-mail");
  await shot("23-rail-signed-in");
  await axe("signed in, results");

  // Linking the other way to sign in lives in Settings
  await page.goto(BASE + "/settings", { waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
  const link = page.getByRole("button", { name: /Link ORCID/ });
  ok(await link.isVisible(), "Settings offers to link ORCID");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle", timeout: 20000 }), link.click()]);
  await who().waitFor({ timeout: 15000 });
  await page.getByRole("heading", { level: 1, name: "Settings" }).waitFor({ timeout: 15000 });
  await page.getByText("0000-0002-1825-0097").waitFor({ timeout: 10000 }).catch(() => {});
  const settingsText = await page.locator("main").innerText();
  ok(/0000-0002-1825-0097/.test(settingsText) && !/Link ORCID/.test(settingsText), "ORCID linked: the iD is shown and the link button is gone");

  // Sign out
  await who().getByRole("button", { name: "Sign out" }).click();
  await railSignIn().waitFor({ timeout: 10000 });
  ok(true, "signing out returns to the visitor's state");
  const me = await (await page.request.get(BASE + "/api/v1/auth/me")).json();
  ok(me.user === null, "the server's session is gone after signing out");

  // Error banner
  await page.goto(BASE + "/?auth_error=denied", { waitUntil: "networkidle" });
  const alert = page.getByRole("alert").filter({ hasText: "cancelled" });
  await alert.waitFor();
  ok(!page.url().includes("auth_error"), "auth_error is removed from the address");
  await shot("24-auth-error");
  await axe("the banner after a refused sign-in");
  await alert.getByRole("button", { name: "Dismiss" }).click();
  await alert.waitFor({ state: "hidden", timeout: 3000 });
  ok(true, "the banner can be dismissed");

  // A phone's width: the header must fit, and nothing overflows sideways
  for (const width of [390, 360]) {
    const mctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const mp = await mctx.newPage();
    await mp.goto(BASE, { waitUntil: "networkidle" });
    await introSignIn(mp).waitFor({ timeout: 15000 });
    await mp.waitForTimeout(800);
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const box = await introSignIn(mp).boundingBox();
    ok(!overflow && box && box.x >= 0 && box.x + box.width <= width, `${width}px: no sideways overflow, Sign in fully visible (right edge ${Math.round((box?.x ?? 0) + (box?.width ?? 0))}px)`);
    await mp.screenshot({ path: OUT + `25-mobile-${width}.png` });
    if (width === 390) {
      await introSignIn(mp).click();
      await mp.getByRole("dialog", { name: /Sign in to Scholar/ }).waitFor();
      await mp.waitForTimeout(500);
      await mp.screenshot({ path: OUT + "26-mobile-modal.png" });
      await axe("the sign-in dialog on a phone", mp);
    }
    await mctx.close();
  }
  ok(errors.length === 0, `no console or page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
} finally {
  await browser.close();
  idp.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall browser auth checks passed");
process.exit(failures ? 1 : 0);
