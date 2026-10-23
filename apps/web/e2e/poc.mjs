// Walks through docs/design/poc/unified-workspace.html (a proof of concept, not part of the app): screenshots in e2e/shots/poc-*.png, axe in three themes, phone width.
//   node e2e/poc.mjs
// Opens the POC, walks through it, takes screenshots and runs axe in light, dark and read, at desktop and phone width.
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = "C:/Users/tiadi/OneDrive/Desktop/Research Finder/";
const require = createRequire(root + "apps/web/package.json");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const OUT = fileURLToPath(new URL("./shots/poc-", import.meta.url));
mkdirSync(fileURLToPath(new URL("./shots/", import.meta.url)), { recursive: true });
const URL_ = pathToFileURL(root + "docs/design/poc/unified-workspace.html").href;

let failures = 0;
const ok = (c, m) => { console.log(`${c ? "  ok  " : " FAIL "} ${m}`); if (!c) failures++; };
const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
const shot = (n) => page.screenshot({ path: OUT + n + ".png" });
async function axe(label) {
  await page.evaluate(axeSource);
  const res = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations.map((v) => ({ id: v.id, n: v.nodes.length, t: v.nodes[0]?.target?.join(" "), m: v.nodes[0]?.failureSummary?.split("\n")[1] })));
  ok(res.length === 0, `axe [${label}]`);
  for (const v of res) console.log(`        ${v.id} x${v.n} ${v.t} :: ${v.m}`);
}
const wait = (ms) => page.waitForTimeout(ms);
const noSideways = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1 && document.body.scrollWidth <= document.body.clientWidth + 1);

await page.goto(URL_);
await wait(1500);
await shot("01-empty-light");
await axe("empty, light");
ok(await page.locator("#bento .tool").count() === 4, "four tools are shown as a bento grid");
ok((await page.locator("#ph").innerText()).length > 5, "the prompt box shows a placeholder");
ok(await noSideways(), "no sideways scroll on desktop");

// mode menu
await page.locator("#modeBtn").click();
ok(await page.locator("#menu").isVisible(), "the mode menu opens");
ok((await page.locator("#menu [role=menuitemradio]").count()) === 5, "five choices: Auto and four tools");
await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
await shot("02-menu");
await axe("menu open");
await page.keyboard.press("Escape");
ok(!(await page.locator("#menu").isVisible()), "Escape closes the menu");
ok(await page.evaluate(() => document.activeElement.id === "modeBtn"), "and returns focus to the button");

// auto search
await page.locator("#composer-input").fill("Which papers study soil moisture sensing on tractors?");
await wait(100);
ok(!(await page.locator("#send").isDisabled()), "send is enabled once there is text");
await page.keyboard.press("Enter");
await page.locator(".understood").first().waitFor();
ok(/Search papers/.test(await page.locator(".understood").first().innerText()), "the plain question is understood as a search, and says so");
await wait(1200);
await shot("03-search-progress");
ok(!/openalex|crossref|pubmed|semantic scholar/i.test(await page.locator("#thread").innerText()), "no source is named while searching");
await page.locator(".paper").first().waitFor({ timeout: 20000 });
await wait(900);
await shot("04-search-answer");
ok((await page.locator("#thread .paper").count()) === 4, "four sample records are listed");
ok(await page.locator(".retract").isVisible(), "a retracted record shows the red banner");
await axe("search answer, light");
ok(await page.locator(".cite").count() >= 3, "the summary has citation buttons that point at the records");
await page.locator(".cite").first().click();
await wait(500);

// save then ask
await page.locator('[data-act="ask"][data-id="1"]').first().click();
await page.locator("#saveDlg").waitFor({ state: "visible" });
ok(/open access/i.test(await page.locator("#sdP").innerText()), "asking an unsaved open-access paper explains that it will be saved first");
await shot("05-save-first");
await axe("save dialog");
await page.locator("#sdYes").click();
await page.locator("#pp[data-open=true]").waitFor();
await wait(700);
await page.locator("#ppInput").fill("What are the limitations?");
await page.keyboard.press("Enter");
await page.locator(".pp .src").waitFor({ timeout: 10000 });
await shot("06-ask-paper");
ok(/p\. 4/.test(await page.locator(".pp .src").innerText()), "the answer carries a page and an exact quote");
await axe("paper panel");
await page.keyboard.press("Escape");
await page.locator("#pp[data-open=false]").waitFor();

