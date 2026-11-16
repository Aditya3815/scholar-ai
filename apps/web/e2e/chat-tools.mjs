// Browser e2e for tools run in the reply (CHAT_TOOLS, docs/design/chat-tools.md). The streams are the page's own fetch answered by this script with the events the server sends with the switch on
// (their server side is pinned by src/chat/tools-route.test.ts and scripts/chat-tools-e2e.mjs), so this suite holds what the PAGE draws, in any run:
// - before (the switch off): a pasted list ends in the offer card, as it always did;
// - Check references in the reply: the verdicts as they arrive (in order, whatever order they come in), a line that adds them up, "I understood this as Check references" with "Did you want this? Change",
//   the way to the Check references page, and no "Copy the answer" row (there is no written answer);
// - retractions: each DOI said retracted (with its notice), not retracted, or could not be checked;
// - a question about one paper of the chat: its card, what the answer is made from, the words while they are written, the checked answer with its quotes;
// - kept: the result is there again after a reload; axe in light and dark at 1280 and 390; nothing goes sideways at 320; no page error.
// Pictures (before and after, desktop and phone) go to SHOTS_DIR (default e2e/shots/chat-tools).
//   node e2e/chat-tools.mjs [baseUrl]    (default http://localhost:8788)
import { mkdirSync } from "node:fs";
import { BASE, CHAT_STAND_IN, REFUSED_OR_BUSY, UNSTICK_ALL, axeCheck, countFailure, desk, finish, launch, ok, phone, setTheme, sleep, startIdp, watchPage } from "./lib/browser.mjs";

