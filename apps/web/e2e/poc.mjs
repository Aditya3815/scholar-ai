// Walks through docs/design/poc/unified-workspace.html (a proof of concept, not part of the app): screenshots in e2e/shots/poc-*.png, axe in three themes, phone width.
//   node e2e/poc.mjs
// Covers the intro (signed out), the home (signed in), a search, a reference check, Idea Check, My papers (cards without "Open and ask"), the other pages, three themes, a phone, reduced motion.
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(root + "apps/web/package.json");
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const OUT = fileURLToPath(new URL("./shots/poc-", import.meta.url));
mkdirSync(fileURLToPath(new URL("./shots/", import.meta.url)), { recursive: true });
const FILE = root + "docs/design/poc/unified-workspace.html";
const URL_ = pathToFileURL(FILE).href;
const LOGO_PATH = "M16 9.5c-2.2-1.4-5-1.8-8-1.3v13.3c3-.5 5.8-.1 8 1.3V9.5Z";

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
const noSideways = () => page.evaluate(() => { const w = document.getElementById("welcome"); const box = getComputedStyle(w).display !== "none" ? w : document.documentElement; return box.scrollWidth <= box.clientWidth + 1 && document.body.scrollWidth <= document.body.clientWidth + 1; });
const setTheme = (t) => page.evaluate((t) => document.querySelector(`.theme button[data-t="${t}"]`)?.click?.(), t);

/* ============================ the intro (signed out) ============================ */
await page.addInitScript(() => { try { sessionStorage.clear(); } catch {} });
await page.goto(URL_);
await wait(2200);
await shot("01-intro-light");
ok(await page.locator("body[data-auth=out]").count() === 1, "the page opens on the intro, signed out");
ok(await page.locator(`.welcome .logo-btn path[d="${LOGO_PATH}"]`).count() === 1, "the logo is the product's own mark (same open-book drawing)");
ok(/Scholar\s*AI/.test(await page.locator(".welcome .logo-word").first().innerText()), "and its wordmark: Scholar AI");
ok(await page.locator(".w-h1").innerText().then((t) => /Research you can trust/.test(t)), "the headline is there");
await axe("intro top, light");
await page.locator(".demo-in .typed").waitFor();
await page.locator("#demoOut .understood").first().waitFor({ timeout: 20000 });
ok(/I understood this as/.test(await page.locator("#demoOut .understood").first().innerText()), "the demo prompt box says what it understood");
await wait(1800);
await shot("02-intro-demo");
ok(!/openalex|crossref|pubmed|semantic scholar|arxiv|core\b/i.test(await page.locator("#demo").innerText()), "the demo names no source while it searches");
await page.locator("#demoPause").click();
ok((await page.locator("#demoPause").getAttribute("aria-pressed")) === "true", "the demo can be paused");
await page.locator("#demoPause").click();
ok(await noSideways(), "no sideways scroll on the intro (desktop)");

for (const [id, name] of [["how", "03-intro-tools"], ["trust", "04-intro-trust"], ["hinglish", "05-intro-hinglish"], ["privacy", "06-intro-privacy"]]) {
  await page.evaluate((id) => document.getElementById(id).scrollIntoView({ behavior: "instant", block: "start" }), id);
  await wait(1700);
  await shot(name);
}
await axe("intro sections, light");
for (const t of ["dark", "read"]) {
  await setTheme(t);
  await wait(700);
  await page.evaluate(() => document.getElementById("welcome").scrollTo({ top: 0, behavior: "instant" }));
  await wait(500);
  await shot(`07-intro-${t}`);
  await axe(`intro top, ${t}`);
  await page.evaluate(() => document.getElementById("trust").scrollIntoView({ behavior: "instant", block: "start" }));
  await wait(1500);
  await axe(`intro trust section, ${t}`);
}
await setTheme("light");
await page.evaluate(() => document.getElementById("welcome").scrollTo({ top: 99999, behavior: "instant" }));
await wait(900);
await shot("08-intro-end");

/* ============================ phone: intro ============================ */
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => document.getElementById("welcome").scrollTo({ top: 0, behavior: "instant" }));
await wait(900);
await shot("09-intro-phone");
ok(await noSideways(), "no sideways scroll on the intro at 390 px");
ok(await page.locator(".welcome .w-nav .btn-primary").evaluate((b) => b.getBoundingClientRect().right <= innerWidth && b.getBoundingClientRect().height < 60), "the Sign in button fits in the phone header on one line");
await axe("intro, phone");
await page.setViewportSize({ width: 1360, height: 900 });
await wait(400);