// verify references
await page.locator("#newChat").click();
await wait(300);
await page.locator("#composer-input").fill("Check these references\nSample, A. (2022). A study of things. J 1, 1-2.\nPlaceholder, C. (2020). Another study. J 2, 3-4.");
await page.keyboard.press("Enter");
await page.locator(".refrow").first().waitFor({ timeout: 20000 });
await wait(900);
ok(/Check references/.test(await page.locator(".understood").first().innerText()), "pasted references are understood as a reference check");
ok((await page.locator(".refrow").count()) === 4, "four references are shown, each with a verdict in words");
await shot("07-verify");
await axe("verify");

// idea check
await page.locator("#newChat").click();
await wait(300);
await page.locator('#bento [data-mode="idea"]').click();
ok((await page.locator("#modeLabel").innerText()) === "Idea Check", "choosing the Idea Check tile sets the mode");
await page.locator("#composer-input").fill("I want to screen for glaucoma in rural clinics with a smartphone camera and a neural network.");
await page.keyboard.press("Enter");
await page.locator(".idea").waitFor({ timeout: 20000 });
await wait(1600); // the card rises in; axe must not read it half way
await shot("08-idea-plan");
ok((await page.locator("[data-step]").count()) === 6, "Idea Check has its own six-step workspace");
await axe("idea check, plan");
for (const next of ["papers", "map", "gaps", "read", "report"]) {
  await page.locator(`[data-go="${next}"], [data-step="${next}"]`).first().click();
  await wait(1100);
  if (next === "papers") await shot("09-idea-papers");
  if (next === "map") { await page.locator(".cell.same").first().hover(); await wait(300); await shot("10-idea-map"); ok(/“/.test(await page.locator("#quote").innerText()), "hovering a cell of the coverage map shows the sentence it rests on"); await axe("idea check, map"); }
  if (next === "gaps") await shot("11-idea-gaps");
  if (next === "read") await shot("12-idea-read");
  if (next === "report") { await shot("13-idea-report"); ok(!(await page.locator("#exportBtn").isHidden()), "the report button appears once the papers were read"); }
}

// other pages
for (const [hash, name] of [["#/papers", "papers"], ["#/library", "library"], ["#/settings", "settings"]]) {
  await page.evaluate((h) => (location.hash = h), hash); await wait(800);
  await shot("14-" + name);
  await axe(name);
}

// themes
for (const t of ["dark", "read"]) {
  await page.evaluate(() => (location.hash = "#/")); await wait(200);
  await page.locator(`#theme [data-t="${t}"]`).click(); await wait(700);
  await shot("15-" + t);
  await axe("home, " + t);
}
await page.locator('#theme [data-t="light"]').click();

// phone
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => (location.hash = "#/")); await page.locator("#newChat").evaluate((b) => b.click()).catch(() => {});
await wait(600);
await shot("16-phone-empty");
ok(await noSideways(), "no sideways scroll at 390 px");
await axe("phone, empty");
await page.locator("#menuBtn").click(); await wait(500);
await shot("17-phone-menu");
await axe("phone, menu open");
await page.keyboard.press("Escape");
await wait(500);
ok(await page.locator("#rail").evaluate((r) => r.dataset.open !== "true"), "Escape closes the menu on a phone");
await page.locator("#composer-input").fill("I want to screen for glaucoma in rural clinics with a smartphone camera and a neural network.");
await page.keyboard.press("Enter");
await page.locator(".idea").waitFor({ timeout: 20000 }); await wait(1600);
await shot("18-phone-idea");
ok(await noSideways(), "Idea Check does not scroll sideways at 390 px");
await axe("phone, idea check");

// reduced motion
const rm = await browser.newContext({ viewport: { width: 1000, height: 800 }, reducedMotion: "reduce" });
const p2 = await rm.newPage(); await p2.goto(URL_); await p2.waitForTimeout(400);
await p2.locator("#composer-input").fill("Which papers study soil moisture?"); await p2.keyboard.press("Enter");
await p2.locator(".paper").first().waitFor({ timeout: 10000 });
ok(true, "with reduced motion the whole search answer still arrives");

ok(errors.length === 0, "no errors in the console" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall POC checks passed");
process.exit(failures ? 1 : 0);
