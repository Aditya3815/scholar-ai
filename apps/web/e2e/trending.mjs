// Browser e2e for the Home page's two rows of chips (docs/design/chatview-and-trending.md: T1, T9, T10, C4): Try (the owner's example searches, a click sends one) and Trending (open data, a click FILLS the box).
// The feed is the Worker's own route GET /api/v1/home/trending; most of the checks stand in for it with a payload the test makes (page.route), and one section reads the real route through the Worker (KV seeded
// through the dev-only route). What it holds the page to:
//   - the row is there only when a fresh, valid list was in hand when Home was drawn; with the network blocked, a stale list, disabled:true, a missing file or a 3 s answer there is no Trending row and nothing moves;
//   - an answer is kept for the NEXT Home screen and never put into the one being read; a copy on the device older than 24 h is ignored; disabled:true clears the copy;
//   - a Trending chip puts its exact words in the box with the caret at the end and sends nothing; "From 2025 on" is shown beside the box and can be removed; what the person had typed can be put back;
//   - the request body for a filled chip, an edited one and a Try chip; the reply shows the year as the server reports it; "Search again" asks the same;
//   - only our own origin is called, with no cookie; axe in light, dark and read at 1280 and 390; target sizes; reduced motion; keyboard order (box, Try, Trending, Why); accessible names; layout shift.
// Needs the Worker with the fake identity provider and the offline stand-ins: `npm run integration -w apps/api -- --browser` starts it.
//   node e2e/trending.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { startFakeIdp } from "../../api/scripts/fake-idp.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.argv[2] ?? "http://localhost:8788";
const ORIGIN = new URL(BASE).origin;
const OUT = fileURLToPath(new URL("./shots/trending-", import.meta.url));
mkdirSync(fileURLToPath(new URL("./shots/", import.meta.url)), { recursive: true });
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };
const note = (msg) => console.log(`        ${msg}`);
const same = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}${JSON.stringify(a) === JSON.stringify(b) ? "" : `  [got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)}]`}`);

/** The Try chips as the page has them (apps/web/src/workspace/starters.ts, bundled here so that the owner's edits of the list do not break this suite: what it holds the page to is the rule, not the words). */
const S = await (async () => {
  const out = await build({ stdin: { contents: 'export * from "./src/workspace/starters";', resolveDir: fileURLToPath(new URL("..", import.meta.url)), loader: "ts" }, bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" });
  return import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
})();
const ALL = [...S.STARTERS];
const ENGLISH = ALL.filter((t) => S.inEnglish(t));
const VIA_AUTO = ALL.filter((t) => !S.inEnglish(t));
if (ENGLISH.length < 2 || VIA_AUTO.length < 2) throw new Error("starters.ts must hold at least two English chips and two chips in Hinglish");

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "trend-ui-1", email: "isha.m@example.edu", email_verified: true, name: "Isha M" });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
const errors = [];
const watch = (p) => {
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  // a feed that is blocked or never answers is part of the test: the browser reports it as a failed request, and that is not an error of the page
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push("console: " + m.text()); });
};
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1280, height: 800 } };

/* ------------------------------------------------------------------ the list the test serves */
const NOW = Date.now();
const YEAR = new Date(NOW).getUTCFullYear();
const iso = (t) => new Date(t).toISOString();
const NAMES = ["retrieval-augmented generation", "AI governance", "hallucination mitigation", "generative AI", "world model", "vision-language-action", "diffusion language model", "AI literacy", "explainable AI", "agentic AI", "small language models", "quantum error correction"];
const INDIA = ["crop yield prediction", "UPI digital payments", "heritage digitisation", "rural telemedicine", "monsoon forecasting"];
const chip = (text, over = {}) => ({ text, sinceYear: YEAR - 1, a: 452, b: 176, field: "Computer Science", ...over });
const makePayload = (over = {}) => ({
  version: 1,
  asOf: iso(NOW).slice(0, 10),
  generatedAt: iso(NOW - 3 * 3_600_000),
  validUntil: iso(NOW + 45 * 3_600_000),
  poolAsOf: iso(NOW - 2 * 86_400_000).slice(0, 10),
  disabled: false,
  groups: { global: { chips: NAMES.map((t) => chip(t)) }, in: { chips: INDIA.map((t) => chip(t, { a: 90, b: 20, field: "Engineering" })) } },
  ...over,
});
const stale = () => makePayload({ validUntil: iso(NOW - 60_000) });
const disabledList = () => makePayload({ disabled: true, groups: { global: { chips: [] }, in: { chips: [] } } });
const COPY_KEY = "scholar.trending";
const copyOf = (payload, savedAt = NOW) => JSON.stringify({ savedAt, payload });
const json = (body) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
const WORDS = (iso10) => { const [y, m, d] = iso10.split("-").map(Number); return `${d} ${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${y}`; };

/**
 * What the facts under a chip must say, worked out here from the POOL's day (the day the counts were made in, which is not the day of the file): window A is the 91 days that end 45 days before it, window B
 * the same dates 364 days earlier. Written out on its own, not taken from the page's code.
 */
const windowsOf = (day) => {
  const D = 86_400_000;
  const toA = Date.parse(day) - 45 * D;
  const span = (to) => { const f = iso(to - 90 * D).slice(0, 10); const t = iso(to).slice(0, 10); return `${f.slice(0, 4) === t.slice(0, 4) ? WORDS(f).replace(/ \d{4}$/, "") : WORDS(f)} to ${WORDS(t)}`; };
  return `from ${span(toA)}, against ${span(toA - 364 * D)}`;
};
/** What a chip's counts are counts OF: one subfield, with an abstract (the job's filter); the India list counts papers with an Indian author. Said in the chip's accessible description; the panel says the dates once. */
const FACTS = (day, a, b, field = "Computer Science", india = false) => {
  const w = windowsOf(day).replace(", against ", `, against ${b} from `);
  return `${a} journal papers with an abstract${india ? " and an author at an Indian institution" : ""}, in one subfield of ${field}, ${w}.`;
};
const COUNTS = (a, b, field = "Computer Science", india = false) => `${a} against ${b}, in one subfield of ${field}${india ? ", papers with an Indian author" : ""}`;
const SINCE = (y) => `${y} or later`;

/** A new tab on a context that (optionally) has a copy of the list on the device from its first moment, and a stand-in for the route. `serve` is the answer: a payload, "block", "404", or a function that gets the route. */
async function open(browserCtx, { copy = null, serve = "block", scope = null, path = "/home", viewport } = {}) {
  const ctx = await browser.newContext({ ...browserCtx, ...(viewport ? { viewport } : {}) });
  const page = await ctx.newPage();
  watch(page);
  const seen = { feed: 0, chat: [], origins: new Set(), cookies: [], all: [] };
  page.on("request", async (r) => {
    const u = new URL(r.url());
    if (u.protocol === "http:" || u.protocol === "https:") seen.origins.add(u.origin);
    if (u.origin === ORIGIN) seen.all.push(`${r.method()} ${u.pathname}`); // every request to our own address, in order, with its method: what a counter would have to be
    if (u.pathname === "/api/v1/home/trending") { seen.feed++; seen.feedMethod = r.method(); seen.cookies.push((await r.allHeaders().catch(() => ({}))).cookie ?? null); }
    if (r.method() === "POST" && u.pathname === "/api/v1/chat") seen.chat.push(JSON.parse(r.postData() ?? "{}"));
  });
  await ctx.addInitScript(([key, value, scopeKey, scopeValue]) => {
    // once per tab: a reload must find what the page left, not what the test put there
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    if (value) localStorage.setItem(key, value);
    if (scopeValue) localStorage.setItem(scopeKey, scopeValue);
  }, [COPY_KEY, copy, "scholar.scope", scope]);
  await page.route("**/api/v1/home/trending", async (route) => {
    if (typeof serve === "function") return serve(route);
    if (serve === "block") return route.abort("failed");
    if (serve === "404") return route.fulfill({ status: 404, contentType: "application/json", body: '{"type":"not_found"}' });
    if (serve === "html") return route.fulfill({ status: 200, contentType: "text/html", body: "<html>not ours</html>" });
    return route.fulfill(json(serve));
  });
  await page.goto(BASE + path, { waitUntil: "load" });
  await page.locator(".hm-input").waitFor();
  return { ctx, page, seen };
}
/**
 * What the page asked of our own address since `from` (an index into `seen.all`), leaving out only the files the page is made of: a GET of a script, a style sheet, a font or an image under the
 * folders the build writes to. Anything else (any other method, any path of the API, a pixel at some other path) is a request nobody asked for: T11 says there are no click counters and no
 * personalisation, and a counter would be exactly such a request. (The scripts the page loads lazily when the box is focused are static files, and are left out for that reason.)
 */
const STATIC_GET = /^GET \/(assets|fonts|icons|rive)\/[^?]*$/;
const sentSince = (seen, from) => seen.all.slice(from).filter((e) => !STATIC_GET.test(e));
const group = (p, name) => p.getByRole("group", { name, exact: true });
const trendRow = (p) => group(p, "Trending");
const tryRow = (p) => group(p, "Try");
const chipTexts = (loc) => loc.locator("button.chip-btn").allInnerTexts().then((a) => a.map((t) => t.trim()));
const settle = (p, ms = 400) => p.waitForTimeout(ms);
/** Waits for the feed to have been asked for and answered (or refused), and the idle callback that asks to have run. */
const feedDone = async (p, seen, want = 1) => { await p.waitForFunction(() => true); const t = Date.now(); while (seen.feed < want && Date.now() - t < 8000) await p.waitForTimeout(100); await p.waitForTimeout(500); };
const storedCopy = (p) => p.evaluate((k) => localStorage.getItem(k), COPY_KEY);
const boxValue = (p) => p.locator(".hm-input").inputValue();
const caret = (p) => p.locator(".hm-input").evaluate((el) => ({ start: el.selectionStart, end: el.selectionEnd, len: el.value.length, focused: document.activeElement === el }));
const setTheme = (p, t) => p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), t);
const still = (p) => p.evaluate(() => new Promise((resolve) => { const t0 = performance.now(); const running = () => document.getAnimations().some((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity); let n = 0; const tick = () => { n = running() ? 0 : n + 1; if (n >= 8 || performance.now() - t0 > 4000) resolve(true); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); }));
async function axe(label, p) {
  await still(p);
  await p.evaluate(axeSource);
  const res = await p.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
    const list = (items, impact) => items.map((v) => ({ id: v.id, impact: impact ?? v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(" "), msg: v.nodes[0]?.failureSummary?.split("\n")[1] }));
    return [...list(r.violations), ...list(r.incomplete.filter((i) => i.id === "target-size"), "incomplete")];
  });
  ok(res.length === 0, `axe [${label}]`);
  for (const v of res) console.log(`        ${v.impact} ${v.id} x${v.nodes} ${v.sample} :: ${v.msg}`);
}
const size = (loc) => loc.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
const signIn = async (p) => {
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  await p.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
  await p.getByRole("button", { name: "Continue with Google" }).last().click();
  await p.locator("#hm-h").waitFor({ timeout: 20000 });
};
const pick = async (p, name) => {
  if (new RegExp(name).test(await p.locator(".hm-mode").innerText())) return;
  await p.locator(".hm-mode").click();
  await p.getByRole("menuitemradio", { name: new RegExp("^" + name) }).click();
  await p.getByRole("menu", { name: "What should I do?" }).waitFor({ state: "hidden" });
};
/** Waits (in this process) until `fn()` is true. */
const until = async (fn, ms = 20000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error("timed out waiting for " + fn.toString().slice(0, 80)); await new Promise((r) => setTimeout(r, 100)); } };
const idle = (p) => p.waitForFunction(() => !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 30000 });

try {
  /* ================================================================ 1. when there is no row */
  console.log("no Trending row: network blocked, a stale list, disabled, a missing file, a page that is not ours, a slow answer");
  {
    const A = await open(DESK, { serve: "block" });
    await feedDone(A.page, A.seen);
    ok(A.seen.feed === 1, `the page asked for the list once (${A.seen.feed})`);
    same(await chipTexts(tryRow(A.page)), ENGLISH, `network blocked: the Try row is there, with the ${ENGLISH.length} chips that can be searched as written (a visitor who is not signed in is not offered the ${VIA_AUTO.length} that go through Auto)`);
    ok(await trendRow(A.page).count() === 0 && await A.page.getByText("Why these?").count() === 0, "network blocked: there is no Trending row, and no Why these?");
    ok(await A.page.locator('[role="alert"]').count() === 0 && !/trending|could not|unavailable/i.test(await A.page.locator(".hm-chips").innerText()), "...and no message about it (a failure is silent)");
    ok(await storedCopy(A.page) === null, "...and nothing is kept on the device");
    await A.ctx.close();
  }
  for (const [name, serve] of [["a stale list (past validUntil)", stale()], ["disabled:true", disabledList()], ["HTTP 404", "404"], ["a page that is not ours (HTML)", "html"], ["a list whose pool is 15 days old", makePayload({ poolAsOf: iso(NOW - 15 * 86_400_000).slice(0, 10) })], ["a list with an untidy chip", makePayload({ groups: { global: { chips: [chip("  padded  ")] }, in: { chips: [] } } })]]) {
    const A = await open(DESK, { serve });
    await feedDone(A.page, A.seen);
    await A.page.reload();
    await A.page.locator(".hm-input").waitFor();
    await settle(A.page, 300);
    ok(await trendRow(A.page).count() === 0 && await storedCopy(A.page) === null, `${name}: no Trending row, now or after a reload, and nothing kept`);
    await A.ctx.close();
  }
  {
    // an answer later than the 2.5 s the page waits: it changes nothing on the screen, and it is not kept
    const late = [];
    const A = await open(DESK, { serve: async (route) => { late.push(Date.now()); await new Promise((r) => setTimeout(r, 3000)); await route.fulfill(json(makePayload())).catch(() => {}); } });
    await feedDone(A.page, A.seen);
    const before = await A.page.locator(".hm-chips").innerHTML();
    const box0 = await A.page.locator(".hm-box").boundingBox();
    const top0 = await A.page.locator(".hm-pills").boundingBox();
    await A.page.waitForTimeout(3800);
    ok(await A.page.locator(".hm-chips").innerHTML() === before && JSON.stringify(await A.page.locator(".hm-pills").boundingBox()) === JSON.stringify(top0) && JSON.stringify(await A.page.locator(".hm-box").boundingBox()) === JSON.stringify(box0), "a 3 s answer: nothing on the screen changes, not a chip, not a position");
    ok(await storedCopy(A.page) === null, "...and it was not kept (the page had given up at 2.5 s)");
    await A.page.reload();
    await A.page.locator(".hm-input").waitFor();
    ok(await trendRow(A.page).count() === 0, "...so the next Home screen has no row either");
    await A.ctx.close();
  }

  /* ================================================================ 2. an answer is for the next Home screen */
  console.log("an answer is kept for the next Home screen, never put into the one being read");
  {
    const A = await open(DESK, { serve: makePayload() });
    await feedDone(A.page, A.seen);
    ok(await trendRow(A.page).count() === 0, "a fresh list that arrives while Home is open does not appear in it");
    const kept = await storedCopy(A.page);
    const parsed = kept ? JSON.parse(kept) : null;
    ok(!!parsed && typeof parsed.savedAt === "number" && Math.abs(parsed.savedAt - Date.now()) < 60_000 && parsed.payload.groups.global.chips.length === 12, "...it is kept on the device, with the time it was kept");
    same(Object.keys(parsed?.payload ?? {}).sort(), ["asOf", "disabled", "generatedAt", "groups", "poolAsOf", "validUntil", "version"], "...and holds the contract's fields and nothing else");
    await A.page.reload();
    await A.page.locator(".hm-input").waitFor();
    await trendRow(A.page).waitFor({ timeout: 3000 });
    ok(await trendRow(A.page).count() === 1, "the next time Home is drawn the row is there, from the first paint");
    const first = await chipTexts(trendRow(A.page));
    const texts = first.filter((t) => t !== "Why these?");
    ok(texts.length === 4 && texts.every((t) => NAMES.includes(t)), `four chips of today's global list (${texts.join(" | ")})`);
    await A.page.reload();
    await A.page.locator(".hm-input").waitFor();
    same((await chipTexts(trendRow(A.page))).filter((t) => t !== "Why these?"), texts, "the same four after another reload (the pick is by the file's date, not by chance)");
    await A.ctx.close();
  }
  {
    // a copy on the device older than 24 hours is ignored, and removed; one of 23 hours is used
    const old = await open(DESK, { copy: copyOf(makePayload(), NOW - 25 * 3_600_000), serve: "block" });
    await settle(old.page, 300);
    ok(await trendRow(old.page).count() === 0 && await storedCopy(old.page) === null, "a copy kept 25 hours ago is not used, and is removed");
    await old.ctx.close();
    const young = await open(DESK, { copy: copyOf(makePayload(), NOW - 23 * 3_600_000), serve: "block" });
    ok(await trendRow(young.page).count() === 1, "a copy kept 23 hours ago is used (the network is blocked: nothing else gives the row)");
    await young.ctx.close();
    const gone = await open(DESK, { copy: copyOf(stale(), NOW), serve: "block" });
    ok(await trendRow(gone.page).count() === 0, "a copy whose list has run out is not used, however new the copy is");
    await gone.ctx.close();
    const broken = await open(DESK, { copy: "{not json", serve: "block" });
    ok(await trendRow(broken.page).count() === 0 && await broken.page.locator(".hm-input").isVisible(), "a broken copy is no row and no error");
    await broken.ctx.close();
  }
  {
    // the kill switch: the server says disabled while a copy is on the device: the screen being read keeps what it was drawn with, the copy is cleared, the next screen has no row
    const A = await open(DESK, { copy: copyOf(makePayload()), serve: disabledList() });
    ok(await trendRow(A.page).count() === 1, "disabled: the screen already drawn with the copy keeps its row (nothing is swapped under a reader)");
    await feedDone(A.page, A.seen);
    ok(await storedCopy(A.page) === null, "...but the copy on the device is cleared when the server says the list is switched off");
    await A.page.reload();
    await A.page.locator(".hm-input").waitFor();
    ok(await trendRow(A.page).count() === 0, "...so the next Home screen has no Trending row");
    await A.ctx.close();
  }

  /* ================================================================ 3. the row, the Why panel, the fill */
  console.log("the Trending row, Why these?, and what a chip does");
  const asOfWords = WORDS(makePayload().asOf);
  {
    const A = await open(DESK, { copy: copyOf(makePayload()), serve: makePayload() });
    const p = A.page;
    const row = trendRow(p);
    ok(await row.count() === 1 && await tryRow(p).count() === 1, "both rows are there: Try, and Trending");
    const order = await p.evaluate(() => { const el = (s) => document.querySelector(s); const pos = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING); const box = el(".hm-box"); const tr = el(".hm-chips"); const pills = el(".hm-pills"); return { boxBeforeChips: pos(box, tr), chipsBeforePills: pos(tr, pills), tryBeforeTrending: pos(tr.querySelector("[role=group]"), tr.querySelectorAll("[role=group]")[1]) }; });
    ok(order.boxBeforeChips && order.chipsBeforePills && order.tryBeforeTrending, "the chips are right under the box (before the tool buttons and the cards), Try above Trending");
    const labels = await p.locator(".hm-try").allInnerTexts();
    same(labels.map((t) => t.trim()), ["Try", "Trending"], "the rows are labelled Try and Trending");

    // from here on every request to our own address is counted: looking at the list, opening the panel and filling the box ask our server for nothing (T11: no click counters, no personalisation)
    await feedDone(p, A.seen);
    const mark = A.seen.all.length;
    // the Why panel
    const why = p.getByRole("button", { name: "Why these?" });
    const panelId = await why.getAttribute("aria-controls");
    ok(await why.getAttribute("aria-expanded") === "false" && !!panelId && await p.locator(`#${panelId}`).isHidden(), "Why these? is a button with aria-expanded=false and aria-controls, and the panel is hidden");
    await why.click();
    const panel = p.locator(`#${panelId}`);
    ok(await why.getAttribute("aria-expanded") === "true" && await panel.isVisible(), "pressing it opens the panel (aria-expanded=true)");
    const said = (await panel.innerText()).replace(/\s+/g, " ");
    ok(said.includes("Topics with more journal papers than a year ago (and, for computing, mathematics and physics, more arXiv submissions in the last 30 days than in the same 30 days a year ago). Source: OpenAlex and arXiv, updated " + asOfWords + ". The same file for everyone; with Indian sources on, topics from papers with an Indian author come first. We do not use what you searched. More papers is not better papers: nothing here is checked until you search."), `the panel says what the plan says (computing, mathematics and physics; the last 30 days; the file is the same for everyone, the order is not), with the real date (${asOfWords})`);
    ok(!/this month/.test(said) && !/computing and physics/.test(said) && !/The same list for everyone/.test(said), "...and none of the three phrases that were not true any more");
    const poolDay = makePayload().poolAsOf;
    ok(poolDay !== makePayload().asOf, `(the list's pool is of ${poolDay} and the file of ${makePayload().asOf}: two different days)`);
    const dates = windowsOf(poolDay);
    ok(said.includes(dates), `...and the two windows of dates, said ONCE, the dates of the pool the counts were made in (${dates})`);
    ok(said.split(dates).length === 2, "...once, not once for every chip (it was four times the same two date ranges)");
    ok(!said.includes(windowsOf(makePayload().asOf)), "...and not the dates of the file's own day");
    ok(said.includes("The topic words are OpenAlex’s own keywords, which its indexing assigns to papers, with an AI model that reads each paper’s title and abstract; we use no AI for this list and do not change a word of it."), "...and where the topic words come from: OpenAlex's own keywords, which OpenAlex's model assigns from titles and abstracts; we use no AI for the list and change no word");
    ok(/journal articles with an abstract and fewer than 60 authors, not retracted/.test(said) && /one subfield of OpenAlex/.test(said), "...and what the counts are counts OF (journal articles with an abstract, fewer than 60 authors, one subfield: not all of OpenAlex)");
    const lines = await panel.locator("li").allInnerTexts();
    const wanted = (await chipTexts(row)).filter((t) => t !== "Why these?").map((t) => `${t}: ${COUNTS(452, 176)}`);
    same(lines.map((l) => l.replace(/\s+/g, " ").trim()), wanted, "...and each chip's line is its words, then its two numbers and the subfield's field (the long sentence is the chip's accessible description)");
    const shown = (await chipTexts(row)).filter((t) => t !== "Why these?");
    ok(shown.every((t) => said.includes(t)), "...and every chip of the row is in its list");
    await p.locator(".hm-input").focus();
    await p.keyboard.press("Escape");
    ok(await why.getAttribute("aria-expanded") === "true", "(Escape in the box closes nothing)");
    await why.focus();
    await p.keyboard.press("Escape");
    ok(await why.getAttribute("aria-expanded") === "false" && await panel.isHidden(), "Escape on the button closes it");
    await why.click();
    ok(await why.getAttribute("aria-expanded") === "true", "...and it opens again");
    await why.click();

    same(sentSince(A.seen, mark), [], "opening the panel, reading it, Escape in the box and on the button, closing and opening it again: nothing was asked of our server (no counter, no beacon, no request of any kind)");

    // a chip: accessible name, description, the arrow
    const first = row.locator("button.chip-fill").first();
    const name = (await first.innerText()).trim();
    ok(await p.getByRole("button", { name, exact: true }).count() === 1 && !(await first.getAttribute("aria-label")), `a chip's accessible name is exactly its visible words (${name})`);
    const dby = await first.getAttribute("aria-describedby");
    ok(!!dby && (await p.locator(`#${dby}`).textContent()) === FACTS(poolDay, 452, 176), "...and its description is the two counts, with the dates of the pool they were made in");
    ok(await first.locator("svg[aria-hidden='true']").count() === 1, "...with a small arrow that says it goes into the box (not colour alone)");

    // fill
    await p.locator(".hm-input").fill("");
    await first.click();
    ok(await boxValue(p) === name, `a click puts the chip's exact words in the box (${name})`);
    const c = await caret(p);
    ok(c.focused && c.start === c.len && c.end === c.len, "...with the caret at the end of them, and the focus in the box");
    ok(A.seen.chat.length === 0, "...and sends nothing");
    await settle(p, 600);
    same(sentSince(A.seen, mark), [], "...and nothing else was asked of our server either: a chip's click is not counted, beaconed or logged by the page (no counter, T11), whatever its method or path");
    await p.waitForFunction((n) => new RegExp("is in the box, for papers from " + n + " or later").test(document.querySelector("[data-announcer]")?.textContent ?? ""), YEAR - 1, { timeout: 4000 }).catch(() => {});
    ok(new RegExp(`“${name}” is in the box, for papers from ${SINCE(YEAR - 1)}`).test(await p.locator("[data-announcer]").textContent()), "...and a screen reader is told so, politely, through the page's one status line");
    const yearChip = p.locator('.hm-bar-top .chat-chip[data-kind="since"]');
    ok((await yearChip.innerText()).trim() === `Papers from ${SINCE(YEAR - 1)}`, `a chip beside the box says Papers from ${SINCE(YEAR - 1)}, the words the reply uses for the same filter`);
    const x = yearChip.getByRole("button", { name: `Remove the year filter (papers from ${SINCE(YEAR - 1)})` });
    ok(await x.count() === 1, "...with a button that removes it");
    ok((await p.locator(".hm-input").getAttribute("aria-describedby")).includes((await yearChip.locator("span").first().getAttribute("id"))), "...and the box is described by it");
    await x.click();
    ok(await yearChip.count() === 0 && await boxValue(p) === name, "removing the chip removes the filter and leaves the words");
    same(sentSince(A.seen, mark), [], "...and removing the year filter asks nothing of our server either");
    await settle(p, 200);

    // the request bodies
    await first.click();
    const beforeSend = (await yearChip.innerText()).trim();
    await p.keyboard.press("Enter");
    await p.locator(".chat-turn").first().waitFor();
    same(A.seen.chat.at(-1), { mode: "auto", message: name, sinceYear: YEAR - 1 }, "an unedited chip sent in Auto: the body is mode, message and sinceYear, and nothing else");
    ok(await boxValue(p) === "" && await p.locator('.hm-bar-top .chat-chip[data-kind="since"]').count() === 0, "...after sending the box is empty and the filter is gone from it");
    await idle(p);
    same(sentSince(A.seen, mark), ["POST /api/v1/chat"], "from the first look at the list to the end of the reply, the page asked our server for one thing besides its own files: the search the person sent (nothing for the chip's use)");
    const note = p.locator(".chat-turn").first().locator(".chat-chip");
    ok(/Papers from \d{4} or later/.test(await note.first().innerText()) && (await note.first().innerText()).includes(String(YEAR - 1)), "the reply shows the year chip as the server reports it");
    ok((await note.first().innerText()).trim() === beforeSend, `...in the very words the chip had beside the box (${beforeSend}): one filter, one wording`);
    await p.getByRole("button", { name: "Search again", exact: true }).first().click();
    await idle(p);
    same(A.seen.chat.at(-1), { mode: "auto", message: name, sinceYear: YEAR - 1 }, "Search again asks for the same thing, year included");
    await p.locator(".chat-turn").first().getByRole("button", { name: /Remove the year filter/ }).click();
    await idle(p);
    ok(!("sinceYear" in A.seen.chat.at(-1)), "removing the reply's year chip searches again without a year");
    ok(await p.locator(".chat-turn").first().locator(".chat-chip").count() === 0, "...and the reply no longer shows one");
    same([...A.seen.origins], [ORIGIN], "in all of it only our own origin was called (never OpenAlex, never arXiv)");
    await A.ctx.close();
  }
  {
    // an edited chip, and Search papers: what is sent is what is in the box
    const A = await open(DESK, { copy: copyOf(makePayload()), serve: makePayload() });
    const p = A.page;
    const chipBtn = trendRow(p).locator("button.chip-fill").first();
    const name = (await chipBtn.innerText()).trim();
    await pick(p, "Search papers");
    await chipBtn.click();
    await p.keyboard.type(" in healthcare");
    ok(await boxValue(p) === `${name} in healthcare` && await p.locator('.hm-bar-top .chat-chip[data-kind="since"]').count() === 1, "an edited chip keeps its year filter, which stays in view");
    await p.keyboard.press("Enter");
    await p.locator(".chat-turn").first().waitFor();
    same(A.seen.chat.at(-1), { mode: "search", message: `${name} in healthcare`, sinceYear: YEAR - 1 }, "an edited chip in Search papers: the edited words and the year");
    await idle(p);
    // a message with no chip behind it is byte for byte what it was
    await p.locator(".hm-input").fill("glaucoma screening");
    await p.keyboard.press("Enter");
    await idle(p);
    same(A.seen.chat.at(-1), { mode: "search", message: "glaucoma screening" }, "a message typed by hand has no sinceYear (the first-turn body is what it was)");
    await A.ctx.close();
  }
  {
    // the draft rule: text the person typed is replaced and can be put back
    const A = await open(DESK, { copy: copyOf(makePayload()), serve: makePayload() });
    const p = A.page;
    const chips = trendRow(p).locator("button.chip-fill");
    const one = (await chips.nth(0).innerText()).trim();
    const two = (await chips.nth(1).innerText()).trim();
    await p.locator(".hm-input").fill("my own question about glaucoma screening");
    await chips.nth(0).click();
    ok(await boxValue(p) === one, "a chip replaces what was typed in the box...");
    const back = p.getByRole("button", { name: "Put back what I wrote" });
    ok(await back.count() === 1, "...and Put back what I wrote is offered");
    await chips.nth(1).click();
    ok(await boxValue(p) === two && await back.count() === 1, "a second chip over the first (nothing of the person's changed) replaces it, and the person's own words are still recoverable");
    await back.click();
    ok(await boxValue(p) === "my own question about glaucoma screening", "Put back brings the typed words back, exactly");
    ok(await back.count() === 0 && await p.locator('.hm-bar-top .chat-chip[data-kind="since"]').count() === 0, "...and takes the filter and the button away");
    const c = await caret(p);
    ok(c.focused && c.start === c.len, "...with the caret at the end");
    // a box that is emptied takes the filter with it
    await chips.nth(0).click();
    await p.locator(".hm-input").fill("");
    ok(await p.locator('.hm-bar-top .chat-chip[data-kind="since"]').count() === 0 && await p.locator(".hm-bar-top").count() === 0, "emptying the box takes the year filter away at once (a new question starts clean)");
    // an empty box keeps nothing to put back
    await chips.nth(0).click();
    ok(await back.count() === 0, "a chip over an empty box keeps nothing to put back");
    // Check references is not a search: the chip turns the tool to Auto, so that what is written is searched
    await pick(p, "Check references");
    await chips.nth(2).click();
    ok(/Auto/.test(await p.locator(".hm-mode").innerText()), "a chip pressed while Check references is chosen gives the choice back to Auto");
    await A.ctx.close();
  }

  /* ================================================================ 4. India first, the Try row, small talk, no papers */
  console.log("the Indian sources, the Try chips, small talk, a search with no paper");
  {
    const A = await open(DESK, { copy: copyOf(makePayload()), serve: makePayload(), scope: "india" });
    const p = A.page;
    const texts = (await chipTexts(trendRow(p))).filter((t) => t !== "Why these?");
    ok(texts.length === 4 && texts.every((t) => INDIA.includes(t)), `with the Indian sources on the Indian list comes first (${texts.join(" | ")})`);
    await p.getByRole("button", { name: "Why these?" }).click();
    ok(/\(India\)/.test(await p.locator(".hm-why").innerText()) && /author at an Indian institution/.test(await p.locator(".hm-why").innerText()), "...and the panel says which topics are the Indian ones");
    const indiaLines = (await p.locator(".hm-why li").allInnerTexts()).map((l) => l.replace(/\s+/g, " ").trim());
    ok(indiaLines.length === 4 && indiaLines.every((l) => l.endsWith(`(India): ${COUNTS(90, 20, "Engineering", true)}`)), `...with the scope of an Indian count in each line (${indiaLines[0]})`);
    const d0 = await trendRow(p).locator("button.chip-fill").first().getAttribute("aria-describedby");
    ok((await p.locator(`#${d0}`).textContent()) === FACTS(makePayload().poolAsOf, 90, 20, "Engineering", true), "...and in the chip's description (papers with an author at an Indian institution, in one subfield)");
    await p.getByRole("button", { name: "Why these?" }).click();
    await p.locator(".hm-scope").click();
    const off = (await chipTexts(trendRow(p))).filter((t) => t !== "Why these?");
    ok(off.length === 4 && off.every((t) => NAMES.includes(t)), "turning the switch off gives the global list again");
    // a Try chip is sent at once, as a search chosen by hand, in the place the switch says
    await p.locator(".hm-scope").click();
    await tryRow(p).getByRole("button", { name: ENGLISH[0], exact: true }).click();
    await p.locator(".chat-turn").first().waitFor();
    same(A.seen.chat.at(-1), { mode: "search", message: ENGLISH[0], scope: "india" }, "a Try chip sends a search chosen by hand, in the Indian sources when the switch is on, with no year");
    await A.ctx.close();
  }
  {
    // the intro-free Home for a visitor who is not signed in: the Hinglish chips are not offered (they need Auto, which needs the AI service)
    const A = await open(DESK, { serve: "block" });
    const t = await chipTexts(tryRow(A.page));
    ok(t.length === ENGLISH.length && VIA_AUTO.every((x) => !t.includes(x)), "a visitor who is not signed in is not offered a Hinglish chip");
    await A.ctx.close();
  }
  {
    // a signed-in reader: every chip, a Hinglish one goes through Auto; small talk's chips respect the switch and the busy state; a search with no paper offers the chips
    const ctx = await browser.newContext({ ...DESK });
    const p = await ctx.newPage();
    watch(p);
    const chat = [];
    p.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/v1/chat") chat.push(JSON.parse(r.postData() ?? "{}")); });
    let hold = null;
    await p.route("**/api/v1/chat", async (route) => { if (hold) await hold; await route.continue(); });
    await p.route("**/api/v1/home/trending", (r) => r.abort("failed"));
    await signIn(p);
    await p.locator(".hm-chips").waitFor();
    const all = await chipTexts(tryRow(p));
    same(all, ALL, `a signed-in reader is offered all ${ALL.length} chips, ${VIA_AUTO.length} of them in Hinglish`);
    await tryRow(p).getByRole("button", { name: VIA_AUTO[0], exact: true }).click();
    await p.locator(".chat-turn").first().waitFor();
    same(chat.at(-1), { mode: "auto", message: VIA_AUTO[0] }, "a Hinglish chip goes through Auto, which writes the English words");
    await idle(p);
    // small talk: chips with the switch's place and the busy state
    await pick(p, "Auto");
    await p.locator(".hm-input").fill("hello");
    await p.keyboard.press("Enter");
    await p.locator(".chat-talk").waitFor({ timeout: 15000 });
    await idle(p);
    const talk = p.locator(".chat-talk").last();
    ok((await chipTexts(talk)).length === ALL.length && await talk.getByRole("group", { name: "Try" }).count() === 1, "under a reply to small talk the Try chips are the same, in a group named Try");
    ok((await talk.locator(".hm-try").boundingBox()).width > 200, "(the label is on a line of its own)");
    await p.locator(".hm-scope").click();
    ok(await p.locator(".hm-scope").getAttribute("aria-pressed") === "true", "the Indian sources are switched on");
    await talk.getByRole("button", { name: ENGLISH[0], exact: true }).click();
    await until(() => chat.length === 3);
    same(chat.at(-1), { mode: "search", message: ENGLISH[0], scope: "india" }, "a chip under small talk searches in the Indian sources when the switch is on (it did not)");
    await idle(p);
    // busy: the chips of the reply above wait while another reply is written
    let release;
    hold = new Promise((r) => { release = r; });
    await p.locator(".hm-scope").click();
    await p.locator(".hm-input").fill("hello");
    await p.keyboard.press("Enter");
    await p.waitForFunction(() => document.querySelector('.chat-turn[data-status="working"]'));
    const oldTalk = p.locator(".chat-talk").first();
    ok(await oldTalk.locator("button.chip-btn:disabled").count() === ALL.length, "while a reply is being written, the chips under the reply above are disabled (a message waits for the one before it)");
    release();
    hold = null;
    await idle(p);
    ok(await oldTalk.locator("button.chip-btn:disabled").count() === 0, "...and they work again when it is done");
    // a search with no paper
    await pick(p, "Search papers");
    await p.locator(".hm-input").fill("nothing at all");
    await p.keyboard.press("Enter");
    await p.locator(".chat-note[data-kind=nothing]").waitFor({ timeout: 20000 });
    await idle(p);
    const nothing = p.locator(".chat-turn").last();
    ok(/Nothing was found/.test(await nothing.locator(".chat-note[data-kind=nothing]").innerText()) && await nothing.locator(".result").count() === 0, "a finished search with no paper says so plainly, and shows no invented paper");
    ok(await nothing.getByRole("group", { name: "Or try one of these" }).count() === 1 && (await chipTexts(nothing.getByRole("group", { name: "Or try one of these" }))).length === ALL.length, "...and offers the chips");
    await p.waitForFunction(() => /No papers were found/.test(document.querySelector("[data-announcer]")?.textContent ?? ""), null, { timeout: 4000 }).catch(() => {});
    const told = (await p.locator("[data-announcer]").textContent()) ?? "";
    ok(told.includes("No papers were found. You can change the words, or try one of the examples.") && !/Papers ready/.test(told), `...and a screen reader is told that nothing was found and the way on (it was told "Papers ready, 0 papers."): "${told.trim()}"`);
    await nothing.getByRole("button", { name: ENGLISH[0], exact: true }).click();
    await until(() => chat.length === 6 && chat.at(-1).message === ENGLISH[0]);
    ok(true, "...and a click on one searches it");
    await idle(p);
    // a reply that ends while its cards are still counting their citations up must not leave the count at a wrong number (Stop right after the cards appear: the badges read 16, 13, 10, 6, 3 for 50, 40, 30, 20, 10)
    await pick(p, "Search papers");
    await p.locator(".hm-input").fill("slowly glaucoma");
    await p.keyboard.press("Enter");
    // Stop is pressed from inside the page one frame after the five cards of the final list are drawn (the first two cards are the early list of the sources that answered first, and a Stop then keeps none of
    // them): a count-up of 50 lasts 0.35 s, and Playwright's own click (it waits for the button to be stable) came after it was over. Before the fix the badges read 25, 20, 15, 10, 5 for 50, 40, 30, 20, 10.
    const stoppedAt = await p.evaluate(() => new Promise((resolve) => {
      const seen = (sel) => document.querySelector(sel);
      const stopNow = () => {
        if (document.querySelectorAll('.chat-turn[data-status="working"] .result').length < 5) return false;
        const t0 = performance.now();
        requestAnimationFrame(() => { seen('button[aria-label="Stop answering"]')?.click(); resolve(Math.round(performance.now() - t0)); });
        return true;
      };
      if (stopNow()) return;
      const mo = new MutationObserver(() => { if (stopNow()) mo.disconnect(); });
      mo.observe(document.body, { childList: true, subtree: true });
    }));
    note(`Stop was pressed ${stoppedAt} ms after the first card was drawn`);
    await p.locator('.chat-turn[data-status="stopped"]').waitFor({ timeout: 10000 });
    await p.waitForTimeout(2200); // longer than the longest count-up (0.9 s)
    const counts = () => p.locator('.chat-turn[data-status="stopped"] .result .badge').evaluateAll((els) => els.map((e) => e.textContent.trim()).filter((t) => /citation/.test(t)).map((t) => t.replace(/\D+/g, "")));
    const shownAfterStop = await counts();
    note(`after the Stop and 2.2 s: the badges read ${shownAfterStop.join(", ")}`);
    await p.reload({ waitUntil: "domcontentloaded" });
    await p.locator('.chat-turn[data-status="stopped"] .result').first().waitFor({ timeout: 15000 });
    const stored = await counts();
    ok(stored.length >= 3 && shownAfterStop.length === stored.length && JSON.stringify(shownAfterStop) === JSON.stringify(stored), `Stop right after the cards appear: every card ends on its real citation count, as the stored reply shows it (${shownAfterStop.join(", ")} against ${stored.join(", ")})`);
    await ctx.close();
  }

  /* ================================================================ 5. phone: the chips are near the box, a fill does not raise the keyboard, the chat title stays */
  console.log("a phone");
  {
    const A = await open(PHONE, { copy: copyOf(makePayload()), serve: makePayload() });
    const p = A.page;
    const geo = await p.evaluate(() => { const r = (s) => document.querySelector(s).getBoundingClientRect(); return { box: r(".hm-box").bottom, firstChip: r(".hm-starters .chip-btn").top, trendTop: r(".hm-trending").top, pills: r(".hm-pills").top, h: innerHeight }; });
    ok(geo.firstChip < geo.h - 60 && geo.firstChip - geo.box < 140, `the first Try chip is on the first screen, just under the box (${Math.round(geo.firstChip)} px of ${geo.h}; it was a screen below)`);
    ok(geo.trendTop < geo.pills, "...and Trending comes before the tool buttons");
    // scroll so that the box is out of sight above and a chip is still in reach
    await p.evaluate(() => window.scrollTo(0, document.querySelector(".hm-box").getBoundingClientRect().bottom + window.scrollY + 40));
    await settle(p, 300);
    ok(await p.locator(".hm-box").evaluate((el) => el.getBoundingClientRect().bottom <= 0), "(the box is above the window)");
    await trendRow(p).locator("button.chip-fill").first().click();
    await settle(p, 300);
    const st = await p.evaluate(() => { const r = document.querySelector(".hm-box").getBoundingClientRect(); const el = document.querySelector(".hm-input"); return { inView: r.bottom > 0 && r.top < innerHeight, focused: document.activeElement === el, start: el.selectionStart, len: el.value.length }; });
    ok(st.inView && !st.focused && st.start === st.len, "on a phone a chip brings the box into view and puts the caret at the end, and does not raise the keyboard (the box is not focused)");
    ok(A.seen.chat.length === 0 && await p.locator('.hm-bar-top .chat-chip[data-kind="since"]').count() === 1, "...and sends nothing");
    // the sizes: every control in the rows is at least 36 px high, and 24 px wide
    const sizes = await size(p.locator(".hm-chips button, .hm-chips .chip-btn"));
    ok(sizes.length >= 10 && sizes.every(([w, h]) => h >= 36 && w >= 24), `every chip and Why these? is at least 36 px high on a phone (${Math.min(...sizes.map((s) => s[1]))} px)`);
    const small = await size(p.locator(".hm-bar-top .chat-chip-x, .hm-putback"));
    ok(small.length >= 1 && small.every(([w, h]) => w >= 24 && h >= 24), "the remove button of the year chip is at least 24 px by 24 (WCAG 2.5.8)");
    await A.ctx.close();
  }
  {
    // WHERE the fill is seen. The Trending row is far below the box (about 980 px down on a phone), so the box is usually above the window when a chip is pressed. A touch screen brought the box top to the top of the
    // window, under the opaque bar of the page (the year filter, the first row of the box, was hidden under it); a mouse brought nothing into view at all (reviewer, 4 Nov 2026)
    console.log("a fill puts the box where it can be seen: clear of the bar on a phone, and on a desktop window too");
    const seeSince = (p) => p.evaluate(() => { const c = document.querySelector('.hm-bar-top .chat-chip[data-kind="since"]'); const r = c?.getBoundingClientRect(); const bar = document.querySelector(".ws-top"); const barBottom = bar && getComputedStyle(bar).display !== "none" ? bar.getBoundingClientRect().bottom : 0; const box = document.querySelector(".hm-box").getBoundingClientRect(); return { has: !!c, top: r?.top, bottom: r?.bottom, barBottom, vh: innerHeight, boxTop: box.top, boxBottom: box.bottom }; });
    for (const [name, vp, where] of [["phone, the box wholly above the window", PHONE, "above"], ["phone, the box's top under the bar (a few pixels of it 'in view')", PHONE, "under"], ["desktop (a window 600 px high: in a taller one the page cannot be scrolled far enough to lose the box), the box wholly above the window", { viewport: { width: 1280, height: 600 } }, "above"]]) {
      const A = await open(vp, { copy: copyOf(makePayload()), serve: makePayload() });
      const p = A.page;
      await p.evaluate((w) => { const box = document.querySelector(".hm-box").getBoundingClientRect(); window.scrollTo(0, w === "above" ? box.bottom + window.scrollY + 40 : box.top + window.scrollY - 20); }, where);
      await settle(p, 300);
      const before = await seeSince(p);
      ok(where === "above" ? before.boxBottom <= 0 : before.boxTop > 0 && before.boxTop < 40, `${name}: (set up: the box is at ${Math.round(before.boxTop)}..${Math.round(before.boxBottom)} px of a ${before.vh} px window)`);
      await trendRow(p).locator("button.chip-fill").first().click();
      await settle(p, 400);
      const s = await seeSince(p);
      ok(s.has && s.top >= s.barBottom - 1 && s.bottom <= s.vh, `${name}: after a chip the year filter beside the box is in view, clear of the bar (it is at ${Math.round(s.top)}..${Math.round(s.bottom)} px, the bar ends at ${Math.round(s.barBottom)}, the window is ${s.vh})`);
      ok(s.boxTop >= s.barBottom - 1 && s.boxBottom <= s.vh + 1, `${name}: ...and the whole box is in view (${Math.round(s.boxTop)}..${Math.round(s.boxBottom)})`);
      await A.ctx.close();
    }
  }
  {
    // a keyboard press on a chip moves the focus to the box, whatever the PRIMARY pointer is (a tablet or a phone with a hardware keyboard); Put back what I wrote leaves the focus in the box and not on the body
    console.log("a chip pressed from the keyboard on a touch device, and Put back on a phone");
    const A = await open(PHONE, { copy: copyOf(makePayload()), serve: makePayload() });
    const p = A.page;
    const chipBtn = trendRow(p).locator("button.chip-fill").first();
    const name = (await chipBtn.innerText()).trim();
    ok(await p.evaluate(() => matchMedia("(pointer: coarse)").matches), "(the primary pointer of this context is coarse)");
    await chipBtn.focus();
    await p.keyboard.press("Enter");
    await settle(p, 250);
    let c = await caret(p);
    ok(await boxValue(p) === name && c.focused && c.start === c.len, "Enter on a chip (a hardware keyboard on a touch device) fills the box AND puts the focus in it, the caret at the end (the person is typing: no keyboard is hidden by it)");
    await chipBtn.focus();
    await p.keyboard.press("Space");
    await settle(p, 250);
    c = await caret(p);
    ok(c.focused, "...and so does Space");
    // a tap still does not raise the keyboard (T9: not tried on a real phone)
    await p.locator(".hm-input").fill("my own question about glaucoma");
    await p.locator(".hm-input").blur();
    await chipBtn.tap();
    await settle(p, 250);
    c = await caret(p);
    ok(!c.focused && await boxValue(p) === name, "a TAP on a chip still does not focus the box (no keyboard is raised)");
    const back = p.getByRole("button", { name: "Put back what I wrote" });
    ok(await back.count() === 1, "(Put back what I wrote is offered)");
    await back.tap();
    await settle(p, 250);
    c = await caret(p);
    ok(await boxValue(p) === "my own question about glaucoma" && c.focused && c.start === c.len && await back.count() === 0, "Put back what I wrote, pressed on a phone, brings the words back and leaves the focus in the box with the caret at the end (the button is gone: the focus did not drop to the page)");
    ok(await p.evaluate(() => document.activeElement !== document.body), "...the focus is not on the body");
    await A.ctx.close();
  }
  {
    // the draft belongs to the text: leaving Home and coming back (the browser's Back button after a tool or a page was opened) keeps the year filter and the way back with the words
    console.log("leaving Home and coming back keeps the year filter and Put back with the text");
    const A = await open(DESK, { copy: copyOf(makePayload()), serve: makePayload() });
    const p = A.page;
    const chipBtn = trendRow(p).locator("button.chip-fill").first();
    const name = (await chipBtn.innerText()).trim();
    await p.locator(".hm-input").fill("my own question about glaucoma");
    await chipBtn.click();
    ok(await p.locator('.hm-bar-top .chat-chip[data-kind="since"]').count() === 1 && await p.getByRole("button", { name: "Put back what I wrote" }).count() === 1, "(a chip is in the box with its filter, and the person's words are kept)");
    await p.locator('.ws-rail a[href="/library"]').click();
    await p.waitForURL(/\/library$/);
    await p.locator(".hm-input").waitFor({ state: "detached" });
    await p.goBack();
    await p.locator(".hm-input").waitFor();
    await settle(p, 300);
    ok(await boxValue(p) === name, "back on Home the box still has the chip's words");
    ok(await p.locator('.hm-bar-top .chat-chip[data-kind="since"]').count() === 1, "...and the year filter is still beside it (without it Enter searched old papers: the failure the filter is for)");
    ok(await p.getByRole("button", { name: "Put back what I wrote" }).count() === 1, "...and Put back what I wrote is still offered");
    await p.getByRole("button", { name: "Put back what I wrote" }).click();
    ok(await boxValue(p) === "my own question about glaucoma" && await p.locator('.hm-bar-top .chat-chip[data-kind="since"]').count() === 0, "...and it still brings the person's own words back");
    // a fresh start (Home in the rail) starts clean: the text and the filter go together
    await trendRow(p).locator("button.chip-fill").nth(1).click();
    await p.locator('.ws-rail a[href="/library"]').click();
    await p.waitForURL(/\/library$/);
    await p.locator('.ws-rail a[href="/"]').first().click();
    await p.locator(".hm-input").waitFor();
    await settle(p, 300);
    ok(await boxValue(p) === "" && await p.locator('.hm-bar-top .chat-chip[data-kind="since"]').count() === 0 && await p.getByRole("button", { name: "Put back what I wrote" }).count() === 0, "Home from the rail starts clean: the text, the filter and the kept words are all gone together");
    await A.ctx.close();
  }
  {
    // at 320 px a Try chip that is longer than the line wraps to two lines inside its capsule: its lines are centred, as the one-line chips beside it are (they were left-aligned in a full-width pill)
    const A = await open({ viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, { copy: copyOf(makePayload()), serve: makePayload() });
    const chips = await A.page.locator(".hm-starters .chip-btn").evaluateAll((els) => els.map((el) => ({ h: el.getBoundingClientRect().height, align: getComputedStyle(el).textAlign, text: el.textContent.trim().slice(0, 30) })));
    const wrapped = chips.filter((c) => c.h > 44);
    ok(chips.length >= 4 && chips.every((c) => c.align === "center"), `at 320 px every chip's text is centred, the ${wrapped.length} that wrap to two lines too (${[...new Set(chips.map((c) => c.align))].join(", ")})`);
    await A.ctx.close();
  }
  {
    // the chat title and New chat stay reachable on a phone, the question is not under the bar, and the box has its fade
    const ctx = await browser.newContext({ ...PHONE });
    const p = await ctx.newPage();
    watch(p);
    await p.route("**/api/v1/home/trending", (r) => r.abort("failed"));
    await p.goto(BASE + "/home", { waitUntil: "load" });
    await pick(p, "Search papers");
    await p.locator(".hm-input").fill("glaucoma screening");
    await p.keyboard.press("Enter");
    await p.locator(".chat-turn").first().waitFor();
    await idle(p);
    await settle(p, 600);
    const top = () => p.evaluate(() => { const b = (s) => document.querySelector(s)?.getBoundingClientRect(); const bar = b(".ws-top"); const head = b(".chat-head"); const btn = b(".chat-head .btn"); const q = b(".chat-bubble"); return { bar: bar?.bottom, head: head ? [head.top, head.bottom] : null, btn: btn ? [btn.top, btn.bottom, btn.height] : null, q: q?.top, y: scrollY, vh: innerHeight }; });
    let t = await top();
    ok(t.btn && t.btn[0] >= t.bar - 1 && t.btn[1] <= t.vh, `after a question the chat title row and New chat are in view (New chat at ${Math.round(t.btn?.[0])}..${Math.round(t.btn?.[1])} px, the bar ends at ${Math.round(t.bar)})`);
    ok(t.q >= t.head[1] - 1, `...and the question is not under the bar or the title row (it starts at ${Math.round(t.q)}, the row ends at ${Math.round(t.head[1])})`);
    ok(t.btn[2] >= 30 && t.btn[1] - t.btn[0] < 60, "New chat is on one line");
    await p.evaluate(() => window.scrollTo(0, 400));
    await settle(p, 300);
    t = await top();
    ok(t.btn[0] >= t.bar - 1 && t.btn[1] <= t.vh, "...and stays in reach when the page is scrolled further");
    await p.getByRole("button", { name: "New chat" }).first().click();
    await p.locator(".hm-title").waitFor();
    ok(await p.locator(".chat-list").count() === 0, "...and New chat works from there");
    ok(await p.evaluate(() => getComputedStyle(document.querySelector(".ws-top")).backdropFilter === "none" && !/rgba\(.*0\.\d+\)/.test(getComputedStyle(document.querySelector(".ws-top")).backgroundColor)), "the bar of the window is opaque (the blue bubble no longer shows through it)");
    await ctx.close();
  }
  {
    // the soft fade over the sticky box costs no layout: the box, the page and its height are the same with and without it
    const ctx = await browser.newContext({ ...DESK });
    const p = await ctx.newPage();
    watch(p);
    await p.route("**/api/v1/home/trending", (r) => r.abort("failed"));
    await p.goto(BASE + "/home", { waitUntil: "load" });
    await pick(p, "Search papers");
    await p.locator(".hm-input").fill("glaucoma screening");
    await p.keyboard.press("Enter");
    await p.locator(".chat-turn").first().waitFor();
    await idle(p);
    await still(p);
    const probe = () => p.evaluate(() => { const r = document.querySelector(".hm-box").getBoundingClientRect(); return [Math.round(r.top * 10), Math.round(r.height * 10), document.documentElement.scrollHeight, getComputedStyle(document.querySelector(".hm-box"), "::before").position, getComputedStyle(document.querySelector(".hm-box"), "::before").pointerEvents, getComputedStyle(document.querySelector(".hm-box"), "::after").position]; });
    const withFade = await probe();
    const off = await p.addStyleTag({ content: ".hm-box::before, .hm-box::after { content: none !important; }" });
    const without = await probe();
    await off.evaluate((el) => el.remove());
    same(withFade.slice(0, 3), without.slice(0, 3), "with and without the fade the box and the page are the same size and in the same place");
    ok(withFade[3] === "absolute" && withFade[4] === "none" && withFade[5] === "absolute", "the fade is out of the layout and lets a click through");
    await ctx.close();
  }

  /* ================================================================ 6. the real route through the Worker */
  console.log("the real route, through the Worker");
  {
    const kv = async (body) => { const res = await fetch(`${ORIGIN}/api/v1/dev/kv`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!res.ok) throw new Error(`dev/kv ${body.op}: HTTP ${res.status}`); return res.json(); };
    try {
      await kv({ op: "put", key: "trending:v1", value: JSON.stringify(makePayload()), ttl: 3600 });
      const ctx = await browser.newContext({ ...DESK });
      // a cookie of this site is on the device (the sign-in's is): the request for the list must still go without it
      await ctx.addCookies([{ name: "probe", value: "1", url: BASE }]);
      const p = await ctx.newPage();
      watch(p);
      const seen = { feed: [], origins: new Set() };
      p.on("request", async (r) => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol)) seen.origins.add(u.origin); if (u.pathname === "/api/v1/home/trending") seen.feed.push({ method: r.method(), cookie: (await r.allHeaders()).cookie ?? null }); });
      await p.goto(BASE + "/home", { waitUntil: "load" });
      await p.locator(".hm-input").waitFor();
      const t = Date.now();
      while (!(await storedCopy(p)) && Date.now() - t < 9000) await p.waitForTimeout(150);
      ok(!!(await storedCopy(p)) && await trendRow(p).count() === 0, "first visit: the Worker's list is asked for after the first paint and kept, and Home as drawn has no Trending row");
      await p.reload();
      await trendRow(p).waitFor({ timeout: 4000 });
      const live = await chipTexts(trendRow(p));
      ok(live.length === 4 && live.every((t) => NAMES.includes(t)), "after a reload the row is there with four of the Worker's own chips");
      ok(seen.feed.length >= 1 && seen.feed.every((f) => f.method === "GET" && f.cookie === null), "the list is asked for with GET and no cookie");
      same([...seen.origins], [ORIGIN], "only our own origin was called, ever (never OpenAlex, never arXiv)");
      await ctx.close();
      // the kill flag: a visitor with no copy never gets the list, one with a copy loses it
      await kv({ op: "put", key: "trending:v1:off", value: "1", ttl: 3600 });
      const c2 = await browser.newContext({ ...DESK });
      const q = await c2.newPage();
      watch(q);
      await c2.addInitScript(([k, v]) => { if (!sessionStorage.getItem("__s")) { sessionStorage.setItem("__s", "1"); localStorage.setItem(k, v); } }, [COPY_KEY, copyOf(makePayload())]);
      await q.goto(BASE + "/home", { waitUntil: "load" });
      await q.locator(".hm-input").waitFor();
      const t2 = Date.now();
      while ((await storedCopy(q)) && Date.now() - t2 < 9000) await q.waitForTimeout(150);
      ok(await storedCopy(q) === null, "with the kill flag set the copy on the device is cleared");
      await q.reload();
      await q.locator(".hm-input").waitFor();
      ok(await trendRow(q).count() === 0, "...and the next Home screen has no Trending row");
      await c2.close();
    } finally {
      await kv({ op: "delete", key: "trending:v1" }).catch(() => {});
      await kv({ op: "delete", key: "trending:v1:off" }).catch(() => {});
    }
  }

  /* ================================================================ 7. keyboard, axe, reduced motion, the footer */
  console.log("keyboard, axe in three themes at two widths, reduced motion, the footer");
  {
    const A = await open(DESK, { copy: copyOf(makePayload()), serve: makePayload() });
    const p = A.page;
    await p.locator(".hm-input").focus();
    const seq = [];
    for (let i = 0; i < 24; i++) {
      await p.keyboard.press("Tab");
      seq.push(await p.evaluate(() => { const e = document.activeElement; return e?.closest(".hm-chips") ? (e.closest("[role=group]")?.querySelector(".hm-try")?.textContent ?? "chips") + ":" + (e.textContent ?? "").trim() : e?.className ?? ""; }));
    }
    const ix = (re) => seq.findIndex((s) => re.test(s));
    const i1 = ix(/^Try:/);
    const i2 = ix(/^Trending:.+/);
    const iw = ix(/Why these/);
    ok(i1 > -1 && i2 > i1 && iw > i2, `the Tab order is the box, then the Try chips, then the Trending chips, then Why these? (${i1} < ${i2} < ${iw})`);
    ok(seq.slice(i1, i2).filter((s) => /^Try:/.test(s)).length === ENGLISH.length && seq.slice(i2, iw).filter((s) => /^Trending:/.test(s)).length === 4, `...${ENGLISH.length} Try chips, four Trending chips`);
    // axe: the rows, the open panel, and a filled box with its filter and the way back
    await p.getByRole("button", { name: "Why these?" }).click();
    await p.locator(".hm-input").fill("my own question about glaucoma");
    await trendRow(p).locator("button.chip-fill").first().click();
    await still(p);
    await p.screenshot({ path: OUT + "1-filled-1280.png" });
    for (const theme of ["light", "dark", "read"]) {
      await setTheme(p, theme);
      await settle(p, 400);
      await axe(`Home with both rows, the panel open, a filled box, ${theme}, 1280`, p);
    }
    const sz = await size(p.locator(".hm-chips button"));
    ok(sz.every(([w, h]) => h >= 36 && w >= 24), `at 1280 every chip and the Why button are at least 36 px high (${Math.min(...sz.map((s) => s[1]))} px)`);
    await A.ctx.close();
    const B = await open(PHONE, { copy: copyOf(makePayload()), serve: makePayload() });
    const q = B.page;
    await q.getByRole("button", { name: "Why these?" }).click();
    await q.locator(".hm-input").fill("my own question about glaucoma");
    await trendRow(q).locator("button.chip-fill").first().click();
    await still(q);
    ok(await q.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), "at 390 there is no sideways scroll");
    await q.screenshot({ path: OUT + "2-filled-390.png", fullPage: true });
    for (const theme of ["light", "dark", "read"]) {
      await setTheme(q, theme);
      await settle(q, 400);
      await axe(`Home with both rows, the panel open, a filled box, ${theme}, 390`, q);
    }
    await B.ctx.close();
  }
  {
    // reduced motion: the rows are there at once, in their final state, and nothing is left running
    const A = await open({ ...DESK, reducedMotion: "reduce" }, { copy: copyOf(makePayload()), serve: makePayload() });
    const p = A.page;
    await p.waitForTimeout(150);
    const state = await p.evaluate(() => ({ opacity: getComputedStyle(document.querySelector(".hm-chips")).opacity, running: document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity && document.querySelector(".hm-chips")?.contains(a.effect?.target ?? null)).length }));
    ok(state.opacity === "1" && state.running === 0, "with reduced motion the chips are drawn in their final state, with nothing moving");
    await trendRow(p).locator("button.chip-fill").first().click();
    ok((await boxValue(p)).length > 0, "...and a chip fills the box as it does without it");
    await A.ctx.close();
  }
  {
    const ctx = await browser.newContext({ ...DESK });
    const p = await ctx.newPage();
    watch(p);
    await p.route("**/api/v1/home/trending", (r) => r.abort("failed"));
    await p.goto(BASE + "/home", { waitUntil: "load" });
    await p.locator("footer").first().waitFor();
    const f = (await p.locator("footer").first().innerText()).replace(/\s+/g, " ");
    const links = await p.locator("footer a[href^='https']").evaluateAll((a) => a.map((x) => [x.textContent.trim(), x.href]));
    ok(/Metadata from OpenAlex, Semantic Scholar, Crossref, PubMed, arXiv, CORE and DOAJ\./.test(f), "the footer names OpenAlex, arXiv and DOAJ with the others");
    // arXiv's own page for API users (https://info.arxiv.org/help/api/index.html, read 4 Nov 2026) asks for exactly this sentence "on your product"; its terms of use page, which the first reading looked at, does not
    ok(f.includes("Thank you to arXiv for use of its open access interoperability."), "...and says the sentence arXiv asks API users to say: Thank you to arXiv for use of its open access interoperability.");
    ok(links.some(([n, h]) => n === "DOAJ" && h === "https://doaj.org/") && links.some(([n, h]) => n === "arXiv" && h === "https://arxiv.org/") && links.some(([n, h]) => n === "OpenAlex" && h === "https://openalex.org/"), "...each a link to the source's own site");
    await ctx.close();
  }

  /* ================================================================ 8. layout shift of Home with a delayed list and with a copy */
  console.log("layout shift of Home (processor four times slower, 1.6 Mbit/s, 150 ms), limit 0.1");
  const shift = async (label, o, vp, mobile) => {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage();
    watch(page);
    await ctx.addInitScript(([k, v]) => {
      if (v && !sessionStorage.getItem("__s")) { sessionStorage.setItem("__s", "1"); localStorage.setItem(k, v); }
      const m = (window.__cls = { cls: 0, list: [] });
      try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) { m.cls += e.value; m.list.push(`${e.value.toFixed(3)}: ${(e.sources ?? []).map((s) => (s.node ? s.node.nodeName.toLowerCase() + (s.node.className ? "." + String(s.node.className).split(" ")[0] : "") : "?")).join(", ")}`); } })).observe({ type: "layout-shift", buffered: true }); } catch { /* not supported */ }
    }, [COPY_KEY, o.copy ?? null]);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.route("**/api/v1/home/trending", async (route) => { if (o.delay) await new Promise((r) => setTimeout(r, o.delay)); await route.fulfill(json(makePayload())).catch(() => {}); });
    await page.goto(BASE + "/home", { waitUntil: "load" });
    await page.waitForTimeout(4200);
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h; y += vp.height / 2) { await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), y); await page.waitForTimeout(100); }
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => window.__cls);
    const rows = await page.locator(".hm-trending").count();
    console.log(`        ${label}: layout shift ${m.cls.toFixed(3)}${m.cls > 0.005 ? "  (" + m.list.join("; ") + ")" : ""}, Trending row ${rows ? "shown" : "not shown"}`);
    ok(m.cls <= 0.1, `${label}: layout shift ${m.cls.toFixed(3)} is within 0.1`);
    await ctx.close();
    return { cls: m.cls, rows };
  };
  await shift("desktop, no copy, the list answers after 3 s", { delay: 3000 }, { width: 1360, height: 900 }, false);
  await shift("desktop, no copy, the list answers at once", {}, { width: 1360, height: 900 }, false);
  await shift("desktop, with a copy (the row is there at the first paint)", { copy: copyOf(makePayload()) }, { width: 1360, height: 900 }, false);
  await shift("phone, no copy, the list answers after 3 s", { delay: 3000 }, { width: 390, height: 844 }, true);
  await shift("phone, with a copy (the row is there at the first paint)", { copy: copyOf(makePayload()) }, { width: 390, height: 844 }, true);

  /* ================================================================ the page itself */
  ok(errors.length === 0, `no console errors or page errors (${errors.length})`);
  for (const e of errors.slice(0, 8)) console.log("        " + e);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
} finally {
  idp.close();
  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall trending browser checks passed");
  process.exit(failures ? 1 : 0);
}
