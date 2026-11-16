// Browser gate for the SPEED of a long conversation (plan C2, docs/design/chatview-and-trending.md). A stored chat of 20 turns with 20 paper cards each (about 22,000 DOM nodes) is opened in the built app with
// the processor four times slower (CDP), and the stand-in model streams one reply under it. Measured with the browser's own instruments: Event Timing at 16 ms (what pressing a key costs with nothing being
// written and while the reply is written), long tasks and frames of the stream, layout shift from 600 ms after the question to the end, and CDP's own counters (script, layout and style time); how long the stored
// chat takes to appear; a scroll-up probe through turns the browser skipped (content-visibility: nothing on screen may move but by the scroll, the page may not change height, a card must keep a real size); what the
// skipping must not take away (print, the Tab key, the focus, a jump to a cited card and the ring round it); long words at 320 and 360 px; how many live regions the conversation holds. The same reply is first
// streamed under a chat of ONE turn, in the same run, and what the long chat costs a reply is held against that (see LIMIT: a busy machine slows both alike).
// What it cannot say: it is a lab run on a development machine (the lines are loose on purpose, and the numbers are printed so the trend can be read), headless Edge is not a phone, and nothing in it used a
// screen reader.
// Needs the Worker with the fake identity provider and the offline stand-ins: `npm run integration -w apps/api -- --browser` starts it.
//   node e2e/chat-perf.mjs [baseUrl]    (default http://localhost:8788)
import { BASE, countFailure, failed, finish, launch, ok, startIdp } from "./lib/browser.mjs";

/**
 * The lines. A machine that is busy with other work runs this page three to five times slower than a quiet one (the same build opened the stored chat in 1.4 s and in 7 s on 3 and 4 Nov 2026), so a line in
 * milliseconds alone either flakes or means nothing. Each of the lines that depend on the processor therefore has TWO: a wide one in milliseconds, which only a page that has become slow on any machine crosses,
 * and one against the same reply under a chat of ONE turn, run first in this same run (what a key press costs, what the longest task is, how long a frame takes: at most so many times that, and a small slack on
 * top). A long chat may cost a reply more than a short one, but not ten times more. The first screen's layout and style time is held to a share of its script time (the skipping takes it away, a machine's speed does not).
 * What the page did before the work on it, measured one run after another with the new one on a quiet machine: opened in 2.9 to 3.0 s (layout and style 1.2 s of 1.5 s of script), a key took 0.7 to 0.8 s with
 * nothing being written and 1.8 to 2.4 s during the stream (nine to twenty times the one-turn chat's), the longest task of the stream was 1.0 to 1.2 s, the slowest frame 1.4 to 1.5 s. The plan's starting lines
 * (open in 1.2 s, a key in 200 ms, a task of 150 ms) were measured in a bare page of plain cards; with the page's real cards, which are motion components with a menu each, a reply of five cards alone is a task of
 * about 150 to 250 ms at this speed, so those are not held.
 */
const LIMIT = { mountMs: 10000, mountPaintShare: 0.35, keyIdleMs: 600, keyStreamMs: 1500, longTaskMs: 800, frameMs: 1500, relIdle: 3, relStream: 4, relLong: 3, relFrame: 3, slackMs: 100, cls: 0.1, phoneCls: 0.35, lateJump: 50, scrollJump: 40, heightDrift: 0.02, liveRegions: 1 };
const TURNS = 20;
const CARDS = 20;
const SLOW = 4;

const note = (msg) => console.log(`        ${msg}`);

/* ---------------------------------------------------------------- the stored conversation */

const LONG_NAME = "Dichlorodiphenyltrichloroethane"; // 31 characters: one word that cannot break
const LONG_URL = `https://example.org/${"a-very-long-address-".repeat(4)}end`; // one 100 character token with no space in it
const TOPICS = ["glaucoma screening", "diabetic retinopathy", "asthma in children", "tuberculosis treatment", "dengue vaccines", "hypertension in India", "iron deficiency anaemia", "sleep and memory", "air pollution and lungs", "stroke rehabilitation", "breast cancer screening", "antibiotic resistance", "childhood obesity", "depression in adolescents", "maternal mortality", "malaria nets", "cataract surgery", "thyroid disease", "oral health in schools", "snakebite treatment"];
const SENTENCES = [
  "We enrolled adults from three districts and followed them for twelve months.",
  "The main outcome was measured at baseline and again at the end of the study period.",
  "Differences between the groups were small but consistent across the sites.",
  "Cost per person was lower with the community based approach than with clinic visits.",
  "Results were similar after adjusting for age, sex and income.",
  "Few adverse events were reported and none were judged related to the intervention.",
  "The authors note that follow-up was shorter than planned in two of the sites.",
  "A larger trial would be needed to confirm the effect in older people.",
];
/** An abstract as it is kept (cut at 600 characters), its length depending on the paper. */
const abstractOf = (t, i) => {
  let s = "";
  for (let k = 0; s.length < 380 + ((t * 7 + i * 31) % 220); k++) s += `${SENTENCES[(t + i + k) % SENTENCES.length]} `;
  return `${s.trim().slice(0, 600)}${i === 0 ? ` See ${LONG_URL} for the data.` : ""}`;
};
const paperOf = (t, i) => ({
  id: `doi:10.1000/perf.${t}.${i}`,
  doi: `10.1000/perf.${t}.${i}`,
  pmid: null,
  title: i === 0 ? `Effects of ${LONG_NAME} exposure on screening outcomes` : `${TOPICS[(t + i) % TOPICS.length][0].toUpperCase()}${TOPICS[(t + i) % TOPICS.length].slice(1)}: a ${["cohort", "randomised", "cross-sectional", "population based"][i % 4]} study of ${["rural", "urban", "primary care", "hospital"][(i + t) % 4]} settings${i % 3 === 0 ? " in South Asia" : ""}`,
  authors: ["A. Rao", "S. Iyer", "K. Menon", "P. Das"].slice(0, 2 + (i % 3)),
  year: 2012 + ((t + i) % 13),
  venue: ["Journal of Public Health", "The Lancet Global Health", "Indian Journal of Medical Research", "BMJ Open"][i % 4],
  abstract: abstractOf(t, i),
  citationCount: 3 + ((t * 13 + i * 17) % 400),
  oaUrl: i % 3 === 0 ? `https://example.org/oa/${t}/${i}.pdf` : null,
  retracted: false,
  retractionSources: [],
  sources: i % 2 === 0 ? ["openalex", "s2"] : ["openalex"],
  score: 1 - i / 100,
  doiStatus: "verified",
});
function buildChat(owner, turns = TURNS) {
  const messages = [];
  for (let t = 0; t < turns; t++) {
    const papers = Array.from({ length: CARDS }, (_, i) => paperOf(t, i));
    messages.push({ id: `perf-u${t}`, role: "user", text: TOPICS[t], at: 1_000 + t * 10 });
    messages.push({
      id: `perf-a${t}`, role: "assistant", mode: "search", query: TOPICS[t], language: "en", auto: false, how: "chosen", confidence: 1, understood: true, status: "done", step: null, stepsDone: ["search", "read", "write", "check"],
      papers, papersFinal: true, notices: [], live: "", generalLive: "", general: null, tookMs: 4200, at: 1_005 + t * 10,
      answer: {
        text: `Screening was feasible in community settings [1]. Costs per person were lower than with clinic visits [2][4]. The effect was similar after adjusting for age and sex [3].`,
        grounded: true, checked: true, leftOut: 0, rewritten: 0,
        citations: [1, 2, 3, 4].map((n) => ({ n, paperId: papers[n - 1].id, sentenceNo: 1 + (n % 3), sentence: SENTENCES[(t + n) % SENTENCES.length] })),
      },
    });
  }
  const id = "perfchat00000000001";
  return { entry: { id, title: TOPICS[0], updatedAt: Date.now(), owner }, record: { id, messages, rev: 1 } };
}