const SHOTS = process.env.SHOTS_DIR ?? new URL("./shots/chat-tools/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
mkdirSync(SHOTS, { recursive: true });

const idp = await startIdp();
idp.setUser({ sub: "tools-1", email: "tools.e2e@example.edu", email_verified: true, name: "Tara S" });
const browser = await launch();
const errors = [];
const watch = (p) => watchPage(p, errors, { allowed: REFUSED_OR_BUSY });
const VP = {
  1280: desk(1280, 900),
  390: phone(390, 844),
  320: phone(320, 640),
};

const axe = (label, p) => axeCheck(p, label, { css: `${UNSTICK_ALL} * { transition: none !important; animation: none !important; }`, settle: () => sleep(300) });



const LIST = [
  "[1] Watson, J. D., & Crick, F. H. C. (1953). Molecular structure of nucleic acids. Nature, 171, 737-738.",
  "[2] Vaswani, A., et al. (2017). Attention is all you need. Advances in Neural Information Processing Systems.",
  "[3] Invented, Q. (2021). A study that does not exist at all. Journal of Nothing, 1, 1-2.",
  "[4] He, K., Zhang, X., Ren, S., & Sun, J. (2019). Deep residual learning for image recognition. CVPR, 770-778.",
].join("\n");
const V = (input, status, match, extra = {}) => ({ input, status, reason: status === "verified" ? "The record's title, an author and the year match." : status === "not_found" ? "No record in Crossref or OpenAlex matches this reference." : "A record with this title exists, but its year differs.", confidence: 0.9, match, checks: match ? { title: 1, author: true, year: status === "verified" } : null, ...extra });
const REFS = [
  { n: 1, input: LIST.split("\n")[0].slice(4), verdict: V("", "verified", { doi: "10.1038/171737a0", title: "Molecular Structure of Nucleic Acids: A Structure for Deoxyribose Nucleic Acid", authors: ["J. D. Watson", "F. H. C. Crick"], year: 1953, venue: "Nature" }) },
  { n: 2, input: LIST.split("\n")[1].slice(4), verdict: V("", "verified", { doi: "10.48550/arxiv.1706.03762", title: "Attention Is All You Need", authors: ["Ashish Vaswani", "Noam Shazeer"], year: 2017, venue: "NeurIPS" }) },
  { n: 3, input: LIST.split("\n")[2].slice(4), verdict: V("", "not_found", null) },
  { n: 4, input: LIST.split("\n")[3].slice(4), verdict: V("", "mismatch", { doi: "10.1109/cvpr.2016.90", title: "Deep Residual Learning for Image Recognition", authors: ["Kaiming He", "Xiangyu Zhang", "Shaoqing Ren", "Jian Sun"], year: 2016, venue: "CVPR" }) },
];
const T = (id, kind, text, counts, actions) => ({ type: "think", id, kind, text, ...(counts ? { counts } : {}), ...(actions ? { actions } : {}) });
const VERIFY_OFF = [
  { type: "understood", mode: "verify", query: LIST.slice(0, 300), language: "en", auto: true, how: "rules", confidence: 1 },
  { type: "done", answered: false, reason: "routed", tookMs: 20 },
];
// the verdicts come as each reference is answered: 3 before 1
const VERIFY_ON = [
  // the rules decided: no `confirm` (the server sends it only for a reading 0.45 to 0.75 sure)
  { type: "understood", mode: "verify", query: LIST.slice(0, 300), language: "en", auto: true, how: "rules", confidence: 1 },
  { type: "tool", tool: "verify", total: 4, skipped: 0 },
  { type: "tool_ref", item: REFS[2] },
  { type: "tool_ref", item: REFS[0] },
  { type: "tool_ref", item: REFS[3] },
  { type: "tool_ref", item: REFS[1] },
  { type: "done", answered: false, reason: "tool", tookMs: 2400 },
];
// The message names all three DOIs the reply checks (an earlier version of this stand-in answered a message of two DOIs with three: a fixture's mistake, never the server's, which checks
// only the DOIs of the message: src/chat/tools-route.test.ts "only what the person wrote is checked" and scripts/chat-tools-e2e.mjs). The suite now holds the reply's DOIs to the bubble's words.
const RETRACT_MSG = "Are these retracted? 10.1016/j.cell.2014.01.retracted, 10.1038/nature14539 and 10.9999/down.1";
const RETRACT_ON = [
  { type: "understood", mode: "verify", query: RETRACT_MSG, language: "en", auto: true, how: "rules", confidence: 1 },
  { type: "tool", tool: "retractions", dois: 3 },
  { type: "tool_retractions", checked: [{ doi: "10.1016/j.cell.2014.01.retracted", status: "retracted", notices: ["10.1016/j.cell.2014.01.retracted-notice"] }, { doi: "10.1038/nature14539", status: "not_retracted", notices: [] }, { doi: "10.9999/down.1", status: "unknown", notices: [] }], invalid: [] },
  { type: "done", answered: false, reason: "tool", tookMs: 900 },
];
const PAPER = { id: "doi:10.1000/glaucoma.2", doi: "10.1000/glaucoma.2", pmid: null, title: "Smartphone-based retinal imaging in rural clinics", authors: ["P. Iyer", "S. Rao"], year: 2022, venue: "Lancet Digital Health", abstract: "Low-cost smartphone adapters were used to capture retinal images in three rural clinics. Community health workers took the images after two hours of training. Sensitivity for referable disease was 88 percent.", citationCount: 14, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 1, doiStatus: "verified" };
const ANSWER = { id: "a1", question: "What method did the second paper use?", found: true, answer: "Community health workers captured retinal images with low-cost smartphone adapters [1], after two hours of training [2].", verified: true, citations: [{ n: 1, page: 1, idx: 0, quote: "Low-cost smartphone adapters were used to capture retinal images in three rural clinics.", section: "Methods" }, { n: 2, page: 1, idx: 1, quote: "Community health workers took the images after two hours of training.", section: "Methods > Training" }], createdAt: 0 };
const ASK_ON = [
  { type: "understood", mode: "paper", query: "What method did the second paper use?", language: "en", auto: true, how: "model", confidence: 0.88, intent: "ask_results", statusLine: "A question about paper 2 above" },
  { type: "papers", results: [PAPER], final: true },
  { type: "tool", tool: "ask_paper", paper: { title: PAPER.title, doi: PAPER.doi }, question: "What method did the second paper use?" },
  { type: "tool_ask", event: { type: "ingest", status: "ready", progress: 1, source: "europepmc" } },
  { type: "tool_ask", event: { type: "paper", key: "doi:10.1000/glaucoma.2", title: PAPER.title, source: "europepmc", license: "cc-by", permissive: true } },
  { type: "tool_ask", event: { type: "stage", stage: "writing" } },
  { type: "tool_ask", event: { type: "delta", text: "Community health workers captured retinal images" } },
  { type: "tool_ask", event: { type: "answer", answer: ANSWER } },
  { type: "done", answered: false, reason: "tool", tookMs: 5200 },
];
// the same, read only 0.6 sure (the 0.45 to 0.75 band): the server adds `confirm`, and the page asks "Did you want this?" in the place of the plain line
const ASK_UNSURE = ASK_ON.map((e) => (e.type === "understood" ? { ...e, confidence: 0.6, confirm: true } : e));
// before: the same question answered from the abstracts of the papers above (CHAT_UNDERSTAND on, CHAT_TOOLS off)
const ASK_OFF = [
  { type: "understood", mode: "search", query: "What method did the second paper use?", language: "en", auto: true, how: "model", confidence: 0.88, intent: "ask_results", statusLine: "A question about paper 2 above" },
  { type: "notice", kind: "abstracts", text: "Answered from the abstracts of papers already in this chat, with no new search. For a paper's full text, use Ask this paper on its card." },
  { type: "papers", results: [PAPER], final: true },
  { type: "answer", answer: { text: "Smartphone adapters were used to capture retinal images in rural clinics [1].", citations: [{ n: 1, paperId: PAPER.id, sentenceNo: 1, sentence: "Low-cost smartphone adapters were used to capture retinal images in three rural clinics." }], grounded: true, checked: true, leftOut: 0, rewritten: 0 } },
  { type: "done", answered: true, tookMs: 4100 },
];

let state;
const signedIn = async (vp, scheme = "light") => {
  const ctx = await browser.newContext({ ...VP[vp], ...(state ? { storageState: state } : {}), colorScheme: scheme, reducedMotion: "reduce" });
  await ctx.addInitScript(CHAT_STAND_IN, { key: "__tools" });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  if (!state) {
    await page.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
    await page.getByRole("button", { name: "Continue with Google" }).last().click();
  }
  await page.locator("#hm-h").waitFor({ timeout: 20000 });
  await sleep(600);
  if (!state) state = await ctx.storageState();
  return { ctx, page };
};
const ask = async (p, text, events, upTo = events.length) => {
  await p.evaluate(() => { window.__tools = {}; });
  await p.locator(".hm-input").fill(text);
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => !!window.__tools?.emit, null, { timeout: 10000 });
  for (const e of events.slice(0, upTo)) { await p.evaluate((e) => window.__tools.emit(e), e); await sleep(60); }
  const rest = async () => {
    for (const e of events.slice(upTo)) { await p.evaluate((e) => window.__tools.emit(e), e); await sleep(60); }
    await p.evaluate(() => window.__tools.end());
    await p.waitForFunction(() => !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 10000 });
  };
  if (upTo === events.length) await rest();
  return { rest };
};
const wide = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const shot = async (p, name) => {
  await p.locator(".chat-turn").last().scrollIntoViewIfNeeded().catch(() => {});
  await sleep(250);
  await p.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
};
const lastTurn = (p) => p.locator(".chat-turn").last();
/** The icon of the last message bubble you sent (lucide names its icon in the class: "lucide lucide-list-checks"). */
const bubbleIcon = (p) => p.locator(".chat-bubble").last().locator("svg").first().getAttribute("class").then((c) => /lucide-([a-z-]+)/.exec(c ?? "")?.[1] ?? "none");
/** The understood line(s) of the last reply, outside the Thinking block, and how many Change buttons they have. */
const undLines = async (p) => ({ texts: (await lastTurn(p).locator(".chat-und:not(.chat-searched)").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()), changes: await lastTurn(p).locator(".chat-und").getByRole("button", { name: /^Change/ }).count() });

