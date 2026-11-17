// Pictures of the Paper Reader for the owner, before and after (docs/design/paper-reader.md, phase 1): not a suite (scripts/lib/suites.mjs lists it in NOT_RUN), nothing is checked.
// It starts its own Worker twice, with READER off ("before": today's reader) and on ("after": the new one), signs a fake person in, uploads the suites' fixture paper with three
// highlights, and saves {before|after}-{desktop|tablet|phone}-{light|dark|read}.png (desktop 1440 x 900, tablet 834 x 1112 upright, phone 390 x 844; after: Split on the desktop and
// the tablet, Paper on the phone), and a few of the new reader's states: the phone in Notes, the Agents drawer (desktop) and sheet (phone, dark), the selection's pop-up (Read), and a
// phone on its side (844 x 390: no Split).
//   npm run build -w apps/web && INTEGRATION_PORT=8791 INTEGRATION_IDP_PORT=9914 SHOTS_DIR=<folder> node apps/web/e2e/shots-reader.mjs
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { SAMPLE_PAPER, makePdf } from "@scholar/test-support/make-pdf.mjs";
import { startTestWorker } from "../../api/scripts/lib/test-worker.mjs";
import { BASE, desk, launch, phone, sleep, startIdp } from "./lib/browser.mjs";

const OUT = process.env.SHOTS_DIR ?? fileURLToPath(new URL("./shots/reader/", import.meta.url));
mkdirSync(OUT, { recursive: true });
const DEVICES = { desktop: desk(1440, 900), tablet: desk(834, 1112), phone: phone(390, 844) };
const THEMES = ["light", "dark", "read"];

const idp = await startIdp();
const browser = await launch();
const saved = [];

/** Signs a fresh person in, uploads the fixture, puts three highlights on it; returns the storage state and the paper's id. */
async function setUp(n) {
  idp.setUser({ sub: `reader-shots-${n}`, email: `shots${n}@example.edu`, email_verified: true, name: "Meera Shots" });
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
  const add = (page, quote, color, note = "") => p.request.post(`${BASE}/api/v1/documents/${docId}/notes`, { headers: { Origin: BASE }, data: { page, quote, color, note } });
  await add(1, "A convolutional network trained on 12,000 images", "yellow", "The central claim: check the dataset size.");
  await add(2, "Participants were recruited from three hospitals in Pune", "green");
  await add(3, "The model reached a sensitivity of 91 percent", "pink", "Compare with the cataract subgroup.");
  const state = await ctx.storageState();
  await ctx.close();
  return { state, docId };
}

async function open({ state, docId }, device, theme, { view, viewport } = {}) {
  const ctx = await browser.newContext({ ...(viewport ?? DEVICES[device]), storageState: state, colorScheme: "light" });
  await ctx.addInitScript(([t, v]) => {
    try {
      localStorage.setItem("theme", t);
      if (v) localStorage.setItem("scholar.view", v);
    } catch {
      /* no storage */
    }
  }, [theme, view ?? null]);
  const page = await ctx.newPage();
  await page.goto(BASE + "/papers/" + docId, { waitUntil: "networkidle" });
  if (view === "notes") await page.locator(".note, .nb-bar").first().waitFor({ timeout: 30000 }); // the Notes view: the paper is not drawn (phase 2: the Notes tab is the notebook)
  else {
    await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
    await page.locator('[data-page="1"] .pdfp-hl').first().waitFor({ timeout: 15000 }).catch(() => {});
  }
  await sleep(1200);
  return { ctx, page };
}

const shoot = async (page, name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  saved.push(`${name}.png`);
  console.log(`  saved ${name}.png`);
};

try {
  for (const phase of ["before", "after"]) {
    console.log(`${phase}: READER ${phase === "after" ? "on" : "off"}`);
    const worker = await startTestWorker({ switchVars: phase === "after" ? { READER: "on" } : {} });
    try {
      const paper = await setUp(phase);
      for (const device of Object.keys(DEVICES)) {
        for (const theme of THEMES) {
          // after: Split on the desktop and the tablet, Paper on the phone (each screen's first view)
          const { ctx, page } = await open(paper, device, theme, { view: phase === "after" ? (device === "phone" ? "paper" : "split") : undefined });
          await shoot(page, `${phase}-${device}-${theme}`);
          await ctx.close();
        }
      }
      if (phase === "after") {
        {
          const { ctx, page } = await open(paper, "phone", "light", { view: "notes" });
          await shoot(page, "after-phone-notes-light");
          await ctx.close();
        }
        {
          const { ctx, page } = await open(paper, "desktop", "light", { view: "split" });
          await page.locator(".desk-fab").click();
          await page.getByRole("complementary", { name: "Agents" }).waitFor();
          await sleep(1200);
          await shoot(page, "after-desktop-agents-light");
          await ctx.close();
        }
        {
          const { ctx, page } = await open(paper, "phone", "dark", { view: "paper" });
          await page.locator(".desk-fab").click();
          await page.getByRole("dialog", { name: "Agents" }).waitFor();
          await sleep(1200);
          await shoot(page, "after-phone-agents-dark");
          await ctx.close();
        }
        {
          const { ctx, page } = await open(paper, "desktop", "read", { view: "split" });
          await page.evaluate(async () => {
            const sp = [...document.querySelectorAll('[data-page="1"] .textLayer span')].filter((x) => x.children.length === 0 && (x.textContent ?? "").trim().length > 25)[1];
            const r = document.createRange();
            r.selectNodeContents(sp);
            getSelection().removeAllRanges();
            getSelection().addRange(r);
            sp.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          });
          await page.locator(".desk-pop").waitFor();
          await sleep(600);
          await shoot(page, "after-desktop-popup-read");
          await ctx.close();
        }
        {
          const { ctx, page } = await open(paper, "phone", "light", { viewport: phone(844, 390) });
          await shoot(page, "after-landscape-phone-light");
          await ctx.close();
        }
      }
    } finally {
      await worker.stop();
    }
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
