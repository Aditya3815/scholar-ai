// Browser e2e for the script and the look of the chat (docs/design/chatview-and-trending.md: C5 script and language, C6 how it looks).
// What it holds the page to:
//   - a message whose Devanagari letters are most of its letters is marked lang="hi" and dir="auto" (the question, the answer, a paper's title and abstract, the chat's title); Hinglish in Latin letters, English and
//     mixed text with a Latin majority are not; the page itself stays lang="en";
//   - Devanagari is drawn in the page's own face (Noto Sans Devanagari, already shipped for the interface) and not in whatever the system has; nothing is fetched for it until there is Devanagari on the screen, and
//     nothing is fetched from another origin; the line-height of Hindi text is at least 1.45 (the marks above and below a line are not clipped);
//   - forced colours: what is shown only by a box-shadow (the ring round a cited paper, the focus ring of the box) has an outline, and the bubble and the marks have a border; none of this shows in normal colours;
//   - print: no rail, box, buttons or tools; a paper stays in one piece; the address of a link is printed;
//   - the marks of an answer ("1") stay with the word before them and the stop after them (never alone at the start of a line, never with the stop left behind), at 1280, 390 and 320;
//   - the question's bubble keeps its icon beside the first line of text; the column the chat is read in is no wider than its text needs; the answer being written is in the card the answer will be in;
//   - axe in light, dark and read at 1280 and 390, no sideways scroll at 320 with Hindi, a 31-letter word and marks, targets of the rows of buttons, reduced motion.
// Needs the Worker with the fake identity provider and the offline stand-ins: `npm run integration -w apps/api -- --browser` starts it.
//   node e2e/chat-look.mjs [baseUrl]
import { chromium } from "playwright-core";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { startFakeIdp } from "../../api/scripts/fake-idp.mjs";

