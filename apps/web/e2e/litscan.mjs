// Browser e2e for the literature scan: a topic, the themes the person approves (and may edit) before anything is searched, Indian sources as a choice, the scan running on the server
// (a board of themes, stop), the review (at a glance, findings by theme with marks that open their source, the evidence table with filters, the gaps, APA references), coming back
// to it after a reload, the files (Markdown, CSV, BibTeX, RIS), deleting it, the notice, a shared link. Light, dark and phone width, with axe.
// Needs the Worker with the fake identity provider and the offline stand-ins: `npm run integration -w apps/api -- --browser` starts it.
//   node e2e/litscan.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { strFromU8, unzipSync } from "fflate";
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
const theme = (p, i) => p.locator(".ls-theme").nth(i);
/** Opens theme i (from 0) for editing, fills what is given, and closes it again. */
async function editTheme(p, i, { name, question, words }) {
  await p.getByRole("button", { name: new RegExp(`^Edit theme ${i + 1}:`) }).click();
  const card = theme(p, i);
  if (name !== undefined) await card.getByLabel("Name").fill(name);
  if (question !== undefined) await card.getByLabel("Answered as the question").fill(question);
  if (words !== undefined) await card.getByLabel(/^Search words/).fill(words);
  await card.getByRole("button", { name: "Done" }).click();
}
const startBtn = (p) => p.getByRole("button", { name: /^Start the review/ });
const tab = (p, name) => p.getByRole("tab", { name: new RegExp(`^${name}`) });
async function grab(p, label) {
  await p.getByRole("button", { name: "Download", exact: true }).click();
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("menuitem", { name: new RegExp(`^${label}`) }).click()]);
  const path = await dl.path();
  return { name: dl.suggestedFilename(), text: readFileSync(path, "utf8"), bytes: readFileSync(path) };
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  watch(page);

  console.log("signed out");
  await page.goto(BASE + "/literature-scan", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Literature scan", level: 1 }).waitFor();
  ok(await page.getByRole("heading", { name: "Sign in to scan the literature" }).isVisible(), "a visitor is asked to sign in (the scan runs on an account)");
  ok(await page.title() === "Literature scan · Sodhsetu", "the page has its own title");
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

  console.log("the plan: themes to glance at, change and approve");
  await page.getByLabel("Write the answers in").selectOption("auto");
  await plan.click();
  await page.getByRole("heading", { name: "air pollution and childhood asthma", level: 2 }).waitFor({ timeout: 20000 });
  ok(await page.locator(".ls-theme").count() === 4, "the topic becomes four themes");
  ok((await page.locator(".ls-theme-t").allInnerTexts()).join("|") === "Strength of the evidence|Factors that matter|How it is measured|Interventions tried", "each theme has a short name, like a heading of a review");
  ok(await theme(page, 0).locator(".ls-words-v").innerText() === "air pollution and evidence" && /How strong is the evidence/.test(await theme(page, 0).locator(".ls-theme-q").innerText()), "...and shows the question it is answered as and the English words that are searched");
  ok(await page.locator(".ls-theme input").count() === 0, "nothing has to be filled in: the themes are cards, not a form");
  ok(/Only each theme's search words/.test(await page.locator(".ls-sendnote").innerText()), "it says that only the search words reach the public indexes, not the topic");
  ok(/about 22,000 AI tokens/.test(await page.locator(".ls-cost").innerText()) && /60,000/.test(await page.locator(".ls-cost").innerText()), "it says what the review is expected to use of the day's allowance");
  ok(await page.getByLabel("Write the review in").inputValue() === "en", "the language is chosen from the topic (English here)");
  ok(await page.getByRole("button", { name: "Indian sources only" }).getAttribute("aria-pressed") === "false", "Indian sources is a choice, off unless the person turned it on in the prompt box");
  await editTheme(page, 1, { question: "nothing found for this one?", words: "nothing words here" });
  await editTheme(page, 2, { question: "unanswerable question?", words: "unanswerable words" });
  await page.getByRole("button", { name: /^Remove theme 4:/ }).click();
  ok(await page.locator(".ls-theme").count() === 3 && /about 16,500 AI tokens/.test(await page.locator(".ls-cost").innerText()), "removing a theme lowers the estimate");
  await page.getByRole("button", { name: "Add a theme" }).click();
  ok(await startBtn(page).isDisabled() && /Every theme needs a name, a question and some search words/.test(await page.locator(".ls-why").innerText()), "a new theme left empty stops the start, and says why");
  const fresh = theme(page, 3);
  await fresh.getByLabel("Name").fill("Measuring exposure");
  await fresh.getByLabel("Answered as the question").fill("How is exposure measured?");
  await fresh.getByLabel(/^Search words/).fill("exposure measurement methods");
  ok(await startBtn(page).isDisabled() && /Finish editing/.test(await page.locator(".ls-why").innerText()), "an open theme must be closed (Done) before the start");
  await fresh.getByRole("button", { name: "Done" }).click();
  ok(await startBtn(page).isEnabled() && /4 themes/.test(await startBtn(page).innerText()), "...and then it can start, saying how many themes");
  await page.getByLabel("Write the review in").selectOption("hinglish");
  await axe("plan, light", page);
  await setTheme(page, "dark");
  await axe("plan, dark", page);
  await setTheme(page, "light");
  await page.screenshot({ path: OUT + "plan.png", fullPage: true });

  console.log("the scan runs on the server");
  await editTheme(page, 0, { question: "snail how strong is the link?", words: "air pollution asthma" });
  await startBtn(page).click();
  await page.locator(".ls-progress").waitFor({ timeout: 20000 });
  ok(/scan=[0-9a-f-]{36}/.test(page.url()), "the address holds the scan, so a reload or a shared tab finds it");
  ok(await page.evaluate(() => document.activeElement?.className.includes("ls-topic")), "focus moves to the scan's heading, so a screen reader starts at the right place");
  ok(await page.getByRole("progressbar", { name: "Themes finished" }).getAttribute("aria-valuemax") === "4", "a progress bar says how many themes there are");
  ok(/Written in Hinglish/.test(await page.locator(".ls-meta").innerText()) && /kept until/.test(await page.locator(".ls-meta").innerText()), "the page says which language it writes in and until when the scan is kept");
  ok(await page.getByRole("button", { name: "Stop the scan" }).isVisible() && /You can close this page/.test(await page.locator(".ls-scan").innerText()), "it can be stopped, and it says the page can be closed");
  ok(await page.locator(".ls-tile").count() === 4, "a board shows every theme from the start");
  await axe("running, light", page);
  await page.locator(".eyebrow", { hasText: "Finished" }).waitFor({ timeout: 60000 });
  ok(/2 of 4 themes answered, 2 without a written answer/.test(await page.locator(".ls-count").innerText()), "it ends saying how many were answered and how many were not (gaps are normal)");
  await sleep(300);

  console.log("the review");
  const stats = await page.locator(".ls-stat").allInnerTexts();
  ok(/2\s*\/4\s*themes answered/.test(stats[0] ?? "") && /papers? cited/.test(stats[1] ?? ""), "at a glance: themes answered, papers cited, years, study designs");
  ok((await page.getByRole("tab").allInnerTexts()).map((x) => x.replace(/\s*\d+$/, "")).join("|") === "Summary|Evidence table|Gaps|References", "four tabs: summary, evidence table, gaps, references");
  const sections = page.locator(".ls-panel:not([hidden]) .ls-section");
  ok(await sections.count() === 2 && (await sections.locator(".ls-section-h").allInnerTexts()).join("|") === "snail how strong is the link?|Measuring exposure".replace("snail how strong is the link?", "Strength of the evidence"), "the summary has one section an answered theme, under the theme's name");
  ok(await sections.nth(0).locator(".cite-chip").count() >= 1 && /each claim points at a sentence/.test(await sections.nth(0).locator(".ls-section-m").innerText()), "...its text with source marks, and the count of papers behind it");
  const chip = sections.nth(0).locator(".cite-chip").first();
  await chip.click();
  const peek = sections.nth(0).locator(".ls-peek");
  ok(await peek.isVisible() && await chip.getAttribute("aria-expanded") === "true" && /\(20\d\d\)\./.test(await peek.locator(".ls-peek-ref").innerText()) && await peek.locator("a[href^='https://doi.org/']").count() === 1, "a mark opens its paper right there: the APA reference, the sentence, the link");
  await peek.getByRole("button", { name: "Close the source" }).click();
  ok(await peek.isHidden(), "...and closes again");
  await sections.nth(0).locator("summary").click();
  ok(await sections.nth(0).locator(".chat-ev-q").first().isVisible(), "'The sentences behind it' shows the abstract's sentence the claim rests on");
  ok(!/made-up|hallucinate/i.test(await page.locator(".ls-scan").innerText()), "no sentence the check could not find is on the page");
  await axe("review summary, light", page);

  await tab(page, "Evidence table").click();
  const rows = page.locator(".ls-table tbody tr");
  const nRows = await rows.count();
  ok(nRows >= 1 && await rows.first().locator("td").count() === 5, "the evidence table has one row a paper: number, study, design, key finding, theme");
  ok(await rows.first().locator(".ls-finding").count() >= 1 && /“/.test(await rows.first().locator(".ls-finding").first().innerText()), "...the key finding is the abstract's own sentence, in quotes");
  ok(nRows === new Set(await page.locator(".ls-study-t").allInnerTexts()).size, "a paper cited for two themes is one row");
  await page.locator(".ls-filters").getByLabel("Theme", { exact: true }).selectOption("Measuring exposure");
  ok(await rows.count() >= 1 && (await page.locator(".ls-table tbody td[data-label='Theme']").allInnerTexts()).every((x) => x.includes("Measuring exposure")), "filtering by theme keeps only that theme's papers");
  await page.locator(".ls-filters").getByLabel("Theme", { exact: true }).selectOption("all");
  await page.locator(".ls-filters").getByLabel("Order", { exact: true }).selectOption("new");
  ok(await rows.count() === nRows, "sorting keeps every paper");
  await axe("evidence table, light", page);
  await setTheme(page, "dark");
  await axe("evidence table, dark", page);
  await setTheme(page, "light");
  await page.screenshot({ path: OUT + "table.png", fullPage: true });

  await tab(page, "Gaps").click();
  const gaps = page.locator(".ls-gapcard");
  ok(await gaps.count() === 2 && /No papers were found for this theme/.test(await gaps.nth(0).innerText()) && /do not seem to answer this directly/.test(await gaps.nth(1).innerText()), "the gaps say plainly why each theme has no answer");
  ok((await gaps.nth(0).locator('a[href^="/?q="]').getAttribute("href")) === "/?q=nothing%20words%20here", "...with a link that opens a search for its own words");
  await tab(page, "References").click();
  const refs = page.locator(".ls-sources li");
  ok(await refs.count() === nRows && /\(20\d\d\)\./.test(await refs.first().innerText()) && /https:\/\/doi\.org\//.test(await refs.first().innerText()), "the references: one a paper, in APA style with the DOI");
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin });
  await page.getByRole("button", { name: "Copy all (APA)" }).click();
  await page.getByRole("button", { name: "Copied" }).waitFor({ timeout: 5000 }).catch(() => {});
  ok(/^1\. .+\(20\d\d\)\./.test(await page.evaluate(() => navigator.clipboard.readText())), "Copy all puts the numbered APA list on the clipboard");
  await axe("references, light", page);
  await tab(page, "Summary").click();
  ok(await noSideways(page), "no sideways scrolling at desktop width");

  console.log("coming back to it");
  const url = page.url();
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".eyebrow", { hasText: "Finished" }).waitFor({ timeout: 20000 });
  ok(await page.locator(".ls-panel:not([hidden]) .ls-section").count() === 2 && await page.locator(".ls-sources li").count() === nRows, "after a reload the same review is there (it is held on the server)");
  const second = await ctx.newPage();
  watch(second);
  await second.goto(BASE + "/literature-scan", { waitUntil: "networkidle" });
  await second.getByRole("heading", { name: "Your scans of the last day" }).waitFor({ timeout: 20000 });
  ok(/Finished · 4 of 4 themes/.test(await second.locator(".ls-recent-item").first().innerText()), "in another tab, the list of the last day's scans shows it");
  await second.locator(".ls-recent-item").first().click();
  await second.locator(".eyebrow", { hasText: "Finished" }).waitFor();
  ok(second.url() === url, "opening it from the list gives the same address");
  await second.close();

  console.log("files to take away");
  const md = await grab(page, "Review \\(Markdown\\)");
  ok(/^literature-review-air-pollution-and-childhood-asthma-\d{4}-\d{2}-\d{2}\.md$/.test(md.name), "the review file is named from the topic and the date");
  ok(md.text.startsWith("# Literature review: air pollution and childhood asthma") && /## At a glance/.test(md.text) && /## Findings by theme/.test(md.text) && /## Evidence table/.test(md.text) && /## Gaps/.test(md.text) && /## References/.test(md.text) && /Only abstracts were read/.test(md.text), "it holds the whole review: glance, findings, table, gaps, references, and what it is not");
  const word = await grab(page, "Review \\(Word\\)");
  ok(/^literature-review-air-pollution-and-childhood-asthma-\d{4}-\d{2}-\d{2}\.docx$/.test(word.name), "the Word file is named from the topic and the date");
  const zip = unzipSync(new Uint8Array(word.bytes));
  const docXml = strFromU8(zip["word/document.xml"]);
  const wText = [...docXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(" ");
  ok(word.bytes.subarray(0, 2).toString() === "PK" && ["[Content_Types].xml", "word/document.xml", "word/styles.xml", "word/_rels/document.xml.rels", "docProps/core.xml"].every((k) => k in zip), "the Word file is a zip with the parts Word needs");
  ok(/Literature review: air pollution and childhood asthma/.test(wText) && /At a glance/.test(wText) && /Findings by theme/.test(wText) && /Evidence table/.test(wText) && /References/.test(wText) && /Only abstracts were read/.test(wText), "it holds the whole review: the glance, the findings, the evidence table and the references");
  ok((docXml.match(/<w:tbl>/g) ?? []).length === 1 && (docXml.match(/<w:tr>/g) ?? []).length === nRows + 1 && /<w:tblHeader\/>/.test(docXml), "the evidence table is a real Word table, a row for each paper under a header that repeats");
  ok((docXml.match(/<w:bookmarkStart /g) ?? []).length === nRows && /w:anchor="bref1"/.test(docXml) && /doi\.org/.test(strFromU8(zip["word/_rels/document.xml.rels"])), "each mark jumps to its reference, and the DOIs are links");
  const csv = await grab(page, "Evidence table \\(CSV\\)");
  ok(csv.name.endsWith(".csv") && csv.text.replace(/^\uFEFF/, "").startsWith('"No.","Authors","Year","Title"') && csv.text.split("\r\n").filter(Boolean).length === nRows + 1, "the evidence table as a CSV for Excel: a header and one row a paper");
  const bib = await grab(page, "References \\(BibTeX\\)");
  ok(bib.name.endsWith(".bib") && (bib.text.match(/@article\{/g) ?? []).length === nRows, "the references as BibTeX, one entry a paper");
  const ris = await grab(page, "References \\(RIS\\)");
  ok(ris.name.endsWith(".ris") && (ris.text.match(/^TY  - JOUR/gm) ?? []).length === nRows, "...and as RIS for Zotero, Mendeley or EndNote");
  await page.screenshot({ path: OUT + "report.png", fullPage: true });

  console.log("stopping a scan");
  await page.getByRole("button", { name: "New scan" }).click();
  await page.getByLabel("What do you want to know about?").fill("tuberculosis vaccines in adults");
  await page.getByRole("button", { name: "Plan the scan" }).click();
  await page.locator(".ls-theme").first().waitFor({ timeout: 20000 });
  for (const i of [0, 1, 2, 3]) await editTheme(page, i, { question: `snail question number ${i + 1}?`, words: `tuberculosis vaccine part ${i + 1}` });
  await page.getByRole("button", { name: "Indian sources only" }).click();
  ok(await page.getByRole("button", { name: "Indian sources only" }).getAttribute("aria-pressed") === "true" && /journals published in India/.test(await page.locator(".ls-options").innerText()) && /OpenAlex and DOAJ/.test(await page.locator(".ls-sendnote").innerText()), "Indian sources can be turned on for a review, and the page says where the words then go");
  await startBtn(page).click();
  await page.locator(".ls-progress").waitFor({ timeout: 20000 });
  ok(/Indian sources only/.test(await page.locator(".ls-meta").innerText()), "the scan says it searches only Indian sources");
  await page.locator(".ls-tile[data-state='busy']").first().waitFor({ timeout: 20000 });
  ok(/Searching|Reading/.test(await page.locator(".ls-tile[data-state='busy']").first().innerText()), "while it runs each theme's tile says where it is: searching or reading");
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
  await page.locator(".ls-theme").first().waitFor({ timeout: 20000 });
  await startBtn(page).click();
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
  ok(notes.length === 1 && notes[0].title === "Your literature scan has finished" && /^\d of 4 themes answered\. Open Sodhsetu to read it\.$/.test(notes[0].body), "when the scan ends and the page is in the background, one notice is shown, with counts");
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
  ok(/Anyone who has the link can read this review until/.test(await sd.innerText()) && /does not show your name or e-mail/.test(await sd.innerText()), "before anything is made, the dialog says who can read it, until when, and that it carries no name");
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
  ok(await vp.getByRole("tab").count() === 4 && await vp.locator(".ls-stat").count() >= 3, "with the same review: at a glance and the four tabs");
  ok(await vp.locator('meta[name="robots"]').getAttribute("content") === "noindex, nofollow", "the page tells search engines not to index it");
  ok(await vp.getByRole("button", { name: /Delete|Stop the scan|Share a link|Notify/ }).count() === 0, "it has no way to change anything");
  ok(!/@|Tara|example\.edu/.test(await vp.locator("main").innerText()), "nothing about who made it");
  const vdl = await grab(vp, "Review \\(Markdown\\)");
  ok(/^literature-review-snail-notification-test-topic-\d{4}-\d{2}-\d{2}\.md$/.test(vdl.name), "the reader can download it as a file");
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
  await phone.addCookies(await ctx.cookies());
  const pp = await phone.newPage();
  watch(pp);
  await pp.goto(BASE + "/literature-scan", { waitUntil: "networkidle" });
  await pp.locator(".ls-recent-item").first().waitFor({ timeout: 20000 });
  await pp.locator(".ls-recent-item").first().click();
  await pp.locator(".eyebrow", { hasText: "Finished" }).waitFor({ timeout: 20000 });
  ok(await noSideways(pp), "the review fits a 375 px screen without scrolling sideways");
  await axe("review, phone", pp);
  await pp.getByRole("tab", { name: /^Evidence table/ }).click();
  ok(await noSideways(pp) && await pp.locator(".ls-table thead").evaluate((el) => el.getBoundingClientRect().width <= 1), "on a phone the evidence table becomes one card a paper (no sideways scroll)");
  await axe("evidence table, phone", pp);
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
