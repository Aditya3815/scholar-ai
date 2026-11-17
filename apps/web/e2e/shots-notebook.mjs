// Pictures of the Notebook of the new Paper Reader for the owner (docs/design/paper-reader.md, phase 2): not a suite (scripts/lib/suites.mjs lists it in NOT_RUN), nothing is checked.
// It starts its own Worker with READER on, signs a fake person in, uploads the suites' fixture paper with three highlights and a page of notes that holds headings, bold, italic and mark,
// both kinds of list and two quotes, and saves:
//   p2-{desktop|tablet|phone}-{light|dark|read}.png    the Notes tab open on that page (Split on the desktop 1440 x 900 and the tablet 834 x 1112; the Notes view on the phone 390 x 844)
//   p2-desktop-styles-{plain|ruled|dotted|grid}-light.png    the page in each paper style (the Notes view)
//   p2-phone-toast-open-light.png    Add to notes from the Paper view on a phone: the toast with Undo and Open
//   p2-desktop-quote-picker-dark.png    the quote picker
//   p2-desktop-conflict-light.png    a second window saved first: "Updated from another window"
//   p2-desktop-highlights-innotes-read.png    the Highlights tab with In notes on the cards that are quoted
//   npm run build -w apps/web && INTEGRATION_PORT=8792 INTEGRATION_IDP_PORT=9915 SHOTS_DIR=<folder> node apps/web/e2e/shots-notebook.mjs
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { SAMPLE_PAPER, makePdf } from "@scholar/test-support/make-pdf.mjs";
import { startTestWorker } from "../../api/scripts/lib/test-worker.mjs";
import { BASE, desk, launch, phone, sleep, startIdp } from "./lib/browser.mjs";

const OUT = process.env.SHOTS_DIR ?? fileURLToPath(new URL("./shots/notebook/", import.meta.url));
mkdirSync(OUT, { recursive: true });
const DEVICES = { desktop: desk(1440, 900), tablet: desk(834, 1112), phone: phone(390, 844) };
const THEMES = ["light", "dark", "read"];
const MD =
  "# Methods\nPatch embedding is **linear**, and the encoder is *a plain Transformer*. ==Check the patch size== against <u>Table 2</u>.\n\n## What to check\n- The dataset: 12,000 images\n- Three hospitals in Pune\n\n1. Read the ablation\n2. Compare with the cataract subgroup";

const idp = await startIdp();
const browser = await launch();
const saved = [];

async function setUp() {
  idp.setUser({ sub: "notebook-shots", email: "shots.nb@example.edu", email_verified: true, name: "Meera Shots" });
  const ctx = await browser.newContext(desk(1280, 800));
  const p = await ctx.newPage();
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  await p.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
  await p.getByRole("button", { name: "Continue with Google" }).last().click();
  await p.locator("#hm-h").waitFor({ timeout: 20000 });
  await sleep(800);
  await p.goto(BASE + "/papers", { waitUntil: "networkidle" });
  const handled = p.getByRole("region", { name: /how your papers are handled/ });
  if (await handled.count()) {
    await handled.getByRole("button", { name: "I understand, continue" }).click();
    await handled.waitFor({ state: "detached", timeout: 8000 });
  }
  await p.locator('input[type="file"]').setInputFiles({ name: "glaucoma_screening.pdf", mimeType: "application/pdf", buffer: makePdf(SAMPLE_PAPER, { title: "Glaucoma screening" }) });
  await p.waitForFunction(() => document.querySelector(".dc")?.getAttribute("data-status") === "ready", null, { timeout: 60000 });
  const docId = (await (await p.request.get(BASE + "/api/v1/documents")).json()).items[0].id;
  const H = { Origin: BASE };
  const add = async (page, quote, color, note = "") => (await (await p.request.post(`${BASE}/api/v1/documents/${docId}/notes`, { headers: H, data: { page, quote, color, note } })).json()).note;
  const a = await add(1, "A convolutional network trained on 12,000 images", "yellow", "The central claim: check the dataset size.");
  await add(2, "Participants were recruited from three hospitals in Pune", "green");
  const c = await add(3, "The model reached a sensitivity of 91 percent", "pink", "Compare with the cataract subgroup.");
  const q = (n, id) => ({ id, kind: "quote", noteId: n.id, page: n.page, quote: n.quote, color: n.color });
  const blocks = [
    { id: "t1", kind: "text", md: MD },
    q(a, "q1"),
    { id: "t2", kind: "text", md: "My reading: the claim rests on the **size of the dataset**, not on the model." },
    q(c, "q2"),
    { id: "t3", kind: "text", md: "" },
  ];
  await p.request.put(`${BASE}/api/v1/documents/${docId}/notebook/pages/methods`, { headers: H, data: { title: "Methods", style: "ruled", position: 1, blocks } });
  await p.request.put(`${BASE}/api/v1/documents/${docId}/notebook/pages/results`, { headers: H, data: { title: "Results", style: "plain", position: 2, blocks: [{ id: "r1", kind: "text", md: "Sensitivity 0.91, specificity 0.87." }] } });
  const state = await ctx.storageState();
  await ctx.close();
  return { state, docId };
}

