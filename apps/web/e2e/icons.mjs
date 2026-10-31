// Browser e2e for the motion of the icons the app already has (docs/design/icon-motion.md, styles/icons.css).
// The rules are written for the classes Lucide puts on its svg (`lucide lucide-<name>`), so this builds buttons with exactly those classes, in the page with the app's real styles, and reads what the
// browser computes: what each icon does when hovered, focused with the keyboard, pressed; that nothing moves when it is disabled, not pressable, on a touch screen, or with reduced motion; and that
// no layout changes. One real icon of the app (the intro's Sign in) is checked too.
//   node e2e/icons.mjs [baseUrl]    (default http://localhost:8788)
import { chromium } from "playwright-core";

const BASE = process.argv[2] ?? "http://localhost:8788";
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
const errors = [];
const watch = (page) => {
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401|403|404|409)/.test(m.text())) errors.push("console: " + m.text()); });
};

/** A button (or something else) with one Lucide-classed svg in it, the way the app writes them. */
const svg = (name, extra = "") => `<svg class="lucide lucide-${name}" ${extra} xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 7"/><path d="M5 5h14"/></svg>`;
const ICONS = ["arrow-right", "arrow-up", "arrow-left", "plus", "x", "search", "trash-2", "info", "bell", "download", "eye", "check", "copy", "bookmark", "bookmark-check", "chevron-down"];
const FIXTURE = `<div id="fx" style="position:fixed;left:20px;top:20px;z-index:99999;background:#fff;padding:12px;display:grid;grid-template-columns:repeat(6,56px);gap:10px">
  ${ICONS.map((n) => `<button type="button" class="btn btn-ghost btn-sm" data-i="${n}" style="min-width:56px;padding:0">${svg(n)}</button>`).join("")}
  <button type="button" class="btn btn-ghost btn-sm" data-i="disabled" disabled style="min-width:56px;padding:0">${svg("arrow-right")}</button>
  <button type="button" class="btn btn-ghost btn-sm" data-i="aria-disabled" aria-disabled="true" style="min-width:56px;padding:0">${svg("arrow-right")}</button>
  <button type="button" class="btn btn-ghost btn-sm" data-i="pressed-bell" aria-pressed="true" style="min-width:56px;padding:0">${svg("bell")}</button>
  <button type="button" class="btn btn-ghost btn-sm" data-i="pressed-bookmark" aria-pressed="true" style="min-width:56px;padding:0">${svg("bookmark")}</button>
  <h2 data-i="heading" style="margin:0;display:grid;place-items:center">${svg("arrow-right")}</h2>
  <a data-i="link" href="#x" style="display:grid;place-items:center">${svg("arrow-right")}</a>
</div>`;

const matrix = (t) => (t === "none" ? [1, 0, 0, 1, 0, 0] : t.replace(/matrix\(|\)/g, "").split(",").map(Number));
const near = (a, b, tol = 0.02) => Math.abs(a - b) <= tol;
const tf = (page, i, sel = "svg") => page.evaluate(([i, sel]) => getComputedStyle(document.querySelector(`#fx [data-i="${i}"] ${sel}`)).transform, [i, sel]);
const css = (page, i, prop, sel = "svg") => page.evaluate(([i, prop, sel]) => getComputedStyle(document.querySelector(`#fx [data-i="${i}"] ${sel}`))[prop], [i, prop, sel]);
const rect = (page, i) => page.evaluate((i) => { const r = document.querySelector(`#fx [data-i="${i}"]`).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 100) / 100); }, i);

async function open(ctxOptions) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 600 }, ...ctxOptions });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator("#in-h1").waitFor({ timeout: 10000 });
  await page.evaluate((html) => document.body.insertAdjacentHTML("beforeend", html), FIXTURE);
  return { ctx, page };
}

