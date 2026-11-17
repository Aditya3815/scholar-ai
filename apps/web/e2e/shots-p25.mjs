// Pictures of the Notes tab of the new Paper Reader, phase 2.5, for the owner (docs/design/paper-reader.md, 21.4): not a suite (scripts/lib/suites.mjs lists it in NOT_RUN), nothing is
// checked. It starts its own Worker with READER on, signs a fake person in, uploads the suites' fixture paper with three highlights and two pages of notes (one holds text, a quote, a
// capture and a sketch), and saves:
//   p25-desktop-notes-{light|dark|read}.png    the Notes view on a wide screen (the page full width, the page tabs, the header with Delete and Export)
//   p25-desktop-split-light.png    Split: the paper and the notes side by side
//   p25-desktop-picker-light.png    + Page: "Choose paper for the new page"
//   p25-desktop-capture-block-light.png, p25-desktop-sketch-block-light.png    a capture block and a sketch block, near
//   p25-desktop-capturing-light.png    the paper with the Capture tool in hand and a frame placed by keyboard
//   p25-desktop-export-light.png    the Export menu
//   p25-phone-notes-{light|dark|read}.png    a phone, the Notes view
//   npm run build -w apps/web && INTEGRATION_PORT=8792 INTEGRATION_IDP_PORT=9915 SHOTS_DIR=<folder> node apps/web/e2e/shots-p25.mjs
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { SAMPLE_PAPER, makePdf } from "@scholar/test-support/make-pdf.mjs";
import { startTestWorker } from "../../api/scripts/lib/test-worker.mjs";
import { BASE, desk, launch, phone, sleep, startIdp } from "./lib/browser.mjs";

const OUT = process.env.SHOTS_DIR ?? fileURLToPath(new URL("./shots/p25/", import.meta.url));
mkdirSync(OUT, { recursive: true });
const THEMES = ["light", "dark", "read"];
const MD = "# Methods\nPatch embedding is **linear**, and the encoder is *a plain Transformer*. ==Check the patch size== against <u>Table 2</u>.\n\n- The dataset: 12,000 images\n- Three hospitals in Pune";

const idp = await startIdp();
const browser = await launch();
const saved = [];

/** A wavy line and a ring, as a sketch would hold them (fractions of its width). */
function strokes() {
  const wave = [];
  for (let i = 0; i <= 40; i++) wave.push(0.06 + i * 0.012, 0.08 + 0.04 * Math.sin(i / 4), 0.5);
  const ring = [];
  for (let i = 0; i <= 48; i++) ring.push(0.7 + 0.06 * Math.cos((i / 48) * 2 * Math.PI), 0.09 + 0.06 * Math.sin((i / 48) * 2 * Math.PI), 0.5);
  const mark = [0.1, 0.15, 0.5, 0.5, 0.16, 0.5];
  return [
    { id: "w1", tool: "pen", color: "blue", w: 0.004, pts: wave },
    { id: "r1", tool: "pen", color: "red", w: 0.004, pts: ring },
    { id: "h1", tool: "highlighter", color: "yellow", w: 0.03, pts: mark },
  ];
}

async function setUp() {
  idp.setUser({ sub: "p25-shots", email: "shots.p25@example.edu", email_verified: true, name: "Meera Shots" });
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
  await add(3, "The model reached a sensitivity of 91 percent", "pink");
  const blocks = [
    { id: "t1", kind: "text", md: MD },
    { id: "q1", kind: "quote", noteId: a.id, page: a.page, quote: a.quote, color: a.color },
    { id: "c1", kind: "capture", page: 1, x: 0.08, y: 0.06, w: 0.84, h: 0.14, caption: "The abstract, as the paper puts it", size: "m" },
    { id: "s1", kind: "sketch", height: 220, strokes: strokes() },
    { id: "t2", kind: "text", md: "" },
  ];
  const put = await p.request.put(`${BASE}/api/v1/documents/${docId}/notebook/pages/methods`, { headers: H, data: { title: "Methods", style: "ruled", position: 1, blocks } });
  if (!put.ok()) throw new Error(`the page was refused: ${put.status()} ${await put.text()}`);
  await p.request.put(`${BASE}/api/v1/documents/${docId}/notebook/pages/results`, { headers: H, data: { title: "Results", style: "grid", position: 2, blocks: [{ id: "r1", kind: "text", md: "Sensitivity 0.91, specificity 0.87." }] } });
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
  await page.locator(".nb-capture[data-state=ok]").first().waitFor({ timeout: 20000 }).catch(() => {});
  await sleep(1200);
  return { ctx, page };
}

const shoot = async (target, name) => {
  await target.screenshot({ path: join(OUT, `${name}.png`) });
  saved.push(`${name}.png`);
  console.log(`  saved ${name}.png`);
};

try {
  const worker = await startTestWorker({ switchVars: { READER: "on" } });
  try {
    const paper = await setUp();
    for (const theme of THEMES) {
      const { ctx, page } = await open(paper, desk(1440, 900), theme, "notes");
      await page.mouse.move(4, 600);
      await shoot(page, `p25-desktop-notes-${theme}`);
      if (theme === "light") {
        await page.locator(".nb-capture").first().scrollIntoViewIfNeeded();
        await sleep(300);
        await shoot(page.locator(".nb-block[data-kind=capture]").first(), "p25-desktop-capture-block-light");
        await page.locator(".nb-sketch").first().scrollIntoViewIfNeeded();
        await sleep(300);
        await shoot(page.locator(".nb-block[data-kind=sketch]").first(), "p25-desktop-sketch-block-light");
        await page.getByRole("button", { name: "Page", exact: true }).click();
        await page.getByRole("dialog", { name: "Choose paper for the new page" }).waitFor();
        await sleep(400);
        await shoot(page, "p25-desktop-picker-light");
        await page.keyboard.press("Escape");
        await page.locator(".nb-export").click();
        await sleep(400);
        await shoot(page, "p25-desktop-export-light");
        await page.keyboard.press("Escape");
      }
      await ctx.close();
    }
    {
      const { ctx, page } = await open(paper, desk(1440, 900), "light", "split");
      await shoot(page, "p25-desktop-split-light");
      await page.getByRole("radio", { name: "Capture" }).click();
      await page.locator('[data-page="1"] .desk-capture').focus();
      await page.keyboard.press("Enter");
      for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowUp");
      await sleep(300);
      await shoot(page, "p25-desktop-capturing-light");
      await ctx.close();
    }
    for (const theme of THEMES) {
      const { ctx, page } = await open(paper, phone(390, 844), theme, "notes");
      await shoot(page, `p25-phone-notes-${theme}`);
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