/* ---------------------------------------------------------------- what runs in the page */

/** Installed before every load: the browser's own instruments, plus marks for the moments that matter (the frame of the chat, its messages in the page, the first paint that holds them all, a live answer, the end). */
function instruments({ expect }) {
  const P = (window.__perf = { long: [], events: [], shifts: [], frames: [], armed: false, recording: false });
  const watch = (type, fn, opts) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...opts }); } catch { /* not supported */ } };
  const name = (n) => (n ? `${n.nodeName.toLowerCase()}${n.className && typeof n.className === "string" ? "." + n.className.split(" ")[0] : ""}` : "?");
  watch("longtask", (e) => P.long.push({ at: e.startTime, dur: e.duration }));
  // long animation frames (Chromium): what a long frame was made of, to read when a long task has to be explained (not gated)
  P.loaf = [];
  watch("long-animation-frame", (e) => P.loaf.push({ at: e.startTime, dur: e.duration, script: e.scripts.reduce((a, x) => a + x.duration, 0), render: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0, wait: e.renderStart ? e.renderStart - e.startTime : 0, from: e.scripts.map((x) => x.invokerType || x.sourceFunctionName || "").filter(Boolean).slice(0, 3).join(",") }));
  watch("event", (e) => { if (e.interactionId) P.events.push({ name: e.name, at: e.startTime, dur: e.duration, delay: e.processingStart - e.startTime }); }, { durationThreshold: 16 });
  const box = (r) => `${Math.round(r.y)}+${Math.round(r.height)}`;
  watch("layout-shift", (e) => P.shifts.push({ v: e.value, at: e.startTime, input: e.hadRecentInput, src: (e.sources ?? []).slice(0, 3).map((s) => `${name(s.node)} ${box(s.previousRect)} to ${box(s.currentRect)}`) }));
  // the page moving of itself after the reply has been asked for: the one scroll to the new question comes in the first 300 ms; a later one of more than 300 px is the page jumping under the reader
  P.jumps = [];
  let lastY = scrollY;
  window.addEventListener("scroll", () => { const y = scrollY; if (P.armed && P.sendAt && performance.now() - P.sendAt > 300 && Math.abs(y - lastY) > 300) P.jumps.push({ at: performance.now(), dy: Math.round(y - lastY) }); lastY = y; }, { passive: true });
  const mo = new MutationObserver(() => {
    const now = performance.now();
    if (!P.framedAt && document.querySelector(".chat-head")) P.framedAt = now;
    const list = document.querySelector(".chat-list");
    if (!P.committedAt && list && list.childElementCount >= expect) {
      P.committedAt = now;
      requestAnimationFrame(() => requestAnimationFrame(() => { P.paintedAt = performance.now(); }));
    }
    if (P.armed) {
      if (!P.liveAt) {
        const live = document.querySelector(".ask-text-live");
        if (live) {
          P.liveAt = now;
          // what the words are made of: a node for each word, or one piece of text
          P.liveShape = { spans: live.querySelectorAll("span:not(.ask-caret)").length, texts: [...live.childNodes].filter((n) => n.nodeType === 3).length };
        }
      }
      // the end: the new question and its reply are in the list and nothing is being written any more (the live words may never be drawn at all when the page is too slow to draw them before the answer is whole)
      if (!P.doneAt && list && list.childElementCount >= expect + 2 && !document.querySelector('.chat-turn[data-status="working"]') && document.querySelector('.chat-list > li:last-child .chat-turn[data-status="done"]')) P.doneAt = now;
    }
  });
  mo.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-status"] });
  const loop = (t) => { if (!P.recording) return; P.frames.push(t); requestAnimationFrame(loop); };
  window.__startFrames = () => { P.frames = []; P.recording = true; requestAnimationFrame(loop); };
  window.__stopFrames = () => { P.recording = false; };
}

/** Runs in the page: scrolls up from the bottom in steps, and says how far the thing under the pointer moved other than by the scroll, and how the height of the page drifted. */
async function scrollUp(step) {
  const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const pick = () => {
    for (const y of [0.5, 0.35, 0.65, 0.25]) {
      const el = document.elementFromPoint(innerWidth / 2, innerHeight * y)?.closest(".chat-list .card, .chat-bubble, .chat-answer");
      if (el) return el;
    }
    return null;
  };
  const h0 = document.documentElement.scrollHeight;
  window.scrollTo({ top: h0, behavior: "instant" });
  await raf2();
  const jumps = [];
  const small = [];
  let steps = 0;
  while (window.scrollY > 0 && steps < 800) {
    const probe = pick();
    const before = probe?.getBoundingClientRect().top;
    const y0 = window.scrollY;
    window.scrollBy({ top: -step, behavior: "instant" });
    await raf2();
    if (probe && probe.isConnected) {
      // what the reader asked for is the step (to the top at most); when a reply that was skipped is drawn at another height than it was given, the browser moves the page by that much to keep what is on screen
      // where it is (scroll anchoring), which is not a jump: what is on screen must have moved by the step and by nothing else
      const r = probe.getBoundingClientRect();
      jumps.push(Math.round(r.top - before - Math.min(step, y0)));
      if (probe.classList.contains("card")) small.push(Math.round(r.height));
    }
    steps++;
  }
  const h1 = document.documentElement.scrollHeight;
  const med = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0);
  const heights = (sel) => [...document.querySelectorAll(sel)].map((el) => Math.round(el.getBoundingClientRect().height));
  return {
    steps, probes: jumps.length, maxJump: Math.max(0, ...jumps.map(Math.abs)), jumping: jumps.filter((j) => Math.abs(j) > 2).length,
    minCard: small.length ? Math.min(...small) : 0, h0, h1, drift: Math.abs(h1 - h0) / h0,
    turnMedian: med(heights(".chat-list > li.chat-a")), cardMedian: med(heights(".chat-list .card")),
  };
}

