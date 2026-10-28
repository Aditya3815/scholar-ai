// Browser e2e for Idea Check inside the conversation on Home (W5): an idea written in the box (or offered by Auto) opens the Idea Check workspace under it; the search plan is shown
// and nothing is searched until the person approves it; the papers and the comparison follow in the same place; after a reload only the idea's text is left ("run it again").
// Needs the Worker with the fake identity provider and the offline stand-ins: `npm run integration -w apps/api -- --browser` starts it.
//   node e2e/idea-chat.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startFakeIdp } from "../../api/scripts/fake-idp.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.argv[2] ?? "http://localhost:8788";
const OUT = fileURLToPath(new URL("./shots/idea-chat-", import.meta.url));
mkdirSync(fileURLToPath(new URL("./shots/", import.meta.url)), { recursive: true });
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "idea-chat-1", email: "kavya.r@example.edu", email_verified: true, name: "Kavya R" });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
const errors = [];
const watch = (p) => {
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401|403|404|409)/.test(m.text())) errors.push("console: " + m.text()); });
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
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
async function pick(p, name) {
  if (new RegExp(name).test(await p.locator(".hm-mode").innerText())) return;
  await p.locator(".hm-mode").click();
  await p.getByRole("menuitemradio", { name: new RegExp("^" + name) }).click();
  await p.getByRole("menu", { name: "What should I do?" }).waitFor({ state: "hidden" });
}

const IDEA = "My idea is to detect fraudulent invoices in small cooperative banks using graph neural networks on transaction networks, and to test the approach against public benchmark data. Is it new?";

