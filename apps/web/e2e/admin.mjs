// Browser e2e: the admin page (who may see it, what it shows, removing a report), and the "Report a problem" form on a reference.
// Needs the Worker with the fake identity provider and ENABLE_DEV_ROUTES (`npm run integration -w apps/api -- --browser` starts it).
//   node e2e/admin.mjs [baseUrl]    (default http://localhost:8788)
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startFakeIdp } from "../../api/scripts/fake-idp.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.argv[2] ?? "http://localhost:8788";
const OUT = fileURLToPath(new URL("./shots/", import.meta.url));
mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "admin-ui-1", email: "ops@example.edu", email_verified: true, name: "Ops Person" });

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401|404)/.test(m.text())) errors.push("console: " + m.text()); });

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

try {
  console.log("signed out and ordinary users");
  await page.goto(BASE + "/admin", { waitUntil: "networkidle" });
  await page.getByText("Page not found").waitFor();
  ok(true, "a signed-out visitor sees 'Page not found', not an admin page");

  await page.goto(BASE + "/verify", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByRole("button", { name: /^Account:/ }).waitFor({ timeout: 15000 });

  await page.goto(BASE + "/admin", { waitUntil: "networkidle" });
  await page.getByText("Page not found").waitFor();
  ok(true, "so does an ordinary signed-in user");
  await page.getByRole("button", { name: /^Account:/ }).click();
  ok((await page.getByRole("link", { name: "Admin" }).count()) === 0, "...and the account menu has no Admin entry for them");
  await page.keyboard.press("Escape");

  console.log("report a reference verdict");
  await page.goto(BASE + "/verify", { waitUntil: "networkidle" });
  await page.route("**/api/v1/references/verify", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ input: "x", status: "not_found", reason: "No matching paper was found in Crossref or OpenAlex.", confidence: 0, match: null, checks: null }) }));
  await page.getByRole("textbox", { name: "Your references" }).fill("Rao, P. (2019). A very specific title about regional rivers and lakes. Hydrology Today, 8, 5-9.");
  await page.getByRole("button", { name: "Verify references" }).click();
  await page.locator(".ref[data-state='done']").first().waitFor({ timeout: 10000 });
  await page.unroute("**/api/v1/references/verify");
  await page.getByRole("button", { name: "Report a problem" }).first().click();
  const pop = page.getByRole("dialog", { name: "Report a problem" });
  await pop.waitFor();
  await page.waitForTimeout(500);
  ok(await pop.getByText(/sends the reference text, our verdict on it/).isVisible(), "the form says what is sent");
  await pop.getByRole("radio", { name: /real, but it was not verified/ }).check();
  await pop.getByRole("textbox", { name: /Tell us more/ }).fill("This is in a regional journal");
  await pop.getByRole("button", { name: "Send report" }).click();
  await pop.getByText(/Thank you/).waitFor({ timeout: 8000 });
  ok(true, "the report is sent");
  await page.waitForTimeout(1800);

  console.log("the admin page");
  ok((await page.request.post(BASE + "/api/v1/dev/make-admin", { headers: { Origin: BASE } })).ok(), "(the test makes this user an admin)");
  await page.goto(BASE + "/admin", { waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 1, name: "How it is going" }).waitFor();
  await page.waitForTimeout(1000);
  ok(/Admin/.test(await page.title()), "the page has its own title");
  ok((await page.locator(".admin-stat").count()) === 3, "it shows people, papers and questions");
  ok(/\b1\b/.test(await page.locator(".admin-stat").first().innerText()), "the people count is right");
  const reports = page.locator(".admin-report");
  ok((await reports.count()) === 1, "the report that was just sent is listed");
  ok(/not verified/.test(await reports.first().innerText()) && /regional journal/.test(await reports.first().innerText()), "...with the problem and the note");
  await reports.first().locator("summary").click();
  ok(/Hydrology Today/.test(await reports.first().locator(".admin-report-ctx").innerText()), "...and what was sent");
  const body = await page.locator(".admin").innerText();
  ok(!/ops@example\.edu/.test(body), "no e-mail address on the page");
  await page.getByRole("button", { name: "Send a test event" }).click();
  await page.getByText(/Not set up yet/).waitFor({ timeout: 8000 });
  ok(true, "the error-reporting check says plainly that it is not set up while there is no Sentry address");
  await shot("80-admin");
  await axe("admin");
  await setTheme("Dark"); await shot("81-admin-dark"); await axe("admin, dark"); await setTheme("Light");

  await page.getByRole("button", { name: /^Account:/ }).click();
  ok((await page.getByRole("link", { name: "Admin" }).count()) === 1, "an admin has the Admin entry in the account menu");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: /^Remove this reference report/ }).click();
  await page.locator(".admin-report").waitFor({ state: "detached", timeout: 8000 });
  ok(true, "a handled report can be removed");

  const mp = await ctx.newPage();
  await mp.setViewportSize({ width: 390, height: 800 });
  await mp.goto(BASE + "/admin", { waitUntil: "networkidle" });
  await mp.getByRole("heading", { level: 1, name: "How it is going" }).waitFor();
  await mp.waitForTimeout(900);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `no horizontal scrolling on a phone (${overflow}px)`);
  await mp.close();

  ok(errors.length === 0, `no console/page errors${errors.length ? ": " + errors.join(" | ").slice(0, 500) : ""}`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
}
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall admin browser checks passed");
process.exit(failures ? 1 : 0);
