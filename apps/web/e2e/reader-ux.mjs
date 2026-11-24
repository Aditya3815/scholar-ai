// Browser e2e for three fixes in the new Paper Reader (21 Nov 2026), written for READER "on" (scripts/lib/suites.mjs runs it in --run=reader-on):
//   1. a paper that could not be loaded: the download cut off (tried once more by itself, then "We couldn't load this paper" with Try again, Reload page and the way back, the browser's
//      words under Technical details); Try again recovers without a reload; offline says so and loads by itself when the connection is back; a lazy chunk or the pdf.js worker that
//      is gone (a page left open across a deploy) loads the page again, once;
//   2. Contents: opened on the reader's section (in sight and focused), the arrows keep the focus in sight, a fade says more is below, the list stays inside a short window; axe;
//   3. All pages: no ↑ ↓ buttons; a row dragged by the mouse (a line where it goes, Esc puts it back), by its grip's keys (Space, arrows, Space; Esc), each move said and saved on the
//      server; axe in Light, Dark and Read; a phone.
// With UX_SHOTS=<folder> it takes the owner's pictures.
//   node e2e/reader-ux.mjs [baseUrl]    (default http://localhost:8788; READER must be on there)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { makePdfLines } from "@scholar/test-support/make-pdf.mjs";
import { BASE, REFUSED_OR_BUSY, axeCheck, countFailure, desk, finish, launch, noSideways, ok, phone, setTheme, sleep, startIdp, until } from "./lib/browser.mjs";

const SHOTS = process.env.UX_SHOTS ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = async (target, name) => {
  if (SHOTS) await target.screenshot({ path: join(SHOTS, `${name}.png`) });
};
const idp = await startIdp();
idp.setUser({ sub: "reader-ux-1", email: "meera.ux@example.edu", email_verified: true, name: "Meera U" });
const browser = await launch();
const errors = [];
// this suite cuts the paper's download and takes chunks away on purpose: what the browser says about those is what the page is meant to meet
const MEANT = new RegExp(`${REFUSED_OR_BUSY.source}|net::ERR_FAILED|net::ERR_INTERNET_DISCONNECTED|net::ERR_ABORTED|Failed to fetch|dynamically imported module|fake worker|Failed to load resource`);
const watch = (p) => {
  p.on("pageerror", (e) => !MEANT.test(String(e)) && errors.push(`pageerror: ${e}`));
  p.on("console", (m) => m.type() === "error" && !MEANT.test(m.text()) && errors.push(`console: ${m.text()}`));
};
const axe = (p, label, context) => axeCheck(p, label, { inlineCites: true, context });

// a paper with twenty-four headings on twenty-four pages, so that Contents has more than fits
const SECTIONS = ["Aims", "Background", "Cohort", "Data", "Ethics", "Findings", "Grading", "Harms", "Imaging", "Judging", "Kappa", "Limits", "Methods", "Numbers", "Outcomes", "Power", "Quality", "Results", "Sampling", "Tests", "Uptake", "Validity", "Weights", "Yield"];
const pdf = makePdfLines(
  SECTIONS.map((name, k) => [
    ...(k === 0 ? [{ text: "Glaucoma Screening across Ten Clinics", size: 20 }, { text: "A. Author and B. Writer", size: 12, gap: 6 }] : []),
    { text: `${k + 1} ${name}`, size: 14, gap: 16 },
    { text: "Participants were recruited from hospitals and followed for twelve months in this part of the study.", gap: 2 },
    { text: "Images were graded by two ophthalmologists and disagreements were resolved by a third grader.", gap: 2 },
  ]),
  { title: "Glaucoma Screening across Ten Clinics" },
);

