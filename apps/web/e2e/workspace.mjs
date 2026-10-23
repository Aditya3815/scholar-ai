// Browser e2e for the new look (phase W1, switched on with ?ws=1): the scroll-animated intro page, the home screen with its prompt box,
// the rail, the Library and Settings pages, My papers without the "Open and ask" button. Three themes, a phone, reduced motion.
// Needs the Worker with the fake identity provider: `npm run integration -w apps/api -- --browser` starts it.
//   node e2e/workspace.mjs [baseUrl]    (default http://localhost:8788)
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startFakeIdp } from "../../api/scripts/fake-idp.mjs";
import { SAMPLE_PAPER, makePdf } from "../../api/scripts/lib/make-pdf.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.argv[2] ?? "http://localhost:8788";
const OUT = fileURLToPath(new URL("./shots/ws-", import.meta.url));
mkdirSync(fileURLToPath(new URL("./shots/", import.meta.url)), { recursive: true });
const LOGO_PATH = "M16 9.5c-2.2-1.4-5-1.8-8-1.3v13.3c3-.5 5.8-.1 8 1.3V9.5Z";

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "ws-ui-1", email: "asha.rao@example.edu", email_verified: true, name: "Asha Rao" });

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
const errors = [];
const watch = (p) => {
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401|403|404)/.test(m.text())) errors.push("console: " + m.text()); });
};
const newCtx = (opts = {}) => browser.newContext({ viewport: { width: 1360, height: 900 }, ...opts });
const withFlag = (ctx) => ctx.addInitScript(() => { try { localStorage.setItem("scholar.ws", "1"); } catch {} });

async function axe(label, p) {
  await p.evaluate(axeSource);
  const res = await p.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(" "), msg: v.nodes[0]?.failureSummary?.split("\n")[1] }));
  });
  ok(res.length === 0, `axe [${label}]`);
  for (const v of res) console.log(`        ${v.impact} ${v.id} x${v.nodes} ${v.sample} :: ${v.msg}`);
}
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const setTheme = (p, t) => p.evaluate((t) => { document.documentElement.setAttribute("data-theme", t); }, t);
const tourBox = (p) => p.evaluate(() => { const t = document.getElementById("tour"); const r = t.getBoundingClientRect(); return { top: r.top + scrollY, h: t.offsetHeight, vh: innerHeight }; });
const scrollTo = async (p, y) => { await p.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), y); await p.waitForTimeout(650); };
const visibleChapter = (p) => p.evaluate(() => [...document.querySelectorAll(".in-chap")].filter((e) => Number(getComputedStyle(e).opacity) > 0.9).map((e) => e.querySelector(".in-kicker").textContent));

