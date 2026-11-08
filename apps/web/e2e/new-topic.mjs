// Browser e2e for "New topic" and the line "did not finish" (docs/design/intent-and-state.md, 4.19 R22 and its "As built" note).
// What it checks, in the browser: the control appears only after one finished search; pressing it puts a quiet line in the conversation and a chip in the box, tells a screen reader, and gives the box the focus; the
// next message goes out with no earlier turn (the posted body is read), and the one after it leans on the new topic only; five chains of that, one of them after an edit and a reload; the line "Your last message did
// not finish..." is on the right reply and on no other; axe in light, dark and read at 1280 and 390; the control, the chip and the arrow to the latest message never touch at 320, 360, 390, 600 and 1280; the keyboard;
// reduced motion. Needs the Worker with the fake identity provider and the offline stand-ins: `npm run integration -w apps/api -- --browser` starts it.
//   node e2e/new-topic.mjs [baseUrl]    (default http://localhost:8788)
// The browser is started WITH its scroll bars (as polish-chat.mjs does), so that nothing hides a bar that takes room.
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
idp.setUser({ sub: "new-topic-1", email: "isha.m@example.edu", email_verified: true, name: "Isha M" });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true, ignoreDefaultArgs: ["--hide-scrollbars"] });
const errors = [];
let currentPart = "-";
const watch = (p) => {
  p.on("pageerror", (e) => { errors.push("pageerror: " + e.message); console.log(`        (page error in part ${currentPart}: ${e.message.slice(0, 70)})`); });
  p.on("console", (m) => { // (net::ERR_FAILED is the browser reporting the connection this suite cuts on purpose, to make a reply fail)
    if (m.type() === "error" && !/Failed to load resource.*(401|403|404|409|429|503|net::ERR_FAILED)/.test(m.text())) errors.push("console: " + m.text()); });
};
const VP = {
  1280: { viewport: { width: 1280, height: 800 } },
  768: { viewport: { width: 768, height: 900 } },
  640: { viewport: { width: 640, height: 844 } },
  600: { viewport: { width: 600, height: 844 } },
  390: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  360: { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  320: { viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
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

let state;
const signedIn = async (vp, opts = {}) => {
  const ctx = await browser.newContext({ ...VP[vp], ...(state ? { storageState: state } : {}), colorScheme: "light", ...opts });
  const page = await ctx.newPage();
  watch(page);
  const posted = [];
  page.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/v1/chat") posted.push({ raw: r.postData() ?? "", body: JSON.parse(r.postData() ?? "{}") }); });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  if (!state) {
    await page.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
    await page.getByRole("button", { name: "Continue with Google" }).last().click();
  }
  await page.locator("#hm-h").waitFor({ timeout: 20000 });
  await sleep(800);
  if (!state) state = await ctx.storageState();
  return { ctx, page, posted };
};
const pick = async (p, name) => {
  if (new RegExp(name).test(await p.locator(".hm-mode").innerText())) return;
  await p.locator(".hm-mode").click();
  await p.getByRole("menuitemradio", { name: new RegExp("^" + name) }).click();
  await p.getByRole("menu", { name: "What should I do?" }).waitFor({ state: "hidden" });
};
const idle = (p) => p.waitForFunction(() => !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 30000 });
const send = async (p, text, tool = "Auto") => { await idle(p); if (tool) await pick(p, tool); await p.locator(".hm-input").fill(text); await p.keyboard.press("Enter"); };
/** A message sent and its reply finished: `n` replies are done in all. */
const sendDone = async (p, text, n, tool = "Auto") => { await send(p, text, tool); await p.waitForFunction((n) => document.querySelectorAll('.chat-turn[data-status="done"]').length >= n && !document.querySelector('.chat-turn[data-status="working"]'), n, { timeout: 30000 }); };
const sse = (events) => events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
const LIST = [1, 2].map((n) => ({ id: `doi:10.1000/nt.${n}`, doi: `10.1000/nt.${n}`, pmid: null, title: `A paper about the topic ${n}`, authors: ["A. Rao"], year: 2020 + n, venue: "Journal of Tests", abstract: "We looked at one thing in a small group. The result was clear.", citationCount: 3, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 1 - n / 10 }));
/** What the server says to a follow-up it read with the turns before it. */
const followed = (text, over = {}, extra = {}) => [
  { type: "understood", mode: "search", query: text, language: "en", auto: true, how: "rules", confidence: 0.9, searchQuery: "glaucoma screening", context: { turns: 1, intent: "refine", rewrote: true, question: `glaucoma screening ${text}`, ...over }, ...extra },
  { type: "step", step: "search" },
  { type: "papers", results: LIST, final: true },
  { type: "done", answered: false, reason: "not_answered", tookMs: 40 },
];
/** The box has the focus (waited for a moment: the focus moves in the click that presses, and a menu that closes returns it after its exit). */
const inBox = (p) => p.waitForFunction(() => document.activeElement === document.querySelector(".hm-input"), null, { timeout: 2500 }).then(() => true, () => false);
const live = (p) => p.locator("[data-announcer]").textContent().then((t) => (t ?? "").trim());
const toldLater = async (p, re) => { await p.waitForFunction((src) => new RegExp(src).test(document.querySelector("[data-announcer]")?.textContent ?? ""), re.source, { timeout: 4000 }).catch(() => {}); return live(p); };
const asks = (b) => (b?.history ?? []).filter((e) => e.role === "user").map((e) => e.text);
const rect = (p, sel) => p.locator(sel).first().evaluate((el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; });
const meets = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Writes a chat into the page's storage (the list in localStorage, the record in IndexedDB: lib/chat.ts) and makes it this tab's chat. */
async function storeMessages(page, messages, title = "glaucoma screening") {
  const meId = await page.evaluate(() => fetch("/api/v1/auth/me", { credentials: "same-origin" }).then((r) => r.json()).then((j) => j.user.id));
  const id = `newtopic${messages.length}${Math.floor(Math.random() * 1e9)}`.slice(0, 20);
  const entry = { id, title, updatedAt: Date.now(), owner: meId };
  await page.evaluate(async ({ entry, record }) => {
    const prev = JSON.parse(localStorage.getItem("scholar.chats.v1") ?? "[]").filter((e) => e.id !== entry.id);
    localStorage.setItem("scholar.chats.v1", JSON.stringify([entry, ...prev]));
    sessionStorage.setItem("scholar.chat.active", entry.id);
    const db = await new Promise((res, rej) => { const r = indexedDB.open("scholar", 2); r.onupgradeneeded = () => { for (const s of ["pendingInk", "chats"]) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res) => { const tx = db.transaction("chats", "readwrite"); tx.objectStore("chats").put(record, entry.id); tx.oncomplete = () => res(); });
    db.close();
  }, { entry, record: { id, messages, rev: 1 } });
  return id;
}
const doneReply = (id, query, over = {}) => ({ id, role: "assistant", mode: "search", query, language: "en", auto: true, how: "rules", confidence: 1, understood: true, status: "done", step: null, stepsDone: ["search", "read", "write", "check"], papers: LIST, papersFinal: true, notices: [], live: "", generalLive: "", general: null, answer: null, reason: "not_answered", tookMs: 900, at: 1_005, ...over });
const asked = (id, text, over = {}) => ({ id, role: "user", text, at: 1_000, ...over });

const section = async (name, fn) => {
  if (process.env.PARTS && !process.env.PARTS.split(",").includes(name)) return;
  currentPart = name;
  try { await fn(); } catch (e) { failures++; console.log(` FAIL  [part ${name}] stopped: ${String(e.message).split(/\r?\n/)[0].slice(0, 200)}`); }
};
const NT = 'Do not use the earlier messages of this chat for your next message';

try {
  await section("1", async () => {
  /* ================================================================ 1. it appears only after one finished search */
  console.log("1. the control appears only after one finished search");
  {
    const { ctx, page } = await signedIn(1280);
    ok(await page.getByRole("button", { name: "New topic" }).count() === 0, "the empty Home has none");
    // a reply that is held while it is being written: nothing to stop yet, and while a reply is written the person is not choosing what to send next
    let release;
    const gate = new Promise((r) => { release = r; });
    await page.route("**/api/v1/chat", async (route) => { await gate; await route.continue(); });
    await send(page, "glaucoma screening in India");
    await page.locator('.chat-turn[data-status="working"]').waitFor({ timeout: 10000 });
    ok(await page.locator(".hm-topic").count() === 0, "while the first reply is being written there is none");
    release();
    await page.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="done"]').length === 1, null, { timeout: 30000 });
    await page.unroute("**/api/v1/chat");
    const btn = page.getByRole("button", { name: "New topic" });
    ok(await btn.count() === 1 && await btn.isVisible(), "after one finished search it is there: a button named New topic, in the bar of the box");
    ok(await btn.getAttribute("title") === NT, `...with a title that says what it does ("${await btn.getAttribute("title")}")`);
    const bar = await page.locator(".hm-bar").last().evaluate((el) => [...el.children].map((c) => c.textContent?.trim() || c.getAttribute("aria-label") || c.className));
    note(`the bar: ${bar.join(" | ")}`);
    // while another reply is written it goes again
    await page.route("**/api/v1/chat", async (route) => { await new Promise(() => {}); });
    await send(page, "and in children?");
    await page.locator('.chat-turn[data-status="working"]').waitFor({ timeout: 10000 });
    ok(await page.locator(".hm-topic").count() === 0, "while the next reply is being written it is gone again");
    await page.getByRole("button", { name: "Stop answering" }).click();
    await page.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="stopped"]').length === 1, null, { timeout: 10000 });
    await page.unroute("**/api/v1/chat");
    ok(await page.locator(".hm-topic").count() === 1, "after a Stop it is back (the first search is finished)");
    await ctx.close();

    // a chat with nothing finished in it: small talk alone, and a reply that was stopped alone
    const c2 = await signedIn(1280);
    await sendDone(c2.page, "Hey How are you?", 1);
    ok(await c2.page.locator(".hm-topic").count() === 0, "small talk alone is nothing to stop: none");
    await c2.page.locator(".chat-head").getByRole("button", { name: "New chat" }).click();
    await c2.page.locator(".hm-title").waitFor({ timeout: 10000 });
    await c2.page.route("**/api/v1/chat", async () => { await new Promise(() => {}); });
    await send(c2.page, "glaucoma screening in India");
    await c2.page.locator('.chat-turn[data-status="working"]').waitFor({ timeout: 10000 });
    await c2.page.getByRole("button", { name: "Stop answering" }).click();
    await c2.page.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="stopped"]').length === 1, null, { timeout: 10000 });
    ok(await c2.page.locator(".hm-topic").count() === 0, "a first reply that was stopped is nothing to stop either: none");
    await c2.ctx.close();

    // an old chat (kept before the marker existed) shows it, and shows no line of the kind
    const c3 = await signedIn(1280);
    await storeMessages(c3.page, [asked("u1", "glaucoma screening"), doneReply("a1", "glaucoma screening"), asked("u2", "only after 2020"), doneReply("a2", "only after 2020")]);
    await c3.page.reload({ waitUntil: "networkidle" });
    await c3.page.locator(".chat-turn").first().waitFor({ timeout: 20000 });
    ok(await c3.page.locator(".hm-topic").count() === 1 && await c3.page.locator(".chat-topic").count() === 0, "a chat kept before it existed opens as it was: the button is there, no line is");
    await c3.ctx.close();
  }
  });

  await section("2", async () => {
  /* ================================================================ 2. pressing it, and undoing it */
  console.log("2. pressing it: the line, the chip, the status, the focus; undoing it");
  {
    const { ctx, page, posted } = await signedIn(1280);
    await sendDone(page, "glaucoma screening in India", 1);
    await page.getByRole("button", { name: "New topic" }).click();
    const chip = page.locator('.chat-chip[data-kind="topic"]');
    await chip.waitFor({ timeout: 5000 });
    ok((await chip.locator("span").first().innerText()).trim() === "New topic: earlier messages will not be used", "a chip in the box says it, in words");
    ok(await page.locator(".hm-topic").count() === 0, "the button is gone while it is pressed (the chip is in its place)");
    const sep = page.locator(".chat-topic[data-pending='true']");
    ok(await sep.count() === 1 && await sep.getAttribute("role") === "separator" && /^New topic/.test(await sep.getAttribute("aria-label")), "the conversation has the line at its end: a separator with a name");
    ok((await sep.innerText()).trim() === "New topic", `...and it says New topic ("${(await sep.innerText()).trim()}")`);
    ok(await toldLater(page, /New topic: earlier messages will not be used/) === "New topic: earlier messages will not be used", `a screen reader is told, in the one polite status line ("${await live(page)}")`);
    ok(await page.evaluate(() => document.activeElement === document.querySelector(".hm-input")), "the box has the focus again");
    ok(/scholar\.chat\.topic/.test(await page.evaluate(() => Object.keys(sessionStorage).join())), "it is kept for this tab (so a reload does not undo it)");
    // the textarea knows about the chip
    ok((await page.locator(".hm-input").getAttribute("aria-describedby")).includes((await chip.locator("span").first().getAttribute("id"))), "the box is described by the chip");

    // undo
    await chip.getByRole("button", { name: "Keep using the earlier messages" }).click();
    ok(await chip.count() === 0 && await page.locator(".chat-topic").count() === 0 && await page.locator(".hm-topic").count() === 1, "its X takes it away: no chip, no line, and the button is back");
    ok(await toldLater(page, /Earlier messages will be used again/) === "Earlier messages will be used again", `...and says so ("${await live(page)}")`);
    ok(await page.evaluate(() => document.activeElement === document.querySelector(".hm-input")), "...with the focus in the box");
    ok(await page.evaluate(() => Object.keys(sessionStorage).every((k) => k !== "scholar.chat.topic")), "...and nothing is kept for the tab");
    await sendDone(page, "only after 2020", 2);
    ok(asks(posted.at(-1).body).join("|") === "glaucoma screening in India", `with the chip taken away the next message leans on the search before it (${JSON.stringify(asks(posted.at(-1).body))})`);

    // press again and send
    await page.getByRole("button", { name: "New topic" }).click();
    await page.locator(".chat-topic[data-pending='true']").waitFor();
    await sendDone(page, "tuberculosis treatment", 3);
    const sent = posted.at(-1);
    ok(sent.raw === '{"mode":"auto","message":"tuberculosis treatment"}', `the message after New topic is exactly the body of a first message (${sent.raw})`);
    ok(await page.locator(".chat-topic[data-pending='true']").count() === 0 && await page.locator('.chat-chip[data-kind="topic"]').count() === 0, "the pending state is over: no chip, no line at the end");
    const inList = page.locator(".chat-list .chat-topic");
    ok(await inList.count() === 1 && await inList.getAttribute("role") === "separator", "the line is in the conversation now, above the message that was sent after it");
    const order = await page.evaluate(() => { const li = document.querySelector(".chat-list .chat-topic")?.closest("li"); return li ? [li.classList.contains("chat-u"), li.firstElementChild?.classList.contains("chat-topic"), li.textContent.includes("tuberculosis treatment")] : null; });
    ok(JSON.stringify(order) === "[true,true,true]", "...inside that message's own place, as its first thing");
    ok(await page.locator(".chat-u").count() === 3 && /glaucoma screening in India/.test(await page.locator(".chat-u").first().innerText()), "the earlier messages stay on the page");
    // the next message leans on the new topic only
    await sendDone(page, "only after 2020", 4);
    ok(asks(posted.at(-1).body).join("|") === "tuberculosis treatment" && !/glaucoma screening in India/.test(posted.at(-1).raw), `the message after that leans on the new topic only: not the first question's words, anywhere in the body (${JSON.stringify(asks(posted.at(-1).body))})`);
    ok(await page.locator(".chat-list .chat-topic").count() === 1, "(still one line)");
    await ctx.close();
  }
  });

  await section("3", async () => {
  /* ================================================================ 3. five chains: nothing is carried after New topic */
  console.log("3. five chains: nothing is carried after New topic");
  const chains = [
    ["plain, in Auto", 1280, async (page, posted) => {
      await sendDone(page, "glaucoma screening in India", 1);
      await page.getByRole("button", { name: "New topic" }).click();
      await sendDone(page, "tuberculosis treatment", 2);
      await sendDone(page, "only after 2020", 3);
      return [["tuberculosis treatment", null], ["only after 2020", ["tuberculosis treatment"]]];
    }],
    ["the new topic's first message is a search chosen by hand", 1280, async (page) => {
      await sendDone(page, "glaucoma screening in India", 1);
      await page.getByRole("button", { name: "New topic" }).click();
      await sendDone(page, "tuberculosis treatment", 2, "Search papers");
      await sendDone(page, "only after 2020", 3, "Auto");
      return [["tuberculosis treatment", null], ["only after 2020", ["tuberculosis treatment"]]];
    }],
    ["pressed and taken away, then pressed again", 1280, async (page, posted) => {
      await sendDone(page, "glaucoma screening in India", 1);
      await page.getByRole("button", { name: "New topic" }).click();
      await page.getByRole("button", { name: "Keep using the earlier messages" }).click();
      await sendDone(page, "only after 2020", 2);
      ok(JSON.stringify(asks(posted.at(-1).body)) === '["glaucoma screening in India"]', "(with the chip taken away the message leans on the search before it, as it always did)");
      await page.getByRole("button", { name: "New topic" }).click();
      await sendDone(page, "tuberculosis treatment", 3);
      await sendDone(page, "and in children?", 4);
      return [["only after 2020", ["glaucoma screening in India"]], ["tuberculosis treatment", null], ["and in children?", ["tuberculosis treatment"]]];
    }],
    ["on a phone, from the box's menu", 390, async (page) => {
      await sendDone(page, "glaucoma screening in India", 1);
      ok(await page.locator(".hm-topic").isHidden(), "(on a phone the bar has no button: it is hidden)");
      await page.getByRole("button", { name: "Chat options" }).click();
      await page.getByRole("menuitem", { name: /^New topic/ }).click();
      await sendDone(page, "tuberculosis treatment", 2);
      await sendDone(page, "only after 2020", 3);
      return [["tuberculosis treatment", null], ["only after 2020", ["tuberculosis treatment"]]];
    }],
    ["with an edit and a reload in the middle", 1280, async (page, posted) => {
      await sendDone(page, "glaucoma screening in India", 1);
      await page.getByRole("button", { name: "New topic" }).click();
      await page.reload({ waitUntil: "networkidle" });
      await page.locator(".chat-turn").first().waitFor({ timeout: 20000 });
      ok(await page.locator('.chat-chip[data-kind="topic"]').count() === 1 && await page.locator(".chat-topic[data-pending='true']").count() === 1, "(a reload before the message is sent keeps the pressed state)");
      await sendDone(page, "tuberculosis treatment", 2);
      await sendDone(page, "only after 2020", 3);
      await sendDone(page, "and in children?", 4);
      // edit the last message: it is sent with the turns from the marker to it, none from before the marker
      await page.locator(".chat-u").last().hover();
      await page.getByRole("button", { name: "Edit your message" }).last().click();
      await page.locator(".chat-edit-ta").fill("and in men?");
      await page.getByRole("button", { name: /Save and resend/ }).click();
      await page.waitForFunction(() => !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 30000 });
      return [["tuberculosis treatment", null], ["only after 2020", ["tuberculosis treatment"]], ["and in children?", ["tuberculosis treatment", "only after 2020"]], ["and in men?", ["tuberculosis treatment", "only after 2020"]]];
    }],
  ];
  for (const [name, vp, run] of chains) {
    const { ctx, page, posted } = await signedIn(vp);
    const expected = await run(page, posted);
    const bodies = posted.filter((p) => expected.some(([m]) => m === p.body.message));
    const got = expected.map(([m]) => bodies.filter((p) => p.body.message === m).at(-1));
    const right = expected.every(([m, want], i) => {
      const b = got[i];
      if (!b) return false;
      return want === null ? b.raw === `{"mode":"${b.body.mode}","message":"${m}"}` : JSON.stringify(asks(b.body)) === JSON.stringify(want);
    });
    ok(right, `chain: ${name}: ${expected.map(([m, want], i) => `"${m}" ${want === null ? "no history" : JSON.stringify(asks(got[i]?.body))}`).join("; ")}`);
    ok(expected.every(([, want], i) => !!got[i] && got[i].raw.includes("glaucoma screening in India") === (want?.includes("glaucoma screening in India") ?? false)), "...and the words of the first topic are in exactly the bodies that were meant to carry them");
    await ctx.close();
  }
  });

  await section("4", async () => {
  /* ================================================================ 4. "did not finish" */
  console.log("4. the line 'did not finish'");
  const LINE = "Your last message did not finish, so this follows the one before it.";
  {
    const { ctx, page, posted } = await signedIn(1280);
    await sendDone(page, "glaucoma screening in India", 1);
    // the second message is stopped by the person
    let mode = "hold";
    await page.route("**/api/v1/chat", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      if (mode === "hold") return void (await new Promise(() => {}));
      if (mode === "canned") return route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(followed(body.message)) });
      if (mode === "newsubject") return route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(followed(body.message, { intent: "new", rewrote: false })) });
      return route.continue();
    });
    await send(page, "tuberculosis treatment");
    await page.locator('.chat-turn[data-status="working"]').waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "Stop answering" }).click();
    await page.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="stopped"]').length === 1, null, { timeout: 10000 });
    mode = "canned";
    await send(page, "only after 2020");
    await page.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="done"]').length === 2 && !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 20000 });
    const third = posted.at(-1);
    ok(JSON.stringify(asks(third.body)) === '["glaucoma screening in India"]', `the stopped message is still not carried: the follow-up leans on the search before it (${JSON.stringify(asks(third.body))})`);
    const line = page.locator(".chat-unfinished");
    ok(await line.count() === 1 && (await line.innerText()).trim() === LINE, `the reply says it, in the plan's words ("${(await line.first().innerText()).trim()}")`);
    ok(await line.locator("xpath=ancestor::div[contains(@class,'chat-turn')]").evaluate((el) => el === [...document.querySelectorAll(".chat-turn")].at(-1)), "...on the reply that followed it, and no other");
    ok(await line.getAttribute("role") === "note", "(a note: quiet, not a warning or an alert)");
    ok(await page.locator('.chat-note[data-kind="unfinished"]').count() === 0, "(it is drawn with the lines about what the reply leaned on, not with the warnings under it)");
    // the next reply, and the one after it, do not say it
    await send(page, "and in children?");
    await page.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="done"]').length === 3 && !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 20000 });
    ok(await page.locator(".chat-unfinished").count() === 1, "the next reply does not say it (the one before it finished)");
    // a message the server read as a new subject says nothing: it followed nothing
    mode = "hold";
    await send(page, "dengue vaccines");
    await page.locator('.chat-turn[data-status="working"]').waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "Stop answering" }).click();
    await page.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="stopped"]').length === 2, null, { timeout: 10000 });
    mode = "newsubject";
    await send(page, "malaria nets");
    await page.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="done"]').length === 4 && !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 20000 });
    ok(await page.locator(".chat-unfinished").count() === 1, "a message the server read as a new subject says nothing: it followed nothing");
    // a search chosen by hand sends no turns and says nothing
    mode = "hold";
    await send(page, "dengue again");
    await page.locator('.chat-turn[data-status="working"]').waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "Stop answering" }).click();
    await page.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="stopped"]').length === 3, null, { timeout: 10000 });
    mode = "pass";
    await send(page, "malaria nets in India", "Search papers");
    await page.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="done"]').length === 5 && !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 20000 });
    ok(await page.locator(".chat-unfinished").count() === 1, "a search chosen by hand says nothing (it sends no earlier turn)");
    await page.unroute("**/api/v1/chat");
    // it is kept with the reply: a reload shows it again, on the same reply
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".chat-turn").first().waitFor({ timeout: 20000 });
    await page.waitForFunction(() => document.querySelectorAll(".chat-unfinished").length >= 1, null, { timeout: 10000 });
    // (textContent: an older reply of a long chat is not drawn until it is near the window, and the text of what is not drawn is not what innerText reads)
    ok(await page.locator(".chat-unfinished").count() === 1 && ((await page.locator(".chat-unfinished").textContent()) ?? "").trim() === LINE, "after a reload it is still on that reply (kept with it)");
    await ctx.close();
  }
  {
    // a reply that failed (a lost connection), and one that was found interrupted, are read the same way; after New topic nothing follows them
    const { ctx, page, posted } = await signedIn(1280);
    await sendDone(page, "glaucoma screening in India", 1);
    await page.route("**/api/v1/chat", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      if (body.message === "tuberculosis treatment") return route.abort("failed");
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(followed(body.message)) });
    });
    await send(page, "tuberculosis treatment");
    await page.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="error"]').length === 1, null, { timeout: 15000 });
    await send(page, "only after 2020");
    await page.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="done"]').length === 2 && !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 20000 });
    ok(await page.locator(".chat-unfinished").count() === 1, "a reply that failed counts as one that did not finish");
    // New topic: the next message follows nothing
    await page.getByRole("button", { name: "New topic" }).click();
    await send(page, "and in children?");
    await page.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="done"]').length === 3 && !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 20000 });
    ok(posted.at(-1).raw === '{"mode":"auto","message":"and in children?"}' && await page.locator(".chat-unfinished").count() === 1, "after New topic the next message follows nothing, and says nothing");
    await page.unroute("**/api/v1/chat");
    await ctx.close();

    const i = await signedIn(1280);
    await storeMessages(i.page, [asked("u1", "glaucoma screening in India"), doneReply("a1", "glaucoma screening in India"), asked("u2", "tuberculosis treatment"), doneReply("a2", "tuberculosis treatment", { status: "working", papersFinal: false, papers: [], reason: undefined })]);
    await i.page.reload({ waitUntil: "networkidle" });
    await i.page.locator('.chat-turn[data-status="interrupted"]').waitFor({ timeout: 20000 });
    await i.page.route("**/api/v1/chat", (route) => route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(followed("only after 2020")) }));
    await send(i.page, "only after 2020");
    await i.page.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="done"]').length === 2 && !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 20000 });
    ok(await i.page.locator(".chat-unfinished").count() === 1, "a reply found interrupted when the page was opened again counts as well");
    await i.ctx.close();
  }
  {
    // the line in Hinglish, for a message that is Hinglish
    const { ctx, page } = await signedIn(1280);
    await storeMessages(page, [asked("u1", "glaucoma screening in India"), doneReply("a1", "glaucoma screening in India"), asked("u2", "tuberculosis treatment"), doneReply("a2", "tuberculosis treatment", { status: "stopped", papers: [], reason: "stopped" })]);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".chat-turn").first().waitFor({ timeout: 20000 });
    await page.route("**/api/v1/chat", (route) => route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(followed("2019 ke baad", {}, { language: "hinglish" })) }));
    await send(page, "2019 ke baad ke papers");
    await page.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="done"]').length === 2 && !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 20000 });
    ok((await page.locator(".chat-unfinished").innerText()).trim() === "Aapka pichhla message poora nahi hua, isliye ye usse pehle ke message ke hisaab se hai.", "in Hinglish for a message in Hinglish (the plan's sentence)");
    await ctx.close();
  }
  });

  await section("5", async () => {
  /* ================================================================ 5. the keyboard, the status, a reload, a private chat */
  console.log("5. the keyboard, a reload, a private chat, reduced motion");
  {
    const { ctx, page, posted } = await signedIn(1280);
    await sendDone(page, "glaucoma screening in India", 1);
    await page.locator(".hm-input").focus();
    const seen = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const name = await page.evaluate(() => { const a = document.activeElement; return (a?.getAttribute("aria-label") || a?.textContent || a?.tagName || "").trim().replace(/\s+/g, " "); });
      seen.push(name);
      if (/^New topic/.test(name)) break;
    }
    ok(/^New topic/.test(seen.at(-1)) && seen.length <= 5, `Tab reaches the button within the bar's own controls (${seen.join(" > ")})`);
    await page.keyboard.press("Enter");
    await page.locator('.chat-chip[data-kind="topic"]').waitFor({ timeout: 5000 });
    ok(await inBox(page), "Enter presses it, and the box has the focus afterwards");
    ok(await toldLater(page, /New topic/) === "New topic: earlier messages will not be used", "...with the status said");
    await page.keyboard.press("Shift+Tab");
    ok(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")) === "Keep using the earlier messages", "the chip's X is the control just before the box in the Tab order, with a name");
    await page.keyboard.press("Enter");
    ok(await page.locator('.chat-chip[data-kind="topic"]').count() === 0 && await page.evaluate(() => document.activeElement === document.querySelector(".hm-input")), "Enter on it takes the state away, and the box has the focus");
    await ctx.close();
  }
  {
    // on a phone: the menu, with the keyboard (a hardware keyboard on a tablet)
    const { ctx, page } = await signedIn(390);
    await sendDone(page, "glaucoma screening in India", 1);
    await page.getByRole("button", { name: "Chat options" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menu", { name: "Chat options" }).waitFor();
    const first = await page.evaluate(() => document.activeElement?.textContent?.trim().slice(0, 40));
    ok(/^New topic/.test(first), `the menu opens on New topic (${first})`);
    await page.keyboard.press("Enter");
    await page.locator('.chat-chip[data-kind="topic"]').waitFor({ timeout: 5000 });
    await page.getByRole("menu", { name: "Chat options" }).waitFor({ state: "detached", timeout: 3000 }).catch(() => {});
    await sleep(400); // (the menu's own return of the focus to its button runs after its exit)
    ok(await inBox(page), "Enter closes the menu, sets it, and leaves the focus in the box (not back on the menu's button)");
    await ctx.close();
  }
  {
    // reduced motion: the line and the chip do not move
    const { ctx, page } = await signedIn(1280, { reducedMotion: "reduce" });
    await sendDone(page, "glaucoma screening in India", 1);
    await page.getByRole("button", { name: "New topic" }).click();
    await page.locator(".chat-topic[data-pending='true']").waitFor();
    const m = await page.evaluate(() => { const a = getComputedStyle(document.querySelector(".chat-topic")); const b = getComputedStyle(document.querySelector('.chat-chip[data-kind="topic"]')); return { a: [a.animationName, a.transitionDuration], b: [b.animationName, b.transitionDuration] }; });
    const secs = (v) => v.split(",").map((x) => parseFloat(x)).every((x) => x <= 0.001); // the page sets a duration of a millionth of a second for a reader who asked for less motion
    ok(m.a[0] === "none" && secs(m.a[1]) && m.b[0] === "none" && secs(m.b[1]), `with reduced motion the line and the chip have no animation and no transition (${JSON.stringify(m)})`);
    await ctx.close();
  }
  {
    // a private chat: it works as in any other, and still nothing is kept
    const { ctx, page, posted } = await signedIn(1280);
    await page.getByRole("button", { name: "Chat options" }).click();
    await page.getByRole("menuitem", { name: /^Private chat/ }).click();
    await sendDone(page, "glaucoma screening in India", 1);
    await page.getByRole("button", { name: "New topic" }).click();
    await sendDone(page, "tuberculosis treatment", 2);
    await sendDone(page, "only after 2020", 3);
    ok(posted[1].raw === '{"mode":"auto","message":"tuberculosis treatment"}' && JSON.stringify(asks(posted[2].body)) === '["tuberculosis treatment"]', "in a private chat nothing is carried after New topic either");
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem("scholar.chats.v1") ?? "[]").length) === 0, "...and the chat is still not kept");
    await ctx.close();
  }
  });

  await section("6", async () => {
  /* ================================================================ 6. nothing touches: the control, the chip, the box and the arrow to the latest message */
  console.log("6. layout: the control, the chip and the arrow never touch");
  // a conversation long enough to scroll, so that the arrow shows
  const turns = [];
  for (let t = 0; t < 8; t++) {
    turns.push(asked(`lu${t}`, `topic number ${t} in India`), doneReply(`la${t}`, `topic number ${t} in India`, { papers: Array.from({ length: 6 }, (_, i) => ({ ...LIST[0], id: `doi:10.1000/long.${t}.${i}`, doi: `10.1000/long.${t}.${i}`, title: `Paper ${i + 1} of topic ${t}` })) }));
  }
  for (const vp of [1280, 768, 640, 600, 390, 360, 320]) {
    const { ctx, page } = await signedIn(vp);
    await storeMessages(page, turns);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".chat-turn").first().waitFor({ timeout: 20000 });
    await sleep(500);
    const wide = vp >= 600;
    const topic = page.locator(".hm-topic");
    ok(wide ? await topic.isVisible() : await topic.isHidden(), `${vp}: the bar's button is ${wide ? "shown" : "hidden"} (the bar ${wide ? "has" : "has no"} room for it)`);
    // scrolled up: the arrow shows
    await page.evaluate(() => window.scrollTo({ top: 200, behavior: "instant" }));
    await page.locator('.chat-jump[data-show="true"]').waitFor({ timeout: 5000 });
    for (const pressed of [false, true]) {
      if (pressed) {
        if (wide) await page.getByRole("button", { name: "New topic" }).click();
        else { await page.getByRole("button", { name: "Chat options" }).click(); await page.getByRole("menuitem", { name: /^New topic/ }).click(); }
        await page.locator('.chat-chip[data-kind="topic"]').waitFor({ timeout: 5000 });
        await page.evaluate(() => window.scrollTo({ top: 200, behavior: "instant" }));
        await page.locator('.chat-jump[data-show="true"]').waitFor({ timeout: 5000 });
        await sleep(300);
      }
      const arrow = await rect(page, ".chat-jump");
      const box = await rect(page, ".hm-box");
      const barKids = await page.locator(".hm-bar").last().evaluate((el) => { const b = el.getBoundingClientRect(); return [...el.children].filter((c) => getComputedStyle(c).display !== "none").map((c) => { const r = c.getBoundingClientRect(); return { name: (c.getAttribute("aria-label") || c.textContent || c.className).trim().slice(0, 18), left: r.left - b.left, right: r.right - b.left, top: r.top, bottom: r.bottom, w: b.width }; }); });
      ok(!meets(arrow, box) && arrow.bottom <= box.top + 0.5, `${vp}${pressed ? ", pressed" : ""}: the arrow ends above the box (arrow bottom ${Math.round(arrow.bottom)}, box top ${Math.round(box.top)}) and the box is wider than the arrow`);
      const inside = barKids.every((k) => k.left >= -0.5 && k.right <= k.w + 0.5);
      ok(inside, `${vp}${pressed ? ", pressed" : ""}: every control in the bar is inside it (${barKids.map((k) => `${k.name} ${Math.round(k.left)}-${Math.round(k.right)}`).join(", ")} of ${Math.round(barKids[0]?.w ?? 0)})`);
      const overlap = barKids.some((a, i) => barKids.some((b, j) => j > i && a.left < b.right - 0.5 && b.left < a.right - 0.5));
      ok(!overlap, `${vp}${pressed ? ", pressed" : ""}: no two controls of the bar overlap`);
      if (pressed) {
        const chip = await rect(page, '.chat-chip[data-kind="topic"]');
        ok(chip.left >= box.left - 0.5 && chip.right <= box.right + 0.5 && chip.top >= box.top - 0.5 && !meets(chip, arrow), `${vp}: the chip is inside the box and the arrow does not touch it`);
        ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${vp}: no sideways scrolling with the chip shown`);
      }
    }
    await ctx.close();
  }
  });

  await section("7", async () => {
  /* ================================================================ 7. axe, in the three looks */
  console.log("7. axe: light, dark and read, at 1280 and 390");
  for (const vp of [1280, 390]) {
    const { ctx, page, posted } = await signedIn(vp);
    await sendDone(page, "glaucoma screening in India", 1);
    for (const theme of ["light", "dark", "read"]) {
      await setTheme(page, theme);
      await axe(`${vp} ${theme}: a finished search, the control ${vp >= 600 ? "in the bar" : "in the menu"}`, page);
    }
    if (vp < 600) {
      await page.getByRole("button", { name: "Chat options" }).click();
      await page.getByRole("menu", { name: "Chat options" }).waitFor();
      for (const theme of ["light", "dark", "read"]) { await setTheme(page, theme); await axe(`${vp} ${theme}: the box's menu open on New topic`, page); }
      await page.getByRole("menuitem", { name: /^New topic/ }).click();
    } else await page.getByRole("button", { name: "New topic" }).click();
    await page.locator('.chat-chip[data-kind="topic"]').waitFor();
    for (const theme of ["light", "dark", "read"]) { await setTheme(page, theme); await axe(`${vp} ${theme}: pressed (the chip and the line at the end)`, page); }
    await setTheme(page, "light");
    await sendDone(page, "tuberculosis treatment", 2);
    for (const theme of ["light", "dark", "read"]) { await setTheme(page, theme); await axe(`${vp} ${theme}: the line above the new topic's first message`, page); }
    await setTheme(page, "light");
    // and the line "did not finish"
    await page.route("**/api/v1/chat", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      if (body.message === "stopped one") return void (await new Promise(() => {}));
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: sse(followed(body.message)) });
    });
    await send(page, "stopped one");
    await page.locator('.chat-turn[data-status="working"]').waitFor({ timeout: 10000 });
    await page.getByRole("button", { name: "Stop answering" }).click();
    await page.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="stopped"]').length === 1, null, { timeout: 10000 });
    await send(page, "only after 2020");
    await page.locator(".chat-unfinished").waitFor({ timeout: 20000 });
    await idle(page);
    for (const theme of ["light", "dark", "read"]) { await setTheme(page, theme); await axe(`${vp} ${theme}: the line "did not finish"`, page); }
    await ctx.close();
  }
  });
} finally {
  await browser.close();
  idp.close?.();
}
ok(errors.length === 0, `no page error or console error in the whole run (${errors.length}${errors.length ? ": " + errors.slice(0, 3).join(" | ").slice(0, 300) : ""})`);
console.log(failures === 0 ? "\nall new-topic checks passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