try {
  /* ============================ motion allowed, a mouse ============================ */
  console.log("with a mouse, motion allowed");
  {
    const { ctx, page } = await open({});
    const hover = async (i) => { await page.locator(`#fx [data-i="${i}"]`).hover(); await page.waitForTimeout(420); };
    const away = async () => { await page.mouse.move(700, 500); await page.waitForTimeout(350); };

    ok(matrix(await tf(page, "arrow-right"))[4] === 0, "at rest an icon does not move");
    const before = await rect(page, "arrow-right");

    await hover("arrow-right");
    const m = matrix(await tf(page, "arrow-right"));
    ok(near(m[4], 3, 0.1) && near(m[5], 0), `an arrow nudges 3 px along its way on hover (matrix ${m.map((n) => +n.toFixed(2))})`);
    ok((await rect(page, "arrow-right")).join() === before.join(), "...and the button does not move or change size (nothing is laid out again)");
    await page.mouse.down(); await page.waitForTimeout(200);
    const pr = matrix(await tf(page, "arrow-right"));
    ok(near(pr[0], 0.86, 0.02) && near(pr[3], 0.86, 0.02) && near(pr[4], 0), `...and shrinks to 86% while pressed (${+pr[0].toFixed(2)})`);
    await page.mouse.up(); await away();
    ok(matrix(await tf(page, "arrow-right"))[4] === 0, "...and comes back to rest when the pointer leaves");

    const expect = {
      "arrow-up": (m) => near(m[5], -2.4, 0.15) && near(m[4], 0),
      "chevron-down": (m) => near(m[5], 2.1, 0.15),
      plus: (m) => near(m[0], 0, 0.02) && near(m[1], 1, 0.02),
      x: (m) => near(m[0], 0, 0.02) && near(m[1], 1, 0.02),
      "trash-2": (m) => near(m[1], -Math.sin((10 * Math.PI) / 180), 0.02),
      search: (m) => m[0] > 1.05 && m[1] < 0,
      copy: (m) => m[4] < 0 && m[0] > 1,
      info: (m) => near(m[5], -1, 0.1) && near(m[0], 1), // an icon with no character of its own takes the small lift
    };
    for (const [name, check] of Object.entries(expect)) {
      await hover(name);
      const mm = matrix(await tf(page, name));
      ok(check(mm), `${name}: its own hover (matrix ${mm.map((n) => +n.toFixed(2))})`);
      await away();
    }

    await hover("bell");
    ok((await css(page, "bell", "animationName")) === "ico-ring", "the bell rings when hovered");
    ok(parseFloat((await css(page, "bell", "transformOrigin")).split(" ")[1]) < 0.3 * parseFloat(await css(page, "bell", "height")), "...swinging from near the top");
    await away();
    await hover("download");
    ok((await css(page, "download", "animationName")) === "ico-dip", "the download arrow dips when hovered");
    await away();
    await hover("eye");
    ok((await css(page, "eye", "animationName")) === "ico-blink", "the eye blinks when hovered");
    await away();

    ok((await css(page, "check", "animationName", "path")) === "ico-draw" && (await css(page, "check", "strokeDasharray", "path")) === "24px", "a check that comes in inside a button is drawn (a line, not a pop)");
    ok((await css(page, "bookmark-check", "animationName")) === "ico-pop", "a bookmark that becomes checked pops in");

    ok((await css(page, "pressed-bell", "animationName")) === "ico-ring" && (await css(page, "pressed-bell", "fill")) !== "none", "a bell that is switched on (aria-pressed) is filled and rings once");
    ok((await css(page, "pressed-bookmark", "animationName")) === "ico-pop" && (await css(page, "pressed-bookmark", "fill")) !== "none", "a bookmark that is switched on is filled");
    ok((await css(page, "arrow-up", "fill")) === "none", "...and a plain icon is not filled");

    // not pressable, or switched off: nothing moves
    await page.locator('#fx [data-i="disabled"]').hover({ force: true }); await page.waitForTimeout(350);
    ok(matrix(await tf(page, "disabled"))[4] === 0, "a disabled button's icon does not move");
    await page.locator('#fx [data-i="aria-disabled"]').hover(); await page.waitForTimeout(350);
    ok(matrix(await tf(page, "aria-disabled"))[4] === 0, "...nor does one marked aria-disabled");
    await page.locator('#fx [data-i="heading"]').hover(); await page.waitForTimeout(350);
    ok(matrix(await tf(page, "heading"))[4] === 0, "an icon in a heading (a picture, not a control) does not move");
    await page.locator('#fx [data-i="link"]').hover(); await page.waitForTimeout(350);
    ok(near(matrix(await tf(page, "link"))[4], 3, 0.1), "an icon in a link moves like one in a button");
    await away();

    // the keyboard gets the same as the mouse
    await page.keyboard.press("Shift");
    await page.evaluate(() => document.querySelector('#fx [data-i="plus"]').focus());
    await page.waitForTimeout(350);
    ok(await page.evaluate(() => document.querySelector('#fx [data-i="plus"]').matches(":focus-visible")), "(the plus button has keyboard focus)");
    ok(near(matrix(await tf(page, "plus"))[1], 1, 0.02), "a keyboard focus turns the plus like a hover does");
    await page.keyboard.down("Space"); await page.waitForTimeout(200);
    ok(near(matrix(await tf(page, "plus"))[0], 0.86, 0.02), "Space pressed shrinks it like a mouse press does");
    await page.keyboard.up("Space");

    // the real app: the intro's Sign in
    const signin = page.locator(".in-head").getByRole("button", { name: /sign in/i }).first();
    if (await signin.count()) {
      await signin.hover(); await page.waitForTimeout(420);
      const ic = await signin.locator("svg").first().evaluate((el) => getComputedStyle(el).transform);
      ok(near(matrix(ic)[4], 3, 0.1), `in the app: the intro's Sign in arrow moves on hover (${ic})`);
    } else ok(false, "the intro has a Sign in button");
    await ctx.close();
  }

  /* ============================ reduced motion ============================ */
  console.log("with reduced motion");
  {
    const { ctx, page } = await open({ reducedMotion: "reduce" });
    await page.locator('#fx [data-i="arrow-right"]').hover(); await page.waitForTimeout(300);
    ok(matrix(await tf(page, "arrow-right"))[4] === 0, "a hovered arrow stays where it is");
    await page.mouse.down(); await page.waitForTimeout(200);
    ok(matrix(await tf(page, "arrow-right"))[0] === 1, "...and is not shrunk by a press");
    await page.mouse.up();
    await page.locator('#fx [data-i="bell"]').hover(); await page.waitForTimeout(300);
    ok((await css(page, "bell", "animationName")) === "none", "the bell does not ring");
    ok((await css(page, "check", "animationName", "path")) === "none" && (await css(page, "check", "strokeDasharray", "path")) === "none", "a check is not drawn, it is simply there");
    ok((await css(page, "pressed-bell", "animationName")) === "none" && (await css(page, "pressed-bookmark", "fill")) === "none", "a switched-on toggle is not given a new look by the kit (its own button style says it is on)");
    await ctx.close();
  }

  /* ============================ a touch screen ============================ */
  console.log("on a touch screen");
  {
    const { ctx, page } = await open({ hasTouch: true, isMobile: true, viewport: { width: 400, height: 700 } });
    const hoverCapable = await page.evaluate(() => matchMedia("(hover: hover)").matches);
    if (hoverCapable) console.log("        (this browser reports hover on the emulated phone; the touch checks are skipped)");
    else {
      const btn = page.locator('#fx [data-i="arrow-right"]');
      await btn.tap(); await page.waitForTimeout(400);
      ok(matrix(await tf(page, "arrow-right"))[4] === 0, "a tap does not leave an arrow nudged (a finger has no hover)");
      ok((await css(page, "bell", "animationName")) === "none", "...and does not ring the bell");
    }
    await ctx.close();
  }

  ok(errors.length === 0, `no errors in the browser console${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
}
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall icon motion checks passed");
process.exit(failures ? 1 : 0);
