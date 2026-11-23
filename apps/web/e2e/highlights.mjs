// Browser e2e for highlights and the passages a jump marks (the owner's report of 21 Nov 2026: "sometimes the highlighter does not work", "sometimes Ask's answer reference does not
// highlight"). A one-page two-column paper made the way TeX makes them (packages/test-support/make-hard-pdf.mjs: a caption with math in many small pieces, ligatures, a hyphenated
// word, a TeX accent): the whole caption highlighted is drawn over every line and is still drawn after a reload; Ask's citation of a sentence with the hyphenated word goes to its page
// and marks it for a moment (an outline that fades, never saved, not a highlight); the quote of a highlight in the Highlights tab does the same; a highlight whose words are not on its page
// says so on its card and still goes to the page; with reduced motion the mark does not move and still goes; axe in Light and Dark.
// With HL_SHOTS=<folder> it also takes the owner's pictures. Written for READER on: `npm run integration -w apps/api -- --browser --run=reader-on --only="browser: highlights"`.
//   node e2e/highlights.mjs [baseUrl]
import { join } from "node:path";
import { makeHardPdf } from "@scholar/test-support/make-hard-pdf.mjs";
import { BASE, REFUSED_OR_BUSY, axeCheck, countFailure, desk, finish, launch, ok, sleep, startIdp, watchPage } from "./lib/browser.mjs";

const SHOTS = process.env.HL_SHOTS ?? null;
const shot = async (p, name, clip) => {
  if (SHOTS) await p.screenshot({ path: join(SHOTS, `${name}.png`), ...(clip ? { clip } : {}) });
};
const idp = await startIdp();
idp.setUser({ sub: "reader-highlights-1", email: "meera.k@example.edu", email_verified: true, name: "Meera K" });
const browser = await launch();
const errors = [];
const watch = (p) => watchPage(p, errors, { allowed: REFUSED_OR_BUSY });

/** In the page: selects from the start of the piece of text `from` to the end of the piece `to` on page 1 (both found by their text) and lifts the "mouse". Returns the selection's text. */
const selectBetween = (p, from, to) =>
  p.evaluate(
    async ([a, z]) => {
      const layer = document.querySelector('[data-page="1"] .textLayer');
      const find = (t) => [...layer.querySelectorAll("span")].find((x) => x.children.length === 0 && x.textContent === t);
      for (let i = 0; (!find(a) || !find(z)) && i < 100; i++) await new Promise((r) => setTimeout(r, 100));
      const s = find(a);
      const e = find(z);
      if (!s || !e) throw new Error(`no piece "${a}" or "${z}" on page 1`);
      s.scrollIntoView({ block: "center" });
      await new Promise((r) => setTimeout(r, 300));
      const r = document.createRange();
      r.setStart(s.firstChild, 0);
      r.setEnd(e.firstChild, e.firstChild.length);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      e.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      return sel.toString();
    },
    [from, to],
  );

/** The boxes drawn for saved highlights on page 1, and for a passage marked for a moment, in page pixels; with the box of the caption's text. */
const boxes = (p) =>
  p.evaluate(() => {
    const pg = document.querySelector('[data-page="1"]');
    const base = pg.getBoundingClientRect();
    const rel = (r) => ({ x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height });
    const spans = [...pg.querySelectorAll(".textLayer span")].filter((x) => x.children.length === 0);
    const first = spans.find((x) => x.textContent === "Figure 4:");
    const last = spans.find((x) => x.textContent === "> 0.");
    return {
      hl: [...pg.querySelectorAll(".pdfp-hl")].map((x) => rel(x.getBoundingClientRect())),
      flash: [...document.querySelectorAll(".pdfp-flash")].map((x) => ({ page: Number(x.closest("[data-page]")?.getAttribute("data-page")), ...rel(x.getBoundingClientRect()) })),
      caption: first && last ? { top: rel(first.getBoundingClientRect()).y, bottom: rel(last.getBoundingClientRect()).y + last.getBoundingClientRect().height } : null,
    };
  });

