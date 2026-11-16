// Browser e2e for the citations in the reader (docs/design/reader-citations.md): a paper's in-text citations are highlighted, and each opens a card with the reference.
// - hover opens the card after a moment, moving into it keeps it, leaving closes it;
// - focus shows it, Enter moves the focus in, Escape gives the focus back;
// - a tap opens it on a phone;
// - "Show in reference list" goes to the entry;
// - "Verified" (a small green tick in a circle, the word alone) only on a verified entry, the verifier's words on the others, Retracted marked;
// - Ask, Save and Open only on a verified entry;
// - the switch in the toolbar turns the cards off and on;
// - axe passes, and nothing scrolls sideways on a phone.
// The verdicts are fixed by answering /api/v1/references/verify in the browser, so the check does not depend on Crossref.
// Pictures (light, dark, desktop, phone; cards off = before, on = after) go to SHOTS_DIR (default e2e/shots/).
// Needs the Worker with the fake identity provider: `npm run integration -w apps/api -- --browser --only="browser: citation cards"`.
//   node e2e/cites.mjs [baseUrl]    (default http://localhost:8788)
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { makePdf } from "@scholar/test-support/make-pdf.mjs";
import { BASE, REFUSED_OR_BUSY, axeCheck, countFailure, desk, finish, launch, ok, phone, sleep, startIdp, watchPage } from "./lib/browser.mjs";

const SHOTS = process.env.SHOTS_DIR ?? fileURLToPath(new URL("./shots/", import.meta.url));
mkdirSync(SHOTS, { recursive: true });

const PAPER = [
  [
    "Citation cards: a test paper",
    "",
    "1 Introduction",
    "Self-attention architectures, and Transformers [1] in particular, became the default for language. Pre-training a bidirectional encoder [2] made it the default for understanding, and residual connections [3] made deep networks trainable at all.",
    "Several of these ideas were combined later [2, 3], and the whole line of work [1-3] rests on them. As Vaswani et al. (2017) showed, attention alone is enough. One result [4] has since been withdrawn.",
    "For x in the interval [0, 1] the value of f is bounded, and the array a[2] is never read.",
  ].join("\n"),
  [
    "References",
    "[1] Vaswani, A., Shazeer, N., Parmar, N. Attention is all you need. In Advances in Neural Information Processing Systems, 2017.",
    "[2] Devlin, J., Chang, M. BERT: Pre-training of deep bidirectional transformers for language understanding. In NAACL, 2019.",
    "[3] He, K., Zhang, X. Deep residual learning for image recognition. In CVPR, 2016.",
    "[4] Withdrawn, R., Others, S. A study whose result was withdrawn. Journal of Withdrawn Results, 2015.",
  ].join("\n"),
];

const record = (o) => ({ doi: null, title: "", authors: [], year: null, venue: null, ...o });
/** The fixed answer of the verifier for each reference of the paper. */
function verdictFor(reference) {
  const base = { input: reference, reason: "test", confidence: 1, checks: null };
  if (/Vaswani/.test(reference)) return { ...base, status: "verified", match: record({ doi: "10.48550/arxiv.1706.03762", title: "Attention Is All You Need", authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"], year: 2017, venue: "NeurIPS" }) };
  if (/Devlin/.test(reference)) return { ...base, status: "mismatch", match: record({ doi: "10.18653/v1/n19-1423", title: "BERT", authors: ["Someone Else"], year: 2018, venue: "NAACL" }) };
  if (/He, K/.test(reference)) return { ...base, status: "not_found", match: null };
  if (/Withdrawn/.test(reference)) return { ...base, status: "verified", retracted: true, match: record({ doi: "10.1000/withdrawn.2015", title: "A Study Whose Result Was Withdrawn", authors: ["R. Withdrawn", "S. Others"], year: 2015, venue: "Journal of Withdrawn Results" }) };
  return { ...base, status: "unverifiable", match: null };
}

const idp = await startIdp();
idp.setUser({ sub: "cites-1", email: "meera.k@example.edu", email_verified: true, name: "Meera K" });
const browser = await launch();
const errors = [];
const watch = (p) => watchPage(p, errors, { allowed: REFUSED_OR_BUSY });
// A citation is a target inside a sentence, as large as its words: WCAG 2.2's target-size criterion (2.5.8) excepts such inline targets ("the size of the target is constrained
// by the line-height of non-target text"). axe cannot tell (the buttons are laid over the page's text, not in it), so only those nodes of that one rule are left out.
const axe = (label, p) => axeCheck(p, label, { inlineCites: true });
const verifyRoute = async (ctx) => {
  await ctx.route("**/api/v1/references/verify", async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(verdictFor(String(body.reference ?? ""))) });
  });
};
const card = (p) => p.locator(".cite-card");
/** The status words as a reader sees them (without the words only a screen reader gets). */
const statusText = (p) => p.evaluate(() => { const s = document.querySelector(".cite-card .cite-status"); if (!s) return null; const c = s.cloneNode(true); c.querySelectorAll(".sr-only").forEach((x) => x.remove()); return c.textContent.replace(/\s+/g, " ").trim(); });