async function open({ state, docId }, viewport, theme, view) {
  const ctx = await browser.newContext({ ...viewport, storageState: state, colorScheme: "light" });
  await ctx.addInitScript(([t, v, d]) => {
    try {
      localStorage.setItem("theme", t);
      localStorage.setItem("scholar.view", v);
      localStorage.setItem(`scholar.notebook.${d}`, "methods");
    } catch {
      /* no storage */
    }
  }, [theme, view, docId]);
  const page = await ctx.newPage();
  await page.goto(BASE + "/papers/" + docId, { waitUntil: "networkidle" });
  if (view !== "notes") await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  await page.locator(".nb-bar").waitFor({ timeout: 30000 }).catch(() => {});
  await sleep(1200);
  return { ctx, page };
}

const shoot = async (page, name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  saved.push(`${name}.png`);
  console.log(`  saved ${name}.png`);
};

try {
  const worker = await startTestWorker({ switchVars: { READER: "on" } });
  try {
    const paper = await setUp();
    const api = (await browser.newContext({ storageState: paper.state })).request;
    const style = (s) => api.patch(`${BASE}/api/v1/documents/${paper.docId}/notebook/pages/methods`, { headers: { Origin: BASE }, data: { style: s } });
    for (const device of Object.keys(DEVICES)) {
      for (const theme of THEMES) {
        const { ctx, page } = await open(paper, DEVICES[device], theme, device === "phone" ? "notes" : "split");
        await shoot(page, `p2-${device}-${theme}`);
        await ctx.close();
      }
    }
    for (const s of ["plain", "ruled", "dotted", "grid"]) {
      await style(s);
      const { ctx, page } = await open(paper, DEVICES.desktop, "light", "notes");
      await shoot(page, `p2-desktop-styles-${s}-light`);
      await ctx.close();
    }
    await style("ruled");
    {
      const { ctx, page } = await open(paper, DEVICES.phone, "light", "paper");
      await page.evaluate(async () => {
        const sp = [...document.querySelectorAll('[data-page="1"] .textLayer span')].filter((x) => x.children.length === 0 && (x.textContent ?? "").trim().length > 25)[2];
        sp.scrollIntoView({ block: "center" });
        await new Promise((r) => setTimeout(r, 250));
        const r = document.createRange();
        r.selectNodeContents(sp);
        getSelection().removeAllRanges();
        getSelection().addRange(r);
        sp.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      });
      await page.locator(".desk-pop").getByRole("button", { name: "Add to notes" }).click();
      await page.locator(".desk-toast", { hasText: "Added to" }).waitFor({ timeout: 10000 });
      await sleep(700);
      await page.evaluate(() => getSelection().removeAllRanges());
      await shoot(page, "p2-phone-toast-open-light");
      await ctx.close();
    }
    {
      const { ctx, page } = await open(paper, DEVICES.desktop, "dark", "split");
      await page.locator(".nb-tools").getByRole("button", { name: "Quote" }).click();
      await page.getByRole("dialog", { name: "Insert a quote of a highlight" }).waitFor();
      await sleep(400);
      await shoot(page, "p2-desktop-quote-picker-dark");
      await ctx.close();
    }
    {
      const { ctx, page } = await open(paper, DEVICES.desktop, "light", "split");
      const other = await ctx.newPage();
      await other.goto(BASE + "/papers/" + paper.docId, { waitUntil: "networkidle" });
      await other.locator(".nb-bar").waitFor({ timeout: 30000 });
      await sleep(800);
      const edit = async (p, words) => {
        await p.locator(".nb-text").nth(1).click();
        await p.keyboard.press("Control+End");
        await p.keyboard.type(words);
        await p.keyboard.press("Escape");
      };
      await edit(other, " (written in another window)");
      await other.locator(".nb-save", { hasText: /^Saved/ }).waitFor({ timeout: 10000 });
      await edit(page, " And mine, here.");
      await page.locator(".nb-save", { hasText: "Updated from another window" }).waitFor({ timeout: 10000 });
      await page.locator(".desk-toast", { hasText: "Updated from another window" }).waitFor({ timeout: 5000 }).catch(() => {});
      await sleep(300);
      await shoot(page, "p2-desktop-conflict-light");
      await ctx.close();
    }
    {
      const { ctx, page } = await open(paper, DEVICES.desktop, "read", "split");
      await page.getByRole("tab", { name: /^Highlights/ }).click();
      await page.locator(".note-innotes").first().waitFor({ timeout: 10000 });
      await sleep(600);
      await shoot(page, "p2-desktop-highlights-innotes-read");
      await ctx.close();
    }
  } finally {
    await worker.stop();
  }
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  idp.close?.();
}
console.log(`\n${saved.length} pictures in ${OUT}`);
process.exit(process.exitCode ?? 0);
