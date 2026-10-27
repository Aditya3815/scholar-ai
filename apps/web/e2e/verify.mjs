// Reference Verifier UI. The verify endpoint is mocked so the checks are deterministic (the real endpoint is covered by
// unit tests and by the live eval); set VERIFY_LIVE=1 to hit the real service instead and only take screenshots.
//   node e2e/verify.mjs [baseUrl]       (default http://localhost:8787)
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// Injected with evaluate(), which CSP does not apply to, so the policy under test stays strict.
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.argv[2] ?? "http://localhost:8787";
const LIVE = process.env.VERIFY_LIVE === "1";
const OUT = fileURLToPath(new URL("./shots/", import.meta.url));
mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

const rec = (title, authors, year, doi) => ({ doi, title, authors, year, venue: "Nature" });
const VERDICTS = [
  { when: "Watson", status: "verified", reason: "Matches “Molecular structure of nucleic acids” by J. D. Watson et al. (1953).", match: rec("Molecular structure of nucleic acids", ["J. D. Watson", "F. H. C. Crick"], 1953, "10.1038/171737a0"), checks: { title: 1, author: true, year: true } },
  { when: "Wakefield", status: "verified", retracted: true, reason: "Matches “Ileal-lymphoid-nodular hyperplasia” by A. J. Wakefield et al. (1998).", match: rec("Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children", ["A. J. Wakefield"], 1998, "10.1016/s0140-6736(97)11096-0"), checks: { title: 1, author: true, year: true } },
  { when: "Kumar, V.", status: "mismatch", reason: "A real paper with a very similar title exists: “Deep learning” by Yann LeCun et al. (2015), but the authors do not match.", match: rec("Deep learning", ["Yann LeCun", "Yoshua Bengio", "Geoffrey Hinton"], 2015, "10.1038/nature14539"), checks: { title: 1, author: false, year: true } },
  { when: "Sharma, R.", status: "not_found", reason: "No paper matching this title, authors and year was found in Crossref.", match: null, checks: { title: 0.4, author: false, year: null } },
  { when: "Offline", status: "unverifiable", reason: "We could not reach the reference databases just now, so this was not checked. Please try again.", match: null, checks: null },
];
const REFS = [
  "[1] Watson, J. D., & Crick, F. H. C. (1953). Molecular structure of nucleic acids. Nature, 171, 737–738.",
  "[2] Wakefield, A. J., et al. (1998). Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children. The Lancet, 351, 637–641.",
  "[3] Kumar, V., & Iyer, S. (2015). Deep learning. Nature, 521, 436–444.",
  "[4] Sharma, R., & Mehta, K. (2022). Quantum-inspired blockchain consensus for rural healthcare records in India. Journal of Distributed Health Systems, 14(3), 211–229.",
  "[5] Offline, T. (2020). A reference the databases cannot be reached for. Journal of Examples, 1, 1–2.",
  "[6] x",
];

const calls = [];
let offlineOk = false;
if (!LIVE) {
  await page.route("**/api/v1/references/verify", async (route) => {
    const { reference } = route.request().postDataJSON();
    calls.push(reference);
    await new Promise((r) => setTimeout(r, 250 + Math.random() * 350));
    const v = VERDICTS.find((x) => reference.includes(x.when));
    if (reference.includes("Offline") && offlineOk) {
      return route.fulfill({ json: { ...VERDICTS[0], input: reference, confidence: 1, reason: "Matches a real record." } });
    }
    if (!v) return route.fulfill({ json: { input: reference, status: "unparsed", reason: "This does not look like a full reference. Paste the whole entry (authors, title, journal, year).", confidence: 0, match: null, checks: null } });
    return route.fulfill({ json: { ...v, input: reference, confidence: v.status === "verified" ? 1 : 0.5, cached: false } });
  });
}

const countText = async () => ((await page.locator(".vin-count").textContent()) ?? "").replace(/\s+/g, " ").trim();

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
const setTheme = async (label) => { await page.getByRole("button", { name: `${label} theme` }).click(); await page.waitForTimeout(500); };

