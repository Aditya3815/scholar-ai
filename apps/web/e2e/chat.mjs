// Browser e2e for the prompt box as a conversation (W2): a search streams its papers and a short answer whose claims point at sentences of abstracts, Stop, errors and
// notices in plain words, chats kept in the browser (reload, recent list, another tab, storage that refuses), signing out clears them.
// Needs the Worker with the fake identity provider and the offline stand-ins: `npm run integration -w apps/api -- --browser` starts it.
//   node e2e/chat.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startFakeIdp } from "../../api/scripts/fake-idp.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.argv[2] ?? "http://localhost:8788";
const OUT = fileURLToPath(new URL("./shots/chat-", import.meta.url));
mkdirSync(fileURLToPath(new URL("./shots/", import.meta.url)), { recursive: true });
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "chat-ui-1", email: "isha.m@example.edu", email_verified: true, name: "Isha M" });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
const errors = [];
const watch = (p) => {
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401|403|404|409)/.test(m.text())) errors.push("console: " + m.text()); });
};
const newCtx = (opts = {}) => browser.newContext({ viewport: { width: 1360, height: 900 }, ...opts });
const flag = (ctx) => ctx.addInitScript(() => { try { localStorage.setItem("scholar.ws", "1"); } catch {} });

async function axe(label, p) {
  await p.evaluate(axeSource);
  const res = await p.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(" "), msg: v.nodes[0]?.failureSummary?.split("\n")[1] }));
  });
  ok(res.length === 0, `axe [${label}]`);
  for (const v of res) console.log(`        ${v.impact} ${v.id} x${v.nodes} ${v.sample} :: ${v.msg}`);
}
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const setTheme = (p, t) => p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), t);