/* ============================ sign in: the home ============================ */
await page.locator("[data-signin]").first().click();
await wait(2200);
ok(await page.locator("body[data-auth=in]").count() === 1, "Sign in leads to the home");
await shot("10-home-light");
ok(await page.locator(`.rail .logo-btn path[d="${LOGO_PATH}"]`).count() === 1, "the rail carries the same logo");
ok(/Good (morning|afternoon|evening)|Working late/.test(await page.locator("#greet").innerText()), "the home greets the person");
ok(await page.locator("#heroSlot #composer").count() === 1, "the prompt box sits in the middle of the empty home");
ok(await page.locator("#toolrow .tpill").count() === 4, "four tools sit under the prompt box");
ok((await page.locator("#ph").innerText()).length > 5, "the prompt box shows a placeholder");
ok(await noSideways(), "no sideways scroll on the home");
await axe("home, light");
await page.locator("#modeBtn").click();
ok(await page.locator("#menu").isVisible(), "the mode menu opens");
ok((await page.locator("#menu [role=menuitemradio]").count()) === 5, "five choices: Auto and four tools");
await page.keyboard.press("ArrowDown"); await page.keyboard.press("ArrowDown");
await shot("11-menu");
await axe("menu open");
await page.keyboard.press("Escape");
ok(!(await page.locator("#menu").isVisible()), "Escape closes the menu");
ok(await page.evaluate(() => document.activeElement.id === "modeBtn"), "and returns focus to the button");

/* ============================ a search ============================ */
await page.locator("#composer-input").fill("Which papers study soil moisture sensing on tractors?");
await wait(100);
ok(!(await page.locator("#send").isDisabled()), "send is enabled once there is text");
await page.keyboard.press("Enter");
await page.locator("#thread .understood").first().waitFor();
ok(/Search papers/.test(await page.locator("#thread .understood").first().innerText()), "the plain question is understood as a search, and says so");
const boxTop = await page.locator("#composer").evaluate((c) => c.getBoundingClientRect().top);
await wait(1500);
ok(await page.locator("#view-chat > .composer-wrap").count() === 1 && (await page.locator("#composer").evaluate((c) => c.getBoundingClientRect().top)) > 650, `after the first message the prompt box moves to the bottom (was at ${Math.round(boxTop)} px)`);
await shot("12-search-progress");
ok(!/openalex|crossref|pubmed|semantic scholar|arxiv|core\b/i.test(await page.locator("#thread").innerText()), "no source is named while searching");
await page.locator("#thread .paper").first().waitFor({ timeout: 20000 });
await wait(900);
await shot("13-search-answer");
ok((await page.locator("#thread .paper").count()) === 4, "four sample records are listed");
ok(await page.locator("#thread .retract").isVisible(), "a retracted record shows the red banner");
await axe("search answer, light");
ok(await page.locator("#thread .cite").count() >= 3, "the summary has citation buttons that point at the records");
await page.locator("#thread .cite").first().click();
await wait(500);

/* save then ask */
await page.locator('[data-act="ask"][data-id="1"]').first().click();
await page.locator("#saveDlg").waitFor({ state: "visible" });
ok(/open access/i.test(await page.locator("#sdP").innerText()), "asking an unsaved open-access paper explains that it will be saved first");
await shot("14-save-first");
await axe("save dialog");
await page.locator("#sdYes").click();
await page.locator("#pp[data-open=true]").waitFor();
await wait(700);
await page.locator("#ppInput").fill("What are the limitations?");
await page.keyboard.press("Enter");
await page.locator(".pp .src").waitFor({ timeout: 10000 });
await shot("15-ask-paper");
ok(/p\. 4/.test(await page.locator(".pp .src").innerText()), "the answer carries a page and an exact quote");
await axe("paper panel");
await page.keyboard.press("Escape");
await page.locator("#pp[data-open=false]").waitFor();

/* verify references */
await page.locator("#newChat").click();
await wait(600);
ok(await page.locator("#heroSlot #composer").count() === 1, "a new chat puts the prompt box back in the middle");
await page.locator("#composer-input").fill("Check these references\nSample, A. (2022). A study of things. J 1, 1-2.\nPlaceholder, C. (2020). Another study. J 2, 3-4.");
await page.keyboard.press("Enter");
await page.locator("#thread .refrow").first().waitFor({ timeout: 20000 });
await wait(900);
ok(/Check references/.test(await page.locator("#thread .understood").first().innerText()), "pasted references are understood as a reference check");
ok((await page.locator("#thread .refrow").count()) === 4, "four references are shown, each with a verdict in words");
await shot("16-verify");
await axe("verify");

/* Hinglish is understood too */
await page.locator("#newChat").click();
await wait(500);
await page.locator("#composer-input").fill("Mere thesis ke references check kar do\nSample, A. (2022). A study of things. J 1, 1-2.\nPlaceholder, C. (2020). Another study. J 2, 3-4.");
await page.keyboard.press("Enter");
await page.locator("#thread .refrow").first().waitFor({ timeout: 20000 });
ok(/Check references/.test(await page.locator("#thread .understood").first().innerText()), "a Hinglish request is understood as a reference check");

