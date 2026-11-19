// Browser e2e for the Notebook of the new Paper Reader, phase 2 (docs/design/paper-reader.md, 19.9): written for READER "on" (the named run reader-on starts the Worker so;
// scripts/lib/suites.mjs). The Notes tab first; write and format (the toolbar, Ctrl+B, lists that continue); Markdown drawn as elements (a script tag stays text); Add to notes from the
// pop-up, from a Highlights card and by dragging, with In notes; p. N back to the paper; pages: add (named Page N), rename, style, move, delete and Undo; reorder by Ctrl+Shift+arrow, by drag and in All pages; a block moved by Alt+arrow and deleted with Undo;
// offline then back; two tabs on one page; a reload keeps everything; the phone's Paper view with the toast's Open; Markdown out; axe in Light, Dark and Read at 1280 and 390; no sideways scroll.
// Needs the Worker with the fake identity provider and the offline stand-ins: `npm run integration -w apps/api -- --browser --run=reader-on` starts it.
//   node e2e/notebook.mjs [baseUrl]    (default http://localhost:8788; READER must be on there)
import { mkdirSync, readFileSync } from "node:fs";
// With NB_SHOTS=<folder> it also takes the pictures of the page tabs (a tab dragged, All pages) for the owner.
if (process.env.NB_SHOTS) mkdirSync(process.env.NB_SHOTS, { recursive: true });
import { SAMPLE_PAPER, makePdf } from "@scholar/test-support/make-pdf.mjs";
import { BASE, REFUSED_OR_BUSY, axeCheck, countFailure, desk, finish, launch, noSideways, ok, phone, setTheme, sleep, startIdp, until, untilInPage, watchPage } from "./lib/browser.mjs";

const idp = await startIdp();
idp.setUser({ sub: "reader-notebook-1", email: "noor.n@example.edu", email_verified: true, name: "Noor N" });
const browser = await launch();
const errors = [];
// part 4 takes the browser offline on purpose: what the page tries then fails with ERR_INTERNET_DISCONNECTED, which is what it is meant to meet
const OFFLINE_OR_REFUSED = new RegExp(`${REFUSED_OR_BUSY.source}|net::ERR_INTERNET_DISCONNECTED`);
const watch = (p) => watchPage(p, errors, { allowed: OFFLINE_OR_REFUSED });
const axe = (p, label, context) => axeCheck(p, label, { inlineCites: true, context });

/** In the page: selects the idx-th longer piece of text on page 1 and lifts the "mouse" there. Returns the text. */
const pick = (p, idx = 1) =>
  p.evaluate(async (i) => {
    const layer = document.querySelector('[data-page="1"] .textLayer');
    // the text layer is filled after the canvas is painted: wait for the span asked for (a phone under load can be slow)
    const spans = () => [...layer.querySelectorAll("span")].filter((x) => x.children.length === 0 && (x.textContent ?? "").trim().length > 12);
    for (let t = 0; !spans()[i] && t < 100; t++) await new Promise((res) => setTimeout(res, 100));
    const sp = spans()[i];
    if (!sp) throw new Error(`page 1 has ${spans().length} longer pieces of text, and piece ${i} was asked for`);
    sp.scrollIntoView({ block: "center" });
    await new Promise((res) => setTimeout(res, 250));
    const r = document.createRange();
    r.selectNodeContents(sp);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    sp.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return sp.textContent.trim();
  }, idx);

