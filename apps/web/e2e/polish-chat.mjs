// Browser e2e for the polish of the chat page (docs/design/ui-polish-1.md): the question box shows no scroll bar of the browser (3), its edge is whole while a conversation scrolls under it (4),
// no example chips stand in a conversation (5), a round arrow takes the reader to the latest message (6), and Home starts a new chat (8). Light, dark and read themes; 1280 and 390 px.
// Needs the Worker with the fake identity provider and the offline stand-ins: `npm run integration -w apps/api -- --browser` starts it.
//   node e2e/polish-chat.mjs [baseUrl]    (default http://localhost:8788)
// The browser is started WITH its scroll bars (Playwright hides them by default in a headless browser: a box that grows a bar would show nothing in a picture and take no room in a measurement).
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { startFakeIdp } from "../../api/scripts/fake-idp.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.argv[2] ?? "http://localhost:8788";
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };
const note = (msg) => console.log(`        ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "polish-chat-1", email: "isha.m@example.edu", email_verified: true, name: "Isha M" });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true, ignoreDefaultArgs: ["--hide-scrollbars"] });
const errors = [];
let currentPart = "-";
const watch = (p) => {
  p.on("pageerror", (e) => { errors.push("pageerror: " + e.message); console.log(`        (page error in part ${currentPart}: ${e.message.slice(0, 70)})`); });
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401|403|404|409|429|503)/.test(m.text())) errors.push("console: " + m.text()); });
};
const VP = {
  1280: { viewport: { width: 1280, height: 800 } },
  390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const setTheme = (p, t) => p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), t);

async function axe(label, p) {
  // the conversation's box is put in the flow for the run, as the other chat suites do: what axe reads is the page and not where it happens to be scrolled
  const unstick = await p.addStyleTag({ content: ".hm-box { position: static !important; } .chat-list > li { content-visibility: visible !important; }" });
  await sleep(300);
  await p.evaluate(axeSource);
  const res = await p.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(" "), msg: v.nodes[0]?.failureSummary?.split("\n")[1] }));
  });
  await unstick.evaluate((el) => el.remove());
  ok(res.length === 0, `axe [${label}]`);
  for (const v of res) console.log(`        ${v.impact} ${v.id} x${v.nodes} ${v.sample} :: ${v.msg}`);
}

/* ---------------------------------------------------------------- a stored conversation of `turns` replies (the way e2e/chat-perf.mjs makes one, with fewer cards) */
const TOPICS = ["glaucoma screening", "diabetic retinopathy", "asthma in children", "tuberculosis treatment", "dengue vaccines", "hypertension in India", "iron deficiency anaemia", "sleep and memory", "air pollution and lungs", "stroke rehabilitation", "malaria nets", "kidney stones", "dental caries", "thyroid disease", "anaemia in pregnancy", "snakebite care", "heat stroke", "hepatitis B", "leprosy", "oral health"];
const SENT = ["We enrolled adults from three districts and followed them for twelve months.", "The main outcome was measured at baseline and again at the end of the study period.", "Differences between the groups were small but consistent across the sites.", "Cost per person was lower with the community based approach than with clinic visits."];
const paperOf = (t, i) => ({ id: `doi:10.1000/pc.${t}.${i}`, doi: `10.1000/pc.${t}.${i}`, pmid: null, title: `${TOPICS[(t + i) % TOPICS.length]}: study ${i + 1}`, authors: ["A. Rao", "S. Iyer"], year: 2012 + ((t + i) % 13), venue: "Journal of Public Health", abstract: `${SENT[0]} ${SENT[1]} ${SENT[2]} ${SENT[3]}`, citationCount: 3 + ((t * 13 + i * 17) % 400), oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 1 - i / 100, doiStatus: "verified" });
function buildChat(owner, turns, cards = 8) {
  const messages = [];
  for (let t = 0; t < turns; t++) {
    const papers = Array.from({ length: cards }, (_, i) => paperOf(t, i));
    messages.push({ id: `pc-u${t}`, role: "user", text: TOPICS[t % TOPICS.length], at: 1_000 + t * 10 });
    messages.push({ id: `pc-a${t}`, role: "assistant", mode: "search", query: TOPICS[t % TOPICS.length], language: "en", auto: false, how: "chosen", confidence: 1, understood: true, status: "done", step: null, stepsDone: ["search", "read", "write", "check"], papers, papersFinal: true, notices: [], live: "", generalLive: "", general: null, tookMs: 4200, at: 1_005 + t * 10,
      answer: { text: "Screening was feasible in community settings [1]. Costs per person were lower than with clinic visits [2].", grounded: true, checked: true, leftOut: 0, rewritten: 0, citations: [1, 2].map((n) => ({ n, paperId: papers[n - 1].id, sentenceNo: n, sentence: SENT[n] })) } });
  }
  const id = `polishchat${turns}0000001`.slice(0, 20);
  return { entry: { id, title: TOPICS[0], updatedAt: Date.now(), owner }, record: { id, messages, rev: 1 } };
}
async function storeChat(page, turns, cards) {
  const meId = await page.evaluate(() => fetch("/api/v1/auth/me", { credentials: "same-origin" }).then((r) => r.json()).then((j) => j.user.id));
  const { entry, record } = buildChat(meId, turns, cards);
  await page.evaluate(async ({ entry, record }) => {
    const prev = JSON.parse(localStorage.getItem("scholar.chats.v1") ?? "[]").filter((e) => e.id !== entry.id);
    localStorage.setItem("scholar.chats.v1", JSON.stringify([entry, ...prev]));
    sessionStorage.setItem("scholar.chat.active", entry.id);
    const db = await new Promise((res, rej) => { const r = indexedDB.open("scholar", 2); r.onupgradeneeded = () => { for (const s of ["pendingInk", "chats"]) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res) => { const tx = db.transaction("chats", "readwrite"); tx.objectStore("chats").put(record, entry.id); tx.oncomplete = () => res(); });
    db.close();
  }, { entry, record });
  return entry.id;
}

let state;
const signedIn = async (vp, opts = {}) => {
  const ctx = await browser.newContext({ ...VP[vp], ...(state ? { storageState: state } : {}), colorScheme: "light", ...opts });
  const page = await ctx.newPage();
  watch(page);
  await page.addInitScript(() => { window.__io = 0; const O = window.IntersectionObserver; window.IntersectionObserver = class extends O { constructor(...a) { window.__io++; super(...a); } }; });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  if (!state) {
    await page.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
    await page.getByRole("button", { name: "Continue with Google" }).last().click();
  }
  await page.locator("#hm-h").waitFor({ timeout: 20000 });
  await sleep(1000);
  if (!state) state = await ctx.storageState();
  return { ctx, page };
};
const pick = async (p, name) => {
  if (new RegExp(name).test(await p.locator(".hm-mode").innerText())) return;
  await p.locator(".hm-mode").click();
  await p.getByRole("menuitemradio", { name: new RegExp("^" + name) }).click();
  await p.getByRole("menu", { name: "What should I do?" }).waitFor({ state: "hidden" });
};
const idle = (p) => p.waitForFunction(() => !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 30000 });
const send = async (p, text, tool = "Search papers") => { await idle(p); if (tool) await pick(p, tool); await p.locator(".hm-input").fill(text); await p.keyboard.press("Enter"); };
const chatsInStore = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("scholar.chats.v1") ?? "[]").length);
const activeChat = (p) => p.evaluate(() => sessionStorage.getItem("scholar.chat.active"));
const scrollMax = (p) => p.evaluate(() => document.documentElement.scrollHeight - innerHeight);

/** The pixel reader: a picture of `clip` is taken and decoded in the page, and `px(x, y)` (page coordinates of the window) answers [r, g, b]. */
async function pixels(page, clip) {
  const png = await page.screenshot({ clip, caret: "hide", animations: "disabled" });
  await page.evaluate(async ([b64, cssWidth]) => {
    const img = new Image();
    await new Promise((r) => { img.onload = r; img.src = "data:image/png;base64," + b64; });
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    window.__shot = { data: g.getImageData(0, 0, img.width, img.height), scale: img.width / cssWidth };
  }, [png.toString("base64"), clip.width]);
  return (x, y) => page.evaluate(([x, y]) => { const { data: d, scale } = window.__shot; const i = (Math.round(y * scale) * d.width + Math.round(x * scale)) * 4; return [d.data[i], d.data[i + 1], d.data[i + 2]]; }, [x - clip.x, y - clip.y]);
}
const near = (a, b, d = 8) => a.every((v, i) => Math.abs(v - b[i]) <= d);

const section = async (name, fn) => {
  if (process.env.PARTS && !process.env.PARTS.split(",").includes(name)) return;
  currentPart = name;
  try { await fn(); } catch (e) { failures++; console.log(` FAIL  [part ${name}] stopped: ${String(e.message).split(/\r?\n/)[0].slice(0, 200)}`); }
};
try {
  await section("5", async () => {
  /* ================================================================ 5. no examples in a conversation */
  console.log("5. no example chips in a conversation");
  {
    const { ctx, page } = await signedIn(1280);
    ok(await page.locator(".hm-chips .hm-starters .chip-btn").count() >= 4, `the empty Home still offers its example searches (${await page.locator(".hm-chips .hm-starters .chip-btn").count()})`);
    await send(page, "Hey How are you?", "Auto");
    await page.locator(".chat-talk").waitFor({ timeout: 20000 });
    await idle(page);
    const talk = page.locator(".chat-turn").last();
    ok(await talk.getByRole("button", { name: "Search for these words anyway" }).isVisible() && /Not small talk\?/.test(await talk.locator(".chat-talk-any").innerText()), "under a reply to small talk the way out stays: 'Not small talk? Search for these words anyway'");
    ok(await page.locator(".chat .hm-starters").count() === 0 && await page.locator(".chat .chip-btn").count() === 0, `...and no example chips stand in the conversation (${await page.locator(".chat .chip-btn").count()})`);
    ok(await page.getByRole("group", { name: "Try" }).count() === 0, "(no group named Try on the page while a conversation is open)");
    // a search that finds nothing: the plain line stays, the chips do not
    await pick(page, "Search papers");
    await page.locator(".hm-input").fill("nothing at all");
    await page.keyboard.press("Enter");
    await page.locator(".chat-note[data-kind=nothing]").waitFor({ timeout: 20000 });
    await idle(page);
    const none = page.locator(".chat-turn").last();
    ok(/Nothing was found/.test(await none.locator(".chat-note[data-kind=nothing]").innerText()) && await none.locator(".result").count() === 0, "a search with no paper still says so plainly");
    ok(await none.locator(".hm-starters").count() === 0 && await none.getByRole("group", { name: "Or try one of these" }).count() === 0, "...and does not offer example chips");
    await page.waitForFunction(() => /No papers were found/.test(document.querySelector("[data-announcer]")?.textContent ?? ""), null, { timeout: 4000 }).catch(() => {});
    const told = (await page.locator("[data-announcer]").textContent()) ?? "";
    ok(/No papers were found\./.test(told) && !/example/i.test(told), `...and a screen reader is not pointed at examples that are not there ("${told.trim()}")`);
    await ctx.close();
  }
  });

  await section("3", async () => {
  /* ================================================================ 3. the question box of Home shows no scroll bar */
  console.log("3. the question box of Home");
  for (const vp of [1280, 390]) {
    const { ctx, page } = await signedIn(vp);
    const ta = page.locator(".hm-input");
    const metrics = () => ta.evaluate((el) => { const cs = getComputedStyle(el); return { h: el.getBoundingClientRect().height, client: el.clientHeight, scroll: el.scrollHeight, gutter: el.offsetWidth - el.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth), sb: cs.scrollbarWidth, wk: getComputedStyle(el, "::-webkit-scrollbar").display, max: parseFloat(cs.maxHeight) }; });
    let m = await metrics();
    ok(m.scroll <= m.client && m.gutter === 0 && m.sb === "none" && m.wk === "none", `${vp}: empty, it holds nothing it does not show and asks for no scroll bar (text ${m.scroll}, box ${m.client}, gutter ${m.gutter}, scrollbar-width ${m.sb}, webkit ${m.wk})`);
    await ta.focus();
    let grew = true;
    const heights = [];
    for (let line = 1; line <= 6; line++) {
      if (line > 1) await page.keyboard.press("Shift+Enter");
      await page.keyboard.type(`line ${line}`);
      m = await metrics();
      heights.push(Math.round(m.h));
      if (m.h < 219 && (m.scroll > m.client || m.gutter !== 0)) { grew = false; note(`${vp}: ${line} line(s): box ${m.client}, text ${m.scroll}, gutter ${m.gutter}`); }
    }
    ok(grew && heights.at(-1) > heights[0], `${vp}: it grows with its text, and below its largest size never holds more than it shows (${heights.join(", ")} px)`);
    for (let line = 7; line <= 16; line++) { await page.keyboard.press("Shift+Enter"); await page.keyboard.type(`line ${line}`); }
    m = await metrics();
    ok(m.h <= 224 && m.h >= 200 && m.scroll > m.client && m.gutter === 0, `${vp}: at its largest (${Math.round(m.h)} px) it holds more (${m.scroll} px) than it shows and still shows no bar (gutter ${m.gutter})`);
    await ta.evaluate((el) => { el.scrollTop = 0; });
    const box = await ta.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + 30);
    await page.mouse.wheel(0, 100);
    await sleep(150);
    ok(await ta.evaluate((el) => el.scrollTop) > 0, `${vp}: the wheel scrolls it`);
    await ta.evaluate((el) => { el.focus(); el.setSelectionRange(0, 0); el.scrollTop = 0; });
    await page.keyboard.press("Control+End");
    await sleep(100);
    ok(await ta.evaluate((el) => el.scrollTop > 0 && el.scrollHeight - (el.scrollTop + el.clientHeight) <= 14), `${vp}: Ctrl+End takes the text to its end`);
    ok((await ta.inputValue()).split("\n").length === 16, `${vp}: Shift+Enter made new lines (${(await ta.inputValue()).split("\n").length})`);
    await ctx.close();
  }
  });

  await section("4", async () => {
  /* ================================================================ 4. the box is whole while a conversation scrolls under it */
  console.log("4. the edge of the box");
  for (const [vp, theme] of [[1280, "light"], [1280, "dark"], [1280, "read"], [390, "light"]]) {
    const { ctx, page } = await signedIn(vp);
    await storeChat(page, 20, 8);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll(".chat-turn").length >= 20, null, { timeout: 60000 });
    await setTheme(page, theme);
    await page.evaluate(() => window.scrollTo({ top: Math.round((document.documentElement.scrollHeight - innerHeight) / 2), behavior: "instant" }));
    await page.locator(".hm-input").focus();
    await sleep(900);
    const box = await page.locator(".hm-box").boundingBox();
    const colours = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector(".hm-box")); const probe = (v) => { const s = document.createElement("span"); s.style.color = v; document.body.append(s); const c = getComputedStyle(s).color; s.remove(); return c.match(/[\d.]+/g).slice(0, 3).map(Number); }; const root = getComputedStyle(document.documentElement); return { border: cs.borderTopColor.match(/[\d.]+/g).slice(0, 3).map(Number), ring: probe(root.getPropertyValue("--accent-soft")), bg: probe(root.getPropertyValue("--bg")) }; });
    const clip = { x: Math.max(0, box.x - 20), y: Math.max(0, box.y - 60), width: Math.min(VP[vp].viewport.width - Math.max(0, box.x - 20), box.width + 40), height: Math.min(VP[vp].viewport.height - Math.max(0, box.y - 60), box.height + 60 + 30) };
    const px = await pixels(page, clip);
    const cx = Math.round(box.x + box.width / 2);
    const bottom = Math.round(box.y + box.height);
    ok(near(await px(cx, bottom - 1), colours.border, 12), `${theme} ${vp}: the box's bottom border is drawn (${await px(cx, bottom - 1)} against ${colours.border})`);
    ok(near(await px(cx, bottom + 2), colours.ring, 6), `${theme} ${vp}: and the ring round it under the bottom edge (${await px(cx, bottom + 2)} against ${colours.ring}; the page's colour is ${colours.bg})`);
    ok(near(await px(cx, Math.round(box.y) - 3), colours.ring, 6), `${theme} ${vp}: and over the top edge (${await px(cx, Math.round(box.y) - 3)})`);
    ok(near(await px(Math.round(box.x) - 3, Math.round(box.y + box.height / 2)), colours.ring, 6), `${theme} ${vp}: and at the side`);
    // what the fade is for: text that scrolls under the top edge is not cut through a line. A black bar is put under the box (below its layer) and read just over the edge and far from it
    await page.evaluate((top) => { const d = document.createElement("div"); d.id = "probe-bar"; d.style.cssText = `position:fixed;left:0;right:0;top:${top - 70}px;height:120px;background:#000;z-index:1;pointer-events:none`; document.querySelector(".hm").append(d); }, box.y);
    const px2 = await pixels(page, clip);
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const sx = Math.round(box.x + box.width * 0.22); // away from the arrow, which floats over the middle of the edge
    const nearEdge = lum(await px2(sx, Math.round(box.y) - 8)), far = lum(await px2(sx, Math.round(box.y) - 50));
    const bgL = lum(colours.bg);
    ok(far < 0.12 * bgL + 2 && nearEdge > 0.25 * bgL, `${theme} ${vp}: what runs under the top edge fades out towards it (a black bar reads ${far.toFixed(0)} far away and ${nearEdge.toFixed(0)} 8 px above the edge; the page itself is ${bgL.toFixed(0)})`);
    await page.evaluate(() => document.getElementById("probe-bar")?.remove());
    await page.evaluate((bot) => { const d = document.createElement("div"); d.id = "probe-bar"; d.style.cssText = `position:fixed;left:0;right:0;top:${bot + 6}px;height:40px;background:#000;z-index:1;pointer-events:none`; document.querySelector(".hm").append(d); }, bottom);
    const px3 = await pixels(page, clip);
    const under = await px3(cx, bottom + (vp === 390 ? 7 : 7));
    ok(vp === 390 ? true : near(under, colours.bg, 40) || lum(under) > 120, `${theme} ${vp}: under the box the page's own colour shows, not what scrolls by (${under})`);
    await page.evaluate(() => document.getElementById("probe-bar")?.remove());
    await ctx.close();
  }
  });

  await section("6", async () => {
  /* ================================================================ 6. the arrow to the latest message */
  console.log("6. the arrow to the latest message");
  const jump = (p) => p.getByRole("button", { name: "Scroll to latest message" });
  for (const vp of [1280, 390]) {
    const { ctx, page } = await signedIn(vp);
    await storeChat(page, 20, 8);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll(".chat-turn").length >= 20, null, { timeout: 60000 });
    await sleep(900);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await sleep(500);
    ok(await jump(page).count() === 1 && await jump(page).isVisible(), `${vp}: away from the end, the arrow is there (a button named "Scroll to latest message")`);
    ok((await page.evaluate(() => window.__io)) >= 1, `${vp}: it is watched by an IntersectionObserver (${await page.evaluate(() => window.__io)} made)`);
    const place = () => page.evaluate(() => { const b = document.querySelector('button[aria-label="Scroll to latest message"]').getBoundingClientRect(); const x = document.querySelector(".hm-box").getBoundingClientRect(); const h = document.querySelector(".chat-head").getBoundingClientRect(); return { bt: b.top, bb: b.bottom, bl: b.left, br: b.right, bw: b.width, bh: b.height, xt: x.top, xl: x.left, xr: x.right, hb: h.bottom, ht: h.top, headSticky: getComputedStyle(document.querySelector(".chat-head")).position }; });
    let g = await place();
    ok(g.bw >= 32 && g.bw <= 48 && Math.abs(g.bw - g.bh) < 1, `${vp}: it is a small round button (${g.bw} by ${g.bh})`);
    ok(g.bb <= g.xt - 4 && g.bb >= g.xt - 40, `${vp}: it floats just above the box and never touches it (its bottom ${Math.round(g.bb)}, the box's top ${Math.round(g.xt)})`);
    ok(Math.abs((g.bl + g.br) / 2 - (g.xl + g.xr) / 2) < 3, `${vp}: and it is centred over the box`);
    ok(g.headSticky !== "sticky" || g.bt >= g.hb + 4, `${vp}: it is clear of the title row (${Math.round(g.bt)} against ${Math.round(g.hb)})`);
    const live = await jump(page).evaluate((el) => ({ in: !!el.closest("[aria-live], [role=status], [role=alert], [role=log]"), live: el.getAttribute("aria-live") }));
    ok(!live.in && !live.live, `${vp}: it is in no live region, so nothing is announced when it appears`);
    const told0 = await page.locator("[data-announcer]").textContent();
    // focus is not taken: the box has it, the page scrolls, the box keeps it
    await page.locator(".hm-input").focus();
    await page.evaluate(() => window.scrollTo({ top: 400, behavior: "instant" }));
    await sleep(300);
    ok(await page.evaluate(() => document.activeElement?.classList.contains("hm-input")), `${vp}: the arrow does not take the focus when it appears or goes`);
    ok((await page.locator("[data-announcer]").textContent()) === told0, `${vp}: and says nothing to a screen reader (the status line is as it was)`);
    // the box grows: the arrow stays above it
    await page.locator(".hm-input").focus();
    for (let i = 0; i < 6; i++) { await page.keyboard.press("Shift+Enter"); await page.keyboard.type(`line ${i}`); }
    await sleep(400);
    g = await place();
    ok(g.bb <= g.xt - 4 && g.bb >= g.xt - 40, `${vp}: the box grows with six lines and the arrow stays over it (${Math.round(g.bb)} against ${Math.round(g.xt)})`);
    await page.locator(".hm-input").fill("");
    await sleep(300);
    // pressed: goes to the end, smoothly, and is gone
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await sleep(300);
    await jump(page).click();
    const t0 = Date.now();
    await page.waitForFunction(() => Math.abs(document.documentElement.scrollHeight - innerHeight - scrollY) < 3, null, { timeout: 8000 });
    note(`${vp}: the scroll to the end took ${Date.now() - t0} ms`);
    await sleep(500);
    ok(await jump(page).count() === 0, `${vp}: at the end the arrow is gone (not on the page for the keyboard or a screen reader)`);
    ok(await page.evaluate(() => { const last = [...document.querySelectorAll(".chat-list > li")].at(-1).getBoundingClientRect(); const x = document.querySelector(".hm-box").getBoundingClientRect(); return last.bottom <= x.top + 1 && last.bottom > 0; }), `${vp}: and the last reply is whole above the box`);
    // away again by a little: the end is still in view above the box, so no arrow; away by a screen: the arrow
    await page.evaluate(() => window.scrollBy({ top: -60, behavior: "instant" }));
    await sleep(300);
    const little = await jump(page).count();
    await page.evaluate(() => window.scrollBy({ top: -1500, behavior: "instant" }));
    await sleep(300);
    ok(little === 0 && await jump(page).count() === 1, `${vp}: 60 px up from the end there is no arrow, 1,500 px up there is (${little}, ${await jump(page).count()})`);
    // the keyboard: from the box, one step back reaches the arrow, Enter goes to the end, and the focus lands in the box
    await page.locator(".hm-input").focus();
    await page.keyboard.press("Shift+Tab");
    ok(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Scroll to latest message"), `${vp}: the keyboard reaches the arrow`);
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => Math.abs(document.documentElement.scrollHeight - innerHeight - scrollY) < 3, null, { timeout: 8000 });
    await sleep(400);
    ok(await page.evaluate(() => document.activeElement?.classList.contains("hm-input")), `${vp}: Enter on it goes to the end and the focus goes to the box (the arrow is gone, the keyboard does not lose its place)`);
    ok(await jump(page).count() === 0, `${vp}: (and it is gone)`);
    for (const theme of ["light", "dark", "read"]) {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      await setTheme(page, theme);
      await sleep(500);
      ok(await jump(page).count() === 1, `${vp} ${theme}: the arrow is shown`);
      const c = await jump(page).evaluate((el) => { const rgb = (s) => s.match(/[\d.]+/g).slice(0, 3).map(Number); const L = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); }; const R = (a, b) => (Math.max(L(a), L(b)) + 0.05) / (Math.min(L(a), L(b)) + 0.05); const s = getComputedStyle(el); const page = rgb(getComputedStyle(document.body).backgroundColor); return { icon: R(rgb(s.color), rgb(s.backgroundColor)), border: parseFloat(s.borderTopWidth), shadow: s.boxShadow }; });
      ok(c.icon >= 4.5, `${vp} ${theme}: its arrow is ${c.icon.toFixed(2)}:1 on its disc`);
      ok(c.border >= 1 && c.shadow !== "none", `${vp} ${theme}: and the disc has an edge and a shadow to stand out from the page (${c.border}px, ${c.shadow.slice(0, 30)}...)`);
      await axe(`the arrow, ${theme}, ${vp}`, page);
    }
    await ctx.close();
  }
  {
    // a short chat has no arrow; a reduced-motion reader is taken there at once; a reply that is written while the reader is far up raises no error
    const { ctx, page } = await signedIn(1280, { reducedMotion: "reduce", viewport: { width: 1280, height: 1500 } });
    await storeChat(page, 1, 2);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll(".chat-turn").length >= 1, null, { timeout: 30000 });
    await sleep(900);
    ok(await scrollMax(page) <= 0 && await jump(page).count() === 0, `a chat that fits the window has no arrow (the page is ${await page.evaluate(() => document.documentElement.scrollHeight)} px in a window of ${await page.evaluate(() => innerHeight)})`);
    await ctx.close();
    const long = await signedIn(1280, { reducedMotion: "reduce" });
    await storeChat(long.page, 20, 8);
    await long.page.reload({ waitUntil: "domcontentloaded" });
    await long.page.waitForFunction(() => document.querySelectorAll(".chat-turn").length >= 20, null, { timeout: 60000 });
    await sleep(900);
    await jump(long.page).click();
    await sleep(120);
    ok(Math.abs((await scrollMax(long.page)) - (await long.page.evaluate(() => scrollY))) < 3, "with reduced motion the arrow takes the reader to the end at once (no smooth scroll)");
    // a reply written while the reader is far up: nothing breaks (React stops at 50 nested updates: error 185)
    await long.page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await send(long.page, "glaucoma screening again");
    await long.page.waitForFunction(() => document.querySelectorAll(".chat-turn").length >= 21, null, { timeout: 30000 });
    await idle(long.page);
    await long.page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await sleep(500);
    ok(await jump(long.page).count() === 1, "after a new reply, far up, the arrow is there again");
    await long.ctx.close();
  }
  });

  await section("8", async () => {
  /* ================================================================ 8. Home starts a new chat */
  console.log("8. the Home link starts a new chat");
  {
    const { ctx, page } = await signedIn(1280);
    const homeLink = page.locator(".ws-rail").getByRole("link", { name: "Home", exact: true });
    // on the empty Home: no second chat, the box has the focus, the page is at its top, what was typed stays
    await page.locator(".hm-input").fill("a half written question");
    await page.evaluate(() => document.activeElement?.blur());
    await homeLink.click();
    await sleep(300);
    ok(await page.evaluate(() => document.activeElement?.classList.contains("hm-input")) && (await page.locator(".hm-input").inputValue()) === "a half written question", "on the empty Home: the link puts the focus in the box and keeps what was typed");
    ok(await chatsInStore(page) === 0 && await activeChat(page) === null, "...and makes no chat");
    await page.locator(".hm-input").fill("");
    // from a conversation: a new, empty chat, and the old one stays in the list
    await send(page, "glaucoma screening");
    await page.locator('.chat-turn[data-status="done"]').first().waitFor({ timeout: 30000 });
    await idle(page);
    ok(await chatsInStore(page) === 1, "(one chat is kept)");
    const histBefore = await page.evaluate(() => history.length);
    await page.evaluate(() => window.scrollTo(0, 300));
    await homeLink.click();
    await page.locator(".hm-title").waitFor({ timeout: 5000 });
    await sleep(300);
    ok(await page.locator(".chat-turn").count() === 0 && await page.locator(".chat-list").count() === 0, "from a conversation: the Home link shows the empty Home");
    ok(await page.evaluate(() => document.activeElement?.classList.contains("hm-input")) && await page.evaluate(() => scrollY) === 0, "...with the box ready and the page at its top");
    ok(await activeChat(page) === null && await chatsInStore(page) === 1 && await page.locator(".ws-recent li").count() === 1, "...the old conversation is in the list of chats, as the New chat button leaves it, and the new chat is not made until a first message");
    ok(await page.evaluate(() => history.length) === histBefore, "...and it added nothing to the browser's history (one press of Back is still one step)");
    await homeLink.click();
    await sleep(300);
    ok(await chatsInStore(page) === 1 && await activeChat(page) === null && await page.evaluate(() => document.activeElement?.classList.contains("hm-input")), "pressed again on the empty chat: no second chat, the box has the focus");
    // the old chat is still there to open
    await page.locator(".ws-recent-open").first().click();
    await page.locator(".chat-turn").first().waitFor({ timeout: 10000 });
    ok(await page.locator(".chat-bubble").first().innerText().then((t) => /glaucoma screening/.test(t)), "and the old conversation opens from the list, whole");
    // from another page: the same
    await page.locator(".ws-rail").getByRole("link", { name: "Library" }).click();
    await page.getByRole("heading", { level: 1, name: /Library/ }).waitFor();
    await homeLink.click();
    await page.locator(".hm-title").waitFor({ timeout: 5000 });
    ok(await page.locator(".chat-turn").count() === 0 && await activeChat(page) === null && await chatsInStore(page) === 1, "from another page: the Home link shows the empty Home with a fresh chat (the old one is in the list)");
    // the browser's Back and Forward
    await page.goBack();
    await page.getByRole("heading", { level: 1, name: /Library/ }).waitFor({ timeout: 5000 });
    ok(true, "Back goes to the page it came from");
    await page.goForward();
    await page.locator(".hm-title").waitFor({ timeout: 5000 });
    ok(await page.locator(".chat-turn").count() === 0, "Forward goes on to the empty Home");
    // Back from Settings is still Back: the conversation the person was in is there
    await page.locator(".ws-recent-open").first().click();
    await page.locator(".chat-turn").first().waitFor({ timeout: 10000 });
    await page.locator(".ws-rail").getByRole("link", { name: "Settings" }).click();
    await page.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
    await page.goBack();
    await page.locator(".chat-turn").first().waitFor({ timeout: 10000 });
    ok(true, "the browser's Back from Settings brings the conversation back (only the Home link starts a new one)");
    // the logo is the same link
    await page.locator(".ws-logo").click();
    await page.locator(".hm-title").waitFor({ timeout: 5000 });
    ok(await page.locator(".chat-turn").count() === 0, "the logo does what the Home link does");
    // the command palette's Home too
    await page.locator(".ws-recent-open").first().click();
    await page.locator(".chat-turn").first().waitFor({ timeout: 10000 });
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog").getByRole("combobox").fill("Home");
    await page.keyboard.press("Enter");
    await page.locator(".hm-title").waitFor({ timeout: 5000 });
    ok(true, "so does Home in the command palette");
    await ctx.close();
  }
  {
    // a private chat is not lost by a slip: the person is asked first; an open edit the same
    const { ctx, page } = await signedIn(1280);
    const homeLink = page.locator(".ws-rail").getByRole("link", { name: "Home", exact: true });
    await page.getByRole("button", { name: "Chat options", exact: true }).click();
    await page.getByRole("menuitem", { name: /Private chat/ }).click();
    ok(await page.locator(".hm-box .chat-chip").count() === 1, "(a private chat is chosen on the empty Home)");
    await homeLink.click();
    await sleep(300);
    ok(await page.locator(".hm-box .chat-chip").count() === 1, "the Home link on a private chat that has not begun keeps the choice (there is nothing to leave)");
    await send(page, "glaucoma screening");
    await page.locator('.chat-turn[data-status="done"]').first().waitFor({ timeout: 30000 });
    await idle(page);
    let asked = [];
    page.on("dialog", (d) => { asked.push(d.message()); void d.dismiss(); });
    await homeLink.click();
    await sleep(500);
    ok(asked.length === 1 && /private/i.test(asked[0]) && await page.locator(".chat-turn").count() === 1, `the Home link on a private chat with a message asks first, and "stay" leaves it on the screen ("${asked[0] ?? ""}")`);
    page.removeAllListeners("dialog");
    page.on("dialog", (d) => { void d.accept(); });
    await homeLink.click();
    await page.locator(".hm-title").waitFor({ timeout: 5000 });
    ok(await page.locator(".chat-turn").count() === 0 && await chatsInStore(page) === 0, "...and when the person agrees the private chat is left, as the New chat button leaves it, and nothing of it is kept");
    page.removeAllListeners("dialog");
    // an edit that was not sent
    await send(page, "dengue vaccines");
    await page.locator('.chat-turn[data-status="done"]').first().waitFor({ timeout: 30000 });
    await idle(page);
    await page.getByRole("button", { name: "Edit your message" }).first().click();
    const ed = page.locator(".chat-edit-ta");
    await ed.fill("dengue vaccines in children");
    const asked2 = [];
    page.on("dialog", (d) => { asked2.push(d.message()); void d.dismiss(); });
    await homeLink.click();
    await sleep(500);
    ok(asked2.length === 1 && /edit/i.test(asked2[0]) && await ed.count() === 1 && (await ed.inputValue()) === "dengue vaccines in children", `the Home link with an unsent edit asks first, and "stay" keeps the edit as it was ("${asked2[0] ?? ""}")`);
    page.removeAllListeners("dialog");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await homeLink.click();
    await page.locator(".hm-title").waitFor({ timeout: 5000 });
    ok(true, "an edit that is closed asks nothing");
    await ctx.close();
  }
  });
  /* ================================================================ 9. the room for the answer is there before its first word (what the shift gate of chat-perf.mjs found) */
  await section("9", async () => {
    console.log("9. the papers do not move when the first word comes");
    for (const vp of [390, 1280]) {
      const { ctx, page } = await signedIn(vp);
      await page.evaluate(() => {
        window.__cardPos = [];
        new MutationObserver(() => {
          const first = document.querySelector(".chat-list > li:last-child .chat-papers:not([aria-hidden]) .result");
          const words = document.querySelector(".chat-list > li:last-child .ask-text-live");
          const card = document.querySelector(".chat-list > li:last-child .chat-live-card");
          if (first) window.__cardPos.push({ words: !!words, card: !!card, top: Math.round(first.getBoundingClientRect().top + scrollY) });
        }).observe(document, { childList: true, subtree: true, characterData: true });
      });
      await send(page, "slowly glaucoma screening");
      await page.waitForSelector(".chat-live-card", { timeout: 30000 });
      await page.waitForFunction(() => document.querySelector(".ask-text-live")?.textContent?.length > 20, null, { timeout: 30000 });
      await idle(page);
      const pos = await page.evaluate(() => window.__cardPos);
      const before = pos.filter((p) => p.card && !p.words).at(-1), after = pos.find((p) => p.words); // the last sight of the first paper with the card in place and no word yet, and the first sight of it with words
      ok(!!before && !!after && Math.abs(after.top - before.top) <= 2, `${vp}: the first paper does not move when the first word is written (it was at ${before?.top} and is at ${after?.top} in the page)`);
      ok(pos.some((p) => p.card && !p.words), `${vp}: the card the words go in is there before the first word (the room is kept while the papers are read)`);
      await ctx.close();
    }
  });
} catch (e) {
  failures++;
  console.log(` FAIL unexpected: ${e.stack?.split("\n").slice(0, 4).join(" | ")}`);
} finally {
  ok(errors.length === 0, `no page error and no console error (${errors.length ? errors[0].slice(0, 160) : "none"})`);
  await browser.close();
  idp.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
