// Browser e2e: paper preview sheet, PDF upload, reader, grounded Q&A with highlighted sources, rename, delete.
// Needs the Worker with the fake identity provider AND the offline model stand-in (QA_STUB=1):
// `npm run integration -w apps/api -- --browser` starts it. Search results are mocked so the preview checks are deterministic.
//   node e2e/papers.mjs [baseUrl]    (default http://localhost:8788)
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startFakeIdp } from "../../api/scripts/fake-idp.mjs";
import { SAMPLE_PAPER, makePdf, makePdfLines } from "../../api/scripts/lib/make-pdf.mjs";

const require = createRequire(import.meta.url);
// Injected with evaluate(), which CSP does not apply to, so the policy under test stays strict.
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.argv[2] ?? "http://localhost:8788";
const OUT = fileURLToPath(new URL("./shots/", import.meta.url));
mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "papers-ui-1", email: "kavya@example.edu", email_verified: true, name: "Kavya Menon" });

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401)/.test(m.text())) errors.push("console: " + m.text()); });

async function axe(label, p = page) {
  await p.evaluate(axeSource);
  const res = await p.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(" "), msg: v.nodes[0]?.failureSummary?.split("\n")[1] }));
  });
  ok(res.length === 0, `axe [${label}]: ${res.length ? "" : "no violations"}`);
  for (const v of res) console.log(`        ${v.impact} ${v.id} x${v.nodes} ${v.sample} :: ${v.msg}`);
}
const shot = (name, p = page) => p.screenshot({ path: OUT + name + ".png" });
const setTheme = async (label) => { await page.getByRole("button", { name: `${label} theme` }).click(); await page.waitForTimeout(500); };
const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await page.waitForTimeout(150); } return false; };

const papers = [1, 2, 3].map((n) => ({
  id: `doi:10.1000/prev.${n}`, doi: `10.1000/prev.${n}`, pmid: n === 2 ? "123456" : null, title: `Preview test paper number ${n}: effects on outcomes`,
  authors: Array.from({ length: n === 1 ? 9 : 2 }, (_, i) => `Author ${String.fromCharCode(65 + i)}. Name`), year: 2020 + n, venue: "Journal of Previews",
  abstract: n === 3 ? null : `This is the abstract of paper ${n}. It describes what was done and what was found in enough words to read comfortably.`,
  citationCount: 1200 + n, oaUrl: n === 1 ? "https://example.org/open.pdf" : null, retracted: n === 2, retractionSources: n === 2 ? ["crossref-retraction-watch"] : [],
  sources: ["openalex", "s2"], score: 0.05, doiStatus: "verified",
}));

