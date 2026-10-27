// Browser e2e for what a person gets with nothing switched on (phase W6: the new look is the default).
// The same journeys the old pages had that are not covered by the other new-look suites: every address, the admin page and its way in, linking another
// way to sign in, checking references from the rail, and the way back to the old pages (?ws=0).
// Needs the Worker with the fake identity provider and ENABLE_DEV_ROUTES: `npm run integration -w apps/api -- --browser` starts it.
//   node e2e/default.mjs [baseUrl]    (default http://localhost:8788)
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startFakeIdp } from "../../api/scripts/fake-idp.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.argv[2] ?? "http://localhost:8788";
const OUT = fileURLToPath(new URL("./shots/default-", import.meta.url));
mkdirSync(fileURLToPath(new URL("./shots/", import.meta.url)), { recursive: true });

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "default-ui-1", email: "mira.das@example.edu", email_verified: true, name: "Mira Das" });

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
// nothing is set in this context: no flag, no stored value
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401|403|404|409)/.test(m.text())) errors.push("console: " + m.text()); });

async function axe(label, p = page) {
  await p.evaluate(axeSource);
  const res = await p.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(" "), msg: v.nodes[0]?.failureSummary?.split("\n")[1] }));
  });
  ok(res.length === 0, `axe [${label}]: ${res.length ? "" : "no violations"}`);
  for (const v of res) console.log(`        ${v.impact} ${v.id} x${v.nodes} ${v.sample} :: ${v.msg}`);
}
const setTheme = async (t) => { await page.evaluate((t) => { document.documentElement.setAttribute("data-theme", t); }, t); await page.waitForTimeout(500); };
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const railLink = (name) => page.locator(".ws-rail").getByRole("link", { name, exact: true });

