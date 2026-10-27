// Browser e2e for the literature scan: a topic, the sub-questions the person edits before anything is searched, the scan running on the server (progress, stop), the report with its
// checked answers, gaps and one list of sources, coming back to it after a reload, the Markdown file, deleting it. Light, dark and phone width, with axe.
// Needs the Worker with the fake identity provider and the offline stand-ins: `npm run integration -w apps/api -- --browser` starts it.
//   node e2e/litscan.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startFakeIdp } from "../../api/scripts/fake-idp.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.argv[2] ?? "http://localhost:8788";
const OUT = fileURLToPath(new URL("./shots/litscan-", import.meta.url));
mkdirSync(fileURLToPath(new URL("./shots/", import.meta.url)), { recursive: true });
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "ls-ui-1", email: "tara.n@example.edu", email_verified: true, name: "Tara N" });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
const errors = [];
const watch = (p) => {
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401|403|404|409)/.test(m.text())) errors.push("console: " + m.text()); });
};
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
// colours transition when the theme changes: axe must not read them mid-way
const setTheme = async (p, t) => { await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), t); await new Promise((r) => setTimeout(r, 1300)); };
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const item = (p, i) => p.locator(".ls-item").nth(i);

try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  await flag(ctx);
  const page = await ctx.newPage();
  watch(page);

  console.log("signed out");
  await page.goto(BASE + "/literature-scan", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Literature scan", level: 1 }).waitFor();
  ok(await page.getByRole("heading", { name: "Sign in to scan the literature" }).isVisible(), "a visitor is asked to sign in (the scan runs on an account)");
  ok(await page.title() === "Literature scan · Scholar AI", "the page has its own title");
  await axe("signed out", page);

  console.log("sign in, find it in the rail, read the privacy note");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
  await page.getByRole("button", { name: "Continue with Google" }).last().click();
  await page.locator("#hm-h").waitFor({ timeout: 20000 });
  await page.locator(".ws-rail").getByRole("link", { name: "Literature scan" }).click();
  await page.getByRole("heading", { name: "Literature scan", level: 1 }).waitFor();
  ok(page.url().endsWith("/literature-scan") && await page.locator(".ws-rail").getByRole("link", { name: "Literature scan" }).getAttribute("aria-current") === "page", "the left rail opens it and marks it as the current page");
  const card = page.getByRole("heading", { name: /how your topics are handled/ });
  ok(await card.isVisible(), "the privacy note comes first: what the topic and the abstracts are used for, and that a scan is kept for a day");
  const plan = page.getByRole("button", { name: "Plan the scan" });
  await page.getByLabel("What do you want to know about?").fill("air pollution and childhood asthma");
  ok(await plan.isDisabled(), "the plan cannot be asked for before the note has been read");
  await page.getByRole("button", { name: "I understand, continue" }).click();
  await card.waitFor({ state: "detached" });
  ok(await plan.isEnabled(), "...and can after");
  await axe("input, light", page);
  await setTheme(page, "dark");
  await axe("input, dark", page);
  await setTheme(page, "light");

  console.log("the plan, edited before anything is searched");
  await page.getByLabel("Write the answers in").selectOption("auto");
  await plan.click();
  await page.getByRole("heading", { name: "air pollution and childhood asthma", level: 2 }).waitFor({ timeout: 20000 });
  ok(await page.locator(".ls-item").count() === 4, "the topic becomes four sub-questions, each with its question and its English search words");
  ok(/Only the search words below/.test(await page.locator(".ls-sendnote").innerText()), "it says that only the search words reach the public indexes, not the topic");
  ok(/about 12,000 AI tokens/.test(await page.locator(".ls-cost").innerText()) && /60,000/.test(await page.locator(".ls-cost").innerText()), "it says what the scan is expected to use of the day's allowance");
  ok(await page.getByLabel("Write the answers in").inputValue() === "en", "the answers' language is chosen from the topic (English here)");
  await item(page, 1).locator("input").nth(0).fill("nothing found for this one?");
  await item(page, 1).locator("input").nth(1).fill("nothing words here");
  await item(page, 2).locator("input").nth(0).fill("unanswerable question?");
  await item(page, 2).locator("input").nth(1).fill("unanswerable words");
  await page.getByRole("button", { name: /^Remove sub-question 4/ }).click();
  ok(await page.locator(".ls-item").count() === 3 && /about 9,000 AI tokens/.test(await page.locator(".ls-cost").innerText()), "removing a sub-question lowers the estimate");
  await page.getByRole("button", { name: "Add a sub-question" }).click();
  const start = page.getByRole("button", { name: "Start the scan" });
  ok(await start.isDisabled() && /needs its question and some search words/.test(await page.locator(".ls-why").innerText()), "a sub-question left empty stops the start, and says why");
  await item(page, 3).locator("input").nth(0).fill("How is exposure measured?");
  await item(page, 3).locator("input").nth(1).fill("exposure measurement methods");
  ok(await start.isEnabled(), "...which is lifted when it is filled in");
  await page.getByLabel("Write the answers in").selectOption("hinglish");
  await axe("plan, light", page);
  await setTheme(page, "dark");
  await axe("plan, dark", page);
  await setTheme(page, "light");
  await page.screenshot({ path: OUT + "plan.png" });

  console.log("the scan runs on the server");
  await item(page, 0).locator("input").nth(0).fill("snail how strong is the link?");
  await item(page, 0).locator("input").nth(1).fill("air pollution asthma");
  await start.click();
  await page.locator(".ls-progress").waitFor({ timeout: 20000 });
  ok(/scan=[0-9a-f-]{36}/.test(page.url()), "the address holds the scan, so a reload or a shared tab finds it");
  ok(await page.evaluate(() => document.activeElement?.className.includes("ls-topic")), "focus moves to the scan's heading, so a screen reader starts at the right place");
  ok(await page.getByRole("progressbar", { name: "Sub-questions finished" }).getAttribute("aria-valuemax") === "4", "a progress bar says how many sub-questions there are");
  ok(/Answers in Hinglish/.test(await page.locator(".ls-meta").innerText()) && /kept until/.test(await page.locator(".ls-meta").innerText()), "the page says which language it writes in and until when the scan is kept");
  ok(await page.getByRole("button", { name: "Stop the scan" }).isVisible() && /You can close this page/.test(await page.locator(".ls-scan").innerText()), "it can be stopped, and it says the page can be closed");
  ok(await page.locator(".ls-section").count() === 4, "every sub-question has its place from the start");
  await axe("running, light", page);
  await page.locator(".ls-count", { hasText: "4 of 4 sub-questions finished" }).waitFor({ timeout: 60000 }).catch(() => {});
  await page.locator(".eyebrow", { hasText: "Finished" }).waitFor({ timeout: 60000 });
  ok(/2 of 4 sub-questions answered, 2 without a written answer/.test(await page.locator(".ls-count").innerText()), "it ends saying how many were answered and how many were not (gaps are normal)");
  await sleep(300);

  console.log("the report");
  const sections = page.locator(".ls-section");
  ok(await sections.nth(0).locator(".cite-chip").count() >= 1 && await sections.nth(0).locator(".ask-status").isVisible(), "an answered sub-question has its text with source marks, and says that each claim is checked");
  ok(/No written answer/.test(await sections.nth(1).innerText()) && /No papers were found/.test(await sections.nth(1).innerText()), "a sub-question with no papers is a plain gap with its reason");
  ok((await sections.nth(1).locator('a[href^="/?q="]').getAttribute("href")) === "/?q=nothing%20words%20here", "...with a link that opens a search for its own words, so the person can look at the papers themselves");
  ok(/do not seem to answer this directly/.test(await sections.nth(2).innerText()), "a question the papers do not answer says so");
  ok(await sections.nth(3).locator(".cite-chip").count() >= 1, "the sub-question that was added by hand was answered too");
  const sources = page.locator(".ls-sources li");
  const nSources = await sources.count();
  ok(nSources >= 1 && await sources.first().locator("a[href^='https://doi.org/']").count() === 1, "one numbered list of sources, each a real record with its DOI");
  ok(nSources === new Set(await sources.locator(".chat-ev-t").allInnerTexts()).size, "a paper cited in two sections is listed once");
  await sections.nth(0).locator(".cite-chip").first().click();
  ok(await page.evaluate(() => /^ls-src-\d+$/.test(document.activeElement?.id ?? "")), "a source mark takes the reader to that source in the list");
  await sections.nth(0).locator("summary").click();
  ok(await sections.nth(0).locator(".chat-ev-q").first().isVisible(), "'The sentences behind it' shows the abstract's sentence the claim rests on");
  ok(!/made-up|hallucinate/i.test(await page.locator(".ls-scan").innerText()), "no sentence the check could not find is on the page");
  await axe("report, light", page);
  await setTheme(page, "dark");
  await axe("report, dark", page);
  await setTheme(page, "light");
  await page.screenshot({ path: OUT + "report.png", fullPage: true });
  ok(await noSideways(page), "no sideways scrolling at desktop width");

  console.log("coming back to it");
  const url = page.url();
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".eyebrow", { hasText: "Finished" }).waitFor({ timeout: 20000 });
  ok(await page.locator(".ls-section").count() === 4 && await page.locator(".ls-sources li").count() === nSources, "after a reload the same report is there (it is held on the server)");
  const second = await ctx.newPage();
  watch(second);
  await second.goto(BASE + "/literature-scan", { waitUntil: "networkidle" });
  await second.getByRole("heading", { name: "Your scans of the last day" }).waitFor({ timeout: 20000 });
  ok(/Finished · 4 of 4 sub-questions/.test(await second.locator(".ls-recent-item").first().innerText()), "in another tab, the list of the last day's scans shows it");
  await second.locator(".ls-recent-item").first().click();
  await second.locator(".eyebrow", { hasText: "Finished" }).waitFor();
  ok(second.url() === url, "opening it from the list gives the same address");
  await second.close();

  console.log("a file, and print");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download as Markdown" }).click()]);
  const text = readFileSync(await download.path(), "utf8");
  ok(/^literature-scan-air-pollution-and-childhood-asthma-\d{4}-\d{2}-\d{2}\.md$/.test(download.suggestedFilename()), "the file is named from the topic and the date");
  ok(text.startsWith("# Literature scan: air pollution and childhood asthma") && /Only abstracts were read/.test(text) && /\*Not answered\.\*/.test(text) && /## Sources/.test(text), "the file holds the report: the topic, what it is not, the gaps said plainly, the sources");

  console.log("stopping a scan");
  await page.getByRole("button", { name: "New scan" }).click();
  await page.getByLabel("What do you want to know about?").fill("tuberculosis vaccines in adults");
  await page.getByRole("button", { name: "Plan the scan" }).click();
  await page.locator(".ls-item").first().waitFor({ timeout: 20000 });
  for (const i of [0, 1, 2, 3]) {
    await item(page, i).locator("input").nth(0).fill(`snail question number ${i + 1}?`);
    await item(page, i).locator("input").nth(1).fill(`tuberculosis vaccine part ${i + 1}`);
  }
  await page.getByRole("button", { name: "Start the scan" }).click();
  await page.locator(".ls-progress").waitFor({ timeout: 20000 });
  await page.locator(".ls-wait", { hasText: /Searching|Reading/ }).first().waitFor({ timeout: 20000 });
  ok(await page.locator(".ls-wait", { hasText: /Searching|Reading/ }).count() >= 1, "while it runs each sub-question says where it is: searching or reading");
  await page.getByRole("button", { name: "Stop the scan" }).click();
  await page.locator(".eyebrow", { hasText: "Stopped" }).waitFor({ timeout: 20000 });
  ok(/before it was stopped/.test(await page.locator(".ls-count").innerText()) && await page.getByRole("button", { name: "Stop the scan" }).count() === 0, "stopping ends it and says so");
  await axe("stopped, light", page);

  console.log("deleting it");
  await page.getByRole("button", { name: "Delete this scan" }).click();
  const dialog = page.getByRole("dialog", { name: "Delete this scan?" });
  await dialog.waitFor();
  await sleep(800); // the dialog fades in: axe must not read a colour mid-fade
  await axe("delete dialog", page);
  await dialog.getByRole("button", { name: "Delete the scan" }).click();
  await page.getByLabel("What do you want to know about?").waitFor();
  ok(!page.url().includes("scan="), "the address goes back to the plain page");
  await page.getByRole("heading", { name: "Your scans of the last day" }).waitFor();
  ok(await page.locator(".ls-recent-item").count() === 1, "the deleted scan is gone from the list; the first one is still there");

  console.log("telling the person when it is done");
  // the browser's notification is stood in for: a permission that is granted when asked, a record of what was shown, and a page that can be put "in the background"
  await page.evaluate(() => {
    window.__notes = [];
    let perm = "default";
    window.Notification = class {
      static get permission() { return perm; }
      static async requestPermission() { perm = "granted"; return perm; }
      constructor(title, opts) { window.__notes.push({ title, body: opts?.body ?? "" }); this.close = () => {}; }
    };
    Object.defineProperty(document, "hidden", { get: () => !!window.__hidden, configurable: true });
  });
  await page.getByLabel("What do you want to know about?").fill("snail notification test topic");
  await page.getByRole("button", { name: "Plan the scan" }).click();
  await page.locator(".ls-item").first().waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: "Start the scan" }).click();
  await page.locator(".ls-progress").waitFor({ timeout: 20000 });
  const bell = page.getByRole("button", { name: "Notify me when it finishes" });
  ok(await bell.isVisible() && await bell.getAttribute("aria-pressed") === "false" && /not your topic/.test(await page.locator(".ls-scan").innerText()), "a running scan offers a notice when it finishes, and says that it carries no topic");
  await axe("running with the notice button, light", page);
  await bell.click();
  await page.getByRole("button", { name: "We will notify you when it finishes" }).waitFor();
  ok(await page.getByRole("button", { name: "We will notify you when it finishes" }).getAttribute("aria-pressed") === "true", "pressing it asks the browser's permission and turns the notice on");
  await page.evaluate(() => { window.__hidden = true; });
  await page.locator(".eyebrow", { hasText: "Finished" }).waitFor({ timeout: 60000 });
  await sleep(300);
  const notes = await page.evaluate(() => window.__notes);
  if (!(notes.length === 1)) console.log("        notes:", JSON.stringify(notes));
  ok(notes.length === 1 && notes[0].title === "Your literature scan has finished" && /^\d of 4 sub-questions answered\. Open Scholar AI to read it\.$/.test(notes[0].body), "when the scan ends and the page is in the background, one notice is shown, with counts");
  ok(!/snail|notification/i.test(notes[0].body + notes[0].title), "the notice does not carry the topic");
  await page.evaluate(() => { window.__hidden = false; });
  // a page that is opened again has the stand-in installed again (a fresh record), already in the background and with the notice already allowed
  await page.addInitScript(() => {
    window.__notes = [];
    window.__hidden = true;
    window.Notification = class {
      static get permission() { return "granted"; }
      static async requestPermission() { return "granted"; }
      constructor(title, opts) { window.__notes.push({ title, body: opts?.body ?? "" }); this.close = () => {}; }
    };
    Object.defineProperty(document, "hidden", { get: () => !!window.__hidden, configurable: true });
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".eyebrow", { hasText: "Finished" }).waitFor({ timeout: 20000 });
  await sleep(900);
  ok((await page.evaluate(() => window.__notes.length)) === 0, "opening a scan that had already finished shows no notice");
  await page.evaluate(() => { window.__hidden = false; });
  await page.evaluate(() => { window.__hidden = false; });

  console.log("sharing a read-only link");
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin });
  await page.getByRole("button", { name: "Share a link" }).click();
  const sd = page.getByRole("dialog", { name: "Share this scan with a link?" });
  await sd.waitFor();
  ok(/Anyone who has the link can read this scan until/.test(await sd.innerText()) && /does not show your name or e-mail/.test(await sd.innerText()), "before anything is made, the dialog says who can read it, until when, and that it carries no name");
  await sleep(800);
  await axe("share dialog, ask", page);
  await sd.getByRole("button", { name: "Create the link" }).click();
  await page.getByRole("dialog", { name: "This scan is shared" }).waitFor();
  const link = await page.getByLabel("The link").inputValue();
  ok(/\/literature-scan\/shared\/[A-Za-z0-9_-]{43}$/.test(link), "pressing Create makes a link with a long random token");
  await page.getByRole("button", { name: "Copy" }).click();
  await page.getByRole("button", { name: "Copied" }).waitFor({ timeout: 5000 }).catch(() => {});
  ok(await page.getByRole("button", { name: "Copied" }).isVisible() && (await page.evaluate(() => navigator.clipboard.readText())) === link, "Copy puts it on the clipboard and says so");
  await sleep(600);
  await axe("share dialog, link", page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Sharing is on" }).waitFor();
  ok(true, "the button now says that sharing is on");

  const visitor = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const vp = await visitor.newPage();
  watch(vp);
  await vp.goto(link, { waitUntil: "networkidle" });
  await vp.getByRole("heading", { name: "Shared literature scan", level: 1 }).waitFor({ timeout: 20000 });
  ok(/snail notification test topic/.test(await vp.locator(".ls-topic").first().innerText()), "someone who is not signed in can read it");
  ok(await vp.locator(".ls-section").count() === 4 && await vp.locator(".ls-sources li").count() >= 1, "with its sections and its one list of sources");
  ok(await vp.locator('meta[name="robots"]').getAttribute("content") === "noindex, nofollow", "the page tells search engines not to index it");
  ok(await vp.getByRole("button", { name: /Delete|Stop the scan|Share a link|Notify/ }).count() === 0, "it has no way to change anything");
  ok(!/@|Tara|example\.edu/.test(await vp.locator("main").innerText()), "nothing about who made it");
  const [vdl] = await Promise.all([vp.waitForEvent("download"), vp.getByRole("button", { name: "Download as Markdown" }).click()]);
  ok(/^literature-scan-snail-notification-test-topic-\d{4}-\d{2}-\d{2}\.md$/.test(vdl.suggestedFilename()), "the reader can download it as a file");
  await axe("shared page, light", vp);
  await vp.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await sleep(1300);
  await axe("shared page, dark", vp);
  await vp.screenshot({ path: OUT + "shared.png", fullPage: true });

  await page.getByRole("button", { name: "Sharing is on" }).click();
  const sd2 = page.getByRole("dialog", { name: "This scan is shared" });
  await sd2.getByRole("button", { name: "Stop sharing" }).click();
  await page.getByRole("dialog", { name: "Share this scan with a link?" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Share a link" }).waitFor();
  await vp.reload({ waitUntil: "networkidle" });
  await vp.getByRole("heading", { name: "This link does not work" }).waitFor({ timeout: 20000 });
  ok(true, "after Stop sharing the same link says that it does not work");
  await visitor.close();

  console.log("on a phone");
  const phone = await browser.newContext({ viewport: { width: 375, height: 760 }, deviceScaleFactor: 2, hasTouch: true });
  await flag(phone);
  await phone.addCookies(await ctx.cookies());
  const pp = await phone.newPage();
  watch(pp);
  await pp.goto(BASE + "/literature-scan", { waitUntil: "networkidle" });
  await pp.locator(".ls-recent-item").first().waitFor({ timeout: 20000 });
  await pp.locator(".ls-recent-item").first().click();
  await pp.locator(".eyebrow", { hasText: "Finished" }).waitFor({ timeout: 20000 });
  ok(await noSideways(pp), "the report fits a 375 px screen without scrolling sideways");
  await axe("report, phone", pp);
  await pp.screenshot({ path: OUT + "report-phone.png", fullPage: true });
  await phone.close();

  ok(errors.length === 0, `no console errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  idp.close?.();
}

console.log(failures === 0 ? "\nall literature scan browser checks passed" : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