try {
  console.log("before (CHAT_TOOLS off): a pasted list is offered, as it always was");
  for (const vp of [1280, 390]) {
    const { ctx, page } = await signedIn(vp);
    await ask(page, LIST, VERIFY_OFF);
    ok(await lastTurn(page).locator(".chat-offer").count() === 1 && await page.locator(".chat-tool").count() === 0, `${vp}: the offer card, and no tool`);
    ok(await bubbleIcon(page) === "search", `${vp}: the bubble keeps the magnifier it always had (${await bubbleIcon(page)})`);
    await shot(page, `before-verify-${vp}`);
    await ask(page, "What method did the second paper use?", ASK_OFF);
    await shot(page, `before-ask-${vp}`);
    await ctx.close();
  }

  console.log("Check references in the reply");
  {
    const { ctx, page } = await signedIn(1280);
    const r = await ask(page, LIST, VERIFY_ON, 4);
    await page.locator(".chat-tool").waitFor();
    ok((await page.locator(".chat-tool-head").innerText()).trim() === "Checking references at Crossref and OpenAlex: 2 of 4 done…", "while it works: how many of the references are done");
    ok(await page.locator(".chat-tool-refs > li").count() === 2, "the verdicts that came are drawn");
    await r.rest();
    const rows = page.locator(".chat-tool-refs > li");
    ok(await rows.count() === 4, "four references, each with its verdict");
    const statuses = await rows.locator(".ref-status").allInnerTexts();
    ok(JSON.stringify(statuses) === JSON.stringify(["Verified", "Verified", "Not found", "Details don’t match"]), `in the order of the paste, with the Check references page's words (${statuses.join(", ")})`);
    const head = (await page.locator(".chat-tool-head").innerText()).replace(/\s+/g, " ");
    ok(head.trim() === "4 references checked · 2 verified · 1 with details that differ · 1 not found", `the line that adds them up, with a middle dot between (${head})`);
    // no text of the reply was written in a wrong encoding (a "Â·" for a "·", a "â€¦" for a "…")
    ok(!/Â|â€/.test(await lastTurn(page).innerText()), "every character of the reply is the one meant");
    const v1 = await undLines(page);
    ok(v1.texts.length === 1 && v1.texts[0] === "I understood this as Check references. Change" && v1.changes === 1, `ONE line, "I understood this as Check references · Change", and no "Did you want this?" (${JSON.stringify(v1)})`);
    ok(await bubbleIcon(page) === "list-checks", `the bubble has the Check references icon, not the magnifier (${await bubbleIcon(page)})`);
    ok(await lastTurn(page).getByRole("button", { name: "Open on the Check references page" }).count() === 1, "the way to the full page");
    ok(await lastTurn(page).getByRole("button", { name: /Copy the answer/ }).count() === 0 && await lastTurn(page).locator(".chat-offer").count() === 0, "no 'Copy the answer' row, no offer card");
    ok(await rows.nth(0).getByRole("link", { name: "Open DOI" }).count() === 1, "a matched record links to its DOI");
    await shot(page, "after-verify-1280");
    for (const theme of ["light", "dark"]) { await setTheme(page, theme); await axe(`1280 ${theme}: references checked`, page); }
    await setTheme(page, "dark");
    await shot(page, "after-verify-1280-dark");
    await setTheme(page, "light");

    console.log("kept: after a reload the result is there again");
    await sleep(1200);
    await page.reload({ waitUntil: "networkidle" });
    await sleep(800);
    const again = await page.locator(".chat-tool-refs > li").count();
    if (again === 0) {
      // the reload opens Home: the chat is in the left rail
      await page.locator(".rail a, .rail button").filter({ hasText: /Watson/ }).first().click().catch(() => {});
      await sleep(800);
    }
    ok(await page.locator(".chat-tool-refs > li").count() === 4, "the four verdicts are kept with the chat");

    console.log("retractions");
    await ask(page, RETRACT_MSG, RETRACT_ON);
    const dois = lastTurn(page).locator(".chat-tool-doi");
    ok(await dois.count() === 3, "three DOIs");
    const bubble = await page.locator(".chat-bubble").last().innerText();
    const shown = await dois.locator(".chat-tool-doi-id").allInnerTexts();
    ok(shown.every((d) => bubble.includes(d)), `every DOI the reply checked is in the message's bubble (${shown.join(", ")})`);
    ok(await bubbleIcon(page) === "list-checks", "the bubble has the Check references icon");
    const v2 = await undLines(page);
    ok(v2.texts.length === 1 && v2.texts[0] === "I understood this as Check retractions. Change" && v2.changes === 1, `one line: "I understood this as Check retractions · Change" (${JSON.stringify(v2)})`);
    ok(await dois.nth(0).getAttribute("data-status") === "retracted" && /Retracted/.test(await dois.nth(0).innerText()) && await dois.nth(0).getByRole("link", { name: "10.1016/j.cell.2014.01.retracted-notice" }).count() === 1, "the retracted one says so, with its notice");
    ok(/Not retracted/.test(await dois.nth(1).innerText()) && /Could not be checked/.test(await dois.nth(2).innerText()), "the others: not retracted, and could not be checked (never 'not retracted' for a check that did not run)");
    ok(/I understood this as Check retractions/.test(await lastTurn(page).innerText()), "'I understood this as Check retractions'");
    await shot(page, "after-retractions-1280");
    await axe("1280 light: retractions", page);

    console.log("a question about one paper of the chat");
    const q = await ask(page, "What method did the second paper use?", ASK_ON, 7);
    ok(/Community health workers captured retinal images/.test(await lastTurn(page).innerText()), "the words are drawn while they are written");
    await q.rest();
    const turn = lastTurn(page);
    ok(/From the paper: Smartphone-based retinal imaging in rural clinics/.test(await turn.locator(".chat-tool-head").innerText()), "which paper it is from");
    ok(/Full text from Europe PMC · CC BY/.test(await turn.locator(".oa-basis").innerText()), "what the answer is made from");
    ok(/Every quote checked against the paper/.test(await turn.locator(".oa-answer").innerText()) && await turn.locator(".oa-source").count() === 2, "the checked answer with its two quotes");
    ok(await turn.locator(".chat-papers li").count() === 1, "the paper's card is above it");
    ok(await bubbleIcon(page) === "file-stack", `the bubble has the Ask a paper icon (${await bubbleIcon(page)})`);
    const v3 = await undLines(page);
    ok(v3.texts.length === 1 && v3.texts[0] === "I understood: A question about paper 2 above. Change" && v3.changes === 1, `a sure reading (0.88): one line (${JSON.stringify(v3)})`);
    await shot(page, "after-ask-1280");

    console.log("a reading only 0.45 to 0.75 sure: the question REPLACES the line");
    await ask(page, "What method did the second paper use?", ASK_UNSURE);
    const v4 = await undLines(page);
    ok(v4.texts.length === 1 && v4.texts[0] === "Did you want this? Ask this paper. Change" && v4.changes === 1, `one line, "Did you want this? Ask this paper · Change", and no "I understood" line under or over it (${JSON.stringify(v4)})`);
    await shot(page, "after-ask-unsure-1280");
    for (const theme of ["light", "dark"]) { await setTheme(page, theme); await axe(`1280 ${theme}: a paper's answer`, page); }
    await setTheme(page, "light");
    ok(errors.length === 0, `no page error (${errors.slice(0, 2).join(" | ")})`);
    await ctx.close();
  }

  console.log("phone: the same, and nothing goes sideways");
  for (const vp of [390, 320]) {
    const { ctx, page } = await signedIn(vp);
    await ask(page, LIST, VERIFY_ON);
    ok(await wide(page), `${vp}: references checked, nothing sideways`);
    if (vp === 390) { await shot(page, "after-verify-390"); await axe("390 light: references checked", page); }
    await ask(page, RETRACT_MSG, RETRACT_ON);
    ok(await wide(page), `${vp}: retractions, nothing sideways`);
    if (vp === 390) await shot(page, "after-retractions-390");
    await ask(page, "What method did the second paper use?", ASK_ON);
    ok(await wide(page), `${vp}: a paper's answer, nothing sideways`);
    if (vp === 390) { await shot(page, "after-ask-390"); await setTheme(page, "dark"); await axe("390 dark: a paper's answer", page); await shot(page, "after-ask-390-dark"); }
    await ctx.close();
  }
  ok(errors.length === 0, `no page error in the whole run (${errors.slice(0, 3).join(" | ")})`);
} catch (e) {
  console.error(e);
  countFailure();
} finally {
  await browser.close();
  idp.close?.();
}
finish("all ok", (n) => `${n} FAIL`);
