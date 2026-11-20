// Browser e2e for the new Paper Reader, phase 1 "Desk" (docs/design/paper-reader.md, sections 2 to 5, 9, 11, 12 and 16): written for READER "on" (the named run reader-on starts
// the Worker so; scripts/lib/suites.mjs). The widths 1280, 1024 (a tablet on its side), 768 (a tablet upright), 390 and 844 x 390 (a phone either way round: no Split);
// Light, Dark and Read with axe at each; the view switch, kept on reload; Highlight mode; the pop-up's actions, Copy refused; Remove and Undo; the Agents button never over the
// pop-up or a toast; the drawer's focus and Esc; the phone's sheet as a dialog; the meanings' names in the Markdown and in a question about the highlights; no sideways scroll.
// Needs the Worker with the fake identity provider and the offline stand-ins: `npm run integration -w apps/api -- --browser --run=reader-on` starts it.
//   node e2e/reader.mjs [baseUrl]    (default http://localhost:8788; READER must be on there)
import { readFileSync } from "node:fs";
import { SAMPLE_PAPER, makePdf } from "@scholar/test-support/make-pdf.mjs";
import { BASE, REFUSED_OR_BUSY, axeCheck, countFailure, desk, finish, launch, noSideways, ok, phone, setTheme, sleep, startIdp, untilInPage, watchPage } from "./lib/browser.mjs";

