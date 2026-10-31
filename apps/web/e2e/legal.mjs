// Browser e2e: the three text pages (How we verify, Privacy, Terms): they open, say they are drafts while details are missing, pass the
// accessibility scan in light and dark, fit a phone, and are linked from the footer.
//   node e2e/legal.mjs [baseUrl]    (default http://localhost:8788)
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.argv[2] ?? "http://localhost:8788";
const OUT = fileURLToPath(new URL("./shots/", import.meta.url));
mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401)/.test(m.text())) errors.push("console: " + m.text()); });

async function axe(label) {
  await page.evaluate(axeSource);
  const res = await page.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(" "), msg: v.nodes[0]?.failureSummary?.split("\n")[1] }));
  });
  ok(res.length === 0, `axe [${label}]: ${res.length ? "" : "no violations"}`);
  for (const v of res) console.log(`        ${v.impact} ${v.id} x${v.nodes} ${v.sample} :: ${v.msg}`);
}
const setTheme = async (label) => { await page.getByRole("button", { name: `${label} theme` }).click(); await page.waitForTimeout(500); };

const PAGES = [
  { path: "/how-we-verify", h1: "How we verify", must: [/No citation is ever written by AI/, /We do not say whether your idea is new/], shot: "90-how-we-verify" },
  { path: "/privacy", h1: "Privacy policy", must: [/What we keep/, /never sent to any other AI service/, /grievance/i], shot: "91-privacy" },
  { path: "/terms", h1: "Terms of use", must: [/Accuracy: please read this/, /You are responsible for what you cite/], shot: "92-terms" },
];

try {
  for (const p of PAGES) {
    console.log(p.path);
    await page.goto(BASE + p.path, { waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1, name: p.h1 }).waitFor();
    await page.waitForTimeout(700);
    const body = await page.locator(".legal").innerText();
    ok(p.must.every((re) => re.test(body)), "it says what it must");
    ok(/Sodhsetu/.test(await page.title()), "the page has its own title");
    ok(!/undefined|NaN|\[object/.test(body), "nothing is left unrendered");
    if (p.path !== "/how-we-verify") ok(await page.getByRole("note").filter({ hasText: "Draft" }).isVisible(), "while contact details are missing it says it is a draft, and marks each gap");
    await page.screenshot({ path: OUT + p.shot + ".png" });
    await axe(p.path);
    await setTheme("Dark");
    await axe(p.path + ", dark");
    await setTheme("Light");
  }

  console.log("the footer links");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  for (const [name, h1] of [["How we verify", "How we verify"], ["Privacy", "Privacy policy"], ["Terms", "Terms of use"]]) {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.getByRole("navigation", { name: "About" }).getByRole("link", { name }).click();
    await page.getByRole("heading", { level: 1, name: h1 }).waitFor();
    ok(true, `the footer opens ${name}`);
  }

  console.log("a phone");
  const mp = await ctx.newPage();
  await mp.setViewportSize({ width: 390, height: 800 });
  await mp.goto(BASE + "/privacy", { waitUntil: "networkidle" });
  await mp.getByRole("heading", { level: 1, name: "Privacy policy" }).waitFor();
  await mp.waitForTimeout(700);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `no horizontal scrolling on a phone (${overflow}px)`);
  await mp.screenshot({ path: OUT + "93-privacy-mobile.png" });
  await mp.close();

  ok(errors.length === 0, `no console/page errors${errors.length ? ": " + errors.join(" | ").slice(0, 500) : ""}`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
}
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall legal page browser checks passed");
process.exit(failures ? 1 : 0);