try {
  /* ================================================================ sign in, one paper */
  const c0 = await browser.newContext(desk(1280, 800));
  const p0 = await c0.newPage();
  watch(p0);
  await p0.goto(BASE + "/", { waitUntil: "networkidle" });
  await p0.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
  await p0.getByRole("button", { name: "Continue with Google" }).last().click();
  await p0.locator("#hm-h").waitFor({ timeout: 20000 });
  await sleep(1000);
  await p0.goto(BASE + "/papers", { waitUntil: "networkidle" });
  const handled = p0.getByRole("region", { name: /how your papers are handled/ });
  if (await handled.count()) {
    await handled.getByRole("button", { name: "I understand, continue" }).click();
    await handled.waitFor({ state: "detached", timeout: 8000 });
  }
  await p0.locator('input[type="file"]').waitFor({ state: "attached" });
  await p0.locator('input[type="file"]').setInputFiles({ name: "glaucoma_screening.pdf", mimeType: "application/pdf", buffer: makePdf(SAMPLE_PAPER, { title: "Glaucoma screening" }) });
  await p0.waitForFunction(() => document.querySelector(".dc")?.getAttribute("data-status") === "ready", null, { timeout: 60000 });
  const docId = (await (await p0.request.get(BASE + "/api/v1/documents")).json()).items.sort((a, b) => b.createdAt - a.createdAt)[0].id;
  const state = await c0.storageState();
  await c0.close();
  const api = (await browser.newContext({ storageState: state })).request;
  // what the server holds: a refusal or a busy Worker is tried again for a few seconds, then named (not read as a list that is not there)
  /** A page's tab (the panel's own tabs are tabs too: Notes, Highlights, References). */
  const pageTab = (p, name) => p.getByRole("tablist", { name: "Pages" }).getByRole("tab", { name, exact: true });
  const pagesOnServer = async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const r = await api.get(`${BASE}/api/v1/documents/${docId}/notebook`);
      if (r.ok()) return (await r.json()).pages;
      last = r.status();
      await sleep(500);
    }
    throw new Error(`GET .../notebook kept answering ${last}`);
  };
  const notesOf = async () => (await (await api.get(`${BASE}/api/v1/documents/${docId}/notes`)).json()).items;

  const openReader = async (vp, { theme = "light", ctx: given } = {}) => {
    const ctx = given ?? (await browser.newContext({ ...vp, storageState: state, colorScheme: "light" }));
    if (!given)
      await ctx.addInitScript((t) => {
        try {
          if (sessionStorage.getItem("__seeded")) return;
          sessionStorage.setItem("__seeded", "1");
          localStorage.setItem("theme", t);
        } catch {
          /* no storage */
        }
      }, theme);
    const page = await ctx.newPage();
    watch(page);
    await page.goto(BASE + "/papers/" + docId, { waitUntil: "networkidle" });
    await page.locator(".desk").waitFor({ timeout: 20000 });
    await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
    await page.locator('[data-page="1"] .textLayer span').first().waitFor({ timeout: 20000 });
    await sleep(600);
    return { ctx, page };
  };
  const saved = (page) => page.locator(".nb-save").filter({ hasText: /^Saved/ }).waitFor({ timeout: 10000 });

  /* ================================================================ 1. the Notes tab; write and format */
  console.log("1. the Notes tab: write and format");
  {
    const { ctx, page } = await openReader(desk(1280, 800));
    const tabs = page.getByRole("tablist", { name: "Notes, highlights or references" }).getByRole("tab");
    ok(JSON.stringify((await tabs.allInnerTexts()).map((t) => t.replace(/\d+/g, "").trim())) === JSON.stringify(["Notes", "Highlights", "References"]), "the panel's tabs: Notes, Highlights, References, Notes first");
    ok((await tabs.first().getAttribute("aria-selected")) === "true", "Notes is the tab shown");
    await page.locator(".nb-bar").waitFor({ timeout: 10000 });
    ok((await page.locator(".nb-title").inputValue()) === "Notes", "a paper with no notebook shows one page, Notes");
    ok((await page.locator(".nb-field").first().getAttribute("placeholder")) === "Write here, or select text in the paper and choose Add to notes.", "the empty page says what to do, in its one line to write on");
    ok((await page.locator(".nb-field").count()) === 1, "with one empty text block, ready to write in");
    // one header: the title is the page's only title, beside its list of pages; one page menu; no separate "+ Text"
    ok((await page.locator(".nb-title").count()) === 1 && (await page.getByRole("button", { name: "Page actions" }).count()) === 1 && (await page.getByRole("button", { name: "Delete this page" }).count()) === 0 && (await page.locator(".nb-tabx").count()) === 1 && (await page.getByRole("tablist", { name: "Pages" }).getByRole("tab").allInnerTexts()).join() === "Notes", "the page's header: its title and one small menu (no trash: a page is deleted by the × on its tab); its tab in the row of pages");
    ok((await page.locator(".nb-addtext").count()) === 0 && (await page.locator(".nb-ghost").count()) === 0, "no separate + Text under the page: it ends on its empty line (Text is in the toolbar)");
    await sleep(1500);
    ok((await pagesOnServer()).length === 0, "opening the paper made nothing on the server");

    const field = page.locator(".nb-field").first();
    await field.click();
    await page.keyboard.type("# Methods");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Patch embedding is linear");
    // Ctrl+B on a word selected in the field
    await field.evaluate((el) => {
      const at = el.value.indexOf("linear");
      el.setSelectionRange(at, at + "linear".length);
    });
    await page.keyboard.press("Control+b");
    ok((await field.inputValue()).endsWith("**linear**"), `Ctrl+B makes the selection bold (${JSON.stringify((await field.inputValue()).slice(-14))})`);
    // the toolbar: Italic on a word selected with the keyboard
    await page.keyboard.press("End");
    await page.keyboard.type(" and fast");
    for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
    const italic = page.getByRole("toolbar", { name: "Format" }).getByRole("button", { name: "Italic" });
    await italic.click();
    ok((await field.inputValue()).endsWith("*fast*"), "the toolbar's Italic wraps the selection, and the focus stays in the field");
    ok((await italic.getAttribute("aria-pressed")) === "true", "and says so (aria-pressed)");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("- first");
    await page.keyboard.press("Enter");
    ok((await field.inputValue()).endsWith("- first\n- "), "Enter at the end of a list item continues the list");
    await page.keyboard.type("second");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    ok((await field.inputValue()).endsWith("- second\n"), "Enter on an empty item ends the list");
    await page.keyboard.type("A ==mark== and <u>under</u> and <img src=x onerror=alert(1)>");
    await page.keyboard.press("Escape");
    await sleep(200);
    const block = page.locator(".nb-text").first();
    ok((await block.getAttribute("aria-label")) === "Text block 1, press Enter to edit" && (await page.evaluate(() => document.activeElement?.classList.contains("nb-text"))), "Esc closes the field and keeps the focus on the block, a region named for Enter to edit");
    const drawn = await block.evaluate((el) => ({ h: el.querySelector("h3")?.textContent, b: el.querySelector("strong")?.textContent, i: el.querySelector("em")?.textContent, li: el.querySelectorAll("ul > li").length, mark: el.querySelector("mark")?.textContent, u: el.querySelector("u")?.textContent, img: el.querySelectorAll("img, script").length, text: el.textContent }));
    ok(drawn.h === "Methods" && drawn.b === "linear" && drawn.i === "fast" && drawn.li === 2 && drawn.mark === "mark" && drawn.u === "under", `the Markdown is drawn as elements (${JSON.stringify({ ...drawn, text: undefined })})`);
    ok((await block.evaluate((el) => getComputedStyle(el.querySelector("ul")).listStyleType)) === "disc", "a bullet list shows its bullets (base.css takes them off every other list)");
    ok(drawn.img === 0 && drawn.text.includes("<img src=x onerror=alert(1)>"), "a picture tag with onerror is shown as the text that was typed, never as an element");
    await page.keyboard.press("Enter");
    ok(await page.locator(".nb-field").first().isVisible(), "Enter on the block opens it again");
    await page.keyboard.press("Escape");
    await saved(page);
    const srv = await pagesOnServer();
    ok(srv.length === 1 && srv[0].title === "Notes" && srv[0].rev >= 1 && srv[0].blocks[0].md.startsWith("# Methods\nPatch embedding is **linear**"), `writing made the page on the server (rev ${srv[0]?.rev}), and the save line says Saved`);
    await ctx.close();
  }

  /* ================================================================ 2. Add to notes: the pop-up, a card, a drag; In notes; p. N */
  console.log("2. Add to notes, In notes, back to the paper");
  {
    const { ctx, page } = await openReader(desk(1280, 800));
    await page.locator(".nb-bar").waitFor({ timeout: 10000 });
    const text = await pick(page, 1);
    const pop = page.getByRole("toolbar", { name: "The selected text" });
    await pop.waitFor();
    const names = await pop.getByRole("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.textContent.trim()));
    ok(JSON.stringify(names) === JSON.stringify(["Highlight as Key idea", "Highlight as Method", "Highlight as Question", "Highlight as Result", "Add to notes", "Explain", "Copy"]), `a selection's pop-up: the four meanings, Add to notes, Explain, Copy (${names.join(", ")})`);
    await pop.getByRole("button", { name: "Add to notes" }).click();
    const toast = page.locator(".desk-toast", { hasText: 'Added to "Notes"' });
    await toast.waitFor({ timeout: 8000 });
    ok((await toast.getByRole("button").allInnerTexts()).filter((t) => t.trim()).join(",") === "Undo", "a toast says Added to \"Notes\", with Undo (no Open on a wide screen)");
    const quote = page.locator(".nb-quote").first();
    await quote.waitFor();
    ok((await quote.getAttribute("aria-label")) === "Key idea, page 1" && (await quote.innerText()).includes(text.slice(0, 20)), `the highlight is a quote block on the open page, its meaning in words (${await quote.getAttribute("aria-label")})`);
    ok((await notesOf()).length === 1, "and the selection was highlighted first, in the meaning chosen");
    await toast.getByRole("button", { name: "Undo" }).click();
    await page.locator(".nb-quote").waitFor({ state: "detached", timeout: 5000 });
    ok(true, "Undo takes the quote out of the notes");
    // a highlight, clicked: Add to notes, then In notes
    ok(await page.evaluate(() => getSelection().isCollapsed), "the selection is let go once it is a highlight in the notes");
    await page.locator('[data-page="1"] .pdfp-hl').first().waitFor();
    const mark = await page.locator('[data-page="1"] .pdfp-hl').first().boundingBox();
    await page.mouse.click(mark.x + mark.width / 2, mark.y + mark.height / 2);
    const hpop = page.getByRole("toolbar", { name: /^Highlight on page 1/ });
    await hpop.waitFor();
    await hpop.getByRole("button", { name: "Add to notes" }).click();
    await page.locator(".nb-quote").first().waitFor();
    await sleep(300);
    await page.mouse.click(mark.x + mark.width / 2, mark.y + mark.height / 2);
    await hpop.waitFor();
    ok((await hpop.getByRole("button", { name: "In notes" }).count()) === 1, "a highlight in the notes says In notes in its pop-up");
    await page.keyboard.press("Escape");
    // a card of the Highlights tab: In notes, and Add to notes for another
    await page.getByRole("tab", { name: /^Highlights/ }).click();
    ok((await page.locator(".note-innotes").count()) === 1, "its card in the Highlights tab says In notes");
    await pick(page, 2);
    await pop.waitFor();
    await pop.getByRole("button", { name: "Highlight as Method" }).click();
    await page.locator('.note[data-color="green"]').waitFor({ timeout: 8000 });
    await page.locator('.note[data-color="green"]').getByRole("button", { name: /^Add the highlight on page 1 to your notes/ }).click();
    await page.locator(".desk-toast", { hasText: "Added to" }).waitFor();
    await page.locator('.note[data-color="green"] .note-innotes').waitFor({ timeout: 5000 });
    ok(true, "Add to notes on a card, and the card then says In notes");
    await page.locator('.note[data-color="green"] .note-innotes').click();
    await page.locator("#desk-tabpanel-notes:not([hidden])").waitFor();
    await untilInPage(page, () => !!document.querySelector(".nb-block[data-flash]"), undefined, 5000);
    ok(true, "In notes opens the Notes tab and brings the block into view (it flashes)");
    // a drag from the paper: a selection carries its page and words, a drop puts a quote where it falls
    const dragged = await page.evaluate(async () => {
      const layer = document.querySelector('[data-page="1"] .textLayer');
      const sp = [...layer.querySelectorAll("span")].filter((x) => (x.textContent ?? "").trim().length > 12)[3];
      const r = document.createRange();
      r.selectNodeContents(sp);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      const dt = new DataTransfer();
      sp.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
      const data = dt.getData("application/x-sodhsetu-quote");
      const target = document.querySelector(".nb-blocks");
      const drop = new DataTransfer();
      drop.setData("application/x-sodhsetu-quote", data);
      const box = target.getBoundingClientRect();
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: drop, clientX: box.left + 40, clientY: box.top + 2 }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: drop, clientX: box.left + 40, clientY: box.top + 2 }));
      return { data, words: sp.textContent.trim() };
    });
    const d = JSON.parse(dragged.data || "{}");
    ok(d.page === 1 && d.quote === dragged.words.replace(/\s+/g, " ") && d.noteId === null, `a selection dragged from the paper carries application/x-sodhsetu-quote (${dragged.data.slice(0, 60)}…)`);
    await until(async () => (await page.locator(".nb-quote").count()) === 3, { ms: 8000 });
    ok((await page.locator(".nb-block").first().getAttribute("data-kind")) === "quote" && (await page.locator(".nb-quote").first().innerText()).includes(dragged.words.slice(0, 16)), "dropped at the top of the page, it is a quote there, highlighted first");
    // p. N: back to the paper (Notes view: to Split)
    await page.getByRole("radio", { name: "Notes" }).click();
    await sleep(300);
    await page.locator(".nb-quote .nb-go").first().click();
    await sleep(500);
    ok((await page.locator(".desk").getAttribute("data-view")) === "split" && (await page.locator("#dw-panel-paper").isVisible()), "p. N from the Notes view switches to Split, to the paper");
    await saved(page);
    await ctx.close();
  }

  /* ================================================================ 3. pages and blocks */
  console.log("3. pages and blocks");
  {
    const { ctx, page } = await openReader(desk(1280, 800));
    await page.locator(".nb-bar").waitFor({ timeout: 10000 });
    // + Page opens "Choose paper for the new page": four cards; a card makes the page on that paper and puts the cursor in its title
    await page.getByRole("button", { name: "Add a page" }).click();
    const picker = page.getByRole("dialog", { name: "Choose paper for the new page" });
    await picker.waitFor();
    ok(JSON.stringify((await picker.locator(".nb-papercard").allInnerTexts()).map((t) => t.trim())) === JSON.stringify(["Plain", "Ruled", "Dotted", "Graph"]), "+ Page: Choose paper for the new page, with four papers");
    await page.keyboard.press("Escape");
    ok((await picker.count()) === 0, "Esc closes the paper picker");
    await page.getByRole("button", { name: "Add a page" }).click();
    await picker.getByRole("button", { name: "Ruled" }).click();
    const title = page.getByRole("textbox", { name: "Page title" });
    ok((await title.inputValue()) === "Page 2" && (await page.evaluate(() => document.activeElement?.classList.contains("nb-title"))) && (await page.locator(".nb-scroll").getAttribute("data-style")) === "ruled", "a paper card makes the page on that paper and focuses its title");
    await title.fill("Results");
    // Ruled: the rules are one --nb-line apart, and a line of text is one --nb-line high, so the text sits on them
    const rhythm = await page.locator(".nb-field").first().evaluate((el) => {
      const probe = document.createElement("div");
      probe.style.height = "var(--nb-line)";
      el.closest(".nb-scroll").append(probe);
      const line = probe.getBoundingClientRect().height;
      probe.remove();
      const cs = getComputedStyle(el);
      return { line, lh: parseFloat(cs.lineHeight), padTop: parseFloat(cs.paddingTop), bg: cs.backgroundImage };
    });
    ok(rhythm.line > 0 && Math.abs(rhythm.lh - rhythm.line) < 0.5 && rhythm.padTop === 0 && rhythm.bg.startsWith("repeating-linear-gradient") && rhythm.bg.includes(`${Math.round(rhythm.line)}px`), `Ruled: the line height of the text is --nb-line (${rhythm.lh} px = ${rhythm.line} px) and the rules repeat at it`);
    // "+" sits right after the last tab, as a browser's new tab button
    const plus = await page.getByRole("button", { name: "Add a page" }).boundingBox();
    const lastTab = await page.getByRole("tablist", { name: "Pages" }).getByRole("tab").last().boundingBox();
    ok(plus && lastTab && plus.x - (lastTab.x + lastTab.width) < 12 && plus.x > lastTab.x, `"+" (Add a page) is right after the last tab (${Math.round(plus.x - (lastTab.x + lastTab.width))} px)`);
    // the toolbar: the basic actions in one row; More opens the rest, the papers among them
    const basic = await page.locator(".nb-tools-main").getByRole("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    ok(JSON.stringify(basic) === JSON.stringify(["Bold", "Italic", "Mark", "Bullet list", "Quote", "Capture", "Draw", "Image", "More formatting and paper"]), `the basic row: B, I, Mark, bullet list, Quote, Capture, Draw, Image, and More (${basic.join(", ")})`);
    const more = page.getByRole("button", { name: "More formatting and paper" });
    ok((await more.getAttribute("aria-expanded")) === "false" && (await page.getByRole("button", { name: "Heading" }).count()) === 0, "Heading, Underline, the numbered list, Text and the papers wait behind More");
    await more.click();
    ok((await more.getAttribute("aria-expanded")) === "true" && (await page.getByRole("button", { name: "Numbered list" }).count()) === 1, "More opens them (aria-expanded)");
    const papers = page.getByRole("group", { name: "Paper" }).getByRole("button");
    ok(JSON.stringify(await papers.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))) === JSON.stringify(["Plain paper", "Ruled paper", "Dotted paper", "Graph paper"]), "the toolbar has the four papers");
    await page.getByRole("button", { name: "Graph paper" }).click();
    ok((await page.locator(".nb-scroll").getAttribute("data-style")) === "grid" && (await page.getByRole("button", { name: "Graph paper" }).getAttribute("aria-pressed")) === "true", "a paper chosen in the toolbar is drawn");
    // the page tabs; the page's small menu moves it
    const tabs = page.getByRole("tablist", { name: "Pages" }).getByRole("tab");
    ok(JSON.stringify(await tabs.allInnerTexts()) === JSON.stringify(["Notes", "Results"]) && (await tabs.nth(1).getAttribute("aria-selected")) === "true", "the pages are tabs, the open one selected");
    await page.getByRole("button", { name: "Page actions" }).click();
    const menu = page.getByRole("menu", { name: "Page actions" });
    ok(JSON.stringify((await menu.getByRole("menuitem").allInnerTexts()).map((t) => t.trim())) === JSON.stringify(["Move left", "Move right", "Rename", "Delete page"]), "the page's small menu: Move left, Move right, Rename, Delete page");
    await menu.getByRole("menuitem", { name: "Move left" }).click();
    await until(async () => JSON.stringify(await tabs.allInnerTexts()) === JSON.stringify(["Results", "Notes"]), { ms: 4000, what: "Results to be the first tab" });
    ok(true, "Move left: Results is the first tab");
    await sleep(1600);
    let srv = await pagesOnServer();
    ok(srv.map((p) => p.title).join(",") === "Results,Notes" && srv[0].style === "grid", `the rename, the paper and the move are saved (${srv.map((p) => `${p.title}/${p.style}`).join(", ")})`);
    // the tabs by keyboard: the arrows move, Enter opens
    await tabs.nth(0).focus();
    await page.keyboard.press("ArrowRight");
    ok(await page.evaluate(() => document.activeElement?.textContent?.trim() === "Notes"), "→ moves to the next tab");
    await page.keyboard.press("Enter");
    await until(async () => (await page.locator(".nb-title").inputValue()) === "Notes", { ms: 4000, what: "the Notes page to open" });
    ok((await tabs.nth(1).getAttribute("aria-selected")) === "true", "Enter opens it");
    // a block's handle and its one menu are hidden until it is pointed at or holds the focus (opacity, so nothing moves)
    const firstBlock = page.locator(".nb-block").first();
    const shown = (b) => b.evaluate((el) => [el.querySelector(".nb-handle"), el.querySelector(".nb-blockmenu")].map((x) => getComputedStyle(x).opacity).join(","));
    await page.mouse.move(2, 400);
    await page.evaluate(() => document.activeElement?.blur());
    await sleep(300);
    const before = await shown(firstBlock);
    const box0 = await firstBlock.boundingBox();
    await firstBlock.hover();
    await sleep(300);
    const hovered = await shown(firstBlock);
    const box1 = await firstBlock.boundingBox();
    ok(before === "0,0" && hovered === "1,1" && box0.height === box1.height && (await firstBlock.locator(".nb-blockmenu button").count()) === 1, `a block's handle and its one menu show when it is pointed at, and nothing moves (${before} then ${hovered})`);
    await page.mouse.move(2, 400);
    // blocks: Alt+arrow moves one, Delete with Undo
    const handles = page.locator(".nb-handle");
    const n = await handles.count();
    const lastId = await page.locator(".nb-block").nth(n - 1).getAttribute("data-block");
    // the page just chosen settles first (it may put the cursor in its block): the handle is focused, and checked to be, before the key
    const onHandle = () => page.evaluate(() => !!document.activeElement?.classList.contains("nb-handle"));
    await until(async () => (await handles.nth(n - 1).focus(), await onHandle()), { ms: 5000, what: "the last block's handle to keep the focus" });
    await page.keyboard.press("Alt+ArrowUp");
    const moved = await until(async () => (await page.locator(".nb-block").nth(n - 2).getAttribute("data-block")) === lastId, { ms: 4000 });
    ok(moved && (await onHandle()), "Alt+Up moves the block one place up, and the focus stays on its handle");
    // the moved block is put back in the page, so its controls fade in again (0.15 s): waited for
    ok(!!(await until(async () => (await shown(page.locator(".nb-block").nth(n - 2))) === "1,1", { ms: 2000 })), "a block that holds the focus shows its handle and menu (the keyboard reaches them)");
    ok((await handles.nth(n - 2).getAttribute("aria-label")) === `Move block, position ${n - 1} of ${n}`, "the handle says its position");
    await page.getByRole("button", { name: `Actions of block ${n - 1}` }).click();
    await page.getByRole("menuitem", { name: "Delete block" }).click();
    ok((await page.locator(".nb-block").count()) === n - 1, "Delete block takes it out");
    await page.locator(".desk-toast", { hasText: "Block deleted" }).getByRole("button", { name: "Undo" }).click();
    ok((await page.locator(".nb-block").count()) === n && (await page.locator(".nb-block").nth(n - 2).getAttribute("data-block")) === lastId, "Undo puts it back where it was");
    // delete a page, and Undo
    await pageTab(page, "Results").click();
    const tabX = page.locator(".nb-tabwrap").filter({ has: page.getByRole("tab", { name: "Results", exact: true }) }).locator(".nb-tabx");
    ok(await tabX.isVisible(), "the open tab shows its × (Delete this page)");
    await tabX.click();
    await page.locator(".desk-toast", { hasText: 'Deleted "Results"' }).waitFor();
    await until(async () => (await pagesOnServer()).length === 1, { ms: 6000 });
    ok(true, "the × on the tab deletes the page: gone from the server too");
    await page.locator(".desk-toast", { hasText: 'Deleted "Results"' }).getByRole("button", { name: "Undo" }).click();
    await until(async () => (await pagesOnServer()).some((p) => p.title === "Results" && p.style === "grid"), { ms: 8000 });
    ok((await page.locator(".nb-title").inputValue()) === "Results", "Undo brings the page back, its style and blocks with it");
    // a reload keeps everything
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".nb-bar").waitFor({ timeout: 15000 });
    ok((await page.locator(".nb-title").inputValue()) === "Results" && (await page.locator(".nb-scroll").getAttribute("data-style")) === "grid", "a reload opens the page last used, as it was");
    srv = await pagesOnServer();
    ok(srv.length === 2, "two pages after all that");
    // Markdown out: Export ▾, all pages, Markdown
    await page.locator(".nb-export").click();
    await page.getByRole("menu", { name: "Download" }).getByRole("menuitemradio", { name: "All pages" }).click();
    const dl = page.waitForEvent("download");
    await page.getByRole("menu", { name: "Download" }).getByRole("menuitem", { name: "Markdown", exact: true }).click();
    const file = await dl;
    const md = readFileSync(await file.path(), "utf8");
    ok(/^notes-.+-\d{4}-\d\d-\d\d\.md$/.test(file.suggestedFilename()) && md.startsWith("# ") && md.includes("\n## Results\n") && md.includes("\n## Notes\n") && /> \(Key idea, p\. 1\)/.test(md) && md.includes("### Methods"), `Download all pages: one Markdown file, quotes with their meaning and page (${file.suggestedFilename()})`);
    await ctx.close();
  }

  /* ================================================================ 3b. the notes polish (19 Nov): page names, the header, reordering by keyboard and by drag, All pages */
  console.log("3b. page names, reorder, All pages");
  {
    const { ctx, page } = await openReader(desk(1280, 800));
    await page.locator(".nb-bar").waitFor({ timeout: 10000 });
    const tabs = page.getByRole("tablist", { name: "Pages" }).getByRole("tab");
    const order = async () => (await tabs.allInnerTexts()).map((t) => t.trim()).join(",");
    await until(async () => (await order()) === "Results,Notes", { ms: 6000, what: "the tabs Results, Notes" });
    // the header row: one quiet button style (no Comments without sharing); Export and the page's menu are the same 32 px buttons
    const hb = await page.locator(".nb-bar").evaluate((bar) => [...bar.querySelectorAll("button")].map((b) => ({ c: b.className, h: Math.round(b.getBoundingClientRect().height) })));
    ok(hb.length === 2 && hb.every((b) => b.c.includes("nb-hbtn") && b.h === 32) && (await page.getByRole("button", { name: /^Comments/ }).count()) === 0, `the page header: Export and ⋯ in one quiet style, 32 px, no Comments when the paper is not shared (${JSON.stringify(hb)})`);
    // keyboard: Ctrl+Shift+→ on a focused tab moves it, the focus stays on it, and the move is said
    await pageTab(page, "Results").focus();
    await page.keyboard.press("Control+Shift+ArrowRight");
    await until(async () => (await order()) === "Notes,Results", { ms: 4000, what: "Results to move right" });
    ok(await page.evaluate(() => document.activeElement?.getAttribute("role") === "tab" && document.activeElement.textContent.trim() === "Results"), "Ctrl+Shift+→ moves the tab one place, and the focus stays on it");
    await until(async () => ((await page.locator("[data-announcer]").allTextContents()).join(" ")).includes("Page moved to place 2 of 2"), { ms: 3000, what: "the move to be said" });
    ok(true, "the move is said: Page moved to place 2 of 2");
    // drag by pointer: Results lifted (a mouse after 5 px), a line where it goes, dropped first
    const r = await pageTab(page, "Results").boundingBox();
    const n = await pageTab(page, "Notes").boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(r.x + r.width / 2 - ((r.x + r.width / 2 - (n.x + 6)) * i) / 8, r.y + r.height / 2);
    ok((await page.locator(".nb-tabwrap[data-lifted]").count()) === 1 && (await page.locator('.nb-tabwrap[data-line="before"]').count()) === 1, "a dragged tab is lifted, and a line shows where it will go");
    if (process.env.NB_SHOTS) await page.locator("#dw-panel-side").screenshot({ path: `${process.env.NB_SHOTS}/tab-dragging.png` });
    await page.mouse.up();
    await until(async () => (await order()) === "Results,Notes", { ms: 4000, what: "the drag to put Results first" });
    await sleep(1600);
    let srv = await pagesOnServer();
    ok(srv.map((p) => p.title).join(",") === "Results,Notes", `the order made by keyboard and drag is saved (${srv.map((p) => p.title).join(",")})`);
    // new pages are named Page N (the next number no page shows); six pages overflow the row: All pages lists them
    for (let k = 0; k < 4; k++) {
      await page.getByRole("button", { name: "Add a page" }).click();
      await page.getByRole("dialog", { name: "Choose paper for the new page" }).getByRole("button", { name: "Plain" }).click();
      await sleep(250);
    }
    ok((await order()) === "Results,Notes,Page 3,Page 4,Page 5,Page 6" && (await page.locator(".nb-title").inputValue()) === "Page 6", `new pages are named Page N, not "Untitled page" (${await order()})`);
    const widest = await tabs.evaluateAll((els) => Math.max(...els.map((e) => e.getBoundingClientRect().width)));
    const tabH = await tabs.first().evaluate((e) => e.getBoundingClientRect().height);
    ok(widest <= 11 * 16 + 1 && Math.round(tabH) === 36, `the tabs are at most 11 rem wide and 36 px high (${Math.round(widest)} px, ${tabH} px)`);
    // a narrow Split panel, so the six do not fit
    await page.setViewportSize({ width: 1024, height: 800 });
    const all = page.getByRole("button", { name: /^All pages/ });
    await all.waitFor({ timeout: 4000 });
    ok((await page.locator(".nb-pagetabs").getAttribute("data-more")) !== null, "six tabs overflow the row: an edge fade, and an All pages button before +");
    await all.click();
    const list = page.getByRole("dialog", { name: "All pages" });
    await list.waitFor();
    ok(JSON.stringify((await list.locator(".nb-ap-name").allInnerTexts()).map((t) => t.trim())) === JSON.stringify(["Results", "Notes", "Page 3", "Page 4", "Page 5", "Page 6"]) && (await list.locator('[aria-current="page"]').innerText()).trim() === "Page 6", "All pages lists every page in order, the open one marked");
    await sleep(200);
    if (process.env.NB_SHOTS) await page.locator("#dw-panel-side").screenshot({ path: `${process.env.NB_SHOTS}/tabs-overflow-allpages.png` });
    await axe(page, "All pages", ".nb-pop[role=dialog]");
    await list.getByRole("button", { name: "Move Page 6 up" }).click();
    await until(async () => (await order()) === "Results,Notes,Page 3,Page 4,Page 6,Page 5", { ms: 4000, what: "Page 6 to move up" });
    ok(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Move Page 6 up"), "Move up in All pages moves it, and the focus stays on the button");
    await list.getByRole("button", { name: "Page 3", exact: true }).click();
    await until(async () => (await page.locator(".nb-title").inputValue()) === "Page 3", { ms: 4000, what: "Page 3 to open" });
    ok((await list.count()) === 0, "a page chosen in All pages opens, and the list closes");
    await sleep(1600);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".nb-bar").waitFor({ timeout: 15000 });
    await until(async () => (await order()) === "Results,Notes,Page 3,Page 4,Page 6,Page 5", { ms: 6000, what: "the order after a reload" });
    ok(true, "a reload keeps the new order");
    // the extra pages go (by the API), so the parts after this find the two pages they expect
    srv = await pagesOnServer();
    for (const p of srv.filter((x) => /^Page \d$/.test(x.title))) await api.delete(`${BASE}/api/v1/documents/${docId}/notebook/pages/${p.id}`, { headers: { Origin: BASE } });
    ok((await pagesOnServer()).length === 2, "the extra pages are deleted again");
    await ctx.close();
  }

  /* ================================================================ 4. offline, then back; two tabs on one page */
  console.log("4. offline, and two windows");
  {
    const { ctx, page } = await openReader(desk(1280, 800));
    await page.locator(".nb-bar").waitFor({ timeout: 10000 });
    await pageTab(page, "Notes").click();
    await ctx.setOffline(true);
    // the end of the page: its empty last block, or the line that becomes one at the first key
    await page.locator(".nb-ghost, .nb-blocks > .nb-block:last-child .nb-field").last().click();
    await page.keyboard.type("written without a connection");
    await page.keyboard.press("Escape");
    await page.locator(".nb-save", { hasText: "Offline: kept on this device" }).waitFor({ timeout: 8000 });
    ok(true, "offline: the save line says Offline: kept on this device");
    // the line says Offline when the save fails; the copy is written to IndexedDB just after, so it is waited for
    const kept = () =>
      page.evaluate(async (id) => {
        const db = await new Promise((res) => { const r = indexedDB.open("scholar"); r.onsuccess = () => res(r.result); });
        return new Promise((res) => { const g = db.transaction("pendingInk").objectStore("pendingInk").get(`nb:${id}`); g.onsuccess = () => res(!!g.result); });
      }, docId);
    ok(await until(kept, { ms: 5000 }), "and the page waits in IndexedDB");
    await ctx.setOffline(false);
    await saved(page);
    ok((await pagesOnServer()).some((p) => p.blocks.some((b) => b.md === "written without a connection")), "back online, it is sent");

    // two tabs on one page: each changes a different block, then both the same one
    const { page: other } = await openReader(desk(1280, 800), { ctx });
    await other.locator(".nb-bar").waitFor({ timeout: 10000 });
    const edit = async (p, k, words) => {
      await p.locator(".nb-text").nth(k).click();
      await p.keyboard.press("Control+End");
      await p.keyboard.type(words);
      await p.keyboard.press("Escape");
    };
    await edit(page, 0, " (tab one)");
    await saved(page);
    await edit(other, 1, " (tab two)");
    await saved(other).catch(() => {});
    await sleep(800);
    const notes1 = (await pagesOnServer()).find((p) => p.title === "Notes");
    const all = notes1.blocks.filter((b) => b.kind === "text").map((b) => b.md).join("|");
    ok(all.includes("(tab one)") && all.includes("(tab two)"), "two tabs, two blocks changed: both are kept (merged by block id)");
    await edit(page, 0, " one again");
    await saved(page);
    await edit(other, 0, " two again");
    await other.locator(".desk-toast", { hasText: "Updated from another window" }).waitFor({ timeout: 10000 });
    ok(true, "both tabs changed the same block: the second is told Updated from another window");
    await sleep(1500);
    const first = (await pagesOnServer()).find((p) => p.title === "Notes").blocks.find((b) => b.kind === "text").md;
    ok(first.includes("two again"), "and its text wins");
    await ctx.close();
  }

  /* ================================================================ 5. a phone: Paper view, Add to notes, the toast's Open; no sideways scroll */
  console.log("5. a phone");
  {
    const { ctx, page } = await openReader(phone(390, 844));
    ok((await page.locator(".desk").getAttribute("data-view")) === "paper", "a phone opens on Paper");
    await pick(page, 0); // lines 1 and 2 of page 1 are highlights already (section 2); the title line is not
    const pop = page.locator(".desk-pop");
    await pop.waitFor();
    await pop.getByRole("button", { name: "Add to notes" }).click();
    const toast = page.locator(".desk-toast", { hasText: "Added to" });
    await toast.waitFor({ timeout: 10000 });
    ok(JSON.stringify((await toast.locator(".desk-toast-act").allInnerTexts()).map((t) => t.trim())) === JSON.stringify(["Undo", "Open"]), "on a phone in Paper view the toast has Undo and Open");
    await toast.getByRole("button", { name: "Open" }).click();
    await sleep(500);
    ok((await page.locator(".desk").getAttribute("data-view")) === "notes" && (await page.locator("#desk-tabpanel-notes").isVisible()), "Open switches to Notes, on the Notes tab");
    // the toolbar on a phone: the basic actions in ONE row (it scrolls sideways with a fade, never wraps), every button 44 px or more
    const bar = await page.locator(".nb-tools-main").evaluate((row) => {
      const bs = [...row.querySelectorAll(".nb-tool")].map((b) => b.getBoundingClientRect());
      return { rows: new Set(bs.map((b) => Math.round(b.top))).size, small: Math.min(...bs.map((b) => Math.min(b.width, b.height))), scrolls: row.scrollWidth > row.clientWidth, fade: row.dataset.more ?? "" };
    });
    ok(bar.rows === 1 && bar.small >= 44 && (!bar.scrolls || bar.fade === "end"), `the toolbar on a phone: one row of basic actions, 44 px each, scrolling with a fade when it does not fit (${JSON.stringify(bar)})`);
    // the Highlights chips on a phone: one line, no meaning with none
    await page.getByRole("tab", { name: /^Highlights/ }).click();
    const chipRow = await page.locator(".hl-filter").evaluate((row) => ({ tops: new Set([...row.children].map((c) => Math.round(c.getBoundingClientRect().top))).size, zero: [...row.querySelectorAll(".hl-chip")].some((c) => /\b0\s*$/.test(c.textContent.trim())) }));
    ok(chipRow.tops === 1 && !chipRow.zero, `the Highlights chips on a phone: one line, none for a meaning with no highlight (${JSON.stringify(chipRow)})`);
    await page.getByRole("tab", { name: /^Notes/ }).click();
    ok(await noSideways(page), "no sideways scroll in the notebook on a phone");
    await page.locator(".nb-quote .nb-go").first().click();
    await sleep(400);
    ok((await page.locator(".desk").getAttribute("data-view")) === "paper", "p. N on a phone switches to Paper");
    await ctx.close();
  }
  // a tablet in Split: the panel is narrow, and the three tabs are all there to be seen (the row scrolls rather than cut the last one off)
  {
    const { ctx, page } = await openReader(desk(834, 1112));
    const fits = await page.locator(".dw-sidetabs").evaluate((row) => { const r = row.getBoundingClientRect(); return [...row.querySelectorAll("[role=tab]")].map((t) => t.getBoundingClientRect()).every((b) => b.left >= r.left - 1 && b.right <= r.right + 1); });
    ok(fits, "a tablet (834 px) in Split: Notes, Highlights and References are all in sight");
    await ctx.close();
  }

  /* ================================================================ 6. axe on the Notes tab, every block kind, three themes, two widths */
  console.log("6. axe");
  for (const vp of [desk(1280, 800), phone(390, 844)]) {
    const { ctx, page } = await openReader(vp);
    if (vp.isMobile) {
      await page.getByRole("radio", { name: "Notes" }).click();
      await sleep(400);
    }
    await page.locator(".nb-bar").waitFor({ timeout: 10000 });
    await pageTab(page, "Notes").click();
    await page.locator(".nb-quote").first().waitFor();
    for (const theme of ["light", "dark", "read"]) {
      await setTheme(page, theme, 350);
      await axe(page, `Notes tab, ${theme}, ${vp.viewport.width}`);
    }
    await page.locator(".nb-tools").getByRole("button", { name: "Quote" }).click();
    await page.getByRole("dialog", { name: "Insert a quote of a highlight" }).waitFor();
    // the pop-over fades in (0.14 s): axe reads colours, so it waits for the fade to end
    await untilInPage(page, () => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity), undefined, 5000);
    // a pop-over inside the scrolling toolbar would be clipped by it and still count as visible to Playwright: the point at its middle has to be the picker's own
    ok(await page.getByRole("dialog", { name: "Insert a quote of a highlight" }).evaluate((el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 60))); }), `the quote picker is drawn over the notes, not cut off by the toolbar (${vp.viewport.width})`);
    // the picker itself: the notes behind it were checked just above, closed (axe takes a block button it covers in part to be too small, though a press there only closes it)
    await axe(page, `the quote picker, ${vp.viewport.width}`, ".nb-pop[role=dialog]");
    await page.keyboard.press("Escape");
    ok(await noSideways(page), `no sideways scroll (${vp.viewport.width})`);
    await ctx.close();
  }

  /* ================================================================ 7. phase 2.5 (21.4): full width, scrollbars, chips, Capture, Sketch, PDF and Word */
  console.log("7. phase 2.5: Capture, Sketch, Export");
  {
    const { ctx, page } = await openReader(desk(1440, 900));
    await page.getByRole("radio", { name: "Notes" }).click();
    await page.locator(".nb-bar").waitFor({ timeout: 10000 });
    await sleep(400);
    const fit = await page.evaluate(() => {
      const panel = document.getElementById("dw-panel-side").getBoundingClientRect();
      const sheet = document.querySelector("#desk-tabpanel-notes .nb-sheet").getBoundingClientRect();
      return { left: sheet.left - panel.left, right: panel.right - sheet.right };
    });
    ok(fit.left <= 40 && fit.right <= 40, `the Notes view at 1440 px: the page fills the panel (${Math.round(fit.left)} px and ${Math.round(fit.right)} px at its sides)`);
    ok((await page.locator(".nb-scroll").evaluate((el) => getComputedStyle(el).scrollbarWidth)) === "thin", "thin scrollbars in our tokens (scrollbar-width: thin)");
    await page.getByRole("tab", { name: /^Highlights/ }).click();
    const pad = await page.locator(".hl-filter").evaluate((el) => { const cs = getComputedStyle(el); return [cs.paddingTop, cs.paddingBottom, cs.paddingLeft, cs.paddingRight].join(" "); });
    ok(pad === "10px 10px 12px 12px", `the chip row keeps 10 px above and below and 12 px at its sides (${pad})`);
    await page.getByRole("tab", { name: "Notes", exact: true }).first().click();
    await pageTab(page, "Notes").click();
    await page.locator(".nb-bar").waitFor();

    // Capture from the Notes view: Split first, then a frame dragged on page 1
    const tools = page.getByRole("toolbar", { name: "Format" });
    const capturesBefore = await page.locator(".nb-capture").count();
    await tools.getByRole("button", { name: "Capture" }).click();
    await until(async () => (await page.locator(".desk").getAttribute("data-view")) === "split", { ms: 6000, what: "Split" });
    const layer = page.locator('[data-page="1"] .desk-capture');
    await layer.waitFor({ timeout: 10000 });
    ok((await page.getByRole("radio", { name: "Capture" }).getAttribute("aria-checked")) === "true", "Capture from the Notes view: the paper comes into sight (Split) with the Capture tool in hand");
    const lb = await layer.boundingBox();
    await page.mouse.move(lb.x + lb.width * 0.1, lb.y + lb.height * 0.05);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(lb.x + lb.width * (0.1 + i * 0.12), lb.y + lb.height * (0.05 + i * 0.03));
    await page.mouse.up();
    await page.locator(".nb-capture").nth(capturesBefore).waitFor({ timeout: 10000 });
    await until(async () => (await page.locator(".nb-capture").nth(capturesBefore).getAttribute("data-state")) === "ok", { ms: 10000, what: "the capture to be drawn" });
    ok((await page.locator(".desk-capture").count()) === 0, "a dragged frame becomes a capture block, drawn from the paper, and the tool is put down");
    const cap = page.locator(".nb-capture").nth(capturesBefore);
    await cap.locator(".nb-caption").fill("Figure one");
    await cap.getByRole("radio", { name: "Full width" }).click();
    await saved(page);
    let srv = await pagesOnServer();
    const stored = srv.flatMap((p) => p.blocks).find((b) => b.kind === "capture");
    ok(!!stored && stored.caption === "Figure one" && stored.size === "full" && stored.page === 1 && stored.w > 0.3 && stored.h > 0.1 && !("png" in stored), `the capture is kept as a place with its caption and size, no picture (${JSON.stringify(stored)})`);
    // Capture by keyboard: Enter places a frame, the arrows move it, Shift and the arrows resize it, Enter captures
    await tools.getByRole("button", { name: "Capture" }).click();
    await layer.waitFor();
    await layer.focus();
    await page.keyboard.press("Enter");
    await page.locator('[data-page="1"] .desk-capture-frame').waitFor({ timeout: 4000 });
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Enter");
    await until(async () => (await page.locator(".nb-capture").count()) === capturesBefore + 2, { ms: 8000, what: "the second capture" });
    ok(true, "Capture by keyboard: Enter, the arrows, Shift and the arrows, Enter");

    // a sketch: Draw in the toolbar, a stroke drawn, kept after a reload
    await tools.getByRole("button", { name: "Draw" }).click();
    const area = page.locator(".nb-sketch-area").last();
    await area.waitFor({ timeout: 8000 });
    await area.scrollIntoViewIfNeeded();
    const ab = await area.boundingBox();
    await page.mouse.move(ab.x + 30, ab.y + 40);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(ab.x + 30 + i * 20, ab.y + 40 + Math.sin(i / 2) * 25);
    await page.mouse.up();
    ok((await area.locator("svg path").count()) === 1, "a stroke drawn in the sketch");
    await saved(page);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".nb-sketch-area svg path").first().waitFor({ timeout: 15000 });
    srv = await pagesOnServer();
    const sk = srv.flatMap((p) => p.blocks).find((b) => b.kind === "sketch");
    ok(!!sk && sk.strokes.length === 1 && sk.strokes[0].tool === "pen" && sk.strokes[0].pts.length >= 30, "the sketch is kept, and drawn again after a reload");

    // a picture: Image, a file chosen, made smaller in the browser and kept under the paper; served to its owner
    const { deflateSync } = await import("node:zlib");
    const pngOf = (w, h) => {
      const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
      const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
      const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
      const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
      const rows = []; for (let y = 0; y < h; y++) { rows.push(0); for (let x = 0; x < w; x++) rows.push((x * 4) & 255, (y * 4) & 255, 160); }
      return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0))]);
    };
    await page.locator('input[type="file"][accept^="image/"]').setInputFiles({ name: "diagram.png", mimeType: "image/png", buffer: pngOf(64, 48) });
    const pic = page.locator(".nb-image img").last();
    await pic.waitFor({ timeout: 15000 });
    await until(() => pic.evaluate((el) => el.complete && el.naturalWidth > 0), { ms: 10000, what: "the picture to show" });
    await page.locator(".nb-image .nb-caption").last().fill("A test diagram");
    await saved(page);
    srv = await pagesOnServer();
    const imgBlock = srv.flatMap((p) => p.blocks).find((b) => b.kind === "image");
    ok(!!imgBlock && imgBlock.w === 64 && imgBlock.h === 48 && imgBlock.type === "image/png" && imgBlock.alt === "A test diagram", `Image: the picture is kept under the paper and shown, with its words (${JSON.stringify(imgBlock)})`);
    const other = await browser.newContext();
    ok((await other.request.get(`${BASE}/api/v1/documents/${docId}/notebook/images/${imgBlock.id}`)).status() === 401, "a picture of the notes is not served to anyone not signed in as its owner");
    await other.close();
    // Export: PDF and Word of all pages, with the captures, the sketch and the picture
    const exportAs = async (what) => {
      await page.locator(".nb-export").click();
      const m = page.getByRole("menu", { name: "Download" });
      await m.getByRole("menuitemradio", { name: "All pages" }).click();
      const dl = page.waitForEvent("download", { timeout: 30000 });
      await m.getByRole("menuitem", { name: what, exact: true }).click();
      const file = await dl;
      return { name: file.suggestedFilename(), bytes: new Uint8Array(readFileSync(await file.path())) };
    };
    const { PDFDocument, PDFName, PDFRawStream } = await import("@cantoo/pdf-lib");
    const pdfOut = await exportAs("PDF");
    const pdfDoc = await PDFDocument.load(pdfOut.bytes);
    const images = pdfDoc.context.enumerateIndirectObjects().filter(([, o]) => o instanceof PDFRawStream && o.dict.get(PDFName.of("Subtype")) === PDFName.of("Image")).length;
    ok(/^notes-.+-\d{4}-\d\d-\d\d\.pdf$/.test(pdfOut.name) && pdfDoc.getPageCount() >= 1 && images >= 4, `Export ▾ PDF: a PDF with the two captures, the sketch and the picture (${pdfOut.name}, ${pdfDoc.getPageCount()} pages, ${images} pictures)`);
    const { unzipSync, strFromU8 } = await import("fflate");
    const docxOut = await exportAs("Word (.docx)");
    const parts = unzipSync(docxOut.bytes);
    const media = Object.keys(parts).filter((k) => k.startsWith("word/media/"));
    const xml = strFromU8(parts["word/document.xml"]);
    ok(/\.docx$/.test(docxOut.name) && media.length >= 4 && xml.includes("Figure one") && xml.includes("A test diagram") && xml.includes("Results"), `Export ▾ Word: a .docx with the pictures and the captions (${media.length} pictures)`);

    // axe with a capture and a sketch on the page, in the three themes
    // the export's toasts go first (one still fading in while the theme changes would be read half way)
    await page.locator(".desk-toast").first().waitFor({ state: "detached", timeout: 12000 }).catch(() => {});
    for (const theme of ["light", "dark", "read"]) {
      await setTheme(page, theme, 350);
      await axe(page, `Notes with a capture and a sketch, ${theme}, 1440`);
    }
    ok(await noSideways(page), "no sideways scroll (1440, with a capture and a sketch)");
    await ctx.close();
  }
  // Capture on a phone: from the Notes view to Paper, and back to the notes with the capture
  {
    const { ctx, page } = await openReader(phone(390, 844));
    await page.getByRole("radio", { name: "Notes" }).click();
    await page.locator(".nb-bar").waitFor({ timeout: 10000 });
    const before = await page.locator(".nb-capture").count();
    await page.getByRole("toolbar", { name: "Format" }).getByRole("button", { name: "Capture" }).click();
    await until(async () => (await page.locator(".desk").getAttribute("data-view")) === "paper", { ms: 6000, what: "the Paper view" });
    const layer = page.locator('[data-page="1"] .desk-capture');
    await layer.waitFor({ timeout: 10000 });
    await layer.scrollIntoViewIfNeeded();
    const lb = await layer.boundingBox();
    await page.mouse.move(lb.x + 20, lb.y + 30);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) await page.mouse.move(lb.x + 20 + i * 40, lb.y + 30 + i * 15);
    await page.mouse.up();
    await until(async () => (await page.locator(".desk").getAttribute("data-view")) === "notes", { ms: 8000, what: "the Notes view again" });
    await until(async () => (await page.locator(".nb-capture").count()) === before + 1, { ms: 8000, what: "the phone's capture" });
    ok(true, "Capture on a phone: Paper to take it, then back to the notes with it");
    ok(await noSideways(page), "no sideways scroll on a phone with captures and a sketch");
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
finish("notebook (phases 2 and 2.5) e2e passed");