try {
  const ctx = await newCtx();
  await flag(ctx);
  const page = await ctx.newPage();
  watch(page);
  // the tool is chosen from the mode menu (a choice that is already made stays as it is)
  const pick = async (p, name) => {
    if (new RegExp(name).test(await p.locator(".hm-mode").innerText())) return;
    await p.locator(".hm-mode").click();
    await p.getByRole("menuitemradio", { name: new RegExp("^" + name) }).click();
    await p.getByRole("menu", { name: "What should I do?" }).waitFor({ state: "hidden" });
  };
  const send = async (text, { tool = "Search papers" } = {}) => {
    await page.waitForFunction(() => !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 30000 }); // one message at a time
    if (tool) await pick(page, tool);
    await page.locator(".hm-input").fill(text);
    await page.keyboard.press("Enter");
  };
  const sendAuto = (text) => send(text, { tool: "Auto" });
  const turns = () => page.locator(".chat-turn");
  const lastDone = () => page.locator('.chat-turn[data-status="done"]').last();

  console.log("sign in");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
  await page.getByRole("button", { name: "Continue with Google" }).last().click();
  await page.locator("#hm-h").waitFor({ timeout: 20000 });

  console.log("a search becomes a conversation");
  ok(await page.locator(".hm-title").isVisible() && await page.locator(".chat-list").count() === 0, "before the first message the home is as it was: the headline and the box in the middle");
  ok(/Auto/.test(await page.locator(".hm-mode").innerText()), "the box starts in Auto");
  const boxBefore = await page.locator(".hm-box").boundingBox();
  await send("  glaucoma   screening ");
  await page.locator(".chat-bubble").waitFor();
  ok(/glaucoma screening/.test(await page.locator(".chat-bubble").innerText()), "the question appears as a message, tidied");
  await page.locator(".chat-turn .result").first().waitFor({ timeout: 20000 });
  await lastDone().waitFor({ timeout: 30000 });
  const boxAfter = await page.locator(".hm-box").boundingBox();
  ok(boxAfter.y > boxBefore.y - 5 && boxAfter.y + boxAfter.height <= 900, `the box has glided to the bottom of the window (from y ${Math.round(boxBefore.y)} to ${Math.round(boxAfter.y)})`);
  ok(await page.locator(".hm-title").count() === 0 && await page.locator(".chat-title").isVisible(), "the headline gives way to the conversation's title");
  ok(/Searching papers, as you chose/.test(await turns().first().innerText()), "a search chosen by hand says so above the answer");
  ok(await page.locator(".chat-turn .result").count() === 5, "the five papers are listed");
  ok((await page.locator(".chat-turn .result-no").allInnerTexts()).join() === "1,2,3,4,5", "numbered 1 to 5, as the marks in the answer are");
  const answer = page.locator(".chat-answer");
  ok(/The first paper reports its main result/.test(await answer.innerText()) && await answer.getByRole("button", { name: /^Source 1/ }).isVisible(), "a short answer is written, its claim marked with a button for paper 1");
  ok(/Every claim points at a sentence of an abstract/.test(await answer.innerText()), "and it says what that means");
  ok(await page.locator(".result[data-retracted=true] .retract").first().isVisible() && await page.locator(".chat-note[data-kind=retracted]").isVisible(), "the retracted paper has its banner, and a line says it was not used for the answer");
  ok(await page.locator(".chat-turn .sr-only[role=status]").innerText().then((t) => /Answer ready, 5 papers/.test(t)), "a polite message tells a screen reader that the answer is ready (not the words one by one)");
  ok(!/openalex|s2|semantic|crossref|pubmed/i.test(await turns().first().locator(".chat-note, .chat-why, .chat-und, .chat-steps").allInnerTexts().then((x) => x.join(" "))), "no source is named in what is said about the search");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: OUT + "1-conversation.png" });

  console.log("the marks point at the papers");
  await answer.getByRole("button", { name: /^Source 1/ }).click();
  await page.waitForFunction(() => document.querySelector('.result[data-n="1"]')?.getAttribute("data-flash") === "true", null, { timeout: 4000 });
  ok(true, "pressing the mark for paper 1 scrolls to it and marks it for a moment");
  await page.locator(".chat-evidence summary").click();
  ok(/The model reached an AUC of 0\.94 on a held-out set\./.test(await page.locator(".chat-evidence").innerText()), "'The sentences behind it' shows the sentence of the abstract the claim rests on, word for word");
  await page.locator(".chat-ev").first().click();
  await page.waitForFunction(() => document.querySelector('.result[data-n="1"]')?.getAttribute("data-flash") === "true", null, { timeout: 4000 });
  ok(true, "and each sentence leads to its paper too");

  console.log("themes and a phone");
  await page.waitForTimeout(2200);
  for (const theme of ["light", "dark", "read"]) {
    await setTheme(page, theme);
    await page.waitForTimeout(500);
    await axe(`conversation, ${theme}`, page);
  }
  await setTheme(page, "light");
  ok(await noSideways(page), "no sideways scroll");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  ok(await noSideways(page), "no sideways scroll on a phone");
  const phoneBox = await page.locator(".hm-box").boundingBox();
  ok(phoneBox.y + phoneBox.height <= 844 && phoneBox.y >= 0, "the box stays on the screen on a phone");
  await page.screenshot({ path: OUT + "2-phone.png" });
  await axe("conversation, phone", page);
  await page.setViewportSize({ width: 1360, height: 900 });

  console.log("what can and cannot be sent");
  await page.locator(".hm-input").fill("x");
  ok(await page.locator(".hm-send").isDisabled(), "one letter cannot be sent");
  const long = "a".repeat(301);
  await page.locator(".hm-input").fill(long);
  await page.keyboard.press("Enter");
  await page.locator(".hm-problem").waitFor();
  ok(/at most 300 characters/.test(await page.locator(".hm-problem").innerText()) && (await page.locator(".hm-input").inputValue()) === long && await turns().count() === 1, "301 characters are refused with the limit, nothing is cut, the text stays in the box");
  await page.locator(".hm-input").fill("");

  console.log("notices in plain words");
  await send("partial glaucoma", { tool: false });
  await page.locator(".chat-note[data-kind=partial]").waitFor({ timeout: 20000 });
  ok((await page.locator(".chat-note[data-kind=partial]").innerText()).startsWith("Some of the places we search did not answer, so this list may be incomplete. Search again") && await page.locator(".chat-turn").last().locator(".result").count() === 5, "a source that did not answer is said so plainly, and the rest is still shown");
  await page.locator('.chat-turn[data-status="done"]').nth(1).waitFor({ timeout: 30000 });
  ok(await page.locator(".chat-turn").last().locator(".chat-answer").isVisible(), "...and still answered from what was found");
  await page.locator(".chat-turn").last().locator(".chat-note[data-kind=partial]").getByRole("button", { name: "Search again" }).click();
  await page.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="done"]').length === 2, null, { timeout: 30000 });
  ok(await page.locator(".chat-bubble").count() === 2, "'Search again' runs the same question again where it stands, without a new message");
  await send("nothing at all", { tool: false });
  await page.locator(".chat-note[data-kind=nothing]").waitFor({ timeout: 20000 });
  ok(/Nothing was found/.test(await page.locator(".chat-note[data-kind=nothing]").innerText()) && await page.locator(".chat-turn").last().locator(".result").count() === 0, "no papers: a plain line, and no invented paper");
  await send("an unanswerable glaucoma question", { tool: false });
  await page.locator(".chat-why").last().waitFor({ timeout: 30000 });
  ok(/do not seem to answer this directly/.test(await page.locator(".chat-why").last().innerText()), "when the papers do not answer, it says so and shows no sentence of the model's");
  await send("hallucinate glaucoma", { tool: false });
  await page.locator('.chat-list > li:last-child .chat-turn[data-status="done"]').waitFor({ timeout: 30000 });
  ok(/could not be checked/.test(await page.locator(".chat-list > li:last-child .chat-why").innerText()), "an answer that could not be checked says so");
  ok(await page.locator(".chat-list > li:last-child .chat-answer").count() === 0, "an answer whose evidence is not a real sentence is not shown");

  console.log("Stop, and one message at a time");
  const before = await page.locator(".chat-bubble").count();
  await send("slowly glaucoma", { tool: false });
  await page.getByRole("button", { name: "Stop answering" }).waitFor({ timeout: 10000 });
  await page.locator(".hm-input").fill("a second message while the first is being answered");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  ok(await page.locator(".chat-bubble").count() === before + 1 && (await page.locator(".hm-input").inputValue()).length > 0, "a second message while one is being answered is not sent, and stays in the box");
  await page.locator(".chat-turn .result").last().waitFor({ timeout: 10000 });
  await page.getByRole("button", { name: "Stop answering" }).click();
  await page.locator('.chat-turn[data-status="stopped"]').waitFor({ timeout: 10000 });
  ok(/Stopped\./.test(await page.locator('.chat-turn[data-status="stopped"]').innerText()) && await page.locator('.chat-turn[data-status="stopped"] .result').count() > 0, "Stop ends the answer, says so, and keeps the papers found");
  ok(await page.locator('.chat-turn[data-status="stopped"] .chat-answer').count() === 0, "no half-written answer is kept");
  ok(await page.getByRole("button", { name: /Search papers: send/ }).isVisible(), "the button is a Send button again");
  await page.locator(".hm-input").fill("");
  await send("glaucoma again", { tool: false });
  await page.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="done"]').length >= 5, null, { timeout: 30000 });
  ok(true, "the next message works as usual");

  console.log("kept in this browser");
  const total = await page.locator(".chat-bubble").count();
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".chat-bubble").first().waitFor({ timeout: 15000 });
  ok(await page.locator(".chat-bubble").count() === total && await page.locator(".chat-turn .result").count() > 5, "after a reload the conversation is back, with its papers");
  ok(await page.locator(".chat-answer").count() >= 1 && await page.locator('.chat-turn[data-status="stopped"]').count() === 1, "its answers and the stopped reply are as they were");
  const recent = page.locator(".ws-rail .ws-recent");
  ok(await recent.getByRole("button").first().innerText().then((t) => /glaucoma screening/.test(t)), "the rail lists the conversation under Recent, by its first message");
  await page.locator(".ws-rail").getByRole("button", { name: "New chat" }).click();
  await page.locator(".hm-title").waitFor();
  ok(await page.locator(".chat-list").count() === 0 && await recent.getByRole("button").count() >= 1, "New chat brings the headline back, and the old conversation stays under Recent");
  await recent.getByRole("button", { name: /glaucoma screening/ }).first().click();
  await page.locator(".chat-bubble").first().waitFor();
  ok(await page.locator(".chat-bubble").count() === total, "pressing it opens it again");

  console.log("a page closed in the middle of an answer");
  await page.locator(".ws-rail").getByRole("button", { name: "New chat" }).click();
  await send("slowly glaucoma interrupted");
  await page.locator(".chat-turn .result").first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(900); // the papers are kept a moment after they arrive
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('.chat-turn[data-status="interrupted"]').waitFor({ timeout: 15000 });
  ok(/interrupted/.test(await page.locator('.chat-turn[data-status="interrupted"]').innerText()) && await page.locator('.chat-turn[data-status="interrupted"] .result').count() > 0, "the reply is marked interrupted and keeps the papers that had come");
  await page.locator('.chat-turn[data-status="interrupted"]').getByRole("button", { name: "Search again" }).click();
  await page.locator('.chat-turn[data-status="done"]').waitFor({ timeout: 30000 });
  ok(true, "'Search again' finishes it");

  console.log("Change");
  await page.locator(".ws-rail").getByRole("button", { name: "New chat" }).click();
  await send("Mere thesis ke references check karo");
  await page.locator('.chat-turn[data-status="done"]').waitFor({ timeout: 30000 });
  await page.locator(".chat-change").click();
  await page.getByRole("menuitem", { name: /Idea Check/ }).click();
  await page.waitForFunction(() => location.pathname === "/idea", null, { timeout: 10000 });
  ok(/Mere thesis/.test(await page.locator("textarea").first().inputValue()), "'Change' hands the same text to Idea Check");
  await page.goBack();
  await page.locator("#hm-h").waitFor();

  console.log("Auto: the tool is chosen from what is written (W3)");
  await page.locator(".ws-rail").getByRole("button", { name: "New chat" }).click();
  await page.locator(".hm-title").waitFor();
  await pick(page, "Auto");
  const lastTurn = () => page.locator(".chat-turn").last();
  const doneTurns = () => page.locator('.chat-turn[data-status="done"]').count();
  await sendAuto("glaucoma screening in India");
  await page.locator('.chat-turn[data-status="done"]').waitFor({ timeout: 30000 });
  ok(/I understood this as Search papers/.test(await lastTurn().innerText()) && await lastTurn().locator(".result").count() === 5 && await lastTurn().locator(".chat-answer").isVisible(), "a plain question: 'I understood this as Search papers', the papers and the answer");
  ok(await lastTurn().locator(".chat-searched").count() === 0, "(English words are searched as written: no 'I searched for' line)");

  await sendAuto("diabetes me exercise ka kya asar hota hai");
  await page.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="done"]').length === 2, null, { timeout: 30000 });
  ok(/I searched for:\s*translated: diabetes me exercise ka kya/.test(await lastTurn().locator(".chat-searched").innerText()), "a Hinglish question: the English words that were searched are shown");
  ok(await lastTurn().locator(".chat-searched b").getAttribute("lang") === "en" && await lastTurn().locator(".result").count() === 5, "(marked as English for a screen reader) and the papers are there");
  await lastTurn().getByRole("button", { name: "Use my exact words" }).click();
  await page.waitForFunction(() => /Searching papers, as you chose/.test(document.querySelectorAll(".chat-turn")[1]?.textContent ?? ""), null, { timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="done"]').length === 2, null, { timeout: 30000 });
  ok(await page.locator(".chat-bubble").count() === 2 && await lastTurn().locator(".chat-searched").count() === 0, "'Use my exact words' searches them as written, in the same place, with no new message");

  const REFS = "[1] LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521, 436-444.\n[2] Vaswani, A., Shazeer, N., Parmar, N., et al. (2017). Attention is all you need. NeurIPS.\n[3] Krizhevsky, A., Sutskever, I., & Hinton, G. E. (2012). ImageNet classification with deep convolutional neural networks. NIPS.";
  await sendAuto(REFS);
  await page.locator(".chat-offer").waitFor({ timeout: 20000 });
  ok(new URL(page.url()).pathname === "/" && /Check references/.test(await lastTurn().locator(".chat-und").first().innerText()) && await lastTurn().locator(".result").count() === 0, "pasted references: it says Check references and offers it; nothing was searched and the page did not move");
  await page.getByRole("button", { name: "Open Check references" }).click();
  await page.waitForFunction(() => location.pathname === "/verify", null, { timeout: 10000 });
  await page.waitForTimeout(600);
  ok(/Deep learning/.test(await page.locator("textarea").first().inputValue()) && /Attention is all you need/.test(await page.locator("textarea").first().inputValue()), "'Open Check references' hands over the whole list");
  await page.goBack();
  await page.locator("#hm-h").waitFor();

  await sendAuto("my idea about using bees to detect cancer, is it novel");
  await page.waitForFunction(() => document.querySelectorAll(".chat-offer").length === 2, null, { timeout: 20000 });
  ok(new URL(page.url()).pathname === "/" && /starts only when you open it and approve the search/.test(await page.locator(".chat-offer").last().innerText()), "an idea is offered to Idea Check, which starts only by a click and an approval: the page did not move");
  await page.locator(".chat-offer").last().scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  await axe("an offer to open Idea Check, light", page);
  await setTheme(page, "dark");
  await page.waitForTimeout(500);
  await axe("an offer to open Idea Check, dark", page);
  await setTheme(page, "light");
  await page.screenshot({ path: OUT + "3-auto-offer.png" });
  await lastTurn().locator(".chat-change").click();
  ok((await page.getByRole("menuitem").allInnerTexts()).filter((t) => /Search papers|Check references|Ask a paper|Idea Check/.test(t)).length === 3, "Change lists the other three tools, not the one chosen");
  await page.getByRole("menuitem", { name: /Search papers/ }).click();
  await page.waitForFunction(() => /Searching papers, as you chose/.test([...document.querySelectorAll(".chat-turn")].at(-1)?.textContent ?? "") && document.querySelectorAll(".chat-turn .result").length > 10, null, { timeout: 30000 });
  ok(await lastTurn().locator(".chat-offer").count() === 0, "Change to Search papers searches the exact words in place and the offer goes");

  await sendAuto("my uploaded paper, what does it say about methods");
  await page.waitForFunction(() => document.querySelectorAll(".chat-offer").length === 2 && /Open My Workspace/.test(document.body.textContent ?? ""), null, { timeout: 20000 });
  ok(true, "a question about the reader's own paper is offered to My Workspace");

  await sendAuto("boom my idea about sleep");
  await page.waitForFunction(() => /I was not sure what you wanted, so I searched for papers/.test([...document.querySelectorAll(".chat-turn")].at(-1)?.textContent ?? ""), null, { timeout: 30000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".chat-turn")].at(-1)?.getAttribute("data-status") === "done", null, { timeout: 30000 });
  ok(await lastTurn().locator(".result").count() === 5, "when the router fails it says it was not sure and searches (harmless), with Change at hand");

  await sendAuto("boom " + "sleep and memory ".repeat(30));
  await page.waitForFunction(() => /too long for a search/.test([...document.querySelectorAll(".chat-turn")].at(-1)?.textContent ?? ""), null, { timeout: 30000 });
  ok(await lastTurn().locator(".result").count() === 0 && /characters, the start is shown/.test(await page.locator(".chat-bubble").last().innerText()), "a long text the router could not shorten is not searched: a plain line");

  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".chat-offer").first().waitFor({ timeout: 15000 });
  ok(await page.locator(".chat-offer").count() >= 1 && await page.locator(".chat-searched").count() === 0, "after a reload the offers are still there, with the same text");
  await page.waitForTimeout(600);
  await page.evaluate(() => window.scrollTo(0, 0));
  await axe("Auto conversation after a reload", page);

  console.log("another tab");
  const page2 = await ctx.newPage();
  watch(page2);
  await page2.goto(BASE + "/", { waitUntil: "networkidle" });
  await page2.locator("#hm-h").waitFor();
  ok(await page2.locator(".hm-title").isVisible() && await page2.locator(".ws-rail .ws-recent").getByRole("button").count() >= 2, "a second tab has a conversation of its own (it starts empty) and sees the same Recent list");
  await pick(page2, "Search papers");
  await page2.locator(".hm-input").fill("tab two question");
  await page2.keyboard.press("Enter");
  await page2.locator('.chat-turn[data-status="done"]').waitFor({ timeout: 30000 });
  await page.bringToFront();
  await page.waitForFunction(() => [...document.querySelectorAll(".ws-recent button.ws-recent-open")].some((b) => /tab two question/.test(b.textContent ?? "")), null, { timeout: 8000 });
  ok(true, "a conversation started in one tab shows up under Recent in the other, at once");
  ok(await page.locator(".chat-bubble").filter({ hasText: "tab two question" }).count() === 0, "without taking over the other tab's conversation");
  await page2.close();

  console.log("Settings and signing out");
  await page.locator(".ws-rail").getByRole("link", { name: "Settings" }).click();
  await page.getByRole("heading", { name: "Chats" }).waitFor();
  ok(/only in this browser/.test(await page.locator(".settings-sec", { has: page.getByRole("heading", { name: "Chats" }) }).innerText()), "Settings says the chats are kept only in this browser");
  await page.locator(".ws-rail").getByRole("button", { name: "Sign out" }).click();
  await page.locator(".ws-anon").waitFor({ timeout: 20000 });
  const left = await page.evaluate(async () => ({
    index: localStorage.getItem("scholar.chats.v1"),
    active: sessionStorage.getItem("scholar.chat.active"),
    stored: await new Promise((resolve) => { const r = indexedDB.open("scholar"); r.onerror = () => resolve(-1); r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains("chats")) return resolve(0); const c = db.transaction("chats").objectStore("chats").count(); c.onsuccess = () => resolve(c.result); }; }),
  }));
  ok(left.index === null && left.active === null && left.stored === 0, "signing out removes every conversation from this browser");

  console.log("without signing in");
  const anon = await newCtx();
  await flag(anon);
  const ap = await anon.newPage();
  watch(ap);
  await ap.goto(BASE + "/home", { waitUntil: "networkidle" });
  await ap.locator("#hm-h").waitFor({ timeout: 20000 });
  ok(/Auto/.test(await ap.locator(".hm-mode").innerText()), "a person who is not signed in starts in Auto too");
  await ap.locator(".hm-input").fill("glaucoma screening");
  await ap.keyboard.press("Enter");
  await ap.locator('.chat-turn[data-status="done"]').waitFor({ timeout: 30000 });
  ok(/I understood this as Search papers/.test(await ap.locator(".chat-turn").first().innerText()), "Auto reads a plain question without a model: 'I understood this as Search papers'");
  ok(await ap.locator(".chat-turn .result").count() === 5 && await ap.locator(".chat-answer").count() === 0, "a person who has not signed in gets the papers and no written answer");
  ok(/Sign in to get a short written answer/.test(await ap.locator(".chat-why").innerText()) && await ap.locator(".chat-why").getByRole("button", { name: "Sign in" }).isVisible(), "and a line, with a Sign in button, says why");
  ok(await ap.locator(".chat-steps").count() === 0, "(the steps of a written answer are not promised to them)");
  await ap.evaluate(() => window.scrollTo(0, 0)); // axe reads what is on screen: the box at the bottom covers part of whatever is scrolled under it
  await axe("conversation, signed out", ap);
  await ap.locator(".hm-input").fill("check my references please");
  await ap.keyboard.press("Enter");
  await ap.locator(".chat-offer").waitFor({ timeout: 20000 });
  ok(/Check references/.test(await ap.locator(".chat-und").last().innerText()), "the words of a tool are enough for it to be offered, with no model");
  await anon.close();

  console.log("storage that refuses");
  const blocked = await newCtx();
  await flag(blocked);
  await blocked.addInitScript(() => { const open = indexedDB.open.bind(indexedDB); indexedDB.open = (...a) => { if (a[0] === "scholar") throw new DOMException("blocked", "SecurityError"); return open(...a); }; });
  const bp = await blocked.newPage();
  watch(bp);
  await bp.goto(BASE + "/home", { waitUntil: "networkidle" });
  await bp.locator("#hm-h").waitFor();
  await pick(bp, "Search papers");
  await bp.locator(".hm-input").fill("glaucoma screening");
  await bp.keyboard.press("Enter");
  await bp.locator('.chat-turn[data-status="done"]').waitFor({ timeout: 30000 });
  ok(await bp.locator(".chat-turn .result").count() === 5, "when the browser refuses to keep chats the conversation still works");
  await bp.getByText(/would not keep your chats/).waitFor({ timeout: 5000 });
  ok(true, "and a notice says it will not be kept");
  await blocked.close();

  ok(errors.length === 0, `no console or page errors${errors.length ? ": " + errors.slice(0, 4).join(" | ") : ""}`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
} finally {
  await browser.close();
  idp.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall chat browser checks passed");
  process.exit(failures ? 1 : 0);
}