try {
  /* ---------- paper preview (search results, library, verifier) ---------- */
  console.log("paper preview");
  const done = { query: "x", results: papers, providers: { openalex: { ok: true, count: 3, ms: 10, cached: false } }, retractionCheck: { ok: true, count: 1, ms: 5, cached: false }, doiCheck: { ok: true, count: 0, ms: 5, cached: false }, tookMs: 20 };
  await page.route("**/api/v1/search/stream*", (route) =>
    route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "cache-control": "no-store" }, body: `event: done\ndata: ${JSON.stringify(done)}\n\n` }));
  await page.goto(BASE + "?q=previews", { waitUntil: "networkidle" });
  await page.locator(".result").first().waitFor();
  await page.locator(".result").first().getByRole("button", { name: /^Preview:/ }).click();
  const sheet = page.getByRole("dialog");
  await sheet.waitFor();
  await page.waitForTimeout(700);
  ok(/Preview test paper number 1/.test(await sheet.locator(".pv-title").innerText()), "the preview opens on the paper that was clicked");
  ok((await sheet.locator(".pv-pos").innerText()).trim() === "1 of 3", "it shows the position in the result list");
  ok(await sheet.getByText("This is the abstract of paper 1.").isVisible(), "the full abstract is shown");
  ok(await sheet.getByRole("button", { name: /\+3 more/ }).isVisible(), "a long author list is collapsed");
  await sheet.getByRole("button", { name: /\+3 more/ }).click();
  ok(await sheet.getByText("Author I. Name").isVisible(), "...and can be expanded");
  await shot("50-preview-light");
  await axe("preview, light");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(600);
  ok(/number 2/.test(await sheet.locator(".pv-title").innerText()), "the right arrow key moves to the next paper");
  ok(await sheet.getByText("Retracted paper.").isVisible(), "a retracted paper shows the warning in the preview");
  ok(await sheet.getByRole("link", { name: "123456" }).isVisible(), "the PubMed id links out");
  await shot("51-preview-retracted");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(600);
  ok(await sheet.getByText(/None of our sources has an abstract/).isVisible(), "a missing abstract is explained, not left blank");
  await page.getByRole("button", { name: "Next paper" }).waitFor();
  ok(await page.getByRole("button", { name: "Next paper" }).isDisabled(), "the next button is disabled on the last paper");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(500);
  await sheet.getByRole("button", { name: "Save" }).click();
  ok(await sheet.getByRole("button", { name: "Saved" }).isVisible(), "Save works from inside the preview");
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });
  ok(true, "Escape closes the preview");
  await page.locator(".ws-rail").getByRole("link", { name: /^Library/ }).click();
  await page.waitForTimeout(500);
  await page.locator(".drawer-item-open", { hasText: "Preview test paper number 2" }).click();
  await page.getByRole("dialog").locator(".pv-title").waitFor();
  ok(/number 2/.test(await page.getByRole("dialog").locator(".pv-title").innerText()), "a saved paper opens in the preview from the library");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  /* ---------- signed out: the papers page asks to sign in ---------- */
  console.log("my papers, signed out");
  await page.unroute("**/api/v1/search/stream*");
  await page.goto(BASE + "/papers", { waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 2, name: "Sign in to upload papers" }).waitFor();
  ok(await page.getByRole("button", { name: "Continue with Google" }).isVisible(), "signed-out visitors see a sign-in prompt, not a broken page");
  await page.waitForTimeout(1500);
  await shot("52-papers-signed-out");
  await axe("papers, signed out");

  /* ---------- sign in and upload ---------- */
  console.log("upload");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.locator("button[aria-label^=\"Account:\"], .ws-who").first().waitFor({ timeout: 15000 });
  ok(new URL(page.url()).pathname === "/papers", "sign-in returns to the papers page");
  await page.getByRole("button", { name: /Upload PDF papers/ }).waitFor();
  const note = page.getByRole("region", { name: /how your papers are handled/ });
  await note.waitFor();
  ok(await page.getByRole("button", { name: /Upload PDF papers/ }).isDisabled(), "before the privacy note is read, the upload is switched off");
  await page.waitForTimeout(700);
  await shot("55-papers-privacy-note");
  await axe("papers, privacy note");
  await note.getByRole("button", { name: "I understand, continue" }).click();
  await note.waitFor({ state: "detached", timeout: 8000 });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Upload PDF papers/.test(b.getAttribute("aria-label") ?? b.textContent ?? "") && !b.disabled), null, { timeout: 8000 });
  ok(true, "after agreeing, the note goes away and the upload works");
  await page.waitForTimeout(1200);
  await shot("53-papers-empty");
  await axe("papers, empty");
  await setTheme("Dark"); await shot("54-papers-empty-dark"); await axe("papers, empty, dark"); await setTheme("Light");

  const input = page.locator('input[type="file"]');
  await input.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not a pdf") });
  await page.locator(".job").first().waitFor();
  await page.locator('.job[data-state="error"]').waitFor();
  ok(/PDF/i.test(await page.locator(".job-detail").first().innerText()), "a non-PDF is refused with a plain message");
  await page.getByRole("button", { name: /^Dismiss notes\.txt/ }).click();
  await page.locator(".job").first().waitFor({ state: "detached" });

  const pdf = makePdf(SAMPLE_PAPER, { title: "Glaucoma screening" });
  await input.setInputFiles({ name: "glaucoma_screening.pdf", mimeType: "application/pdf", buffer: pdf });
  await page.locator(".job").first().waitFor();
  await page.waitForTimeout(450);
  await shot("55-upload-running");
  await page.locator('.job[data-state="done"], .job[data-state="error"]').first().waitFor({ timeout: 40000 });
  ok((await page.locator('.job[data-state="error"]').count()) === 0, "the upload finishes without an error");
  await page.locator(".dc").first().waitFor({ timeout: 15000 });
  await page.locator(".job").first().waitFor({ state: "detached", timeout: 10000 }); // the finished row slides away before we measure
  await page.waitForTimeout(500);
  const card = page.locator(".dc").first();
  ok((await card.locator(".dc-title").innerText()) === "glaucoma screening", "the paper appears with a title taken from the file name");
  ok(await until(async () => card.locator(".dc-cover img[data-loaded=true]").count().then((n) => n === 1)), "its first page is shown as the cover");
  ok(/3 pages/.test(await card.locator(".dc-meta").innerText()), "the page count is shown");
  await shot("56-papers-list");
  await axe("papers, list");
  await setTheme("Dark"); await shot("57-papers-list-dark"); await axe("papers, list, dark"); await setTheme("Light");

  /* ---------- reader + questions ---------- */
  console.log("reader and questions");
  await card.locator(".dc-open").click();
  await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  ok(/^\/papers\/[a-f0-9]+$/.test(new URL(page.url()).pathname), "the paper has its own address");
  ok((await page.locator(".pdfp").count()) === 3, "all 3 pages are laid out");
  await page.locator(".textLayer span").first().waitFor({ timeout: 15000 });
  ok(true, "the text layer is there (text can be selected and highlighted)");
  await page.locator(".thumb canvas[data-ready=true]").first().waitFor({ timeout: 15000 });
  ok((await page.locator(".thumb").count()) === 3, "page thumbnails are listed");
  await page.waitForTimeout(800);
  await shot("58-workspace-light");
  await axe("workspace");

  await page.getByRole("button", { name: "What research question does it ask?" }).click();
  await page.locator(".ask-answer").first().waitFor({ timeout: 30000 }).catch(async (e) => { console.log("ASK PANEL:", (await page.locator(".ask").innerText()).slice(0, 600)); throw e; });
  ok(/Every source checked/.test(await page.locator(".ask-status").first().innerText()), "the answer says its sources were checked");
  const chip = page.locator(".cite-chip").first();
  ok(/p\.\d/.test(await chip.innerText()), `the answer carries a clickable page reference (${await chip.innerText()})`);
  await page.waitForTimeout(700);
  await shot("59-answer");
  await chip.click();
  await page.locator(".pdf-hl").first().waitFor({ timeout: 15000 });
  const lit = await page.locator(".pdf-hl").evaluateAll((els) => els.map((e) => e.textContent).join(" "));
  ok(/glaucoma|retinal|convolutional/i.test(lit), `clicking it highlights the passage in the PDF ("${lit.slice(0, 60)}…")`);
  await page.locator("#ask-input").fill("How were participants recruited?");
  await page.locator("#ask-input").press("Enter");
  await page.locator(".ask-answer").nth(1).waitFor({ timeout: 30000 });
  await page.locator(".cite-chip").nth(1).click();
  await page.locator(".pdf-hl").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  const lit2 = await page.locator(".pdf-hl").evaluateAll((els) => els.map((e) => e.textContent).join(" | "));
  ok(/Participants|Pune|hospitals/.test(lit2) && !/glaucoma|convolutional/i.test(lit2), `a second answer highlights its own passage and clears the first ("${lit2.slice(0, 70)}")`);
  ok(await until(async () => (await page.locator("#pdfv-page").inputValue()) === "2"), "and scrolls to page 2");
  await shot("60-highlight");
  await axe("workspace with answer and highlight");
  await setTheme("Dark"); await shot("61-workspace-dark"); await axe("workspace, dark"); await setTheme("Read"); await shot("62-workspace-read"); await setTheme("Light");

  console.log("find in the paper");
  await page.getByRole("button", { name: "Find in this paper" }).click();
  const findBox = page.getByRole("searchbox", { name: "Find in this paper" });
  await findBox.waitFor();
  await findBox.fill("Pune");
  await page.getByRole("status").filter({ hasText: /^1 of 1 · page 2$/ }).waitFor({ timeout: 10000 });
  ok(true, "searching for a word that is on one page says where: '1 of 1 · page 2'");
  await page.waitForFunction(() => document.querySelectorAll(".textLayer .pdf-hl-now").length > 0, null, { timeout: 8000 });
  ok(true, "the match is highlighted on the page, and marked as the current one");
  await shot("66a-find-in-paper");
  await axe("find in paper");
  await findBox.fill("glaucoma");
  await page.getByRole("status").filter({ hasText: /^1 of \d+ · page 1$/ }).waitFor({ timeout: 10000 });
  const total = Number((await page.locator(".pdfv-find-count").innerText()).match(/of (\d+)/)[1]);
  ok(total >= 2, `a word used several times is counted (${total} matches)`);
  await findBox.press("Enter");
  await page.getByRole("status").filter({ hasText: new RegExp(`^2 of ${total}`) }).waitFor();
  ok(true, "Enter goes to the next match");
  await findBox.press("Shift+Enter");
  await page.getByRole("status").filter({ hasText: new RegExp(`^1 of ${total}`) }).waitFor();
  ok(true, "Shift+Enter goes back");
  await findBox.fill("zzzzqqq");
  await page.getByRole("status").filter({ hasText: "No matches" }).waitFor({ timeout: 10000 });
  ok(true, "a word that is not in the paper says so");
  await findBox.press("Escape");
  await findBox.waitFor({ state: "detached" });
  ok((await page.locator(".textLayer .pdf-hl").count()) === 0, "closing the search clears the highlights");
  await page.locator(".pdfv-scroll").focus();
  await page.keyboard.press("Control+f");
  await page.getByRole("searchbox", { name: "Find in this paper" }).waitFor();
  ok(true, "Ctrl+F inside the paper opens the search instead of the browser's");
  await page.getByRole("button", { name: "Close search" }).click();

  console.log("highlights and notes");
  const pick = (idx) => page.evaluate(async (i) => {
    const layer = document.querySelector('[data-page="1"] .textLayer');
    const sp = [...layer.querySelectorAll("span")].filter((x) => x.children.length === 0 && (x.textContent ?? "").trim().length > 12)[i];
    sp.scrollIntoView({ block: "center" });
    await new Promise((res) => setTimeout(res, 250)); // let the scroll settle: a scroll hides the toolbar, as it should
    const r = document.createRange();
    r.selectNodeContents(sp);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    sp.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return sp.textContent.trim();
  }, idx);
  const firstText = await pick(1);
  const bar = page.getByRole("toolbar", { name: "Highlight the selected text" });
  await bar.waitFor();
  ok(true, "selecting text in the paper shows a small toolbar");
  await page.waitForTimeout(300);
  await shot("66b-selection-toolbar");
  await axe("selection toolbar");
  await pick(1); // the scan itself clears the selection, so select again
  await bar.waitFor();
  // before choosing anything: scrolling a little must not make the toolbar disappear, it follows the text
  const selTop = () => page.evaluate(() => getSelection().getRangeAt(0).getBoundingClientRect().top);
  const barTop = async () => (await bar.boundingBox())?.y ?? null;
  const scrollBy = (dy) => page.evaluate((d) => { document.querySelector(".pdfv-scroll").scrollTop += d; }, dy);
  const t0 = await selTop();
  const b0 = await barTop();
  await scrollBy(30);
  await page.waitForTimeout(250);
  ok(await bar.isVisible(), "scrolling a little with the text selected does not make the toolbar go away");
  const t1 = await selTop();
  const b1 = await barTop();
  ok(Math.abs(t1 - t0 + 30) < 4 && Math.abs((b1 - b0) - (t1 - t0)) < 6, `the toolbar moves with the text (text ${Math.round(t1 - t0)} px, toolbar ${Math.round(b1 - b0)} px)`);
  await scrollBy(-30);
  await page.waitForTimeout(250);
  ok(await bar.isVisible() && Math.abs((await barTop()) - b0) < 6, "scrolling back puts it back where it was");
  await scrollBy(700);
  await page.waitForTimeout(250);
  ok(!(await bar.isVisible()), "when the selected text is out of sight the toolbar waits out of the way");
  await scrollBy(-700);
  await page.waitForTimeout(300);
  await bar.waitFor({ timeout: 3000 });
  ok(true, "and it is back when the text comes into view again");
  await bar.getByRole("button", { name: "Highlight in green" }).click();
  await page.locator('[data-page="1"] .pdfp-hl[data-color="green"]').first().waitFor({ timeout: 8000 });
  ok(true, "a highlight in a colour is drawn on the page straight away");
  await bar.waitFor({ state: "detached" });
  ok(true, "the toolbar goes away after choosing");

  const secondText = await pick(2);
  await bar.getByRole("button", { name: "Add note" }).click();
  const noteBox = page.locator("textarea.note-text:focus");
  await noteBox.waitFor({ timeout: 8000 });
  ok(true, "'Add note' opens the Notes tab with the note box ready to type in");
  await noteBox.fill("Check this against the second paper");
  await noteBox.blur();
  await page.waitForFunction(async (id) => (await (await fetch(`/api/v1/documents/${id}/notes`)).json()).items.some((n) => n.note === "Check this against the second paper"), await page.evaluate(() => location.pathname.split("/").pop()), { timeout: 8000 });
  ok(true, "the note is saved when the box loses focus");
  ok((await page.locator(".note").count()) === 2, "the Notes tab lists both, in page order");
  ok((await page.locator(".dw-tab-n").filter({ hasText: "2" }).count()) >= 1, "the Notes tab shows how many there are");
  await shot("66c-notes-panel");
  await axe("notes panel");

  await page.reload({ waitUntil: "networkidle" });
  await page.locator('[data-page="1"] .pdfp-hl').first().waitFor({ timeout: 15000 });
  ok(true, "after reloading, the highlights are drawn again");
  ok(/\S/.test(firstText) && /\S/.test(secondText), "(the two pieces of text were real)");

  await page.getByRole("tab", { name: /^Notes/ }).first().click();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download", exact: true }).click();
  const file = await dl;
  ok(/notes\.md$/.test(file.suggestedFilename()), `the notes download as Markdown (${file.suggestedFilename()})`);

  await page.getByRole("button", { name: /^Delete the note on page 1/ }).first().click();
  await page.waitForFunction(() => document.querySelectorAll(".note").length === 1, null, { timeout: 8000 });
  ok(true, "deleting a note removes it from the list");
  await page.waitForFunction(() => document.querySelectorAll('[data-page="1"] .pdfp-hl').length > 0 && !document.querySelector('[data-page="1"] .pdfp-hl[data-color="green"]'), null, { timeout: 8000 });
  ok(true, "...and its highlight leaves the page, while the other stays");

  console.log("exact highlights, overlap, note icons, many notes");
  const docId = await page.evaluate(() => location.pathname.split("/").pop());
  const notesNow = () => page.evaluate(async (id) => (await (await fetch(`/api/v1/documents/${id}/notes`)).json()).items, docId);
  /** Selects words [from, to) of the idx-th long text piece on page 1, like dragging across them; returns the selection's own width and the piece's width. */
  const pickWords = (idx, from, to) => page.evaluate(async ([i, a, b]) => {
    const layer = document.querySelector('[data-page="1"] .textLayer');
    const sp = [...layer.querySelectorAll("span")].filter((x) => x.children.length === 0 && (x.textContent ?? "").trim().length > 25)[i];
    sp.scrollIntoView({ block: "center" });
    await new Promise((res) => setTimeout(res, 250));
    const node = sp.firstChild;
    const text = node.textContent;
    const ws = [...text.matchAll(/\S+/g)];
    const end = b === undefined ? text.length : ws[Math.min(b, ws.length) - 1].index + ws[Math.min(b, ws.length) - 1][0].length;
    const r = document.createRange();
    r.setStart(node, a === undefined ? 0 : ws[a].index);
    r.setEnd(node, end);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    sp.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return { selectionWidth: r.getBoundingClientRect().width, pieceWidth: sp.getBoundingClientRect().width, words: ws.length };
  }, [idx, from, to]);
  const hl = (color) => page.locator(`[data-page="1"] .pdfp-hl${color ? `[data-color="${color}"]` : ""}`);
  const notesBefore = (await notesNow()).length;

  // a part of a line is highlighted exactly, not the whole line
  const sel1 = await pickWords(1, 2, 6);
  await bar.waitFor();
  await bar.getByRole("button", { name: "Highlight in green" }).click();
  await hl("green").first().waitFor({ timeout: 8000 });
  const w1 = await hl("green").first().evaluate((e) => e.getBoundingClientRect().width);
  ok(Math.abs(w1 - sel1.selectionWidth) < 8, `only the chosen words are marked (${w1.toFixed(0)} px for a selection of ${sel1.selectionWidth.toFixed(0)} px)`);
  ok(w1 < sel1.pieceWidth * 0.9, "...not the whole line of text");
  ok((await hl("green").first().evaluate((e) => getComputedStyle(e).mixBlendMode)) === "multiply", "highlights multiply into the page, so the text stays readable");

  // a longer highlight around it, in another colour: both stay visible
  await pickWords(1);
  await bar.waitFor();
  await bar.getByRole("button", { name: "Highlight in blue" }).click();
  await hl("blue").first().waitFor({ timeout: 8000 });
  ok((await hl("green").count()) >= 1 && (await hl("blue").count()) >= 1, "a longer highlight around a short one: both are drawn, the short one is not lost");
  ok((await notesNow()).length === notesBefore + 2, "...and both are kept as highlights");
  const gb = await hl("green").first().boundingBox();
  const bb = await hl("blue").first().boundingBox();
  ok(gb && bb && gb.x >= bb.x - 1 && gb.x + gb.width <= bb.x + bb.width + 1, "the short highlight lies inside the long one");
  await page.waitForTimeout(400);
  await shot("66d-overlapping-highlights");
  await axe("workspace with overlapping highlights");

  // the same text again
  await pickWords(1, 2, 6);
  await bar.waitFor();
  await bar.getByRole("button", { name: "Highlight in green" }).click();
  await page.getByText("That text is already highlighted in this colour.").waitFor({ timeout: 5000 });
  ok((await notesNow()).length === notesBefore + 2, "the same words in the same colour are not added twice (and the page says so)");
  await pickWords(1, 2, 6);
  await bar.waitFor();
  await bar.getByRole("button", { name: "Highlight in pink" }).click();
  await hl("pink").first().waitFor({ timeout: 8000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-page="1"] .pdfp-hl[data-color="green"]').length === 0);
  ok((await notesNow()).length === notesBefore + 2, "the same words in a new colour change the colour of that highlight; no second copy is drawn");

  // a note has an icon above its highlight; a plain highlight has none
  const icons = page.locator('[data-page="1"] .pdfp-noteicon');
  ok((await icons.count()) === 1, "the note that has words in it has an icon on the page, the highlights without a note have none");
  const ib = await icons.first().boundingBox();
  const hb = await page.locator('[data-page="1"] .pdfp-hl').first().boundingBox();
  ok(ib && ib.y < (await page.locator('[data-page="1"] .pdfp-hl[data-note]').evaluateAll((els) => Math.max(...els.map((e) => e.getBoundingClientRect().bottom)))), "the icon sits at the highlight");
  await pickWords(0, 0, 4);
  await bar.waitFor();
  await bar.getByRole("button", { name: "Add note" }).click();
  await page.locator("textarea.note-text:focus").waitFor({ timeout: 8000 });
  ok((await icons.count()) === 2, "pressing Add note puts an icon on the page straight away");
  await page.locator("textarea.note-text:focus").blur();
  await page.waitForFunction(() => document.querySelectorAll('[data-page="1"] .pdfp-noteicon').length === 1, null, { timeout: 5000 });
  ok(true, "a note left empty is just a highlight again: its icon goes");
  await icons.first().click();
  await page.locator("textarea.note-text:focus").waitFor({ timeout: 8000 });
  ok(/Check this against the second paper/.test(await page.locator("textarea.note-text:focus").inputValue()), "pressing the icon opens that note, ready to edit");
  await page.locator("textarea.note-text:focus").blur();
  await axe("workspace with a note icon");
  await setTheme("Dark"); await page.waitForTimeout(500); await axe("workspace with a note icon, dark"); await setTheme("Light");

  // many notes: the list scrolls and keeps its heading
  await page.evaluate(async (id) => {
    for (let i = 0; i < 14; i++) {
      await fetch(`/api/v1/documents/${id}/notes`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Origin: location.origin }, body: JSON.stringify({ page: 1, quote: `extra highlight number ${i} that is not on the page`, color: ["yellow", "green", "blue", "pink"][i % 4], note: `note ${i}` }) });
    }
  }, docId);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("tab", { name: /^Notes/ }).first().click();
  await page.locator(".note").nth(12).waitFor({ timeout: 10000 });
  const body = page.locator(".notes-body");
  const dims = await body.evaluate((e) => ({ scroll: e.scrollHeight, client: e.clientHeight, overflow: getComputedStyle(e).overflowY }));
  ok(dims.scroll > dims.client && dims.overflow === "auto", `with many notes the list scrolls (${dims.scroll} px of notes in ${dims.client} px)`);
  const headTop = await page.locator(".notes-head").evaluate((e) => e.getBoundingClientRect().top);
  await body.evaluate((e) => (e.scrollTop = e.scrollHeight));
  await page.waitForTimeout(200);
  ok((await body.evaluate((e) => e.scrollTop)) > 100, "it can be scrolled to the last note");
  ok(Math.abs((await page.locator(".notes-head").evaluate((e) => e.getBoundingClientRect().top)) - headTop) < 2, "the count and the buttons stay where they are while the list scrolls");
  ok(await page.locator(".note").last().isVisible(), "the last note can be reached");
  await axe("notes panel with many notes");
  await page.evaluate(async (id) => {
    const items = (await (await fetch(`/api/v1/documents/${id}/notes`)).json()).items.filter((n) => n.quote.startsWith("extra highlight number"));
    for (const n of items) await fetch(`/api/v1/documents/${id}/notes/${n.id}`, { method: "DELETE", credentials: "same-origin", headers: { Origin: location.origin } });
  }, docId);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".dw-sidetab", { hasText: "Ask" }).click(); // back to the questions

  console.log("answer progress and stop");
  await page.locator("#ask-input").fill("What are the limitations?");
  await page.locator("#ask-input").press("Enter");
  await page.locator(".ask-live").waitFor({ timeout: 10000 });
  ok((await page.locator(".ask-steps li").count()) === 4, "while an answer is produced, the four real steps are shown");
  await page.locator(".ask-page-chip").first().waitFor({ timeout: 8000 });
  ok(/^p\.\d/.test(await page.locator(".ask-page-chip").first().innerText()),"the pages being read are shown as soon as retrieval is done");
  await page.locator(".ask-text-live").waitFor({ timeout: 10000 });
  ok(/[A-Za-z]{3,}/.test(await page.locator(".ask-text-live").innerText()) && !/\[\d+\]/.test(await page.locator(".ask-text-live").innerText()), "the answer text appears while it is written, without unchecked citation markers");
  await shot("66-answer-streaming");
  await page.waitForTimeout(800); // earlier answers fade in over 0.3 s; axe must not measure a colour mid-fade (it did on a slow CI runner)
  await axe("workspace while an answer is streaming");
  await page.locator(".ask-answer").nth(2).waitFor({ timeout: 30000 });
  ok((await page.locator(".ask-live").count()) === 0, "when the checked answer arrives it replaces the progress view");
  await page.locator("#ask-input").fill("How were participants recruited, in detail?");
  await page.locator("#ask-input").press("Enter");
  await page.locator(".ask-live").waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Stop answering" }).click();
  await page.locator(".ask-error", { hasText: "Stopped" }).waitFor({ timeout: 10000 });
  ok(await page.locator(".ask-error").getByRole("button", { name: "Try again" }).isVisible(), "Stop ends the answer and offers Try again");
  ok(await page.locator("#ask-input").isEnabled(), "the question box is usable again straight away");

  await page.locator("#ask-input").fill("an unanswerable question about funding");
  await page.locator("#ask-input").press("Enter");
  await page.locator(".ask-status", { hasText: "Not in this paper" }).waitFor({ timeout: 30000 });
  ok(true, "a question the paper cannot answer is reported as such, with no invented source");
  await page.locator("#ask-input").fill("please hallucinate something");
  await page.locator("#ask-input").press("Enter");
  await page.locator(".ask-status", { hasText: "Could not verify" }).waitFor({ timeout: 30000 }).catch(async (e) => { console.log("ASK PANEL:", (await page.locator(".ask-turns > li").last().innerText()) + " || " + (await page.locator(".ask-turns > li").count())); throw e; });
  ok(await page.getByText(/quoted evidence was not found/).isVisible(), "an answer whose quote is not in the paper is shown with a warning");
  ok((await page.locator(".ask-answer").count()) === 5, "all five answers stay on screen");

  console.log("zoom and keyboard");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(500);
  ok((await page.locator(".pdfv-pct").innerText()) === "115%", "zoom in goes to 115%");
  await page.getByRole("button", { name: "Fit to width" }).first().click();
  await page.locator("#pdfv-page").fill("3");
  await page.locator("#pdfv-page").press("Enter");
  ok(await until(async () => (await page.locator(".thumb[aria-current=true]").getAttribute("aria-label")) === "Go to page 3"), "typing a page number jumps there and the thumbnail follows");

  console.log("pinch zoom");
  const pct = async () => Number((await page.locator(".pdfv-pct").innerText()).replace("%", ""));
  await page.getByRole("button", { name: "Fit to width" }).first().click();
  await page.waitForTimeout(400);
  const viewBox = await page.locator(".pdfv-scroll").boundingBox();
  const cx = viewBox.x + viewBox.width / 2;
  const cy = viewBox.y + 160;
  await page.mouse.move(cx, cy);
  // where in the page the point under the fingers is, as a share of the page's height: it must stay the same
  const share = () => page.evaluate((y) => {
    const sc = document.querySelector(".pdfv-scroll");
    const r = sc.getBoundingClientRect();
    const at = y - r.top;
    for (const pg of document.querySelectorAll("[data-page]")) {
      const b = pg.getBoundingClientRect();
      if (b.top <= y && y <= b.bottom) return { page: pg.dataset.page, share: (y - b.top) / b.height, at: Math.round(at) };
    }
    return null;
  }, cy);
  const was = await share();
  await page.keyboard.down("Control");
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -8); await page.waitForTimeout(30); }
  await page.keyboard.up("Control");
  ok(await until(async () => (await pct()) > 110, 5000), `a trackpad pinch out (Ctrl and the wheel) zooms in (${await pct()}%)`);
  ok((await page.evaluate(() => window.visualViewport.scale)) === 1, "...and does not zoom the whole browser page");
  await page.waitForTimeout(600);
  const now = await share();
  ok(was && now && was.page === now.page && Math.abs(was.share - now.share) < 0.03, `the point under the fingers stays under them (page ${was?.page} at ${was ? Math.round(was.share * 100) : "?"}% of its height, then ${now ? Math.round(now.share * 100) : "?"}%)`);
  await page.keyboard.down("Control");
  for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 10); await page.waitForTimeout(15); }
  await page.keyboard.up("Control");
  ok(await until(async () => (await pct()) <= 60, 5000), `pinching in far enough stops at the smallest zoom (${await pct()}%)`);
  ok((await page.getByRole("button", { name: "Zoom out" }).isDisabled()), "...and Zoom out is then switched off");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(400);
  ok((await pct()) === 75, `the buttons carry on from there (${await pct()}%)`);
  // two fingers on a touch screen
  await page.getByRole("button", { name: "Fit to width" }).first().click();
  await page.waitForTimeout(400);
  const pinch = (from, to, steps = 8) => page.evaluate(([f, t, n]) => {
    const el = document.querySelector(".pdfv-scroll");
    const r = el.getBoundingClientRect();
    const mx = r.left + r.width / 2, my = r.top + 200;
    const mk = (d) => [0, 1].map((i) => new Touch({ identifier: i + 1, target: el, clientX: mx + (i ? d : -d) / 2, clientY: my }));
    const fire = (type, touches) => { const ev = new TouchEvent(type, { touches, targetTouches: touches, changedTouches: touches, bubbles: true, cancelable: true }); el.dispatchEvent(ev); return ev.defaultPrevented; };
    fire("touchstart", mk(f));
    let prevented = true;
    for (let i = 1; i <= n; i++) prevented = fire("touchmove", mk(f + ((t - f) * i) / n)) && prevented;
    fire("touchend", []);
    return prevented;
  }, [from, to, steps]);
  ok(await pinch(80, 200), "two fingers moving apart are the reader's, not the browser's");
  ok(await until(async () => (await pct()) > 130, 5000), `two fingers moving apart zoom in (${await pct()}%)`);
  await pinch(240, 80);
  ok(await until(async () => (await pct()) < 100, 5000), `two fingers moving together zoom out (${await pct()}%)`);
  await page.getByRole("button", { name: "Fit to width" }).first().click();
  await page.waitForTimeout(300);
  await axe("workspace after zooming");

  console.log("history and rename");
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".ask-answer").first().waitFor({ timeout: 30000 });
  ok((await page.locator(".ask-answer").count()) === 5, "after a reload the earlier questions and answers are still there");
  await page.getByRole("button", { name: "Rename this paper" }).click();
  await page.locator("#dw-title").fill("Glaucoma screening (Pune cohort)");
  await page.locator("#dw-title").press("Enter");
  await page.getByRole("heading", { level: 1, name: /Pune cohort/ }).waitFor();
  ok(true, "renaming from the workspace works");

  const mainUrl = page.url();
  console.log("paper intelligence: title, contents, references");
  const refsText = ["Aaa, A., and Bbb, B. 2001. A first reference with a reasonably long title that wraps", "Ccc, C. 2002. A second reference whose title also needs to wrap around the line", "Ddd, D., Eee, E. 2003. A third and final reference of this small test bibliography"];
  const structured = makePdfLines([
    [
      { text: "Glaucoma Screening in Rural Clinics", size: 20 }, { text: "A. Author and B. Writer", size: 12, gap: 6 }, { text: "DOI: 10.1234/glaucoma.2021.5", size: 9, gap: 4 },
      { text: "Abstract", size: 14, gap: 14 }, { text: "We study glaucoma screening on low-cost devices and report what we found.", gap: 2 },
      { text: "1 Introduction", size: 14, gap: 16 }, { text: "Glaucoma is a leading cause of blindness, and screening is hard to scale.", gap: 2 },
      { text: "2 Methods", size: 14, gap: 16 }, { text: "Participants were recruited from three hospitals.", gap: 2 },
    ],
    [
      { text: "3 Results", size: 14 }, { text: "The model reached an AUC of 0.94 on the held-out images.", gap: 2 },
      { text: "References", size: 14, gap: 20 },
      ...refsText.flatMap((r, i) => [{ text: r, gap: 6 }, { text: `Journal ${i + 1}, ${i + 3}(2), 1-${i + 9}.`, x: 70 }]),
    ],
  ]);
  const verdict = (reference) => {
    const verified = !reference.includes("Ddd");
    return { input: reference, status: verified ? "verified" : "not_found", reason: verified ? "Matches a real record." : "No matching paper was found in Crossref.", confidence: 1, retracted: reference.includes("Ccc") || undefined, match: verified ? { doi: "10.1000/x", title: "A matched title", authors: ["A. Writer"], year: 2001, venue: "Journal" } : null, checks: verified ? { title: 1, author: true, year: true } : null };
  };
  await page.route("**/api/v1/references/verify", (route) => route.fulfill({ json: verdict(route.request().postDataJSON().reference) }));
  await page.getByRole("button", { name: /^My (papers|Workspace)$/ }).first().click();
  await page.locator(".dc").first().waitFor();
  const before = await page.locator(".dc").count();
  await page.locator('input[type="file"]').setInputFiles({ name: "structured_paper.pdf", mimeType: "application/pdf", buffer: structured });
  await page.locator(".dc", { hasText: "Glaucoma Screening in Rural Clinics" }).waitFor({ timeout: 40000 });
  ok((await page.locator(".dc").count()) === before + 1, "the new paper takes the title found in its PDF, not its file name");
  await page.locator(".dc", { hasText: "Glaucoma Screening in Rural Clinics" }).locator(".dc-open").click();
  await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  ok(await page.getByRole("heading", { level: 1, name: /Glaucoma Screening in Rural Clinics/ }).isVisible(), "the workspace shows that title");
  ok((await page.locator(".dw-sidetab .dw-tab-n").innerText()).trim() === "3", "the References tab shows how many were found (3)");
  await page.getByRole("button", { name: "Contents" }).click();
  await page.locator(".toc").waitFor();
  const toc = await page.locator(".toc-title").allInnerTexts();
  ok(["Abstract", "1 Introduction", "2 Methods", "3 Results"].every((h) => toc.includes(h)), `the Contents menu lists the headings (${toc.join(" | ")})`);
  ok(/Headings found by reading the pages/.test(await page.locator(".toc-note").innerText()), "...and says they were detected, not bookmarks");
  await page.waitForTimeout(500); // let the popover finish fading in before it is measured
  await shot("67-contents-menu");
  await axe("contents menu");
  await page.locator(".toc-item", { hasText: "3 Results" }).click();
  ok(await until(async () => (await page.locator("#pdfv-page").inputValue()) === "2"), "choosing a heading jumps to its page");

  await page.getByRole("tab", { name: "References" }).last().click().catch(async () => page.locator(".dw-sidetab", { hasText: "References" }).click());
  await page.locator(".refs-panel .ref").first().waitFor({ timeout: 20000 });
  await page.locator(".vsum-headline").filter({ hasText: /checked/ }).waitFor({ timeout: 20000 });
  ok((await page.locator(".refs-panel .ref").count()) === 3, "all three references are listed and checked");
  ok(/cites 1 retracted work/.test(await page.locator(".refs-panel .retract").first().innerText()), "a retracted citation is called out at the top");
  ok((await page.locator(".refs-panel .ref-status", { hasText: "Not found" }).count()) === 1, "an entry that matches nothing is marked Not found");
  await page.waitForTimeout(600);
  await shot("68-references-panel");
  await axe("references panel");
  await setTheme("Dark"); await shot("69-references-dark"); await axe("references panel, dark"); await setTheme("Light");

  // the reference section of the PDF itself, and correcting it
  console.log("the reference section, and correcting it");
  const sec = page.locator(".refsec");
  await sec.locator("summary").click();
  await sec.locator(".refsec-text").waitFor({ timeout: 20000 });
  ok(/Found on page 2/.test(await sec.locator(".refsec-where").innerText()), "the section says which page of the PDF it was found on");
  ok(/3 entries were found\. This list has no numbers/.test(await sec.locator(".refsec-verdict").innerText()), "...and, for a list with no numbers, that its count cannot be checked against the PDF");
  const boxText = await sec.locator(".refsec-text").inputValue();
  ok(boxText.split(/\n\s*\n/).length === 3 && /Aaa, A/.test(boxText) && /Ddd, D/.test(boxText), "the box holds the three references as found, one to a paragraph");
  ok((await sec.locator(".refsec-count").innerText()).startsWith("3 references"), "it counts what is in the box");
  await sec.getByRole("button", { name: "Open page 2" }).click();
  ok(await until(async () => (await page.locator("#pdfv-page").inputValue()) === "2"), "'Open page' goes to the page of the section");
  await page.locator(".dw-sidetab", { hasText: "References" }).click();
  await sec.locator(".refsec-text").waitFor();
  await shot("68b-reference-section");
  await axe("reference section open");
  await setTheme("Dark"); await axe("reference section open, dark"); await setTheme("Light");

  // a joined entry is split by hand, an entry is added, and the corrected list is what gets checked and kept
  await sec.locator(".refsec-text").fill(`${boxText}\n\nEee, E. 2004. A fourth reference that was added by hand to the list. Journal 4, 1-9.`);
  ok((await sec.locator(".refsec-count").innerText()).startsWith("4 references"), "adding a paragraph makes it four");
  await sec.getByRole("button", { name: "Check this list" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".refs-panel .ref").length === 4, null, { timeout: 20000 });
  await page.locator(".vsum-headline").filter({ hasText: /checked/ }).waitFor({ timeout: 20000 });
  ok(true, "the corrected list is checked: four references are listed");
  ok(/Eee, E\./.test(await page.locator(".refs-panel .ref").last().innerText()), "...including the one added by hand");
  ok(await sec.getByRole("button", { name: "Saved and checking" }).isVisible(), "the panel says it was saved");
  ok((await page.locator(".dw-sidetab .dw-tab-n").first().innerText()).trim() === "4", "the References tab counts four");

  // the correction is kept with the paper
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".dw-sidetab", { hasText: "References" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".refs-panel .ref").length === 4, null, { timeout: 20000 });
  ok(true, "after reloading, the corrected list (four) is still the one shown");

  // back to what the PDF says
  await page.locator(".refsec summary").click();
  await page.locator(".refsec-text").waitFor();
  await page.getByRole("button", { name: "Back to what was found" }).click();
  ok((await page.locator(".refsec-count").innerText()).startsWith("3 references"), "'Back to what was found' puts the PDF's own list back in the box");
  await page.getByRole("button", { name: "Check this list" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".refs-panel .ref").length === 3, null, { timeout: 20000 });
  ok(true, "and checking it makes the three the list again");
  await page.getByRole("button", { name: "Preview record" }).first().click();
  await page.getByRole("dialog").locator(".pv-title").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".dw-sidetab", { hasText: "Ask" }).click();
  await page.locator("#ask-input").waitFor();
  ok(true, "switching back to Ask keeps the conversation");
  await page.unroute("**/api/v1/references/verify");
  const newest = (await (await page.request.get(BASE + "/api/v1/documents")).json()).items.find((d) => d.title === "Glaucoma Screening in Rural Clinics");
  ok((await page.request.delete(BASE + "/api/v1/documents/" + newest.id, { headers: { Origin: BASE } })).ok(), "(clean up the extra paper)");
  await page.goto(mainUrl, { waitUntil: "networkidle" });

  console.log("mobile");
  const mp = await ctx.newPage();
  await mp.setViewportSize({ width: 390, height: 844 });
  await mp.goto(page.url(), { waitUntil: "networkidle" });
  await mp.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  ok(!(await mp.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)), "390px: no horizontal overflow");
  ok(await mp.getByRole("tab", { name: "Paper" }).isVisible() && (await mp.locator("#dw-panel-ask").isHidden()), "390px: Paper and Ask are tabs, the paper shows first");
  await shot("63-workspace-mobile-paper", mp);
  await axe("workspace, 390px", mp);
  await mp.getByRole("tab", { name: "Ask" }).click();
  await mp.locator(".ask-answer").first().waitFor();
  await mp.waitForTimeout(500);
  await shot("64-workspace-mobile-ask", mp);
  await axe("workspace ask tab, 390px", mp);
  await mp.locator(".cite-chip").first().click();
  ok(await mp.getByRole("tab", { name: "Paper", selected: true }).isVisible(), "390px: tapping a source switches to the paper");
  await mp.close();

  console.log("delete");
  await page.getByRole("button", { name: /^My (papers|Workspace)$/ }).first().click();
  await page.locator(".dc").first().waitFor();
  await page.getByRole("button", { name: /^Delete Glaucoma screening/ }).click();
  const confirm = page.getByRole("dialog");
  await confirm.waitFor();
  await page.waitForTimeout(400);
  await shot("65-delete-confirm");
  await axe("delete confirmation");
  await confirm.getByRole("button", { name: "Delete paper" }).click();
  await page.locator(".dc").waitFor({ state: "detached", timeout: 10000 });
  ok(true, "deleting a paper removes it from the list");
  const list = await (await page.request.get(BASE + "/api/v1/documents")).json();
  ok(list.items.length === 0, "...and from the server");

  ok(errors.length === 0, `no console/page errors${errors.length ? ": " + errors.join(" | ").slice(0, 500) : ""}`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
}
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall papers browser checks passed");
process.exit(failures ? 1 : 0);
