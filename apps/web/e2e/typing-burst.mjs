// Browser e2e: a box takes a long burst of keys without React giving up ("Maximum update depth exceeded", React error 185, which replaces the whole app with the error page).
// React counts the renders that end with an update still waiting, and stops at fifty in a row. A key's render ends with an update waiting when an effect calls a state setter on every key
// (`useEffect(() => setProblem(null), [query])`: the Home box did, on 5 Nov 2026; the palette, the search of the paper and the search of the papers did too), because React only skips a setter given the
// value the state already has when the component has no work pending. The count starts again whenever the scheduler gets a turn, which it does between keys typed by a hand, so this was seen only
// when fifty keys came with no turn between them: a key held down after a long task, an input method or a tool that types for a person, and e2e/polish-chat.mjs (about one run in three).
// The test does not wait for a race: `burst()` puts 120 input events into the box in ONE task, so no scheduler turn can come between them, and the old code fails every time (measured on the build of 5aa49ef: 7 of 12 boxes, in each of 3 runs).
// Needs the Worker with the fake identity provider and the offline stand-ins: `npm run integration -w apps/api -- --browser` starts it.
//   node e2e/typing-burst.mjs [baseUrl]    (default http://localhost:8788)
import { chromium } from "playwright-core";
import { startFakeIdp } from "../../api/scripts/fake-idp.mjs";
import { SAMPLE_PAPER, makePdf } from "../../api/scripts/lib/make-pdf.mjs";

const BASE = process.argv[2] ?? "http://localhost:8788";
const CHARS = 120; // more than twice React's limit of 50
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "burst-1", email: "isha.m@example.edu", email_verified: true, name: "Isha M" });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });

/* ---------------------------------------------------------------- a stored conversation (the way e2e/polish-chat.mjs makes one) */
const TOPICS = ["glaucoma screening", "diabetic retinopathy", "asthma in children", "tuberculosis treatment"];
const SENT = ["We enrolled adults from three districts and followed them for twelve months.", "The main outcome was measured at baseline and again at the end of the study period.", "Differences between the groups were small but consistent across the sites.", "Cost per person was lower with the community based approach than with clinic visits."];
const paperOf = (t, i) => ({ id: `doi:10.1000/tb.${t}.${i}`, doi: `10.1000/tb.${t}.${i}`, pmid: null, title: `${TOPICS[(t + i) % 4]}: study ${i + 1}`, authors: ["A. Rao"], year: 2015, venue: "Journal of Public Health", abstract: SENT.join(" "), citationCount: 5, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 1, doiStatus: "verified" });
function buildChat(owner, turns, cards = 6) {
  const messages = [];
  for (let t = 0; t < turns; t++) {
    const papers = Array.from({ length: cards }, (_, i) => paperOf(t, i));
    messages.push({ id: `tb-u${t}`, role: "user", text: TOPICS[t % 4], at: 1_000 + t * 10 });
    messages.push({ id: `tb-a${t}`, role: "assistant", mode: "search", query: TOPICS[t % 4], language: "en", auto: false, how: "chosen", confidence: 1, understood: true, status: "done", step: null, stepsDone: ["search", "read", "write", "check"], papers, papersFinal: true, notices: [], live: "", generalLive: "", general: null, tookMs: 4200, at: 1_005 + t * 10,
      answer: { text: "Screening was feasible in community settings [1]. Costs per person were lower than with clinic visits [2].", grounded: true, checked: true, leftOut: 0, rewritten: 0, citations: [1, 2].map((n) => ({ n, paperId: papers[n - 1].id, sentenceNo: n, sentence: SENT[n] })) } });
  }
  const id = `typingburst${turns}00001`.slice(0, 20);
  return { entry: { id, title: TOPICS[0], updatedAt: Date.now(), owner, kw: "glaucoma screening" }, record: { id, messages, rev: 1 } };
}
async function storeChat(page, turns) {
  const meId = await page.evaluate(() => fetch("/api/v1/auth/me", { credentials: "same-origin" }).then((r) => r.json()).then((j) => j.user.id));
  const { entry, record } = buildChat(meId, turns);
  await page.evaluate(async ({ entry, record }) => {
    localStorage.setItem("scholar.chats.v1", JSON.stringify([entry]));
    sessionStorage.setItem("scholar.chat.active", entry.id);
    const db = await new Promise((res, rej) => { const r = indexedDB.open("scholar", 2); r.onupgradeneeded = () => { for (const s of ["pendingInk", "chats"]) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res) => { const tx = db.transaction("chats", "readwrite"); tx.objectStore("chats").put(record, entry.id); tx.oncomplete = () => res(); });
    db.close();
  }, { entry, record });
}

/** CHARS input events delivered in one task, as React sees a typed key (the value is set the way the browser sets it, then an `input` event is dispatched). */
const burst = (loc) => loc.evaluate((el, chars) => {
  const multi = el.tagName === "TEXTAREA";
  const set = Object.getOwnPropertyDescriptor(multi ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value").set;
  el.focus();
  let done = 0;
  for (let k = 0; k < chars; k++) { set.call(el, el.value + (multi && k % 7 === 6 ? "\n" : "x")); el.dispatchEvent(new Event("input", { bubbles: true })); done++; }
  return { done, len: el.value.length };
}, CHARS);

let state;
async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...(state ? { storageState: state } : {}) });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.split("\n")[0].slice(0, 120)));
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  if (!state) {
    await page.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
    await page.getByRole("button", { name: "Continue with Google" }).last().click();
  }
  await page.locator("#hm-h").waitFor({ timeout: 20000 });
  await sleep(800);
  if (!state) state = await ctx.storageState();
  return { ctx, page, errors };
}
const idle = (p) => p.waitForFunction(() => !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 30000 });
const send = async (p, text, mode) => {
  if (new RegExp(mode).test(await p.locator(".hm-mode").innerText()) === false) { await p.locator(".hm-mode").click(); await p.getByRole("menuitemradio", { name: new RegExp("^" + mode) }).click(); await p.getByRole("menu", { name: "What should I do?" }).waitFor({ state: "hidden" }); }
  await p.locator(".hm-input").fill(text);
  await p.keyboard.press("Enter");
};
async function paperOpen(page, openIt) {
  await page.goto(BASE + "/papers", { waitUntil: "networkidle" });
  const note = page.getByRole("region", { name: /how your papers are handled/ });
  if (await note.count()) { await note.getByRole("button", { name: "I understand, continue" }).click(); await note.waitFor({ state: "detached", timeout: 8000 }); }
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => /Upload PDF papers/.test(b.getAttribute("aria-label") ?? b.textContent ?? "") && !b.disabled), null, { timeout: 8000 });
  await page.locator('input[type="file"]').setInputFiles({ name: "glaucoma_screening.pdf", mimeType: "application/pdf", buffer: makePdf(SAMPLE_PAPER, { title: "Glaucoma screening" }) });
  await page.locator(".dc").first().waitFor({ timeout: 40000 });
  if (!openIt) return;
  await page.locator(".dc-open").first().click();
  await page.locator(".pdfp-canvas[data-painted=true]").first().waitFor({ timeout: 30000 });
  await sleep(600);
}

