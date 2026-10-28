// Checks of the cinematic mock (scroll-v3.html): screenshots of every scene, axe at the end of each scene in three themes, keyboard, the stacked layout on a phone and with reduced motion.
//   node docs/design/poc/check-scroll-v3.mjs [shots|axe|kbd]   (from the repository root; uses Edge through playwright-core, as the browser suites do)
import { chromium } from "playwright-core";
import { fileURLToPath } from "node:url";
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../apps/web/e2e/x.mjs", import.meta.url));
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const FILE = new URL("./scroll-v3.html", import.meta.url).href;
const OUT = fileURLToPath(new URL("../../../apps/web/e2e/shots/mock-v3/", import.meta.url));
mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
const browser = await chromium.launch({ channel: "msedge", headless: true });
const errors = [];
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "  ok  " : " FAIL "} ${m}`); if (!c) fails++; };
async function axe(p, label) {
  await p.evaluate(axeSource);
  const v = await p.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations.map((x) => `${x.id} x${x.nodes.length} ${x.nodes[0]?.target?.join(" ")} :: ${x.nodes[0]?.failureSummary?.split("\n")[1]}`));
  ok(v.length === 0, `axe [${label}]`);
  v.forEach((x) => console.log("      " + x));
}
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 } });
await ctx.addInitScript(() => { try { localStorage.removeItem("scroll-v3"); } catch {} });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
await page.goto(FILE, { waitUntil: "load" });
await page.waitForTimeout(900);
ok(await page.evaluate(() => document.documentElement.classList.contains("js-anim")), "film layout on a desktop");
ok(await page.evaluate(() => document.fonts.check('16px "Source Serif 4 Variable"')), "the app's serif loaded from node_modules");
const at = async (id, p) => { await page.evaluate(([id, p]) => { const el = document.getElementById(id); const r = el.getBoundingClientRect(); const span = r.height - innerHeight; scrollTo(0, scrollY + r.top + span * p); }, [id, p]); await page.waitForTimeout(300); };
if (!only || only === "shots") {
  const marks = [["open", 0.05, "1a"], ["open", 0.4, "1b"], ["open", 0.95, "1c"], ["title", 0.1, "2a"], ["title", 0.5, "2b"], ["title", 0.9, "2c"], ["question", 0.2, "3a"], ["question", 0.45, "3b"], ["question", 0.9, "3c"], ["answer", 0.1, "4a"], ["answer", 0.25, "4b"], ["answer", 0.4, "4c"], ["answer", 0.55, "4d"], ["answer", 0.9, "4e"], ["proof", 0.3, "5a"], ["proof", 0.9, "5b"], ["fake", 0.25, "6a"], ["fake", 0.5, "6b"], ["fake", 0.62, "6c"], ["fake", 0.92, "6d"], ["india", 0.3, "7a"], ["india", 0.92, "7b"], ["end", 0.2, "8a"], ["end", 0.9, "8b"]];
  for (const [id, p, name] of marks) { await at(id, p); await page.screenshot({ path: `${OUT}${name}-${id}.png` }); }
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no sideways scroll (desktop)");
}
if (!only || only === "axe") {
  for (const theme of ["dark", "light", "read"]) {
    await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
    await page.waitForTimeout(400);
    for (const [id, p] of [["open", 0.98], ["title", 0.97], ["question", 0.97], ["answer", 0.97], ["proof", 0.97], ["fake", 0.97], ["india", 0.97], ["end", 0.97]]) { await at(id, p); await page.waitForTimeout(250); await axe(page, `${theme} ${id} ${p}`); }
  }
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
}
// keyboard: the strip and the skip link
if (!only || only === "kbd") {
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(300);
  await page.keyboard.press("Tab");
  ok(await page.evaluate(() => document.activeElement?.classList.contains("skip")), "the first Tab reaches 'Skip the film'");
  await page.locator("#strip button").nth(5).click(); await page.waitForTimeout(1600);
  ok(await page.evaluate(() => { const r = document.getElementById("fake").getBoundingClientRect(); return r.top <= 0 && r.bottom >= innerHeight; }), "a scene button in the strip takes you to its scene");
  ok(await page.locator('#strip button[aria-current="true"]').count() === 1, "one scene is marked as the current one");
  await page.locator("#pgOpen").click();
  ok(await page.locator("#pg").isVisible(), "the Playground opens");
  await page.keyboard.press("Escape");
  ok(await page.locator("#pg").isHidden(), "Escape closes it");
}
// stacked layout (phone)
const m = await browser.newContext({ viewport: { width: 390, height: 820 }, deviceScaleFactor: 2 });
const mp = await m.newPage();
mp.on("pageerror", (e) => errors.push("phone pageerror: " + e.message));
await mp.goto(FILE, { waitUntil: "load" }); await mp.waitForTimeout(700);
ok(await mp.evaluate(() => document.documentElement.classList.contains("js-static")), "a phone gets the stacked layout");
ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "no sideways scroll (phone)");
for (const id of ["open", "question", "answer", "proof", "fake", "india", "end"]) { await mp.evaluate((id) => scrollTo(0, document.getElementById(id).getBoundingClientRect().top + scrollY), id); await mp.waitForTimeout(250); await mp.screenshot({ path: `${OUT}m-${id}.png` }); }
if (!only || only === "axe") await axe(mp, "phone, stacked");
// reduced motion on a desktop
const r = await browser.newContext({ viewport: { width: 1440, height: 860 }, reducedMotion: "reduce" });
const rp = await r.newPage(); await rp.goto(FILE, { waitUntil: "load" }); await rp.waitForTimeout(600);
ok(await rp.evaluate(() => document.documentElement.classList.contains("js-static")), "reduced motion gets the stacked layout");
await rp.screenshot({ path: `${OUT}r-top.png`, fullPage: false });
if (!only || only === "axe") await axe(rp, "reduced motion, stacked");
ok(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
await browser.close();
console.log(fails ? `${fails} FAILED` : "all mock checks passed");
