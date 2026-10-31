// Browser e2e for the pictures drawn by Rive files (docs/design/setu-rive.md, rive-ideas.md): the bridge laid while a literature scan runs, the box of the upload zone, the scene beside an upload.
// What is checked: they come from the real runtime and the real files and are drawn; the page tells them the right things (the data-state of each, from the real scan and the real upload);
// they follow the page's colours when the theme changes; nothing moves when they arrive; a drawing that has settled stops changing; and the page is whole without them: with reduced motion,
// with Save-Data, on a 2g connection, without WebAssembly, and when the runtime cannot be fetched. And that none of it is in the first load.
// Needs the Worker with the fake identity provider and the offline stand-ins: `npm run integration -w apps/api -- --browser` starts it.
//   node e2e/rive.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { SAMPLE_PAPER, makePdf } from "../../api/scripts/lib/make-pdf.mjs";
import { startFakeIdp } from "../../api/scripts/fake-idp.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.argv[2] ?? "http://localhost:8788";
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "rive-ui-1", email: "rhea.k@example.edu", email_verified: true, name: "Rhea K" });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
const errors = [];
const watch = (p, allow = /^$/) => {
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401|403|404|409)/.test(m.text()) && !allow.test(m.text())) errors.push("console: " + m.text()); });
};
/** The addresses of what the page fetched that belong to the Rive runtime or its files. */
const watchRive = (p) => {
  const seen = [];
  p.on("request", (r) => { if (/\/assets\/rive-[\w-]+\.(js|wasm)|\.riv(\?|$)|\/assets\/(setu|reading|drop)-[\w-]+\.riv/.test(r.url())) seen.push(new URL(r.url()).pathname.split("/").pop()); });
  return seen;
};

async function axe(label, p) {
  await p.evaluate(axeSource);
  const res = await p.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(" "), msg: v.nodes[0]?.failureSummary?.split("\n")[1] }));
  });
  ok(res.length === 0, `axe [${label}]`);
  for (const v of res) console.log(`        ${v.impact} ${v.id} x${v.nodes} ${v.sample} :: ${v.msg}`);
}
const setTheme = async (p, t) => { await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), t); await sleep(1300); };
async function signIn(page) {
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
  await page.getByRole("button", { name: "Continue with Google" }).last().click();
  await page.locator("#hm-h").waitFor({ timeout: 20000 });
}
/** The state the page told a picture, from its own attribute. */
const told = async (page, sel) => JSON.parse((await page.locator(sel).first().getAttribute("data-state")) ?? "{}");
/** The drawing as it is now, as text, to see whether it changed. */
const drawing = (page, sel) => page.evaluate((sel) => document.querySelector(sel + " canvas")?.toDataURL() ?? "", sel);
/** How many opaque pixels of the drawing are near a colour. */
const near = (page, sel, [r, g, b], tol = 36) =>
  page.evaluate(([sel, r, g, b, tol]) => {
    const c = document.querySelector(sel + " canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) < tol) n++;
    return n;
  }, [sel, r, g, b, tol]);
const opaque = (page, sel) =>
  page.evaluate((sel) => {
    const c = document.querySelector(sel + " canvas");
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 40) n++;
    return n;
  }, sel);
const LIGHT_ACCENT = [0x35, 0x48, 0xc8];
const DARK_ACCENT = [0x93, 0xa6, 0xff];

