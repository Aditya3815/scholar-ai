// Browser auth e2e against a Worker that runs with a FAKE identity provider (see apps/api/scripts/auth-e2e.mjs for the
// wrangler command). Needs `npm run build` first because the Worker serves apps/web/dist.
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

const browser = await chromium.launch({ channel: "msedge", headless: true });
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
const signInBtn = () => page.getByRole("button", { name: /^Sign in$/ });
const account = () => page.getByRole("button", { name: /^Account:/ });

try {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await signInBtn().waitFor({ timeout: 10000 });
  ok(true, "anonymous visitor sees a Sign in button (providers are configured)");
  await shot("20-auth-anon");

  // Modal
  await signInBtn().click();
  const dialog = page.getByRole("dialog", { name: /Sign in to Scholar/ });
  await dialog.waitFor();
  await page.waitForTimeout(500);
  ok(await dialog.getByRole("button", { name: "Continue with Google" }).isVisible(), "modal offers Continue with Google");
  ok(await dialog.getByRole("button", { name: "Continue with ORCID" }).isVisible(), "modal offers Continue with ORCID");
  ok(/never used to train AI/.test(await dialog.innerText()), "modal states the privacy promise");
  await shot("21-signin-modal");
  await axe("sign-in modal");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  ok(await signInBtn().evaluate((el) => el === document.activeElement), "Escape closes the modal and returns focus to the trigger");

  // Sign in from a results URL: query must survive the round trip
  await page.goto(BASE + "?q=" + encodeURIComponent("graph neural networks"), { waitUntil: "networkidle" });
  await signInBtn().click();
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await account().waitFor({ timeout: 15000 });
  ok(page.url().includes("q=graph+neural+networks") || page.url().includes("q=graph%20neural%20networks"), `returned to the same search (${page.url().replace(BASE, "")})`);
  ok(!page.url().includes("auth_error"), "no auth error in the URL");
  await page.waitForFunction(() => /papers in/.test(document.querySelector(".src-summary")?.textContent ?? ""), null, { timeout: 40000 });
  await page.waitForTimeout(1000);
  await shot("22-signed-in-results");

  // Account menu
  await account().click();
  const menu = page.getByRole("dialog", { name: "Account" });
  await menu.waitFor();
  await page.waitForTimeout(400);
  const txt = await menu.innerText();
  ok(/Asha Rao/.test(txt) && /asha\.rao@example\.edu/.test(txt), "account menu shows name and email");
  ok(await menu.getByRole("button", { name: /Link ORCID/ }).isVisible(), "offers to link ORCID");
  await shot("23-account-menu");
  await axe("account menu");

  // Link ORCID
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle", timeout: 20000 }), menu.getByRole("button", { name: /Link ORCID/ }).click()]);
  await account().waitFor({ timeout: 15000 });
  await account().click();
  const menu2 = page.getByRole("dialog", { name: "Account" });
  await menu2.waitFor();
  const txt2 = await menu2.innerText();
  ok(/0000-0002-1825-0097/.test(txt2) && !/Link ORCID/.test(txt2), "ORCID linked: iD shown and the link button is gone");

  // Sign out
  await menu2.getByRole("button", { name: /Sign out/ }).click();
  await signInBtn().waitFor({ timeout: 10000 });
  ok(true, "sign out returns to the anonymous state");
  const me = await (await page.request.get(BASE + "/api/v1/auth/me")).json();
  ok(me.user === null, "server session is gone after sign out");

  // Error banner
  await page.goto(BASE + "?auth_error=denied", { waitUntil: "networkidle" });
  const alert = page.getByRole("alert").filter({ hasText: "cancelled" });
  await alert.waitFor();
  ok(!page.url().includes("auth_error"), "auth_error is removed from the URL");
  await shot("24-auth-error");
  await axe("auth error banner");
  await alert.getByRole("button", { name: "Dismiss" }).click();
  await alert.waitFor({ state: "hidden", timeout: 3000 });
  ok(true, "banner can be dismissed");

  // Mobile layouts: header must fit, and nothing overflows horizontally
  for (const width of [390, 360]) {
    const mctx = await browser.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const mp = await mctx.newPage();
    await mp.goto(BASE, { waitUntil: "networkidle" });
    await mp.waitForTimeout(1800);
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    const box = await mp.getByRole("button", { name: /^Sign in$/ }).boundingBox();
    ok(!overflow && box && box.x + box.width <= width, `${width}px: no horizontal overflow, Sign in fully visible (right edge ${Math.round((box?.x ?? 0) + (box?.width ?? 0))}px)`);
    await mp.screenshot({ path: OUT + `25-mobile-${width}.png` });
    if (width === 390) {
      await mp.getByRole("button", { name: /^Sign in$/ }).click();
      await mp.getByRole("dialog", { name: /Sign in to Scholar/ }).waitFor();
      await mp.waitForTimeout(500);
      await mp.screenshot({ path: OUT + "26-mobile-modal.png" });
      await axe("mobile sign-in modal", mp);
    }
    await mctx.close();
  }
  ok(errors.length === 0, `no console/page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
} finally {
  await browser.close();
  idp.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall browser auth checks passed");
process.exit(failures ? 1 : 0);
