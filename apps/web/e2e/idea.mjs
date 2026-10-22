// Browser e2e: Idea Check. Sign-in gate, reading an idea from each file type, the search plan the researcher approves (and what is sent),
// the closest papers with how they were found, and what was searched.
// Needs the Worker with the fake identity provider AND the offline stand-ins (QA_STUB=1): `npm run integration -w apps/api -- --browser`.
//   node e2e/idea.mjs [baseUrl]    (default http://localhost:8788)
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import { startFakeIdp } from "../../api/scripts/fake-idp.mjs";
import { SAMPLE_PAPER, makePdf } from "../../api/scripts/lib/make-pdf.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.argv[2] ?? "http://localhost:8788";
const OUT = fileURLToPath(new URL("./shots/", import.meta.url));
mkdirSync(OUT, { recursive: true });

let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "idea-ui-1", email: "meera@example.edu", email_verified: true, name: "Meera Nair" });

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401)/.test(m.text())) errors.push("console: " + m.text()); });

async function axe(label, p = page) {
  await p.evaluate(axeSource);
  const res = await p.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(" "), msg: v.nodes[0]?.failureSummary?.split("\n")[1] }));
  });
  ok(res.length === 0, `axe [${label}]: ${res.length ? "" : "no violations"}`);
  for (const v of res) console.log(`        ${v.impact} ${v.id} x${v.nodes} ${v.sample} :: ${v.msg}`);
}
const shot = (name) => page.screenshot({ path: OUT + name + ".png" });
const setTheme = async (label) => { await page.getByRole("button", { name: `${label} theme` }).click(); await page.waitForTimeout(500); };
const textbox = () => page.getByRole("textbox", { name: "Your idea" });
const openFile = async (name, mimeType, buffer) => page.locator('input[type="file"]').setInputFiles({ name, mimeType, buffer: Buffer.from(buffer) });

const IDEA = "UNIQUEMARKER We want to detect fraudulent invoices in small cooperative banks using graph neural networks on transaction networks, and test the approach against public benchmark data.";