const require = createRequire(import.meta.url);
const axeSource = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.argv[2] ?? "http://localhost:8788";
const ORIGIN = new URL(BASE).origin;
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DESK = { viewport: { width: 1280, height: 800 } };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const NARROW = { viewport: { width: 320, height: 640 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

/* ------------------------------------------------------------------ the conversation the test stores (the page keeps a chat in IndexedDB and a list in localStorage: lib/chat.ts) */
const WORD = "dichlorodiphenyltrichloroethane"; // 31 letters
const HI_Q = "ग्रामीण क्लिनिकों में ग्लूकोमा की जांच कैसे हो सकती है?";
const HI_A = "ग्रामीण क्लिनिकों में स्मार्टफोन अडैप्टर से रेटिना की तस्वीरें ली जा सकती हैं: दो घंटे के प्रशिक्षण के बाद सामुदायिक स्वास्थ्य कार्यकर्ताओं ने ये तस्वीरें लीं और जांच योग्य रोग के लिए संवेदनशीलता 88 प्रतिशत रही [2]. फंडस की तस्वीरों पर प्रशिक्षित एक नेटवर्क ने 0.94 का AUC हासिल किया, पर मोतियाबिंद वाली तस्वीरों में उसका प्रदर्शन कम रहा [1].";
const HI_TITLE = "ग्रामीण क्षेत्रों में ग्लूकोमा की जांच: स्मार्टफोन आधारित रेटिना इमेजिंग";
const HI_ABS = "इस अध्ययन में तीन ग्रामीण क्लिनिकों में सस्ते स्मार्टफोन अडैप्टर से रेटिना की तस्वीरें ली गईं। सामुदायिक स्वास्थ्य कार्यकर्ताओं ने दो घंटे के प्रशिक्षण के बाद तस्वीरें लीं। जांच योग्य रोग के लिए संवेदनशीलता 88 प्रतिशत रही।";
const HINGLISH_Q = "climate change ka farmers par asar kya hai";
// a Hindi sentence with English words in it: most of its WORDS are Devanagari, and each Devanagari letter is more than one code point (a vowel sign and the virama are marks, not letters)
const MIXED_Q = "diabetes में exercise का क्या असर होता है";
const EN_TEXT = (w) => `The first paper reports its main result for ${w} [1]. A second paper describes how the work was done in practice and what it cost [2].`;
const SENT = ["We trained a convolutional network on 12,000 fundus photographs to detect glaucoma.", "The model reached an AUC of 0.94 on a held-out set.", "Performance was lower for images with cataract."];
const paper = (i, over = {}) => ({
  id: `doi:10.1000/look.${i}`, doi: `10.1000/look.${i}`, pmid: null, title: `Deep learning for glaucoma screening ${i}`, authors: ["A. Rao", "S. Iyer"], year: 2021, venue: "Journal of Ophthalmic AI",
  abstract: SENT.join(" "), citationCount: 50, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 0.9, doiStatus: "verified", ...over,
});
const cite = (p, n, sentenceNo) => ({ n, paperId: p.id, sentenceNo, sentence: (p.abstract.split(/(?<=\.)\s+/))[sentenceNo - 1] });
function reply(id, query, language, papers, text, at) {
  const cites = [...text.matchAll(/\[(\d{1,2})\]/g)].map((m) => cite(papers[Number(m[1]) - 1], Number(m[1]), 2));
  return { id, role: "assistant", mode: "search", query, language, auto: false, understood: true, how: "chosen", confidence: 1, status: "done", step: null, stepsDone: ["search", "read", "write", "check"], papers, papersFinal: true, notices: [], live: "", answer: { text, citations: cites, grounded: true, checked: true, leftOut: 0, rewritten: 0 }, generalLive: "", general: null, tookMs: 3000, at };
}
function conversation(id, kind) {
  const t0 = Date.now() - 3600_000;
  const msgs = [];
  const add = (q, language, papers, text) => {
    const k = msgs.length / 2;
    msgs.push({ id: `${id}u${k}`, role: "user", text: q, at: t0 + k * 60000 });
    msgs.push(reply(`${id}a${k}`, q, language, papers, text, t0 + k * 60000 + 5000));
  };
  if (kind === "hindi") {
    add(HI_Q, "hi", [paper(1, { title: HI_TITLE, abstract: HI_ABS }), paper(2)], HI_A.replace(/ \[2\]\./, " [2]।"));
    add(HINGLISH_Q, "en", [paper(3), paper(4)], EN_TEXT("farmers"));
    add(MIXED_Q, "hi", [paper(5), paper(6)], EN_TEXT("exercise"));
  } else if (kind === "word") {
    add(`${WORD} residues in soil near farms`, "en", [paper(1, { title: `${WORD[0].toUpperCase()}${WORD.slice(1)} residues in agricultural soil`, abstract: `We measured ${WORD} in 140 soil samples from farms. The highest level of ${WORD} was found in the topsoil. Levels fell slowly.` }), paper(2)], `Residues of ${WORD} [1] were found in soil near farms. A second paper links ${WORD} [2] to crops.`);
  } else {
    add("glaucoma screening in rural clinics", "en", [paper(1), paper(2), paper(3)], EN_TEXT("glaucoma screening"));
  }
  return msgs;
}
async function store(page, id, messages) {
  await page.evaluate(async ({ id, messages }) => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open("scholar", 2); r.onupgradeneeded = () => { for (const s of ["pendingInk", "chats"]) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise((res) => { const tx = db.transaction("chats", "readwrite"); tx.objectStore("chats").put({ id, messages, rev: 1 }, id); tx.oncomplete = () => res(); });
    db.close();
    const index = JSON.parse(localStorage.getItem("scholar.chats.v1") ?? "[]").filter((e) => e.id !== id);
    index.unshift({ id, title: messages[0].text, updatedAt: Date.now(), kw: messages.filter((m) => m.role === "user").map((m) => m.text).join(" ").slice(0, 80) });
    localStorage.setItem("scholar.chats.v1", JSON.stringify(index));
    sessionStorage.setItem("scholar.chat.active", id);
  }, { id, messages });
}

/* ------------------------------------------------------------------ the run */
const idp = await startFakeIdp(9911);
idp.setUser({ sub: "look-ui-1", email: "isha.m@example.edu", email_verified: true, name: "Isha M" });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
const errors = [];
const leftTheApp = [];
let storageState;
let n = 0;

/** A new page in a signed-in context with the conversation of `kind` stored and opened. `theme`: light, dark or read. */
async function open(kind, device, { theme = "light", extra = {}, fonts = null } = {}) {
  const ctx = await browser.newContext({ ...device, storageState, colorScheme: "light", ...extra });
  await ctx.addInitScript((t) => { try { localStorage.setItem("theme", t); } catch { /* no storage */ } }, theme);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.origin !== ORIGIN && !/^(data|blob):$/.test(u.protocol)) leftTheApp.push(r.url());
    if (fonts && /\.woff2?$/.test(u.pathname)) fonts.push(u.pathname.split("/").pop());
  });
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.locator("#hm-h").waitFor({ timeout: 20000 });
  const id = `looktest${String(++n).padStart(11, "0")}`;
  await store(page, id, conversation(id, kind));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll(".chat-turn").length >= 1, null, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.waitForFunction(() => [...document.querySelectorAll(".chat-bubble, .chat-answer, .result")].every((el) => getComputedStyle(el).opacity === "1"), null, { timeout: 8000 }).catch(() => {});
  await sleep(500);
  return { page, ctx };
}
/** axe on the page with the box in the flow of the page and every reply drawn, as e2e/chat.mjs does it: the box that sticks to the bottom covers whatever is scrolled under it, and axe reports a button that is partly under it (target-size), which one depends on where the page happens to be scrolled */
const axeRun = async (page) => {
  const style = await page.addStyleTag({ content: ".hm-box { position: static !important; } .chat-list > li { content-visibility: visible !important; }" });
  await page.waitForTimeout(400);
  const v = await axeOn(page);
  await style.evaluate((el) => el.remove());
  return v;
};
const axeOn = (page) => page.evaluate(async (src) => { if (!window.axe) (0, eval)(src); const r = await window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] }); return r.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target?.join(" ")})`); }, axeSource);
const style = (page, sel, props) => page.locator(sel).first().evaluate((el, props) => { const s = getComputedStyle(el); return Object.fromEntries(props.map((p) => [p, s.getPropertyValue(p)])); }, props);

try {
  const c0 = await browser.newContext({ ...DESK });
  const p0 = await c0.newPage();
  await p0.goto(BASE + "/", { waitUntil: "networkidle" });
  await p0.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
  await p0.getByRole("button", { name: "Continue with Google" }).last().click();
  await p0.locator("#hm-h").waitFor({ timeout: 20000 });
  await sleep(1500);
  storageState = await c0.storageState();
  await c0.close();

  /* ---------------------------------------------------------------- C5: language */
  console.log("language of a message");
  {
    const fonts = [];
    const { page, ctx } = await open("hindi", DESK, { fonts });
    const info = await page.evaluate(() => {
      const lang = (el) => el?.getAttribute("lang") ?? null;
      const dir = (el) => el?.getAttribute("dir") ?? null;
      const bubbles = [...document.querySelectorAll(".chat-bubble")].map((b) => b.querySelector(".chat-bubble-t") ?? b);
      const answers = [...document.querySelectorAll(".chat-answer .chat-text")];
      const cards = [...document.querySelectorAll(".chat-turn")].map((t) => [...t.querySelectorAll(".result")]);
      return {
        root: document.documentElement.getAttribute("lang"),
        bubbleLang: bubbles.map(lang), bubbleDir: bubbles.map(dir),
        answerLang: answers.map(lang), answerDir: answers.map(dir),
        titleLang: cards.map((c) => c.map((r) => lang(r.querySelector(".result-title")))),
        absLang: cards.map((c) => c.map((r) => lang(r.querySelector(".abstract")))),
        head: [lang(document.querySelector(".chat-title")), dir(document.querySelector(".chat-title"))],
      };
    });
    ok(info.root === "en", `the page itself stays lang="en" (${info.root})`);
    ok(info.bubbleLang[0] === "hi" && info.bubbleDir[0] === "auto", `the Hindi question is lang="hi" dir="auto" (${info.bubbleLang[0]}, ${info.bubbleDir[0]})`);
    ok(info.bubbleLang[1] === null && info.bubbleDir[1] === "auto", `the Hinglish question in Latin letters has no lang of its own, and a question a person wrote is dir="auto" (${info.bubbleLang[1]}, ${info.bubbleDir[1]})`);
    ok(info.bubbleLang[2] === "hi" && info.bubbleDir[2] === "auto", `a Hindi sentence with English words in it ("${MIXED_Q}") is lang="hi" too: a screen reader reads it in a Hindi voice (${info.bubbleLang[2]}, ${info.bubbleDir[2]})`);
    ok(info.answerLang[0] === "hi" && info.answerDir[0] === "auto" && info.answerLang[1] === null, `the Hindi answer is marked, the English one beside it is not (${info.answerLang.join(", ")})`);
    ok(info.titleLang[0][0] === "hi" && info.titleLang[0][1] === null && info.titleLang[1].every((l) => l === null), `a paper with a Hindi title is marked, English ones are not (${JSON.stringify(info.titleLang)})`);
    ok(info.absLang[0][0] === "hi" && info.absLang[0][1] === null, `...and so is a Hindi abstract (${JSON.stringify(info.absLang)})`);
    /* the title of the chat is the question, so it must be marked like the question */
    const headMarked = await page.evaluate(() => { const h = document.querySelector(".chat-title"); return h?.getAttribute("lang") === "hi" || h?.querySelector("[lang='hi']") !== null; });
    ok(headMarked, "the chat's title (the Hindi question) is lang=\"hi\"");
    const railMarked = await page.evaluate(() => [...document.querySelectorAll(".ws-recent-open .ws-link-label")].some((l) => l.getAttribute("lang") === "hi"));
    ok(railMarked, "the chat's name in the rail is lang=\"hi\" too");

    console.log("a paper opened from a card keeps its language (the preview, the Ask panel)");
    {
      const card = page.locator(".chat-turn").first().locator(".result").first();
      const lead = (sel) => page.evaluate((s) => { const el = document.querySelector(s); const cs = getComputedStyle(el); return { lang: el.getAttribute("lang"), dir: el.getAttribute("dir"), ratio: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize) }; }, sel);
      await card.getByRole("button", { name: /^Preview:/ }).click();
      await page.locator(".pv-title").waitFor();
      const pt = await lead(".pv-title");
      const pa = await lead(".pv-abstract");
      ok(pt.lang === "hi" && pt.dir === "auto" && pt.ratio >= 1.45, `the preview's Hindi title is lang="hi" dir="auto" with a line-height of at least 1.45 (${pt.lang}, ${pt.dir}, ${pt.ratio.toFixed(2)})`);
      ok(pa.lang === "hi", `...and so is its abstract (${pa.lang})`);
      await page.keyboard.press("Escape");
      await page.locator(".pv-title").waitFor({ state: "detached" });
      await card.getByRole("button", { name: /^Ask this paper:/ }).click();
      await page.locator(".oa-title").waitFor();
      const ot = await lead(".oa-title");
      ok(ot.lang === "hi" && ot.dir === "auto" && ot.ratio >= 1.45, `the Ask panel's Hindi title is lang="hi" dir="auto" with a line-height of at least 1.45 (${ot.lang}, ${ot.dir}, ${ot.ratio.toFixed(2)})`);
      await page.keyboard.press("Escape");
      await page.locator(".oa-title").waitFor({ state: "detached" }).catch(() => {});
      const english = page.locator(".chat-turn").nth(1).locator(".result").first();
      await english.getByRole("button", { name: /^Preview:/ }).click();
      await page.locator(".pv-title").waitFor();
      ok((await lead(".pv-title")).lang === null, "an English title in the preview is not marked");
      await page.keyboard.press("Escape");
      await page.locator(".pv-title").waitFor({ state: "detached" });
    }

    console.log("the face Devanagari is drawn in");
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const doc = await cdp.send("DOM.getDocument", { depth: 0 });
    const used = async (sel) => {
      const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: sel });
      const r = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
      return r.fonts.map((f) => `${f.familyName}:${f.glyphCount}`);
    };
    const answerFonts = await used('.chat-answer .chat-text[lang="hi"]');
    ok(answerFonts.some((f) => /^Noto Sans Devanagari:\d+$/.test(f)), `the Hindi answer's Devanagari is in Noto Sans Devanagari, the face the page ships (${answerFonts.join(", ")})`);
    ok(answerFonts.some((f) => /^Source Serif 4/.test(f)), `...and the numbers and Latin letters in it stay in the page's serif (${answerFonts.join(", ")})`);
    const serifDev = await page.evaluate(() => getComputedStyle(document.querySelector('.chat-answer .chat-text[lang="hi"]')).fontFamily);
    ok(!/Noto Serif Devanagari/.test(serifDev) && /Noto Sans Devanagari/.test(serifDev), `the reading font names a face that exists (${serifDev})`);
    ok(fonts.some((f) => /noto-sans-devanagari-devanagari-400/.test(f)), `the Devanagari face was fetched, now that there is Devanagari on the screen (${fonts.filter((f) => /devanagari/.test(f)).join(", ")})`);
    ok(!fonts.some((f) => /noto-serif/i.test(f)), "no serif Devanagari face is fetched (there is none)");

    console.log("line height of Hindi");
    const leads = await page.evaluate(() => [...document.querySelectorAll('[lang="hi"]')].map((el) => { const s = getComputedStyle(el); const lh = parseFloat(s.lineHeight); return { el: `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`, ratio: Number.isFinite(lh) ? lh / parseFloat(s.fontSize) : 0 }; }));
    ok(leads.length >= 5 && leads.every((l) => l.ratio >= 1.45), `every element marked lang="hi" has a line-height of at least 1.45 (${leads.map((l) => `${l.el} ${l.ratio.toFixed(2)}`).join(", ")})`);
    await ctx.close();

    /* nothing for Devanagari is fetched while there is none on the screen */
    const fonts2 = [];
    const e = await open("english", DESK, { fonts: fonts2 });
    ok(!fonts2.some((f) => /devanagari/.test(f)), `an English conversation fetches no Devanagari file (${fonts2.filter((f) => /devanagari/.test(f)).join(", ") || "none"})`);
    ok(await e.page.evaluate(() => document.querySelectorAll(".hm [lang]").length) === 0, "...and marks nothing with a lang");
    await e.ctx.close();
  }

  /* ---------------------------------------------------------------- C5: a device that has no Georgia (Android, Linux) */
  console.log("a device without Georgia: Latin text is not drawn in, or fetched in, the Devanagari face");
  {
    // The serif's stack names Noto Sans Devanagari, which has Latin subsets of its own (U+0000-00FF). While Source Serif is still arriving (its swap period) a device WITHOUT Georgia has nothing between them,
    // and the browser could draw Latin headings and answers in Noto's sans Latin and fetch that file (10 KB) outside the preloaded-fonts budget. This machine has Georgia, so the device is made here: the
    // stack read from the page, with Georgia and the page's Georgia stand-in taken out, put on the page while the serif's own file is held back.
    const fonts = [];
    const ctx = await browser.newContext({ ...DESK, storageState, colorScheme: "light" });
    const page = await ctx.newPage();
    page.on("request", (r) => { const u = new URL(r.url()); if (/\.woff2?$/.test(u.pathname)) fonts.push(u.pathname.split("/").pop()); });
    let release;
    const held = new Promise((r) => { release = r; });
    await page.route(/source-serif-4[^/]*\.woff2$/, async (route) => { await held; await route.continue().catch(() => {}); });
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.locator("#hm-h").waitFor({ timeout: 20000 });
    const id = `looktest${String(++n).padStart(11, "0")}`;
    await store(page, id, conversation(id, "english"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll(".chat-turn").length >= 1, null, { timeout: 30000 });
    const stack = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-serif"));
    const noGeorgia = stack.replace(/"Source Serif Stand-in",?\s*/g, "").replace(/Georgia/g, '"No Such Georgia"');
    await sleep(800);
    const before = fonts.length; // what was fetched up to here is what the page does with Georgia present; only what the change of stack brings counts
    await page.addStyleTag({ content: `:root { --font-serif: ${noGeorgia}; }` });
    await sleep(1200);
    const used = await page.evaluate(() => document.fonts.status);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const doc = await cdp.send("DOM.getDocument", { depth: 0 });
    const platform = async (sel) => { const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: sel }); return (await cdp.send("CSS.getPlatformFontsForNode", { nodeId })).fonts.map((f) => `${f.familyName}:${f.glyphCount}`); };
    const heading = await platform(".chat-title");
    const answer = await platform(".chat-answer .chat-text");
    ok(!/Noto Sans Devanagari/.test(heading.join(",")) && !/Noto Sans Devanagari/.test(answer.join(",")), `without Georgia, while Source Serif is still arriving, English headings and answers are not drawn in Noto Sans Devanagari (${heading.join(", ")} | ${answer.join(", ")}) [fonts ${used}]`);
    ok(!fonts.slice(before).some((f) => /noto-sans-devanagari/.test(f)), `...and none of its files is fetched for them (${fonts.slice(before).filter((f) => /devanagari/.test(f)).join(", ") || "none"})`);
    release();
    await ctx.close();
  }

  /* ---------------------------------------------------------------- C5: forced colours and print */
  console.log("forced colours");
  {
    const { page, ctx } = await open("english", DESK);
    const normal = {
      bubble: await style(page, ".chat-bubble", ["border-top-width"]),
      mark: await style(page, ".cite-chip", ["border-top-width"]),
    };
    await page.locator(".hm-input").focus();
    const boxNormal = await style(page, ".hm-box", ["outline-style", "outline-width"]);
    await page.locator("main, body").first().click({ position: { x: 5, y: 5 } }).catch(() => {});
    ok(normal.bubble["border-top-width"] === "0px" && normal.mark["border-top-width"] === "0px" && boxNormal["outline-style"] === "none", `in normal colours there is no extra border or outline (bubble ${normal.bubble["border-top-width"]}, mark ${normal.mark["border-top-width"]}, box ${boxNormal["outline-style"]})`);
    await page.emulateMedia({ forcedColors: "active" });
    await page.locator(".cite-chip").first().click();
    await page.waitForFunction(() => document.querySelector('.result[data-flash="true"]'), null, { timeout: 4000 });
    const ring = await style(page, '.result[data-flash="true"]', ["outline-style", "outline-width", "box-shadow"]);
    ok(ring["outline-style"] !== "none" && parseFloat(ring["outline-width"]) >= 2, `forced colours: the paper that was pointed at has an outline of 2 px or more, since a box-shadow is not drawn (${ring["outline-style"]} ${ring["outline-width"]}, shadow ${ring["box-shadow"]})`);
    await page.locator(".hm-input").focus();
    const box = await style(page, ".hm-box", ["outline-style", "outline-width"]);
    ok(box["outline-style"] !== "none" && parseFloat(box["outline-width"]) >= 2, `forced colours: the box with the focus has an outline (${box["outline-style"]} ${box["outline-width"]})`);
    const bubble = await style(page, ".chat-bubble", ["border-top-style", "border-top-width"]);
    ok(bubble["border-top-style"] === "solid" && parseFloat(bubble["border-top-width"]) >= 1, `forced colours: the question's bubble has a border (${bubble["border-top-style"]} ${bubble["border-top-width"]})`);
    const mark = await style(page, ".cite-chip", ["border-top-style", "border-top-width"]);
    ok(mark["border-top-style"] === "solid" && parseFloat(mark["border-top-width"]) >= 1, `forced colours: a mark has a border (${mark["border-top-style"]} ${mark["border-top-width"]})`);
    await page.emulateMedia({ forcedColors: "none", reducedMotion: "reduce" });
    await page.locator(".cite-chip").first().click();
    await page.waitForFunction(() => document.querySelector('.result[data-flash="true"]'), null, { timeout: 4000 });
    await sleep(300);
    const still = await style(page, '.result[data-flash="true"]', ["box-shadow", "animation-name"]);
    ok(/rgb/.test(still["box-shadow"]) && still["box-shadow"] !== "none", `reduced motion: the ring round a pointed paper is there and does not fade (${still["box-shadow"].slice(0, 40)})`);
    await ctx.close();
  }

  console.log("print");
  {
    const { page, ctx } = await open("english", DESK);
    await page.emulateMedia({ media: "print" });
    await sleep(500); // (the card's shadow is a transition on the screen)
    const hidden = await page.evaluate(() => Object.fromEntries([".ws-rail", ".ws-top", ".hm-box", ".chat-head .btn", ".chat-u-actions", ".chat-acts", ".chat-strict", ".result .actions", ".skip-link"].map((s) => [s, [...document.querySelectorAll(s)].every((el) => getComputedStyle(el).display === "none")])));
    ok(Object.values(hidden).every(Boolean), `printed: no rail, box, buttons or tools (${Object.entries(hidden).filter(([, v]) => !v).map(([k]) => k).join(", ") || "all hidden"})`);
    const keep = await style(page, ".result", ["break-inside", "box-shadow"]);
    ok(/avoid/.test(keep["break-inside"]) && keep["box-shadow"] === "none", `printed: a paper is kept in one piece, with no shadow (${keep["break-inside"]}, ${keep["box-shadow"]})`);
    const url = await page.locator(".result-title a").first().evaluate((a) => getComputedStyle(a, "::after").content);
    ok(/doi\.org/.test(url), `printed: the address of a paper's link is printed after its title (${url})`);
    const cv = await page.evaluate(() => [...document.querySelectorAll(".chat-list > li")].every((li) => getComputedStyle(li).contentVisibility === "visible"));
    ok(cv, "printed: every reply is drawn (content-visibility off)");
    const pdf = await page.pdf({ format: "A4" });
    ok(pdf.length > 1000, `printed: a PDF can be made of it (${pdf.length} bytes)`);
    await page.emulateMedia({ media: "screen" });
    const back = await page.evaluate(() => getComputedStyle(document.querySelector(".hm-box")).display);
    ok(back !== "none", "on the screen the box is back");
    await ctx.close();
  }

  console.log("print in the dark theme");
  {
    // browsers do not print backgrounds: light text meant for a dark page, and the white text of the question's bubble, would print as nothing on the white paper
    const { page, ctx } = await open("english", { viewport: { width: 794, height: 1123 } }, { theme: "dark" }); // the width of an A4 page: the rules for a window under 920 px are the ones a printout is laid out with
    await page.emulateMedia({ media: "print" });
    await sleep(500);
    const lum = (rgb) => { const m = (rgb.match(/[0-9.]+/g) ?? ["0", "0", "0"]).map(Number); return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255; };
    const c = await page.evaluate(() => { const s = (sel, p) => getComputedStyle(document.querySelector(sel))[p]; return { text: s(".chat-text", "color"), muted: s(".result-authors", "color"), body: s("body", "backgroundColor"), bubbleText: s(".chat-bubble", "color"), bubbleBg: s(".chat-bubble", "backgroundColor"), bubbleBorder: s(".chat-bubble", "borderTopWidth"), headPos: s(".chat-head", "position"), result: s(".result", "backgroundColor") }; });
    ok(lum(c.text) < 0.3 && lum(c.muted) < 0.4 && lum(c.body) > 0.9, `printed from the dark theme: dark text on white (text ${c.text}, authors ${c.muted}, page ${c.body})`);
    ok(lum(c.bubbleText) < 0.3 && parseFloat(c.bubbleBorder) >= 1 && (c.bubbleBg === "rgba(0, 0, 0, 0)" || lum(c.bubbleBg) > 0.9), `printed: the question's bubble is dark text in an outline, not white text on a fill that is not printed (${c.bubbleText}, ${c.bubbleBg}, border ${c.bubbleBorder})`);
    ok(c.headPos !== "sticky", `printed: the chat's title row does not stick over the question under it (${c.headPos})`);
    await ctx.close();
  }

  /* ---------------------------------------------------------------- C6: marks, bubble, column, cards */
  for (const [label, device] of [["1280", DESK], ["390", PHONE], ["320", NARROW]]) {
    console.log(`the marks of an answer at ${label}`);
    for (const kind of ["english", "hindi", "word"]) {
      const { page, ctx } = await open(kind, device);
      const res = await page.evaluate(() => {
        const out = [];
        for (const p of document.querySelectorAll(".chat-answer .chat-text")) {
          for (const g of p.querySelectorAll(".cite-grp")) {
            const chip = g.querySelector(".cite-chip");
            const gr = g.getBoundingClientRect();
            const cr = chip.getBoundingClientRect();
            // the stop after the mark, if there is one: it must be on the mark's own line
            const tail = g.lastChild;
            let stopTop = null;
            if (tail && tail.nodeType === 3 && tail.textContent.length > 0) { const r = document.createRange(); r.selectNodeContents(tail); stopTop = r.getBoundingClientRect().top; }
            const head = g.firstChild;
            let wordTop = null;
            if (head && head.nodeType === 3 && head.textContent.trim().length > 0) { const r = document.createRange(); r.selectNodeContents(head); const rects = [...r.getClientRects()]; wordTop = rects[rects.length - 1].top; }
            out.push({ n: chip.textContent, chipTop: cr.top, chipH: cr.height, stopTop, wordTop, hasWord: wordTop !== null, inside: gr.left >= -0.5 && gr.right <= innerWidth + 0.5 });
          }
        }
        return out;
      });
      ok(res.length >= 2, `${kind}: every mark is in a group of its own (${res.length} marks)`);
      ok(res.filter((r) => r.hasWord).every((r) => Math.abs(r.chipTop + r.chipH / 2 - r.wordTop - 14) < 20), `${kind}: a mark is on the same line as the word before it (${res.map((r) => (r.wordTop === null ? "-" : Math.round(r.chipTop + r.chipH / 2 - r.wordTop))).join(", ")})`);
      ok(res.filter((r) => r.stopTop !== null).every((r) => Math.abs(r.stopTop - r.chipTop) < 14), `${kind}: ...and the stop after it is on the mark's line, not left behind (${res.map((r) => (r.stopTop === null ? "-" : Math.round(r.stopTop - r.chipTop))).join(", ")})`);
      ok(res.every((r) => r.inside), `${kind}: no group reaches past the window`);
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      ok(sideways <= 0, `${kind}: no sideways scroll (${sideways})`);
      await ctx.close();
    }
  }

  console.log("the question's bubble");
  {
    const { page, ctx } = await open("hindi", PHONE);
    const b = await page.evaluate(() => {
      const bub = document.querySelector(".chat-bubble");
      const ico = bub.querySelector("svg").getBoundingClientRect();
      const txt = bub.querySelector(".chat-bubble-t");
      const t = txt.getBoundingClientRect();
      return { icoTop: ico.top, icoLeft: ico.left, icoRight: ico.right, txtTop: t.top, txtLeft: t.left, txtH: t.height, lines: Math.round(t.height / parseFloat(getComputedStyle(txt).lineHeight)) };
    });
    ok(b.lines >= 2 && b.icoRight <= b.txtLeft + 1 && b.icoTop < b.txtTop + 30, `a question of two lines or more keeps the icon beside its first line, not alone on a row above (${b.lines} lines; icon top ${Math.round(b.icoTop)}, text top ${Math.round(b.txtTop)}, icon right ${Math.round(b.icoRight)}, text left ${Math.round(b.txtLeft)})`);
    await ctx.close();
  }

  console.log("the rail with a 31-letter word in a chat's name");
  {
    const { page, ctx } = await open("word", DESK);
    const r = await page.evaluate(() => {
      const rail = document.querySelector(".ws-rail");
      const rr = rail.getBoundingClientRect();
      const reach = (sel) => Math.max(...[...rail.querySelectorAll(sel)].map((el) => el.getBoundingClientRect().right));
      return { over: rail.scrollWidth - rail.clientWidth, rail: Math.round(rr.right), newChat: Math.round(reach(".ws-newchat")), label: Math.round(reach(".ws-recent-open .ws-link-label")) };
    });
    ok(r.over <= 0 && r.newChat <= r.rail && r.label <= r.rail, `the rail does not widen for it: no sideways scroll in it, and the New chat box and the chat's name end inside it (rail ends at ${r.rail}, scroll over ${r.over}, New chat to ${r.newChat}, name to ${r.label})`);
    await ctx.close();
  }

  console.log("the column and the cards at 1280");
  {
    const { page, ctx } = await open("english", DESK);
    const g = await page.evaluate(() => {
      const col = document.querySelector(".hm[data-chat]").getBoundingClientRect();
      const card = document.querySelector(".chat-answer");
      const cr = card.getBoundingClientRect();
      const inner = cr.width - 2 - 2 * parseFloat(getComputedStyle(card).paddingLeft);
      const widest = (el) => { const r = document.createRange(); r.selectNodeContents(el); return Math.max(...[...r.getClientRects()].map((x) => x.width)); };
      const abs = document.querySelector(".result .abstract");
      const res = document.querySelector(".result").getBoundingClientRect();
      const resInner = res.width - 2 - 2 * parseFloat(getComputedStyle(document.querySelector(".result")).paddingLeft);
      return { col: col.width, answerSlack: 1 - widest(document.querySelector(".chat-answer .chat-text")) / inner, absSlack: 1 - widest(abs) / resInner, rem: parseFloat(getComputedStyle(document.documentElement).fontSize) };
    });
    ok(g.col <= 44 * g.rem + 1, `the column of a conversation is at most 44 rem (${Math.round(g.col)} px)`);
    ok(g.answerSlack < 0.2, `the answer's text takes at least 80 percent of the width inside its card (${Math.round((1 - g.answerSlack) * 100)} percent)`);
    ok(g.absSlack < 0.25, `a paper's abstract takes at least 75 percent of the width inside its card (${Math.round((1 - g.absSlack) * 100)} percent)`);
    const strict = await page.evaluate(() => { const s = document.querySelector(".chat-strict"); const b = s?.querySelector("button"); const h = s?.querySelector(".chat-strict-h"); return s ? { top: getComputedStyle(s).borderTopWidth, size: parseFloat(getComputedStyle(h).fontSize), btnH: b.getBoundingClientRect().height, described: b.getAttribute("aria-describedby") === h.id, text: h.textContent } : null; });
    ok(strict && parseFloat(strict.top) >= 1 && strict.size <= 13 && strict.btnH >= 36 && strict.described && /5,000 tokens/.test(strict.text), `"Check strictly" is a footer of the answer card: a hairline above it, its explanation small, still said in full and still described to the button (${strict ? `${strict.top}, ${strict.size}px, button ${strict.btnH}px` : "missing"})`);
    await ctx.close();
  }

  console.log("the answer being written is in the card the answer will be in");
  {
    const ctx = await browser.newContext({ ...DESK, storageState });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    await page.addInitScript(() => {
      const real = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (window.__look && !window.__look.emit && new URL(url, location.href).pathname === "/api/v1/chat" && (init?.method ?? "GET") === "POST") {
          const enc = new TextEncoder();
          let ctrl;
          const body = new ReadableStream({ start(c) { ctrl = c; } });
          window.__look.emit = (e) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
          window.__look.end = () => { try { ctrl.close(); } catch { /* closed */ } };
          return Promise.resolve(new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } }));
        }
        return real(input, init);
      };
    });
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.locator("#hm-h").waitFor({ timeout: 20000 });
    await page.evaluate(() => { window.__look = {}; });
    await page.locator(".hm-mode").click();
    await page.getByRole("menuitemradio", { name: /^Search papers/ }).click();
    await page.locator(".hm-input").fill("glaucoma screening");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => !!window.__look?.emit, null, { timeout: 10000 });
    const papers = [1, 2, 3].map((i) => paper(i));
    const text = "The first paper reports that a convolutional network reached an AUC of 0.94 on a held-out set [1]. A second paper shows that health workers took the images [2].";
    const head = [
      { type: "understood", mode: "search", query: "glaucoma screening", language: "en", auto: false, how: "chosen", confidence: 1 },
      { type: "step", step: "search" }, { type: "papers", results: papers, final: true }, { type: "step", step: "read" }, { type: "step", step: "write" },
      ...text.slice(0, 70).match(/[\s\S]{1,18}/g).map((t) => ({ type: "token", text: t })),
    ];
    await page.evaluate((evs) => { for (const e of evs) window.__look.emit(e); }, head);
    await page.waitForFunction(() => document.querySelector(".chat-live"), null, { timeout: 8000 });
    await sleep(500);
    const live = await page.evaluate(() => { const l = document.querySelector(".chat-live"); const card = l.closest(".chat-live-card"); const r = card?.getBoundingClientRect(); return { inCard: !!card, border: card ? getComputedStyle(card).borderTopWidth : null, left: r?.left, width: r?.width, bottom: r?.bottom }; });
    ok(live.inCard && parseFloat(live.border) >= 1, `while the answer is being written its words are inside the answer's card (${live.inCard ? "yes" : "no"}, border ${live.border})`);
    const rest = [
      ...text.slice(70).match(/[\s\S]{1,18}/g).map((t) => ({ type: "token", text: t })),
      { type: "step", step: "check" },
      { type: "answer", answer: { text, citations: [cite(papers[0], 1, 2), cite(papers[1], 2, 3)], grounded: true, checked: true, leftOut: 0, rewritten: 0 } },
      { type: "done", answered: true, tookMs: 4000 },
    ];
    await page.evaluate((evs) => { for (const e of evs) window.__look.emit(e); window.__look.end(); }, rest);
    await page.waitForFunction(() => document.querySelector('.chat-turn[data-status="done"]') && document.querySelector(".chat-answer .cite-chip"), null, { timeout: 15000 });
    ok(await page.locator(".chat-live-card").count() === 0 && await page.locator(".chat-answer").count() === 1, "...and the card that held the words is the card of the answer: there is one, and it is the answer's");
    await sleep(600);
    const done = await page.evaluate(() => { const card = document.querySelector(".chat-answer"); const r = card.getBoundingClientRect(); return { left: r.left, width: r.width }; });
    ok(Math.abs(done.left - live.left) < 1 && Math.abs(done.width - live.width) < 1, `the card keeps its place and width when the checked answer takes the place of the words (${Math.round(live.left)}/${Math.round(live.width)} then ${Math.round(done.left)}/${Math.round(done.width)})`);
    await ctx.close();
  }

  /* ---------------------------------------------------------------- a short window: what is left to read between what sticks */
  console.log("a short window (WCAG 1.4.10: 320 by 256 is a 1280 by 1024 screen at 400 percent zoom)");
  {
    // what sticks to the top (the bar of the window, the title row) and to the bottom (the box) leaves a strip for the conversation: at 256 px high the three of them left about 14 px
    const strip = (page) => page.evaluate(() => {
      const top = Math.max(0, ...[".ws-top", ".chat-head"].map((s) => { const el = document.querySelector(s); if (!el) return 0; const r = el.getBoundingClientRect(); return getComputedStyle(el).position === "sticky" && r.bottom > 0 ? r.bottom : 0; }));
      const box = document.querySelector(".hm-box").getBoundingClientRect();
      return { top, box: box.top, strip: box.top - top, vh: innerHeight, sticky: [".ws-top", ".chat-head", ".hm-box"].map((s) => getComputedStyle(document.querySelector(s)).position) };
    });
    const SHORT = { viewport: { width: 320, height: 256 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
    const { page, ctx } = await open("english", SHORT);
    await page.evaluate(() => window.scrollTo(0, 300));
    await sleep(300);
    const s = await strip(page);
    ok(s.strip >= 100, `at 320 by 256 there are at least 100 px to read between what sticks to the top and the box (${Math.round(s.strip)} px: the top ends at ${Math.round(s.top)}, the box starts at ${Math.round(s.box)} of ${s.vh}; ${s.sticky.join(", ")})`);
    ok(s.sticky[0] === "static" && s.sticky[1] === "static" && s.sticky[2] === "sticky", "...the bar of the window and the title row scroll away in a short window, and the box (what is written in) still sticks");
    await page.evaluate(() => window.scrollTo(0, 0));
    ok(await page.locator(".ws-top").isVisible() && await page.getByRole("button", { name: "New chat" }).first().isVisible(), "...and at the top of the page the bar and New chat are there to be used");
    await ctx.close();
    const tall = await open("english", NARROW);
    await tall.page.evaluate(() => window.scrollTo(0, 300));
    await sleep(300);
    const t = await strip(tall.page);
    ok(t.sticky[0] === "sticky" && t.sticky[1] === "sticky" && t.strip >= 150, `at 320 by 640 the bar and the title row still stick (${t.sticky.join(", ")}; ${Math.round(t.strip)} px to read)`);
    await tall.ctx.close();
  }

  /* ---------------------------------------------------------------- axe, themes, targets, reduced motion */
  for (const theme of ["light", "dark", "read"]) {
    for (const [label, device] of [["1280", DESK], ["390", PHONE]]) {
      const { page, ctx } = await open("hindi", device, { theme });
      const v = await axeRun(page);
      ok(v.length === 0, `axe: the Hindi and Hinglish conversation in ${theme} at ${label}: no violations${v.length ? ` (${v.join("; ")})` : ""}`);
      await ctx.close();
    }
  }
  {
    const { page, ctx } = await open("english", PHONE);
    const sizes = await page.evaluate(() => [".chat-acts .btn", ".chat-u-actions button", ".result .actions .btn, .result .actions a", ".chat-strict button"].map((sel) => [sel, [...document.querySelectorAll(sel)].map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })]));
    ok(sizes.every(([, list]) => list.length > 0 && list.every(([w, h]) => w >= 36 && h >= 36)), `every button of the rows is at least 36 by 36 on a phone (${sizes.map(([s, l]) => `${s}: ${l.map((x) => x.join("x")).join(" ")}`).join(" | ").slice(0, 300)})`);
    await ctx.close();
  }
  ok(leftTheApp.length === 0, `nothing was asked of another origin (${leftTheApp.slice(0, 3).join(", ") || "none"})`);
  ok(errors.length === 0, `no errors in the page${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
} catch (e) {
  console.error(e);
  failures++;
} finally {
  await browser.close();
  idp.close();
}
console.log(failures === 0 ? "\nchat look: all passed" : `\nchat look: ${failures} FAIL`);
process.exit(failures === 0 ? 0 : 1);