try {
  /* ============================ a visitor, every address ============================ */
  console.log("a new visitor");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator("#in-h1").waitFor({ timeout: 10000 });
  ok(await page.locator(".topbar").count() === 0, "gets the new look: the intro page, with no old top bar");
  ok(/Scholar AI/.test(await page.title()), "and a title");

  const pages = [
    ["/verify", /Verify references/, "Check references"],
    ["/idea", /Idea Check/, "Idea Check"],
    ["/privacy", /Privacy/, "the privacy page"],
    ["/terms", /Terms/, "the terms"],
    ["/how-we-verify", /verif/i, "How we verify"],
  ];
  for (const [path, title, name] of pages) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.locator("main, .ws-main, #main").first().waitFor({ timeout: 10000 });
    ok(title.test(await page.title()) && await page.locator("h1").count() >= 1, `${name} opens at ${path} with its own title and a heading`);
    ok(await noSideways(page), `...and does not scroll sideways`);
  }
  await page.goto(BASE + "/admin", { waitUntil: "networkidle" });
  await page.getByText("Page not found").waitFor({ timeout: 10000 });
  ok(true, "/admin is 'Page not found' for a visitor, as before");

  /* ============================ sign in, an ordinary person ============================ */
  console.log("an ordinary person");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator("#in-h1").waitFor();
  await page.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
  await page.getByRole("button", { name: "Continue with Google" }).last().click();
  await page.locator("#hm-h").waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  ok(/Mira/.test(await page.locator(".hm-greet").innerText()), "signing in lands on the home screen, greeting by name");
  ok(await railLink("Admin").count() === 0, "the rail has no Admin entry for an ordinary person");
  await page.goto(BASE + "/admin", { waitUntil: "networkidle" });
  await page.getByText("Page not found").waitFor({ timeout: 10000 });
  ok(true, "and /admin is 'Page not found' for them too");

  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator("#hm-h").waitFor();
  await railLink("Settings").click();
  await page.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
  ok(new URL(page.url()).pathname === "/settings", "Settings opens from the rail");
  ok(/Google/.test(await page.locator(".kv").first().innerText()), "it says how the person signed in");
  const link = page.getByRole("button", { name: "Link ORCID" });
  ok(await link.isVisible(), "the other way to sign in can be linked from Settings (it could only be linked from the old account menu before)");
  await page.waitForTimeout(500);
  await axe("settings with the link button, light");
  await setTheme("dark");
  await axe("settings with the link button, dark");
  await setTheme("light");

  /* ============================ check references, from the rail ============================ */
  console.log("check references");
  await railLink("Check references").click();
  await page.getByRole("textbox", { name: "Your references" }).waitFor({ timeout: 10000 });
  ok(new URL(page.url()).pathname === "/verify" && await railLink("Check references").getAttribute("aria-current") === "page", "the rail opens it and marks it as the current page");
  await page.route("**/api/v1/references/verify", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ input: "x", status: "not_found", reason: "No matching paper was found in Crossref or OpenAlex.", confidence: 0, evidence: [] }) }));
  await page.getByRole("textbox", { name: "Your references" }).fill("Rao, P. (2019). A very specific title about regional rivers and lakes. Hydrology Today, 8, 5-9.");
  await page.getByRole("button", { name: "Verify references" }).click();
  await page.locator(".ref[data-state='done']").first().waitFor({ timeout: 10000 });
  await page.unroute("**/api/v1/references/verify");
  ok(await page.getByRole("button", { name: "Report a problem" }).first().isVisible(), "a checked reference has its 'Report a problem' button");
  await page.waitForTimeout(500);
  await axe("check references with a result, light");
  await page.screenshot({ path: OUT + "20-verify.png" });

  /* ============================ the admin ============================ */
  console.log("an admin");
  ok((await page.request.post(BASE + "/api/v1/dev/make-admin", { headers: { Origin: BASE } })).ok(), "(the test makes this person an admin)");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator("#hm-h").waitFor();
  const admin = railLink("Admin");
  await admin.waitFor({ timeout: 10000 });
  ok(true, "the rail now has an Admin entry (the old pages had it in the account menu; the new rail had none)");
  await admin.click();
  await page.getByRole("heading", { level: 1, name: "How it is going" }).waitFor({ timeout: 10000 });
  ok(new URL(page.url()).pathname === "/admin" && /Admin/.test(await page.title()), "it opens the admin page, with its own title");
  ok(await railLink("Admin").getAttribute("aria-current") === "page", "and marks Admin as the current page");
  ok(await page.locator(".ws-rail").isVisible(), "inside the new frame, not on a page of its own");
  await page.waitForTimeout(1000);
  await axe("admin in the new frame, light");
  await setTheme("dark");
  await page.waitForTimeout(500);
  await axe("admin in the new frame, dark");
  await setTheme("light");
  ok(await noSideways(page), "no sideways scroll");

  const mp = await ctx.newPage();
  await mp.setViewportSize({ width: 390, height: 844 });
  await mp.goto(BASE + "/admin", { waitUntil: "networkidle" });
  await mp.getByRole("heading", { level: 1, name: "How it is going" }).waitFor({ timeout: 10000 });
  ok(await noSideways(mp), "the admin page fits a phone");
  await mp.getByRole("button", { name: "Open the menu" }).click();
  await mp.getByRole("dialog").getByRole("link", { name: "Admin", exact: true }).waitFor({ timeout: 5000 });
  ok(true, "and the phone's menu has the Admin entry");
  await mp.close();

  /* ============================ moving about ============================ */
  console.log("moving about");
  await railLink("Library").click();
  await page.getByRole("heading", { level: 1, name: /Library/ }).waitFor({ timeout: 10000 });
  await page.goBack();
  await page.getByRole("heading", { level: 1, name: "How it is going" }).waitFor({ timeout: 10000 });
  ok(true, "Back returns to the page before");
  await page.goForward();
  await page.getByRole("heading", { level: 1, name: /Library/ }).waitFor({ timeout: 10000 });
  ok(true, "and Forward goes on again");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 1, name: /Library/ }).waitFor({ timeout: 10000 });
  ok(new URL(page.url()).pathname === "/library", "a reload stays on the same page");

  /* ============================ the way back ============================ */
  console.log("the way back");
  await page.goto(BASE + "/?ws=0", { waitUntil: "networkidle" });
  await page.locator(".topbar").waitFor({ timeout: 10000 });
  ok(await page.getByRole("button", { name: /^Account:/ }).isVisible(), "?ws=0 shows the old pages, and the person is still signed in");
  await page.getByRole("button", { name: /^Account:/ }).click();
  ok(await page.getByRole("link", { name: "Admin" }).isVisible(), "the old account menu still has its Admin entry");
  await page.keyboard.press("Escape");
  await page.goto(BASE + "/?ws=1", { waitUntil: "networkidle" });
  await page.locator("#hm-h").waitFor({ timeout: 10000 });
  ok(await page.locator(".topbar").count() === 0, "?ws=1 returns to the new look");

  ok(errors.length === 0, `no console or page errors${errors.length ? ": " + errors.slice(0, 4).join(" | ") : ""}`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  await page.screenshot({ path: OUT + "zz-failure.png" }).catch(() => {});
  failures++;
} finally {
  await browser.close();
  idp.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall default-look browser checks passed");
  process.exit(failures ? 1 : 0);
}