try {
  /* ---------- navigation ---------- */
  console.log("navigation");
  const rail = page.locator(".ws-rail");
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  await rail.getByRole("link", { name: "Check references", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: /Is every reference/ }).waitFor();
  ok(new URL(page.url()).pathname === "/verify", "the rail goes to /verify without a reload");
  ok((await rail.getByRole("link", { name: "Check references", exact: true }).getAttribute("aria-current")) === "page", "and marks it as the current page");
  ok((await page.title()).startsWith("Verify references"), "document title follows the page");
  await rail.getByRole("link", { name: "Home", exact: true }).click();
  await page.locator(".hm-box").waitFor();
  await page.goBack();
  await page.getByRole("heading", { level: 1, name: /Is every reference/ }).waitFor();
  ok(true, "browser Back returns to the references page");
  await page.goForward();
  await page.locator(".hm-box").waitFor();
  ok(true, "and Forward goes on to Home");
  await page.goBack();
  await page.getByRole("heading", { level: 1, name: /Is every reference/ }).waitFor();
  await page.goto(BASE + "/verify", { waitUntil: "networkidle" });
  ok(await page.getByRole("heading", { level: 1, name: /Is every reference/ }).isVisible(), "/verify opens directly (deep link)");
  await page.waitForTimeout(1800);
  await shot("40-verify-idle-light");
  await axe("verify idle, light");
  await setTheme("Dark"); await shot("41-verify-idle-dark"); await axe("verify idle, dark");
  await setTheme("Read"); await axe("verify idle, read");
  await setTheme("Light");

  /* ---------- input ---------- */
  console.log("input");
  const box = page.getByLabel("Your references");
  ok(/Nothing detected yet/.test(await countText()), "count starts at nothing");
  ok(await page.getByRole("button", { name: /Verify references/ }).isDisabled(), "verify button is disabled with no input");
  await page.getByRole("button", { name: "Try an example" }).click();
  await page.waitForTimeout(200);
  ok(/4 references detected/.test(await countText()), "the example is split into 4 references");
  await box.fill("");
  await box.fill(REFS.join("\n"));
  await page.waitForTimeout(150);
  ok(/6 references detected/.test(await countText()), `numbered list split into 6 (${await countText()})`);
  await box.fill("@article{a,\n title={Deep learning},\n author={LeCun, Yann and Bengio, Yoshua},\n year={2015},\n journal={Nature}\n}\n@article{b,\n title={Attention is all you need},\n author={Vaswani, Ashish},\n year={2017}\n}");
  await page.waitForTimeout(150);
  ok(/2 references detected/.test(await countText()), "BibTeX is converted into 2 references");
  await box.fill(REFS.join("\n"));

  /* ---------- run ---------- */
  console.log("verify a list");
  await box.press("Control+Enter");
  await page.getByRole("progressbar", { name: "Progress" }).waitFor();
  ok(await page.locator(".ref").first().isVisible(), "all reference cards appear straight away (queued)");
  await page.waitForTimeout(500);
  await shot("42-verify-running");
  if (!LIVE) {
    await page.locator(".vsum-headline").filter({ hasText: /references checked/ }).waitFor({ timeout: 20000 });
    ok(calls.length === 6, `one request per reference (${calls.length})`);
    const cards = page.locator(".ref");
    const statusText = async (i) => (await cards.nth(i).locator(".ref-status").innerText()).trim();
    ok((await statusText(0)) === "Verified", "[1] Verified");
    ok((await statusText(1)) === "Verified" && (await cards.nth(1).getByText("This paper has been retracted").isVisible()), "[2] Verified and flagged as retracted");
    ok((await statusText(2)) === "Details don’t match" && (await cards.nth(2).getByText("Closest real record").isVisible()), "[3] mismatch shows the closest real record");
    ok((await statusText(3)) === "Not found" && (await cards.nth(3).getByText(/not in Crossref/).isVisible()), "[4] not found explains why it can happen for real papers");
    ok((await statusText(4)) === "Could not verify", "[5] outage is 'could not verify', never 'not found'");
    ok((await statusText(5)) === "Not a full reference", "[6] a fragment is not a full reference");
    ok(await cards.nth(0).getByRole("button", { name: "Cite" }).isVisible(), "matched record has a Cite menu");
    ok(!(await cards.nth(3).getByRole("button", { name: "Cite" }).isVisible()), "a not-found reference has no Cite menu");
    ok(/2 references in your list|1 reference in your list has been retracted/.test(await page.locator(".vsum-retract").innerText()), "summary calls out the retraction");
    const sum = await page.locator(".vsum-headline").innerText();
    ok(/6 references checked/.test(sum), `summary: ${sum.trim()}`);

    // preview of the matched record
    await cards.nth(2).getByRole("button", { name: "Preview record" }).click();
    const pv = page.getByRole("dialog");
    await pv.waitFor();
    await page.waitForTimeout(500);
    ok(/Deep learning/.test(await pv.locator(".pv-title").innerText()) && (await pv.getByText(/Yann LeCun/).isVisible()), "Preview record shows the closest real paper");
    ok(await pv.getByText(/None of our sources has an abstract/).isVisible(), "...and says plainly that a verifier record has no abstract");
    await page.keyboard.press("Escape");
    await pv.waitFor({ state: "detached" });

    // filters
    await page.getByRole("button", { name: /Needs attention/ }).click();
    await page.waitForTimeout(500);
    const n = await page.locator(".ref").count();
    ok(n === 2, `'Needs attention' filter shows the mismatch and the not-found (${n} shown)`);
    await shot("43-verify-filtered");
    await page.getByRole("button", { name: /^All/ }).click();
    await page.waitForTimeout(400);
    ok((await page.locator(".ref").count()) === 6, "'All' restores the list");

    // report
    const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download report/ }).click()]);
    const csv = readFileSync(await dl.path(), "utf8");
    ok(dl.suggestedFilename() === "reference-check.csv" && csv.startsWith("﻿\"#\",\"Status\"") && csv.split("\r\n").length === 8, "CSV has a header and one row per reference");
    ok(/"Not found"/.test(csv) && /"Details don’t match"/.test(csv) && /"yes"/.test(csv), "CSV carries statuses and the retraction flag");

    // re-check an outage
    offlineOk = true;
    await page.locator(".ref").nth(4).getByRole("button", { name: "Check again" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".ref")[4]?.querySelector(".ref-status")?.textContent === "Verified", null, { timeout: 15000 });
    ok(true, "'Check again' re-runs just that reference and it now verifies");

    await page.waitForTimeout(900); // let the layout spring settle before the screenshot
    await axe("verify results, light");
    await shot("44-verify-results-light");
    await setTheme("Dark"); await shot("45-verify-results-dark"); await axe("verify results, dark");
    await setTheme("Read"); await shot("46-verify-results-read"); await axe("verify results, read");
    await setTheme("Light");

    // clear
    await page.getByRole("button", { name: "Clear" }).click();
    await page.waitForTimeout(300);
    ok((await page.locator(".ref").count()) === 0 && (await box.inputValue()) === "", "Clear empties the list and the results");

    // a draft survives a reload, within the tab only
    await box.fill(REFS[2]);
    await page.reload({ waitUntil: "networkidle" });
    ok((await page.getByLabel("Your references").inputValue()) === REFS[2], "the draft survives a reload (this tab only)");
    await page.getByRole("button", { name: "Clear" }).click();
  } else {
    await page.locator(".vsum-headline").filter({ hasText: /checked/ }).waitFor({ timeout: 60000 });
    await page.waitForTimeout(1200);
    await shot("44-verify-results-live");
  }

  /* ---------- responsive ---------- */
  console.log("responsive");
  for (const [w, h] of [[375, 812], [768, 1024], [1024, 768], [1440, 900]]) {
    const p = await ctx.newPage();
    if (!LIVE) await p.route("**/api/v1/references/verify", async (route) => {
      const { reference } = route.request().postDataJSON();
      const v = VERDICTS.find((x) => reference.includes(x.when));
      await route.fulfill({ json: v ? { ...v, input: reference, confidence: 1 } : { input: reference, status: "unparsed", reason: "This does not look like a full reference.", confidence: 0, match: null, checks: null } });
    });
    await p.setViewportSize({ width: w, height: h });
    await p.goto(BASE + "/verify", { waitUntil: "networkidle" });
    await p.waitForTimeout(1500);
    await p.getByLabel("Your references").fill(REFS.join("\n"));
    await p.getByRole("button", { name: /Verify references/ }).click();
    await p.locator(".vsum-headline").filter({ hasText: /checked/ }).waitFor({ timeout: 30000 });
    await p.waitForTimeout(900);
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    ok(!overflow, `${w}px: no horizontal overflow`);
    const nav = await p.locator(".ws-menu-btn:visible, .ws-rail:visible").first().boundingBox();
    ok(!!nav && nav.x >= 0 && nav.x + nav.width <= w, `${w}px: the menu (or the rail) is fully visible`);
    await p.evaluate(() => window.scrollTo(0, 0));
    await shot(`47-verify-${w}`, p);
    if (w === 375) {
      await axe("verify results, 375px", p);
      await p.evaluate(() => window.scrollTo(0, document.querySelector(".vresults").offsetTop - 120));
      await p.waitForTimeout(300);
      await shot("48-verify-375-results", p);
      const top = await p.locator(".vsum").boundingBox();
      ok(!!top && top.height < 400, `375px: summary is compact and not pinned over the list (${top?.height?.toFixed(0)}px tall)`);
    }
    if (w >= 768) {
      await p.evaluate(() => window.scrollTo(0, document.querySelector(".vresults").offsetTop + 700));
      await p.waitForTimeout(300);
      const pinned = await p.locator(".vsum").boundingBox();
      ok(!!pinned && pinned.y >= 0 && pinned.y < 120, `${w}px: progress and filters stay pinned while scrolling (y=${pinned?.y?.toFixed(0)})`);
    }
    await p.close();
  }

  ok(errors.length === 0, `no console/page errors${errors.length ? ": " + errors.join(" | ").slice(0, 400) : ""}`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
}
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall verifier browser checks passed");
process.exit(failures ? 1 : 0);