/* idea check */
await page.locator("#newChat").click();
await wait(500);
await page.locator('#toolrow [data-mode="idea"]').click();
ok((await page.locator("#modeLabel").innerText()) === "Idea Check", "choosing the Idea Check pill sets the mode");
await page.locator("#composer-input").fill("I want to screen for glaucoma in rural clinics with a smartphone camera and a neural network.");
await page.keyboard.press("Enter");
await page.locator(".idea").waitFor({ timeout: 20000 });
await wait(900);
await shot("17-idea-plan");
ok((await page.locator("[data-step]").count()) === 6, "Idea Check has its own six-step workspace");
await axe("idea check, plan");
for (const next of ["papers", "map", "gaps", "read", "report"]) {
  await page.locator(`[data-go="${next}"], [data-step="${next}"]`).first().click();
  await wait(1100);
  if (next === "papers") await shot("18-idea-papers");
  if (next === "map") { await page.locator(".cell.same").first().hover(); await wait(300); await shot("19-idea-map"); ok(/“/.test(await page.locator("#quote").innerText()), "hovering a cell of the coverage map shows the sentence it rests on"); await axe("idea check, map"); }
  if (next === "gaps") await shot("20-idea-gaps");
  if (next === "read") await shot("21-idea-read");
  if (next === "report") { await shot("22-idea-report"); ok(!(await page.locator("#exportBtn").isHidden()), "the report button appears once the papers were read"); }
}

/* ============================ My papers: no "Open and ask" ============================ */
await page.evaluate(() => (location.hash = "#/papers"));
await wait(1200);
await shot("23-papers");
ok((await page.locator(".pcard").count()) === 3, "My papers shows its three paper cards");
ok((await page.locator("#view-papers").getByRole("button", { name: /open and ask|^ask/i }).count()) === 0, 'no "Open and ask" or "Ask" button on a paper card');
ok((await page.locator(".pcard .dc-open").count()) === 3 && (await page.locator(".pcard").getByRole("button", { name: /^(Cite|Notes)/ }).count()) === 0, "each card opens from its cover and has no Cite or Notes buttons (decided 24 Oct)");
await axe("my papers");
await page.locator(".dc-open").first().click();
await page.locator("#pp[data-open=true]").waitFor();
ok(true, "the cover opens the paper");
await page.keyboard.press("Escape");

/* other pages */
for (const [hash, name] of [["#/library", "library"], ["#/settings", "settings"]]) {
  await page.evaluate((h) => (location.hash = h), hash); await wait(800);
  await shot("25-" + name);
  await axe(name);
}

/* themes (signed in) */
for (const t of ["dark", "read"]) {
  await page.evaluate(() => (location.hash = "#/")); await page.locator("#newChat").click(); await wait(500);
  await setTheme(t); await wait(900);
  await shot("26-home-" + t);
  await axe("home, " + t);
  await page.evaluate(() => (location.hash = "#/papers")); await wait(900);
  await axe("my papers, " + t);
}
await setTheme("light");

/* phone: home */
await page.setViewportSize({ width: 390, height: 844 });
await page.evaluate(() => (location.hash = "#/")); await page.locator("#newChat").evaluate((b) => b.click()).catch(() => {});
await wait(900);
await shot("27-home-phone");
ok(await noSideways(), "no sideways scroll on the home at 390 px");
await axe("home, phone");
await page.locator("#menuBtn").click(); await wait(500);
await shot("28-phone-menu");
await axe("phone, menu open");
await page.keyboard.press("Escape"); await page.locator("#scrim").click({ force: true }).catch(() => {});
await wait(400);
await page.locator("#composer-input").fill("I want to screen for glaucoma in rural clinics with a smartphone camera and a neural network.");
await page.keyboard.press("Enter");
await page.locator(".idea").waitFor({ timeout: 20000 }); await wait(900);
await shot("29-phone-idea");
ok(await noSideways(), "Idea Check does not scroll sideways at 390 px");
await axe("phone, idea check");
await page.evaluate(() => (location.hash = "#/papers")); await wait(900);
await shot("30-phone-papers");
ok(await noSideways(), "My papers does not scroll sideways at 390 px");
await axe("phone, my papers");

/* signing out returns to the intro */
await page.setViewportSize({ width: 1360, height: 900 });
await page.locator("#signOut").evaluate((b) => b.click());
await wait(700);
ok(await page.locator("body[data-auth=out]").count() === 1, "Sign out returns to the intro");

/* reduced motion: the intro and the home still show everything */
const rm = await browser.newContext({ viewport: { width: 1200, height: 800 }, reducedMotion: "reduce" });
const p2 = await rm.newPage();
const rmErrors = [];
p2.on("pageerror", (e) => rmErrors.push(e.message));
await p2.goto(URL_ + "");
await p2.waitForTimeout(600);
ok(await p2.locator("#demoOut .paper").first().isVisible(), "with reduced motion the demo shows its finished state at once");
ok(await p2.locator(".w-h1").evaluate((h) => getComputedStyle(h.querySelector(".wd")).opacity === "1"), "and the headline is visible without animation");
await p2.locator("[data-signin]").first().click();
await p2.locator("#composer-input").fill("Which papers study soil moisture?"); await p2.keyboard.press("Enter");
await p2.locator("#thread .paper").first().waitFor({ timeout: 10000 });
ok(true, "with reduced motion the whole search answer still arrives");
ok(rmErrors.length === 0, "no errors with reduced motion");

ok(errors.length === 0, "no errors in the console" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall POC checks passed");
process.exit(failures ? 1 : 0);
