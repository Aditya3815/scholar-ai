// Run order: node render.mjs; python degrade.py; (cd worker && wrangler dev --port 8799); node run.mjs; python score.py
// Renders each page of pages.json as a clean PNG (150 dpi A4) with Edge, so Devanagari is shaped correctly.
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../../../apps/web/package.json", import.meta.url));
const { chromium } = require("playwright-core");
const HERE = fileURLToPath(new URL(".", import.meta.url));
const pages = JSON.parse(readFileSync(HERE + "pages.json", "utf8"));
mkdirSync(HERE + "clean", { recursive: true });

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 794, height: 1123 }, deviceScaleFactor: 1.5625 }); // 96 css dpi x 1.5625 = 150 dpi
const page = await ctx.newPage();
for (const p of pages) {
  const body = p.paragraphs.map((t) => `<p>${esc(t)}</p>`).join("");
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:96px 84px;background:#fff;color:#111;font-family:"${p.font}",serif;font-size:${p.lang === "en" ? 15 : 16}px;line-height:1.7;text-align:justify}
    p{margin:0 0 14px}</style>${body}`);
  await page.screenshot({ path: HERE + `clean/${p.id}.png`, clip: { x: 0, y: 0, width: 794, height: 1123 } });
  console.log("rendered", p.id);
}
await browser.close();
