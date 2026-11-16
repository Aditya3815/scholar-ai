// Browser e2e for the Understand step (design PDF "Sodhsetu understanding, follow-ups and MCP", M4/M5).
// Part 1, always (the stream is this script's stand-in, so it does not depend on the Worker's switches): what the page draws for a reply the step decided: "I understood: <its line>" and "Did you want this?" with
// Change; one question back with its choices (a choice sends the message again with the choice beside it) and "Search anyway"; the literature scan offered as a card that opens its page; a conversation reply with
// no papers; a question about earlier papers with its line about the abstracts; the fallback line; axe in light and dark at 1280 and 390. And, against the real Worker: with CHAT_UNDERSTAND off (the default run),
// GET /chat/config says no and no ledger leaves the browser.
// Part 2, only when the Worker runs with CHAT_UNDERSTAND on (INTEGRATION_VARS="CHAT_UNDERSTAND:on,..."): the design's own examples through the real Worker and the stand-in models (QA_STUB): "HY" and "Aur batao sab
// badhiya?" are answered with no search, a search, "sirf 2020 ke baad" (the year chip; the ledger is sent), "dusre paper ka dataset kya hai?" (one paper, no new search), "isko simple mein samjhao", "Hindi mein
// batao", "thanks bhai", "ab diffusion models for MRI", a question back, and a model that times out.
// SHOTS_DIR=<folder> SHOTS_TAG=before|after also writes pictures of part 2's replies (light and dark, 1280 and 390): run once with the switch off ("before") and once on ("after").
//   node e2e/understand.mjs [baseUrl]    (default http://localhost:8788)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { BASE, CHAT_STAND_IN, UNSTICK_ALL, at, axeCheck, countFailure, desk, finish, launch, ok, phone, setTheme, sleep, startIdp, watchPage } from "./lib/browser.mjs";

const ON = at("CHAT_UNDERSTAND", "on");
// in shadow the step runs beside the rules and needs the ledger to measure follow-ups, so the server asks for it there too (docs/design/understand-wiring.md)
const SHADOW = at("CHAT_UNDERSTAND", "shadow");
const SHOTS = process.env.SHOTS_DIR ?? "";
const TAG = process.env.SHOTS_TAG ?? (ON ? "after" : "before");

const idp = await startIdp();
idp.setUser({ sub: "understand-1", email: "isha.m@example.edu", email_verified: true, name: "Isha M" });
const browser = await launch();
const errors = [];
const watch = (p) => watchPage(p, errors, { allowed: /Failed to load resource.*(400|401|403|404|409|429|503)/ });
const VP = { 1280: desk(1280, 800), 390: phone(390, 844) };
const axe = (label, p) => axeCheck(p, label, { css: `${UNSTICK_ALL} * { transition: none !important; animation: none !important; }`, settle: () => sleep(300) });


let state;
const signedIn = async (vp, theme = "light") => {
  const ctx = await browser.newContext({ ...VP[vp], ...(state ? { storageState: state } : {}), colorScheme: theme === "dark" ? "dark" : "light", reducedMotion: "reduce" });
  await ctx.addInitScript(CHAT_STAND_IN, { key: "__und", sent: "all" });
  const page = await ctx.newPage();
  watch(page);
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  if (!state) {
    await page.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
    await page.getByRole("button", { name: "Continue with Google" }).last().click();
  }
  await page.locator("#hm-h").waitFor({ timeout: 20000 });
  await sleep(500);
  if (!state) state = await ctx.storageState();
  return { ctx, page };
};
const idle = (p) => p.waitForFunction(() => !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 20000 });
/** A message answered by the stand-in with `events`. */
const fake = async (p, text, events) => {
  await p.evaluate(() => { window.__und = {}; });
  await p.locator(".hm-input").fill(text);
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => !!window.__und?.emit, null, { timeout: 10000 });
  for (const e of events) { await p.evaluate((e) => window.__und.emit(e), e); await sleep(30); }
  await p.evaluate(() => window.__und.end());
  await idle(p);
};
/** A message answered by the real Worker. */
const real = async (p, text) => {
  await p.locator(".hm-input").fill(text);
  await p.keyboard.press("Enter");
  await sleep(300);
  await idle(p);
  await sleep(300);
};
const lastTurn = (p) => p.locator(".chat-turn").last();
const lastSent = (p) => p.evaluate(() => window.__sent.at(-1) ?? null);

