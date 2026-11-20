// Browser e2e for the agents of the new Paper Reader, phase 3 (docs/design/paper-reader.md, 9, 16 and 23): written for READER "on" (the named run reader-on starts the Worker so;
// scripts/lib/suites.mjs), with the stand-in model. The drawer's chips (a radio group) and the line saying what each agent does; Ask, Explain (from the pop-up, with its selection chip, and a
// named idea), Critique (points with their passage and the label, the stand-in's invented point left out) and the Note-taker (a draft, Discard, Add as a new page); "+ Add to notes" making an
// agent block that survives a reload and is in the Markdown and Word exports; the line a paper with no index gets; the phone's sheet; axe in Light, Dark and Read; no sideways scroll.
// With AGENTS_SHOTS=<folder> it also takes the owner's pictures.
// Needs the Worker with the fake identity provider and the offline stand-ins: `npm run integration -w apps/api -- --browser --run=reader-on` starts it.
//   node e2e/agents.mjs [baseUrl]    (default http://localhost:8788; READER must be on there)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SAMPLE_PAPER, makePdf } from "@scholar/test-support/make-pdf.mjs";
import { BASE, REFUSED_OR_BUSY, axeCheck, countFailure, desk, finish, launch, noSideways, ok, phone, sleep, startIdp, untilInPage, watchPage } from "./lib/browser.mjs";

const SHOTS = process.env.AGENTS_SHOTS ?? null;
const shot = async (p, name) => {
  if (SHOTS) await p.screenshot({ path: join(SHOTS, `${name}.png`) });
};
const idp = await startIdp();
idp.setUser({ sub: "reader-agents-1", email: "isha.a@example.edu", email_verified: true, name: "Isha A" });
const browser = await launch();
const errors = [];
const watch = (p) => watchPage(p, errors, { allowed: REFUSED_OR_BUSY });
const axe = (p, label) => axeCheck(p, label, { inlineCites: true });