try {
  /* ============================ the intro page, signed out, desktop ============================ */
  console.log("intro");
  const ctx = await newCtx();
  await withFlag(ctx);
  const page = await ctx.newPage();
  watch(page);
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator("#in-h1").waitFor({ timeout: 15000 });
  await page.keyboard.press("Tab");
  ok(await page.evaluate(() => document.activeElement?.classList.contains("skip-link")), "the first Tab stop is the skip link");
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.waitForTimeout(3000);
  ok(/Research you can trust\./.test(await page.locator("#in-h1").innerText()), "the intro page opens for a signed-out visitor, headline with its spaces");
  ok(await page.locator(`.in-head .logo path[d="${LOGO_PATH}"]`).count() === 1, "the logo is the product's own open-book mark");
  ok(/Scholar\s*AI/.test(await page.locator(".in-head .logo-word").innerText()), "and its wordmark");
  await page.locator(".in-hero .in-paper-bad").waitFor({ timeout: 9000 });
  ok(true, "the hero window has typed and answered by itself");
  ok(!/openalex|crossref|pubmed|semantic scholar|arxiv|\bcore\b/i.test(await page.locator(".in-herowin").innerText()), "the demo window names no source");
  ok(await page.getByRole("button", { name: "Continue with Google" }).first().isVisible(), "the hero offers Continue with Google");
  ok(await page.getByRole("link", { name: /Try it without signing in/ }).first().isVisible(), "and trying it without signing in");
  await page.screenshot({ path: OUT + "01-intro-hero.png" });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await axe("intro hero, light", page);
  ok(await noSideways(page), "no sideways scroll on the intro (desktop)");
  ok(await page.locator(".in-progress").count() === 1, "a thin progress line runs under the header");

  const t = await tourBox(page);
  ok(t.h > t.vh * 3, `the tour is a tall pinned section (${Math.round(t.h)} px, window ${t.vh} px)`);
  const dist = t.h - t.vh;
  const stops = [[0.0, "Find papers"], [0.37, "Check your references"], [0.62, "Check an idea"], [0.95, "Ask a paper"]];
  let lastTyped = "";
  for (const [f, name] of stops) {
    await scrollTo(page, t.top + dist * f);
    const vis = await visibleChapter(page);
    ok(vis.length === 1 && vis[0] === name, `scrolled to ${Math.round(f * 100)}% of the tour: the chapter on screen is "${name}" (${vis.join(", ")})`);
    const pinned = await page.evaluate(() => { const s = document.querySelector(".in-stage").getBoundingClientRect(); return Math.round(s.top); });
    ok(Math.abs(pinned - 62) < 12, `the stage stays pinned under the header (top ${pinned}px)`);
    await page.screenshot({ path: OUT + `02-tour-${Math.round(f * 100)}.png` });
    if (f === 0.37) await axe("intro tour, references chapter, light", page);
    if (f === 0.95) {
      const sweep = await page.evaluate(() => getComputedStyle(document.querySelector(".in-wins .in-quote mark") ?? document.body).backgroundSize);
      ok(/100%/.test(sweep), `the quote in the last chapter is fully highlighted (${sweep})`);
    }
    if (f === 0.0) lastTyped = await page.locator(".in-wins .in-typed").first().innerText();
  }
  await scrollTo(page, t.top + dist * 0.12);
  const typedMid = await page.locator(".in-wins .in-typed").first().innerText();
  ok(typedMid.length > lastTyped.length, `scrolling really scrubs the scene: the typed question grows (${lastTyped.length} to ${typedMid.length} characters)`);
  await scrollTo(page, t.top + dist * 0.12 - 300);
  const typedBack = await page.locator(".in-wins .in-typed").first().innerText();
  ok(typedBack.length < typedMid.length, "and scrolling back up winds it back (it follows the scroll, it is not a timer)");

  // the rail jumps to a chapter; its buttons are real buttons with names
  const railBtns = page.locator(".in-rail button");
  ok(await railBtns.count() === 4, "the chapter rail has four buttons");
  await railBtns.nth(2).click();
  await page.waitForFunction(() => document.querySelector('.in-rail button[aria-current="step"]')?.textContent?.includes("Check an idea"), null, { timeout: 8000 });
  ok(true, "pressing a chapter in the rail scrolls to it and marks it current");
  ok(await page.locator(".in-tour .sr-only h3").count() === 4, "screen readers get the four chapters once, as plain headings");
  ok(await page.locator('.in-chaps[aria-hidden="true"]').count() === 1 && await page.locator('.in-wins[aria-hidden="true"]').count() === 1, "the animated copy is hidden from them");

  for (const id of ["trust", "privacy"]) {
    await page.evaluate((id) => document.getElementById(id).scrollIntoView({ behavior: "instant", block: "start" }), id);
    await page.waitForTimeout(1600);
    await page.screenshot({ path: OUT + `03-${id}.png` });
  }
  await axe("intro, trust and privacy sections, light", page);
  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + "04-end.png" });
  await axe("intro, end of page, light", page);

  for (const theme of ["dark", "read"]) {
    await setTheme(page, theme);
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);
    await page.screenshot({ path: OUT + `05-intro-${theme}.png` });
    await axe(`intro hero, ${theme}`, page);
    await scrollTo(page, t.top + dist * 0.62);
    await axe(`intro tour, idea chapter, ${theme}`, page);
    await page.evaluate(() => document.getElementById("trust").scrollIntoView({ behavior: "instant", block: "start" }));
    await page.waitForTimeout(1500);
    await axe(`intro trust section, ${theme}`, page);
  }
  await setTheme(page, "light");

  /* ============================ phone: the stacked layout ============================ */
  console.log("intro on a phone");
  const mctx = await newCtx({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await withFlag(mctx);
  const mp = await mctx.newPage();
  watch(mp);
  await mp.goto(BASE + "/", { waitUntil: "networkidle" });
  await mp.locator("#in-h1").waitFor();
  await mp.waitForTimeout(2500);
  await mp.screenshot({ path: OUT + "06-intro-phone.png" });
  ok(await mp.locator(".in-tour").count() === 0 && await mp.locator(".in-tour-s").count() === 1, "on a phone the tour is stacked, not pinned");
  ok(await mp.locator(".in-chap-s").count() === 4, "all four chapters are there one after another");
  ok(await mp.locator(".in-chap-s .in-paper-bad").count() === 1 && await mp.locator(".in-chap-s .in-quote mark").count() === 1, "each scene shows its finished state");
  ok(await noSideways(mp), "no sideways scroll at 390 px");
  await axe("intro, phone", mp);
  await mp.evaluate(() => document.getElementById("tour").scrollIntoView({ behavior: "instant" }));
  await mp.waitForTimeout(1500);
  await mp.screenshot({ path: OUT + "07-intro-phone-tour.png" });
  await axe("intro tour, phone", mp);
  await mp.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
  await mp.waitForTimeout(1200);
  await axe("intro end, phone", mp);
  await mctx.close();

  /* ============================ reduced motion ============================ */
  console.log("reduced motion");
  const rctx = await newCtx({ reducedMotion: "reduce" });
  await withFlag(rctx);
  const rp = await rctx.newPage();
  watch(rp);
  await rp.goto(BASE + "/", { waitUntil: "networkidle" });
  await rp.locator("#in-h1").waitFor();
  await rp.waitForTimeout(800);
  ok(await rp.locator(".in-tour").count() === 0 && await rp.locator(".in-tour-s").count() === 1, "with reduced motion the tour is the stacked, static article");
  ok(await rp.locator(".in-hero .in-paper-bad").count() === 1, "the hero window shows its finished state at once");
  ok(await rp.locator(".in-mw").count() === 0, "the manifesto is plain text, nothing fades with scroll");
  await axe("intro, reduced motion", rp);
  await rctx.close();

  /* ============================ try without signing in ============================ */
  console.log("try without signing in");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("link", { name: /Try it without signing in/ }).first().click();
  await page.locator("#hm-h").waitFor();
  ok(new URL(page.url()).pathname === "/home", "Try it without signing in opens the home screen at /home");
  ok(await page.locator(".ws-rail").isVisible(), "with the rail");
  ok(await page.getByRole("button", { name: /^Sign in$/ }).first().isVisible(), "and a way to sign in");
  ok(await page.locator(".hm-pill").count() === 4, "the home screen offers four tools under the prompt box");

  /* ============================ sign in: the home ============================ */
  console.log("home");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator("#in-h1").waitFor();
  await page.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
  await page.getByRole("button", { name: "Continue with Google" }).last().click();
  await page.locator("#hm-h").waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  ok(new URL(page.url()).pathname === "/", "signing in lands on the home screen at /");
  ok(/Asha/.test(await page.locator(".hm-greet").innerText()), "it greets the person by name");
  ok(await page.locator(`.ws-rail .logo path[d="${LOGO_PATH}"]`).count() === 1, "the rail carries the same logo");
  ok(await page.locator(".hm-box").isVisible() && await page.locator(".hm-input").isVisible(), "the prompt box is the centre of the page");
  await page.screenshot({ path: OUT + "10-home.png" });
  await axe("home, light", page);
  ok(await noSideways(page), "no sideways scroll on the home screen");
  for (const theme of ["dark", "read"]) {
    await setTheme(page, theme); await page.waitForTimeout(500);
    await page.screenshot({ path: OUT + `11-home-${theme}.png` });
    await axe(`home, ${theme}`, page);
  }
  await setTheme(page, "light");

  // the mode menu
  await page.getByRole("button", { name: /Search papers/ }).first().click();
  const menu = page.getByRole("menu", { name: "What should I do?" });
  await menu.waitFor();
  ok((await menu.getByRole("menuitemradio").count()) === 4, "the mode menu lists four tools");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(600);
  await axe("mode menu open", page);
  await menu.getByRole("menuitemradio", { name: /Check references/ }).click();
  await menu.waitFor({ state: "hidden" });
  ok(/Check references/.test(await page.locator(".hm-mode").innerText()), "choosing a tool sets the mode");
  await page.locator(".hm-input").fill("[1] LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521, 436-444.");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => location.pathname === "/verify", null, { timeout: 8000 });
  await page.waitForTimeout(800);
  ok(/Deep learning/.test(await page.locator("textarea").first().inputValue()), "Enter opens Check references with what was written in it");
  await page.goBack();
  await page.locator("#hm-h").waitFor();

  await page.locator(".hm-pill", { hasText: "Idea Check" }).click();
  await page.locator(".hm-input").fill("I want to screen for glaucoma in rural clinics with a smartphone camera and a neural network.");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => location.pathname === "/idea", null, { timeout: 8000 });
  await page.waitForTimeout(800);
  ok(/glaucoma/.test(await page.locator("textarea").first().inputValue()), "Idea Check opens with the idea already in it");
  await page.goBack();
  await page.locator("#hm-h").waitFor();

  // a search from the box (results mocked)
  const done = { type: "done", results: [{ id: "doi:10.1000/t1", doi: "10.1000/t1", pmid: null, title: "Workspace test paper", authors: ["A. Author"], year: 2021, venue: "Test Journal", abstract: "An abstract.", citationCount: 3, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 1, workType: "article" }], providers: { openalex: { ok: true, count: 1, ms: 5, cached: false } }, query: "workspace" };
  await page.route("**/api/v1/search/stream*", (route) => route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-store" }, body: `event: done\ndata: ${JSON.stringify(done)}\n\n` }));
  await page.locator(".hm-pill", { hasText: "Search papers" }).click();
  await page.locator(".hm-input").fill("workspace");
  await page.keyboard.press("Enter");
  await page.locator(".result").first().waitFor({ timeout: 10000 });
  ok(await page.locator(".ws-rail").isVisible(), "a search from the home box shows its results inside the same frame");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: OUT + "12-results-in-shell.png" });
  await axe("results in the shell", page);
  await page.unroute("**/api/v1/search/stream*");

  /* ============================ the rail and the pages ============================ */
  console.log("pages");
  await page.locator(".ws-rail").getByRole("link", { name: "Library" }).click();
  await page.getByRole("heading", { level: 1, name: "Library" }).waitFor();
  ok(new URL(page.url()).pathname === "/library", "Library is a page of its own (/library)");
  await page.screenshot({ path: OUT + "13-library.png" });
  await axe("library page", page);
  await page.locator(".ws-rail").getByRole("link", { name: "Settings" }).click();
  await page.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
  ok(new URL(page.url()).pathname === "/settings", "Settings is a page of its own (/settings)");
  ok(await page.getByRole("link", { name: /Export my data/ }).isVisible() && await page.getByRole("button", { name: "Delete my account" }).isVisible(), "it holds the data export and the account deletion");
  ok(/Asha Rao/.test(await page.locator(".settings-sec").first().innerText().catch(() => "")) || /Asha Rao/.test(await page.locator("main").innerText()), "and the account details");
  await page.screenshot({ path: OUT + "14-settings.png" });
  await axe("settings page", page);

  // My papers: the cover opens the paper; there is no "Open and ask" button
  await page.locator(".ws-rail").getByRole("link", { name: /My papers/ }).click();
  const note = page.getByRole("region", { name: /how your papers are handled/ });
  await note.waitFor();
  await note.getByRole("button", { name: "I understand, continue" }).click();
  await note.waitFor({ state: "detached", timeout: 8000 });
  await page.locator('input[type="file"]').waitFor({ state: "attached" });
  await page.locator('input[type="file"]').setInputFiles({ name: "glaucoma_screening.pdf", mimeType: "application/pdf", buffer: makePdf(SAMPLE_PAPER, { title: "Glaucoma screening" }) });
  await page.locator(".dc").first().waitFor({ timeout: 40000 });
  await page.waitForFunction(() => document.querySelector(".dc")?.getAttribute("data-status") === "ready", null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + "15-papers.png" });
  ok((await page.locator(".dc").getByRole("button", { name: /open and ask/i }).count()) === 0, 'no "Open and ask" button on a paper card');
  ok((await page.locator(".dc .dc-open").count()) >= 1 && (await page.locator(".dc").first().getByRole("button", { name: /^Delete/ }).count()) === 1, "the card is otherwise as before: the cover opens it, rename and delete are there");
  ok((await page.locator(".dc").getByRole("button", { name: /^(Cite|Notes)/ }).count()) === 0, "and it has no Cite or Notes buttons");
  await axe("my papers in the shell", page);
  await page.locator(".dc .dc-open").first().click();
  await page.waitForFunction(() => /^\/papers\/[a-f0-9]+$/.test(location.pathname), null, { timeout: 15000 });
  ok(true, "the cover opens the paper as before");
  await page.goBack();
  await page.locator(".dc").first().waitFor();
  const mine = (await (await page.request.get(BASE + "/api/v1/documents")).json()).items;
  for (const d of mine) await page.request.delete(BASE + "/api/v1/documents/" + d.id, { headers: { Origin: BASE } });

  /* ============================ a phone, signed in: the drawer ============================ */
  console.log("drawer on a phone");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".ws-rail").waitFor({ state: "hidden" });
  await page.locator("#hm-h").waitFor({ state: "attached" }).catch(() => {});
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator("#hm-h").waitFor();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + "16-home-phone.png" });
  ok(await noSideways(page), "no sideways scroll on the home screen at 390 px");
  await axe("home, phone", page);
  await page.getByRole("button", { name: "Open the menu" }).click();
  const drawer = page.getByRole("dialog", { name: "Menu" });
  await drawer.waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + "17-drawer-phone.png" });
  ok(await drawer.getByRole("link", { name: /My papers/ }).isVisible(), "the menu on a phone is the same rail, as a drawer");
  await axe("drawer open, phone", page);
  await page.keyboard.press("Escape");
  await drawer.waitFor({ state: "hidden" });
  ok(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Open the menu"), "Escape closes it and focus returns to the menu button");

  /* ============================ sign out returns to the intro ============================ */
  await page.setViewportSize({ width: 1360, height: 900 });
  await page.waitForTimeout(500);
  await page.locator(".ws-rail").getByRole("button", { name: "Sign out" }).click();
  await page.locator("#in-h1").waitFor({ timeout: 10000 });
  ok(true, "signing out returns to the intro page");

  /* ============================ the old look is untouched without the flag ============================ */
  console.log("without the flag");
  const octx = await newCtx();
  const op = await octx.newPage();
  watch(op);
  await op.goto(BASE + "/", { waitUntil: "networkidle" });
  await op.waitForTimeout(1500);
  ok(await op.locator(".topbar").count() === 1 && await op.locator(".in-head, .ws-rail").count() === 0, "without ?ws=1 the product looks and works as before");
  await op.goto(BASE + "/?ws=1", { waitUntil: "networkidle" });
  await op.locator("#in-h1").waitFor();
  ok(!new URL(op.url()).search.includes("ws="), "?ws=1 turns the new look on and disappears from the address");
  await op.goto(BASE + "/?ws=0", { waitUntil: "networkidle" });
  await op.waitForTimeout(1000);
  ok(await op.locator(".topbar").count() === 1, "?ws=0 turns it off again");
  await octx.close();

  ok(errors.length === 0, `no console or page errors${errors.length ? ": " + errors.slice(0, 4).join(" | ") : ""}`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
} finally {
  await browser.close();
  idp.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall workspace checks passed");
  process.exit(failures ? 1 : 0);
}