try {
  /* ---------- signed out ---------- */
  console.log("idea check, signed out");
  await page.goto(BASE + "/idea", { waitUntil: "networkidle" });
  await page.getByRole("heading", { level: 2, name: "Sign in to check an idea" }).waitFor();
  ok(/Idea Check/.test(await page.title()), "the page has its own title");
  ok((await page.getByRole("link", { name: "Idea Check" }).getAttribute("aria-current")) === "page", "the navigation marks Idea Check as the current page");
  await page.waitForTimeout(1500);
  await axe("idea, signed out");

  /* ---------- sign in ---------- */
  await page.getByRole("button", { name: "Continue with Google" }).click();
  await page.getByRole("button", { name: /^Account:/ }).waitFor({ timeout: 15000 });
  ok(new URL(page.url()).pathname === "/idea", "sign-in returns to Idea Check");
  await textbox().waitFor();
  await page.waitForTimeout(1200);
  await shot("70-idea-input");
  await axe("idea, input");
  await setTheme("Dark"); await shot("71-idea-input-dark"); await axe("idea, input, dark"); await setTheme("Light");

  /* ---------- the home page leads here ---------- */
  console.log("start cards");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /Check an idea/ }).click();
  await textbox().waitFor();
  ok(new URL(page.url()).pathname === "/idea", "the home page has a card that opens Idea Check");

  /* ---------- the button waits for enough text ---------- */
  console.log("input");
  const next = page.getByRole("button", { name: /Prepare the search/ });
  ok(await next.isDisabled(), "the button is off until there is enough to work with");

  console.log("privacy note");
  const note = page.getByRole("region", { name: /how your ideas are handled/ });
  await note.waitFor();
  await textbox().fill("Graph neural networks to detect fraudulent invoices in small cooperative banks, tested on public data.");
  ok(await next.isDisabled(), "with the note unread, a long enough idea still cannot be sent");
  await page.waitForTimeout(700);
  await shot("78-idea-privacy-note");
  await axe("idea, privacy note");
  await note.getByRole("button", { name: "I understand, continue" }).click();
  await note.waitFor({ state: "detached", timeout: 8000 });
  await page.waitForFunction(() => !document.querySelector("form.idea-in button[type=submit]")?.disabled, null, { timeout: 8000 });
  ok(true, "after agreeing, the idea can be sent");
  await textbox().fill("");
  await textbox().fill("too short");
  ok(await next.isDisabled(), "...still off for a few words");

  /* ---------- reading files ---------- */
  console.log("files");
  await openFile("notes.md", "text/markdown", "# Notes\n\nGraph neural networks for fraud detection in cooperative banks, tested on public data.");
  await page.waitForFunction(() => document.querySelector("textarea")?.value.includes("Graph neural networks"));
  ok(/notes\.md/.test(await page.locator(".idea-file").innerText()), "a Markdown file is read and named");

  await openFile("paper.tex", "application/x-tex", String.raw`\documentclass{article}\title{Fraud in Banks}\begin{document}\begin{abstract}We study fraud with graph networks \cite{x}.\end{abstract}\section{Method}Edges are payments. % hidden comment
\end{document}`);
  await page.waitForFunction(() => document.querySelector("textarea")?.value.includes("We study fraud with graph networks"));
  const tex = await textbox().inputValue();
  ok(!/documentclass|cite|hidden comment/.test(tex) && /Fraud in Banks/.test(tex), "LaTeX is turned into readable text (preamble, citations and comments dropped)");

  const docx = zipSync({ "word/document.xml": strToU8('<w:document><w:body><w:p><w:r><w:t>Fraud detection with graph networks</w:t></w:r></w:p><w:p><w:r><w:t>We test on public benchmark data from several banks.</w:t></w:r></w:p></w:body></w:document>') });
  await openFile("idea.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx);
  await page.waitForFunction(() => document.querySelector("textarea")?.value.includes("public benchmark data from several banks"));
  ok(/idea\.docx/.test(await page.locator(".idea-file").innerText()), "a Word .docx file is read");

  await openFile("paper.pdf", "application/pdf", makePdf(SAMPLE_PAPER));
  await page.waitForFunction(() => /\S{3,}/.test(document.querySelector("textarea")?.value ?? "") && !document.querySelector("textarea")?.value.includes("public benchmark data"), null, { timeout: 20000 });
  ok(/paper\.pdf/.test(await page.locator(".idea-file").innerText()), "a PDF is read in the browser");

  await openFile("old.doc", "application/msword", "binary");
  await page.getByRole("alert").filter({ hasText: "not a format we can read" }).waitFor({ timeout: 5000 });
  ok(true, "a format we cannot read is refused with the list of ones we can");
  await page.getByRole("button", { name: "Dismiss" }).click();

  await openFile("empty.docx", "application/octet-stream", "not a zip at all");
  await page.getByRole("alert").filter({ hasText: /could not be opened as a Word/ }).waitFor({ timeout: 5000 });
  ok(true, "a broken .docx gives a clear message instead of failing silently");
  await page.getByRole("button", { name: "Dismiss" }).click();

  /* ---------- plan ---------- */
  console.log("plan");
  await textbox().fill(IDEA);
  await page.getByRole("textbox", { name: /Your question/ }).fill("Has this been done with low-cost hardware?");
  await next.click();
  await page.getByRole("heading", { level: 2, name: /This is all that will be sent/ }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(900);
  ok((await page.locator(".idea-steps li[data-state='now']").innerText()).includes("Search plan"), "the step indicator moves to the search plan");
  ok(await page.getByText("What we understood").isVisible(), "what the AI understood is shown first");
  ok((await page.locator(".plan-kw input").count()) >= 2, "keyword searches are listed as editable fields");
  const sem = page.getByRole("textbox", { name: /Description, searched by meaning/ });
  ok((await sem.inputValue()).length > 30, "the description that will be searched by meaning is shown in full");
  await shot("72-idea-plan");
  await axe("idea, plan");
  await setTheme("Dark"); await shot("73-idea-plan-dark"); await axe("idea, plan, dark"); await setTheme("Light");

  // edit the plan: remove one keyword search, add one
  const before = await page.locator(".plan-kw input").count();
  await page.getByRole("button", { name: /^Remove keyword search/ }).first().click();
  await page.waitForFunction((n) => document.querySelectorAll(".plan-kw input").length === n, before - 1);
  await page.getByRole("textbox", { name: "Add a keyword search" }).fill("cooperative bank fraud");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  ok((await page.locator(".plan-kw input").last().inputValue()) === "cooperative bank fraud", "a keyword search can be added and one removed");

  /* ---------- search: what is sent is the plan, never the idea ---------- */
  console.log("search");
  let sent = null;
  page.on("request", (r) => { if (r.url().endsWith("/api/v1/idea/search")) sent = r.postData(); });
  const wanted = { semanticQuery: await sem.inputValue(), keywordQueries: await page.locator(".plan-kw input").evaluateAll((els) => els.map((e) => e.value)) };
  await page.getByRole("button", { name: "Search the literature" }).click();
  await page.locator(".result").first().waitFor({ timeout: 15000 });
  await page.getByRole("heading", { level: 2, name: /papers closest to your idea/ }).waitFor();
  await page.waitForTimeout(900);
  ok(sent !== null && JSON.stringify(JSON.parse(sent)) === JSON.stringify(wanted), "exactly the approved plan is what is sent to search");
  ok(!/UNIQUEMARKER/.test(sent ?? ""), "...and the idea text is not in it");
  ok((await page.locator(".result").count()) === 3, "the closest papers are listed");
  ok((await page.locator(".result").first().locator(".idea-found").innerText()).includes("OpenAlex (meaning)"), "each paper says which searches found it");
  ok(await page.getByText(/does not mean it does not exist/).isVisible(), "the page says that not finding a paper is not proof it does not exist");
  await page.locator(".idea-cover-list summary").click();
  ok((await page.locator(".idea-cover-list li").count()) >= 3, "every search that was run can be listed");
  ok(await page.locator(".result").first().getByRole("button", { name: /^Preview:/ }).isVisible(), "each paper has a preview");
  await page.locator(".result").first().getByRole("button", { name: /^Preview:/ }).click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(600);
  ok(/Closest prior work/.test(await page.getByRole("dialog").locator(".pv-title").innerText()), "the preview opens on the paper");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await shot("74-idea-results");
  await axe("idea, results");
  await setTheme("Dark"); await shot("75-idea-results-dark"); await axe("idea, results, dark"); await setTheme("Light");

  // compare with the idea (M2)
  console.log("compare");
  await page.getByRole("button", { name: "Compare with my idea" }).click();
  await page.getByRole("heading", { level: 2, name: /closest papers cover/ }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(900);
  ok((await page.locator(".cmp-row").count()) === 4, "the coverage map has one row for each part of the idea");
  ok((await page.locator(".cmp-row").first().innerText()).includes("Same"), "a row shows which paper covers the part, and how");
  ok((await page.locator(".cmp-quote").count()) >= 2, "each match shows the sentence it comes from");
  ok(await page.getByText(/not in the abstract/).isVisible(), "a claim whose sentence is not in the abstract is reported as dropped, not shown as a match");
  ok((await page.locator(".cmp-strip").count()) === 3, "every paper card says how it relates to the idea");
  ok(/Closely related|Partly related|Slightly related/.test(await page.locator(".cmp-strip").first().innerText()), "...in words, not as a score");
  ok(!/novel|new idea|% /i.test(await page.locator(".cmp-map").innerText()), "nothing in the map claims the idea is new or gives a percentage");
  await shot("79-idea-compare");
  await axe("idea, compared");
  await setTheme("Dark"); await shot("79b-idea-compare-dark"); await axe("idea, compared, dark"); await setTheme("Light");

  // filters
  await page.getByRole("button", { name: "Open access only" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".result").length === 1);
  ok(true, "the open-access filter narrows the list");
  await page.getByRole("button", { name: "Open access only" }).click();

  // a dataset or software deposit is hidden by default, can be shown, is labelled, and is never sent to the comparison
  const dataChip = page.getByRole("button", { name: /^Hide datasets and software \(1\)$/ });
  ok((await dataChip.getAttribute("aria-pressed")) === "true", "datasets and software are hidden by default, and the chip says how many");
  await dataChip.click();
  await page.waitForFunction(() => document.querySelectorAll(".result").length === 4);
  ok((await page.locator(".idea-kind", { hasText: "Dataset or software" }).count()) === 1, "a shown dataset says what it is");
  await dataChip.click();
  await page.waitForFunction(() => document.querySelectorAll(".result").length === 3);

  // reporting a problem
  console.log("report");
  await page.getByRole("button", { name: "Something missing or wrong?" }).click();
  const pop = page.getByRole("dialog", { name: "Something missing or wrong?" });
  await pop.waitFor();
  await page.waitForTimeout(500);
  ok(await pop.getByText(/sends the search that was run \(not your idea\)/).isVisible(), "the report says exactly what it sends, and that your idea is not part of it");
  ok(await pop.getByRole("button", { name: "Send report" }).isDisabled(), "it cannot be sent before choosing what is wrong");
  await shot("77-idea-report");
  await axe("report form");
  await pop.getByRole("radio", { name: "A paper I know of is missing" }).check();
  await pop.getByRole("textbox", { name: /Tell us more/ }).fill("The 2019 survey is missing");
  await pop.getByRole("button", { name: "Send report" }).click();
  await pop.getByText(/Thank you/).waitFor({ timeout: 8000 });
  ok(true, "a report is sent and acknowledged");
  await page.waitForTimeout(1800);

  // back to the plan keeps the edits
  await page.getByRole("button", { name: "Edit the search" }).click();
  await page.getByRole("heading", { level: 2, name: /This is all that will be sent/ }).waitFor();
  ok((await page.locator(".plan-kw input").last().inputValue()) === "cooperative bank fraud", "going back to the plan keeps what was edited");

  /* ---------- mobile ---------- */
  console.log("mobile");
  const mp = await ctx.newPage();
  await mp.setViewportSize({ width: 390, height: 800 });
  await mp.goto(BASE + "/idea", { waitUntil: "networkidle" });
  await mp.getByRole("textbox", { name: "Your idea" }).waitFor();
  await mp.waitForTimeout(1200);
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok(overflow <= 1, `no horizontal scrolling on a phone (${overflow}px)`);
  await mp.screenshot({ path: OUT + "76-idea-mobile.png" });
  await mp.close();

  ok(errors.length === 0, `no console/page errors${errors.length ? ": " + errors.join(" | ").slice(0, 500) : ""}`);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
}
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall idea check browser checks passed");
process.exit(failures ? 1 : 0);