const idp = await startIdp();
idp.setUser({ sub: "reader-desk-1", email: "anaya.r@example.edu", email_verified: true, name: "Anaya R" });
const browser = await launch();
const errors = [];
const watch = (p) => watchPage(p, errors, { allowed: REFUSED_OR_BUSY });
const VP = {
  "1280x800": desk(1280, 800),
  "1024x768": desk(1024, 768),
  "768x1024": desk(768, 1024),
  "390x844": phone(390, 844),
  "844x390": phone(844, 390),
};
const WIDE = ["1280x800", "1024x768", "768x1024"];
const axe = (p, label) => axeCheck(p, label, { inlineCites: true });
const boxOf = (loc) => loc.boundingBox();
const overlap = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** In the page: selects the idx-th longer piece of text on page 1 and lifts the "mouse" there, as a drag across it does. Returns the text. */
const pick = (p, idx = 1) =>
  p.evaluate(async (i) => {
    const layer = document.querySelector('[data-page="1"] .textLayer');
    const sp = [...layer.querySelectorAll("span")].filter((x) => x.children.length === 0 && (x.textContent ?? "").trim().length > 12)[i];
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
  const c0 = await browser.newContext(VP["1280x800"]);
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
  // the newest paper (a run by hand against a Worker that kept an earlier run's papers sees them too)
  const docId = (await (await p0.request.get(BASE + "/api/v1/documents")).json()).items.sort((a, b) => b.createdAt - a.createdAt)[0].id;
  const details = await (await p0.request.get(`${BASE}/api/v1/documents/${docId}`)).json();
  ok(details.features?.reader === true, `the paper's details say the new reader is on (features ${JSON.stringify(details.features)})`);
  const state = await c0.storageState();
  await c0.close();
  const api = (await browser.newContext({ storageState: state })).request;

  const notesOf = async () => (await (await api.get(`${BASE}/api/v1/documents/${docId}/notes`)).json()).items;
  /** Every highlight of the paper gone, before a reader is opened (so the page starts from what the server has). */
  const clearNotes = async () => {
    for (const n of await notesOf()) await api.delete(`${BASE}/api/v1/documents/${docId}/notes/${n.id}`, { headers: { Origin: BASE } });
  };

  const openReader = async (vp, { theme = "light", storage = {} } = {}) => {
    const ctx = await browser.newContext({ ...VP[vp], storageState: state, colorScheme: "light" });
    await ctx.addInitScript(([t, kv]) => {
      try {
        if (sessionStorage.getItem("__seeded")) return;
        sessionStorage.setItem("__seeded", "1");
        localStorage.setItem("theme", t);
        for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
      } catch {
        /* no storage */
      }
    }, [theme, storage]);
    const page = await ctx.newPage();
    watch(page);
    await page.goto(BASE + "/papers/" + docId, { waitUntil: "networkidle" });
    await page.locator(".desk").waitFor({ timeout: 20000 });
    await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
    await page.locator('[data-page="1"] .textLayer span').first().waitFor({ timeout: 20000 });
    await sleep(600);
    return { ctx, page };
  };

  /* ================================================================ 1. every width: the views a screen is offered, the button, axe in three themes, no sideways scroll */
  console.log("1. the layout at every width");
  for (const vp of Object.keys(VP)) {
    const { ctx, page } = await openReader(vp);
    const wide = WIDE.includes(vp);
    const views = await page.getByRole("radiogroup", { name: "View" }).getByRole("radio").allInnerTexts();
    ok(JSON.stringify(views.map((v) => v.trim())) === JSON.stringify(wide ? ["Paper", "Split", "Notes"] : ["Paper", "Notes"]), `${vp}: the view switch offers ${views.map((v) => v.trim()).join(" | ")}`);
    ok((await page.getByRole("radio", { name: "Split" }).count()) === (wide ? 1 : 0), `${vp}: Split is ${wide ? "offered" : "never offered on a phone"}`);
    const first = await page.locator(".desk").getAttribute("data-view");
    ok(first === (wide ? "split" : "paper"), `${vp}: it opens in ${first} (wide: Split, as today; phone: Paper)`);
    ok((await page.locator(".dw-tabs").count()) === 0 && (await page.getByRole("button", { name: "Side panel" }).count()) === 0, `${vp}: none of the old layout's tabs or side-panel button`);
    const fab = page.locator(".desk-fab");
    const fb = await boxOf(fab);
    ok(fb && Math.round(fb.height) === 56 && fb.width >= 56, `${vp}: the Agents button is 56 px tall (${fb?.width.toFixed(0)} by ${fb?.height.toFixed(0)})`);
    ok((await fab.getAttribute("aria-label")) === "Agents" && (wide ? (await fab.innerText()).includes("Agents") : (await fab.innerText()).trim() === ""), `${vp}: ${wide ? "it says Agents" : "an icon, named Agents for a screen reader"}`);
    const vw = vp.split("x").map(Number);
    ok(fb && vw[0] - (fb.x + fb.width) >= 19 && vw[1] - (fb.y + fb.height) >= 19, `${vp}: at the bottom right, 20 px from the edges`);
    ok(await noSideways(page), `${vp}: no sideways scroll`);
    const tools = page.getByRole("radiogroup", { name: "Tool" }).getByRole("radio");
    ok(JSON.stringify(await tools.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))) === JSON.stringify(["Select", "Highlight", "Draw", "Capture"]), `${vp}: the tool segment is Select, Highlight, Draw, Capture (Capture since phase 2.5)`);
    ok((await page.locator(".pdfv-draw").count()) === 0 && (await page.locator(".pdfv-bar").getByRole("button", { name: "Download", exact: true }).count()) === 1, `${vp}: one Download button, no lone Draw button`);
    for (const theme of ["light", "dark", "read"]) {
      await setTheme(page, theme, 350);
      await axe(page, `reader, ${theme}, ${vp}`);
    }
    await ctx.close();
  }

  /* ================================================================ 2. the view switch, kept on reload; the old key; a wide screen turned into a phone */
  console.log("2. the view switch");
  {
    const { ctx, page } = await openReader("1280x800");
    const group = page.getByRole("radiogroup", { name: "View" });
    await group.getByRole("radio", { name: "Notes" }).click();
    await sleep(300);
    ok((await page.locator(".desk").getAttribute("data-view")) === "notes" && !(await page.locator("#dw-panel-paper").isVisible()), "Notes: the panel alone");
    const panel = await boxOf(page.locator("#dw-panel-side"));
    const list = await boxOf(page.locator("#desk-tabpanel-notes > *").first());
    // phase 2.5 (21.1, 1): the notes fill the panel in the Notes view (the Highlights and References keep a reading width)
    ok(panel.width > 1100 && list.width > panel.width - 40, `Notes on a wide screen: the panel is the window's width (${panel.width.toFixed(0)} px) and the notes fill it (${list.width.toFixed(0)} px)`);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".desk").waitFor();
    ok((await page.locator(".desk").getAttribute("data-view")) === "notes", "kept on reload");
    ok((await page.evaluate(() => localStorage.getItem("scholar.view"))) === "notes", "kept on this device as scholar.view");
    // the arrow keys move the choice inside the group
    await page.getByRole("radio", { name: "Notes" }).focus();
    await page.keyboard.press("ArrowLeft");
    await sleep(250);
    ok((await page.locator(".desk").getAttribute("data-view")) === "split" && (await page.evaluate(() => document.activeElement?.getAttribute("aria-checked"))) === "true", "the arrow keys move the view inside the radio group, and the focus with it");
    // the divider of Split: by keyboard, kept on this device
    const sep = page.getByRole("separator", { name: "Width of the panel" });
    const w0 = (await boxOf(page.locator("#dw-panel-side"))).width;
    await sep.focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
    await sleep(200);
    const w1 = (await boxOf(page.locator("#dw-panel-side"))).width;
    ok(w1 > w0 + 40, `the divider moves with the arrow keys: the panel ${w0.toFixed(0)} -> ${w1.toFixed(0)} px`);
    await page.keyboard.press("Home");
    await sleep(200);
    const w2 = (await boxOf(page.locator("#dw-panel-side"))).width;
    ok(w2 <= 1280 * 0.48 + 2, `and no wider than 48 % of the window (${w2.toFixed(0)} px)`);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".desk-grid").waitFor();
    ok(Math.abs((await boxOf(page.locator("#dw-panel-side"))).width - w2) < 3, "the width is kept on reload");
    // a window dragged narrow (or a tablet turned into a phone's shape) while in Split shows Paper, and Split is not offered
    await page.setViewportSize({ width: 700, height: 900 });
    await sleep(400);
    ok((await page.locator(".desk").getAttribute("data-view")) === "paper" && (await page.getByRole("radio", { name: "Split" }).count()) === 0, "wide to phone while in Split: Paper, and no Split offered");
    await page.setViewportSize({ width: 1280, height: 800 });
    await sleep(300);
    ok((await page.getByRole("radio", { name: "Split" }).count()) === 1, "wide again: Split is offered again");
    await ctx.close();
  }
  {
    const { ctx, page } = await openReader("1280x800", { storage: { "scholar.focus": "1" } });
    ok((await page.locator(".desk").getAttribute("data-view")) === "paper", "an old 'side panel put away' (scholar.focus) opens as Paper");
    ok((await page.evaluate(() => localStorage.getItem("scholar.view"))) === "paper", "and is kept under the new key from then on");
    await ctx.close();
  }

  /* ================================================================ 3. Highlight mode, keys outside and inside Draw */
  console.log("3. the tools");
  await clearNotes();
  {
    const { ctx, page } = await openReader("1280x800");
    await page.locator(".pdfv-scroll").focus();
    await page.keyboard.press("h");
    await sleep(250);
    ok((await page.getByRole("radio", { name: "Highlight" }).getAttribute("aria-checked")) === "true", "H picks Highlight (the focus in the pages)");
    const meanings = page.getByRole("radiogroup", { name: "Highlight as" });
    ok(await meanings.isVisible(), "the meaning picker shows while Highlight is the tool");
    ok(JSON.stringify(await meanings.getByRole("radio").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))) === JSON.stringify(["Key idea", "Method", "Question", "Result"]), "its four meanings, named");
    ok(JSON.stringify(await meanings.locator(".desk-dot").allInnerTexts()) === JSON.stringify(["K", "M", "Q", "R"]), "each dot carries its letter, so the colour is never the only sign");
    await meanings.getByRole("radio", { name: "Method" }).click();
    await pick(page, 1);
    await untilInPage(page, () => document.querySelectorAll('[data-page="1"] .pdfp-hl[data-color="green"]').length > 0, undefined, 8000);
    ok((await page.locator(".desk-pop").count()) === 0, "a selection made in Highlight mode is highlighted at once, with no pop-up");
    const made = await notesOf();
    ok(made.length === 1 && made[0].color === "green", `stored as green (Method): the stored colours do not change (${JSON.stringify(made.map((n) => n.color))})`);
    // keys: not while typing, and inside Draw they stay the drawing tools
    await page.locator(".pdfv-scroll").focus();
    await page.keyboard.press("v");
    await sleep(200);
    ok((await page.getByRole("radio", { name: "Select" }).getAttribute("aria-checked")) === "true" && !(await meanings.isVisible()), "V picks Select, and the picker goes");
    await page.locator("#pdfv-page").focus();
    await page.keyboard.press("h");
    await sleep(150);
    ok((await page.getByRole("radio", { name: "Select" }).getAttribute("aria-checked")) === "true", "H typed in a text field is a letter, not a tool");
    await page.locator(".pdfv-scroll").focus();
    await page.keyboard.press("d");
    await page.getByRole("toolbar", { name: "Draw on the paper" }).waitFor();
    ok((await page.getByRole("radio", { name: "Draw" }).getAttribute("aria-checked")) === "true", "D opens today's drawing tools");
    ok(!(await page.locator(".desk-fab").isVisible()), "the Agents button is hidden while Draw is in hand");
    await page.locator(".pdfv-scroll").focus();
    await page.keyboard.press("h");
    await sleep(200);
    const inkHl = await page.getByRole("toolbar", { name: "Draw on the paper" }).getByRole("button", { name: /^Highlighter/ }).getAttribute("aria-pressed");
    ok(inkHl === "true" && (await page.getByRole("radio", { name: "Draw" }).getAttribute("aria-checked")) === "true", "inside Draw, H is the freehand highlighter, as today (the reader's tool stays Draw)");
    await page.keyboard.press("Escape");
    await page.getByRole("toolbar", { name: "Draw on the paper" }).waitFor({ state: "hidden" }).catch(() => {});
    await sleep(300);
    ok((await page.getByRole("radio", { name: "Select" }).getAttribute("aria-checked")) === "true" && (await page.locator(".desk-fab").isVisible()), "Esc closes Draw: Select again, and the Agents button is back");
    // the Download menu
    await page.locator(".pdfv-bar").getByRole("button", { name: "Download", exact: true }).click();
    const menu = page.getByRole("menu", { name: "Download" });
    await menu.waitFor();
    ok(JSON.stringify((await menu.getByRole("menuitem").allInnerTexts()).map((t) => t.split("\n")[0].trim())) === JSON.stringify(["The original PDF", "A copy with my marks"]), "Download is one menu: the original, and a copy with my marks");
    await page.keyboard.press("Escape");
    await ctx.close();
  }

  /* ================================================================ 4. the pop-up: its actions, Copy refused, Explain, the keyboard; a highlight: recolour, Remove and Undo */
  console.log("4. the pop-up");
  await clearNotes();
  {
    const { ctx, page } = await openReader("1280x800");
    const text = await pick(page, 1);
    const pop = page.getByRole("toolbar", { name: "The selected text" });
    await pop.waitFor();
    const names = await pop.getByRole("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.textContent.trim()));
    ok(JSON.stringify(names) === JSON.stringify(["Highlight as Key idea", "Highlight as Method", "Highlight as Question", "Highlight as Result", "Add to notes", "Explain", "Copy"]), `a selection's pop-up: the four meanings, Add to notes, Explain, Copy (${names.join(", ")})`);
    await axe(page, "the selection pop-up");
    // the keyboard: Tab from the pages goes in, the arrows move, Esc gives the focus back
    await page.locator(".pdfv-scroll").focus();
    await page.keyboard.press("Tab");
    ok((await page.evaluate(() => document.activeElement?.closest(".desk-pop") !== null)), "Tab from the pages goes into the pop-up");
    await page.keyboard.press("ArrowRight");
    ok((await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Highlight as Method", "the arrows move inside it (a toolbar)");
    await page.keyboard.press("End");
    ok((await page.evaluate(() => document.activeElement?.textContent?.trim())) === "Copy", "End goes to its last button");
    await page.keyboard.press("Escape");
    await sleep(200);
    ok((await pop.count()) === 0 && (await page.evaluate(() => document.activeElement?.classList.contains("pdfv-scroll"))), "Esc closes it and gives the focus back to the pages");
    // Copy: said in a toast
    await pick(page, 1);
    await pop.waitFor();
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    await pop.getByRole("button", { name: "Copy" }).click();
    const toastBox = page.locator(".desk-toasts");
    await page.locator(".desk-toast", { hasText: "Copied" }).waitFor({ timeout: 4000 });
    ok((await toastBox.getAttribute("role")) === "status", "Copy says Copied, in a toast (role=status)");
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
    ok(clip.trim() === text, `the text is on the clipboard ("${clip.slice(0, 40)}")`);
    // Copy refused by the browser: said, never silent, in the notice banner
    await page.evaluate(() => {
      navigator.clipboard.writeText = () => Promise.reject(new Error("denied"));
      document.execCommand = () => false;
    });
    await pick(page, 1);
    await pop.waitFor();
    await pop.getByRole("button", { name: "Copy" }).click();
    const notice = page.locator(".notice[role=alert]");
    await notice.waitFor({ timeout: 4000 });
    ok((await notice.innerText()).includes("Could not copy. Select the text and press Ctrl+C."), "a refused copy says: Could not copy. Select the text and press Ctrl+C.");
    await notice.getByRole("button", { name: "Dismiss" }).click();
    // Explain: the Agents drawer opens on Explain with the selection, ready to send (phase 3; e2e/agents.mjs checks the agent itself)
    await pick(page, 2);
    await pop.waitFor();
    const second = await page.evaluate(() => getSelection().toString().replace(/\s+/g, " ").trim());
    await pop.getByRole("button", { name: "Explain" }).click();
    const drawer = page.getByRole("complementary", { name: "Agents" });
    await drawer.waitFor({ timeout: 8000 });
    const sel = (await drawer.locator(".agent-sel-text").textContent()) ?? "";
    ok((await drawer.getByRole("radio", { name: "Explain" }).getAttribute("aria-checked")) === "true" && sel.includes(second.slice(0, 20)), `Explain opens the Agents on Explain, the selection its chip (${sel.slice(0, 50)}…)`);
    await untilInPage(page, () => document.activeElement?.id === "agent-input-explain", undefined, 5000);
    ok((await drawer.locator('[data-agent="explain"] .ask-answer').count()) === 0, "nothing is asked yet: the focus is in its question box, ready to send");
    await page.keyboard.press("Escape");
    await sleep(200);
    ok(!(await drawer.isVisible()) && (await page.evaluate(() => document.activeElement?.classList.contains("desk-fab"))), "Esc closes the drawer and gives the focus back to the Agents button");
    // a highlight, clicked: recolour, Remove and Undo
    await pick(page, 1);
    await pop.waitFor();
    await pop.getByRole("button", { name: "Highlight as Key idea" }).click();
    await page.locator('[data-page="1"] .pdfp-hl[data-color="yellow"]').first().waitFor({ timeout: 8000 });
    const made = (await notesOf())[0];
    await api.patch(`${BASE}/api/v1/documents/${docId}/notes/${made.id}`, { headers: { Origin: BASE }, data: { note: "keep this note" } });
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('[data-page="1"] .pdfp-hl[data-color="yellow"]').first().waitFor({ timeout: 20000 });
    await sleep(500);
    const mark = await boxOf(page.locator('[data-page="1"] .pdfp-hl[data-color="yellow"]').first());
    await page.mouse.click(mark.x + mark.width / 2, mark.y + mark.height / 2);
    const hpop = page.getByRole("toolbar", { name: /^Highlight on page 1: Key idea/ });
    await hpop.waitFor({ timeout: 4000 });
    ok((await hpop.getByRole("button", { name: "Key idea (its meaning now)" }).getAttribute("aria-pressed")) === "true", "a click on a highlight opens its pop-up; its own meaning is marked (a ring)");
    const hnames = await hpop.getByRole("button").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.textContent.trim()));
    ok(hnames.includes("Change to Result") && hnames.includes("Explain") && hnames.includes("Copy") && hnames.includes("Remove"), `its actions: recolour, Add to notes, Explain, Copy, Remove (${hnames.join(", ")})`);
    await hpop.getByRole("button", { name: "Change to Result" }).click();
    await page.locator('[data-page="1"] .pdfp-hl[data-color="pink"]').first().waitFor({ timeout: 8000 });
    ok((await notesOf())[0].color === "pink", "recoloured: stored as pink (Result)");
    await sleep(300);
    const mark2 = await boxOf(page.locator('[data-page="1"] .pdfp-hl[data-color="pink"]').first());
    await page.mouse.click(mark2.x + mark2.width / 2, mark2.y + mark2.height / 2);
    await page.getByRole("toolbar", { name: /^Highlight on page 1: Result/ }).getByRole("button", { name: "Remove" }).click();
    const undoToast = page.locator(".desk-toast", { hasText: "Highlight removed" });
    await undoToast.waitFor({ timeout: 6000 });
    ok((await notesOf()).length === 0, "Remove deletes the highlight, and a toast says so");
    // the toast's Undo is a real button the keyboard reaches
    await page.locator(".pdfv-scroll").focus();
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => document.activeElement?.classList.contains("desk-toast-act"));
    }
    ok(reached, "Tab reaches the toast's Undo");
    await sleep(4500);
    ok(await undoToast.isVisible(), "the toast waits while it has the focus (more than 4 s)");
    await page.keyboard.press("Enter");
    await untilInPage(page, () => document.querySelectorAll('[data-page="1"] .pdfp-hl[data-color="pink"]').length > 0, undefined, 8000);
    const back = await notesOf();
    ok(back.length === 1 && back[0].color === "pink" && back[0].note === "keep this note" && back[0].quote === made.quote, "Undo brings the highlight back, with its meaning and its note");
    await ctx.close();
  }

  /* ================================================================ 5. the meanings' names: the Highlights tab, its Markdown, a question about the highlights */
  console.log("5. the meanings, named");
  {
    const { ctx, page } = await openReader("1280x800");
    const tabs = page.getByRole("tablist", { name: "Notes, highlights or references" }).getByRole("tab");
    ok(JSON.stringify((await tabs.allInnerTexts()).map((t) => t.replace(/\d+/g, "").trim())) === JSON.stringify(["Notes", "Highlights", "References"]), "the panel's tabs: Notes (phase 2), Highlights and References");
    await tabs.nth(1).click();
    const chips = await page.locator(".hl-filter .hl-chip").allInnerTexts();
    ok(chips.some((c) => c.startsWith("Result")), `the colour filter names the meanings (only those with highlights since phase 2) (${chips.map((c) => c.replace(/\s+/g, " ")).join(" · ")})`);
    // phase 2's tidier head: no chip for a meaning with none, the chips on one line, the head one row with one Export menu
    ok(chips.every((c) => !/\b0\s*$/.test(c.trim())), `no chip for a meaning with no highlight (${chips.map((c) => c.replace(/\s+/g, " ")).join(" · ")})`);
    const tops = await page.locator(".hl-filter > .chip-btn").evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))]);
    ok(tops.length === 1, `the chips are on one line (${tops.length})`);
    const chipH = await page.locator(".hl-filter > .chip-btn").evaluateAll((els) => Math.min(...els.map((e) => e.getBoundingClientRect().height)));
    ok(chipH >= 32, `each chip is at least 32 px high (${chipH})`);
    const head = await page.locator(".notes-head > :not(.sr-only)").evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => r.top + r.height / 2));
    ok(Math.max(...head) - Math.min(...head) < 8, "the Highlights head is one row on a wide screen");
    ok((await page.locator(".notes-actions").getByRole("button", { name: "Download" }).count()) === 0, "Copy and Download sit in one Export menu");
    await page.getByRole("button", { name: "By colour" }).click();
    const dl = page.waitForEvent("download");
    await page.locator(".notes-actions").getByRole("button", { name: "Export" }).click();
    await page.getByRole("menuitem", { name: "Download (Markdown)" }).click();
    const md = readFileSync(await (await dl).path(), "utf8");
    ok(md.includes("## Result (pink, 1)"), `the Markdown names its sections by meaning ("## Result (pink, 1)")`);
    // a question about the highlights sends the meanings
    await page.locator(".desk-fab").click();
    await page.getByRole("complementary", { name: "Agents" }).waitFor();
    const sent = page.waitForRequest((r) => r.url().endsWith("/ask-highlights") && r.method() === "POST");
    await page.locator("#ask-input").fill("Summarise what I highlighted");
    await page.keyboard.press("Enter");
    const body = JSON.parse((await sent).postData() ?? "{}");
    ok(body.legend?.yellow === "Key idea" && body.legend?.pink === "Result", `a question about the highlights sends the meanings (${JSON.stringify(body.legend)})`);
    await page.locator(".ask-answer[data-source=highlights], .ask-error").first().waitFor({ timeout: 20000 }).catch(() => {});
    ok(await page.getByText("Answers cite pages. Check the passage before you rely on an answer.").isVisible(), "the drawer's standing line");
    ok(JSON.stringify(await page.locator(".desk-agent-chip").allInnerTexts()) === JSON.stringify(["Ask", "Explain", "Critique", "Note-taker"]), "the agents of phase 3: Ask, Explain, Critique, Note-taker (Related comes with phase 4)");
    await page.keyboard.press("Escape");
    // the palette lists the Agents
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog").getByRole("combobox").fill("Agents");
    await sleep(300);
    await page.keyboard.press("Enter");
    await page.getByRole("complementary", { name: "Agents" }).waitFor({ timeout: 5000 });
    ok(true, "Agents is in the command palette (Ctrl+K)");
    await ctx.close();
  }

  /* ================================================================ 6. the Agents button never covers the pop-up or a toast; the phone's sheet is a dialog */
  console.log("6. the Agents button and the phone's sheet");
  for (const vp of ["390x844", "1280x800"]) {
    const { ctx, page } = await openReader(vp);
    await pick(page, 2);
    const pop = page.locator(".desk-pop");
    await pop.waitFor();
    await sleep(500);
    ok(!overlap(await boxOf(page.locator(".desk-fab")), await boxOf(pop)), `${vp}: the Agents button stays clear of the pop-up`);
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    await pop.getByRole("button", { name: "Copy" }).click();
    await page.locator(".desk-toast").waitFor();
    await sleep(500);
    ok(!overlap(await boxOf(page.locator(".desk-fab")), await boxOf(page.locator(".desk-toast"))), `${vp}: and clear of the toast`);
    if (vp === "390x844") {
      ok((await boxOf(page.locator(".desk-toast"))).y + (await boxOf(page.locator(".desk-toast"))).height <= (await boxOf(page.locator(".desk-fab"))).y + 1, "on a phone the toast sits above the button");
      await page.locator(".desk-fab").click();
      const sheet = page.getByRole("dialog", { name: "Agents" });
      await sheet.waitFor();
      await sleep(900); // its slide in, and the suggestions' entrance
      ok((await sheet.getAttribute("aria-modal")) === "true", "on a phone the drawer is a modal dialog");
      const sb = await boxOf(sheet);
      ok(Math.abs(sb.height - 844 * 0.88) < 4 && Math.abs(sb.y + sb.height - 844) < 2, `a bottom sheet of 88 % of the height (${sb.height.toFixed(0)} px)`);
      ok(await page.evaluate(() => document.getElementById("root").inert === true), "the page behind it is inert");
      let inside = true;
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press("Tab");
        inside &&= await page.evaluate(() => !!document.activeElement?.closest("#desk-agents"));
      }
      ok(inside, "Tab keeps the focus inside the sheet");
      await axe(page, "the phone's Agents sheet");
      await page.keyboard.press("Escape");
      await sleep(250);
      ok(!(await sheet.isVisible()) && (await page.evaluate(() => document.getElementById("root").inert === false)), "Esc closes it, and the page is usable again");
      // a swipe down on its top closes it
      await page.locator(".desk-fab").click();
      await sheet.waitFor();
      // the sheet slides in: the swipe starts where its top has come to rest, not where it was in the first frame (on a slower start it was still moving, 17 Nov 2026)
      await page.waitForFunction(async () => {
        const top = () => document.querySelector(".desk-agents-head")?.getBoundingClientRect().top ?? NaN;
        const a = top();
        await new Promise((r) => setTimeout(r, 120));
        return Number.isFinite(a) && Math.abs(top() - a) < 0.5;
      }, null, { timeout: 5000 });
      const head = await boxOf(page.locator(".desk-agents-head"));
      await page.mouse.move(head.x + 60, head.y + 12);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(head.x + 60, head.y + 12 + i * 22);
      await page.mouse.up();
      await sheet.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
      ok(!(await sheet.isVisible()), "a swipe down on its top closes it");
      const ppad = await page.locator(".pdfv-pages").evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
      ok(ppad >= 56 + 20 + 16 - 1, `on a phone the paper keeps room under its last page for the button (padding ${ppad} px)`);
      // Notes on a phone: the panel alone
      await page.getByRole("radio", { name: "Notes" }).click();
      await sleep(300);
      ok((await page.locator("#dw-panel-side").isVisible()) && !(await page.locator("#dw-panel-paper").isVisible()), "Notes on a phone: the panel, and no paper");
      ok(await noSideways(page), "no sideways scroll in Notes");
    } else {
      await page.locator(".desk-fab").click();
      const side = page.getByRole("complementary", { name: "Agents" });
      await side.waitFor();
      await sleep(900); // its slide in, and the suggestions' entrance
      ok((await side.getAttribute("aria-modal")) === null && (await page.evaluate(() => document.getElementById("root").inert)) === false, "on a wide screen the drawer is a complementary region, not modal: the paper stays usable");
      const sw = await boxOf(side);
      ok(Math.abs(sw.width - 26 * 16) < 2, `a sheet from the right, 26rem (${sw.width.toFixed(0)} px)`);
      const fab = page.locator(".desk-fab");
      ok(!(await fab.isVisible()), "the Agents button is hidden while the drawer is open (one Close only: the drawer's own)");
      ok((await page.getByRole("button", { name: "Close the agents" }).count()) === 1, "exactly one Close button");
      ok((await side.locator(".ask-title").count()) === 0 && (await side.getByText(/passages indexed/).count()) === 1, "inside the drawer the Ask panel's own title is left out; its line about the passages stays");
      await axe(page, "the Agents drawer, wide");
      await side.getByRole("button", { name: "Close the agents" }).click();
      await sleep(250);
      ok(!(await side.isVisible()) && (await fab.isVisible()) && (await page.evaluate(() => document.activeElement?.classList.contains("desk-fab"))), "the drawer's x closes it, the button is back and has the focus");
      const pad = await page.locator(".notes-body").evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom));
      const fb = await boxOf(fab);
      ok(pad >= fb.height + 20 + 16 - 1, `the panel's list keeps room under its last item for the button (padding ${pad} px)`);
    }
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
finish("reader (phase 1) e2e passed");
