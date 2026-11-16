import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BASE, axeViolations, clickTheme, launch, phone, printViolations } from "./lib/browser.mjs";

// Injected with evaluate(), which CSP does not apply to, so the policy under test stays strict.
const OUT = fileURLToPath(new URL("./shots/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

let violations = 0;
/** This suite counts violations and fails at its end (it has no ok()): the same axe run as every suite's (e2e/lib/browser.mjs). */
async function axe(label) {
  const res = await axeViolations(page);
  violations += res.length;
  console.log(`axe [${label}]: ${res.length ? "" : "no violations"}`);
  printViolations(res);
  return res;
}
const shot = (name) => page.screenshot({ path: OUT + name + ".png" });
// the intro demo is still rising and fading when a theme is switched: axe would read a colour half way
const setTheme = (label) => clickTheme(page, label, 1300);

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(2200); // hero animations settle
await shot("01-home-light");
await axe("home-light");

await setTheme("Dark"); await shot("02-home-dark"); await axe("home-dark");
await setTheme("Read"); await shot("03-home-read"); await axe("home-read");
await setTheme("Light");

// Search flow: since W6 the first screen is the intro page (signed out), which has no search box; the shareable address /?q=... runs the same search and shows the same result cards
const t0 = Date.now();
await page.goto(BASE + "/?q=" + encodeURIComponent("graph neural networks"), { waitUntil: "networkidle" });
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

// Save + the Library page (the new look has a page, the old look a drawer)
await page.locator(".result").first().getByRole("button", { name: /Save/ }).click();
await page.locator(".ws-rail").getByRole("link", { name: /^Library/ }).click();
await page.getByRole("heading", { level: 1, name: "Library" }).waitFor();
await page.waitForTimeout(600);
await shot("07-library");
await axe("library-page");
await page.goBack();
await page.waitForSelector(".result:not(.skeleton)", { timeout: 40000 });
await page.waitForTimeout(400);

// Dark results
await setTheme("Dark"); await shot("08-results-dark"); await axe("results-dark");
await setTheme("Read"); await shot("09-results-read"); await axe("results-read");

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
const mobile = await browser.newContext(phone(390, 844));
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
// A violation or a page error fails the suite. It used to only print them, so a crash was the one way to notice a problem (and a crash prints no "FAIL" line).
const pageErrors = errors.filter((e) => e.includes("pageerror"));
if (violations > 0 || pageErrors.length > 0) {
  console.log(`\nFAILED: ${violations} accessibility violation(s), ${pageErrors.length} page error(s)`);
  process.exit(1);
}
console.log("\nall smoke checks passed");