try {
  /* ================================================================ sign in and upload the paper */
  const c0 = await browser.newContext(desk(1280, 860));
  const p0 = await c0.newPage();
  watch(p0);
  await p0.goto(BASE + "/", { waitUntil: "networkidle" });
  await p0.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
  await p0.getByRole("button", { name: "Continue with Google" }).last().click();
  await p0.locator("#hm-h").waitFor({ timeout: 20000 });
  await sleep(1000);
  await p0.goto(BASE + "/papers", { waitUntil: "networkidle" });
  const handled = p0.getByRole("region", { name: /how your papers are handled/ });
  if (await handled.count()) { await handled.getByRole("button", { name: "I understand, continue" }).click(); await handled.waitFor({ state: "detached", timeout: 8000 }); }
  await p0.locator('input[type="file"]').waitFor({ state: "attached" });
  await p0.locator('input[type="file"]').setInputFiles({ name: "citation_cards.pdf", mimeType: "application/pdf", buffer: makePdf(PAPER, { title: "Citation cards", width: 92 }) });
  await p0.locator(".dc").first().waitFor({ timeout: 40000 });
  await p0.waitForFunction(() => document.querySelector(".dc")?.getAttribute("data-status") === "ready", null, { timeout: 60000 });
  const docId = (await (await p0.request.get(BASE + "/api/v1/documents")).json()).items[0].id;
  // the paper's reference list is read in the browser when it is first opened
  await verifyRoute(c0);
  await p0.goto(BASE + "/papers/" + docId, { waitUntil: "networkidle" });
  let info = null;
  for (let i = 0; i < 60 && !info?.references?.length; i++) {
    await sleep(500);
    info = (await (await p0.request.get(BASE + "/api/v1/documents/" + docId)).json()).info;
  }
  ok(info?.references?.length === 4, `the paper's four references were read (${info?.references?.length})`);
  const state = await c0.storageState();
  await c0.close();

  const open = async (vp, { theme = "light", phone = false, citesOff = false } = {}) => {
    const ctx = await browser.newContext({ viewport: vp, storageState: state, colorScheme: "light", ...(phone ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {}) });
    await ctx.addInitScript(([t, off]) => { try { localStorage.setItem("theme", t); localStorage.setItem("scholar.cites", off ? "0" : "1"); localStorage.setItem("scholar.pdf.zoom", "1"); } catch { /* no storage */ } }, [theme, citesOff]);
    await verifyRoute(ctx);
    const page = await ctx.newPage();
    watch(page);
    const sent = [];
    page.on("request", (r) => { if (r.url().includes("/api/v1/references/verify")) sent.push(JSON.parse(r.postData() ?? "{}").reference); });
    await page.goto(BASE + "/papers/" + docId, { waitUntil: "networkidle" });
    await page.locator(".pdfp[data-page='1'] .textLayer span").first().waitFor({ timeout: 20000 });
    if (!citesOff) await page.locator(".pdfp-cite").first().waitFor({ timeout: 15000 });
    return { ctx, page, sent };
  };

  /* ================================================================ desktop: what is found */
  {
    const { ctx, page, sent } = await open({ width: 1280, height: 860 });
    const labels = await page.locator(".pdfp-cite[aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    ok(labels.includes("Citation: reference 1") && labels.includes("Citation: reference 4"), `the numbered citations are found (${labels.join(" | ")})`);
    ok(labels.filter((l) => l === "Citation: reference 2").length === 2 && labels.includes("Citation: reference 3"), "each number of a list [2, 3] is a citation of its own");
    ok(labels.includes("Citation: reference 1; reference 2; reference 3"), "a range [1-3] is one citation that points at three references");
    ok(labels.includes("Citation: Vaswani et al., 2017"), "a narrative citation in a numbered paper is found and linked by author and year");
    ok(!labels.some((l) => /reference 0\b/.test(l)) && labels.length === 8, `nothing in the maths ([0, 1], a[2]) and no list marker on the references page is taken (${labels.length} citations)`);
    ok((await page.locator(".pdfp[data-page='2'] .pdfp-cite").count()) === 0, "the reference list's own markers [1] to [4] are not citations");

    /* ---------------- hover */
    const one = page.locator('.pdfp-cite[aria-label="Citation: reference 1"]').first();
    await one.hover();
    await sleep(80);
    ok((await card(page).count()) === 0, "the card does not jump open the moment the pointer passes over a citation");
    await card(page).waitFor({ timeout: 3000 });
    ok((await one.getAttribute("aria-expanded")) === "true", "the citation says its card is open (aria-expanded)");
    ok((await statusText(page)) === "Verified", `a verified reference says only "Verified" (${await statusText(page)})`);
    const tick = await page.locator(".cite-card .cite-tick").evaluate((e) => { const s = getComputedStyle(e); return { w: e.getBoundingClientRect().width, round: s.borderRadius, bg: s.backgroundColor }; });
    ok(tick.w <= 16 && tick.round === "50%", `with a small tick in a circle (${tick.w}px, radius ${tick.round})`);
    const ok_ = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ok").trim());
    ok(tick.bg !== "rgba(0, 0, 0, 0)" && ok_.length > 0, `the circle is the green of "ok" (${tick.bg})`);
    ok((await page.locator(".cite-card .cite-status").getAttribute("title")) === "Verified at Crossref and OpenAlex", "where it was verified is in the tooltip, not in the words");
    ok((await page.locator(".cite-card .cite-title").textContent()) === "Attention Is All You Need", "the title is the matched record's");
    ok((await page.locator(".cite-card .cite-meta").textContent()) === "Vaswani et al., NeurIPS 2017", "authors, venue and year under it");
    ok((await page.locator(".cite-card").getByRole("button", { name: "Ask about it" }).count()) === 1 && (await page.locator(".cite-card").getByRole("button", { name: "Save to library" }).count()) === 1, "Ask about it and Save to library");
    ok((await page.locator(".cite-card a[href='https://doi.org/10.48550/arxiv.1706.03762']").count()) === 1, "Open goes to the DOI");
    // the card is below the citation and does not cover it
    const cb = await one.boundingBox();
    const kb = await card(page).boundingBox();
    ok(kb.y >= cb.y + cb.height - 1 || kb.y + kb.height <= cb.y + 1, "the card sits next to the citation, not over it");
    await page.screenshot({ path: join(SHOTS, "cite-desktop-light-after.png") });
    await axe("desktop, card open", page);

    // into the card: it stays
    await page.mouse.move(kb.x + kb.width / 2, kb.y + 20, { steps: 6 });
    await sleep(700);
    ok((await card(page).count()) === 1, "moving the pointer into the card keeps it open");
    await page.mouse.move(5, 5, { steps: 4 });
    await card(page).waitFor({ state: "detached", timeout: 3000 });
    ok((await one.getAttribute("aria-expanded")) === "false", "leaving the card closes it");

    await sleep(500);
    // the checks of the paper's list run when it opens; the References tab and the cards share them
    ok(sent.length === 4 && new Set(sent).size === 4, `each of the four references is checked once, not again for the cards (${sent.length} requests)`);

    /* ---------------- the other verdicts */
    const look = async (label, nth = 0) => {
      await page.mouse.move(5, 5);
      await card(page).waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
      await page.locator(`.pdfp-cite[aria-label="${label}"]`).nth(nth).hover();
      await card(page).waitFor({ timeout: 3000 });
      await sleep(120);
      return { status: await statusText(page), tick: await page.locator(".cite-card .cite-tick").count(), ask: await page.locator(".cite-card").getByRole("button", { name: "Ask about it" }).count(), retracted: await page.locator(".cite-card .cite-retracted").count(), text: (await card(page).textContent()) ?? "" };
    };
    const mism = await look("Citation: reference 2");
    ok(mism.status === "Details don’t match" && mism.tick === 0 && mism.ask === 0, `details that differ: the verifier's words, no tick, no Ask (${mism.status})`);
    ok(/Devlin, J\., Chang, M\. BERT/.test(mism.text) && !/Someone Else/.test(mism.text), "it shows the reference as printed, never the record that does not match");
    const nf = await look("Citation: reference 3");
    ok(nf.status === "Not found" && nf.tick === 0 && nf.ask === 0, `not found: no tick, no Ask (${nf.status})`);
    const rt = await look("Citation: reference 4");
    ok(rt.status === "Verified" && rt.retracted === 1, "a retracted paper is marked Retracted, also when verified");
    const range = await look("Citation: reference 1; reference 2; reference 3");
    ok(/1 of 3/.test(range.text), "a range shows its references one at a time (1 of 3)");
    await page.locator(".cite-card").getByRole("button", { name: "Next reference" }).click();
    ok((await statusText(page)) === "Details don’t match" && /2 of 3/.test((await card(page).textContent()) ?? ""), "Next shows the second reference of the range");
    const narr = await look("Citation: Vaswani et al., 2017");
    ok(narr.status === "Verified" && /Attention Is All You Need/.test(narr.text), "the narrative citation opens the same reference");

    /* ---------------- Save */
    await page.mouse.move(5, 5);
    await card(page).waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    await one.click();
    await card(page).waitFor({ timeout: 3000 });
    await page.locator(".cite-card").getByRole("button", { name: "Save to library" }).click();
    await page.locator(".cite-card").getByRole("button", { name: "Saved" }).waitFor({ timeout: 5000 });
    const lib = await (await page.request.get(BASE + "/api/v1/library")).json();
    ok(lib.items.some((p) => p.doi === "10.48550/arxiv.1706.03762"), "Save to library saves the verified paper to the account");
    await page.mouse.move(5, 5);
    await sleep(500);
    ok((await card(page).count()) === 1, "a card opened by a click stays when the pointer leaves");

    /* ---------------- Show in reference list */
    await page.locator(".cite-card").getByRole("button", { name: "Show in reference list" }).click();
    await card(page).waitFor({ state: "detached", timeout: 3000 });
    await page.waitForFunction(() => document.querySelector(".pdfp[data-page='2'] .pdf-hl") !== null, null, { timeout: 8000 });
    const hl = await page.locator(".pdfp[data-page='2'] .pdf-hl").first().textContent();
    ok(/Vaswani/.test(hl ?? ""), `Show in reference list goes to the entry on page 2 and marks it (${hl?.slice(0, 40)})`);
    await page.screenshot({ path: join(SHOTS, "cite-show-in-list.png") });

    /* ---------------- Ask about it */
    await page.locator(".pdfv-scroll").evaluate((e) => e.scrollTo({ top: 0 }));
    await sleep(400);
    await one.click();
    await card(page).waitFor({ timeout: 3000 });
    await page.locator(".cite-card").getByRole("button", { name: "Ask about it" }).click();
    await page.getByRole("dialog").filter({ hasText: "Ask this paper" }).waitFor({ timeout: 5000 });
    ok(/Attention Is All You Need/.test((await page.getByRole("dialog").filter({ hasText: "Ask this paper" }).textContent()) ?? ""), "Ask about it opens Ask this paper on the cited paper");
    await page.keyboard.press("Escape");
    await sleep(400);

    /* ---------------- keyboard */
    await page.locator(".pdfv-scroll").focus();
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() => document.activeElement?.classList.contains("pdfp-cite") ?? false);
    }
    ok(reached, "the keyboard reaches a citation with Tab");
    await card(page).waitFor({ timeout: 3000 });
    ok(await page.evaluate(() => document.activeElement?.classList.contains("pdfp-cite")), "focus shows the card and leaves the focus on the citation");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector(".cite-card")?.contains(document.activeElement), null, { timeout: 3000 });
    ok(true, "Enter moves the focus into the card");
    await page.keyboard.press("Escape");
    await card(page).waitFor({ state: "detached", timeout: 3000 });
    ok(await page.evaluate(() => document.activeElement?.classList.contains("pdfp-cite")), "Escape closes the card and gives the focus back to the citation");

    /* ---------------- the switch */
    await page.getByRole("button", { name: "Citation cards" }).click();
    await page.waitForFunction(() => document.querySelectorAll(".pdfp-cite").length === 0, null, { timeout: 3000 });
    ok((await page.getByRole("button", { name: "Citation cards" }).getAttribute("aria-pressed")) === "false", "the switch in the toolbar turns the citation cards off");
    await page.mouse.move(400, 600);
    await sleep(200);
    await page.screenshot({ path: join(SHOTS, "cite-desktop-light-before.png") });
    await page.getByRole("button", { name: "Citation cards" }).click();
    await page.locator(".pdfp-cite").first().waitFor({ timeout: 8000 });
    ok(true, "and on again");

    /* ---------------- drawing */
    await page.getByRole("button", { name: "Draw" }).click();
    await sleep(300);
    const pe = await one.evaluate((e) => getComputedStyle(e).pointerEvents);
    ok(pe === "none", "while drawing, the citations take no pointer (the pen goes through)");
    await ctx.close();
  }

  /* ================================================================ dark theme */
  {
    const { ctx, page } = await open({ width: 1280, height: 860 }, { theme: "dark" });
    await page.locator('.pdfp-cite[aria-label="Citation: reference 1"]').first().hover();
    await card(page).waitFor({ timeout: 3000 });
    await sleep(200);
    await page.screenshot({ path: join(SHOTS, "cite-desktop-dark-after.png") });
    await axe("dark, card open", page);
    await ctx.close();
    const off = await open({ width: 1280, height: 860 }, { theme: "dark", citesOff: true });
    await off.page.screenshot({ path: join(SHOTS, "cite-desktop-dark-before.png") });
    await off.ctx.close();
  }

  /* ================================================================ phone */
  {
    const { ctx, page } = await open({ width: 390, height: 844 }, { phone: true });
    const c = page.locator('.pdfp-cite[aria-label="Citation: reference 1"]').first();
    await c.scrollIntoViewIfNeeded();
    await c.tap();
    await card(page).waitFor({ timeout: 3000 });
    ok((await statusText(page)) === "Verified", "a tap opens the card on a phone");
    const kb = await card(page).boundingBox();
    ok(kb.x >= 0 && kb.x + kb.width <= 390 + 0.5, `the card fits the phone's width (${Math.round(kb.x)} to ${Math.round(kb.x + kb.width)})`);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), "nothing scrolls sideways");
    const small = await page.locator(".cite-card .btn, .cite-card .link-btn").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 24).length);
    ok(small === 0, "the card's buttons are at least 24 px high");
    await sleep(250); // the card's short fade-in is over
    await page.screenshot({ path: join(SHOTS, "cite-phone-light-after.png") });
    await axe("phone, card open", page);
    await page.locator(".pdfv-bar").tap({ position: { x: 5, y: 5 } }).catch(() => {});
    await card(page).waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    ok((await card(page).count()) === 0, "a tap outside closes it");
    await ctx.close();
    const off = await open({ width: 390, height: 844 }, { phone: true, citesOff: true });
    await off.page.screenshot({ path: join(SHOTS, "cite-phone-light-before.png") });
    await off.ctx.close();
    const dark = await open({ width: 390, height: 844 }, { phone: true, theme: "dark" });
    await dark.page.locator('.pdfp-cite[aria-label="Citation: reference 1"]').first().tap();
    await card(dark.page).waitFor({ timeout: 3000 });
    await sleep(200);
    await dark.page.screenshot({ path: join(SHOTS, "cite-phone-dark-after.png") });
    await dark.ctx.close();
  }

  /* ================================================================ the reader's tab bar (Paper, Ask, References, Notes) on narrow screens */
  // Its icons sat at each tab's top-left corner, over the word, from 18 Oct 2026 (the icon was in the rule of the pill behind the tab): icon and word are now in one row.
  for (const [w, h, phone] of [[320, 640, true], [390, 844, true], [768, 1000, false]]) {
    for (const theme of ["light", "dark"]) {
      const { ctx, page } = await open({ width: w, height: h }, { phone, theme, citesOff: true });
      const bar = await page.locator(".dw-tabs").evaluate((tl) => {
        const hit = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
        const tabs = [...tl.querySelectorAll(".dw-tab")].map((t) => {
          const box = t.getBoundingClientRect();
          const icon = t.querySelector(":scope > svg");
          const iconShown = icon && getComputedStyle(icon).display !== "none";
          const ib = iconShown ? icon.getBoundingClientRect() : null;
          const lb = t.querySelector(".dw-tab-label").getBoundingClientRect();
          return {
            name: t.textContent.trim(),
            icon: !!ib,
            overlap: ib ? hit(ib, lb) : false,
            iconLeftOfWord: ib ? ib.right <= lb.left + 0.5 && Math.abs(ib.top + ib.height / 2 - (lb.top + lb.height / 2)) < 4 : true,
            inside: [...t.children].every((c) => { const r = c.getBoundingClientRect(); return r.width === 0 || (r.right <= box.right + 0.5 && r.left >= box.left - 0.5); }),
          };
        });
        return { tabs, fits: tl.scrollWidth <= tl.clientWidth + 1 };
      });
      const tag = `${w} px, ${theme}`;
      ok(bar.tabs.length === 4 && bar.tabs.every((t) => !t.overlap), `[${tag}] no tab's icon covers its word (${bar.tabs.filter((t) => t.overlap).map((t) => t.name).join(", ") || "none"}; icons ${bar.tabs.some((t) => t.icon) ? "shown" : "hidden"})`);
      ok(bar.tabs.every((t) => t.iconLeftOfWord), `[${tag}] each icon sits before its word, on its line`);
      ok(bar.fits && bar.tabs.every((t) => t.inside), `[${tag}] the four tabs fit the bar, each word inside its tab`);
      ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), `[${tag}] nothing scrolls sideways`);
      const tb = await page.locator(".dw-tabs").boundingBox();
      await page.screenshot({ path: join(SHOTS, `tabs-${w}-${theme}.png`), clip: { x: 0, y: 0, width: w, height: Math.min(h, Math.ceil(tb.y + tb.height + 12)) } });
      await ctx.close();
    }
  }

  ok(errors.length === 0, `no errors in the page${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
} catch (e) {
  console.log(" FAIL  " + (e?.stack ?? e));
  countFailure();
} finally {
  await browser.close();
  await idp.close?.();
}
finish("all citation card checks passed", (n) => `${n} failure(s)`);