/**
 * Installed before the page loads in the RENDER-COUNT run only (never in the timed ones: it walks the part of React's tree that changed at every commit): a stand-in for the hook React DevTools puts on the
 * page. React's own production build reports every commit to it, and a function component that RAN in that commit has the flag `PerformedWork` (1) on its fiber; one that was skipped (a `memo` whose props
 * are the same) does not. Each component that ran is placed by its first DOM element: in which item of the conversation's list it is, or outside it. The counts are of RENDERS, not of milliseconds, so they
 * do not depend on how fast or busy the machine is: a finished turn that is drawn again for a key pressed in the box, or for a word written below it, is a count over zero whatever the speed.
 */
function renderProbe() {
  const R = (window.__renders = { on: false, commits: 0, stored: 0, old: 0, recent: 0, fresh: 0, other: 0, oldSample: [], oldPerCommit: [], error: null });
  const PERFORMED_WORK = 1;
  const FUNCTIONS = [0, 1, 11, 14, 15]; // function, class, forwardRef, memo, simple memo
  const HOST = 5;
  let items = [];
  const hostOf = (fiber) => { for (let n = fiber; n; n = n.child) if (n.tag === HOST) return n.stateNode; return null; };
  const tally = (fiber) => {
    const li = hostOf(fiber)?.closest?.(".chat-list > li");
    const at = li ? items.indexOf(li) : -1;
    if (at < 0) R.other++;
    else if (at < R.stored - 4) { R.old++; if (R.oldSample.length < 5) R.oldSample.push(`${li.className.split(" ")[0]} #${at}: ${fiber.elementType?.displayName ?? fiber.elementType?.name ?? fiber.type?.name ?? `tag ${fiber.tag}`}`); }
    else if (at < R.stored) R.recent++;
    else R.fresh++;
  };
  const walk = (first) => {
    for (let f = first; f; f = f.sibling) {
      if (FUNCTIONS.includes(f.tag) && (f.flags & PERFORMED_WORK)) tally(f);
      // below a fiber whose child is the one it had before, nothing was touched
      if (f.child && !(f.alternate && f.child === f.alternate.child)) walk(f.child);
    }
  };
  const hook = {
    supportsFiber: true,
    isDisabled: false,
    renderers: new Map(),
    inject(renderer) { const id = hook.renderers.size + 1; hook.renderers.set(id, renderer); return id; },
    onCommitFiberRoot(_id, root) {
      if (!R.on) return;
      R.commits++;
      const before = R.old;
      try { items = [...document.querySelectorAll(".chat-list > li")]; walk(root.current.child); } catch (e) { R.error = String(e); }
      if (R.old > before) R.oldPerCommit.push(R.old - before); // the commits in which an old turn ran, and how many of its components
    },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, onScheduleFiberRoot() {}, checkDCE() {},
  };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;
}

const num = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
const percentile = (a, p) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

/* ---------------------------------------------------------------- the run */

/**
 * The widths the height estimates (--cv-* in shell.css) and the stream are held at. PERF_WIDTHS=320,340,... runs other widths, and PERF_ONLY_WIDTHS=1 runs nothing else: that is how the estimates are
 * calibrated (each line prints a turn's real height, and base, answer and paper are the constants of its bucket: paper = (turn - base - answer) / 20 for the gate's replies of 20 papers).
 */
const WIDTHS = (process.env.PERF_WIDTHS ?? "320,345,360,430,600,700").split(",").map(Number);
async function widthsProbe(list) {
  for (const width of list) {
    const W = await prepare({ width, height: 800 }, width < 700);
    await open(W.page, W.cdp);
    const upW = await W.page.evaluate(scrollUp, 500);
    const k = await W.page.evaluate(() => { const cs = getComputedStyle(document.querySelector(".chat-list")); return [cs.getPropertyValue("--cv-base"), cs.getPropertyValue("--cv-answer"), cs.getPropertyValue("--cv-paper")].map((v) => parseFloat(v)); });
    note(`${width} px: ${upW.steps} steps of 500 px; what was on screen moved by other than the scroll at most ${upW.maxJump} px; page height ${upW.h0} to ${upW.h1} (${num(upW.drift * 100, 2)} %); a turn is ${upW.turnMedian} px, a card ${upW.cardMedian} px; the estimate's base ${k[0]}, answer ${k[1]}, paper ${k[2]} would be paper ${num((upW.turnMedian - k[0] - k[1]) / CARDS, 1)} to fit`);
    ok(upW.maxJump <= LIMIT.scrollJump, `${width} px: nothing jumps when scrolling up (${upW.maxJump} px)`);
    ok(upW.drift <= LIMIT.heightDrift, `${width} px: the height of the page changes by at most ${LIMIT.heightDrift * 100} % from first to last (${num(upW.drift * 100, 2)} %)`);
    if (!process.env.PERF_ONLY_WIDTHS && (width === 320 || width === 360)) {
      const rw = await streamReply(W.page, W.cdp);
      tell(rw);
      // NOT the desktop's 0.1: on a phone the steps list (one line of progress is three lines at 320 px) and the checked answer's own height are a large part of the window. The line was 0.5 and the number swung from run to
      // run (0.000, 0.28 to 0.36, once 0.966), for two reasons found on 5 Nov 2026 (docs/design/ui-polish-1.md): (1) the four letters this gate types while the reply is written made the page jump by 2,000 to 46,000 px in a
      // long chat (the box measured its place in the document, which the scroll to the new question had changed by 230,000 px, and flew in from there: the page followed the caret), so the reply was off the screen and its
      // shifts were not counted (0.000), or, when the jump came late, the old replies sliding into the window were (0.69 to 0.92); (2) the answer's card was put in above the papers at the first word, which pushed the papers
      // on the screen down by its whole height (0.196). Both are fixed (a lateJump line holds the first; the card is there, empty and quiet, from the moment the papers are read). What is left is the Reading hint going
      // from the steps list when writing begins and the steps list going when the answer is whole (0.085 and 0.087): 0.173 in every quiet run, at most about 0.26 on a loaded machine.
      ok(rw.cls <= LIMIT.phoneCls, `${width} px: layout shift while the reply is written is within ${LIMIT.phoneCls} (${num(rw.cls, 3)}; the desktop's line of ${LIMIT.cls} is not held on a phone: see the comment)`);
      ok(rw.lateJump <= LIMIT.lateJump, `${width} px: a key pressed while the reply is written does not move the page (at most ${LIMIT.lateJump} px; it moved ${rw.lateJump} px in ${rw.jumps} jump(s))`);
    }
    await W.ctx.close();
  }
}