try {
  /* ================================================================ sign in, the paper */
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
  await p0.locator('input[type="file"]').setInputFiles({ name: "two_stage_training.pdf", mimeType: "application/pdf", buffer: makeHardPdf() });
  await p0.waitForFunction(() => document.querySelector(".dc")?.getAttribute("data-status") === "ready", null, { timeout: 60000 });
  const docId = (await (await p0.request.get(BASE + "/api/v1/documents")).json()).items.sort((a, b) => b.createdAt - a.createdAt)[0].id;
  const state = await c0.storageState();
  await c0.close();
  const api = (await browser.newContext({ storageState: state })).request;
  const notesOnServer = async () => (await (await api.get(`${BASE}/api/v1/documents/${docId}/notes`)).json()).items;

  const openReader = async ({ theme = "light", reduced = false } = {}) => {
    const ctx = await browser.newContext({ ...desk(1280, 860), storageState: state, colorScheme: "light", reducedMotion: reduced ? "reduce" : "no-preference" });
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
    await sleep(700);
    return { ctx, page };
  };
  /** A picture of the right column of page 1 (the caption), for the owner. */
  const captionClip = async (page) => {
    const b = await page.locator('[data-page="1"]').boundingBox();
    return { x: b.x + b.width * 0.5, y: b.y + b.height * 0.03, width: b.width * 0.5, height: b.height * 0.2 };
  };

  /* ================================================================ 1. the caption with math, highlighted: drawn over every line, and again after a reload */
  console.log("1. a caption with math, highlighted");
  {
    const { ctx, page } = await openReader();
    const text = await selectBetween(page, "Figure 4:", "> 0.");
    ok(/r\s*1/.test(text) && text.includes("ℓ"), `the selection holds the caption with its math (${JSON.stringify(text.slice(0, 60))}…)`);
    const pop = page.getByRole("toolbar", { name: "The selected text" });
    await pop.waitFor({ timeout: 6000 });
    await pop.getByRole("button", { name: "Highlight as Method" }).click();
    await page.waitForFunction(() => document.querySelectorAll('[data-page="1"] .pdfp-hl').length > 0, null, { timeout: 8000 }).catch(() => {});
    await sleep(500);
    const b = await boxes(page);
    const top = Math.min(...b.hl.map((r) => r.y));
    const bottom = Math.max(...b.hl.map((r) => r.y + r.h));
    ok(b.hl.length >= 7, `the highlight is drawn: ${b.hl.length} bars (one or more for each of the caption's 7 lines)`);
    ok(b.caption && b.hl.length > 0 && top <= b.caption.top + 3 && bottom >= b.caption.bottom - 3, `the bars cover the caption from its first line to its last (${top.toFixed(0)}..${bottom.toFixed(0)} against ${b.caption?.top.toFixed(0)}..${b.caption?.bottom.toFixed(0)})`);
    await shot(page, "caption-highlight-drawn", await captionClip(page));
    const saved = await notesOnServer();
    ok(saved.length === 1, `one highlight saved (${saved.length})`);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('[data-page="1"] .textLayer span').first().waitFor({ timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-page="1"] .pdfp-hl').length > 0, null, { timeout: 8000 }).catch(() => {});
    await sleep(400);
    const again = await boxes(page);
    ok(again.hl.length === b.hl.length && again.hl.length > 0, `a reload draws it again, the same bars (${again.hl.length})`);
    await shot(page, "caption-highlight-after-reload", await captionClip(page));
    await axeCheck(page, "the paper with the caption highlighted, Light", { inlineCites: true });
    await ctx.close();
  }

  /* ================================================================ 2. Ask: the citation goes to the passage and marks it for a moment */
  console.log("2. an Ask citation marks its passage for a moment");
  {
    const { ctx, page } = await openReader();
    const before = (await notesOnServer()).length;
    await page.locator('[data-page="2"]').scrollIntoViewIfNeeded();
    await sleep(500);
    await page.locator(".desk-fab").click();
    const drawer = page.getByRole("complementary", { name: "Agents" });
    await drawer.waitFor();
    await page.locator("#ask-input").fill("What gives a compact representation of each passage?");
    await page.keyboard.press("Enter");
    const card = drawer.locator(".desk-agent-view:not([hidden]) .ask-answer").last();
    await card.waitFor({ timeout: 20000 });
    const quote = (await card.locator(".ask-source").first().innerText().catch(() => "")).trim();
    ok(/representation/.test(quote), `the answer cites the sentence with the word hyphenated in the paper (${JSON.stringify(quote.slice(0, 80))})`);
    await card.locator(".cite-chip").first().click();
    await page.waitForFunction(() => document.querySelectorAll(".pdfp-flash").length > 0, null, { timeout: 6000 }).catch(() => {});
    const b = await boxes(page);
    ok(b.flash.length >= 2 && b.flash.every((r) => r.page === 1), `the passage on page 1 is marked: ${b.flash.length} bars over its two lines`);
    ok(b.hl.length > 0 && b.flash.every((f) => f.y + f.h < Math.min(...b.hl.map((r) => r.y)) || f.x + f.w < Math.min(...b.hl.map((r) => r.x))), "the mark is on the cited passage (left column), not on the saved highlight");
    const look = await page.evaluate(() => {
      const el = document.querySelector(".pdfp-flash");
      const cs = el && getComputedStyle(el);
      return cs ? { outline: cs.outlineStyle !== "none" || cs.boxShadow !== "none", hidden: el.closest("[aria-hidden]")?.getAttribute("aria-hidden") ?? null, anim: cs.animationName } : null;
    });
    ok(look && look.outline && look.hidden === "true" && look.anim !== "none", `it looks unlike a highlight: an outline, hidden from screen readers, fading (${JSON.stringify(look)})`);
    const pg = await page.locator('[data-page="1"]').boundingBox();
    await shot(page, "ask-citation-marked", { x: pg.x, y: pg.y, width: pg.width, height: pg.height * 0.22 });
    await sleep(1400);
    await shot(page, "ask-citation-fading", { x: pg.x, y: pg.y, width: pg.width, height: pg.height * 0.22 });
    await page.waitForFunction(() => document.querySelectorAll(".pdfp-flash").length === 0, null, { timeout: 5000 }).catch(() => {});
    ok((await boxes(page)).flash.length === 0, "the mark is gone a few seconds later");
    ok((await notesOnServer()).length === before, "and nothing was saved: it is not a highlight");
    await ctx.close();
  }

  /* ================================================================ 3. the quote of a highlight in the Highlights tab marks it for a moment too; one not on its page says so */
  console.log("3. Highlights tab: back to the passage; a highlight not found on its page");
  {
    const bad = await api.post(`${BASE}/api/v1/documents/${docId}/notes`, { headers: { Origin: BASE }, data: { page: 1, quote: "a sentence that is not anywhere on this page of the paper", color: "pink" } });
    ok(bad.status() === 201, `a highlight whose words are not on its page (made through the API, as an old paper's would be): ${bad.status()}`);
    const { ctx, page } = await openReader({ theme: "dark" });
    await page.getByRole("tab", { name: /^Highlights/ }).first().click();
    const cards = page.locator(".note");
    await cards.first().waitFor({ timeout: 10000 });
    await page.waitForFunction(() => [...document.querySelectorAll(".note")].some((n) => n.textContent.includes("Not found on the page")), null, { timeout: 8000 }).catch(() => {});
    const missing = page.locator(".note", { hasText: "a sentence that is not anywhere" });
    ok((await missing.locator(".note-missing").innerText().catch(() => "")).includes("Not found on the page"), "its card says it was not found on the page");
    ok((await page.locator(".note", { hasText: "Two-stage training" }).locator(".note-missing").count()) === 0, "the caption's card says nothing of the kind");
    await shot(page, "note-not-found-dark");
    await page.locator('[data-page="2"]').scrollIntoViewIfNeeded();
    await sleep(400);
    await page.locator(".note", { hasText: "Two-stage training" }).locator(".note-quote").click();
    await page.waitForFunction(() => document.querySelectorAll(".pdfp-flash").length > 0, null, { timeout: 6000 }).catch(() => {});
    ok((await boxes(page)).flash.length >= 7, "the quote of the caption's card marks the caption for a moment, over every line");
    await shot(page, "highlight-quote-marked-dark", await captionClip(page));
    await missing.locator(".note-quote").click();
    await page.locator(".pdfv-hint").waitFor({ timeout: 6000 }).catch(() => {});
    ok((await page.locator(".pdfv-hint").innerText().catch(() => "")).includes("not found on page 1"), "the one not found goes to its page, and a quiet line says the passage was not found there");
    await shot(page, "not-found-hint-dark");
    await axeCheck(page, "the Highlights tab with a highlight not found, Dark", { inlineCites: true });
    await ctx.close();
  }

  /* ================================================================ 4. reduced motion: the mark does not move, and still goes */
  console.log("4. reduced motion");
  {
    const { ctx, page } = await openReader({ reduced: true });
    await page.getByRole("tab", { name: /^Highlights/ }).first().click();
    await page.locator(".note", { hasText: "Two-stage training" }).locator(".note-quote").click();
    await page.waitForFunction(() => document.querySelectorAll(".pdfp-flash").length > 0, null, { timeout: 6000 }).catch(() => {});
    const anim = await page.evaluate(() => { const el = document.querySelector(".pdfp-flash"); return el ? getComputedStyle(el).animationName : "missing"; });
    ok(anim === "none", `with reduced motion the mark has no animation (${anim})`);
    await page.waitForFunction(() => document.querySelectorAll(".pdfp-flash").length === 0, null, { timeout: 7000 }).catch(() => {});
    ok((await page.locator(".pdfp-flash").count()) === 0, "and it is taken away after a few seconds");
    await ctx.close();
  }

  ok(errors.length === 0, `no page errors (${errors.slice(0, 3).join(" | ")})`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  countFailure();
}
await browser.close();
await idp.close?.();
finish("all highlight checks passed", (n) => `${n} check(s) FAILED`);
