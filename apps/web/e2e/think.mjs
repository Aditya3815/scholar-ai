// Browser e2e for the Thinking block and the turn ledger (design PDF "Sodhsetu understanding, follow-ups and MCP", M2).
// What it checks, in the browser: a reply with no `think` events looks as it did (no block, the row of steps while it works); a reply with them has the block: open while it works, with the steps as a thin bar
// inside it and no row of steps, a line updated in place by its id, the stage said once to a screen reader (the conversation's polite line), never each line; folded when done into "Thought for N s · ...", opened
// and closed by the mouse and by Enter and Space (`aria-expanded`); the understood line labelled "I understood", with Change and "Use my exact words"; a greeting's block says it was taken for conversation; the
// line "I understood this as ..." and "I searched for" are not said twice; axe in light, dark and read at 1280 and 390, open and folded; nothing goes sideways at 320. The ledger is kept with the chat's record in
// IndexedDB (turns, papers numbered as the cards), is not sent (the body is read), and a private chat has no record at all.
// The streams are the page's own fetch answered by this script (a stand-in that feeds events one by one, so a reply can be looked at while it works); the server's side of the events is pinned by the unit tests
// (since-year.test.ts, think.test.ts). Needs the Worker with the fake identity provider: `npm run integration -w apps/api -- --browser` starts it.
//   node e2e/think.mjs [baseUrl]    (default http://localhost:8788)
import { BASE, CHAT_STAND_IN, REFUSED_OR_BUSY, UNSTICK_ALL, at, axeCheck, desk, finish, launch, ok, phone, setTheme, sleep, startIdp, watchPage } from "./lib/browser.mjs";


const idp = await startIdp();
idp.setUser({ sub: "think-1", email: "isha.m@example.edu", email_verified: true, name: "Isha M" });
const browser = await launch();
const errors = [];
const watch = (p) => watchPage(p, errors, { allowed: REFUSED_OR_BUSY });
const VP = {
  1280: desk(1280, 800),
  390: phone(390, 844),
  320: phone(320, 640),
};
const axe = (label, p) => axeCheck(p, label, { css: `${UNSTICK_ALL} * { transition: none !important; animation: none !important; }`, settle: () => sleep(300) });


const PAPERS = [1, 2, 3, 4, 5].map((n) => ({ id: `doi:10.1000/th.${n}`, doi: `10.1000/th.${n}`, pmid: null, title: `Low-rank adaptation for medical question answering, part ${n}`, authors: [`Wei Li${n}`, "A. Rao"], year: 2020 + n, venue: "Journal of Tests", abstract: "We adapted a large model with low-rank updates. It answered medical questions about images. Accuracy rose by five points.", citationCount: n, oaUrl: null, retracted: n === 3, retractionSources: n === 3 ? ["openalex"] : [], sources: ["openalex"], score: 1 - n / 10, doiStatus: "verified" }));
const T = (id, kind, text, counts, actions) => ({ type: "think", id, kind, text, ...(counts ? { counts } : {}), ...(actions ? { actions } : {}) });
const SEARCH = [
  { type: "understood", mode: "search", query: "lora medical vqa", language: "en", auto: true, how: "model", confidence: 0.9, searchQuery: "LoRA medical visual question answering" },
  T("understood", "understood", "you are looking for papers on “LoRA medical visual question answering”", null, ["change", "exact_words"]),
  { type: "step", step: "search" },
  T("searched", "searched", "Searched for “LoRA medical visual question answering”", { queries: 1 }),
  { type: "papers", results: PAPERS.slice(0, 2), final: false },
  T("found", "found", "2 of 5 sources answered, 2 papers so far", { answered: 2, sources: 5, kept: 2 }),
  { type: "papers", results: PAPERS, final: true },
  T("found", "found", "5 of 5 sources answered with 47 records; duplicates joined, 5 papers listed; 1 retracted, marked", { answered: 5, sources: 5, records: 47, kept: 5, retracted: 1 }),
  { type: "notice", kind: "retracted", text: "At least one paper in this list has been retracted. It is marked, and it was not used for the answer." },
  { type: "step", step: "read" },
  T("reading", "reading", "Reading 4 abstracts", { abstracts: 4 }),
  { type: "step", step: "write" },
  T("writing", "writing", "Writing the answer from the abstracts"),
  { type: "token", text: "Low-rank adaptation works for medical VQA [1]." },
  { type: "step", step: "check" },
  { type: "answer", answer: { text: "Low-rank adaptation works for medical VQA [1].", citations: [{ n: 1, paperId: PAPERS[0].id, sentenceNo: 2, sentence: "It answered medical questions about images." }], grounded: true, checked: true, leftOut: 0, rewritten: 0 } },
  T("checked", "checked", "1 claim read against the sentences they cite: 1 kept", { claims: 1, kept: 1 }),
  { type: "done", answered: true, tookMs: 14200 },
];
const PLAIN = SEARCH.filter((e) => e.type !== "think");
/** A search chosen by hand (Search papers): nothing was understood, so the block's first line says it was chosen (a note with Change), as the server sends it (src/chat/think.ts, chosenSearch). */
const CHOSEN = [
  { type: "understood", mode: "search", query: "glaucoma screening", language: "en", auto: false, how: "chosen", confidence: 1 },
  T("chosen", "note", "Searching papers, as you chose", null, ["change"]),
  { type: "step", step: "search" },
  T("searched", "searched", "Searched for “glaucoma screening”", { queries: 1 }),
  { type: "papers", results: PAPERS, final: true },
  T("found", "found", "5 of 5 sources answered with 47 records; duplicates joined, 5 papers listed; 1 retracted, marked", { answered: 5, sources: 5, records: 47, kept: 5, retracted: 1 }),
  { type: "done", answered: false, reason: "sign_in", tookMs: 1200 },
];
const GREETING = [
  { type: "understood", mode: "search", query: "hy", language: "en", auto: true, how: "rules", confidence: 1 },
  T("understood", "understood", "a conversation, so nothing was searched", null, ["change"]),
  { type: "general", kind: "not_research", text: "Hello! Ask me about a research topic and I will find real papers on it." },
  { type: "done", answered: false, reason: "small_talk", tookMs: 30 },
];