try {
  /* ================================================================ sign in, one paper */
  const c0 = await browser.newContext(desk(1280, 800));
  const p0 = await c0.newPage();
  watch(p0);
  await p0.goto(BASE + "/", { waitUntil: "networkidle" });
  await p0.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
  await p0.getByRole("button", { name: "Continue with Google" }).last().click();
  await p0.locator("#hm-h").waitFor({ timeout: 20000 });
  await sleep(800);
  await p0.goto(BASE + "/papers", { waitUntil: "networkidle" });
  const handled = p0.getByRole("region", { name: /how your papers are handled/ });
  if (await handled.count()) {
    await handled.getByRole("button", { name: "I understand, continue" }).click();
    await handled.waitFor({ state: "detached", timeout: 8000 });
  }
  await p0.locator('input[type="file"]').waitFor({ state: "attached" });
  await p0.locator('input[type="file"]').setInputFiles({ name: "ten_clinics.pdf", mimeType: "application/pdf", buffer: pdf });
  await p0.waitForFunction(() => document.querySelector(".dc")?.getAttribute("data-status") === "ready", null, { timeout: 60000 });
  const docId = (await (await p0.request.get(BASE + "/api/v1/documents")).json()).items.sort((a, b) => b.createdAt - a.createdAt)[0].id;
  const state = await c0.storageState();
  await c0.close();
  const api = (await browser.newContext({ storageState: state })).request;
  const FILE = `**/api/v1/documents/${docId}/file*`;

  const context = async (vp, theme = "light") => {
    const ctx = await browser.newContext({ ...vp, storageState: state, colorScheme: "light" });
    await ctx.addInitScript((t) => {
      try {
        if (sessionStorage.getItem("__seeded")) return;
        sessionStorage.setItem("__seeded", "1");
        localStorage.setItem("theme", t);
      } catch {
        /* no storage */
      }
    }, theme);
    return ctx;
  };
  const painted = (page) => page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  const openReader = async (vp, theme = "light") => {
    const ctx = await context(vp, theme);
    const page = await ctx.newPage();
    watch(page);
    await page.goto(BASE + "/papers/" + docId, { waitUntil: "networkidle" });
    await page.locator(".desk").waitFor({ timeout: 20000 });
    await painted(page);
    await sleep(500);
    return { ctx, page };
  };

  // UX_ONLY=allpages runs only part 3, while it is worked on
  if (process.env.UX_ONLY !== "allpages") {
  /* ================================================================ 1. a paper that could not be loaded */
  console.log("1. the paper could not be loaded");
  {
    const ctx = await context(desk(1160, 700), "dark");
    const page = await ctx.newPage();
    watch(page);
    let asked = 0;
    await page.route(FILE, (r) => (asked++, r.abort("failed")));
    await page.goto(BASE + "/papers/" + docId, { waitUntil: "domcontentloaded" });
    const failed = page.locator(".load-failed");
    await failed.waitFor({ timeout: 30000 });
    ok(asked >= 2, `a download cut off is tried once more by itself before anything is said (${asked} requests)`);
    const text = (await failed.innerText()).replace(/\s+/g, " ");
    ok(text.includes("We couldn't load this paper") && text.includes("Check your connection and try again.") && !/^Failed to fetch$/m.test(await failed.locator("p").last().innerText()), `human words, not the browser's ("${text.slice(0, 120)}")`);
    ok((await failed.getByRole("button", { name: "Try again" }).count()) === 1 && (await failed.getByRole("button", { name: "Reload page" }).count()) === 1 && (await failed.getByRole("button", { name: /^Back to / }).count()) === 1, "Try again, Reload page and the way back");
    ok((await failed.locator("details.load-detail").getAttribute("open")) === null && /fetch|network|ERR/i.test(await failed.locator("details.load-detail code").textContent()), "the browser's own words are folded under Technical details");
    ok((await failed.getAttribute("role")) === "alert", "it is said (role alert)");
    await sleep(400);
    await shot(page, "error-state-dark");
    await axe(page, "the paper could not be loaded, Dark");
    await setTheme(page, "light");
    await shot(page, "error-state-light");
    await axe(page, "the paper could not be loaded, Light");
    await setTheme(page, "read");
    await axe(page, "the paper could not be loaded, Read");
    await setTheme(page, "dark");
    // Try again recovers, without a reload
    await page.evaluate(() => (window.__noReload = true));
    await page.unroute(FILE);
    await failed.getByRole("button", { name: "Try again" }).click();
    await painted(page);
    ok(await page.evaluate(() => window.__noReload === true), "Try again opens the paper, without a reload");
    // offline: said so, and loaded by itself when the connection is back
    await page.route(FILE, (r) => r.abort("internetdisconnected"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await failed.waitFor({ timeout: 30000 });
    await ctx.setOffline(true);
    await failed.getByRole("button", { name: "Try again" }).click();
    await page.locator(".load-failed[data-offline]").waitFor({ timeout: 15000 });
    ok((await failed.innerText()).includes("You're offline"), "offline, it says so");
    await shot(page, "error-state-offline");
    await page.unroute(FILE);
    await ctx.setOffline(false);
    await painted(page);
    ok(true, "back online, the paper loads by itself");
    await ctx.close();
  }
  // a chunk that is gone (a page left open across a deploy): the page loads itself again, once, and the paper opens. The stale page (the first load) is refused the file; the new one
  // (after the reload) gets it, as a fresh page after a deploy names files that exist.
  for (const [what, pattern] of [
    ["the PDF viewer's chunk", "**/assets/PdfViewer-*.js"],
    ["the pdf.js worker", "**/pdf.worker*.mjs"],
  ]) {
    const ctx = await context(desk(1280, 800));
    const page = await ctx.newPage();
    watch(page);
    let navs = 0;
    page.on("framenavigated", (f) => f === page.mainFrame() && navs++);
    let gone = 0;
    await page.route(pattern, (r) => (navs <= 1 ? (gone++, r.fulfill({ status: 404, body: "gone" })) : r.continue()));
    await page.goto(BASE + "/papers/" + docId, { waitUntil: "domcontentloaded" });
    await painted(page);
    ok(gone >= 1 && navs === 2, `${what} gone after a deploy: the page loads itself again, once, and the paper opens (refused ${gone} times, ${navs} page loads)`);
    ok(await page.evaluate(() => Number(sessionStorage.getItem("scholar.chunkReload")) > 0), "the reload is remembered for this tab, so it cannot loop");
    await ctx.close();
  }
  // still gone after the reload: no loop; the page says what happened, with Reload page
  {
    const ctx = await context(desk(1280, 800));
    const page = await ctx.newPage();
    watch(page);
    let navs = 0;
    page.on("framenavigated", (f) => f === page.mainFrame() && navs++);
    await page.route("**/pdf.worker*.mjs", (r) => r.fulfill({ status: 404, body: "gone" }));
    await page.goto(BASE + "/papers/" + docId, { waitUntil: "domcontentloaded" });
    await page.locator(".load-failed").waitFor({ timeout: 30000 });
    await sleep(1500);
    ok(navs === 2 && (await page.locator(".load-failed").innerText()).includes("Reload the page"), `still gone after the reload: no loop (${navs} page loads); it asks for a reload in words`);
    await shot(page, "error-state-stale");
    await ctx.close();
  }

  /* ================================================================ 2. Contents */
  console.log("2. Contents");
  for (const theme of ["light", "dark", "read"]) {
    const { ctx, page } = await openReader(desk(1280, 800), theme);
    await page.locator("#pdfv-page").fill("16");
    await page.keyboard.press("Enter");
    await until(async () => (await page.locator("#pdfv-page").inputValue()) === "16", { ms: 6000, what: "page 16" });
    await sleep(1500);
    await page.getByRole("button", { name: "Contents" }).click();
    const toc = page.locator(".toc");
    await toc.waitFor();
    await sleep(450);
    const n = await page.locator(".toc-item").count();
    const seen = await toc.evaluate((el) => {
      const cur = el.querySelector('[aria-current="location"]');
      const a = el.getBoundingClientRect();
      const b = cur?.getBoundingClientRect();
      return { title: cur?.textContent ?? "", inside: !!b && b.top >= a.top && b.bottom <= a.bottom, scrolled: el.scrollTop > 0, focused: document.activeElement === cur, more: el.dataset.more ?? "" };
    });
    ok(n >= 12 && seen.title.includes("16") && seen.inside && seen.scrolled && seen.focused, `${theme}: Contents opens on the reader's section, in sight and focused (${n} entries; ${JSON.stringify(seen)})`);
    ok(seen.more === "both" || seen.more === "end" || seen.more === "start", `${theme}: a fade says more is above or below (${seen.more})`);
    if (theme === "light") {
      // the arrows move the focus, which stays in sight; the outline is drawn
      for (let k = 0; k < 6; k++) await page.keyboard.press("ArrowDown");
      const f = await toc.evaluate((el) => {
        const cur = document.activeElement;
        const a = el.getBoundingClientRect();
        const b = cur.getBoundingClientRect();
        return { cls: cur.className, inside: b.top >= a.top - 1 && b.bottom <= a.bottom + 1, outline: getComputedStyle(cur).outlineStyle };
      });
      ok(f.cls === "toc-item" && f.inside && f.outline !== "none", `↓ moves the focus down the list, kept in sight with its outline (${JSON.stringify(f)})`);
      await page.keyboard.press("End");
      ok(await toc.evaluate((el) => el.dataset.more === "start"), "at the end, the fade is only at the top");
      const thumb = await toc.evaluate((el) => {
        const s = getComputedStyle(el, "::-webkit-scrollbar");
        return { width: s.width, buttons: getComputedStyle(el, "::-webkit-scrollbar-button").display };
      });
      ok(thumb.width === "10px", `the Contents list has the thin themed scrollbar (${JSON.stringify(thumb)})`);
    }
    await page.keyboard.press("Home");
    await sleep(200);
    await shot(page.locator(".pop").first(), `contents-${theme}`);
    if (theme !== "light") {
      await page.keyboard.press("End");
      await sleep(150);
    }
    await axe(page, `Contents, ${theme}`, ".pop");
    await page.keyboard.press("Escape");
    await ctx.close();
  }
  // a short window and a phone: the list stays inside the window
  for (const [label, vp] of [["844x390 phone on its side", phone(844, 390)], ["390x844 phone", phone(390, 844)], ["1280x520 short window", desk(1280, 520)]]) {
    const { ctx, page } = await openReader(vp);
    await page.getByRole("button", { name: "Contents" }).click();
    await page.locator(".toc").waitFor();
    await sleep(450);
    const box = await page.locator(".pop").first().boundingBox();
    const h = page.viewportSize().height;
    ok(box.y >= 0 && box.y + box.height <= h + 1, `${label}: the Contents pop-over stays inside the window (${Math.round(box.y)} to ${Math.round(box.y + box.height)} of ${h})`);
    ok(await noSideways(page), `${label}: no sideways scroll`);
    if (label.startsWith("844")) await shot(page, "contents-phone-landscape");
    await ctx.close();
  }

  }

  /* ================================================================ 3. All pages: drag to reorder */
  console.log("3. All pages");
  const pagesOnServer = async () => (await (await api.get(`${BASE}/api/v1/documents/${docId}/notebook`)).json()).pages.map((p) => p.title);
  {
    const { ctx, page } = await openReader(desk(1280, 800));
    await page.locator(".nb-bar").waitFor({ timeout: 10000 });
    const tabs = page.getByRole("tablist", { name: "Pages" }).getByRole("tab");
    const order = async () => (await tabs.allInnerTexts()).map((t) => t.trim()).join(",");
    // the starter page is kept only once it holds something (an untouched one can give way to the pages saved on the server): a line written on it, saved
    await page.locator(".nb-field").first().click();
    await page.keyboard.type("First notes");
    await page.locator(".nb-save").filter({ hasText: /^Saved/ }).waitFor({ timeout: 10000 });
    for (let k = 0; k < 5; k++) {
      await page.getByRole("button", { name: "Add a page" }).click();
      await page.getByRole("dialog", { name: "Choose paper for the new page" }).getByRole("button", { name: ["Plain", "Ruled", "Dotted", "Graph"][k % 4] }).click();
      await sleep(250);
    }
    await until(async () => (await order()) === "Notes,Page 2,Page 3,Page 4,Page 5,Page 6", { ms: 6000, what: "six pages" }).catch(async (e) => {
      throw new Error(`${e.message} (the tabs: ${await order()})`);
    });
    // no wait for the new pages' first saves: a page moved while its first save is on the way keeps its new place (lib/notebook.ts)
    await page.setViewportSize({ width: 1024, height: 800 });
    const allBtn = page.getByRole("button", { name: /^All pages/ });
    await allBtn.waitFor({ timeout: 5000 });
    await allBtn.click();
    const list = page.getByRole("dialog", { name: "All pages" });
    await list.locator(".nb-ap-grip").first().waitFor({ timeout: 5000 });
    const names = async () => (await list.locator(".nb-ap-name").allInnerTexts()).map((t) => t.trim()).join(",");
    ok((await list.locator(".nb-ap-mv").count()) === 0 && (await list.getByRole("button", { name: /^Move / }).count()) === 0, "no ↑ ↓ buttons on the rows");
    ok((await list.locator(".nb-ap-grip").count()) === 6 && (await list.getByRole("button", { name: "Reorder Page 4" }).count()) === 1, "a grip on each row (Reorder <page>)");
    ok(await page.evaluate(() => document.activeElement?.closest(".nb-ap-open")?.getAttribute("aria-current") === "page"), "opened, the focus is on the open page's row");
    await sleep(200);
    await shot(page.locator("#dw-panel-side"), "allpages-light");

    // the mouse: Page 6 dragged by its row to the top (a line where it goes), then dropped
    const row = (name) => list.locator("li", { has: page.locator(".nb-ap-name", { hasText: new RegExp(`^${name}$`) }) });
    const from = await row("Page 6").boundingBox();
    const to = await row("Notes").boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - ((from.y - to.y + 6) * i) / 10);
    ok((await list.locator("li[data-lifted]").count()) === 1 && (await list.locator('li[data-line="before"]').count()) === 1, "a dragged row is lifted, and a line shows where it will go");
    await shot(page.locator("#dw-panel-side"), "allpages-dragging");
    await page.mouse.up();
    await until(async () => (await names()) === "Page 6,Notes,Page 2,Page 3,Page 4,Page 5", { ms: 4000, what: "Page 6 to go first" });
    ok((await list.count()) === 1, "a drag does not open the page, and the list stays open");
    await until(async () => ((await page.locator("[data-announcer]").allTextContents()).join(" ")).includes("Page 6 moved to position 1 of 6"), { ms: 8000, what: "the move to be said" });
    ok(true, "the move is said: Page 6 moved to position 1 of 6");
    // Esc during a drag puts it back, and the list stays open
    const r2 = await row("Page 2").boundingBox();
    await page.mouse.move(r2.x + 12, r2.y + r2.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(r2.x + 12, r2.y + r2.height / 2 + i * 12);
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await sleep(300);
    ok((await names()) === "Page 6,Notes,Page 2,Page 3,Page 4,Page 5" && (await list.count()) === 1, "Esc during a drag puts the row back; the list stays open");

    // the keyboard: Space on Page 5's grip picks it up, ↑ ↑ moves it, Space drops it
    await list.getByRole("button", { name: "Reorder Page 5" }).focus();
    await page.keyboard.press("Space");
    await until(async () => ((await page.locator("[data-announcer]").allTextContents()).join(" ")).includes("Picked up Page 5"), { ms: 8000, what: "the pick-up to be said" });
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    ok((await list.locator("li[data-held]").count()) === 1 && (await names()) === "Page 6,Notes,Page 2,Page 5,Page 3,Page 4" && (await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Reorder Page 5", "held by the keyboard, the page is shown where it would go, the focus on its grip");
    await shot(page.locator("#dw-panel-side"), "allpages-keyboard-held");
    await page.keyboard.press("Space");
    await until(async () => ((await page.locator("[data-announcer]").allTextContents()).join(" ")).includes("Page 5 moved to position 4 of 6"), { ms: 12000, what: "the keyboard move to be said" });
    await sleep(300);
    ok((await names()) === "Page 6,Notes,Page 2,Page 5,Page 3,Page 4", `Space drops it there (${await names()}; list ${await list.count()}; focus ${await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName)}; tabs ${await order()})`);
    // Esc while held puts it back (the list stays open)
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    ok((await names()) === "Page 6,Notes,Page 2,Page 5,Page 3,Page 4" && (await list.count()) === 1, "Esc while held puts it back; the list stays open");
    // Alt+↓ on a row moves it one place at once
    await list.getByRole("button", { name: "Notes", exact: true }).focus();
    await page.keyboard.press("Alt+ArrowDown");
    await until(async () => (await names()) === "Page 6,Page 2,Notes,Page 5,Page 3,Page 4", { ms: 3000, what: "Alt+Down to move Notes" });
    ok((await page.evaluate(() => document.activeElement?.textContent?.trim())) === "Notes", "Alt+↓ on a row moves it one place; the focus stays on it");
    await sleep(1800);
    ok((await pagesOnServer()).join(",") === "Page 6,Page 2,Notes,Page 5,Page 3,Page 4", `the order made by mouse and keyboard is saved on the server (${(await pagesOnServer()).join(",")})`);
    ok((await order()) === "Page 6,Page 2,Notes,Page 5,Page 3,Page 4", "and the tabs follow");
    // the page's menu still moves a page
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Page actions" }).click();
    await page.getByRole("menu", { name: "Page actions" }).getByRole("menuitem", { name: "Move right" }).click();
    await sleep(300);
    ok((await order()).split(",").length === 6 && (await order()) !== "Page 6,Page 2,Notes,Page 5,Page 3,Page 4", `the page menu's Move right still works (${await order()})`);
    for (const theme of ["light", "dark", "read"]) {
      await setTheme(page, theme);
      await allBtn.click();
      await list.locator(".nb-ap-grip").first().waitFor();
      await sleep(250);
      if (theme !== "light") await shot(page.locator("#dw-panel-side"), `allpages-${theme}`);
      await axe(page, `All pages, ${theme}`, ".nb-pop[role=dialog]");
      await page.keyboard.press("Escape");
    }
    await ctx.close();
  }
  // a phone: rows of 44 px, the grip 44 px, axe
  {
    const { ctx, page } = await openReader(phone(390, 844));
    await page.getByRole("radio", { name: "Notes" }).click();
    await page.locator(".nb-bar").waitFor({ timeout: 10000 });
    const allBtn = page.getByRole("button", { name: /^All pages/ });
    await allBtn.waitFor({ timeout: 5000 });
    await allBtn.click();
    const list = page.getByRole("dialog", { name: "All pages" });
    await list.locator(".nb-ap-grip").first().waitFor();
    const sizes = await list.locator("li").first().evaluate((li) => ({ grip: li.querySelector(".nb-ap-grip").getBoundingClientRect(), open: li.querySelector(".nb-ap-open").getBoundingClientRect() }));
    ok(Math.round(sizes.grip.width) >= 44 && Math.round(sizes.grip.height) >= 44 && Math.round(sizes.open.height) >= 44, `a phone: the grip and the row are 44 px to press (${Math.round(sizes.grip.width)}x${Math.round(sizes.grip.height)}, ${Math.round(sizes.open.height)})`);
    ok(await noSideways(page), "a phone: no sideways scroll");
    await sleep(200);
    await shot(page, "allpages-phone");
    await axe(page, "All pages, phone", ".nb-pop[role=dialog]");
    await ctx.close();
  }

  ok(errors.length === 0, `no errors on the page (${errors.length})`);
  for (const e of errors.slice(0, 8)) console.log(`        ${e}`);
} catch (e) {
  console.error(e);
  countFailure();
} finally {
  await browser.close();
  idp.close?.();
}
finish("reader fixes (errors, Contents, All pages) e2e passed");
