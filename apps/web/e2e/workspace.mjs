// Browser e2e for the new look (phase W1, switched on with ?ws=1): the scroll-animated intro page, the home screen with its prompt box,
// the rail, the Library and Settings pages, My Workspace (the paper opens on the whole window; pen, highlighter, eraser, undo and redo, saved with the paper). Three themes, a phone, reduced motion.
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
const failedCalls = [];
const watch = (p) => {
  p.on("request", (r) => { if (/\/(meta|progress)$/.test(r.url())) failedCalls.push(`SENT ${r.method()} ${r.url()} ${r.postData()}`); });
  p.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/api/")) failedCalls.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`); });
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401|403|404|409)/.test(m.text())) errors.push("console: " + m.text()); });
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
  const html0 = await (await fetch(BASE + "/")).text();
  const preloads = [...html0.matchAll(/<link rel="preload" as="font" type="font\/woff2" href="([^"]+)"/g)].map((m) => m[1]);
  ok(preloads.length === 2 && preloads.some((u) => /inter-latin/.test(u)) && preloads.some((u) => /source-serif-4-latin/.test(u)), "the two fonts of the first screen are preloaded (no jump when they arrive)");
  const fontRes = await Promise.all(preloads.map((u) => fetch(BASE + u)));
  ok(fontRes.every((r) => r.ok && /font\/woff2/.test(r.headers.get("content-type") ?? "")), "and they are served as fonts");
  const ctx = await newCtx();
  await withFlag(ctx);
  const page = await ctx.newPage();
  globalThis.__page = page; // for the screenshot taken if something unexpected happens
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
  const chip = await page.locator(".in-herowin .in-chip").first().evaluate((el) => { const r = el.getBoundingClientRect(); const visible = [...el.children].find((c) => c.dataset.show === "true"); const k = visible.getBoundingClientRect(); const icon = visible.querySelector("svg").getBoundingClientRect(); return { pill: r.width, content: k.width, gapLeft: icon.left - r.left, gapRight: r.right - k.right }; });
  ok(chip.gapLeft < 14 && Math.abs(chip.pill - chip.content - 2 * 11.2) < 3, `the mode chip fits its words: the icon is ${Math.round(chip.gapLeft)} px from the left edge and the pill is no wider than its content (pill ${Math.round(chip.pill)} px, content ${Math.round(chip.content)} px)`);
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
  ok(/Auto/.test(await page.locator(".hm-mode").innerText()), "the box starts in Auto");
  await page.locator(".hm-mode").click();
  const menu = page.getByRole("menu", { name: "What should I do?" });
  await menu.waitFor();
  ok((await menu.getByRole("menuitemradio").count()) === 5, "the mode menu lists Auto and the four tools");
  ok(/^Auto/.test(await menu.getByRole("menuitemradio").first().innerText()) && await menu.getByRole("menuitemradio").first().getAttribute("aria-checked") === "true", "Auto comes first and is the one chosen");
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
  await page.locator(".chat-idea").waitFor({ timeout: 8000 });
  ok(new URL(page.url()).pathname === "/" && /glaucoma/.test(await page.locator(".chat-idea textarea").first().inputValue()), "Idea Check opens inside the conversation, with the idea already in it (the page does not move)");
  await page.locator(".ws-rail").getByRole("button", { name: "New chat" }).click();
  await page.locator(".hm-title").waitFor();

  // a second press on the chosen tool gives the choice back to Auto
  ok(/Idea Check/.test(await page.locator(".hm-mode").innerText()), "the tool stays chosen after an Idea Check was started in the conversation");
  await page.locator(".hm-pill", { hasText: "Check references" }).click();
  ok(/Check references/.test(await page.locator(".hm-mode").innerText()), "a pill chooses its tool");
  await page.locator(".hm-pill", { hasText: "Check references" }).click();
  ok(/Auto/.test(await page.locator(".hm-mode").innerText()), "pressing the chosen pill again gives the choice back to Auto");

  // a search from the box is a conversation: the question, the papers, a written answer (the full test of it is e2e/chat.mjs)
  await page.locator(".hm-pill", { hasText: "Search papers" }).click();
  await page.locator(".hm-input").fill("glaucoma screening");
  await page.keyboard.press("Enter");
  await page.locator(".chat-turn .result").first().waitFor({ timeout: 20000 });
  ok(await page.locator(".ws-rail").isVisible() && await page.locator(".chat-bubble").count() === 1, "a search from the home box becomes a conversation, inside the same frame");
  await page.locator('.chat-turn[data-status="done"]').waitFor({ timeout: 30000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + "12-chat-in-shell.png" });
  await axe("a conversation in the shell", page);
  await page.locator(".ws-rail").getByRole("button", { name: "New chat" }).click();
  await page.locator(".hm-title").waitFor();

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

  // My Workspace (the section of your own papers): the card is as before, a click opens it, the title draws a line, no "Open and ask" button
  await page.locator(".ws-rail").getByRole("link", { name: /My Workspace/ }).click();
  ok(await page.locator(".ws-rail").getByRole("link", { name: /My papers/ }).count() === 0, 'the section is called "My Workspace", not "My papers"');
  const note = page.getByRole("region", { name: /how your papers are handled/ });
  await note.waitFor();
  await note.getByRole("button", { name: "I understand, continue" }).click();
  await note.waitFor({ state: "detached", timeout: 8000 });
  ok(await page.locator(".vhead .eyebrow").first().innerText().then((t) => /My Workspace/i.test(t)), "the page's own heading says My Workspace");
  ok(await page.locator("footer.footer").count() === 0, "the list of sources at the foot is not shown in My Workspace");
  await page.locator('input[type="file"]').waitFor({ state: "attached" });
  await page.locator('input[type="file"]').setInputFiles({ name: "glaucoma_screening.pdf", mimeType: "application/pdf", buffer: makePdf(SAMPLE_PAPER, { title: "Glaucoma screening" }) });
  await page.locator(".dc").first().waitFor({ timeout: 40000 });
  await page.waitForFunction(() => document.querySelector(".dc")?.getAttribute("data-status") === "ready", null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + "15-papers.png" });
  ok((await page.locator(".dc").getByRole("button", { name: /open and ask/i }).count()) === 0, 'no "Open and ask" button on a paper card');
  ok((await page.locator(".dc .dc-open").count()) >= 1 && (await page.locator(".dc").first().getByRole("button", { name: /^Delete/ }).count()) === 1, "the card is otherwise as before: the cover opens it, rename and delete are there");
  ok((await page.locator(".dc").getByRole("button", { name: /^(Cite|Notes)/ }).count()) === 0, "and it has no Cite or Notes buttons");
  // the title draws a line under itself when the card is pointed at
  const scaleOf = () => page.locator(".dc .dc-title-t").first().evaluate((el) => new DOMMatrix(getComputedStyle(el, "::after").transform).a);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(600);
  const lineBefore = await scaleOf();
  await page.locator(".dc").first().hover();
  await page.waitForTimeout(700);
  const lineAfter = await scaleOf();
  ok(lineBefore === 0 && lineAfter === 1, `pointing at a card draws a line under its title (${lineBefore} then ${lineAfter})`);
  await page.screenshot({ path: OUT + "15b-papers-hover.png" });
  await axe("my workspace list", page);
  console.log("status, tags, progress, filters");
  const card0 = page.locator(".dc").first();
  ok(await card0.getByRole("button", { name: /^To read/ }).isVisible(), "a new paper says 'To read'");
  ok(await card0.locator(".dc-prog").count() === 0, "and has no progress bar until it is started");
  await card0.getByRole("button", { name: /^To read/ }).click();
  const ed = page.getByRole("dialog", { name: /Status and tags/ });
  await ed.waitFor();
  await ed.getByRole("button", { name: "Reading", exact: true }).click();
  await page.waitForFunction(() => /Reading/.test(document.querySelector(".meta-chip")?.textContent ?? ""));
  await ed.getByLabel("Add a tag").fill("Methods, thesis");
  await ed.getByLabel("Add a tag").press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".meta-tags li").length === 2);
  await ed.getByLabel("Add a tag").fill("METHODS");
  await ed.getByLabel("Add a tag").press("Enter");
  await page.waitForTimeout(400);
  ok(await ed.locator(".meta-tags li").count() === 2, "tags are added (several with commas), and the same tag in another case is not added twice");
  await page.screenshot({ path: OUT + "15c-status-tags.png" });
  await axe("status and tags popover", page);
  await page.keyboard.press("Escape");
  await ed.waitFor({ state: "detached" });
  ok(await page.locator(".dc .dc-tags li").count() === 2 && /Reading/.test(await page.locator(".dc .meta-chip").first().innerText()), "the card shows the status and the tags");
  const apiDoc = async () => (await (await page.request.get(BASE + "/api/v1/documents")).json()).items[0];
  const saved0 = await apiDoc();
  ok(saved0.readState === "reading" && saved0.tags.length === 2, "and they are saved with the paper, not only on the screen");
  await page.locator(".wfilters").first().getByRole("button", { name: /^Done/ }).click();
  await page.getByText("No paper matches this filter.").waitFor();
  await page.locator(".dc").first().waitFor({ state: "detached" });
  ok(true, "a filter with no match says so");
  await page.getByRole("button", { name: "Show all papers" }).click();
  await page.locator(".dc").first().waitFor();
  await page.locator(".wfilters").first().getByRole("button", { name: /^Reading/ }).click();
  ok(await page.locator(".dc").count() === 1, "the 'Reading' filter shows the paper");
  await page.locator(".wfilters").first().getByRole("button", { name: /^All/ }).click();
  await page.locator('.wfilters[aria-label="Show papers by tag"]').getByRole("button", { name: /^thesis/ }).click();
  ok(await page.locator(".dc").count() === 1, "a tag filter shows the paper that has it");
  await page.locator('.wfilters[aria-label="Show papers by tag"]').getByRole("button", { name: /^thesis/ }).click();
  ok(await noSideways(page), "no sideways scroll with the filters");

  console.log("search across papers");
  await page.locator("#ws-search").fill("ophthalmologists");
  await page.locator(".sres-item").first().waitFor({ timeout: 10000 });
  ok(await page.locator(".dgrid").count() === 0 && (await page.locator(".sres mark").count()) >= 1, "a search replaces the list with results, the searched word marked");
  await page.screenshot({ path: OUT + "15d-search.png" });
  await axe("search results", page);
  await page.locator("#ws-search").fill("zzzzqqqq");
  await page.getByText(/Nothing found for/).waitFor({ timeout: 10000 });
  ok(true, "a word that is nowhere says so");
  await page.locator("#ws-search").fill("ophthalmologists");
  await page.locator(".sres-item").first().waitFor({ timeout: 10000 });
  await page.locator(".sres-item").filter({ hasText: /page 2/ }).first().click();
  await page.waitForFunction(() => /^\/papers\/[a-f0-9]+$/.test(location.pathname), null, { timeout: 15000 });
  await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  await page.waitForFunction(() => document.getElementById("pdfv-page")?.value === "2", null, { timeout: 8000 });
  ok(true, "a result opens the paper on the page where the words are (page 2)");
  await page.waitForTimeout(1500); // the place is saved once the paper has settled on the page
  await page.getByRole("button", { name: /My Workspace/ }).first().click();
  await page.locator(".dc").first().waitFor();

  // a click on the card (the title area, not the cover) opens the paper
  await page.locator(".dc .dc-meta").first().click();
  await page.waitForFunction(() => /^\/papers\/[a-f0-9]+$/.test(location.pathname), null, { timeout: 15000 });
  ok(true, "a click on the card opens the paper");
  // it was last left on page 2 (the search result above), so it opens there; the drawing checks below start from page 1
  await page.getByText(/Continued from page 2/).waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Back to page 1" }).click();
  await page.waitForFunction(() => document.getElementById("pdfv-page")?.value === "1", null, { timeout: 8000 });
  await page.waitForTimeout(1200); // the smooth scroll has to finish before anything is drawn

  /* ---------- reading and drawing: the paper has the whole window ---------- */
  console.log("drawing");
  const docId = new URL(page.url()).pathname.split("/").pop();
  await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  ok(await page.locator(".ws-rail").count() === 0 && await page.getByRole("button", { name: "Open the menu" }).count() === 0, "while a paper is open the rail is not shown");
  ok(await page.locator("footer.footer").count() === 0, "and neither is the foot of the page");
  ok(await page.locator(".dw-head").getByRole("button", { name: /My Workspace/ }).isVisible(), "the paper's own header has the way back, named My Workspace");
  ok(await noSideways(page), "no sideways scroll while reading");
  await page.screenshot({ path: OUT + "20-reader.png" });
  await axe("reader without the rail", page);

  const drawBtn = page.getByRole("button", { name: /^Draw$/ });
  ok(await drawBtn.isVisible() && (await drawBtn.getAttribute("aria-pressed")) === "false", "the reader has a Draw button, and the tools are not in the way until it is pressed");
  await drawBtn.click();
  const bar = page.getByRole("toolbar", { name: "Draw on the paper" });
  await bar.waitFor();
  await page.waitForTimeout(500);
  ok((await drawBtn.getAttribute("aria-pressed")) === "true", "pressing it opens the drawing tools");
  for (const name of ["Select and read", "Pen", "Highlighter", "Eraser"]) ok(await bar.getByRole("button", { name }).isVisible(), `the toolbar has ${name}`);
  ok((await bar.getByRole("radio", { name: /Thin|Medium|Thick|Extra thick/ }).count()) === 4, "four sizes");
  ok((await bar.getByRole("radio", { name: /Black|Blue|Red|Green|Orange|Violet/ }).count()) === 6, "six pen colours");
  await bar.locator('[role=status]').filter({ hasText: "Saved" }).waitFor({ timeout: 8000 });
  ok(true, "it says the drawing is saved (nothing to save yet)");
  ok(await bar.getByRole("button", { name: "Pen" }).getAttribute("aria-pressed") === "true", "the pen is in hand when it opens");
  await page.screenshot({ path: OUT + "21-draw-open.png" });
  await axe("drawing tools open", page);

  const pageBox = async () => { const el = page.locator('.pdfp[data-page="1"]'); await el.scrollIntoViewIfNeeded(); return (await el.boundingBox()); };
  const drag = async (from, to, steps = 12) => { const b = await pageBox(); await page.mouse.move(b.x + b.width * from[0], b.y + b.width * from[1]); await page.mouse.down(); for (let i = 1; i <= steps; i++) await page.mouse.move(b.x + b.width * (from[0] + ((to[0] - from[0]) * i) / steps), b.y + b.width * (from[1] + ((to[1] - from[1]) * i) / steps) + Math.sin(i) * 3); await page.mouse.up(); };
  const strokesOnServer = async () => (await (await page.request.get(`${BASE}/api/v1/documents/${docId}/ink`)).json());
  const savedBar = () => bar.locator('[role=status]').filter({ hasText: "Saved" }).waitFor({ timeout: 8000 });

  // a pen stroke
  await drag([0.2, 0.2], [0.6, 0.26]);
  ok(await page.locator('.pdfp[data-page="1"] .ink-pen path[fill]:not(.ink-live)').count() === 1, "a pen stroke is drawn on the page");
  await savedBar();
  let srv = await strokesOnServer();
  ok(srv.strokes.length === 1 && srv.strokes[0].tool === "pen" && srv.strokes[0].page === 1 && srv.rev === 1, "and it is saved with the paper (a vector stroke on page 1, revision 1)");
  ok(srv.strokes[0].pts.length >= 9 && srv.strokes[0].pts.every((n) => Number.isFinite(n)), "with its points");
  await page.screenshot({ path: OUT + "22-pen.png" });

  // size and colour: a thick red stroke
  await bar.getByRole("radio", { name: "Extra thick" }).click();
  await bar.getByRole("radio", { name: "Red" }).click();
  await drag([0.2, 0.32], [0.6, 0.36]);
  await savedBar();
  srv = await strokesOnServer();
  ok(srv.strokes.length === 2 && srv.strokes[1].color === "red" && srv.strokes[1].w > srv.strokes[0].w * 2, `the size and colour chosen are used (red, ${srv.strokes[1]?.w} wide against ${srv.strokes[0]?.w})`);

  // a highlighter stroke goes in its own layer, multiplied into the page
  await page.keyboard.press("h");
  ok(await bar.getByRole("button", { name: "Highlighter" }).getAttribute("aria-pressed") === "true", "the letter H picks the highlighter");
  await drag([0.2, 0.42], [0.65, 0.42]);
  ok(await page.locator('.pdfp[data-page="1"] .ink-hl path:not(.ink-live)[stroke]').count() === 1, "a highlighter stroke is drawn in the highlighter layer");
  ok(await page.locator('.pdfp[data-page="1"] .ink-hl').evaluate((el) => getComputedStyle(el).mixBlendMode) === "multiply", "which multiplies into the page, like a marker");
  await savedBar();
  srv = await strokesOnServer();
  ok(srv.strokes.length === 3 && srv.strokes[2].tool === "highlighter", "and is saved");
  await page.screenshot({ path: OUT + "23-highlighter.png" });

  // undo and redo, by button and by key
  await bar.getByRole("button", { name: "Undo" }).click();
  ok(await page.locator('.pdfp[data-page="1"] .ink-hl path:not(.ink-live)[stroke]').count() === 0, "Undo takes the last stroke away");
  await bar.getByRole("button", { name: "Redo" }).click();
  ok(await page.locator('.pdfp[data-page="1"] .ink-hl path:not(.ink-live)[stroke]').count() === 1, "Redo brings it back");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  ok(await page.locator('.pdfp[data-page="1"] .ink-pen path[fill]:not(.ink-live)').count() === 1, "Ctrl+Z undoes, twice here (two strokes gone, one left)");
  await page.keyboard.press("Control+Shift+z");
  ok(await page.locator('.pdfp[data-page="1"] .ink-pen path[fill]:not(.ink-live)').count() === 2, "Ctrl+Shift+Z redoes");
  await page.keyboard.press("Control+y");
  ok(await page.locator('.pdfp[data-page="1"] .ink-hl path:not(.ink-live)[stroke]').count() === 1, "Ctrl+Y redoes too");
  await savedBar();
  srv = await strokesOnServer();
  ok(srv.strokes.length === 3, "after all that the saved drawing is the three strokes");

  // the eraser removes whole strokes, as one step that can be undone
  await page.keyboard.press("e");
  ok(await bar.getByRole("button", { name: "Eraser" }).getAttribute("aria-pressed") === "true", "the letter E picks the eraser");
  await bar.getByRole("radio", { name: "Thick", exact: true }).click();
  await drag([0.4, 0.14], [0.4, 0.5], 24);
  await page.waitForTimeout(200);
  ok(await page.locator('.pdfp[data-page="1"] .ink path:not(.ink-live)').count() === 0, "dragging the eraser across the strokes removes them all");
  await savedBar();
  ok((await strokesOnServer()).strokes.length === 0, "and the saved drawing is empty");
  await bar.getByRole("button", { name: "Undo" }).click();
  ok(await page.locator('.pdfp[data-page="1"] .ink path:not(.ink-live)').count() === 3, "one Undo brings back everything that one sweep erased");
  await savedBar();
  ok((await strokesOnServer()).strokes.length === 3, "and the saved drawing has it again");

  // it all stays when the paper is opened again
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('.pdfp[data-page="1"] .ink path:not(.ink-live)').length === 3, null, { timeout: 8000 });
  ok(true, "after opening the paper again the three strokes are there");
  await page.screenshot({ path: OUT + "24-reopened.png" });

  // with the tools closed, and with "select and read", the drawing layer does not take the pointer, so text can be selected
  ok(await page.locator('.pdfp[data-page="1"] .ink-pen').evaluate((el) => getComputedStyle(el).pointerEvents) === "none", "with the tools closed the drawing layer lets the pointer through to the text");
  await page.getByRole("button", { name: /^Draw$/ }).click();
  const bar2 = page.getByRole("toolbar", { name: "Draw on the paper" });
  await bar2.waitFor();
  ok(await page.locator('.pdfp[data-page="1"] .ink-pen').evaluate((el) => getComputedStyle(el).pointerEvents) === "auto", "with a drawing tool in hand it takes the pointer");
  await page.keyboard.press("v");
  ok(await bar2.getByRole("button", { name: "Select and read" }).getAttribute("aria-pressed") === "true", "the letter V picks select and read");
  ok(await page.locator('.pdfp[data-page="1"] .ink-pen').evaluate((el) => getComputedStyle(el).pointerEvents) === "none", "in which the drawing layer does not take the pointer");
  await page.keyboard.press("Escape");
  await bar2.waitFor({ state: "hidden", timeout: 5000 });
  ok(true, "Escape closes the tools");

  // another window drawing in between: this one is told, and shows the newer drawing
  await page.getByRole("button", { name: /^Draw$/ }).click();
  const bar3 = page.getByRole("toolbar", { name: "Draw on the paper" });
  await bar3.waitFor();
  const cur = await strokesOnServer();
  const other = await page.request.put(`${BASE}/api/v1/documents/${docId}/ink`, { headers: { Origin: BASE, "Content-Type": "application/json" }, data: { strokes: cur.strokes.slice(0, 1), rev: cur.rev } });
  ok(other.ok(), "(another window saves a smaller drawing)");
  await page.keyboard.press("p");
  await drag([0.2, 0.55], [0.5, 0.58]);
  await bar3.locator('[role=status]').filter({ hasText: /Updated from another window/ }).waitFor({ timeout: 8000 });
  ok(await page.locator('.pdfp[data-page="1"] .ink path:not(.ink-live)').count() === 2, "this window is told, shows the other window's drawing, and keeps the new stroke drawn here (what the other window erased does not come back)");
  await page.screenshot({ path: OUT + "25-conflict.png" });
  await page.keyboard.press("Escape");

  // dark and read themes with the tools open
  await page.getByRole("button", { name: /^Draw$/ }).click();
  await bar3.waitFor();
  for (const theme of ["dark", "read"]) {
    await setTheme(page, theme);
    await page.waitForTimeout(500);
    await page.screenshot({ path: OUT + `26-draw-${theme}.png` });
    await axe(`drawing tools, ${theme}`, page);
  }
  await setTheme(page, "light");
  await page.keyboard.press("Escape");

  console.log("shapes, text boxes, sticky notes and the lasso");
  await page.setViewportSize({ width: 1360, height: 1700 }); // the whole page on screen, so every point can be reached with the mouse
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: /^Draw$/ }).click();
  const bar4 = page.getByRole("toolbar", { name: "Draw on the paper" });
  await bar4.waitFor();
  for (const name of ["Line", "Arrow", "Rectangle", "Ellipse", "Text box", "Sticky note", "Lasso: select, move, delete"]) ok(await bar4.getByRole("button", { name }).isVisible(), `the toolbar has ${name}`);
  const items = async () => (await strokesOnServer()).strokes;
  // saving happens a moment after a change: wait until the server has it (not for a status that may still be showing the last save)
  const eventually = async (fn, what) => { const end = Date.now() + 10000; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await page.waitForTimeout(150); } throw new Error("timed out waiting for " + what); };
  const settle = async () => { await page.waitForTimeout(1600); await bar4.locator('[role=status]').filter({ hasText: "Saved" }).waitFor({ timeout: 8000 }); };
  const base0 = (await items()).length;

  // shapes
  await page.keyboard.press("r");
  await drag([0.2, 0.62], [0.45, 0.72]);
  await page.keyboard.press("o");
  await drag([0.5, 0.62], [0.75, 0.72]);
  await page.keyboard.press("a");
  await drag([0.2, 0.78], [0.45, 0.84]);
  await page.keyboard.press("l");
  await drag([0.5, 0.78], [0.75, 0.8]);
  await settle();
  const sh = (await items()).filter((i) => i.tool === "shape");
  ok(sh.map((i) => i.kind).join() === "rect,ellipse,arrow,line", `a rectangle, an ellipse, an arrow and a line are saved (${sh.map((i) => i.kind).join()})`);
  ok(await page.locator('.pdfp[data-page="1"] rect.ink-shape').count() === 1 && await page.locator('.pdfp[data-page="1"] ellipse.ink-shape').count() === 1 && await page.locator('.pdfp[data-page="1"] g.ink-shape polygon').count() === 1 && await page.locator('.pdfp[data-page="1"] line.ink-shape').count() === 1, "and drawn on the page as shapes (rectangle, ellipse, arrow with a head, line)");
  ok(sh.every((i) => i.pts.length === 6) && Math.abs(sh[0].pts[0] - 0.2) < 0.01 && Math.abs(sh[0].pts[3] - 0.45) < 0.01, "each is two points, where it was dragged");
  await page.keyboard.press("l");
  await page.mouse.move((await pageBox()).x + 100, (await pageBox()).y + 300);
  const bb = await pageBox();
  await page.keyboard.down("Shift");
  await page.mouse.move(bb.x + bb.width * 0.1, bb.y + bb.width * 0.9);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width * 0.4, bb.y + bb.width * 0.9 + 12, { steps: 8 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  await settle();
  const snapped = (await items()).filter((i) => i.tool === "shape").at(-1);
  ok(Math.abs(snapped.pts[1] - snapped.pts[4]) < 1e-3, "with Shift a line snaps to a straight angle (a slightly slanted drag came out level)");
  await page.screenshot({ path: OUT + "34-shapes.png" });
  await axe("shapes drawn", page);

  // a text box, in Hindi and English
  await page.keyboard.press("t");
  const pb = await pageBox();
  await page.mouse.click(pb.x + pb.width * 0.15, pb.y + pb.width * 0.95);
  const ta = page.getByRole("textbox", { name: "New text box" });
  await ta.waitFor();
  await ta.fill("Check this table\nमोतियाबिंद");
  await page.keyboard.press("Escape");
  await page.locator(".pdfp[data-page=\"1\"] .ink-text:not(textarea)").first().waitFor();
  await settle();
  const tx = (await items()).find((i) => i.tool === "text");
  ok(tx && tx.text === "Check this table\nमोतियाबिंद" && tx.size > 0 && tx.h > 0 && tx.w > 0, "a text box is typed in, in English and Hindi, and saved with its size");
  ok(await page.locator('.pdfp[data-page="1"] .ink-text:not(textarea)').first().innerText().then((x) => /मोतियाबिंद/.test(x)), "and shown on the page");
  // changed (with the hand), then undone
  await page.keyboard.press("v");
  await page.locator('.pdfp[data-page="1"] .ink-text:not(textarea)').first().click();
  const ta2 = page.getByRole("textbox", { name: "Edit the text box" });
  await ta2.waitFor();
  await ta2.fill("Changed words");
  await ta2.blur();
  await settle();
  ok((await items()).find((i) => i.tool === "text").text === "Changed words", "a text box can be edited");
  await page.keyboard.press("Control+z");
  await settle();
  ok((await items()).find((i) => i.tool === "text").text.startsWith("Check this table"), "Undo brings the old words back");
  await page.keyboard.press("Control+Shift+z");
  await settle();
  ok((await items()).find((i) => i.tool === "text").text === "Changed words", "and Redo the new ones");
  // emptied, so removed
  await page.locator('.pdfp[data-page="1"] .ink-text:not(textarea)').first().click();
  await page.getByRole("textbox", { name: "Edit the text box" }).fill("");
  await page.getByRole("textbox", { name: "Edit the text box" }).blur();
  await settle();
  ok((await items()).filter((i) => i.tool === "text").length === 0, "a text box that is emptied goes away");
  await page.keyboard.press("Control+z");
  await settle();
  ok((await items()).filter((i) => i.tool === "text").length === 1, "and Undo brings it back");

  // a sticky note
  await page.keyboard.press("n");
  await page.mouse.click(pb.x + pb.width * 0.85, pb.y + pb.width * 0.3);
  const st = page.getByRole("textbox", { name: "Words of the sticky note" });
  await st.waitFor();
  await st.fill("ask the supervisor about this");
  await st.blur();
  await settle();
  const stickyNote = (await items()).find((i) => i.tool === "sticky");
  ok(stickyNote && stickyNote.text === "ask the supervisor about this" && stickyNote.color === "yellow", "a sticky note is put down, written in, and saved");
  await page.screenshot({ path: OUT + "35-text-and-note.png" });
  await axe("text box and sticky note", page);

  // the lasso: choose the rectangle, move it, undo, delete it
  await page.keyboard.press("s");
  const before = (await items()).find((i) => i.tool === "shape" && i.kind === "rect");
  const lb = await pageBox();
  await page.mouse.move(lb.x + lb.width * 0.15, lb.y + lb.width * 0.58);
  await page.mouse.down();
  for (const [fx, fy] of [[0.8, 0.58], [0.8, 0.76], [0.15, 0.76], [0.15, 0.58]]) await page.mouse.move(lb.x + lb.width * fx, lb.y + lb.width * fy, { steps: 6 });
  await page.mouse.up();
  await page.locator(".ink-selbar").waitFor();
  ok(/2 selected/.test(await page.locator(".ink-selbar").innerText()), "a loop round the rectangle and the ellipse chooses both, and not the arrow and line below them");
  await page.keyboard.press("Escape");
  await page.mouse.move(lb.x + lb.width * 0.15, lb.y + lb.width * 0.6);
  await page.mouse.down();
  for (const [fx, fy] of [[0.47, 0.6], [0.47, 0.74], [0.15, 0.74], [0.15, 0.6]]) await page.mouse.move(lb.x + lb.width * fx, lb.y + lb.width * fy, { steps: 6 });
  await page.mouse.up();
  await page.locator(".ink-selbar").waitFor();
  ok(/1 selected/.test(await page.locator(".ink-selbar").innerText()) && await page.locator(".ink-sel").count() === 1, "a tighter loop chooses just the rectangle, shown with a dashed box and a bar");
  await page.screenshot({ path: OUT + "36-lasso.png" });
  await axe("lasso selection", page);
  const mid = [lb.x + lb.width * 0.325, lb.y + lb.width * 0.67];
  await page.mouse.move(mid[0], mid[1]);
  await page.mouse.down();
  await page.mouse.move(mid[0] + lb.width * 0.1, mid[1] + lb.width * 0.05, { steps: 10 });
  await page.mouse.up();
  await settle();
  const after = (await items()).find((i) => i.id === before.id);
  ok(Math.abs(after.pts[0] - before.pts[0] - 0.1) < 0.01 && Math.abs(after.pts[1] - before.pts[1] - 0.05) < 0.01 && Math.abs(after.pts[3] - after.pts[0] - (before.pts[3] - before.pts[0])) < 1e-3, `dragging inside the box moves it (by about 0.1 and 0.05 page widths: ${(after.pts[0] - before.pts[0]).toFixed(3)}, ${(after.pts[1] - before.pts[1]).toFixed(3)}) without changing its size`);
  await page.keyboard.press("Control+z");
  await settle();
  const undone = (await items()).find((i) => i.id === before.id);
  ok(undone.pts[0] === before.pts[0] && undone.pts[1] === before.pts[1], "Undo puts it back");
  await page.keyboard.press("Control+Shift+z");
  await settle();
  await page.keyboard.press("Delete");
  await settle();
  ok(!(await items()).some((i) => i.id === before.id), "Delete removes what the lasso chose");
  await page.keyboard.press("Control+z");
  await settle();
  ok((await items()).some((i) => i.id === before.id), "and Undo brings it back");
  // a click on a thing chooses just that thing; a click on nothing chooses nothing
  const nowRect = (await items()).find((i) => i.id === before.id);
  await page.mouse.click(lb.x + lb.width * ((nowRect.pts[0] + nowRect.pts[3]) / 2), lb.y + lb.width * nowRect.pts[1]);
  await page.waitForTimeout(150);
  await page.waitForTimeout(300);
  const clicked = { bars: await page.locator(".ink-selbar").count(), sel: await page.locator(".ink-sel").count(), tool: await page.locator(".pdfp[data-page=\"1\"] .ink-pen").getAttribute("data-tool"), rect: (await items()).find((i) => i.tool === "shape" && i.kind === "rect")?.pts };
  ok(/1 selected/.test(await page.locator(".ink-selbar").innerText({ timeout: 1000 }).catch(() => "")), `a click on a shape chooses it (${JSON.stringify(clicked)})`);
  await page.mouse.click(lb.x + lb.width * 0.9, lb.y + lb.width * 1.05);
  await page.waitForTimeout(150);
  ok(await page.locator(".ink-selbar").count() === 0, "a click on nothing chooses nothing");

  // the eraser takes them too
  await page.keyboard.press("e");
  const nShapes = (await items()).length;
  await page.mouse.move(lb.x + lb.width * 0.5, lb.y + lb.width * 0.79);
  await page.mouse.down();
  await page.mouse.move(lb.x + lb.width * 0.75, lb.y + lb.width * 0.79, { steps: 10 });
  await page.mouse.up();
  await settle();
  ok((await items()).length < nShapes, "the eraser removes a shape it touches");
  const left = (await items()).length;

  // it all comes back after a reload, and the toolbar closed, notes can be read
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  await page.locator('.pdfp[data-page="1"] .ink-text:not(textarea)').first().waitFor({ timeout: 10000 });
  ok((await items()).length === left && await page.locator('.pdfp[data-page="1"] .ink-shape').count() >= 3, "after a reload the shapes, text and notes are all still there");
  ok(await page.locator('.pdfp[data-page="1"] .ink-text').first().evaluate((el) => getComputedStyle(el).pointerEvents) === "none", "with the tools closed a text box does not take the pointer (the paper's own text can be selected under it)");
  await page.locator(".ink-sticky-btn").first().click();
  ok(/ask the supervisor/.test(await page.locator(".ink-sticky-read").innerText()), "and a sticky note can be opened and read");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1360, height: 900 });

  await page.getByRole("button", { name: /My Workspace/ }).first().click();
  await page.locator(".dc").first().waitFor();
  ok(await page.locator(".ws-rail").isVisible(), "going back to the list brings the rail back");

  console.log("resume, theme switch, home");
  await page.locator(".dc .dc-open").first().click();
  await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Next page" }).click();
  await page.waitForFunction(() => document.getElementById("pdfv-page")?.value === "2", null, { timeout: 8000 });
  await page.waitForTimeout(2600);
  await page.getByRole("button", { name: /My Workspace/ }).first().click();
  await page.locator(".dc").first().waitFor();
  await page.locator(".dc .dc-open").first().click();
  await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  await page.getByText(/Continued from page 2/).waitFor({ timeout: 8000 });
  ok(await page.evaluate(() => document.getElementById("pdfv-page").value) === "2", "a paper opens where the reader left it, and says so");
  await page.screenshot({ path: OUT + "27-resume.png" });
  await page.getByRole("button", { name: "Back to page 1" }).click();
  await page.waitForFunction(() => document.getElementById("pdfv-page")?.value === "1", null, { timeout: 8000 });
  ok(true, "'Back to page 1' goes to the start");
  await page.getByRole("button", { name: "Next page" }).click();
  await page.waitForFunction(() => document.getElementById("pdfv-page")?.value === "2", null, { timeout: 8000 });
  await page.getByRole("button", { name: "Next page" }).click();
  await page.waitForFunction(() => document.getElementById("pdfv-page")?.value === "3", null, { timeout: 8000 });
  await page.waitForTimeout(2600);
  const afterRead = await apiDoc();
  ok(afterRead.lastPage === 3 && afterRead.maxPage === 3 && afterRead.openedAt > 0, `the place is saved while reading (page ${afterRead.lastPage}, furthest ${afterRead.maxPage})`);
  // the theme switch in the empty top right of the reader
  const sw = page.locator(".dw-head-end");
  ok(await sw.getByRole("button", { name: "Dark theme" }).isVisible() && await sw.getByRole("button", { name: "Read theme" }).isVisible(), "the reader's header has the theme switch (Auto, Light, Dark, Read)");
  for (const [name, want] of [["Dark theme", "dark"], ["Read theme", "read"], ["Light theme", "light"]]) {
    await sw.getByRole("button", { name }).click();
    await page.waitForFunction((w) => document.documentElement.getAttribute("data-theme") === w, want, { timeout: 4000 });
    ok(await sw.getByRole("button", { name }).getAttribute("aria-pressed") === "true", `${name} applies at once and shows as chosen`);
  }
  await sw.getByRole("button", { name: "Dark theme" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + "28-reader-dark-switch.png" });
  await axe("reader header with the theme switch, dark", page);
  await sw.getByRole("button", { name: "Light theme" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  ok(await noSideways(page) && await sw.getByRole("button", { name: "Dark theme" }).isVisible(), "on a phone the switch is there and nothing runs off the side");
  await page.screenshot({ path: OUT + "29-reader-phone-header.png" });
  await page.setViewportSize({ width: 1360, height: 900 });
  // leaving the paper keeps the place
  await page.getByRole("button", { name: /My Workspace/ }).first().click();
  await page.locator(".dc").first().waitFor();
  await page.waitForTimeout(500);
  ok(/Page 3 of 3|Finished/.test(await page.locator(".dc .dc-prog").first().getAttribute("aria-label").catch(() => "") ?? ""), "the card now shows how far the paper has been read");
  await page.screenshot({ path: OUT + "30-card-progress.png" });

  const did = (await apiDoc()).id;
  const quote = "The model reached a sensitivity of 91 percent at a specificity of 88 percent";
  const made = await page.request.post(`${BASE}/api/v1/documents/${did}/notes`, { headers: { Origin: BASE }, data: { page: 3, quote, color: "green", note: "check this against the cataract subgroup" } });
  ok(made.ok(), "a highlight with a note is saved (for 'Remember this?')");
  await page.locator(".ws-rail").getByRole("link", { name: "Home", exact: true }).click();
  await page.locator(".hm-continue").waitFor({ timeout: 10000 });
  const contText = await page.locator(".hm-continue").innerText();
  ok(/Page 3 of 3/.test(contText), `Home has 'Continue reading' with the page the reader reached (${JSON.stringify(contText)})`);
  await page.locator(".hm-remember").waitFor({ timeout: 10000 });
  ok((await page.locator(".hm-rem-q").innerText()).includes("sensitivity of 91 percent") && /cataract subgroup/.test(await page.locator(".hm-remember").innerText()), "and 'Remember this?' with one of the reader's own highlights and its note");
  await page.screenshot({ path: OUT + "31-home-continue-remember.png" });
  await axe("home with continue and remember", page);
  await page.getByRole("button", { name: "Open at page 3" }).click();
  await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  await page.waitForFunction(() => document.getElementById("pdfv-page")?.value === "3", null, { timeout: 8000 });
  ok(true, "'Open at page 3' opens the paper there");
  await page.getByRole("button", { name: /My Workspace/ }).first().click();
  await page.locator(".dc").first().waitFor();
  await page.locator(".ws-rail").getByRole("link", { name: "Home", exact: true }).click();
  await page.locator(".hm-remember").waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Turn this off" }).click();
  await page.getByText(/“Remember this\?” is off/).waitFor();
  ok(await page.locator(".hm-remember").count() === 0, "'Turn this off' removes it, and says where to turn it on");
  await page.locator(".ws-rail").getByRole("link", { name: "Settings" }).click();
  const chk = page.getByRole("checkbox", { name: /Remember this/ });
  await chk.waitFor();
  ok(!(await chk.isChecked()), "Settings shows it as off");
  await chk.check();
  await page.locator(".ws-rail").getByRole("link", { name: "Home", exact: true }).click();
  await page.locator(".hm-remember").waitFor({ timeout: 10000 });
  ok(true, "and turning it on in Settings brings it back");
  await page.locator(".ws-rail").getByRole("link", { name: /My Workspace/ }).click();
  await page.locator(".dc").first().waitFor();

  console.log("highlights by colour (plain names), asking about them in the Ask box");
  const gradedQuote = "Images were graded by two ophthalmologists and disagreements were resolved by a third";
  ok((await page.request.post(`${BASE}/api/v1/documents/${did}/notes`, { headers: { Origin: BASE }, data: { page: 2, quote: gradedQuote, color: "pink" } })).ok(), "(a second highlight, pink, on page 2)");
  await page.locator(".dc .dc-open").first().click();
  await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  await page.locator(".dw-sidetabs").getByRole("tab", { name: /Notes/ }).click();
  const filter = page.getByRole("group", { name: "Show highlights by colour" });
  await filter.waitFor();
  ok(await filter.getByRole("button", { name: /^All 2/ }).isVisible() && await filter.getByRole("button", { name: /Pink 1/ }).isVisible() && await filter.getByRole("button", { name: /Green 1/ }).isVisible(), "the highlights have a filter by colour, each chip with the plain colour name and a count");
  ok(await filter.getByRole("button", { name: /Yellow 0/ }).isDisabled(), "a colour with no highlights is not offered");
  ok(await page.getByRole("button", { name: "Name the colours" }).count() === 0, "naming the colours is set aside: there is no such button");
  await filter.getByRole("button", { name: /Pink 1/ }).click();
  await page.locator(".dw-side:not([hidden]) .note[data-color=green]").waitFor({ state: "detached" });
  ok(await page.locator(".dw-side:not([hidden]) .note").count() === 1 && await page.locator(".dw-side:not([hidden]) .note").first().getAttribute("data-color") === "pink", "choosing a colour shows only those highlights");
  await filter.getByRole("button", { name: /^Pink 1/ }).click();
  await page.getByRole("group", { name: "Order of the list" }).getByRole("button", { name: "By colour" }).click();
  ok(await page.locator(".hl-group-sec").count() === 2, "'By colour' groups the list, a section for each colour in use");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
  const mdText = readFileSync(await dl.path(), "utf8");
  ok(/^# Notes on glaucoma screening/i.test(mdText) && /## Green \(1\)/.test(mdText) && /## Pink \(1\)/.test(mdText) && mdText.includes(gradedQuote + " (p. 2)"), "the Markdown download follows the grouping, with the plain colour names");
  await page.screenshot({ path: OUT + "32-highlights.png" });
  await axe("highlights by colour", page);
  ok(await page.getByLabel("Your question about your highlights").count() === 0, "there is no second box for asking about highlights: it is the Ask box");

  // the Ask box decides: a question about "my highlights" is answered from them, any other from the paper
  await page.locator(".dw-sidetabs").getByRole("tab", { name: /^Ask/ }).click();
  const askBox = page.locator("#ask-input");
  await askBox.fill("What did I highlight about the ophthalmologists who graded the images?");
  await askBox.press("Enter");
  await page.locator('.ask-answer[data-source="highlights"]').waitFor({ timeout: 20000 });
  ok(/From your highlights/.test(await page.locator('.ask-answer[data-source="highlights"]').innerText()) && /Every source is one of your highlights/.test(await page.locator('.ask-answer[data-source="highlights"]').innerText()), "a question about the reader's own highlights is answered from them, and says so");
  await page.screenshot({ path: OUT + "33-highlights-ask.png" });
  await page.waitForTimeout(700); // the question bubble has finished appearing (axe reads colours as they are drawn)
  await axe("answer from highlights in the Ask box", page);
  await page.locator('.ask-answer[data-source="highlights"] .ask-source').first().click();
  await page.waitForFunction(() => document.getElementById("pdfv-page")?.value === "2", null, { timeout: 8000 });
  ok(true, "a source in the answer goes to that page of the paper");
  await askBox.fill("Who graded the images in this study?");
  await askBox.press("Enter");
  await page.locator(".ask-answer:not([data-source])").first().waitFor({ timeout: 30000 });
  ok(await page.locator(".ask-answer").count() === 2 && await page.locator('.ask-answer[data-source="highlights"]').count() === 1, "any other question is answered from the paper, as before");
  await page.getByRole("button", { name: "Ask the paper instead" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".ask-answer").length === 3, null, { timeout: 30000 });
  ok(await page.locator('.ask-answer[data-source="highlights"]').count() === 1 && await page.locator(".ask-answer:not([data-source])").count() === 2, "'Ask the paper instead' asks the same question of the paper");
  await askBox.fill("An unanswerable question about the methods");
  await askBox.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".ask-answer").length === 4, null, { timeout: 30000 });
  ok(await page.getByRole("button", { name: "Ask my highlights instead" }).count() >= 1, "when the paper does not cover a question, the reader may ask their highlights instead");
  await page.getByRole("button", { name: /My Workspace/ }).first().click();
  await page.locator(".dc").first().waitFor();

  const mine = (await (await page.request.get(BASE + "/api/v1/documents")).json()).items;
  for (const d of mine) await page.request.delete(BASE + "/api/v1/documents/" + d.id, { headers: { Origin: BASE } });

  /* ============================ a phone, signed in: the drawer ============================ */
  console.log("command palette, shortcuts, focus mode");
  await page.reload({ waitUntil: "networkidle" });
  await page.locator('input[type="file"]').waitFor({ state: "attached" });
  await page.locator('input[type="file"]').setInputFiles({ name: "glaucoma_screening.pdf", mimeType: "application/pdf", buffer: makePdf(SAMPLE_PAPER, { title: "Glaucoma screening" }) });
  await page.waitForFunction(() => document.querySelectorAll(".dc").length === 1 && document.querySelector(".dc")?.getAttribute("data-status") === "ready", null, { timeout: 60000 });
  await page.locator('input[type="file"]').setInputFiles({ name: "methods_paper.pdf", mimeType: "application/pdf", buffer: makePdf(["Methods of the second study. We interviewed forty farmers about tractor sensor calibration drift in the monsoon.", "Results of the second study. Calibration drift was worst in July."], { title: "Methods paper" }) });
  await page.waitForFunction(() => document.querySelectorAll(".dc").length === 2 && [...document.querySelectorAll(".dc")].every((c) => c.getAttribute("data-status") === "ready"), null, { timeout: 60000 });
  await page.keyboard.press("Control+k");
  const pal = page.getByRole("combobox", { name: "Search commands, papers and pages" });
  await pal.waitFor({ timeout: 8000 }).catch(async (e) => {
    console.log("        palette did not open:", JSON.stringify(await page.evaluate(() => ({ dialogs: document.querySelectorAll("[role=dialog]").length, palette: !!document.querySelector(".palette"), active: document.activeElement?.tagName + "." + document.activeElement?.className, overlay: !!document.querySelector(".overlay") }))));
    throw e;
  });
  ok(await page.getByRole("dialog").count() === 1 && await pal.evaluate((el) => el === document.activeElement), "Ctrl+K opens the command palette with the cursor in its box");
  ok(await page.getByRole("option").count() >= 8 && await page.getByRole("group", { name: "Go to" }).isVisible() && await page.getByRole("group", { name: "Your papers" }).isVisible(), "it lists where to go, the themes and the reader's own papers");
  await page.screenshot({ path: OUT + "37-palette.png" });
  await axe("command palette", page);
  await pal.fill("dark");
  ok(await page.getByRole("option").first().innerText().then((x) => /Dark theme/.test(x)), "typing 'dark' finds the dark theme");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "dark", null, { timeout: 4000 });
  await page.getByRole("dialog").waitFor({ state: "detached" });
  ok(true, "Enter does it and closes the palette");
  await page.keyboard.press("Control+k");
  await pal.fill("light th");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.documentElement.getAttribute("data-theme") === "light", null, { timeout: 4000 });
  await page.keyboard.press("Control+k");
  await pal.fill("zzzzqq");
  ok(await page.getByRole("option").count() === 1 && /Search my papers, highlights and notes for/.test(await page.getByRole("option").first().innerText()), "a word that is no command offers to search the papers for it, and nothing else");
  await pal.fill("q");
  ok(await page.getByText(/Nothing matches/).isVisible(), "a letter that matches nothing says so");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  ok(true, "Esc closes it");
  await page.keyboard.press("Control+k");
  await pal.fill("methods");
  ok(await page.getByRole("option", { name: /methods paper/i }).isVisible(), "a paper is found by its title");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => /^\/papers\/[a-f0-9]+$/.test(location.pathname), null, { timeout: 15000 });
  await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  ok(await page.locator(".dw-title").innerText().then((x) => /methods/i.test(x)), "choosing it opens that paper");
  // palette commands for the paper that is open
  await page.keyboard.press("Control+k");
  await pal.fill("2");
  ok(await page.getByRole("option", { name: /Go to page 2 of 2/ }).isVisible(), "in a paper, a number offers 'Go to page'");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.getElementById("pdfv-page")?.value === "2", null, { timeout: 8000 });
  await page.keyboard.press("Control+k");
  await pal.fill("focus");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".dw")?.getAttribute("data-focus") === "true", null, { timeout: 4000 });
  ok(await page.locator(".dw-ask").evaluate((el) => getComputedStyle(el).display) === "none", "'Focus mode' puts the side panel away so the paper has the whole window");
  await page.screenshot({ path: OUT + "38-focus.png" });
  await page.locator(".palette").waitFor({ state: "detached", timeout: 8000 }); // the palette has finished closing (F is not a shortcut while a text box has the keys)
  await axe("focus mode", page);
  await page.keyboard.press("f");
  await page.waitForFunction(() => document.querySelector(".dw")?.getAttribute("data-focus") === "false", null, { timeout: 4000 });
  ok(await page.locator(".dw-ask").isVisible(), "the letter F brings it back");
  await page.getByRole("button", { name: "Focus mode" }).click();
  ok(await page.getByRole("button", { name: "Focus mode" }).getAttribute("aria-pressed") === "true", "and the Focus button does the same");
  await page.getByRole("button", { name: "Focus mode" }).click();

  // the list of shortcuts
  await page.keyboard.press("Shift+?");
  const keys = page.getByRole("dialog", { name: /Keyboard shortcuts/ });
  await keys.waitFor();
  ok(await keys.getByText("Command palette: go anywhere").isVisible() && await keys.getByText("Lasso: loop round things").isVisible(), "? opens the list of shortcuts, with the drawing keys in it");
  await page.waitForTimeout(600); // the dialog has finished fading in (axe reads colours as they are drawn)
  await axe("keyboard shortcuts", page);
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  ok(true, "Esc closes the list of shortcuts too");

  // two papers side by side is set aside (decision of 25 Oct): no button, no command
  ok(await page.getByRole("button", { name: "Open another paper beside this one" }).count() === 0, "two papers side by side is set aside: no button for it in the reader");
  await page.keyboard.press("Control+k");
  await pal.fill("beside");
  ok(await page.getByRole("option", { name: /beside this one/ }).count() === 0, "and no command for it in the palette");
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });

  // "search my papers" from the palette, with the list already open
  await page.getByRole("button", { name: /My Workspace/ }).first().click();
  await page.locator(".dc").first().waitFor();
  await page.keyboard.press("Control+k");
  await pal.fill("tractor");
  await page.getByRole("option", { name: /Search my papers, highlights and notes for/ }).click();
  await page.locator(".sres-item").first().waitFor({ timeout: 10000 });
  ok(await page.locator("#ws-search").inputValue() === "tractor" && (await page.locator(".sres-item").count()) >= 1, "'Search my papers for …' fills the search of My Workspace and shows the results");
  await page.locator("#ws-search").fill("");
  for (const d of (await (await page.request.get(BASE + "/api/v1/documents")).json()).items.filter((d) => /methods/i.test(d.title))) await page.request.delete(BASE + "/api/v1/documents/" + d.id, { headers: { Origin: BASE } });

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
  ok(await drawer.getByRole("link", { name: /My Workspace/ }).isVisible(), "the menu on a phone is the same rail, as a drawer");
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

  /* ============================ the new look is the default (W6); ?ws=0 is the way back ============================ */
  console.log("the default and the way back");
  const octx = await newCtx();
  const op = await octx.newPage();
  watch(op);
  await op.goto(BASE + "/", { waitUntil: "networkidle" });
  await op.locator("#in-h1").waitFor({ timeout: 10000 });
  ok(await op.locator(".topbar").count() === 0, "with nothing set, a new visitor gets the new look");
  await op.goto(BASE + "/?ws=0", { waitUntil: "networkidle" });
  await op.locator(".topbar").waitFor({ timeout: 10000 });
  ok(await op.locator(".in-head, .ws-rail").count() === 0 && !new URL(op.url()).search.includes("ws="), "?ws=0 shows the old pages and disappears from the address");
  await op.reload({ waitUntil: "networkidle" });
  await op.locator(".topbar").waitFor({ timeout: 10000 });
  ok(true, "and the old pages are remembered in this browser");
  await op.goto(BASE + "/?ws=1", { waitUntil: "networkidle" });
  await op.locator("#in-h1").waitFor({ timeout: 10000 });
  ok(!new URL(op.url()).search.includes("ws="), "?ws=1 returns to the new look and disappears from the address");
  await op.reload({ waitUntil: "networkidle" });
  await op.locator("#in-h1").waitFor({ timeout: 10000 });
  ok(await op.locator(".topbar").count() === 0, "and the new look is what a reload shows");
  await octx.close();

  const sctx = await newCtx();
  await sctx.addInitScript(() => { try { localStorage.setItem("scholar.ws", "1"); } catch {} });
  const sp = await sctx.newPage();
  await sp.goto(BASE + "/", { waitUntil: "networkidle" });
  await sp.locator("#in-h1").waitFor({ timeout: 10000 });
  ok(true, "someone who turned the new look on before W6 (the old stored value) still gets it");
  await sctx.close();

  ok(errors.length === 0, `no console or page errors${errors.length ? ": " + errors.slice(0, 4).join(" | ") : ""}`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  await globalThis.__page?.screenshot({ path: OUT + "zz-failure.png" }).catch(() => {});
  console.log("        errors seen so far:", errors.slice(0, 6), "failed calls:", failedCalls.slice(-6));
  failures++;
} finally {
  await browser.close();
  idp.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall workspace checks passed");
  process.exit(failures ? 1 : 0);
}