let state;
const signedIn = async (vp) => {
  const ctx = await browser.newContext({ ...VP[vp], ...(state ? { storageState: state } : {}), colorScheme: "light", reducedMotion: "reduce" });
  await ctx.addInitScript(CHAT_STAND_IN, { key: "__think", sent: "last" });
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
/** Sends a message in Auto and answers it with `events`, one by one; `upTo` stops part way (the reply is then still working), and `rest()` sends the others. */
const ask = async (p, text, events, upTo = events.length) => {
  await p.evaluate(() => { window.__think = {}; });
  await p.locator(".hm-input").fill(text);
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => !!window.__think?.emit, null, { timeout: 10000 });
  for (const e of events.slice(0, upTo)) { await p.evaluate((e) => window.__think.emit(e), e); await sleep(40); }
  const rest = async () => { for (const e of events.slice(upTo)) { await p.evaluate((e) => window.__think.emit(e), e); await sleep(40); } await p.evaluate(() => window.__think.end()); await p.waitForFunction(() => !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 10000 }); };
  if (upTo === events.length) await rest();
  return { rest, sent: () => p.evaluate(() => window.__think.sent) };
};
const live = (p) => p.locator("[data-announcer]").textContent().then((t) => (t ?? "").trim());
const wide = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

try {
  console.log("a reply with no think events looks as it did");
  {
    const { ctx, page } = await signedIn(1280);
    const r = await ask(page, "lora medical vqa", PLAIN, 3);
    ok(await page.locator(".chat-steps").count() === 1 && await page.locator(".think").count() === 0, "while it works: the row of steps, and no Thinking block");
    await r.rest();
    ok(await page.locator(".think").count() === 0 && await page.locator(".chat-und").first().innerText().then((t) => /I understood this as/.test(t)), "done: no block, and the line 'I understood this as ...' as before");
    ok(/I searched for: LoRA medical visual question answering/.test(await page.locator(".chat-turn").innerText()), "...with 'I searched for' as before");
    await ctx.close();
  }

  console.log("a reply with think events: open while it works, the steps as a bar, a line updated in place, the stage said once");
  {
    const { ctx, page } = await signedIn(1280);
    const upToFirstFound = SEARCH.findIndex((e) => e.type === "think" && e.kind === "found") + 1;
    const r = await ask(page, "lora medical vqa", SEARCH, upToFirstFound);
    const block = page.locator(".think");
    await block.waitFor();
    ok(await block.getAttribute("data-open") === "true" && await page.locator(".think-head").getAttribute("aria-expanded") === "true", "open while the reply is written");
    ok(await page.locator(".think-bar").count() === 1 && await page.locator(".chat-steps").count() === 0, "the steps are a thin bar inside the block, and the row of steps is not drawn");
    ok(/Thinking/.test(await page.locator(".think-head").innerText()), "its head says Thinking");
    ok((await page.locator(".think-lines li").count()) === 3 && /2 of 5 sources answered, 2 papers so far/.test(await block.innerText()), "the lines so far: understood, searched, and what was found so far");
    // (the conversation's one status line keeps each thing it says for a moment before the next: the stage that came after "Understanding" follows it)
    await page.waitForFunction(() => /Searching/.test(document.querySelector("[data-announcer]")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
    ok(/Searching/.test(await live(page)), `the stage is said to a screen reader (${await live(page)})`);
    const finalFound = SEARCH.findIndex((e, i) => i >= upToFirstFound && e.type === "think" && e.kind === "found");
    for (const e of SEARCH.slice(upToFirstFound, finalFound + 1)) { await page.evaluate((e) => window.__think.emit(e), e); await sleep(40); }
    await page.waitForFunction(() => /47 records/.test(document.querySelector(".think")?.textContent ?? ""), null, { timeout: 5000 });
    ok((await page.locator(".think-lines li").count()) === 3 && !/2 papers so far/.test(await block.innerText()), "the same id replaced its line in place: still three lines, the new count in it");
    ok(await page.locator("[aria-live]").filter({ hasText: /sources answered/ }).count() === 0, "no line is read out as it comes (only the stage)");
    const rest = SEARCH.slice(finalFound + 1);
    for (const e of rest) { await page.evaluate((e) => window.__think.emit(e), e); await sleep(40); }
    await page.evaluate(() => window.__think.end());
    await page.waitForFunction(() => !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 10000 });

    console.log("done: folded into one line, opened by mouse and keyboard, the understood line's controls, nothing said twice");
    ok(await block.getAttribute("data-open") === "false" && await page.locator(".think-lines").isHidden(), `folded when the reply is done (data-open ${await block.getAttribute("data-open")}, lines ${await page.locator(".think-lines").isHidden() ? "hidden" : "shown"})`);
    ok((await page.locator(".think-head").innerText()).trim() === "Thought for 14 s · 1 search · 5 papers", `the folded line: ${(await page.locator(".think-head").innerText()).trim()}`);
    ok(await page.locator(".think-bar").count() === 0, "the bar is gone with the work");
    await page.locator(".think-head").click();
    ok(await page.locator(".think-head").getAttribute("aria-expanded") === "true" && await page.locator(".think-lines").isVisible(), "a click opens it");
    ok((await page.locator(".think-lines li").count()) === 6, "six lines: understood, searched, found, reading, writing, checked");
    const first = page.locator(".think-lines li").first();
    ok(/^I understood: you are looking for papers on “LoRA medical visual question answering”/.test((await first.innerText()).trim()), "the understood line is labelled 'I understood'");
    ok(await first.getByRole("button", { name: /Change/ }).count() === 1 && await first.getByRole("button", { name: "Use my exact words" }).count() === 1, "...with Change and Use my exact words");
    ok(await page.locator(".chat-turn").getByText(/I understood this as/).count() === 0 && await page.locator(".chat-turn").getByText(/^I searched for:/).count() === 0, "the line 'I understood this as' and 'I searched for' are not said twice");
    await first.getByRole("button", { name: /Change/ }).click();
    ok(await page.getByRole("menu", { name: "Use another tool for this" }).isVisible(), "Change opens the tool menu");
    await page.keyboard.press("Escape");
    await page.locator(".think-head").focus();
    await page.keyboard.press("Enter");
    ok(await page.locator(".think-head").getAttribute("aria-expanded") === "false", "Enter folds it");
    await page.keyboard.press("Space");
    ok(await page.locator(".think-head").getAttribute("aria-expanded") === "true", "Space opens it");
    for (const theme of ["light", "dark", "read"]) { await setTheme(page, theme); await axe(`1280 ${theme}: the block, open`, page); }
    await page.locator(".think-head").click();
    for (const theme of ["light", "dark"]) { await setTheme(page, theme); await axe(`1280 ${theme}: the block, folded`, page); }
    await setTheme(page, "light");

    console.log("the ledger: kept with the chat in IndexedDB, not sent");
    await sleep(1200);
    const rec = await page.evaluate(async () => {
      const id = sessionStorage.getItem("scholar.chat.active");
      const db = await new Promise((res, rej) => { const r = indexedDB.open("scholar"); r.onsuccess = () => res(r.result); r.onerror = rej; });
      return await new Promise((res) => { const g = db.transaction("chats").objectStore("chats").get(id); g.onsuccess = () => res(g.result ?? null); g.onerror = () => res(null); });
    });
    ok(Array.isArray(rec?.ledger) && rec.ledger.length === 1 && rec.ledger[0].turn === 1 && rec.ledger[0].user === "lora medical vqa" && rec.ledger[0].papers.length === 5 && rec.ledger[0].papers[1].n === 2 && rec.ledger[0].papers[1].first_author === "Li2", `the chat's record has its ledger: one turn, its five papers numbered as the cards (${JSON.stringify(rec?.ledger?.[0])?.slice(0, 160)})`);
    ok(rec.ledger[0].reply === "Low-rank adaptation works for medical VQA.", "...with the start of the answer, without its marks");
    const second = await ask(page, "only after 2022", PLAIN);
    const body = await second.sent();
    // M4: the ledger goes only while the Understand step reads it (CHAT_UNDERSTAND shadow or on for this run); otherwise the body is what it was
    if (at("CHAT_UNDERSTAND", "shadow", "on")) ok(Object.keys(body).join() === "mode,message,history,ledger" && body.ledger.length === 1 && body.ledger[0].papers.length === 5, `with the Understand step reading it, the ledger goes with the next message (${Object.keys(body).join()})`);
    else ok(!("ledger" in body) && Object.keys(body).join() === "mode,message,history", `the next message is sent as before: no ledger leaves the browser (${Object.keys(body).join()})`);
    await ctx.close();
  }

  console.log("a greeting: understood as conversation, with Change");
  {
    const { ctx, page } = await signedIn(1280);
    await ask(page, "hy", GREETING);
    if ((await page.locator(".think-head").getAttribute("aria-expanded")) !== "true") await page.locator(".think-head").click();
    ok(/I understood: a conversation, so nothing was searched/.test(await page.locator(".think-lines").innerText()), "the block says it was taken for conversation");
    ok(await page.locator(".think-lines li").first().getByRole("button", { name: /Change/ }).count() === 1, "...with Change, so a search can still be asked for");
    ok((await page.locator(".think-head").innerText()).trim().startsWith("Thought for 1 s"), "its folded line has no search and no papers in it");
    for (const theme of ["light", "dark"]) { await setTheme(page, theme); await axe(`1280 ${theme}: a greeting's block`, page); }
    await ctx.close();
  }

  console.log("a search chosen by hand: it says it was chosen, never 'I understood', with Change");
  {
    const { ctx, page } = await signedIn(1280);
    await ask(page, "glaucoma screening", CHOSEN);
    if ((await page.locator(".think-head").getAttribute("aria-expanded")) !== "true") await page.locator(".think-head").click();
    const first = page.locator(".think-lines li").first();
    ok(/^Searching papers, as you chose/.test((await first.innerText()).trim()) && await page.locator(".think-label").count() === 0, "the first line says the search was chosen, and no line is labelled 'I understood'");
    ok(await first.getByRole("button", { name: /Change/ }).count() === 1 && await first.getByRole("button", { name: "Use my exact words" }).count() === 0, "...with Change, as the line without the block has (and no 'Use my exact words': the words are the words written)");
    ok(await page.locator(".chat-turn").getByText(/Searching papers, as you chose\./).count() === 0, "(the line without the block is not said twice)");
    for (const theme of ["light", "dark"]) { await setTheme(page, theme); await axe(`1280 ${theme}: a search chosen by hand`, page); }
    await ctx.close();
  }

  console.log("a private chat has no record, so its ledger is never written");
  {
    const { ctx, page } = await signedIn(1280);
    await page.getByRole("button", { name: "Chat options", exact: true }).click();
    await page.getByRole("menuitem", { name: /^Private chat/ }).click();
    await ask(page, "lora medical vqa", SEARCH);
    await sleep(1200);
    const n = await page.evaluate(async () => {
      const id = sessionStorage.getItem("scholar.chat.active");
      const db = await new Promise((res, rej) => { const r = indexedDB.open("scholar"); r.onsuccess = () => res(r.result); r.onerror = rej; });
      if (!db.objectStoreNames.contains("chats")) return 0; // (no chat was ever kept in this browser: the store is made with the first)
      return await new Promise((res) => { const g = db.transaction("chats").objectStore("chats").get(id); g.onsuccess = () => res(g.result ? 1 : 0); g.onerror = () => res(-1); });
    });
    ok(n === 0, "nothing of the private chat is in IndexedDB");
    await ctx.close();
  }

  for (const vp of [390, 320]) {
    console.log(`${vp} px: the block fits, and passes axe`);
    const { ctx, page } = await signedIn(vp);
    await ask(page, "lora medical vqa", SEARCH);
    await page.locator(".think-head").click();
    ok(await wide(page), `at ${vp} px nothing goes sideways with the block open`);
    const fits = await page.locator(".think").evaluate((el) => el.getBoundingClientRect().right <= innerWidth + 1);
    ok(fits, `the block is inside the window at ${vp} px`);
    const head = await page.locator(".think-head").boundingBox();
    ok(head && head.height >= 24, `its button is a target of 24 px or more (${head?.height})`);
    if (vp === 390) for (const theme of ["light", "dark"]) { await setTheme(page, theme); await axe(`390 ${theme}: the block, open`, page); }
    await ctx.close();
  }
} finally {
  await browser.close();
  idp.close?.();
}
ok(errors.length === 0, `no page error or console error in the whole run (${errors.length}${errors.length ? ": " + errors.slice(0, 3).join(" | ").slice(0, 300) : ""})`);
finish("all Thinking block checks passed", (n) => `${n} check(s) failed`);