const idp = await startIdp();
idp.setUser({ sub: "chat-perf-1", email: "perf.reader@example.edu", email_verified: true, name: "Perf Reader" });
const browser = await launch();
const errors = [];
const watchErrors = (p) => {
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401|403|404|409|429|503)/.test(m.text())) errors.push("console: " + m.text()); });
};

/** A signed-in page with a stored chat of `turns` turns in the browser's storage, not yet opened. */
async function prepare(viewport, mobile, turns = TURNS) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  watchErrors(page);
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
  await page.getByRole("button", { name: "Continue with Google" }).last().click();
  await page.locator("#hm-h").waitFor({ timeout: 20000 });
  const meId = await page.evaluate(() => fetch("/api/v1/auth/me", { credentials: "same-origin" }).then((r) => r.json()).then((j) => j.user.id));
  const { entry, record } = buildChat(meId, turns);
  await page.evaluate(async ({ entry, record }) => {
    localStorage.setItem("scholar.chats.v1", JSON.stringify([entry]));
    sessionStorage.setItem("scholar.chat.active", entry.id);
    const db = await new Promise((res, rej) => { const r = indexedDB.open("scholar", 2); r.onupgradeneeded = () => { for (const s of ["pendingInk", "chats"]) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res) => { const tx = db.transaction("chats", "readwrite"); tx.objectStore("chats").put(record, entry.id); tx.oncomplete = () => res(); });
    db.close();
  }, { entry, record });
  await page.addInitScript(instruments, { expect: turns * 2 });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  return { ctx, page, cdp };
}

/** Opens the stored chat with the processor slowed down, and says when it was there. */
async function open(page, cdp) {
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: SLOW });
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => window.__perf?.paintedAt, null, { timeout: 120000 });
  const m = await page.evaluate(() => ({ ...window.__perf, nodes: document.getElementsByTagName("*").length }));
  // the renderer's own counters since the page began (script, layout, style): what the mount was made of
  m.counters = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  return m;
}

/**
 * One reply is streamed by the stand-in model under the opened chat, with the processor slowed down again, and a key is pressed in the box before it (nothing being written) and four times during it.
 * Everything is read in the page; the question's own first 600 ms (the question appearing, the page going to it) is the reader's own doing and is told apart from the stream.
 */
async function streamReply(page, cdp) {
  await page.locator(".hm-mode").click();
  await page.getByRole("menuitemradio", { name: /^Search papers/ }).click();
  await page.getByRole("menu", { name: "What should I do?" }).waitFor({ state: "hidden" });
  await page.locator(".hm-input").fill("glaucoma screening slowly"); // "slowly": the stand-in writes it over about two seconds
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: SLOW });
  const idleFrom = await page.evaluate(() => performance.now());
  for (const ch of ["x", "y", "z"]) { await page.keyboard.press(ch); await page.waitForTimeout(300); }
  for (let k = 0; k < 3; k++) await page.keyboard.press("Backspace");
  await page.waitForTimeout(300);
  const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
  const before = await metrics();
  await page.evaluate(() => { window.__perf.sendAt = performance.now(); window.__perf.armed = true; window.__startFrames(); });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(150);
  for (const ch of ["a", "b", "c", "d"]) { await page.keyboard.press(ch); await page.waitForTimeout(200); } // typing while the reply is being written
  await page.waitForFunction(() => window.__perf.doneAt, null, { timeout: 120000 });
  const after = await metrics();
  const s = await page.evaluate(() => { window.__stopFrames(); return window.__perf; });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  const from = s.sendAt;
  const to = s.doneAt;
  const within = (arr, a, b, f = (x) => x.at) => arr.filter((x) => f(x) >= a && f(x) <= b);
  const gaps = s.frames.slice(1).map((t, i) => t - s.frames[i]);
  const idle = within(s.events, idleFrom, from);
  const during = within(s.events, from, to);
  const longs = within(s.long, from, to + 1000);
  const settled = from + 600; // the question's own first 600 ms are the reader's doing (the browser itself leaves out a shift within 500 ms of a key)
  const d = (k) => (after[k] - before[k]) * 1000;
  return {
    s, from, to, ms: to - from, liveAt: s.liveAt ? s.liveAt - from : null,
    frames: s.frames.length, fps: gaps.length ? gaps.length / ((s.frames.at(-1) - s.frames[0]) / 1000) : 0, worstFrame: Math.max(0, ...gaps), p95Frame: percentile(gaps, 0.95),
    keyIdle: Math.max(0, ...idle.map((e) => e.dur)), keyIdleEvents: idle.length, keyStream: Math.max(0, ...during.map((e) => e.dur)), keyDelay: Math.max(0, ...during.map((e) => e.delay)), keyStreamEvents: during.length,
    longs: longs.length, longest: Math.max(0, ...longs.map((l) => l.dur)),
    clsSend: within(s.shifts, from, settled).reduce((a, x) => a + x.v, 0),
    // every shift from 600 ms after the question to the end, whether or not the browser sets it aside as following a key: the words arriving, the checked answer taking their place, the steps going
    cls: within(s.shifts, settled, to + 300).reduce((a, x) => a + x.v, 0),
    shifts: within(s.shifts, settled, to + 300).filter((x) => x.v > 0.003).slice(0, 5),
    lateJump: Math.max(0, ...(s.jumps ?? []).map((j) => Math.abs(j.dy))), jumps: (s.jumps ?? []).length,
    counters: { script: d("ScriptDuration"), layout: d("LayoutDuration"), layouts: after.LayoutCount - before.LayoutCount, style: d("RecalcStyleDuration"), styles: after.RecalcStyleCount - before.RecalcStyleCount, tasks: d("TaskDuration"), nodes: after.Nodes },
    loaf: within(s.loaf ?? [], from, to + 1000).sort((x, y) => y.dur - x.dur).slice(0, 2),
  };
}
function tell(r) {
  note(`the stream: ${num(r.ms)} ms from the question to the end (${r.liveAt === null ? "the live words were never drawn: the answer was whole before the page could draw them" : `the live words were drawn from ${num(r.liveAt)} ms`}); ${r.frames} frames, ${num(r.fps, 1)} a second, the slowest took ${num(r.worstFrame)} ms (95th percentile ${num(r.p95Frame)} ms)`);
  note(`pressing a key: ${num(r.keyIdle)} ms with nothing being written (${r.keyIdleEvents} events over 16 ms); ${num(r.keyStream)} ms during the stream (input delay up to ${num(r.keyDelay)} ms, ${r.keyStreamEvents} events)`);
  note(`${r.longs} long tasks in the stream, the longest ${num(r.longest)} ms; layout shift ${num(r.cls, 3)} from 600 ms after the question to the end (${num(r.clsSend, 3)} in the question's own first 600 ms); the page moved of itself by up to ${r.lateJump} px after the first 300 ms (${r.jumps} times)`);
  note(`the browser's counters over the stream: script ${num(r.counters.script)} ms, layout ${num(r.counters.layout)} ms (${r.counters.layouts} times), style ${num(r.counters.style)} ms (${r.counters.styles}), all tasks ${num(r.counters.tasks)} ms; ${r.counters.nodes} nodes`);
  for (const f of r.loaf) note(`  a long frame of ${num(f.dur)} ms: scripts ${num(f.script)} ms, style and layout ${num(f.render)} ms, painting from ${num(f.wait)} ms (${f.from})`);
  for (const sh of r.shifts) note(`  shift ${num(sh.v, 3)} at ${num(sh.at - r.from)} ms: ${sh.src.join(", ")}`);
}