/** name, how to get to the box (returns it), what to say about it */
const BOXES = [
  ["the question box of the empty Home", async ({ page }) => page.locator(".hm-input")],
  ["the question box of Home under a stored conversation, scrolled half way", async ({ page }) => {
    await storeChat(page, 6);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll(".chat-turn").length >= 6, null, { timeout: 60000 });
    await sleep(900);
    await page.evaluate(() => window.scrollTo({ top: Math.round((document.documentElement.scrollHeight - innerHeight) / 2), behavior: "instant" }));
    await sleep(400);
    return page.locator(".hm-input");
  }],
  ["the question box of Home after a reply to a search (the order of e2e/polish-chat.mjs)", async ({ page }) => {
    await send(page, "glaucoma screening", "Search papers");
    await page.locator('.chat-turn[data-status="done"]').first().waitFor({ timeout: 30000 });
    await idle(page);
    return page.locator(".hm-input");
  }],
  ["the question box of Home after a reply to small talk", async ({ page }) => {
    await send(page, "Hey How are you?", "Auto");
    await page.locator(".chat-talk").waitFor({ timeout: 20000 });
    await idle(page);
    return page.locator(".hm-input");
  }],
  ["the editor of a sent message", async ({ page }) => {
    await send(page, "dengue vaccines", "Search papers");
    await page.locator('.chat-turn[data-status="done"]').first().waitFor({ timeout: 30000 });
    await idle(page);
    await page.getByRole("button", { name: "Edit your message" }).first().click();
    const box = page.locator(".chat-edit-ta");
    await box.waitFor();
    return box;
  }],
  ["the command palette", async ({ page }) => {
    await page.keyboard.press("Control+k");
    const box = page.getByRole("dialog").getByRole("combobox");
    await box.waitFor();
    return box;
  }],
  ["the box of Idea Check", async ({ page }) => {
    await page.goto(BASE + "/idea", { waitUntil: "networkidle" });
    const box = page.getByRole("textbox", { name: "Your idea" });
    await box.waitFor();
    return box;
  }],
  ["the box of Check references", async ({ page }) => {
    await page.goto(BASE + "/verify", { waitUntil: "networkidle" });
    const box = page.locator("textarea").first();
    await box.waitFor();
    return box;
  }],
  ["the question box of a paper (Ask)", async ({ page }) => { await paperOpen(page, true); return page.locator("#ask-input"); }],
  ["the search box of a paper (Find)", async ({ page }) => {
    await paperOpen(page, true);
    await page.getByRole("button", { name: "Find in this paper" }).click();
    const box = page.getByRole("searchbox", { name: "Find in this paper" });
    await box.waitFor();
    return box;
  }],
  ["the search box of the papers", async ({ page }) => { await paperOpen(page, false); const box = page.locator("#ws-search"); await box.waitFor(); return box; }],
  ["the question box of Ask this paper (a result of a search)", async ({ page }) => {
    await send(page, "oapapers glaucoma", "Search papers");
    await page.locator(".chat-turn .result").nth(4).waitFor({ timeout: 20000 });
    await page.locator('.chat-turn[data-status="done"]').waitFor({ timeout: 30000 });
    await page.getByRole("button", { name: /^Ask this paper: Smartphone Retinal/ }).click();
    const box = page.getByRole("dialog", { name: "Ask this paper" }).getByLabel("Your question about this paper");
    await box.waitFor();
    return box;
  }],
];

try {
  console.log(`typing bursts: ${CHARS} input events in one task into each box`);
  for (const [name, reach] of BOXES) {
    const { ctx, page, errors } = await open();
    try {
      const box = await reach({ page });
      const r = await burst(box);
      await sleep(500);
      ok(errors.length === 0 && r.done === CHARS, `${name}: ${CHARS} keys in one task raise no error (${errors[0] ?? "none"})`);
      ok((await page.getByText("Something went wrong").count()) === 0, "...and the page is still the page, not the error page of the app");
    } catch (e) {
      failures++;
      console.log(` FAIL  ${name}: stopped: ${String(e.message).split(/\r?\n/)[0].slice(0, 200)}`);
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  idp.close();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