/** In the page: selects the idx-th longer piece of text on page 1 and lifts the "mouse" there. Returns the text. */
const pick = (p, idx = 1) =>
  p.evaluate(async (i) => {
    const layer = document.querySelector('[data-page="1"] .textLayer');
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
  const pagesOnServer = async () => {
    for (let i = 0; i < 12; i++) {
      const r = await api.get(`${BASE}/api/v1/documents/${docId}/notebook`);
      if (r.ok()) return (await r.json()).pages;
      await sleep(500);
    }
    throw new Error("GET .../notebook kept failing");
  };
  const agentBlocks = async () => (await pagesOnServer()).flatMap((p) => p.blocks.filter((b) => b.kind === "agent"));

  const openReader = async (vp, { theme = "light" } = {}) => {
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
    const page = await ctx.newPage();
    watch(page);
    await page.goto(BASE + "/papers/" + docId, { waitUntil: "networkidle" });
    await page.locator(".desk").waitFor({ timeout: 20000 });
    await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
    await page.locator('[data-page="1"] .textLayer span').first().waitFor({ timeout: 20000 });
    await sleep(600);
    return { ctx, page };
  };
  const toastSays = async (page, re) => {
    const t = page.locator(".desk-toast");
    await t.filter({ hasText: re }).first().waitFor({ timeout: 8000 });
    return true;
  };

  /* ================================================================ 1. the drawer: chips, what each does, axe */
  console.log("1. the drawer and its agents");
  {
    const { ctx, page } = await openReader(desk(1280, 800));
    await page.locator(".desk-fab").click();
    const drawer = page.getByRole("complementary", { name: "Agents" });
    await drawer.waitFor();
    await sleep(800);
    const group = drawer.getByRole("radiogroup", { name: "Agent" });
    ok(JSON.stringify(await group.getByRole("radio").allInnerTexts()) === JSON.stringify(["Ask", "Explain", "Critique", "Note-taker"]), "the agent chips: Ask · Explain · Critique · Note-taker, a radio group (Related comes with phase 4)");
    ok((await group.getByRole("radio", { name: "Ask" }).getAttribute("aria-checked")) === "true", "Ask is chosen first");
    const what = {
      Ask: "Questions about this paper, or about your highlights.",
      Explain: "Explains a passage you select, or an idea you name, in plain words.",
      Critique: "Looks for weak points: thin evidence, missing baselines, claims larger than the results, limitations.",
      "Note-taker": "Turns your highlights and their notes into a draft page of notes.",
    };
    for (const [name, line] of Object.entries(what)) {
      await group.getByRole("radio", { name }).click();
      await sleep(350);
      ok((await drawer.locator(".desk-agents-what").innerText()) === line, `${name}: one line says what it does`);
      ok(await drawer.getByText("Answers cite pages. Check the passage before you rely on an answer.").isVisible(), `${name}: the standing line`);
      await shot(page, `drawer-${name.toLowerCase().replace(/[^a-z]+/g, "")}-desktop-light`);
    }
    // the arrows move the choice inside the group
    await group.getByRole("radio", { name: "Note-taker" }).focus();
    await page.keyboard.press("ArrowLeft");
    await sleep(200);
    ok((await group.getByRole("radio", { name: "Critique" }).getAttribute("aria-checked")) === "true" && (await page.evaluate(() => document.activeElement?.getAttribute("data-agent-chip"))) === "critique", "← moves the choice (and the focus) to Critique");
    await axe(page, "the drawer on Critique, Light");
    await ctx.close();
  }

  /* ================================================================ 2. Ask, and + Add to notes: an agent block that survives a reload and is in the exports */
  console.log("2. + Add to notes on an Ask answer");
  {
    const { ctx, page } = await openReader(desk(1280, 800));
    await page.locator(".desk-fab").click();
    const drawer = page.getByRole("complementary", { name: "Agents" });
    await drawer.waitFor();
    await page.locator("#ask-input").fill("How were participants recruited?");
    await page.keyboard.press("Enter");
    const card = drawer.locator('.desk-agent-view:not([hidden]) .ask-answer').last();
    await card.waitFor({ timeout: 20000 });
    const add = card.getByRole("button", { name: "Add this answer to your notes" });
    ok((await add.innerText()).trim() === "+ Add to notes", "every Ask answer has + Add to notes");
    await add.click();
    ok(await toastSays(page, /^Added to "Notes"/), "a toast says where it went (with Undo)");
    ok((await card.getByRole("button", { name: /is in your notes/ }).innerText()).includes("In notes"), "the button then says In notes");
    // the drawer sits over the panel's side on a wide screen: closed, the notes are in sight
    await drawer.getByRole("button", { name: "Close the agents" }).click();
    await page.getByRole("tab", { name: /^Notes/ }).first().click();
    const block = page.locator(".nb-agent").first();
    await block.waitFor({ timeout: 10000 });
    const head = await block.locator(".nb-agent-head").innerText();
    ok(/^✦\s*Ask · p\. \d/.test(head.trim()), `the block's small header: the agent and its pages (${head.trim()})`);
    ok((await block.locator(".nb-go").count()) >= 1 && (await block.locator(".nb-agent-md").innerText()).includes("(p. "), "page links p. N ↗, and the answer keeps its pages as (p. N)");
    await page.locator(".nb-save").filter({ hasText: /^Saved/ }).waitFor({ timeout: 10000 });
    const kept = await agentBlocks();
    ok(kept.length === 1 && kept[0].agent === "ask" && kept[0].ask === "How were participants recruited?" && kept[0].pages.length >= 1 && !/\[\d\]/.test(kept[0].md), `the server keeps it as an agent block with its question, pages and no marks (${JSON.stringify(kept[0]?.pages)})`);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".nb-agent").first().waitFor({ timeout: 15000 });
    ok(true, "a reload keeps it");
    await shot(page, "agent-block-in-notes");
    // the exports
    const exportAs = async (item) => {
      await page.locator(".nb-export").click();
      const m = page.getByRole("menu", { name: "Export" });
      await m.getByRole("menuitemradio", { name: "All pages" }).click();
      const dl = page.waitForEvent("download", { timeout: 30000 });
      await m.getByRole("menuitem", { name: item, exact: true }).click();
      const d = await dl;
      return readFileSync(await d.path());
    };
    const md = (await exportAs("Markdown")).toString("utf8");
    ok(/Ask · p\. \d/.test(md) && md.includes("*Asked: How were participants recruited?*"), "the Markdown export has the block's header and its question");
    const docx = await exportAs("Word (.docx)");
    const { unzipSync, strFromU8 } = await import("fflate");
    const xml = strFromU8(unzipSync(new Uint8Array(docx))["word/document.xml"]);
    ok(/Ask · p\. \d/.test(xml) && xml.includes("Asked: How were participants recruited?"), "the Word export has it too");
    await ctx.close();
  }

  /* ================================================================ 3. Explain: from the pop-up, with its selection, and a named idea */
  console.log("3. Explain");
  {
    const { ctx, page } = await openReader(desk(1280, 800));
    const text = await pick(page, 1);
    const pop = page.getByRole("toolbar", { name: "The selected text" });
    await pop.waitFor({ timeout: 6000 });
    let early = 0;
    const count = (r) => r.url().includes(`/documents/${docId}/ask`) && r.method() === "POST" && early++;
    page.on("request", count);
    await pop.getByRole("button", { name: "Explain" }).click();
    const drawer = page.getByRole("complementary", { name: "Agents" });
    await drawer.waitFor();
    const view = drawer.locator('[data-agent="explain"]');
    ok((await view.locator(".agent-sel-label").textContent()).trim() === "Selection · p. 1" && (await view.locator(".agent-sel-text").textContent()).includes(text.slice(0, 20)), "the selection is its chip: SELECTION · p. 1 “…” ×");
    await untilInPage(page, () => document.activeElement?.id === "agent-input-explain", undefined, 5000);
    await sleep(1200);
    page.off("request", count);
    ok(early === 0 && (await view.locator(".ask-answer, .ask-live").count()) === 0, "the pop-up's Explain asks nothing yet: the selection waits, the question box has the focus (the owner's choice)");
    await shot(page, "explain-before-send");
    const asked = page.waitForRequest((r) => r.url().includes(`/documents/${docId}/ask`) && r.method() === "POST");
    await page.keyboard.press("Enter");
    const body = JSON.parse((await asked).postData() ?? "{}");
    ok(body.mode === "explain" && body.page === 1 && body.selection === text.replace(/\s+/g, " ").trim(), `Send asks the Explain agent with the selection and its page (${JSON.stringify({ mode: body.mode, page: body.page })})`);
    const card = view.locator(".ask-answer").last();
    await card.waitFor({ timeout: 20000 });
    ok((await card.locator(".ask-status").innerText()).includes("Every source checked against the paper") && (await card.locator(".cite-chip").count()) >= 1 && (await card.locator(".ask-source").count()) >= 1, "it explains it, citing pages, every source checked");
    ok(await view.locator(".sr-only[role=status]").evaluate((el) => el.textContent.startsWith("Explained")), "the live region says it is explained (not word by word)");
    await card.evaluate((el) => { const s = el.closest(".ask-scroll"); if (s) s.scrollTop += el.getBoundingClientRect().top - s.getBoundingClientRect().top - 8; });
    await shot(page, "explain-answer-from-selection");
    await card.getByRole("button", { name: "Add this explanation to your notes" }).click();
    ok(await toastSays(page, /^Added to/), "+ Add to notes on an explanation");
    // a named idea, the selection taken away
    await view.getByRole("button", { name: "Take the selection away" }).click();
    ok((await view.locator(".agent-sel").count()) === 0, "× takes the selection away");
    await page.locator("#agent-input-explain").fill("glaucoma screening");
    await page.keyboard.press("Enter");
    await view.locator(".ask-answer").nth(1).waitFor({ timeout: 20000 });
    ok((await view.locator(".agent-q").last().innerText()).includes("glaucoma screening"), "a named idea is explained too");
    // a passage that is not in the paper is refused by the server, and said
    const bad = await api.post(`${BASE}/api/v1/documents/${docId}/ask`, { headers: { Origin: BASE }, data: { mode: "explain", selection: "quantum chromodynamics of the strong interaction", page: 1 } });
    ok(bad.status() === 400 && (await bad.json()).title === "That passage is not in this paper", "a selection that is not in the paper is refused (400)");
    await sleep(800);
    const blocks = await agentBlocks();
    ok(blocks.some((b) => b.agent === "explain" && b.ask.startsWith(text.slice(0, 10)) && b.pages.includes(1)), "the explanation is kept as an Explain block, with what it explained");
    await ctx.close();
  }

  /* ================================================================ 4. Critique: points with their passage and the label; the invented point left out */
  console.log("4. Critique");
  {
    const { ctx, page } = await openReader(desk(1280, 800));
    await page.locator(".desk-fab").click();
    const drawer = page.getByRole("complementary", { name: "Agents" });
    await drawer.waitFor();
    await drawer.getByRole("radio", { name: "Critique" }).click();
    const view = drawer.locator('[data-agent="critique"]');
    await view.getByRole("button", { name: "Critique the whole paper" }).click();
    const card = view.locator(".crit").last();
    await card.waitFor({ timeout: 20000 });
    const points = card.locator(".crit-point");
    const n = await points.count();
    ok(n >= 1, `points are shown (${n})`);
    let labelled = true;
    let quoted = true;
    for (let i = 0; i < n; i++) {
      labelled &&= (await points.nth(i).locator(".crit-label").innerText()) === "A reading of the paper, not a fact";
      quoted &&= /^p\. \d/.test(await points.nth(i).locator(".ask-source-page").innerText());
    }
    ok(labelled, "each point is labelled A reading of the paper, not a fact");
    ok(quoted, "each point quotes its passage, with its page");
    ok(/1 point was left out: its quote was not found in the paper\./.test(await card.locator(".crit-dropped").innerText()), "the stand-in's invented point is left out, and that is said");
    ok(!(await card.innerText()).includes("this sentence is not anywhere in the paper"), "its invented quote is nowhere on screen");
    await card.evaluate((el) => { const s = el.closest(".ask-scroll"); if (s) s.scrollTop += el.getBoundingClientRect().top - s.getBoundingClientRect().top - 8; });
    await shot(page, "critique-answer");
    await axe(page, "a critique, Light");
    // a point's passage opens in the paper
    await points.first().locator(".crit-quote").click();
    await sleep(600);
    ok(true, "a point's passage is a button to the paper");
    await card.getByRole("button", { name: "Add this critique to your notes" }).click();
    ok(await toastSays(page, /^Added to/), "+ Add to notes on a critique");
    await sleep(1600);
    const crit = (await agentBlocks()).find((b) => b.agent === "critique");
    ok(!!crit && crit.md.includes("A reading of the paper, not a fact") && crit.pages.length >= 1, "kept as a Critique block, every point with its label and page");
    await ctx.close();
  }

  /* ================================================================ 5. the Note-taker: a draft, Discard, Add as a new page */
  console.log("5. the Note-taker");
  {
    const made = [];
    for (const [page, quote, color] of [[1, "automated glaucoma screening from retinal photographs", "yellow"], [2, "Participants were recruited from three hospitals in Pune", "green"], [3, "The model reached a sensitivity of 91 percent", "pink"]]) {
      const r = await api.post(`${BASE}/api/v1/documents/${docId}/notes`, { headers: { Origin: BASE }, data: { page, quote, color } });
      made.push((await r.json()).note?.id);
    }
    const { ctx, page } = await openReader(desk(1280, 800));
    await page.locator(".desk-fab").click();
    const drawer = page.getByRole("complementary", { name: "Agents" });
    await drawer.waitFor();
    await drawer.getByRole("radio", { name: "Note-taker" }).click();
    const view = drawer.locator('[data-agent="notes"]');
    await view.getByRole("button", { name: "Draft a page from my 3 highlights" }).click();
    const draft = view.getByRole("region", { name: "Draft page" });
    await draft.waitFor({ timeout: 20000 });
    const heads = await draft.locator(".nt-text h4").allInnerTexts();
    ok(JSON.stringify(heads) === JSON.stringify(["Key idea", "Method", "Result"]), `headings by meaning, in their order (${heads.join(", ")})`);
    const bullets = await draft.locator(".nt-text li").allInnerTexts();
    ok(bullets.length >= 1 && bullets.every((b) => /\(p\. \d+(, \d+)*\)$/.test(b)), `every bullet keeps its p. N (${bullets.join(" | ")})`);
    ok((await draft.locator(".nb-quote").count()) >= 1, "a highlight kept as itself is a quote, with its meaning by name");
    ok((await draft.locator(".nt-draft-kicker").innerText()).toLowerCase().includes("not saved"), "it says it is a draft, not saved yet");
    await shot(page, "notetaker-draft");
    await axe(page, "the Note-taker's draft, Light");
    const before = (await pagesOnServer()).length;
    await draft.getByRole("button", { name: "Discard" }).click();
    ok((await view.getByRole("region", { name: "Draft page" }).count()) === 0 && (await pagesOnServer()).length === before, "Discard: the draft goes, nothing is kept");
    await view.getByRole("button", { name: "Draft a page from my 3 highlights" }).click();
    await view.getByRole("region", { name: "Draft page" }).waitFor({ timeout: 20000 });
    await view.getByRole("button", { name: "Add as a new page" }).click();
    ok(await toastSays(page, /^Added "Notes from my highlights" to your notes/), "Add as a new page: a toast with Undo and Open");
    await sleep(2200);
    const pages = await pagesOnServer();
    const np = pages.find((p) => p.title === "Notes from my highlights");
    ok(!!np && np.blocks.some((b) => b.kind === "quote" && made.includes(b.noteId)) && np.blocks.some((b) => b.kind === "text" && b.md.startsWith("## Key idea")), "it is a normal page of the notes, its quotes linked to the highlights");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("tablist", { name: "Pages" }).getByRole("tab", { name: /Notes from my highlights/ }).waitFor({ timeout: 15000 });
    ok(true, "a reload keeps the page");
    await ctx.close();
  }

  /* ================================================================ 6. a paper with no index: Explain, Critique and the Note-taker say so */
  console.log("6. no index");
  {
    const { ctx, page } = await openReader(desk(1280, 800));
    await page.route(`**/api/v1/documents/${docId}`, async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      const res = await route.fetch();
      const j = await res.json();
      j.document.status = "processing";
      await route.fulfill({ response: res, json: j });
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".desk").waitFor({ timeout: 20000 });
    await page.locator(".desk-fab").click();
    const drawer = page.getByRole("complementary", { name: "Agents" });
    await drawer.waitFor();
    for (const name of ["Explain", "Critique", "Note-taker"]) {
      await drawer.getByRole("radio", { name }).click();
      await sleep(250);
      ok((await drawer.locator(".desk-agent-view:not([hidden]) .agent-noindex").innerText()).includes("This paper has no index yet"), `${name} says the paper has no index yet`);
    }
    await ctx.close();
  }

  /* ================================================================ 7. the phone's sheet, Dark and Read; axe; no sideways scroll */
  console.log("7. phone, Dark and Read");
  {
    const { ctx, page } = await openReader(phone(390, 844), { theme: "dark" });
    await page.locator(".desk-fab").click();
    const sheet = page.getByRole("dialog", { name: "Agents" });
    await sheet.waitFor();
    await sleep(900);
    await sheet.getByRole("radio", { name: "Explain" }).click();
    await sleep(300);
    const chips = await boxOf(sheet.locator(".desk-agents-pick"));
    ok(chips && chips.width <= 390, "the chips fit the phone's sheet");
    ok(await noSideways(page), "no sideways scroll with the sheet open");
    await axe(page, "the phone's sheet on Explain, Dark");
    await shot(page, "drawer-phone-dark");
    await sheet.getByRole("radio", { name: "Critique" }).click();
    await sheet.locator('[data-agent="critique"]').getByRole("button", { name: "Critique the whole paper" }).click();
    await sheet.locator('[data-agent="critique"] .crit').waitFor({ timeout: 20000 });
    await axe(page, "a critique in the phone's sheet, Dark");
    await sheet.locator('[data-agent="critique"] .crit').evaluate((el) => { const s = el.closest(".ask-scroll"); if (s) s.scrollTop += el.getBoundingClientRect().top - s.getBoundingClientRect().top - 8; });
    await shot(page, "critique-phone-dark");
    await ctx.close();
    const r = await openReader(desk(1280, 800), { theme: "read" });
    await r.page.locator(".desk-fab").click();
    const d = r.page.getByRole("complementary", { name: "Agents" });
    await d.waitFor();
    await d.getByRole("radio", { name: "Critique" }).click();
    await d.locator('[data-agent="critique"]').getByRole("button", { name: "Critique the methods" }).click();
    await d.locator('[data-agent="critique"] .crit').waitFor({ timeout: 20000 });
    await axe(r.page, "a critique, Read");
    await d.locator('[data-agent="critique"] .crit').evaluate((el) => { const s = el.closest(".ask-scroll"); if (s) s.scrollTop += el.getBoundingClientRect().top - s.getBoundingClientRect().top - 8; });
    await shot(r.page, "critique-read-theme");
    await r.ctx.close();
    const dk = await openReader(desk(1280, 800), { theme: "dark" });
    await dk.page.getByRole("tab", { name: /^Notes/ }).first().click();
    await dk.page.locator(".nb-agent").first().waitFor({ timeout: 15000 });
    await axe(dk.page, "an agent block in the notes, Dark");
    await dk.ctx.close();
  }

  ok(errors.length === 0, `no page errors (${errors.slice(0, 3).join(" | ")})`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  countFailure();
}
await browser.close();
await idp.close?.();
finish("all agents checks passed", (n) => `${n} check(s) FAILED`);

function boxOf(loc) {
  return loc.boundingBox();
}