const PAPER = (n, year) => ({ id: `doi:10.1000/u.${n}`, doi: `10.1000/u.${n}`, pmid: null, title: `Glaucoma screening study ${n}`, authors: ["A. Rao"], year, venue: "J", abstract: "Screening found glaucoma early. The camera was cheap.", citationCount: 1, oaUrl: null, retracted: false, retractionSources: [], sources: ["openalex"], score: 1, doiStatus: "verified" });
const U = (extra) => ({ type: "understood", mode: "search", query: "q", language: "en", auto: true, how: "model", confidence: 0.9, ...extra });

try {
  console.log("part 1: what the page draws for a reply the step decided");
  {
    const { ctx, page } = await signedIn(1280);
    const cfg = await page.evaluate(() => fetch("/api/v1/chat/config", { credentials: "same-origin" }).then((r) => r.json()));
    if (!ON && !SHADOW) ok(cfg.ledger === false, `with CHAT_UNDERSTAND off the server says not to send the ledger (${JSON.stringify(cfg)})`);
    else ok(cfg.ledger === true, `with CHAT_UNDERSTAND ${ON ? "on" : "in shadow"} the server asks for the ledger (${JSON.stringify(cfg)})`);

    await fake(page, "solar dryers undunsure", [U({ intent: "search", statusLine: "You want papers on solar dryers", confirm: true, searchQuery: "solar dryers" }), { type: "papers", results: [PAPER(1, 2021)], final: true }, { type: "done", answered: false, reason: "sign_in", tookMs: 900 }]);
    const t1 = await lastTurn(page).innerText();
    ok(/I understood: You want papers on solar dryers\./.test(t1), "the step's own line, labelled 'I understood:'");
    ok(await lastTurn(page).locator(".chat-confirm").count() === 1 && /Did you want this\?/.test(t1), "a reading it was only fairly sure of: 'Did you want this?' prominently...");
    ok(await lastTurn(page).locator(".chat-confirm").getByRole("button", { name: /Change/ }).count() === 1, "...with Change");

    await fake(page, "machine learning", [U({ intent: "clarify", statusLine: "I need to check what you mean", clarify: { question: "Which topic should I look for papers on?", choices: ["Machine learning in health", "Machine learning in farming"] } }), { type: "done", answered: false, reason: "clarify", tookMs: 500 }]);
    const clar = lastTurn(page).locator(".chat-clarify");
    ok(await clar.count() === 1 && /Which topic should I look for papers on\?/.test(await clar.innerText()), "one question back is shown");
    ok(await clar.locator(".chat-clarify-chip").count() === 2 && await clar.getByRole("button", { name: "Search anyway" }).count() === 1, "...with its two choices and 'Search anyway'");
    ok(await lastTurn(page).locator(".chat-actions, .chat-why").count() === 0, "...and no reply actions or 'why' line under it");
    await page.evaluate(() => { window.__und = {}; });
    await clar.locator(".chat-clarify-chip").first().click();
    await page.waitForFunction(() => !!window.__und?.emit, null, { timeout: 10000 });
    const chose = await lastSent(page);
    ok(chose?.mode === "auto" && chose?.message === "machine learning (Machine learning in health)", `a choice sends the message again with the choice beside it, in Auto (${chose?.message})`);
    await page.evaluate(() => window.__und.emit({ type: "understood", mode: "search", query: "q", language: "en", auto: true, how: "model", confidence: 0.9 }));
    await page.evaluate(() => window.__und.emit({ type: "done", answered: false, reason: "sign_in", tookMs: 1 }));
    await page.evaluate(() => window.__und.end());
    await idle(page);

    await fake(page, "Aur batao, tum kya kar sakte ho?", [U({ intent: "chat", statusLine: "Conversation, no search", language: "hinglish" }), { type: "general", kind: "not_research", text: "Main research papers dhundhta hoon. Aap kis topic par kaam kar rahe ho?" }, { type: "done", answered: false, reason: "small_talk", tookMs: 400 }]);
    ok(/Main research papers dhundhta hoon/.test(await lastTurn(page).innerText()) && await lastTurn(page).locator(".chat-papers .chat-card, .paper-card").count() === 0, "a conversation reply: its words, no paper cards");

    await fake(page, "dusre paper ka dataset kya hai?", [U({ intent: "ask_results", statusLine: "A question about paper 2 above", context: { turns: 2, intent: "same_papers", rewrote: true, question: "What dataset did the second paper use?" } }), { type: "papers", results: [PAPER(2, 2022)], final: true }, { type: "notice", kind: "abstracts", text: "Answered from the abstracts of papers already in this chat, with no new search. For a paper's full text, use Ask this paper on its card." }, { type: "done", answered: false, reason: "not_answered", tookMs: 900 }]);
    const t4 = await lastTurn(page).innerText();
    ok(/Answered from the abstracts of papers already in this chat/.test(t4) && /Using your earlier question: What dataset did the second paper use\?/.test(t4), "a question about earlier papers says it was answered from their abstracts, and what it was read as");

    await fake(page, "glaucoma undtimeout", [U({ how: "rules", confidence: 0.9, fallback: true, confirm: true }), { type: "papers", results: [PAPER(3, 2020)], final: true }, { type: "done", answered: false, reason: "sign_in", tookMs: 900 }]);
    ok(/I could not understand this well, so I searched for papers\./.test(await lastTurn(page).innerText()), "the fallback line, when the model could not be used");

    await fake(page, "mujhe e-waste par literature review chahiye", [U({ intent: "offer_tool", statusLine: "You want a literature review", offer: "litscan" }), { type: "done", answered: false, reason: "routed", tookMs: 300 }]);
    const card = lastTurn(page).locator(".chat-offer");
    ok(await card.count() === 1 && /literature review/.test(await card.innerText()), "the literature scan is offered as a card");
    for (const theme of ["light", "dark"]) { await setTheme(page, theme); await axe(`1280 ${theme}: the step's replies`, page); }
    await setTheme(page, "light");
    await card.getByRole("button", { name: "Open Literature scan" }).click();
    await page.waitForURL(/\/literature-scan$/, { timeout: 10000 }).catch(() => {});
    ok(/\/literature-scan$/.test(page.url()), `...and its button opens the literature scan page (${page.url()})`);
    await ctx.close();
  }
  {
    const { ctx, page } = await signedIn(390);
    await fake(page, "machine learning", [U({ intent: "clarify", statusLine: "I need to check what you mean", clarify: { question: "Which topic should I look for papers on?", choices: ["Machine learning in health", "Machine learning in farming"] } }), { type: "done", answered: false, reason: "clarify", tookMs: 500 }]);
    ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), "390: nothing goes sideways");
    for (const theme of ["light", "dark"]) { await setTheme(page, theme); await axe(`390 ${theme}: one question back`, page); }
    await ctx.close();
  }

  if (!ON && !SHADOW) {
    console.log("with the switch off: no ledger leaves the browser (the real Worker)");
    const { ctx, page } = await signedIn(1280);
    await real(page, "glaucoma screening in rural India");
    await real(page, "only after 2020");
    const body = await lastSent(page);
    ok(body && !("ledger" in body), `the follow-up is sent with no ledger (${body ? Object.keys(body).join() : "nothing sent"})`);
    await ctx.close();
  }
  if (SHADOW) {
    console.log("in shadow: the ledger goes with a follow-up, and the rules still decide (the real Worker)");
    const { ctx, page } = await signedIn(1280);
    await real(page, "glaucoma screening in rural India");
    await real(page, "only after 2020");
    const body = await lastSent(page);
    ok(Array.isArray(body?.ledger) && body.ledger.length >= 1, `the follow-up is sent with the ledger (${body?.ledger?.length ?? 0} turns)`);
    ok(!/I could not understand this well/.test(await lastTurn(page).innerText()), "...and the reply is the rules' reply, with no line from the step");
    await ctx.close();
  }

  if (ON || SHOTS) {
    console.log(`part 2: the design's examples through the real Worker (${ON ? "the step on" : "the step off: pictures only"})`);
    const STEPS = [
      ["greeting", "Aur batao sab badhiya?"],
      ["hy", "HY"],
      ["search", "glaucoma screening in rural India"],
      ["refine", "sirf 2020 ke baad"],
      ["ask", "dusre paper ka dataset kya hai?"],
      ["simple", "isko simple mein samjhao"],
      ["hindi", "Hindi mein batao"],
      ["thanks", "thanks bhai"],
      ["newtopic", "ab diffusion models for MRI"],
      ["clarify", "undclarify machine learning"],
      ["fallback", "undtimeout glaucoma screening"],
    ];
    const SHOT = new Set(["greeting", "refine", "ask", "clarify", "fallback"]);
    if (SHOTS) mkdirSync(SHOTS, { recursive: true });
    for (const vp of SHOTS ? [1280, 390] : [1280]) {
      for (const theme of SHOTS ? ["light", "dark"] : ["light"]) {
        const { ctx, page } = await signedIn(vp, theme);
        await setTheme(page, theme);
        for (const [name, text] of STEPS) {
          await real(page, text);
          const turn = lastTurn(page);
          // (with the Thinking block folded its lines are hidden, so the words are read from the reply's whole text)
          const t = (await turn.evaluate((el) => el.textContent ?? "")).replace(/\s+/g, " ");
          if (SHOTS && SHOT.has(name)) {
            await turn.scrollIntoViewIfNeeded();
            await sleep(300);
            await page.screenshot({ path: join(SHOTS, `m4-${TAG}-${name}-${theme}-${vp}.png`) });
          }
          if (!ON || vp !== 1280 || theme !== "light") continue;
          const cards = await turn.locator(".chat-papers > li").count();
          const sent = await lastSent(page);
          if (name === "greeting" || name === "hy" || name === "thanks") ok(cards === 0 && (await turn.getAttribute("data-status")) === "done", `${text}: answered with no search (${t.replace(/\s+/g, " ").slice(0, 80)})`);
          if (name === "search") ok(cards > 0, `${text}: papers listed (${cards})`);
          // the bubble of the message: a magnifier only when it was searched
          const bubble = page.locator(".chat-u .chat-bubble").last();
          const mag = await bubble.locator("svg.lucide-search").count();
          if (name === "greeting" || name === "hy" || name === "thanks") ok(mag === 0 && (await bubble.locator("svg.lucide-message-circle").count()) === 1, `${text}: the message bubble shows a conversation mark, not the search magnifier`);
          if (name === "search" || name === "newtopic") ok(mag === 1, `${text}: the message bubble keeps the search magnifier`);
          if (name === "refine") {
            ok(/Papers from 2020 or later/.test(t), "sirf 2020 ke baad: the year chip");
            ok(Array.isArray(sent?.ledger) && sent.ledger.length >= 1, `...and the ledger was sent with it (${sent?.ledger?.length ?? 0} turns)`);
          }
          if (name === "ask") ok(cards === 1 && /Answered from the abstracts/.test(t), `${text}: one paper, from earlier in the chat, no new search (${cards})`);
          if (name === "simple" || name === "hindi") ok(/Answered from the abstracts/.test(t), `${text}: the same papers, no new search`);
          if (name === "newtopic") ok(cards > 0 && !/Answered from the abstracts/.test(t), `${text}: a new search`);
          if (name === "clarify") ok((await turn.locator(".chat-clarify").count()) === 1 && cards === 0, `${text}: a question back, nothing searched`);
          if (name === "fallback") ok(/could not understand this well/.test(t) && cards > 0, `${text}: the rules searched, and the reply says so`);
        }
        await ctx.close();
      }
    }
  }

  ok(errors.length === 0, `no page error${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
} catch (e) {
  console.error(e);
  countFailure();
} finally {
  await browser.close();
  await idp.close?.();
}
finish("all ok", (n) => `${n} FAIL`);
