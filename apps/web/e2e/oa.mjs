// Browser e2e for "Ask this paper" (W4): a button on every search result opens a sheet where any paper is asked; the first time it is read for everyone (progress), the answer
// quotes the text (a section for XML, a page for a PDF), a paper that cannot be read is answered from its abstract and says so, signed-out visitors are asked to sign in.
// Needs the Worker with the fake identity provider and the offline stand-ins: `npm run integration -w apps/api -- --browser` starts it.
//   node e2e/oa.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { startFakeIdp } from "../../api/scripts/fake-idp.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.argv[2] ?? "http://localhost:8788";
const OUT = fileURLToPath(new URL("./shots/oa-", import.meta.url));
mkdirSync(fileURLToPath(new URL("./shots/", import.meta.url)), { recursive: true });
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "oa-ui-1", email: "meera.k@example.edu", email_verified: true, name: "Meera K" });
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
const setTheme = (p, t) => p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), t);
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

/** Chooses a tool in the mode menu of Home (a choice that is already made stays). */
async function pick(p, name) {
  if (new RegExp(name).test(await p.locator(".hm-mode").innerText())) return;
  await p.locator(".hm-mode").click();
  await p.getByRole("menuitemradio", { name: new RegExp("^" + name) }).click();
  await p.getByRole("menu", { name: "What should I do?" }).waitFor({ state: "hidden" });
}
async function searchOa(p) {
  await pick(p, "Search papers");
  await p.locator(".hm-input").fill("oapapers glaucoma");
  await p.keyboard.press("Enter");
  await p.locator(".chat-turn .result").nth(4).waitFor({ timeout: 20000 });
  await p.locator('.chat-turn[data-status="done"]').waitFor({ timeout: 30000 });
}
const askButton = (p, title) => p.getByRole("button", { name: new RegExp("^Ask this paper: " + title) });
const sheet = (p) => p.getByRole("dialog", { name: "Ask this paper" });
const ask = async (p, q) => {
  await sheet(p).getByLabel("Your question about this paper").fill(q);
  await p.keyboard.press("Enter");
};