try {
  /* ============================ none of it in the first load ============================ */
  console.log("the first load");
  {
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const page = await ctx.newPage();
    watch(page);
    const seen = watchRive(page);
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.locator("#in-h1").waitFor({ timeout: 10000 });
    await sleep(800);
    ok(seen.length === 0, `the intro page fetches no Rive runtime or file${seen.length ? " (" + seen.join(", ") + ")" : ""}`);
    await ctx.close();
  }

  /* ============================ the bridge, in a real scan ============================ */
  console.log("the bridge while a scan runs");
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  watch(page);
  const seen = watchRive(page);
  await signIn(page);
  ok(seen.length === 0, "...and the home page after signing in fetches none either");
  await page.locator(".ws-rail").getByRole("link", { name: "Literature scan" }).click();
  await page.getByRole("heading", { name: "Literature scan", level: 1 }).waitFor();
  ok(seen.length === 0, "...nor does the scan's own input page");

  /** Plans and starts a scan of four themes; `edits` change a theme (0 to 3) before it starts. */
  async function startScan(edits) {
    await page.getByLabel("What do you want to know about?").fill("air pollution and childhood asthma");
    const ack = page.getByRole("button", { name: "I understand, continue" });
    if (await ack.count()) await ack.click();
    await page.getByRole("button", { name: "Plan the scan" }).click();
    await page.getByRole("heading", { name: "air pollution and childhood asthma", level: 2 }).waitFor({ timeout: 20000 });
    for (const [i, question, words] of edits) {
      await page.getByRole("button", { name: new RegExp(`^Edit theme ${i + 1}:`) }).click();
      await page.locator(".ls-theme").nth(i).getByLabel("Answered as the question").fill(question);
      await page.locator(".ls-theme").nth(i).getByLabel(/^Search words/).fill(words);
      await page.locator(".ls-theme").nth(i).getByRole("button", { name: "Done" }).click();
    }
    return page.getByRole("button", { name: /^Start the review/ });
  }

  // scan A: one theme is slow (the stand-in waits on the word "snail"), so the scan stays running long enough to look at; every theme ends answered
  const startA = await startScan([[0, "snail how strong is the link?", "air pollution asthma"]]);
  ok(seen.length === 0, "...nor does the plan the person approves");
  await startA.click();
  await page.locator(".ls-progress").waitFor({ timeout: 20000 });

  const bridge = ".setu";
  const early = await page.locator(bridge).first().boundingBox();
  await page.waitForSelector(`${bridge}[data-ready="true"]`, { timeout: 25000 });
  const placed = await page.locator(bridge).first().boundingBox();
  ok(early !== null && placed !== null && Math.abs(early.height - placed.height) < 1 && Math.abs(early.width - placed.width) < 1, `the bridge's box has its final size before it is drawn (${early && Math.round(early.width)}x${early && Math.round(early.height)}), so nothing moves when it arrives`);
  ok(placed !== null && Math.abs(placed.width / placed.height - 640 / 118) < 0.05, "...and the shape of its artboard");
  ok((await page.locator(bridge).first().getAttribute("aria-hidden")) === "true", "it is hidden from screen readers (the bar, the count and the tiles carry every fact)");
  ok(await page.locator(".ls-progress").isVisible() && await page.locator(".ls-tile").count() === 4, "...and they are all still there");
  ok(seen.some((s) => /^rive-.*\.wasm$/.test(s)) && seen.some((s) => /^setu-.*\.riv$/.test(s)), "the runtime and the bridge's file were fetched only now, when a scan is on the page");
  await sleep(600);
  ok((await opaque(page, bridge)) > 1500, "something is drawn on the canvas (planks and piers)");

  let s0 = await told(page, bridge);
  ok(["p1", "p2", "p3", "p4", "p5", "p6"].every((k) => typeof s0[k] === "number") && s0.cross === false, `it is told six numbers and a crossing (${JSON.stringify(s0)})`);
  ok(s0.p5 === 0 && s0.p6 === 0, "the planks the plan does not have are told 0");
  // a theme being worked on breathes, so the drawing changes while the scan runs
  const a = await drawing(page, bridge);
  await sleep(700);
  const b = await drawing(page, bridge);
  ok(a !== b, "while a theme is being worked on the picture moves");
  ok(await near(page, bridge, LIGHT_ACCENT) > 0, "its colour is the page's accent (light)");
  await setTheme(page, "dark");
  ok(await near(page, bridge, DARK_ACCENT) > 0 && await near(page, bridge, LIGHT_ACCENT) === 0, "the theme changes while it runs: it is drawn in the dark theme's accent, not the light one's");
  await setTheme(page, "light");
  await axe("the scan running, with the bridge", page);

  await page.locator(".eyebrow", { hasText: "Finished" }).waitFor({ timeout: 60000 });
  await sleep(1000);
  s0 = await told(page, bridge);
  ok([s0.p1, s0.p2, s0.p3, s0.p4].join() === "3,3,3,3" && s0.p5 === 0 && s0.p6 === 0, `at the end every theme is answered (3) (${[s0.p1, s0.p2, s0.p3, s0.p4].join(",")})`);
  ok(s0.cross === true, "with every theme answered the question crosses");
  ok(await page.locator(bridge).count() === 1, "the bridge stays for a scan that was watched to its end");
  await sleep(3600); // the crossing takes about 2.4 s; then the drawing stops
  const still1 = await drawing(page, bridge);
  await sleep(700);
  ok(still1 === (await drawing(page, bridge)), "...and once the crossing is done and settled the drawing no longer changes (it has stopped)");
  ok(await near(page, bridge, LIGHT_ACCENT) > 500, "the planks are drawn in the accent");

  // scan B: two themes end without a paper (gaps)
  await page.goto(BASE + "/literature-scan", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Literature scan", level: 1 }).waitFor();
  const startB = await startScan([[1, "nothing found for this one?", "nothing words here"], [2, "unanswerable question?", "unanswerable words"]]);
  await startB.click();
  await page.locator(".ls-progress").waitFor({ timeout: 20000 });
  await page.waitForSelector(`${bridge}[data-ready="true"]`, { timeout: 25000 });
  await page.locator(".eyebrow", { hasText: "Finished" }).waitFor({ timeout: 60000 });
  await sleep(1200);
  s0 = await told(page, bridge);
  const ps = [s0.p1, s0.p2, s0.p3, s0.p4];
  ok(ps.join() === "3,4,4,3" && s0.p5 === 0 && s0.p6 === 0, `at the end two themes are answered (3) and two are gaps (4), as the review says (${ps.join(",")})`);
  ok(s0.cross === false, "with a gap the question does not cross: it stays on its bank");
  await sleep(3600);
  const g1 = await drawing(page, bridge);
  await sleep(700);
  ok(g1 === (await drawing(page, bridge)), "...and the drawing has stopped");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 2 }).first().waitFor();
  await sleep(1200);
  ok(await page.locator(bridge).count() === 0, "a finished scan opened later shows no bridge");

  /* ============================ the upload zone and the reading scene ============================ */
  console.log("the upload zone");
  await page.goto(BASE + "/papers", { waitUntil: "networkidle" });
  const note = page.getByRole("region", { name: /how your papers are handled/ });
  if (await note.count()) await note.getByRole("button", { name: "I understand, continue" }).click();
  await page.waitForSelector('.uz-scene[data-ready="true"]', { timeout: 25000 });
  const zoneBox = await page.locator(".uz-scene-box").boundingBox();
  ok(zoneBox !== null && Math.abs(zoneBox.width - 78) < 1 && Math.abs(zoneBox.height - 65) < 1, "the zone's box is reserved at its final size");
  ok((await page.locator(".uz-scene").first().getAttribute("aria-hidden")) === "true", "the picture is hidden from screen readers");
  ok(await page.getByRole("button", { name: /Upload PDF papers/ }).isEnabled(), "the zone is still a plain button with its label");
  await sleep(2600); // let it settle and stop
  const closed = await drawing(page, ".uz-scene");
  let z = await told(page, ".uz-scene");
  ok(z.over === false && z.drop === false && z.off === false, `at rest it is told nothing is over it (${JSON.stringify(z)})`);

  const dt = await page.evaluateHandle(() => new DataTransfer());
  await page.dispatchEvent(".uz", "dragenter", { dataTransfer: dt });
  await sleep(900);
  z = await told(page, ".uz-scene");
  const open = await drawing(page, ".uz-scene");
  ok(z.over === true && z.drop === false, `a file carried over it is told (${JSON.stringify(z)})`);
  ok(open !== closed, "...and the lid opens (the drawing changes)");
  await page.dispatchEvent(".uz", "dragleave", { dataTransfer: dt });
  await sleep(1500);
  z = await told(page, ".uz-scene");
  ok(z.over === false && (await drawing(page, ".uz-scene")) === closed, "carried away again, it closes and is as it was");

  // drop a real PDF, with the upload held back so that the scene beside it can be watched
  await page.route("**/api/v1/documents", async (route) => { if (route.request().method() === "POST") await sleep(6500); await route.continue(); });
  const file = makePdf(SAMPLE_PAPER, { title: "Glaucoma screening" });
  const dropDt = await page.evaluateHandle(({ bytes }) => {
    const d = new DataTransfer();
    d.items.add(new File([new Uint8Array(bytes)], "glaucoma_screening.pdf", { type: "application/pdf" }));
    return d;
  }, { bytes: [...file] });
  await page.dispatchEvent(".uz", "dragenter", { dataTransfer: dropDt });
  await sleep(400);
  await page.dispatchEvent(".uz", "drop", { dataTransfer: dropDt });
  await sleep(250);
  z = await told(page, ".uz-scene");
  ok(z.drop === true && z.over === false, `a drop is told as a drop, not as a file carried away (${JSON.stringify(z)})`);
  await sleep(1900);
  z = await told(page, ".uz-scene");
  ok(z.drop === false, "...and the drop is over after about a second");

  console.log("the scene beside an upload");
  await page.locator(".job").first().waitFor({ timeout: 15000 });
  await page.waitForSelector('.job-scene .rive-piece[data-ready="true"]', { timeout: 25000 });
  const jobBox = await page.locator(".job-scene").first().boundingBox();
  ok(jobBox !== null && Math.abs(jobBox.width - 52) < 1 && Math.abs(jobBox.height - 52) < 1, "the scene's box beside the file's name is 52 px, reserved from the first paint");
  ok(await near(page, ".job-scene .rive-piece", LIGHT_ACCENT) > 0, "the scene is drawn in the page's accent");
  await setTheme(page, "dark");
  ok(await near(page, ".job-scene .rive-piece", DARK_ACCENT) > 0 && await near(page, ".job-scene .rive-piece", LIGHT_ACCENT) === 0, "...and follows the theme (dark) while the upload runs");
  await axe("the papers page with its pictures, dark, an upload running", page);
  await setTheme(page, "light");
  await axe("the papers page with its pictures, an upload running", page);
  const modes = new Set();
  let lastProgress = -1;
  let monotonic = true;
  for (let i = 0; i < 260; i++) {
    const st = await told(page, ".job-scene .rive-piece").catch(() => ({}));
    if (typeof st.mode === "number") {
      modes.add(st.mode);
      if (st.progress + 1e-9 < lastProgress) monotonic = false;
      lastProgress = st.progress;
    }
    if (st.mode === 3) break;
    await sleep(120);
  }
  ok(modes.has(1) && modes.has(3), `it is told the steps as they come: uploading and done (modes seen: ${[...modes].sort().join(",")})`);
  ok(monotonic && Math.abs(lastProgress - 1) < 1e-9, `...and how far along the job is never goes back, and ends at the whole ring (${lastProgress})`);
  await page.locator(".job").first().waitFor({ state: "detached", timeout: 8000 });
  ok(true, "a finished upload leaves the list by itself (about a second and a half after the check), and its scene with it");
  ok(await page.locator(".job-scene").count() === 0 && (await page.locator('.uz-scene[data-ready="true"]').count()) === 1, "...while the zone's own picture stays");
  ok((await opaque(page, ".uz-scene")) > 500, "the box in the zone is drawn");
  await axe("the papers page with its pictures, done", page);
  await setTheme(page, "dark");
  ok(await near(page, ".uz-scene", DARK_ACCENT) > 0, "the zone's picture follows the theme too (dark)");
  await setTheme(page, "light");
  await page.unroute("**/api/v1/documents");
  await ctx.close();

  /* ============================ the page is whole without the pictures ============================ */
  console.log("the page without the pictures");
  const cases = [
    ["with reduced motion", { reducedMotion: "reduce" }, null],
    ["with Save-Data on", {}, () => Object.defineProperty(navigator, "connection", { value: { saveData: true, effectiveType: "4g" }, configurable: true })],
    ["on a 2g connection", {}, () => Object.defineProperty(navigator, "connection", { value: { saveData: false, effectiveType: "2g" }, configurable: true })],
    ["without WebAssembly", {}, () => { delete window.WebAssembly; }],
  ];
  for (const [label, options, init] of cases) {
    const c = await browser.newContext({ viewport: { width: 1360, height: 900 }, ...options });
    if (init) await c.addInitScript(init);
    const p = await c.newPage();
    watch(p);
    const seenHere = watchRive(p);
    await signIn(p);
    await p.goto(BASE + "/papers", { waitUntil: "networkidle" });
    await p.getByRole("button", { name: /Upload PDF papers/ }).waitFor();
    await sleep(1500);
    ok((await p.locator(".uz-scene-box").count()) === 0 && (await p.locator(".uz-ico").count()) === 1 && seenHere.length === 0, `${label}: the upload zone keeps its own icon, there is no picture and nothing of Rive was fetched`);
    ok(await p.getByRole("button", { name: /Upload PDF papers/ }).isEnabled(), `${label}: ...and the zone works`);
    await c.close();
  }
  {
    // allowed, but the runtime cannot be fetched
    const c = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    const p = await c.newPage();
    // the runtime says so in the console when it cannot start (this one is meant to fail), and then asks a CDN for its own fallback, which the CSP refuses
    watch(p, /Failed to load resource|ERR_|wasm streaming compile failed|falling back to ArrayBuffer|failed to asynchronously prepare wasm|Failed to fetch|Aborted\(|jsdelivr|Content Security Policy/);
    await p.route(/\/assets\/rive-[\w-]+\.wasm/, (route) => route.abort());
    await signIn(p);
    await p.goto(BASE + "/papers", { waitUntil: "networkidle" });
    await p.getByRole("button", { name: /Upload PDF papers/ }).waitFor();
    await sleep(3000);
    ok((await p.locator(".uz-ico").count()) === 1 && (await p.locator('.uz-scene[data-ready="true"]').count()) === 0, "when the runtime cannot be fetched the zone still shows its own icon, and no picture");
    ok(await p.getByRole("button", { name: /Upload PDF papers/ }).isEnabled() && (await p.locator("canvas").count()) === 0, "...and works (no empty box is left)");
    await c.close();
  }

  ok(errors.length === 0, `no errors in the browser console${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
}
idp.close();
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall Rive picture checks passed");
process.exit(failures ? 1 : 0);