try {
  if (process.env.PERF_ONLY_WIDTHS) {
    await widthsProbe(WIDTHS);
    console.log(failed() ? `${failed()} FAILED` : "the widths are within the lines");
    await browser.close();
    idp.close();
    process.exit(failed() ? 1 : 0);
  }
  /* ============ first, the same reply under a chat of one turn: what the reply itself costs on this machine today ============ */
  console.log("first, for comparison: the same reply under a chat of one turn");
  const C = await prepare({ width: 1360, height: 900 }, false, 1);
  const mc = await open(C.page, C.cdp);
  note(`${mc.nodes} DOM nodes; the stored chat appeared ${num(mc.paintedAt - mc.framedAt)} ms after its frame`);
  const rc = await streamReply(C.page, C.cdp);
  tell(rc);
  await C.ctx.close();

  /* ============ desktop: mount, one streamed reply, the scroll-up probe ============ */
  console.log("a stored chat of 20 turns with 20 papers each, 4x slower processor, desktop 1360 px");
  const D = await prepare({ width: 1360, height: 900 }, false);
  const m = await open(D.page, D.cdp);
  const mountMs = m.paintedAt - m.framedAt;
  const longMount = m.long.filter((l) => l.at + l.dur >= m.framedAt && l.at <= m.paintedAt);
  note(`${m.nodes} DOM nodes; the chat's frame at ${num(m.framedAt)} ms, its ${TURNS * 2} messages in the page at ${num(m.committedAt)} ms, the first paint that holds them all at ${num(m.paintedAt)} ms`);
  note(`mount: ${num(mountMs)} ms from the frame to that paint; ${longMount.length} long tasks in it, the longest ${num(Math.max(0, ...longMount.map((l) => l.dur)))} ms; the page's counters so far: script ${num(m.counters.ScriptDuration * 1000)} ms, layout ${num(m.counters.LayoutDuration * 1000)} ms, style ${num(m.counters.RecalcStyleDuration * 1000)} ms, all tasks ${num(m.counters.TaskDuration * 1000)} ms`);
  ok(m.nodes > 15000, `the stored chat is big enough to mean something (${m.nodes} DOM nodes, at least 15000)`);
  const mountPaint = (m.counters.LayoutDuration + m.counters.RecalcStyleDuration) * 1000;
  const mountScript = m.counters.ScriptDuration * 1000;
  ok(mountMs <= LIMIT.mountMs, `the stored chat appears within ${LIMIT.mountMs} ms (${num(mountMs)} ms)`);
  ok(mountPaint <= LIMIT.mountPaintShare * mountScript, `laying out and styling it takes at most ${LIMIT.mountPaintShare * 100} % of the time its script takes (${num(mountPaint)} ms against ${num(mountScript)} ms): the replies far from the window are skipped`);
  // one live region for the whole conversation, not three or more for each turn
  const regions = await D.page.evaluate(() => document.querySelectorAll('.chat [role="status"], .chat [aria-live]').length);
  ok(regions <= LIMIT.liveRegions, `at most ${LIMIT.liveRegions} live region in the 20-turn chat (${regions})`);

  const r = await streamReply(D.page, D.cdp);
  tell(r);
  const lineOf = (abs, rel, control) => Math.min(abs, rel * control + LIMIT.slackMs);
  ok(r.keyIdle <= lineOf(LIMIT.keyIdleMs, LIMIT.relIdle, rc.keyIdle), `a key pressed with nothing being written is answered within ${num(lineOf(LIMIT.keyIdleMs, LIMIT.relIdle, rc.keyIdle))} ms (${num(r.keyIdle)} ms; ${num(rc.keyIdle)} ms under a chat of one turn)`);
  ok(r.keyStream <= lineOf(LIMIT.keyStreamMs, LIMIT.relStream, rc.keyStream), `a key pressed while the reply is written is answered within ${num(lineOf(LIMIT.keyStreamMs, LIMIT.relStream, rc.keyStream))} ms (${num(r.keyStream)} ms; ${num(rc.keyStream)} ms under a chat of one turn)`);
  ok(r.longest <= lineOf(LIMIT.longTaskMs, LIMIT.relLong, rc.longest), `no task of the stream is longer than ${num(lineOf(LIMIT.longTaskMs, LIMIT.relLong, rc.longest))} ms (${num(r.longest)} ms; ${num(rc.longest)} ms under a chat of one turn)`);
  ok(r.worstFrame <= lineOf(LIMIT.frameMs, LIMIT.relFrame, rc.worstFrame), `the page keeps drawing: no frame of the stream takes longer than ${num(lineOf(LIMIT.frameMs, LIMIT.relFrame, rc.worstFrame))} ms (${num(r.worstFrame)} ms; ${num(rc.worstFrame)} ms under a chat of one turn)`);
  // a line that is read from what the browser saw passes at 0 ms when it saw nothing (Math.max of no events): the keys pressed must have been seen (each takes far more than 16 ms at this speed)
  ok(r.keyIdleEvents >= 3, `the browser's Event Timing saw the keys pressed with nothing being written (${r.keyIdleEvents} events over 16 ms of the 6 pressed; at least 3), so the line above is a measurement`);
  ok(r.keyStreamEvents >= 3, `...and the keys pressed while the reply is written (${r.keyStreamEvents} events of the 4 pressed; at least 3)`);
  ok(r.cls <= LIMIT.cls, `layout shift while the reply is written is within ${LIMIT.cls} (${num(r.cls, 3)})`);
  ok(r.lateJump <= LIMIT.lateJump, `a key pressed while the reply is written does not move the page (at most ${LIMIT.lateJump} px; it moved ${r.lateJump} px in ${r.jumps} jump(s))`);
  ok(await D.page.locator('.chat-list > li:last-child .chat-turn[data-status="done"] .result').count() === 5 && await D.page.locator(".chat-list > li:last-child .chat-answer").count() === 1, "the stood-in reply is whole: its answer and its five papers");
  ok(await D.page.locator(".chat-list > li").count() === TURNS * 2 + 2, `and it is the 21st turn (${await D.page.locator(".chat-list > li").count()} items in the list)`);
  if (r.s.liveShape) ok(r.s.liveShape.spans === 0 && r.s.liveShape.texts === 1, `the words are one piece of text and not a node for each word (${r.s.liveShape.spans} word nodes, ${r.s.liveShape.texts} text node)`);
  else note("(the words of the reply were not drawn before the answer was whole, so what they are made of was not looked at)");

  // the scroll-up probe, through turns the browser may have skipped
  console.log("scrolling up through the whole chat, desktop");
  const up = await D.page.evaluate(scrollUp, 600);
  note(`${up.steps} steps of 600 px; what was on screen moved by other than the scroll at most ${up.maxJump} px (${up.jumping} of ${up.probes} steps moved it by more than 2 px); page height ${up.h0} to ${up.h1} (${num(up.drift * 100, 2)} %); a turn is ${up.turnMedian} px, a card ${up.cardMedian} px (medians once seen)`);
  ok(up.probes > up.steps * 0.8, `the probe found something to watch in ${up.probes} of ${up.steps} steps`);
  ok(up.maxJump <= LIMIT.scrollJump, `nothing jumps when scrolling up: at most ${LIMIT.scrollJump} px (${up.maxJump} px)`);
  ok(up.minCard >= 150, `a card that is shown has a real size, not a collapsed one (the smallest seen ${up.minCard} px)`);
  ok(up.drift <= LIMIT.heightDrift, `the height of the page changes by at most ${LIMIT.heightDrift * 100} % from first to last (${num(up.drift * 100, 2)} %)`);

  // what the skipping must not take away: print, the tab order, the focus, a jump to a cited card and its ring
  await D.page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await D.page.emulateMedia({ media: "print" });
  const printed = await D.page.evaluate(() => [...document.querySelectorAll(".chat-list > li")].filter((li) => getComputedStyle(li).contentVisibility !== "visible").length);
  await D.page.emulateMedia({ media: "screen" });
  ok(printed === 0, `printing shows every turn (${printed} turns would be left out)`);
  await D.page.evaluate(() => document.querySelector(".chat-list > li.chat-u .chat-act").focus());
  let tabIn = 0;
  for (let k = 1; k <= 8 && !tabIn; k++) {
    await D.page.keyboard.press("Tab");
    if (await D.page.evaluate(() => !!document.activeElement?.closest(".chat-list > li.chat-a"))) tabIn = k;
  }
  ok(tabIn > 0, `the Tab key goes from the first question into the reply under it, which is skipped (${tabIn ? `after ${tabIn} presses` : "not within 8 presses"})`);
  ok(await D.page.evaluate(() => {
    const btn = document.querySelectorAll(".chat-list > li.chat-a")[5]?.querySelector(".result .actions button");
    btn?.focus();
    return !!btn && document.activeElement === btn;
  }), "a button inside an old turn that is skipped can be given the focus");
  // pressing a source mark in an old reply marks its card and brings it to the middle of the window
  await D.page.evaluate(() => document.querySelectorAll(".chat-list > li.chat-a")[3].scrollIntoView({ block: "start", behavior: "instant" }));
  const old = D.page.locator(".chat-list > li.chat-a").nth(3);
  await old.locator(".cite-chip").first().click();
  await D.page.waitForTimeout(250);
  const flash = await old.locator('.result[data-n="1"]').getAttribute("data-flash");
  await D.page.waitForTimeout(900); // the scroll to it is smooth
  const offset = await old.locator('.result[data-n="1"]').evaluate((el) => { const b = el.getBoundingClientRect(); return Math.round(b.top + b.height / 2 - innerHeight / 2); });
  // (the card's own bottom margin for the sticky box, 9rem, moves the middle it is brought to up by half of it: 72 px)
  ok(flash === "true" && Math.abs(offset) <= 120, `a source mark in an old reply marks its card and brings it to the middle of the window (marked: ${flash}, ${offset} px from the middle)`);
  // the ring that marks a card is drawn outside it: in a reply that is skipped when far away it must not be cut off at the reply's edge
  const card = old.locator(".result").nth(1);
  await card.evaluate((el) => { el.scrollIntoView({ block: "center", behavior: "instant" }); el.setAttribute("data-flash", "true"); });
  await D.page.waitForTimeout(100);
  const cb = await card.boundingBox();
  const strip = (await D.page.screenshot({ clip: { x: cb.x - 6, y: cb.y + cb.height / 2 - 20, width: 12, height: 40 } })).toString("base64");
  const ring = await D.page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const px = (x) => [...g.getImageData(x, 20, 1, 1).data.slice(0, 3)].join();
    return { near: px(3), far: px(0) };
  }, strip);
  ok(ring.near !== ring.far, `the ring round a marked card is drawn outside its edge in a reply that is skipped when far away (3 px out: rgb(${ring.near}), 6 px out: rgb(${ring.far}))`);

  // long words at 320 and 360 px, in turns that are drawn
  console.log("a 31-character word and a 100-character address in the cards");
  for (const width of [360, 320]) {
    await D.page.setViewportSize({ width, height: 800 });
    await D.page.locator(".chat-list > li.chat-a").last().scrollIntoViewIfNeeded();
    await D.page.waitForTimeout(400);
    const over = await D.page.evaluate(() => {
      const w = document.documentElement.clientWidth;
      const past = [...document.querySelectorAll(".chat-list *")].filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.right > w + 1; });
      return { past: past.length, sample: past.slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`) };
    });
    ok(over.past === 0, `at ${width} px no part of the conversation reaches past the window (${over.past} elements${over.past ? ": " + over.sample.join(", ") : ""})`);
  }
  // (last of what is done on this page: pressing 'Draw all replies' ends the skipping for the rest of its life)
  // what a reply that the browser has skipped keeps for assistive technology: a screen reader builds its page from the accessibility tree, not from the screen, and a skipped reply (content-visibility: auto)
  // may be left out of it (reviewer, 4 Nov 2026: 1 node and no button for a skipped reply, 1,428 nodes and 108 buttons for a drawn one). The number of buttons of one reply of each kind is counted through CDP.
  console.log("what a reply the browser skipped keeps in the accessibility tree");
  await D.page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await D.page.waitForTimeout(500);
  const kinds = await D.page.evaluate(() => {
    const lis = [...document.querySelectorAll(".chat-list > li.chat-a:not(.chat-idea-li)")];
    // (the item itself has the rule, so it is its CONTENT that is skipped: ask about the first thing inside it)
    const skipped = lis.filter((li) => !li.firstElementChild.checkVisibility({ contentVisibilityAuto: true }));
    const drawn = lis.filter((li) => li.firstElementChild.checkVisibility({ contentVisibilityAuto: true }));
    skipped.at(-3)?.setAttribute("data-ax", "skipped");
    drawn[0]?.setAttribute("data-ax", "drawn");
    return { skipped: skipped.length, drawn: drawn.length, total: lis.length };
  });
  await D.cdp.send("DOM.enable");
  await D.cdp.send("Accessibility.enable");
  const axRoot = (await D.cdp.send("DOM.getDocument", { depth: 0 })).root.nodeId;
  const axCount = async (kind, role) => {
    const { nodeId } = await D.cdp.send("DOM.querySelector", { nodeId: axRoot, selector: `[data-ax="${kind}"]` });
    if (!nodeId) return -1;
    const { node } = await D.cdp.send("DOM.describeNode", { nodeId });
    return (await D.cdp.send("Accessibility.queryAXTree", { backendNodeId: node.backendNodeId, role })).nodes.length;
  };
  const axSkipped = await axCount("skipped", "button");
  const axDrawn = await axCount("drawn", "button");
  const axLinksSkipped = await axCount("skipped", "link");
  note(`${kinds.skipped} of the ${kinds.total} replies are skipped at the top of the page, ${kinds.drawn} are drawn; buttons in the accessibility tree: ${axSkipped} in one skipped reply, ${axDrawn} in one drawn reply; links: ${axLinksSkipped} in the skipped one`);
  ok(kinds.skipped >= 5 && axDrawn >= 20, `the probe has a skipped reply and a drawn one to compare (${kinds.skipped} skipped; ${axDrawn} buttons in the drawn one)`);
  // Measured 4 Nov 2026 (Edge): a skipped reply has NO button in the accessibility tree (0 against 108). The performance win of skipping is what makes a long chat usable, so the skipping stays, and what a screen
  // reader needs is a way to have every reply drawn: a control at the head of the conversation, reached first by a screen reader and by the Tab key, that draws them all.
  note(`a skipped reply has ${axSkipped} buttons in the accessibility tree against ${axDrawn} in a drawn one: the way to have them all is the control at the head of the conversation`);
  const drawAll = D.page.getByRole("button", { name: "Draw all replies" });
  ok(await drawAll.count() === 1, "the conversation has a button 'Draw all replies' at its head, for a screen reader (it is drawn only for a conversation of three turns or more)");
  ok(await D.page.evaluate(() => { const b = document.querySelector(".chat-drawall"); const first = document.querySelector(".chat-list"); return !!b && !!(b.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING); }), "...and it comes before the list of replies, so that a screen reader finds it before them");
  const noBox = await D.page.evaluate(() => { const r = document.querySelector(".chat-drawall").getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  ok(noBox[0] <= 2 && noBox[1] <= 2, `...and it takes no room on the page until it has the focus (${noBox.join(" by ")} px)`);
  await drawAll.focus();
  ok(await D.page.evaluate(() => { const r = document.querySelector(".chat-drawall").getBoundingClientRect(); return r.width > 100 && r.height > 10; }), "...with the focus it is shown, as a skip link is");
  await drawAll.press("Enter");
  await D.page.waitForTimeout(600);
  const axAfter = await axCount("skipped", "button");
  ok(axAfter >= axDrawn * 0.5, `after 'Draw all replies' the reply that was skipped has its buttons in the accessibility tree: ${axAfter} against ${axDrawn} in a drawn reply`);
  ok(await D.page.getByRole("button", { name: "Draw all replies" }).count() === 0 && /All replies are drawn/.test(await D.page.locator(".chat-drawall").innerText()), "...and the control says so and is gone (the focus stays on that line, not dropped to the page)");
  ok(await D.page.evaluate(() => document.activeElement === document.querySelector(".chat-drawall")), "...the focus is on the line that says so");

  await D.ctx.close();

  /* ============ which turns are drawn again: a count of renders, not a time ============ */
  // The lines above are in milliseconds and are loose on purpose (a busy machine runs this page three to five times slower), so a regression that costs 40 to 100 ms a key at this speed passes them: the
  // memo on a finished turn taken away, or defeated by one new function made on every render (an inline arrow in its props), was measured passing all of them. A count does not have that problem.
  console.log("which turns are drawn again when a key is pressed and when a word is written: a count of renders");
  const E = await prepare({ width: 1360, height: 900 }, false);
  await E.page.addInitScript(renderProbe);
  const me = await open(E.page, E.cdp);
  const stored = await E.page.evaluate(() => document.querySelectorAll(".chat-list > li").length);
  ok(stored === TURNS * 2, `the stored chat is open for the count (${stored} items in the list, ${me.nodes} DOM nodes)`);
  await E.page.locator(".hm-mode").click();
  await E.page.getByRole("menuitemradio", { name: /^Search papers/ }).click();
  await E.page.getByRole("menu", { name: "What should I do?" }).waitFor({ state: "hidden" });
  await E.page.locator(".hm-input").fill("glaucoma screening slowly");
  await E.page.waitForTimeout(500);
  const counts = () => E.page.evaluate(() => { const R = window.__renders; return { commits: R.commits, old: R.old, recent: R.recent, fresh: R.fresh, other: R.other, sample: R.oldSample.slice(), perCommit: R.oldPerCommit.slice(), error: R.error }; });
  const reset = (on) => E.page.evaluate((x) => { const R = window.__renders; R.stored = document.querySelectorAll(".chat-list > li").length; R.commits = R.old = R.recent = R.fresh = R.other = 0; R.oldSample = []; R.oldPerCommit = []; R.on = x; }, on);
  // 1. keys pressed in the box with nothing being written
  await reset(true);
  for (const ch of ["x", "y", "z"]) { await E.page.keyboard.press(ch); await E.page.waitForTimeout(150); }
  for (let k = 0; k < 3; k++) await E.page.keyboard.press("Backspace");
  await E.page.waitForTimeout(300);
  const keys = await counts();
  note(`six keys: ${keys.commits} commits; components that ran: ${keys.old} in the ${stored - 4} oldest turns, ${keys.recent} in the last four of the stored chat, ${keys.other} outside the list (the box)`);
  ok(keys.error === null, `the render probe read React's tree without an error${keys.error ? ": " + keys.error : ""}`);
  ok(keys.commits >= 6 && keys.other > 0, `the probe sees React draw (${keys.commits} commits, ${keys.other} components that ran: the box and its page)`);
  ok(keys.old === 0, `a key pressed in the box draws none of the ${stored - 4} oldest turns again (${keys.old}${keys.old ? ": " + keys.sample.join("; ") : ""})`);
  ok(keys.recent === 0, `...nor the last four of the stored chat (${keys.recent})`);
  // 2. a reply written under the chat, with keys pressed while it is
  await reset(true);
  await E.page.keyboard.press("Enter");
  await E.page.waitForTimeout(150);
  for (const ch of ["a", "b", "c", "d"]) { await E.page.keyboard.press(ch); await E.page.waitForTimeout(200); }
  await E.page.waitForFunction(() => document.querySelectorAll(".chat-list > li").length >= 42 && !document.querySelector('.chat-turn[data-status="working"]') && document.querySelector('.chat-list > li:last-child .chat-turn[data-status="done"]'), null, { timeout: 120000 });
  await E.page.waitForTimeout(300);
  const stream = await counts();
  note(`old turns ran in ${stream.perCommit.length} of the stream's commits, with ${JSON.stringify(stream.perCommit)} of their components`);
  note(`the stream: ${stream.commits} commits; components that ran: ${stream.old} in the ${stored - 4} oldest turns, ${stream.recent} in the last four of the stored chat, ${stream.fresh} in the new question and reply, ${stream.other} outside the list`);
  ok(stream.fresh > 0, `the probe sees the new reply being drawn (${stream.fresh} components that ran in it)`);
  // the old turns are drawn again when the question is sent and when the reply ends (the page's busy flag reaches their buttons: two commits here, 162 components each), and for no word written between: a turn
  // drawn for every word is in every commit of the stream. The bound is on commits, not on time: a faster or a slower machine changes how many words arrive, not which commits touch an old turn.
  ok(stream.perCommit.length <= 4, `a reply being written draws the ${stored - 4} oldest turns in at most 4 of its ${stream.commits} commits (${stream.perCommit.length}: the question being sent, the reply ending), not in the commit of every word`);
  await E.ctx.close();

  /* ============ phone: the scroll-up probe on a narrow, tall page ============ */
  console.log("the same chat on a phone, 390 px");
  const F = await prepare({ width: 390, height: 844 }, true);
  const mp = await open(F.page, F.cdp);
  note(`${mp.nodes} DOM nodes; the stored chat appeared ${num(mp.paintedAt - mp.framedAt)} ms after its frame`);
  const upPhone = await F.page.evaluate(scrollUp, 500);
  note(`${upPhone.steps} steps of 500 px; what was on screen moved by other than the scroll at most ${upPhone.maxJump} px (${upPhone.jumping} of ${upPhone.probes} steps over 2 px); page height ${upPhone.h0} to ${upPhone.h1} (${num(upPhone.drift * 100, 2)} %); a turn is ${upPhone.turnMedian} px, a card ${upPhone.cardMedian} px`);
  ok(upPhone.maxJump <= LIMIT.scrollJump, `nothing jumps when scrolling up on a phone: at most ${LIMIT.scrollJump} px (${upPhone.maxJump} px)`);
  ok(upPhone.minCard >= 150, `a card that is shown has a real size on a phone (the smallest seen ${upPhone.minCard} px)`);
  ok(upPhone.drift <= LIMIT.heightDrift, `the height of the page changes by at most ${LIMIT.heightDrift * 100} % on a phone (${num(upPhone.drift * 100, 2)} %)`);
  await F.ctx.close();

  /* ============ the widths phones really have: the height estimates and the words arriving ============ */
  // The estimate of a skipped reply's height (--cv-* in shell.css) is a value for a range of widths, and the gate measured it at 1360 and 390 px only: at 345 and 360 px, the most common phone widths, the page's
  // height changed by 5 to 6 % from the first probe to the last (reviewer, 4 Nov 2026), and the reply's first words moved the page by 0.07 to 0.35 at 320 and 360 px, which the desktop stream (0.004) cannot see.
  console.log(`the same chat at ${WIDTHS.join(", ")} px: the height estimates, and the words arriving`);
  await widthsProbe(WIDTHS);

  ok(errors.length === 0, `no console or page errors${errors.length ? ": " + errors.slice(0, 4).join(" | ") : ""}`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  countFailure();
} finally {
  await browser.close();
  idp.close();
  finish("all chat performance checks passed");
}
