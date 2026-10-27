// Browser check of how fast the first screen appears and whether it jumps (phase W6 budget). Edge with the processor four times slower and a slow 4G link
// (1.6 Mbit/s, 150 ms), the profile of docs/design/scroll-site.md, on the two first screens a person can meet: the intro page (signed out, "/") and the home screen
// ("/home" without signing in), on a desktop and on a phone. Layout shift is deterministic and held to the "good" line (0.1). The paint times depend on the machine,
// so they are held to a loose line that a real regression (an eager chunk, a blocking font) would cross, and are printed so the trend can be read.
// Needs the Worker: `npm run integration -w apps/api -- --browser` starts it.
//   node e2e/perf.mjs [baseUrl]    (default http://localhost:8788)
import { chromium } from "playwright-core";

const BASE = process.argv[2] ?? "http://localhost:8788";
/** The lines (ms and layout-shift score). Measured on 27 Oct 2026 on a development machine: see docs/design/w6.md. */
const LIMIT = { fcp: 4500, lcp: 5000, cls: 0.1 };

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });

async function measure(label, path, viewport, mobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.addInitScript(() => {
    const m = (window.__perf = { fcp: 0, lcp: 0, cls: 0, long: [] });
    const watch = (type, fn) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true }); } catch { /* not supported */ } };
    watch("paint", (e) => { if (e.name === "first-contentful-paint") m.fcp = e.startTime; });
    watch("largest-contentful-paint", (e) => { m.lcp = e.startTime; m.lcpEl = e.element ? `${e.element.tagName.toLowerCase()}${e.element.className ? "." + String(e.element.className).split(" ")[0] : ""}` : "?"; });
    m.shifts = [];
    watch("layout-shift", (e) => {
      if (e.hadRecentInput) return;
      m.cls += e.value;
      m.shifts.push(`${e.value.toFixed(3)} at ${Math.round(e.startTime)} ms: ${(e.sources ?? []).map((s) => (s.node ? `${s.node.nodeName.toLowerCase()}${s.node.className ? "." + String(s.node.className).split(" ")[0] : ""}` : "?")).join(", ")}`);
    });
    watch("longtask", (e) => m.long.push(e.duration));
  });
  await page.goto(BASE + path, { waitUntil: "load" });
  await page.waitForTimeout(3500);
  // the paint times are read before any scrolling: the browser stops counting largest paints at the reader's first input, and a block that fades in later must not stand in for the first screen
  const first = await page.evaluate(() => ({ fcp: window.__perf.fcp, lcp: window.__perf.lcp, lcpEl: window.__perf.lcpEl }));
  // then scroll the whole page the way a reader would, so a layout shift further down counts too
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += viewport.height / 2) { await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), y); await page.waitForTimeout(120); }
  await page.waitForTimeout(600);
  const m = { ...(await page.evaluate(() => window.__perf)), ...first };
  const longest = m.long.length ? Math.max(...m.long) : 0;
  console.log(`        ${label}: first paint ${Math.round(m.fcp)} ms, largest paint ${Math.round(m.lcp)} ms (${m.lcpEl}), layout shift ${m.cls.toFixed(3)}, longest task ${Math.round(longest)} ms (${m.long.length} over 50 ms)`);
  if (m.cls > 0.01) for (const s of m.shifts) console.log(`          shift ${s}`);
  ok(m.fcp > 0 && m.fcp <= LIMIT.fcp, `${label}: first contentful paint within ${LIMIT.fcp} ms`);
  ok(m.lcp > 0 && m.lcp <= LIMIT.lcp, `${label}: largest contentful paint within ${LIMIT.lcp} ms`);
  ok(m.cls <= LIMIT.cls, `${label}: layout shift ${m.cls.toFixed(3)} is within ${LIMIT.cls}`);
  await ctx.close();
}

try {
  await measure("intro, desktop", "/", { width: 1360, height: 900 }, false);
  await measure("intro, phone", "/", { width: 390, height: 844 }, true);
  await measure("home, desktop", "/home", { width: 1360, height: 900 }, false);
  await measure("home, phone", "/home", { width: 390, height: 844 }, true);
  await measure("check references, desktop (a page fetched on arrival)", "/verify", { width: 1360, height: 900 }, false);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
} finally {
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall first-paint checks passed");
  process.exit(failures ? 1 : 0);
}
