// Browser e2e for the polish of the paper reader (docs/design/ui-polish-1.md): the back button is a round arrow with no text (1), the drawing toolbar keeps Undo and Redo at the end of
// its row and has no divider left alone (2), the question box of the Ask panel and the other chat boxes show no scroll bar of the browser (3), the drawing toolbar's selected tool and its
// size dots are drawn calmly (7). Light, dark and read themes; 1280, 1024, 768 and 390 px; 100 and 200 percent zoom.
// Needs the Worker with the fake identity provider and the offline stand-ins: `npm run integration -w apps/api -- --browser` starts it.
//   node e2e/polish-reader.mjs [baseUrl]    (default http://localhost:8788)
// The browser is started WITH its scroll bars (Playwright hides them by default in a headless browser: a box that grows a bar would show nothing in a picture and take no room in a measurement).
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { startFakeIdp } from "../../api/scripts/fake-idp.mjs";
import { SAMPLE_PAPER, makePdf } from "@scholar/test-support/make-pdf.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.argv[2] ?? "http://localhost:8788";
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };
const note = (msg) => console.log(`        ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const idp = await startFakeIdp(Number(process.env.INTEGRATION_IDP_PORT ?? 9911));
idp.setUser({ sub: "polish-reader-1", email: "isha.m@example.edu", email_verified: true, name: "Isha M" });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true, ignoreDefaultArgs: ["--hide-scrollbars"] });
const errors = [];
const watch = (p) => {
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401|403|404|409|429|503)/.test(m.text())) errors.push("console: " + m.text()); });
};
const VP = {
  1280: { viewport: { width: 1280, height: 800 } },
  1024: { viewport: { width: 1024, height: 768 } },
  768: { viewport: { width: 768, height: 900 } },
  390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
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
const setTheme = (p, t) => p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), t);

/** Runs in the page: parses a computed colour (rgb, rgba, or color(srgb ...)) to [r, g, b, a] in 0..255. */
const colourParser = () => {
  window.__rgba = (s) => {
    const m = /^rgba?\(([^)]+)\)$/.exec(s);
    if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; }
    const c = /^color\(srgb ([^)]+)\)$/.exec(s);
    if (c) { const p = c[1].split(/[ /]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]; }
    return null;
  };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  window.__ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
};

try {
  /* ================================================================ sign in, one paper with a highlight (so that the Ask box says "or your highlights") */
  const c0 = await browser.newContext({ ...VP[1280] });
  const p0 = await c0.newPage();
  watch(p0);
  await p0.goto(BASE + "/", { waitUntil: "networkidle" });
  await p0.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
  await p0.getByRole("button", { name: "Continue with Google" }).last().click();
  await p0.locator("#hm-h").waitFor({ timeout: 20000 });
  await sleep(1200);
  await p0.goto(BASE + "/papers", { waitUntil: "networkidle" });
  const handled = p0.getByRole("region", { name: /how your papers are handled/ });
  if (await handled.count()) { await handled.getByRole("button", { name: "I understand, continue" }).click(); await handled.waitFor({ state: "detached", timeout: 8000 }); }
  await p0.locator('input[type="file"]').waitFor({ state: "attached" });
  await p0.locator('input[type="file"]').setInputFiles({ name: "glaucoma_screening.pdf", mimeType: "application/pdf", buffer: makePdf(SAMPLE_PAPER, { title: "Glaucoma screening" }) });
  await p0.locator(".dc").first().waitFor({ timeout: 40000 });
  await p0.waitForFunction(() => document.querySelector(".dc")?.getAttribute("data-status") === "ready", null, { timeout: 60000 });
  const docId = (await (await p0.request.get(BASE + "/api/v1/documents")).json()).items[0].id;
  const made = await p0.request.post(`${BASE}/api/v1/documents/${docId}/notes`, { headers: { Origin: BASE }, data: { page: 3, quote: "The model reached a sensitivity of 91 percent at a specificity of 88 percent", color: "green", note: "check this against the cataract subgroup" } });
  ok(made.ok(), "a paper and a highlight with a note exist (the Ask box then says: Ask the paper, or your highlights)");
  const state = await c0.storageState();
  await c0.close();

  const openReader = async (vp, { theme = "light", scale = 1 } = {}) => {
    const ctx = await browser.newContext({ ...VP[vp], ...(scale !== 1 ? { deviceScaleFactor: scale } : {}), storageState: state, colorScheme: "light" });
    await ctx.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch { /* no storage */ } }, theme);
    const page = await ctx.newPage();
    watch(page);
    await page.addInitScript(colourParser);
    await page.addInitScript(() => { window.__shifts = 0; window.__headShifts = 0; try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.hadRecentInput) return; window.__shifts += e.value; if ((e.sources ?? []).some((s) => s.node?.closest?.(".dw-head"))) window.__headShifts += e.value; })).observe({ type: "layout-shift", buffered: true }); } catch { /* not supported */ } });
    await page.goto(BASE + "/papers/" + docId, { waitUntil: "networkidle" });
    await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
    await sleep(700);
    return { ctx, page };
  };
  const openTools = async (page) => {
    await page.getByRole("button", { name: /^Draw$/ }).click();
    await page.getByRole("toolbar", { name: "Draw on the paper" }).waitFor();
    await sleep(700); // the toolbar's own opening animation
  };

  /* ================================================================ 1. the back button is a round arrow */
  console.log("1. the way back from a paper");
  for (const vp of [1280, 390]) {
    const { ctx, page } = await openReader(vp);
    const back = page.locator(".dw-head").getByRole("button", { name: /My Workspace/ });
    ok(await back.count() === 1, `${vp}: the paper's header has one button named for My Workspace (${await back.count()})`);
    const name = await back.getAttribute("aria-label");
    ok(name === "Back to My Workspace", `${vp}: its accessible name says where it goes ("${name}")`);
    ok((await back.innerText()).trim() === "", `${vp}: it shows no words (the text is "${(await back.innerText()).trim()}")`);
    ok((await back.getAttribute("title")) === "Back to My Workspace", `${vp}: it has a tooltip`);
    ok(await back.locator("svg[aria-hidden=true]").count() === 1, `${vp}: its picture is the arrow, hidden from a screen reader (the name is on the button)`);
    const box = await back.boundingBox();
    ok(box.width >= 40 && box.height >= 40 && Math.abs(box.width - box.height) < 1, `${vp}: it is a round button of at least 40 px (${box.width} by ${box.height})`);
    ok(await back.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius) >= el.getBoundingClientRect().width / 2 - 1), `${vp}: and it is round`);
    // focus ring: reached by the keyboard, it shows a ring
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("Tab");
    for (let i = 0; i < 6 && !(await back.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
    const ring = await back.evaluate((el) => { const s = getComputedStyle(el); return { outline: s.outlineStyle, w: parseFloat(s.outlineWidth), shadow: s.boxShadow }; });
    ok(await back.evaluate((el) => el === document.activeElement) && ((ring.outline !== "none" && ring.w >= 2) || /\dpx/.test(ring.shadow.replace(/rgba?\([^)]*\)/g, ""))), `${vp}: the keyboard reaches it and it shows a focus ring (${ring.outline} ${ring.w}px)`);
    // nothing in the header jumps once the paper is drawn
    const place = () => page.evaluate(() => ["dw-titles", "dw-head-end", "dw-back"].map((c) => { const r = document.querySelector("." + c)?.getBoundingClientRect(); return r ? [c, Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : [c]; }));
    const a = await place();
    await sleep(1200);
    const b = await place();
    ok(JSON.stringify(a) === JSON.stringify(b), `${vp}: nothing in the header moves after the paper is drawn (${JSON.stringify(a)})`);
    ok((await page.evaluate(() => window.__headShifts)) === 0, `${vp}: nothing in the header shifts while the paper opens (header shift ${(await page.evaluate(() => window.__headShifts)).toFixed(3)}; the whole page ${(await page.evaluate(() => window.__shifts)).toFixed(3)})`);
    for (const theme of ["light", "dark", "read"]) {
      await setTheme(page, theme);
      await sleep(350);
      await axe(`reader header, ${theme}, ${vp}`, page);
    }
    await back.click();
    await page.locator(".dc").first().waitFor({ timeout: 10000 });
    ok(new URL(page.url()).pathname === "/papers", `${vp}: pressing it goes back to My Workspace (${new URL(page.url()).pathname})`);
    await ctx.close();
  }

  /* ================================================================ 8 (the reader part). Home from an open paper: a new chat, and Back brings the paper back */
  console.log("8. Home from an open paper");
  {
    const { ctx, page } = await openReader(1280);
    await openTools(page);
    await page.getByRole("toolbar", { name: "Draw on the paper" }).getByRole("button", { name: /^Pen/ }).click();
    const sheet = page.locator('.pdfp[data-page="1"] .ink-pen');
    const bb = await sheet.boundingBox();
    await page.mouse.move(bb.x + 80, bb.y + 300);
    await page.mouse.down();
    await page.mouse.move(bb.x + 200, bb.y + 340, { steps: 8 });
    await page.mouse.up();
    await sleep(300);
    const here = new URL(page.url()).pathname;
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog").getByRole("combobox").fill("Home");
    await page.keyboard.press("Enter");
    await page.locator(".hm-title").waitFor({ timeout: 8000 });
    ok(new URL(page.url()).pathname === "/" && await page.locator(".chat-turn").count() === 0, "Home in the palette, with a paper open and a stroke just drawn: the empty Home, a new chat");
    await sleep(1200);
    await page.goBack();
    await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
    ok(new URL(page.url()).pathname === here, "Back brings the paper back, at the same address");
    await page.waitForFunction(() => document.querySelectorAll('.pdfp[data-page="1"] .ink path:not(.ink-live)').length >= 1, null, { timeout: 15000 }).catch(() => {});
    ok(await page.locator('.pdfp[data-page="1"] .ink path:not(.ink-live)').count() >= 1, "...with the stroke that was drawn just before (it was sent when the paper was left)");
    await ctx.close();
  }

  /* ================================================================ 2 and 7. the drawing toolbar */
  console.log("2. the drawing toolbar: Undo and Redo at the end of the row");
  const geometry = (page) => page.evaluate(() => {
    const bar = document.querySelector(".inkbar");
    const wrap = document.querySelector(".inkbar-wrap");
    const R = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height, cy: (b.top + b.bottom) / 2 }; };
    const buttons = [...bar.querySelectorAll("button, [role=status]")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const seps = [...bar.querySelectorAll(".inkbar-sep")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const named = (n) => bar.querySelector(`[aria-label="${n}"]`);
    const rows = [];
    for (const b of buttons.map(R).sort((x, y) => x.cy - y.cy)) { const row = rows.find((r) => Math.abs(r.cy - b.cy) < 8); if (row) row.n++; else rows.push({ cy: b.cy, n: 1 }); }
    return {
      bar: R(bar), wrap: R(wrap), buttons: buttons.map((el) => ({ ...R(el), label: el.getAttribute("aria-label") ?? el.textContent.trim().slice(0, 12) })), seps: seps.map(R), rows: rows.length,
      undo: R(named("Undo")), redo: R(named("Redo")), close: R(named("Close the drawing tools")),
      firstTool: R(bar.querySelector(".inkbar-tool")), lastTool: R([...bar.querySelectorAll(".inkbar-tool")].at(-1)),
      sizes: R(bar.querySelector('[role=radiogroup]')), colours: R(bar.querySelector(".inkbar-colors")),
      overflowX: getComputedStyle(wrap).overflowX, overflowY: getComputedStyle(wrap).overflowY, barOverflowX: getComputedStyle(bar).overflowX,
      scrollW: bar.scrollWidth, clientW: bar.clientWidth, scrollH: bar.scrollHeight, clientH: bar.clientHeight,
    };
  });
  const checkRow = (g, vp, label) => {
    const inside = g.buttons.every((b) => b.l >= g.bar.l - 1 && b.r <= g.bar.r + 1);
    ok(inside && g.scrollW <= g.clientW + 1, `${label}: every button is inside the toolbar and nothing needs a scroll bar (${Math.round(g.bar.w)} px wide, content ${g.scrollW})`);
    ok(!/auto|scroll/.test(g.overflowX + g.overflowY + g.barOverflowX) && g.scrollH <= g.clientH + 1, `${label}: the toolbar has no scroll bar of its own (${g.overflowX}/${g.overflowY}/${g.barOverflowX})`);
    // a divider with nothing beside it on its row is a loose line
    const loose = g.seps.filter((s) => { const here = g.buttons.filter((b) => Math.abs(b.cy - s.cy) < s.h / 2 + 4); return !here.some((b) => b.r <= s.l + 1) || !here.some((b) => b.l >= s.r - 1); });
    ok(loose.length === 0, `${label}: no divider stands alone at the end or the start of a row (${loose.length} of ${g.seps.length})`);
    // one row: the pair is to the right of every tool; two rows: it is at the end of the last row, to the right of the sizes and colours; the saved mark and the close button follow it on that row
    const lastRow = g.undo.cy;
    ok(g.rows === 1 ? g.undo.t < g.firstTool.t + 8 && g.undo.l > g.lastTool.r : g.undo.l > g.colours.r && Math.abs(g.undo.cy - g.colours.cy) < 8, `${label}: Undo and Redo are at the end of the ${g.rows === 1 ? "row" : "last row"}, to the side of the tools and colours (undo at ${Math.round(g.undo.l)},${Math.round(g.undo.t)}; the last tool ends at ${Math.round(g.lastTool.r)}, the colours at ${Math.round(g.colours.r)})`);
    ok(Math.abs(g.redo.t - g.undo.t) < 3 && g.redo.l > g.undo.l, `${label}: Redo is beside Undo`);
    ok(Math.abs(g.close.cy - lastRow) < 8 && g.close.l > g.redo.r, `${label}: and the close button follows them on that row`);
    const divided = g.seps.some((s) => Math.abs(s.cy - g.undo.cy) < s.h / 2 + 4 && s.r <= g.undo.l + 1 && s.l >= (g.rows === 1 ? g.lastTool.r : g.colours.r) - 1);
    ok(divided, `${label}: a divider stands between what comes before and the pair`);
  };
  for (const vp of [1280, 1024, 768]) {
    const { ctx, page } = await openReader(vp);
    await openTools(page);
    const g = await geometry(page);
    note(`${vp}: toolbar ${Math.round(g.bar.w)} px wide, ${g.rows} row(s), ${Math.round(g.bar.h)} px high`);
    checkRow(g, vp, `${vp}`);
    if (vp === 1280) ok(g.rows === 1, `1280: everything is on one row (${g.rows})`);
    await ctx.close();
  }
  {
    // the phone: nothing fits on one row, so what is best is decided and said; here it is held to the same rules except that the pair sits on the last row with the saved mark and the close button
    const { ctx, page } = await openReader(390);
    await openTools(page);
    const g = await geometry(page);
    note(`390: toolbar ${Math.round(g.bar.w)} px wide, ${g.rows} row(s), ${Math.round(g.bar.h)} px high`);
    const inside = g.buttons.every((b) => b.l >= g.bar.l - 1 && b.r <= g.bar.r + 1);
    ok(inside && g.scrollW <= g.clientW + 1 && !/auto|scroll/.test(g.overflowX + g.overflowY + g.barOverflowX), "390: every button is inside the toolbar and it has no scroll bar of its own");
    const loose = g.seps.filter((s) => { const here = g.buttons.filter((b) => Math.abs(b.cy - s.cy) < s.h / 2 + 4); return !here.some((b) => b.r <= s.l + 1) || !here.some((b) => b.l >= s.r - 1); });
    ok(loose.length === 0, `390: no divider stands alone at the end or the start of a row (${loose.length} of ${g.seps.length})`);
    ok(g.rows <= 3, `390: at most three rows (${g.rows})`);
    ok(Math.abs(g.undo.cy - g.close.cy) < 8 && g.undo.l < g.close.l, "390: Undo and Redo are on the same row as the saved mark and the close button, to the side of them, on the last row");
    const hit = g.buttons.filter((b) => b.label !== "Saved" && !/^(Saving|Loading|Offline|Updated|Not saved)/.test(b.label));
    ok(hit.every((b) => b.w >= 28 && b.h >= 28), `390: every button is at least 28 px (the smallest is ${Math.round(Math.min(...hit.map((b) => Math.min(b.w, b.h))))} px)`);
    await ctx.close();
  }
  {
    // the rule at every width: a window is made narrower and wider step by step and the toolbar is read each time
    const { ctx, page } = await openReader(1280);
    await openTools(page);
    let bad = 0;
    const seen = [];
    for (const w of [1600, 1440, 1360, 1280, 1180, 1100, 1024, 960, 860, 768, 680, 600, 520, 480, 430, 390, 360, 320]) {
      await page.setViewportSize({ width: w, height: 800 });
      await sleep(250);
      const g = await geometry(page);
      const inside = g.buttons.every((b) => b.l >= g.bar.l - 1 && b.r <= g.bar.r + 1) && g.scrollW <= g.clientW + 1;
      const loose = g.seps.filter((s) => { const here = g.buttons.filter((b) => Math.abs(b.cy - s.cy) < s.h / 2 + 4); return !here.some((b) => b.r <= s.l + 1) || !here.some((b) => b.l >= s.r - 1); }).length;
      const sideways = Math.abs(g.undo.cy - g.close.cy) < 8 && g.undo.l < g.close.l && (g.rows !== 1 || (g.undo.t < g.firstTool.t + 8 && g.undo.l > g.lastTool.r));
      seen.push(`${w}:${g.rows}${inside && !loose && sideways ? "" : "!"}`);
      if (!inside || loose || !sideways) bad++;
    }
    ok(bad === 0, `from 1600 to 320 px wide the toolbar always fits its box, never leaves a divider alone, and keeps the pair at the end of the last row, beside the close button (rows by width: ${seen.join(" ")})`);
    await ctx.close();
  }

  console.log("7. the look of the drawing toolbar");
  for (const theme of ["light", "dark", "read"]) {
    const { ctx, page } = await openReader(1280, { theme });
    await openTools(page);
    await setTheme(page, theme);
    await sleep(300);
    const bar = page.getByRole("toolbar", { name: "Draw on the paper" });
    // the selected tool
    await bar.getByRole("button", { name: /^Text box/ }).click();
    await sleep(500);
    const sel = await page.evaluate(() => {
      const btn = document.querySelector('.inkbar-tool[aria-pressed="true"]');
      const pill = btn.querySelector(".inkbar-pill");
      const cs = getComputedStyle(pill), br = pill.getBoundingClientRect();
      const wrapBg = getComputedStyle(document.querySelector(".inkbar-wrap")).backgroundColor;
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      const probe = document.createElement("span"); probe.style.color = accent; document.body.append(probe); const accentRgb = getComputedStyle(probe).color; probe.remove();
      const icon = getComputedStyle(btn.querySelector("svg")).color;
      return { radius: parseFloat(cs.borderTopLeftRadius), w: br.width, h: br.height, bg: cs.backgroundColor, accentRgb, wrapBg, icon, ratio: window.__ratio(window.__rgba(icon), window.__rgba(cs.backgroundColor)), pillOnBar: window.__ratio(window.__rgba(cs.backgroundColor), window.__rgba(wrapBg)) };
    });
    ok(sel.radius < Math.min(sel.w, sel.h) / 2 - 2 && sel.radius >= 6, `${theme}: the chosen tool sits in a rounded square, not a circle (corner ${sel.radius.toFixed(1)} px on ${sel.w.toFixed(0)} by ${sel.h.toFixed(0)})`);
    ok(sel.bg !== sel.accentRgb && sel.pillOnBar < 2.2, `${theme}: and it is a soft tint, not the strong accent (the tint is ${sel.pillOnBar.toFixed(2)}:1 against the bar; ${sel.bg} against ${sel.accentRgb})`);
    ok(sel.ratio >= 4.5, `${theme}: its icon is ${sel.ratio.toFixed(2)}:1 on the tint (at least 4.5 for the label that shows on a wide window, 3 for the icon)`);
    // the four sizes in the Text tool: letters, with no dark patch behind them
    const letters = await page.evaluate(() => [...document.querySelectorAll(".inkbar-aa")].map((el) => { const s = getComputedStyle(el); return { bg: s.backgroundColor, radius: s.borderTopLeftRadius, font: parseFloat(s.fontSize) }; }));
    ok(letters.length === 4 && letters.every((l) => /^rgba\(0, 0, 0, 0\)|^transparent/.test(l.bg) && l.radius === "0px"), `${theme}: the four text sizes are letters with no patch behind them (${letters.map((l) => l.bg).join(" | ")})`);
    ok(letters.every((l, i) => i === 0 || l.font > letters[i - 1].font), `${theme}: and they grow (${letters.map((l) => l.font.toFixed(1)).join(", ")} px)`);
    // the pen's sizes: clean circles of true relative size, a clear ring for the chosen one
    await bar.getByRole("button", { name: /^Pen/ }).click();
    await sleep(300);
    const dots = await page.evaluate(() => [...document.querySelectorAll(".inkbar-size")].map((b) => {
      const d = b.querySelector("span"); const r = d.getBoundingClientRect(); const cs = getComputedStyle(d); const bs = getComputedStyle(b);
      const wrapBg = getComputedStyle(document.querySelector(".inkbar-wrap")).backgroundColor;
      return { w: r.width, h: r.height, radius: cs.borderTopLeftRadius, bg: cs.backgroundColor, checked: b.getAttribute("aria-checked") === "true", ring: bs.borderTopWidth, ringColour: bs.borderTopColor, shadow: bs.boxShadow, tile: bs.backgroundColor, onBar: window.__ratio(window.__rgba(cs.backgroundColor), window.__rgba(bs.backgroundColor === "rgba(0, 0, 0, 0)" ? wrapBg : bs.backgroundColor)), ringOnBar: (() => { const m = /^(rgba?\([^)]*\)|color\([^)]*\))/.exec(bs.boxShadow); return m && window.__rgba(m[1]) ? window.__ratio(window.__rgba(m[1]), window.__rgba(bs.backgroundColor === "rgba(0, 0, 0, 0)" ? wrapBg : bs.backgroundColor)) : 0; })() };
    }));
    ok(dots.length === 4 && dots.every((d) => Math.abs(d.w - d.h) < 0.01 && d.w === Math.round(d.w)), `${theme}: the four dots are circles of whole pixels (${dots.map((d) => `${d.w}x${d.h}`).join(", ")})`);
    ok(dots.every((d, i) => i === 0 || d.w > dots[i - 1].w), `${theme}: and each is bigger than the one before`);
    const TRUE = [0.0018, 0.0034, 0.006, 0.011]; // PEN_WIDTH in packages/shared/src/ink.ts
    ok(dots.every((d, i) => Math.abs(d.w / dots[3].w - TRUE[i] / TRUE[3]) < 0.1), `${theme}: their sizes keep the proportions of the real pen widths (${dots.map((d) => (d.w / dots[3].w).toFixed(2)).join(", ")} against ${TRUE.map((w) => (w / TRUE[3]).toFixed(2)).join(", ")})`);
    ok(dots.every((d) => /50%|^(\d+(\.\d+)?)px$/.test(d.radius) && (d.radius === "50%" || parseFloat(d.radius) >= d.w / 2)), `${theme}: they are round`);
    ok(dots.filter((d) => d.checked).length === 1 && dots.filter((d) => parseFloat(d.ring) >= 1.5 || /\d+px/.test(d.shadow.replace(/rgba?\([^)]*\)|color\([^)]*\)/g, ""))).length >= 1, `${theme}: one is chosen and it has a ring`);
    const chosen = dots.find((d) => d.checked), other = dots.find((d) => !d.checked);
    ok(chosen.ringOnBar >= 3, `${theme}: the ring is ${chosen.ringOnBar.toFixed(2)}:1 against the tint inside it (3 for a shape); the others have none (${other.shadow})`);
    ok(dots.every((d) => d.onBar >= 3), `${theme}: every dot is at least 3:1 against what is under it (${dots.map((d) => d.onBar.toFixed(1)).join(", ")})`);
    // unchosen tools: the words and icons are at least 4.5:1 on the bar
    const tools = await page.evaluate(() => [...document.querySelectorAll(".inkbar-tool[aria-pressed=false]")].map((b) => window.__ratio(window.__rgba(getComputedStyle(b).color), window.__rgba(getComputedStyle(document.querySelector(".inkbar-wrap")).backgroundColor))));
    ok(tools.every((r) => r >= 4.5), `${theme}: the tools that are not chosen are at least 4.5:1 on the bar (the lowest is ${Math.min(...tools).toFixed(2)})`);
    await axe(`drawing toolbar, ${theme}, 1280`, page);
    await ctx.close();
  }
  {
    // 200 percent: the circles are still circles and still whole pixels, and a window that is 390 wide with the tools open is checked by axe too
    const { ctx, page } = await openReader(1280, { scale: 2 });
    await openTools(page);
    await page.getByRole("toolbar", { name: "Draw on the paper" }).getByRole("button", { name: /^Pen/ }).click();
    await sleep(300);
    const dots = await page.evaluate(() => [...document.querySelectorAll(".inkbar-size span")].map((d) => { const r = d.getBoundingClientRect(); return [r.width, r.height]; }));
    ok(dots.every(([w, h]) => Math.abs(w - h) < 0.01 && w * 2 === Math.round(w * 2)), `200%: the dots are circles on whole device pixels (${dots.map(([w]) => w).join(", ")})`);
    await ctx.close();
    const m = await openReader(390, { theme: "dark" });
    await openTools(m.page);
    await axe("drawing toolbar, dark, 390", m.page);
    await m.ctx.close();
  }

  /* ================================================================ 3. the Ask box has no scroll bar of the browser */
  console.log("3. the question box of a paper");
  for (const vp of [1280, 390]) {
    const { ctx, page } = await openReader(vp);
    if (vp === 390) await page.getByRole("tab", { name: /^Ask/ }).click();
    const ta = page.locator("#ask-input");
    await ta.waitFor();
    await sleep(500);
    const metrics = () => ta.evaluate((el) => { const cs = getComputedStyle(el); return { h: el.getBoundingClientRect().height, client: el.clientHeight, scroll: el.scrollHeight, gutter: el.offsetWidth - el.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth), sb: cs.scrollbarWidth, wk: getComputedStyle(el, "::-webkit-scrollbar").display, max: parseFloat(cs.maxHeight) }; });
    let m = await metrics();
    ok(/or your highlights/.test(await ta.getAttribute("placeholder")), `${vp}: the box says "${await ta.getAttribute("placeholder")}"`);
    ok(m.scroll <= m.client, `${vp}: empty, nothing in it overflows (text ${m.scroll} px in a box of ${m.client} px)`);
    ok(m.gutter === 0 && m.sb === "none", `${vp}: it takes no room for a scroll bar and says none is wanted (gutter ${m.gutter}, scrollbar-width ${m.sb})`);
    ok(m.wk === "none", `${vp}: nor does the webkit scroll bar show (${m.wk})`);
    // grows with its text: one to six lines
    await ta.focus();
    const heights = [];
    let grew = true;
    for (let line = 1; line <= 6; line++) {
      if (line > 1) await page.keyboard.press("Shift+Enter");
      await page.keyboard.type(`line ${line}`);
      m = await metrics();
      heights.push(Math.round(m.h));
      if (m.h < m.max - 1 && (m.scroll > m.client || m.gutter !== 0)) { grew = false; note(`${vp}: ${line} line(s): the box is ${m.client} px and its text ${m.scroll} px (gutter ${m.gutter})`); }
    }
    ok(grew && heights.every((h, i) => i === 0 || h >= heights[i - 1]) && heights.at(-1) > heights[0], `${vp}: it grows with its text and, below its largest size, never holds more than it shows (${heights.join(", ")} px)`);
    // past its maximum it stops growing, shows no bar, and still scrolls by the wheel and by the keyboard
    for (let line = 7; line <= 14; line++) { await page.keyboard.press("Shift+Enter"); await page.keyboard.type(`line ${line}`); }
    m = await metrics();
    ok(m.h <= m.max + 1 && m.scroll > m.client && m.gutter === 0, `${vp}: at its largest (${Math.round(m.h)} px) it holds more text than it shows (${m.scroll} px) and still shows no bar (gutter ${m.gutter})`);
    await ta.evaluate((el) => { el.scrollTop = 0; });
    const box = await ta.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 120);
    await sleep(150);
    const top1 = await ta.evaluate((el) => el.scrollTop);
    ok(top1 > 0, `${vp}: the wheel scrolls it (scrollTop ${top1})`);
    await ta.evaluate((el) => { el.setSelectionRange(0, 0); el.scrollTop = 0; });
    await ta.focus();
    await page.keyboard.press("Control+End");
    await sleep(100);
    ok(await ta.evaluate((el) => el.scrollTop > 0 && el.scrollHeight - (el.scrollTop + el.clientHeight) <= 14), `${vp}: Ctrl+End takes the caret, and the text, to the end`);
    // Enter sends and Shift+Enter writes a new line (as before)
    const before = await ta.inputValue();
    ok(before.includes("\n") && before.split("\n").length === 14, `${vp}: Shift+Enter made new lines (${before.split("\n").length})`);
    await ta.fill("What methods were used?");
    await ta.press("Enter");
    await page.locator(".ask-q").first().waitFor({ timeout: 15000 });
    ok(await ta.inputValue() === "" && await page.locator(".ask-q").count() >= 1, `${vp}: Enter sends the question`);
    await sleep(600);
    m = await metrics();
    ok(m.scroll <= m.client && m.h < 70, `${vp}: and the box is small again (${Math.round(m.h)} px)`);
    await ctx.close();
  }
} catch (e) {
  failures++;
  console.log(` FAIL unexpected: ${e.stack?.split("\n").slice(0, 4).join(" | ")}`);
} finally {
  ok(errors.length === 0, `no page error and no console error (${errors.length ? errors[0].slice(0, 120) : "none"})`);
  await browser.close();
  idp.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