try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  watch(page);
  const requests = [];
  page.on("request", (r) => { if (r.url().includes("/api/v1/idea/")) requests.push(new URL(r.url()).pathname.split("/").pop()); });

  console.log("an idea in Auto is offered, not started");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
  await page.getByRole("button", { name: "Continue with Google" }).last().click();
  await page.locator("#hm-h").waitFor({ timeout: 20000 });
  await pick(page, "Auto");
  await page.locator(".hm-input").fill(IDEA);
  await page.keyboard.press("Enter");
  await page.locator(".chat-offer").waitFor({ timeout: 20000 });
  ok(/Idea Check/.test(await page.locator(".chat-und").first().innerText()) && await page.getByRole("button", { name: "Check it here" }).isVisible() && await page.getByRole("button", { name: "Open the Idea Check page" }).isVisible(), "the idea is taken for Idea Check; the card offers to check it here or to open the page");
  ok(/searches only after you have seen and approved the search plan/.test(await page.locator(".chat-offer").innerText()), "and says it searches only after the plan is approved");
  ok(requests.length === 0 && await page.locator(".chat-idea").count() === 0, "nothing has been sent to Idea Check yet");

  console.log("checking it here");
  await page.getByRole("button", { name: "Check it here" }).click();
  await page.locator(".chat-idea").waitFor();
  ok(new URL(page.url()).pathname === "/" && /My idea is to detect fraudulent invoices/.test(await page.locator(".chat-idea textarea").first().inputValue()), "the workspace opens under the question, with the idea in it, and the page does not move");
  const note = page.getByRole("region", { name: /how your ideas are handled/ });
  await note.waitFor();
  ok(requests.length === 0, "a person who has not read the privacy note yet is asked to, before anything is read (nothing sent)");
  await page.waitForTimeout(700);
  await axe("idea in the conversation, privacy note", page);
  await note.getByRole("button", { name: "I understand, continue" }).click();
  await note.waitFor({ state: "detached", timeout: 8000 });
  // asking for the check in the conversation was the click: once the note is read the plan is proposed at once; the search still waits
  await page.getByRole("heading", { level: 2, name: /This is all that will be sent/ }).waitFor({ timeout: 15000 });
  ok(requests.filter((r) => r === "plan").length === 1 && !requests.includes("search"), "after the note the plan is made at once; the search has not run");
  await page.waitForTimeout(900);
  ok((await page.locator(".chat-idea .idea-steps li[data-state='now']").innerText()).includes("Search plan") && (await page.locator(".plan-kw input").count()) >= 2, "the plan is shown with its steps and editable searches");
  await page.screenshot({ path: OUT + "1-plan.png" });
  await axe("idea in the conversation, plan", page);
  await setTheme(page, "dark");
  await page.waitForTimeout(500);
  await axe("idea in the conversation, plan, dark", page);
  await setTheme(page, "light");

  console.log("approving the plan");
  await page.getByRole("button", { name: "Search the literature" }).click();
  await page.locator(".chat-idea .result").first().waitFor({ timeout: 15000 });
  await page.getByRole("heading", { level: 2, name: /papers closest to your idea/ }).waitFor();
  ok(requests.includes("search") && (await page.locator(".chat-idea .result").count()) === 3, "after the approval the search runs and the closest papers are listed in the conversation");
  await page.getByRole("button", { name: "Compare with my idea" }).click();
  await page.getByRole("heading", { level: 2, name: /closest papers cover/ }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(900);
  ok((await page.locator(".cmp-row").count()) === 4 && !/novel|new idea|% /i.test(await page.locator(".cmp-map").innerText()), "the coverage map follows, and claims nothing about novelty");
  await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + "2-compare.png" });
  await axe("idea in the conversation, compared", page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  ok(await noSideways(page), "no sideways scroll on a phone");
  await axe("idea in the conversation, phone", page);
  await page.setViewportSize({ width: 1360, height: 900 });

  console.log("the box keeps working, and the idea is part of the conversation");
  await pick(page, "Search papers");
  await page.locator(".hm-input").fill("glaucoma screening");
  await page.keyboard.press("Enter");
  await page.locator('.chat-turn[data-status="done"]').nth(1).waitFor({ timeout: 30000 });
  ok(await page.locator(".chat-idea .result").count() === 3, "a search after it does not disturb the Idea Check above");

  console.log("after a reload only the idea's text is left");
  await page.waitForFunction(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open("scholar"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = await new Promise((res) => { const q = db.transaction("chats").objectStore("chats").getAll(); q.onsuccess = () => res(q.result); });
    db.close();
    return all.some((c) => c.messages.some((m) => m.role === "idea")) && all.every((c) => c.messages.every((m) => m.role !== "assistant" || m.status !== "working"));
  }, null, { timeout: 15000 });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".chat-idea").waitFor({ timeout: 15000 });
  ok(/run in an earlier visit/.test(await page.locator(".chat-idea").innerText()) && await page.locator(".chat-idea .result").count() === 0 && await page.locator(".chat-idea textarea").count() === 0, "the Idea Check says it was run before, and that its plan and papers are not kept");
  const stored = await page.evaluate(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open("scholar"); r.onsuccess = () => res(r.result); });
    const all = await new Promise((res) => { const q = db.transaction("chats").objectStore("chats").getAll(); q.onsuccess = () => res(q.result); });
    db.close();
    return JSON.stringify(all);
  });
  ok(/fraudulent invoices/.test(stored) && !/semanticQuery|keywordQueries|facets/.test(stored), "what is kept is the idea's text; the plan and the papers are not in the browser's storage");
  await page.getByRole("button", { name: "Run it again" }).click();
  await page.getByRole("heading", { level: 2, name: /This is all that will be sent/ }).waitFor({ timeout: 15000 });
  ok(requests.filter((r) => r === "plan").length === 2, "'Run it again' proposes the plan at once (the privacy note was read): the search still waits for approval");

  console.log("from the tool menu");
  await page.locator(".ws-rail").getByRole("button", { name: "New chat" }).click();
  await page.locator(".hm-title").waitFor();
  await pick(page, "Idea Check");
  await page.locator(".hm-input").fill("too short for an idea");
  await page.keyboard.press("Enter");
  await page.locator(".hm-problem").waitFor();
  ok(/at least 40 characters/.test(await page.locator(".hm-problem").innerText()) && await page.locator(".chat-idea").count() === 0, "a few words are not an idea: a plain line, nothing started, the text stays");
  await page.locator(".hm-input").fill(IDEA);
  await page.keyboard.press("Enter");
  await page.locator(".chat-idea").waitFor({ timeout: 10000 });
  ok(await page.locator(".chat-bubble").count() === 1 && /My idea is to detect/.test(await page.locator(".chat-bubble").innerText()), "with Idea Check chosen, Enter puts the idea in the conversation and opens the workspace (no page change)");
  await page.getByRole("heading", { level: 2, name: /This is all that will be sent/ }).waitFor({ timeout: 15000 });

  console.log("the page version is still there");
  await page.locator(".ws-rail").getByRole("button", { name: "New chat" }).click();
  await page.locator(".hm-title").waitFor();
  await pick(page, "Auto");
  await page.locator(".hm-input").fill(IDEA);
  await page.keyboard.press("Enter");
  await page.locator(".chat-offer").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Open the Idea Check page" }).click();
  await page.waitForFunction(() => location.pathname === "/idea", null, { timeout: 8000 });
  await page.waitForTimeout(600);
  ok(/My idea is to detect/.test(await page.locator("textarea").first().inputValue()) && await page.getByRole("heading", { level: 1, name: /Has your idea been/ }).isVisible(), "the second button opens the Idea Check page with the idea in it");

  console.log("without signing in");
  const anon = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const ap = await anon.newPage();
  watch(ap);
  await ap.goto(BASE + "/home", { waitUntil: "networkidle" });
  await ap.locator("#hm-h").waitFor({ timeout: 20000 });
  await pick(ap, "Idea Check");
  await ap.locator(".hm-input").fill(IDEA);
  await ap.keyboard.press("Enter");
  await ap.locator(".chat-idea").waitFor({ timeout: 10000 });
  await ap.locator(".chat-idea").getByRole("heading", { level: 2, name: "Sign in to check an idea" }).waitFor({ timeout: 10000 }); // the workspace is a chunk fetched on arrival
  ok(await ap.locator(".chat-idea").getByRole("heading", { level: 2, name: "Sign in to check an idea" }).isVisible() && await ap.locator(".chat-idea textarea").count() === 0, "a visitor is asked to sign in inside the turn; nothing is read");
  await ap.waitForTimeout(700);
  await axe("idea in the conversation, signed out", ap);
  await anon.close();

  ok(errors.length === 0, `no console or page errors${errors.length ? ": " + errors.slice(0, 4).join(" | ") : ""}`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
} finally {
  await browser.close();
  idp.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall idea-in-conversation browser checks passed");
  process.exit(failures ? 1 : 0);
}