try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await flag(ctx);
  const page = await ctx.newPage();
  watch(page);

  console.log("sign in and search");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
  await page.getByRole("button", { name: "Continue with Google" }).last().click();
  await page.locator("#hm-h").waitFor({ timeout: 20000 });
  await searchOa(page);
  ok(await page.getByRole("button", { name: /^Ask this paper:/ }).count() === 5, "every result with a DOI has an 'Ask this paper' button");
  await askButton(page, "A Retracted Paper").click();
  await sheet(page).waitFor();
  ok(/has been retracted/.test(await sheet(page).getByRole("alert").first().innerText()), "a retracted paper says so at the top of the sheet");
  await page.keyboard.press("Escape");
  await sheet(page).waitFor({ state: "detached" });

  console.log("a paper read from XML (new to the index)");
  await askButton(page, "Smartphone Retinal Imaging").click();
  await sheet(page).waitFor();
  ok(/Smartphone Retinal Imaging for Glaucoma Screening/.test(await sheet(page).locator(".oa-title").innerText()), "a sheet opens with the paper's title");
  ok(await sheet(page).getByRole("button", { name: "What is the main finding?" }).isVisible(), "with example questions");
  await ask(page, "How many adults were enrolled in the study?");
  await sheet(page).locator(".oa-answer").waitFor({ timeout: 30000 });
  const basis = await sheet(page).locator(".oa-basis").first().innerText();
  ok(/Full text from Europe PMC · CC BY/.test(basis), `it says what the answer is made from: "${basis.trim()}"`);
  const answer = sheet(page).locator(".oa-answer");
  ok(/Every quote checked against the paper/.test(await answer.innerText()) && await answer.locator(".cite-chip").count() >= 1, "it says the quotes were checked, and marks the claim with a source");
  ok(/§ Methods/.test(await answer.locator(".cite-chip").first().innerText()), "the mark names the section (an XML paper has no pages)");
  const src = await answer.locator(".oa-source").first().innerText();
  ok(/Methods > Participants/.test(src) && /We enrolled 240 adults/.test(src), "and the list of quotes gives the section and the exact words");
  await answer.locator(".cite-chip").first().click();
  await page.waitForFunction(() => document.querySelector(".oa-source")?.getAttribute("data-flash") !== null, null, { timeout: 3000 });
  ok(true, "pressing the mark shows its quote");
  await page.waitForTimeout(1900);
  await page.screenshot({ path: OUT + "1-answer.png" });
  await axe("ask sheet with an answer, light", page);
  await setTheme(page, "dark");
  await page.waitForTimeout(500);
  await axe("ask sheet with an answer, dark", page);
  await setTheme(page, "light");
  await page.keyboard.press("Escape");
  await sheet(page).waitFor({ state: "detached" });
  ok(await page.locator(":focus").evaluate((el) => el.tagName === "BUTTON"), "Escape closes it and the focus goes back to a button");

  console.log("a paper that is read for the first time shows how far it has got");
  await askButton(page, "A Slowly Read Paper").click();
  await ask(page, "What does this paper take a few seconds to do?");
  await sheet(page).locator(".oa-bar").waitFor({ timeout: 8000 });
  ok(await sheet(page).locator(".oa-bar").getAttribute("role") === "progressbar" && /Finding the paper|Reading the text|Waiting its turn|Getting it ready/.test(await sheet(page).locator(".oa-reading").innerText()), "a progress bar with words says it is reading the paper");
  ok(/up to a minute/.test(await sheet(page).locator(".oa-reading").innerText()) && /keeps going/.test(await sheet(page).locator(".oa-reading").innerText()), "and that it keeps going if the sheet is closed");
  await axe("ask sheet while reading", page);
  await sheet(page).locator(".oa-answer").waitFor({ timeout: 30000 });
  ok(await sheet(page).locator(".oa-reading").count() === 0, "when the reading ends the line goes and the answer comes");
  await page.keyboard.press("Escape");
  await sheet(page).waitFor({ state: "detached" });

  console.log("Stop, and asking again");
  await askButton(page, "Federated Learning").click();
  await ask(page, "How was the federated model trained across the hospitals?");
  await sheet(page).getByRole("button", { name: "Stop answering" }).waitFor({ timeout: 8000 });
  await sheet(page).getByRole("button", { name: "Stop answering" }).click();
  await sheet(page).getByText("Stopped.").waitFor({ timeout: 5000 });
  ok(await sheet(page).getByRole("button", { name: "Ask", exact: true }).isVisible(), "Stop ends the question, and the button is a button to ask again");
  await ask(page, "How was the federated model trained across the hospitals?");
  await sheet(page).locator(".oa-answer").waitFor({ timeout: 30000 });
  const pdfBasis = await sheet(page).locator(".oa-basis").last().innerText();
  ok(/Full text from a free PDF · CC BY/.test(pdfBasis), `a paper from a PDF says so (${pdfBasis.trim()})`);
  ok(/p\.\d/.test(await sheet(page).locator(".oa-answer .cite-chip").last().innerText()) && /^p\. \d/.test(await sheet(page).locator(".oa-answer .oa-source .ask-source-page").last().innerText()), "and its quotes are given by page");
  await page.keyboard.press("Escape");
  await sheet(page).waitFor({ state: "detached" });

  console.log("a paper that cannot be read: the abstract, and why");
  await askButton(page, "A Paper From A Big Publisher").click();
  await ask(page, "How many people did the programme reach?");
  await sheet(page).locator(".oa-answer").waitFor({ timeout: 30000 });
  const abs = sheet(page).locator(".oa-basis[data-kind=abstract]");
  ok(/Based on the abstract only/.test(await abs.innerText()) && /does not let a program download/.test(await abs.innerText()), "it says it used the abstract only, and why in plain words");
  ok(await abs.getByRole("button", { name: /Open My Workspace/ }).isVisible(), "and offers to upload the PDF to My Workspace");
  ok(/Abstract/.test(await sheet(page).locator(".oa-source .ask-source-page").first().innerText()), "the quote names the abstract as its place");
  await page.screenshot({ path: OUT + "2-abstract-only.png" });
  await axe("ask sheet, abstract only", page);
  await abs.getByRole("button", { name: /Open My Workspace/ }).click();
  await page.waitForFunction(() => location.pathname === "/papers", null, { timeout: 8000 });
  await sheet(page).waitFor({ state: "detached", timeout: 5000 });
  ok(true, "that closes the sheet and opens My Workspace");
  await page.goBack();
  await page.locator("#hm-h").waitFor();

  console.log("from the preview, and on a phone");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.getByRole("button", { name: /^Preview: Smartphone Retinal/ }).click();
  await page.getByRole("button", { name: "Ask this paper", exact: true }).click();
  await sheet(page).waitFor();
  ok(/Smartphone Retinal Imaging/.test(await sheet(page).locator(".oa-title").innerText()) && await sheet(page).locator(".oa-answer").count() >= 1, "the Ask button of the preview opens the same sheet, with the earlier answer still there");
  await page.waitForTimeout(800); // the sheet slides in and its answer fades in: measure and check the colours when they have settled
  const box = await sheet(page).boundingBox();
  ok(box.width <= 390 && await noSideways(page), "it fits a phone, with no sideways scroll");
  await page.screenshot({ path: OUT + "3-phone.png" });
  await axe("ask sheet, phone", page);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1360, height: 900 });

  console.log("without signing in");
  const anon = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  await flag(anon);
  const ap = await anon.newPage();
  watch(ap);
  await ap.goto(BASE + "/home", { waitUntil: "networkidle" });
  await ap.locator("#hm-h").waitFor({ timeout: 20000 });
  await searchOa(ap);
  await askButton(ap, "Smartphone Retinal").click();
  await sheet(ap).waitFor();
  ok(await sheet(ap).getByText("Sign in to ask this paper.").isVisible() && await sheet(ap).getByRole("button", { name: /Sign in/ }).isVisible() && await sheet(ap).getByLabel("Your question about this paper").count() === 0, "a visitor is asked to sign in, and has no question box");
  await axe("ask sheet, signed out", ap);
  await anon.close();

  console.log("signing out clears it");
  await page.locator(".ws-rail").getByRole("link", { name: "Settings" }).click();
  await page.locator(".ws-rail").getByRole("button", { name: "Sign out" }).click();
  await page.locator(".ws-anon").waitFor({ timeout: 20000 });
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  await page.locator("#hm-h").waitFor({ timeout: 20000 });
  await searchOa(page);
  await askButton(page, "Smartphone Retinal").click();
  ok(await sheet(page).locator(".oa-answer").count() === 0, "after signing out the earlier answers are gone");

  ok(errors.length === 0, `no console or page errors${errors.length ? ": " + errors.slice(0, 4).join(" | ") : ""}`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
} finally {
  await browser.close();
  idp.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall open-access browser checks passed");
  process.exit(failures ? 1 : 0);
}
