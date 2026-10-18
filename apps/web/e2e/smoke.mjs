import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
const BASE = process.argv[2] ?? "http://localhost:8787";
const OUT = fileURLToPath(new URL("./shots/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

async function axe(label) {
  await page.addScriptTag({ path: axePath });
  const res = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(" "), msg: v.nodes[0]?.failureSummary?.split("\n")[1] }));
  });
  console.log(`axe [${label}]: ${res.length ? "" : "no violations"}`);
  for (const v of res) console.log(`   ${v.impact} ${v.id} x${v.nodes} ${v.sample} :: ${v.msg}`);
  return res;
}
const shot = (name) => page.screenshot({ path: OUT + name + ".png" });
const setTheme = async (label) => { await page.getByRole("button", { name: `${label} theme` }).click(); await page.waitForTimeout(700); };

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(2200); // hero animations settle
await shot("01-home-light");
await axe("home-light");

await setTheme("Dark"); await shot("02-home-dark"); await axe("home-dark");
await setTheme("Read"); await shot("03-home-read"); await axe("home-read");
await setTheme("Light");

// Search flow
await page.getByRole("searchbox", { name: "Search papers" }).fill("graph neural networks");
await page.getByRole("button", { name: /^Search$/ }).click();
const t0 = Date.now();
await page.waitForSelector(".result:not(.skeleton)", { timeout: 30000 });
console.log(`first result card after ${Date.now() - t0} ms`);
await page.waitForFunction(() => /papers in/.test(document.querySelector(".src-summary")?.textContent ?? ""), null, { timeout: 40000 });
console.log(`search done after ${Date.now() - t0} ms: ${await page.locator(".src-summary").innerText()}`);
await page.waitForTimeout(1500);
await shot("04-results-light");
await axe("results-light");

// Cite popover
await page.locator(".result").first().getByRole("button", { name: "Cite" }).click();
await page.waitForTimeout(500);
await shot("05-cite-popover");
await axe("cite-popover");
await page.getByRole("tab", { name: "BibTeX" }).click();
await page.waitForTimeout(400);
await shot("06-cite-bibtex");
await page.keyboard.press("Escape");

// Save + library drawer
await page.locator(".result").first().getByRole("button", { name: /Save/ }).click();
await page.getByRole("button", { name: /Library/ }).click();
await page.waitForTimeout(600);
await shot("07-library");
await axe("library-drawer");
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// Dark results
await setTheme("Dark"); await shot("08-results-dark"); await axe("results-dark");
await setTheme("Read"); await shot("09-results-read"); await axe("results-read");

// Reading controls
await page.getByRole("button", { name: "Reading settings" }).click();
await page.waitForTimeout(500);
await shot("10-reading-controls");
await page.keyboard.press("Escape");

// Retracted paper card (Wakefield 1998)
await setTheme("Light");
await page.goto(BASE + "?q=" + encodeURIComponent("ileal-lymphoid-nodular hyperplasia non-specific colitis pervasive developmental disorder children"), { waitUntil: "networkidle" });
await page.waitForFunction(() => /papers in/.test(document.querySelector(".src-summary")?.textContent ?? ""), null, { timeout: 40000 });
await page.waitForTimeout(1500);
const retracted = page.locator('.result[data-retracted="true"]').first();
console.log("retracted cards:", await page.locator('.result[data-retracted="true"]').count());
await retracted.scrollIntoViewIfNeeded();
await page.waitForTimeout(800);
await shot("13-retracted");
await axe("retracted-results");

// Mobile
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const mp = await mobile.newPage();
mp.on("pageerror", (e) => errors.push("mobile pageerror: " + e.message));
await mp.goto(BASE, { waitUntil: "networkidle" });
await mp.waitForTimeout(2200);
await mp.screenshot({ path: OUT + "11-mobile-home.png" });
await mp.goto(BASE + "?q=" + encodeURIComponent("CRISPR off-target effects"), { waitUntil: "networkidle" });
await mp.waitForFunction(() => /papers in/.test(document.querySelector(".src-summary")?.textContent ?? ""), null, { timeout: 40000 });
await mp.waitForTimeout(1500);
await mp.screenshot({ path: OUT + "12-mobile-results.png" });
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
console.log("mobile horizontal overflow:", overflow);

console.log("\nconsole/page errors:", errors.length ? errors : "none");
await browser.close();

