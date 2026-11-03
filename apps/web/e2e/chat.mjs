// Browser e2e for the prompt box as a conversation (W2): a search streams its papers and a short answer whose claims point at sentences of abstracts, Stop, errors and
// notices in plain words, chats kept in the browser (reload, recent list, another tab, storage that refuses), signing out clears them.
// Needs the Worker with the fake identity provider and the offline stand-ins: `npm run integration -w apps/api -- --browser` starts it.
//   node e2e/chat.mjs [baseUrl]
import { chromium } from "playwright-core";
import assert from "node:assert/strict";
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
/** Thrown to leave the run early (CHAT_ONLY=actions runs only the message actions). */
class Stop extends Error {}
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const idp = await startFakeIdp(9911);
idp.setUser({ sub: "chat-ui-1", email: "isha.m@example.edu", email_verified: true, name: "Isha M" });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER ?? "msedge", headless: true });
const errors = [];
const watch = (p) => {
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*(401|403|404|409|429|503)/.test(m.text())) errors.push("console: " + m.text()); });
};
const newCtx = (opts = {}) => browser.newContext({ viewport: { width: 1360, height: 900 }, ...opts });

/**
 * Runs in the page: resolves when nothing is moving any more: no running transition or animation that ends (the box's border and shadow still fade after a message is sent), and the places of the box, of its
 * text field, of the buttons of the results and of the rows under the questions, and the height of the page, the same for six frames in a row. Never waits more than 4 s. axe builds its map of what lies
 * over what once, at the start, and then checks each target against it: a page that is still settling was reported as "target partially obscured" (by the box's text field) in one run of three, for the buttons of the last card, far below the window; with this wait it did not happen in 12 of 12 fresh runs of that step, without it in 3 of 12.
 */
const stillPage = () => new Promise((resolve) => {
  const started = performance.now();
  const read = () => [document.documentElement.scrollHeight, ...[...document.querySelectorAll(".hm-box, .hm-input, .result .actions .btn, .chat-u-actions")].flatMap((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.top * 10), Math.round(r.height * 10)]; })].join(",");
  const running = () => document.getAnimations().some((a) => a.playState === "running" && a.effect?.getComputedTiming().iterations !== Infinity);
  let last = read();
  let same = 0;
  const tick = () => {
    const now = read();
    same = now === last && !running() ? same + 1 : 0;
    last = now;
    if (same >= 6 || performance.now() - started > 4000) resolve(true); else requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
async function axe(label, p) {
  // The box that sticks to the bottom of the window covers whatever is scrolled under it, and axe reports a link or a button that is partly under it (target-size, "partially obscured"): which one
  // depends on where the page happens to be scrolled, and a row more under a message was enough to move it. For the run the box is in the flow of the page instead, so that nothing is under it and
  // what axe reads is the page and not its scroll position (that a focused button is never left behind the box is checked separately, below).
  const unstick = await p.addStyleTag({ content: ".hm-box { position: static !important; }" });
  await p.evaluate(stillPage);
  await p.evaluate(axeSource);
  const res = await p.evaluate(async () => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
    const list = (items, impact) => items.map((v) => ({ id: v.id, impact: impact ?? v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(" "), msg: v.nodes[0]?.failureSummary?.split("\n")[1] }));
    // axe answers "incomplete" (not a violation) when it cannot size a small target (the size of a button with a hidden or overflowing part): that is read as a failure too
    return [...list(r.violations), ...list(r.incomplete.filter((i) => i.id === "target-size"), "incomplete")];
  });
  await unstick.evaluate((el) => el.remove());
  ok(res.length === 0, `axe [${label}]`);
  for (const v of res) console.log(`        ${v.impact} ${v.id} x${v.nodes} ${v.sample} :: ${v.msg}`);
}
/**
 * Waits until `fn`, run in the page, gives something true. For what has to be asked of the page asynchronously (the browser's storage): `waitForFunction` takes the Promise that an async function
 * returns for a true value and is done at once, so it cannot be used for that (the first version of `settled` below did not wait for anything).
 */
async function until(p, fn, arg, timeout = 15000) {
  const t = Date.now();
  while (!(await p.evaluate(fn, arg))) {
    if (Date.now() - t > timeout) throw new Error(`timed out waiting for ${fn.toString().slice(0, 90).replace(/[^ -~]+| {2,}/g, " ")}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
const setTheme = (p, t) => p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), t);

try {
  const ctx = await newCtx();
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
  // what is kept is written a moment after it changes: a reload straight after the last word could beat the write, so these wait until nothing in storage is still "working"
  const settled = (p) => until(p, async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open("scholar"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const all = await new Promise((resolve) => { const q = db.transaction("chats").objectStore("chats").getAll(); q.onsuccess = () => resolve(q.result); });
    db.close();
    return all.length > 0 && all.every((c) => c.messages.every((m) => m.role !== "assistant" || m.status !== "working"));
  });
  const turns = () => page.locator(".chat-turn");
  const lastDone = () => page.locator('.chat-turn[data-status="done"]').last();
  /* helpers of the two blocks below (message actions, context between messages): each takes the page it is asked about */
  /** Everything that fades in has finished (a bubble, a reply, a card): axe would read half-transparent colours. The rows hide by design and are not in it. */
  const faded = (p) => p.waitForFunction(() => [...document.querySelectorAll(".chat-bubble, .chat-list > li.chat-a > div, .chat-answer, .result, .retract")].every((el) => getComputedStyle(el).opacity === "1"), null, { timeout: 8000 });
  /** Nothing is still changing by a CSS transition (a theme was just chosen: colours take a moment to arrive, and axe reads them on the way). */
  const calm = (p) => p.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"), null, { timeout: 8000 });
  const frames = (p) => p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const doneN = (p, n) => p.waitForFunction((n) => document.querySelectorAll('.chat-turn[data-status="done"]').length === n && !document.querySelector('.chat-turn[data-status="working"]'), n, { timeout: 30000 });
  /** The contrast of a control's colour against what is behind it (its own background, else the nearest one that has colour), by the same formula as scripts/contrast.mjs. */
  const contrastOf = (loc) => loc.evaluate((el) => {
    // (a colour can come back as "color(srgb 0.99 0.99 0.99)", with its channels from 0 to 1, and not as rgb(): read as 0 to 255 it would be black)
    const rgb = (s) => { const v = (s.match(/[\d.]+/g) ?? []).map(Number); return s.startsWith("color(") ? v.slice(0, 3).map((c) => c * 255).concat(v.slice(3)) : v; };
    const lum = ([r, g, b]) => { const [R, G, B] = [r, g, b].map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * R + 0.7152 * G + 0.0722 * B; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((u, v) => v - u); return (x + 0.05) / (y + 0.05); };
    let bg = null;
    for (let n = el; n && !bg; n = n.parentElement) { const c = rgb(getComputedStyle(n).backgroundColor); if (c.length === 3 || (c.length === 4 && c[3] === 1)) bg = c.slice(0, 3); }
    return ratio(rgb(getComputedStyle(el).color).slice(0, 3), bg ?? [255, 255, 255]);
  });
  const sizesOf = (loc) => loc.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
  /** Waits until the focus is on the i-th reply itself (the named group), and not on the page's body, where the removal of the button that was pressed leaves it. */
  const focusOnReply = (p, i) => p.waitForFunction((i) => document.activeElement === document.querySelectorAll(".chat-turn")[i], i, { timeout: 8000 });
  /** The name of the reply that has the focus (null when the focus is elsewhere). */
  const focusedReply = (p) => p.evaluate(() => (document.activeElement?.classList.contains("chat-turn") ? document.activeElement.getAttribute("aria-label") : null));

  /* ============================ message actions: Copy, Edit and resend, versions ============================
     (docs/design/chat-actions-context.md, section 4; the accessibility spec of its study.) Runs in contexts of its own, so it can be run alone: CHAT_ONLY=actions node e2e/chat.mjs <baseUrl>.
     Nothing here waits a fixed time for something that can be waited for by its state: the rows fade by a transition, the bubbles fade in, and timing was the cause of two failures of this suite. */
  const actions = async () => {
    console.log("message actions: Copy, Edit and resend, versions");
    const rowOpacity = (p, i) => p.evaluate((i) => getComputedStyle(document.querySelectorAll(".chat-u-actions")[i]).opacity, i);
    const waitRow = (p, i, v) => p.waitForFunction(([i, v]) => { const el = document.querySelectorAll(".chat-u-actions")[i]; return !!el && getComputedStyle(el).opacity === v; }, [i, v], { timeout: 6000 });
    /** The polite status line of the i-th question (the row's own), waited for by what it says. */
    const says = (p, i, re) => p.waitForFunction(([i, src]) => new RegExp(src).test(document.querySelectorAll(".chat-u")[i]?.querySelector(":scope > [role=status]")?.textContent ?? ""), [i, re.source], { timeout: 6000 });
    const focused =(p) => p.evaluate(() => { const e = document.activeElement; return e ? { tag: e.tagName, label: e.getAttribute("aria-label"), row: [...document.querySelectorAll(".chat-u")].indexOf(e.closest(".chat-u")), disabled: e.getAttribute("aria-disabled") } : null; });
    // (the operating system's clipboard keeps line breaks its own way, and Windows gives them back as CR LF)
    const readClip = (p) => p.evaluate(() => navigator.clipboard.readText()).then((t) => t.replace(/\r\n/g, "\n"));
    const working = (p) => p.locator('.chat-turn[data-status="working"]');
    const bubbles = (p, n) => p.waitForFunction((n) => document.querySelectorAll(".chat-bubble").length === n, n, { timeout: 8000 });
    const counter = (p) => p.locator(".chat-ver-n").innerText().then((t) => t.replace(/\s+/g, ""));
    /** The contrast of a field's border against the page behind it (the edge of a control must be seen: 3:1). */
    const borderContrast = (loc) => loc.evaluate((el) => {
      const rgb = (s) => (s.match(/[\d.]+/g) ?? []).map(Number);
      const lum = ([r, g, b]) => { const [R, G, B] = [r, g, b].map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * R + 0.7152 * G + 0.0722 * B; };
      const [x, y] = [lum(rgb(getComputedStyle(el).borderTopColor)), lum(rgb(getComputedStyle(document.body).backgroundColor))].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    });

    /* ---- a signed-in reader, a conversation of two questions ---- */
    const actx = await newCtx({ permissions: ["clipboard-read", "clipboard-write"] });
    const A = await actx.newPage();
    watch(A);
    /** What the page sent to /api/v1/chat. */
    const posted = [];
    A.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/v1/chat") posted.push(JSON.parse(r.postData() ?? "{}")); });
    /** A request to /api/v1/chat waits for this promise when it is set: a reply stays "being written" for exactly as long as a check needs, with no guess at how fast the stand-in model is. */
    let hold = null;
    await A.route("**/api/v1/chat", async (route) => { if (hold) await hold; await route.continue(); });
    await A.goto(BASE + "/", { waitUntil: "networkidle" });
    await A.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
    await A.getByRole("button", { name: "Continue with Google" }).last().click();
    await A.locator("#hm-h").waitFor({ timeout: 20000 });
    const sendA = async (text, tool = "Search papers") => {
      await A.waitForFunction(() => !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 30000 });
      await pick(A, tool);
      await A.locator(".hm-input").fill(text);
      await A.keyboard.press("Enter");
    };
    const newChat = async () => {
      await A.locator(".chat-head").getByRole("button", { name: "New chat" }).click();
      await A.locator(".hm-title").waitFor();
    };
    await sendA("glaucoma screening");
    await doneN(A, 1);
    await sendA("diabetic retinopathy");
    await doneN(A, 2);
    await faded(A);
    await A.mouse.move(5, 5);
    const copyBtn = (i) => A.locator(".chat-u").nth(i).getByRole("button", { name: "Copy your message", exact: true });
    const editBtn = (i) => A.locator(".chat-u").nth(i).getByRole("button", { name: "Edit your message", exact: true });
    const ta = A.locator(".chat-edit-ta");
    const prev = A.getByRole("button", { name: "Previous version", exact: true });
    const next = A.getByRole("button", { name: "Next version", exact: true });

    console.log("  the row under a message: shown by hover and by keyboard focus, never out of the tab order");
    ok(await A.locator(".chat-u-actions").count() === 2 && await A.locator(".chat-u .chat-bubble").count() === 2, "each question has a row of actions under it, and the bubble is still the only .chat-bubble");
    ok((await A.locator(".chat-u-actions").first().getAttribute("role")) === "group" && (await A.locator(".chat-u-actions").first().getAttribute("aria-label")) === "Your message 1" && (await A.locator(".chat-u-actions").nth(1).getAttribute("aria-label")) === "Your message 2", "it is a labelled group, named by the number of the message (not a toolbar)");
    ok(await A.locator(".chat-bubble button, .chat-bubble .chat-act").count() === 0, "the buttons are outside the accent bubble (a focus ring would be accent on accent)");
    ok(await A.getByRole("button", { name: "Copy your message", exact: true }).count() === 2 && await A.getByRole("button", { name: "Edit your message", exact: true }).count() === 2, "each button is named 'Copy your message' and 'Edit your message', as asked for by name");
    await waitRow(A, 0, "0");
    const idle = await A.locator(".chat-u-actions").first().evaluate((el) => ({ h: el.getBoundingClientRect().height, display: getComputedStyle(el).display, visibility: getComputedStyle(el).visibility }));
    ok(idle.h >= 36 && idle.display !== "none" && idle.visibility === "visible", `with the pointer elsewhere the row is not shown (opacity 0) but keeps its place, and is neither display:none nor visibility:hidden (${idle.h}px high)`);
    await A.locator(".chat-u").first().hover({ position: { x: 20, y: 10 } });
    await waitRow(A, 0, "1");
    ok(await rowOpacity(A, 1) === "0", "hovering the message (the empty side of its row, not the bubble) shows its actions, and only its own");
    await A.mouse.move(5, 5);
    await waitRow(A, 0, "0");
    await A.locator(".chat-head").getByRole("button", { name: "New chat" }).focus();
    await A.keyboard.press("Tab");
    ok((await focused(A))?.label === "Copy your message" && (await focused(A))?.row === 0, "Tab from the heading reaches the first message's Copy, though the row was not shown");
    await waitRow(A, 0, "1");
    const ring = await A.evaluate(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, width: s.outlineWidth }; });
    ok(ring.style !== "none" && ring.width === "3px", `the focused button shows the page's focus ring (${ring.style} ${ring.width})`);
    const clear = await A.evaluate(() => ({ bottom: document.activeElement.getBoundingClientRect().bottom, boxTop: document.querySelector(".hm-box").getBoundingClientRect().top }));
    ok(clear.bottom <= clear.boxTop + 1, `...and it is clear of the box at the bottom of the window (its bottom ${Math.round(clear.bottom)}, the box starts at ${Math.round(clear.boxTop)})`);
    await A.keyboard.press("Tab");
    ok((await focused(A))?.label === "Edit your message" && (await focused(A))?.row === 0, "the next Tab reaches Edit");
    await A.keyboard.press("Tab");
    ok((await focused(A))?.row === -1, "the next one leaves the row");
    await waitRow(A, 0, "0");
    ok(true, "...and the row is hidden again");
    await A.evaluate(() => document.activeElement.blur());

    console.log("  Copy your message: the whole text, and the names do not change");
    await copyBtn(0).click();
    await A.mouse.move(5, 5); // the pointer leaves at once: what keeps the row shown now is the copy, not the hover
    await says(A, 0, /^Message copied$/);
    // (the pointer left before the copy was done, so the row first started to fade and then the copy held it: it is waited for to be whole again, with the pointer not on it)
    ok(await A.waitForFunction(() => { const el = document.querySelector(".chat-u-actions"); return !el.matches(":hover") && el.getAttribute("data-pin") === "true" && getComputedStyle(el).opacity === "1"; }, null, { timeout: 1500 }).then(() => true, () => false), "after the copy the row stays shown for a moment, though the pointer left it");
    ok(await readClip(A) === "glaucoma screening", "Copy puts the message on the clipboard, and one polite status line says 'Message copied'");
    ok(await A.locator(".chat-u").first().locator('[aria-label="Copy your message"] .lucide-check').count() === 1, "the icon turns into a check mark");
    ok(await A.getByRole("button", { name: "Copy your message", exact: true }).count() === 2 && await A.getByRole("button", { name: "Copied" }).count() === 0, "the button's name is the same after the copy (a name that changes is not reliably announced)");
    await waitRow(A, 0, "0");
    await says(A, 0, /^$/);
    ok(true, "...and then hides again, and the status line is empty again");

    console.log("  Copy the answer: the checked answer with its marks, and only the papers it cites");
    const turn1 = A.locator(".chat-turn").first();
    ok(await working(A).count() === 0 && await turn1.getByRole("group", { name: "What to do with this reply" }).isVisible(), "a finished reply has its row of actions, always shown (it is not revealed by hover)");
    await turn1.getByRole("button", { name: "Copy the answer", exact: true }).click();
    await A.waitForFunction(() => /^Answer copied$/.test(document.querySelector(".chat-turn .chat-acts [role=status]")?.textContent ?? ""), null, { timeout: 6000 });
    const answerClip = await readClip(A);
    ok(answerClip.startsWith("The first paper reports its main result [1].\n\nSources\n[1] Rao, A., & Iyer, S. (2021). Deep learning for glaucoma screening from fundus photographs."), `the answer's words and its mark, then 'Sources' and the paper the mark points at, from the paper's own record (got ${JSON.stringify(answerClip.slice(0, 300))})`);
    ok((answerClip.split("\nSources\n")[1] ?? "").split("\n").length === 1 && !/Smartphone|Cost of population|retracted study|Notes on optic/.test(answerClip) && /https:\/\/doi\.org\/10\.1000\/glaucoma\.1$/.test(answerClip), "only the cited paper is listed, with its DOI link");
    ok(await turn1.getByRole("button", { name: "Copy the answer", exact: true }).count() === 1 && await turn1.getByRole("button", { name: "Search again", exact: true }).count() === 1, "'Answer copied' is said politely, the button keeps its name, and a finished reply can be searched again");

    console.log("  Edit: the editor, its keys and its refusals");
    posted.length = 0;
    await editBtn(0).click();
    await ta.waitFor();
    ok(await A.getByRole("textbox", { name: "Edit your message 1" }).count() === 1, "the field is named 'Edit your message 1'");
    ok(await A.evaluate(() => { const t = document.activeElement; return t?.tagName === "TEXTAREA" && t.selectionStart === t.value.length && t.selectionEnd === t.value.length; }), "Edit opens an editor with the focus in it, the caret at the end");
    ok(await ta.inputValue() === "glaucoma screening" && await A.locator(".chat-u").first().locator(".chat-bubble").count() === 0 && await A.locator(".chat-bubble").count() === 1, "it holds the whole text and takes the place of the bubble and its buttons");
    ok(/This replaces 2 later messages\. You can go back to the earlier version\./.test(await A.locator(".chat-edit-hint").innerText()), "before saving it says what is put away: 'This replaces 2 later messages. You can go back to the earlier version.'");
    ok(/^18 \/ 300$/.test(await A.locator(".chat-edit-count").innerText()), "a counter shows the length against the limit of a search chosen by hand (300)");
    await ta.press("Escape");
    await A.locator(".chat-edit").waitFor({ state: "detached" });
    const afterEsc = await focused(A);
    ok(afterEsc?.label === "Edit your message" && afterEsc.row === 0 && await A.locator(".chat-bubble").count() === 2 && posted.length === 0, "Escape closes it, puts the focus back on that message's Edit button, changes nothing and sends nothing");
    await waitRow(A, 0, "1");
    ok(true, "(and the row is shown, so the focused button is not out of sight)");
    await editBtn(0).click();
    await ta.waitFor();
    await ta.evaluate((el) => { for (const key of ["Enter", "Escape"]) el.dispatchEvent(new KeyboardEvent("keydown", { key, isComposing: true, bubbles: true, cancelable: true })); });
    await frames(A);
    ok(await A.locator(".chat-edit").count() === 1 && posted.length === 0, "Enter and Escape that belong to an input method (Hindi is typed that way) neither save nor cancel");
    await ta.press("Shift+Enter");
    ok((await ta.inputValue()).endsWith("\n") && posted.length === 0 && await A.locator(".chat-edit").count() === 1, "Shift+Enter adds a line and sends nothing");
    ok(await editBtn(1).getAttribute("aria-disabled") === "true" && (await A.locator(`[id="${await editBtn(1).getAttribute("aria-describedby")}"]`).innerText()) === "Another message is being edited. Save it, or press Cancel, first.", "while an editor is open, the other messages' Edit is aria-disabled with the reason described (a draft is not lost by opening another editor)");
    await editBtn(1).evaluate((el) => el.click());
    await frames(A);
    ok(await A.locator(".chat-edit").count() === 1 && (await ta.inputValue()).endsWith("\n"), "...and a press on it changes nothing: the editor and its draft stay");
    await ta.fill("a".repeat(301));
    ok(/301 \/ 300/.test(await A.locator(".chat-edit-count").innerText()) && await A.locator(".chat-edit-count").getAttribute("data-over") === "true", "over the limit the counter says so");
    await ta.press("Enter");
    await A.locator(".chat-edit [role=alert]").waitFor();
    ok(/A search is at most 300 characters \(this is 301\)/.test(await A.locator(".chat-edit [role=alert]").innerText()) && (await ta.inputValue()) === "a".repeat(301) && (await ta.getAttribute("aria-invalid")) === "true" && posted.length === 0, "301 characters are refused in an alert, with the limit; the text stays, marked invalid, and nothing is sent");
    ok(await A.evaluate(() => document.activeElement?.tagName === "TEXTAREA"), "(the focus stays in the editor)");
    await ta.fill("glaucoma   screening");
    await ta.press("Enter");
    await A.locator(".chat-edit [role=alert]").waitFor();
    ok(/Nothing has changed/.test(await A.locator(".chat-edit [role=alert]").innerText()) && posted.length === 0, "the same words (spaces aside) are refused: an unchanged answer under unchanged words is not asked for again");
    await ta.fill("x");
    await ta.press("Enter");
    await A.locator(".chat-edit [role=alert]").waitFor();
    ok(/at least two letters or numbers/.test(await A.locator(".chat-edit [role=alert]").innerText()) && await A.locator(".chat-edit").count() === 1, "one letter is refused as it is in the box");
    await ta.fill("glaucoma screening costs");
    ok(await A.locator(".chat-edit [role=alert]").count() === 0, "typing takes the refusal away");

    console.log("  Save and resend: a new reply, the old messages kept as a version");
    let release = () => {};
    hold = new Promise((resolve) => { release = resolve; });
    await ta.fill("glaucoma costs in clinics");
    await ta.press("Enter");
    await working(A).waitFor({ timeout: 10000 });
    await says(A, 0, /^Message sent\. A new answer is being written\.$/);
    ok(true, "'Message sent. A new answer is being written.' is said");
    ok(await A.locator(".chat-edit").count() === 0 && await A.locator(".chat-bubble").count() === 1 && await A.locator(".chat-turn").count() === 1, "Enter saves: the editor goes, and the conversation is the edited question and a new reply (the later messages are put away)");
    ok(posted.length === 1 && posted[0].mode === "search" && posted[0].message === "glaucoma costs in clinics" && !JSON.stringify(posted[0]).includes("diabetic") && !JSON.stringify(posted[0]).includes("glaucoma screening"), "it asks again as a search chosen by hand, with the new words, and nothing of the replaced messages is sent");
    const fAfterSave = await focused(A);
    ok(fAfterSave?.label === "Edit your message" && fAfterSave.row === 0, "the focus is on that message's Edit button (the editor it was in is gone)");
    ok(await editBtn(0).getAttribute("aria-disabled") === "true" && await editBtn(0).evaluate((el) => el.hasAttribute("disabled")) === false, "while the new reply is written Edit is aria-disabled, not disabled (a focused button must stay in the tab order)");
    const whyId = await editBtn(0).getAttribute("aria-describedby");
    ok((await A.locator(`[id="${whyId}"]`).innerText()) === "Wait for the answer, or press Stop.", "...with the reason described: 'Wait for the answer, or press Stop.'");
    ok(await A.locator(`[id="${whyId}"]`).evaluate((el) => el.hidden === true), "(the reason sentence is not in the page's flow: a screen reader in browse mode would read it under every message of a long conversation; the button still has it as its description)");
    ok(await A.locator(".chat-u-actions .chat-act-note").count() === 0, "(no reason is shown until a button is pressed)");
    await editBtn(0).evaluate((el) => el.click());
    await frames(A);
    ok(await A.locator(".chat-edit").count() === 0, "a press on it does nothing");
    await A.locator(".chat-u-actions .chat-act-note").first().waitFor({ timeout: 4000 });
    ok((await A.locator(".chat-u-actions .chat-act-note").first().innerText()) === "Wait for the answer, or press Stop." && (await A.locator(".chat-u-actions .chat-act-note").first().isVisible()), "...but it says why, in words beside the buttons (a dimmed button with no reason is a dead end on a phone, which has no tooltip)");
    await says(A, 0, /^Wait for the answer, or press Stop\.$/);
    ok(true, "...and a screen reader is told on the press, not only when the button has the focus");
    ok(await working(A).getByRole("button", { name: "Copy the answer" }).count() === 0, "a reply that is being written has no Copy the answer (its words are not checked yet)");
    ok(await A.getByRole("group", { name: "Versions of your message" }).count() === 1 && await counter(A) === "2/2" && await A.locator(".chat-u-actions").first().getAttribute("data-hide") === "false", "an edited message has a pager, '2 / 2', in a group of its own, always shown");
    ok(await prev.getAttribute("aria-disabled") === "true", "while a reply is written the pager does not switch (aria-disabled)");
    await prev.evaluate((el) => el.click());
    await frames(A);
    ok(await counter(A) === "2/2" && await A.locator(".chat-bubble").count() === 1, "...and a press on it changes nothing");
    ok(await A.locator(".chat-title").innerText() === "glaucoma costs in clinics" && /glaucoma costs in clinics/.test(await A.locator(".ws-rail .ws-recent").innerText()), "the first message was edited, so the chat's title (and the rail) follows it");
    hold = null;
    release();
    await doneN(A, 1);
    ok(await editBtn(0).getAttribute("aria-disabled") !== "true" && await prev.getAttribute("aria-disabled") !== "true", "when the reply is done Edit and the pager are live again");

    console.log("  the pager: nothing moves but the messages");
    await A.evaluate(() => { document.querySelector(".chat-u").__same = "yes"; });
    await A.evaluate(() => window.scrollTo(0, 0));
    await prev.click();
    await bubbles(A, 2);
    ok(await A.locator(".chat-turn").count() === 2 && /glaucoma screening/.test(await A.locator(".chat-bubble").first().innerText()) && /diabetic retinopathy/.test(await A.locator(".chat-bubble").nth(1).innerText()), "Previous brings the first version back, with the messages that came after it (only that branch is in the page)");
    ok(await A.locator(".chat-title").innerText() === "glaucoma screening", "...and the title that goes with its first message");
    await says(A, 0, /^Version 1 of 2\. The answers below are from this version\.$/);
    ok(true, "the status line says 'Version 1 of 2. The answers below are from this version.'");
    const fPrev = await focused(A);
    ok(fPrev?.label === "Previous version" && fPrev.disabled === "true", "the focus stays on the button that was pressed, which is now aria-disabled at the end");
    ok(await A.evaluate(() => document.querySelector(".chat-u").__same === "yes"), "the message was not made again (it is the same element, so the focus is not lost)");
    ok(await A.evaluate(() => Math.round(window.scrollY)) === 0, "the page did not move: the first question was not scrolled away, nor the last one brought up");
    await A.keyboard.press("Enter");
    await frames(A);
    ok(await counter(A) === "1/2" && (await focused(A))?.label === "Previous version", "Enter on a button at the end does nothing, and the focus stays");
    // from some way down the page, to a page that is shorter (it must still reach that far: a page cannot be scrolled past its end) and back to the longer one
    await next.focus();
    await A.evaluate(() => window.scrollTo(0, 100));
    const y100 = await A.evaluate(() => Math.round(window.scrollY));
    await A.keyboard.press("Enter");
    await bubbles(A, 1);
    const yShort = await A.evaluate(() => Math.round(window.scrollY));
    ok(y100 === 100 && Math.abs(yShort - y100) <= 2, `Next from some way down the page leaves the page where it was (${y100} then ${yShort})`);
    ok(await A.locator(".chat-turn").count() === 1 && await A.locator(".chat-title").innerText() === "glaucoma costs in clinics", "the newer version is back: one question and its reply");
    await prev.focus();
    await A.evaluate(() => window.scrollTo(0, 100));
    await A.keyboard.press("Enter");
    await bubbles(A, 2);
    const yLong = await A.evaluate(() => Math.round(window.scrollY));
    ok(Math.abs(yLong - 100) <= 2, `...and Previous, to the longer page, does not bring the last question up either (${yLong})`);
    await next.focus();
    await A.keyboard.press("Enter");
    await bubbles(A, 1);

    console.log("  a third version, and what is kept in this browser");
    await editBtn(0).click();
    await ta.waitFor();
    ok(!/later message/.test(await A.locator(".chat-edit-hint").innerText()), "(an edit of the last question has no later messages to warn about)");
    await ta.fill("glaucoma costs again");
    await A.getByRole("button", { name: "Save and resend", exact: true }).click();
    await doneN(A, 1);
    ok(await counter(A) === "3/3", "a second edit makes a third version, '3 / 3'");
    await sendA("diabetic retinopathy");
    await doneN(A, 2);
    await faded(A);
    await settled(A);
    await A.reload({ waitUntil: "networkidle" });
    await A.locator(".chat-bubble").first().waitFor({ timeout: 15000 });
    ok(await counter(A) === "3/3" && await A.locator(".chat-bubble").count() === 2, "after a reload the versions are there");
    await prev.click();
    await bubbles(A, 1);
    ok(await counter(A) === "2/3" && /glaucoma costs in clinics/.test(await A.locator(".chat-bubble").innerText()) && await A.locator(".chat-turn .result").count() === 5 && await A.locator(".chat-answer").count() === 1, "...and an earlier one comes back after a reload with its answer and its five papers");
    await says(A, 0, /^Version 2 of 3\./);

    console.log("  accessibility: every state, in light, dark and read");
    // the states: the pager at 2 / 3 (now); then the newest version, which has a second question, for a hovered row, a button reached by the keyboard, and the editor.
    for (const theme of ["light", "dark", "read"]) {
      await setTheme(A, theme);
      await A.mouse.move(5, 5);
      await A.evaluate(() => window.scrollTo(0, 0));
      await calm(A);
      await faded(A);
      await axe(`message actions, ${theme}: the pager at 2 / 3`, A);
      const c = await contrastOf(A.locator(".chat-ver-n"));
      ok(c >= 4.5, `the pager's counter is ${c.toFixed(2)}:1 on its background in ${theme} (4.5 needed)`);
    }
    await setTheme(A, "light");
    await next.click();
    await bubbles(A, 2);
    await faded(A);
    for (const theme of ["light", "dark", "read"]) {
      await setTheme(A, theme);
      await calm(A);
      // (a) the row of the second question, hovered
      await A.evaluate(() => document.activeElement?.blur());
      await A.mouse.move(5, 5);
      await waitRow(A, 1, "0");
      await A.locator(".chat-u").nth(1).hover({ position: { x: 20, y: 10 } });
      await waitRow(A, 1, "1");
      await axe(`message actions, ${theme}: a row shown by hover`, A);
      const rest = await contrastOf(copyBtn(1));
      await copyBtn(1).hover();
      const hot = await contrastOf(copyBtn(1));
      ok(rest >= 3 && hot >= 3, `the icons are ${rest.toFixed(2)}:1 at rest and ${hot.toFixed(2)}:1 hovered in ${theme} (3 needed for an icon; axe cannot read an icon's colour, so it is read here)`);
      // (b) a button reached by the keyboard
      await A.mouse.move(5, 5);
      await copyBtn(1).evaluate((el) => el.focus());
      await A.keyboard.press("Shift+Tab");
      await A.keyboard.press("Tab");
      ok((await focused(A))?.label === "Copy your message", "(a button of the row is focused with the keyboard)");
      await waitRow(A, 1, "1");
      await axe(`message actions, ${theme}: a button focused with the keyboard`, A);
      const sizes = await sizesOf(A.locator(".chat-u-actions button"));
      ok(sizes.length > 0 && sizes.every(([w, h]) => w >= 36 && h >= 36), `every button of the rows is at least 36 by 36 (${sizes.map((s) => s.join("x")).join(", ")})`);
      // (c) the editor open, the caret in it
      await editBtn(1).click();
      await ta.waitFor();
      await faded(A);
      await axe(`message actions, ${theme}: the editor open`, A);
      const b = await borderContrast(ta);
      ok(b >= 3, `the editor's field has a border of ${b.toFixed(2)}:1 against the page in ${theme} (3 needed for the edge of a control)`);
      await ta.press("Escape");
      await A.locator(".chat-edit").waitFor({ state: "detached" });
    }
    await setTheme(A, "light");

    console.log("  the page does not move under the reader while the editor is used");
    await A.setViewportSize({ width: 1360, height: 560 });
    await editBtn(1).click();
    await ta.waitFor();
    await frames(A);
    const typedAt = await A.evaluate(() => Math.round(window.scrollY));
    let moved = 0;
    for (const ch of "and a longer question about the cost of screening in rural clinics") {
      await A.keyboard.type(ch);
      if (await A.evaluate(() => Math.round(window.scrollY)) !== typedAt) moved++;
    }
    for (let i = 0; i < 5; i++) await ta.press("Shift+Enter");
    await frames(A);
    ok(moved === 0 && await A.evaluate(() => Math.round(window.scrollY)) === typedAt, `typing in the editor, and a field that grows to more lines, do not move the page (it moved on ${moved} of 66 letters)`);
    await ta.press("Escape");
    await A.setViewportSize({ width: 1360, height: 900 });
    ok(errors.length === 0, `no console or page error from the actions so far${errors.length ? ": " + errors[0].slice(0, 80) : ""}`);

    console.log("  a message that was sent to Auto: its own limit, and the whole text is copied and edited");
    await newChat();
    const LONG = ("boom " + "sleep and memory ".repeat(30)).trim();
    await sendA(LONG, "Auto");
    await A.waitForFunction(() => /too long for a search/.test(document.querySelector(".chat-turn")?.textContent ?? ""), null, { timeout: 30000 });
    await doneN(A, 1);
    ok(LONG.length > 400 && /characters, the start is shown/.test(await A.locator(".chat-bubble").innerText()), `a message of ${LONG.length} characters is shown by its start`);
    await copyBtn(0).click();
    await says(A, 0, /^Message copied$/);
    ok(await readClip(A) === LONG, "Copy puts the whole message on the clipboard, not the start that is shown");
    await editBtn(0).click();
    await ta.waitFor();
    ok(await ta.inputValue() === LONG && /\/ 20,000/.test(await A.locator(".chat-edit-count").innerText()), "the editor holds the whole message, with the limit of Auto (20,000)");
    await ta.press("Escape");
    posted.length = 0;
    await editBtn(0).click();
    await ta.fill("glaucoma screening in India, the cost");
    await ta.press("Enter");
    await A.locator('.chat-turn[data-status="done"]').waitFor({ timeout: 30000 });
    ok(posted.length === 1 && posted[0].mode === "auto" && posted[0].message === "glaucoma screening in India, the cost" && !JSON.stringify(posted[0]).includes("sleep and memory"), "an edit of a message that was sent to Auto goes to Auto again, with the new words only");

    console.log("  a search made in the Indian sources is edited in the Indian sources");
    await newChat();
    await A.locator(".hm-scope").click();
    posted.length = 0;
    await sendA("glaucoma screening", "Search papers");
    await doneN(A, 1);
    await editBtn(0).click();
    await ta.fill("glaucoma treatment");
    await ta.press("Enter");
    await A.locator('.chat-turn[data-status="done"]').waitFor({ timeout: 30000 });
    ok(posted.length === 2 && posted[1].scope === "india" && posted[1].mode === "search" && /Searched only Indian sources/.test(await A.locator(".chat-turn").innerText()), "the edit looks in the Indian sources again, as the reply it replaced did");
    await A.locator(".hm-scope").click();

    console.log("  background under its label; an open Idea Check is closed by an edit and does not start again by itself");
    await newChat();
    const IDEA = "nothing at all about using bees to detect cancer early";
    await sendA(IDEA, "Search papers");
    await doneN(A, 1);
    const bg = A.locator(".chat-turn").first();
    await bg.locator(".chat-general").waitFor();
    await bg.getByRole("button", { name: "Copy the answer", exact: true }).click();
    await A.waitForFunction(() => /^Answer copied$/.test(document.querySelector(".chat-turn .chat-acts [role=status]")?.textContent ?? ""), null, { timeout: 6000 });
    const bgClip = await readClip(A);
    ok(bgClip.startsWith("General background, not from a paper in your results\n") && !/\[\d/.test(bgClip) && !/Sources/.test(bgClip), "background from general knowledge is copied under its label line, with no source mark and no list of sources");
    posted.length = 0;
    await bg.getByRole("button", { name: "Search again", exact: true }).click();
    await doneN(A, 1);
    ok(posted.length === 1 && posted[0].message === IDEA && await A.locator(".chat-bubble").count() === 1, "Search again on a finished reply asks the same question again in its place, with no new message");
    await A.locator(".chat-change").click();
    await A.getByRole("menuitem", { name: /Idea Check/ }).click();
    await A.locator(".chat-idea textarea").first().waitFor({ timeout: 20000 });
    await editBtn(0).click();
    await ta.waitFor();
    const hint = await A.locator(".chat-edit-hint").innerText();
    ok(/This replaces 1 later message\./.test(hint) && /An Idea Check that is open in them will close\./.test(hint), "the editor names the Idea Check that is open in the messages it would put away");
    await ta.fill(IDEA + " today");
    await A.getByRole("button", { name: "Save and resend", exact: true }).click();
    await doneN(A, 1);
    ok(await A.locator(".chat-idea").count() === 0, "saving closes it");
    await prev.click();
    await A.locator(".chat-idea").waitFor();
    ok(await A.locator(".chat-idea textarea").count() === 0 && await A.locator(".chat-idea").getByRole("button", { name: "Run it again" }).isVisible(), "coming back to it, it offers 'Run it again' and has not started by itself (nothing about an idea was kept)");

    console.log("  the text that comes with an Idea Check has no reply to ask again: it can be copied, not edited");
    await newChat();
    await pick(A, "Idea Check");
    const IDEA2 = "My idea is to detect early glaucoma with a smartphone camera used by health workers in villages";
    await A.locator(".hm-input").fill(IDEA2);
    await A.keyboard.press("Enter");
    await A.locator(".chat-idea").waitFor({ timeout: 20000 });
    ok(await A.locator(".chat-u").count() === 1 && await copyBtn(0).count() === 1 && await editBtn(0).count() === 0, "the idea's text shown as a message has Copy and no Edit");
    await copyBtn(0).click();
    await says(A, 0, /^Message copied$/);
    ok(await readClip(A) === IDEA2, "...and Copy gives the whole idea");
    await newChat();

    await actx.close();

    console.log("  copying when the clipboard API is missing, refuses, or nothing works");
    // these run in the page, before its own scripts: each is a function with no variable of this file in it
    const COPIES = () => { window.__copied = []; document.addEventListener("copy", () => { const f = document.activeElement; window.__copied.push(f && "value" in f ? f.value.substring(f.selectionStart, f.selectionEnd) : ""); }); };
    const WORDS = "glaucoma screening in rural India ".repeat(14).trim();
    const variants = [
      { name: "no clipboard API (a page that is not secure)", init: () => { Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }); }, works: true },
      { name: "writeText rejects (a permission that was refused)", init: () => { navigator.clipboard.writeText = () => Promise.reject(new DOMException("denied", "NotAllowedError")); }, works: true },
      { name: "nothing works", init: () => { navigator.clipboard.writeText = () => Promise.reject(new DOMException("denied", "NotAllowedError")); document.execCommand = () => false; }, works: false },
    ];
    for (const v of variants) {
      const fctx = await newCtx();
      await fctx.addInitScript(`(${COPIES.toString()})();(${v.init.toString()})();`);
      const fp = await fctx.newPage();
      watch(fp);
      await fp.goto(BASE + "/home", { waitUntil: "networkidle" });
      await fp.locator("#hm-h").waitFor({ timeout: 20000 });
      await fp.locator(".hm-input").fill(WORDS);
      await fp.keyboard.press("Enter");
      await fp.locator('.chat-turn[data-status="done"]').waitFor({ timeout: 30000 });
      await fp.getByRole("button", { name: "Copy your message", exact: true }).click();
      if (v.works) {
        await fp.waitForFunction(() => /^Message copied$/.test(document.querySelector(".chat-u > [role=status]")?.textContent ?? ""), null, { timeout: 6000 });
        const got = await fp.evaluate(() => window.__copied);
        ok(got.length === 1 && got[0] === WORDS && WORDS.length > 400, `${v.name}: the fallback copies the whole ${WORDS.length} characters, and says 'Message copied'`);
        ok((await focused(fp))?.label === "Copy your message", "...and the focus is back on the button (selecting the text moved it)");
      } else {
        await fp.waitForFunction(() => /Could not copy\. Select the text and copy it\./.test(document.querySelector(".chat-u > [role=status]")?.textContent ?? ""), null, { timeout: 6000 });
        ok(/Could not copy\. Select the text and copy it\./.test(await fp.locator(".chat-act-note").innerText()) && !/Ctrl|press/i.test(await fp.locator(".chat-act-note").innerText()) && await fp.locator(".chat-u .lucide-check").count() === 0, `${v.name}: it says so in words (with no key a touch screen does not have), on the page and to a screen reader, and does not show a check mark`);
      }
      await fctx.close();
    }

    console.log("  a touch screen: always shown, large enough, nothing sideways");
    const tctx = await newCtx({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ["clipboard-read", "clipboard-write"] });
    const tp = await tctx.newPage();
    watch(tp);
    await tp.goto(BASE + "/home", { waitUntil: "networkidle" });
    await tp.locator("#hm-h").waitFor({ timeout: 20000 });
    if (!(await tp.evaluate(() => matchMedia("(hover: none)").matches))) {
      console.log("  note: this browser does not match (hover: none) for a touch context; the touch checks are skipped");
    } else {
      await tp.locator(".hm-input").fill("glaucoma screening");
      await tp.keyboard.press("Enter");
      await tp.locator('.chat-turn[data-status="done"]').waitFor({ timeout: 30000 });
      await faded(tp);
      ok(await rowOpacity(tp, 0) === "1", "with no hover to be had the row under the message is always shown");
      const touchSizes = await sizesOf(tp.locator(".chat-u-actions button"));
      ok(touchSizes.length === 2 && touchSizes.every(([w, h]) => w >= 36 && h >= 36), `its buttons are at least 36 by 36 (${touchSizes.map((s) => s.join("x")).join(", ")})`);
      ok(await noSideways(tp), "nothing scrolls sideways");
      await axe("message actions, a touch screen", tp);
      await tp.locator(".chat-turn").getByRole("button", { name: "Copy the papers", exact: true }).tap();
      await tp.waitForFunction(() => /^Papers copied$/.test(document.querySelector(".chat-turn .chat-acts [role=status]")?.textContent ?? ""), null, { timeout: 6000 });
      const lines = (await readClip(tp)).split("\n");
      ok(lines.length === 5 && lines.every((l, i) => l.startsWith(`[${i + 1}] `)) && lines.filter((l) => l.endsWith("(retracted)")).length === 1, "a reply with no written answer (the reader is not signed in) copies its papers: five numbered lines, the retracted one marked as such");
      await tp.getByRole("button", { name: "Edit your message", exact: true }).tap();
      await tp.locator(".chat-edit-ta").waitFor();
      ok(/\/ 20,000/.test(await tp.locator(".chat-edit-count").innerText()), "Edit works by touch, with Auto's limit (this message went to Auto)");
      const editSizes = await sizesOf(tp.locator(".chat-edit button"));
      ok(editSizes.length === 2 && editSizes.every(([w, h]) => w >= 40 && h >= 40) && await noSideways(tp), `Cancel and Save and resend are large (${editSizes.map((s) => s.join("x")).join(", ")}) and the editor fits the screen`);
      await faded(tp);
      await axe("message actions, a touch screen: the editor", tp);
      await tp.locator(".chat-edit-ta").fill("diabetic retinopathy screening");
      await tp.getByRole("button", { name: "Save and resend", exact: true }).tap();
      await tp.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="done"]').length === 1 && !document.querySelector('.chat-turn[data-status="working"]') && /diabetic/.test(document.querySelector(".chat-bubble")?.textContent ?? ""), null, { timeout: 30000 });
      await faded(tp);
      ok(await counter(tp) === "2/2", "an edit by touch makes a version, and the pager shows");
      const pagerSizes = await sizesOf(tp.locator(".chat-ver button"));
      ok(pagerSizes.length === 2 && pagerSizes.every(([w, h]) => w >= 36 && h >= 36) && await noSideways(tp), `the pager's buttons are large enough too (${pagerSizes.map((s) => s.join("x")).join(", ")})`);
      await axe("message actions, a touch screen: the pager", tp);
    }
    await tctx.close();

    console.log("  reduced motion");
    const rctx = await newCtx({ reducedMotion: "reduce", permissions: ["clipboard-read", "clipboard-write"] });
    const rp = await rctx.newPage();
    watch(rp);
    await rp.goto(BASE + "/home", { waitUntil: "networkidle" });
    await rp.locator("#hm-h").waitFor({ timeout: 20000 });
    await rp.locator(".hm-input").fill("glaucoma screening");
    await rp.keyboard.press("Enter");
    await rp.locator('.chat-turn[data-status="done"]').waitFor({ timeout: 30000 });
    await rp.mouse.move(5, 5);
    await waitRow(rp, 0, "0");
    await rp.locator(".chat-u").first().hover({ position: { x: 20, y: 10 } });
    await waitRow(rp, 0, "1");
    ok(true, "the row is still shown by hover with reduced motion");
    await rp.getByRole("button", { name: "Copy your message", exact: true }).click();
    await rp.waitForFunction(() => /^Message copied$/.test(document.querySelector(".chat-u > [role=status]")?.textContent ?? ""), null, { timeout: 6000 });
    const draw = await rp.locator(".chat-u .lucide-check path").first().evaluate((el) => getComputedStyle(el).animationName);
    ok(await rp.locator(".chat-u .lucide-check").count() === 1 && draw === "none", `the check mark appears without being drawn (animation: ${draw})`);
    await rctx.close();
  };
  /* ============================ context between messages ============================
     (docs/design/chat-actions-context.md, section 5.) What the page sends with a message in Auto so that a follow-up can be understood, and what it shows of it, against the offline stand-ins. They read a
     follow-up by the words of the CURRENT message only: 'only after 2022' is a year range, 'explain that simpler' asks for the same papers again, 'and in children?' refines the earlier topic. The stand-in
     papers are from 2021, 2022, 2019 (retracted), 2018 (no abstract) and 2020. What /api/v1/chat was sent is captured (`posted`) and compared whole: what is in it, and, as much, what never is.
     Runs in a context of its own, so it can be run alone: CHAT_ONLY=context node e2e/chat.mjs <baseUrl>. */
  const context = async () => {
    console.log("context between messages: what is sent, what is shown");
    const cx = await newCtx();
    const C = await cx.newPage();
    watch(C);
    /** What the page sent to /api/v1/chat: the text as it was sent, and parsed. */
    const posted = [];
    C.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/v1/chat") posted.push({ raw: r.postData() ?? "", body: JSON.parse(r.postData() ?? "{}") }); });
    /** The next requests that carry earlier turns are refused as a server does that cannot take them (400 invalid_history): as many as this says. */
    let refuse = 0;
    /** While true, the earlier turns are taken out of the request on its way to the Worker: a server that does not read them (CHAT_CONTEXT=off, which one local Worker cannot be switched to; or a Worker older than the page). `posted` still has what the page sent. */
    let ignore = false;
    await C.route("**/api/v1/chat", async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      if (refuse > 0 && body.history) {
        refuse--;
        return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ type: "invalid_history", title: "The earlier messages could not be used", detail: "The order of the earlier messages must be a question, then its reply, from the oldest." }) });
      }
      if (ignore && body.history) {
        delete body.history;
        return route.continue({ postData: JSON.stringify(body) });
      }
      return route.continue();
    });
    await C.goto(BASE + "/", { waitUntil: "networkidle" });
    await C.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
    await C.getByRole("button", { name: "Continue with Google" }).last().click();
    await C.locator("#hm-h").waitFor({ timeout: 20000 });
    const sendC = async (text, tool = "Auto") => {
      await C.waitForFunction(() => !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 30000 });
      await pick(C, tool);
      await C.locator(".hm-input").fill(text);
      await C.keyboard.press("Enter");
    };
    const turnN = (i) => C.locator(".chat-turn").nth(i);
    /** Deep equality that says what differed (the bodies are compared whole). */
    const same = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch { console.log("        expected", JSON.stringify(b), "\n        got     ", JSON.stringify(a)); return false; } };
    const roles = (h) => h.map((e) => e.role).join(",");
    const bodyHas = (i, s) => posted[i].raw.includes(s);
    /** Waits until the i-th reply is finished (the page marks it). */
    const turnDone = (i) => C.waitForFunction((i) => document.querySelectorAll(".chat-turn")[i]?.getAttribute("data-status") === "done", i, { timeout: 30000 });
    /** Waits until the page has sent n requests (counted from the last time `posted` was emptied): a press is done when its request has left, and the reply it replaced is no longer the one on the screen. */
    const asked = async (n) => {
      const t = Date.now();
      while (posted.length < n) {
        if (Date.now() - t > 15000) throw new Error(`timed out waiting for request ${n}`);
        await new Promise((r) => setTimeout(r, 50));
      }
    };
    const Q1 = "glaucoma screening in India";
    const PAPER_2021 = { n: 1, title: "Deep learning for glaucoma screening from fundus photographs", year: 2021 };
    const PAPER_2022 = { n: 1, title: "Smartphone-based retinal imaging in rural clinics", year: 2022 };
    const ANSWER = "The first paper reports its main result.";

    console.log("  a first message, and a search chosen by hand, send nothing of the kind");
    await sendC(Q1);
    await doneN(C, 1);
    ok(posted.length === 1 && posted[0].raw === `{"mode":"auto","message":"${Q1}"}`, `the first message of a chat is exactly what it was before there was any context (${posted[0]?.raw})`);
    ok(await C.locator(".chat-ctx, .chat-chip").count() === 0, "and a message nothing was read for says nothing about context");

    console.log("  a follow-up: the question, its reply, and the papers the answer cited");
    await sendC("only after 2022");
    await doneN(C, 2);
    ok(posted.length === 2 && posted[1].body.mode === "auto" && posted[1].body.message === "only after 2022" && Object.keys(posted[1].body).join() === "mode,message,history", "the follow-up goes to Auto with its own words, and the earlier turns as `history`, last");
    ok(same(posted[1].body.history, [{ role: "user", text: Q1 }, { role: "assistant", language: "en", papers: [PAPER_2021], text: ANSWER }]), "history is the question, then its reply: the language, the one paper the answer cited (with its year), the answer's words without the mark [1]; no abstract, no author, no link");
    const t2 = turnN(1);
    ok(await t2.locator(".chat-ctx").count() === 1 && (await t2.locator(".chat-ctx").innerText()) === `Using your earlier question: ${Q1} only after 2022 · Use these exact words`, "the reply says what it was read as: 'Using your earlier question: ...', with a way to search exactly that");
    ok(/I searched for:\s*glaucoma screening in India/.test(await t2.locator(".chat-searched").nth(1).innerText()) && !/only after/.test(await t2.locator(".chat-searched").nth(1).innerText()) && await t2.locator(".chat-searched").nth(1).getByRole("button").count() === 0, "(the 'I searched for' line is still there, and has no button of its own beside it: one way back to exact words, not two)");
    ok(await t2.locator(".chat-chip").count() === 1 && (await t2.locator(".chat-chip").innerText()).trim() === "Papers from 2022 or later" && await t2.getByRole("button", { name: "Remove the year filter (papers from 2022 or later) and search again", exact: true }).count() === 1, "the year range that cut the papers is a chip, with a remove button that says what it removes and that it searches again");
    ok(await t2.locator(".result").count() === 1 && /Smartphone-based retinal imaging/.test(await t2.locator(".result").innerText()), "the list is cut to the one paper from 2022 or later, and numbered after the cut");
    ok(/Only 1 of the papers found is from 2022 or later/.test(await t2.locator(".chat-note").innerText()) && await t2.locator(".chat-note button").count() === 0, "the short list is said to be short, and that notice has no 'Search again' of its own (that would be the same list)");
    ok(await t2.getByRole("button", { name: "Search again", exact: true }).count() === 1, "(the reply's own row still has Search again)");
    ok(await turnN(0).locator(".chat-ctx, .chat-chip").count() === 0, "the first reply has none of it");

    console.log("  the next follow-up: the last three turns, and only the last reply's words");
    await sendC("and in children?");
    await doneN(C, 3);
    ok(same(posted[2].body.history, [{ role: "user", text: Q1 }, { role: "assistant", language: "en", papers: [PAPER_2021] }, { role: "user", text: "only after 2022" }, { role: "assistant", searchQuery: Q1, language: "en", papers: [PAPER_2022], text: ANSWER, yearFrom: 2022 }]), "two turns: only the LAST reply has its words; the second one has what it searched, the paper it cited and the year range it was limited to (so 'the same papers' are the papers that were shown)");
    ok(await turnN(2).locator(".chat-chip").count() === 0 && /Using your earlier question: .*and in children\?/.test(await turnN(2).locator(".chat-ctx").innerText()), "a refinement with no years has no chip, and says what it was read as");

    console.log("  accessibility: the line, the chip and its button, in light, dark and read, and on a phone");
    await C.mouse.move(5, 5);
    for (const theme of ["light", "dark", "read"]) {
      await setTheme(C, theme);
      await C.evaluate(() => window.scrollTo(0, 0));
      await calm(C);
      await faded(C);
      await axe(`context between messages, ${theme}: the line, the chip and the notice`, C);
      const chipText = await contrastOf(t2.locator(".chat-chip"));
      const chipIcon = await contrastOf(t2.locator(".chat-chip-x"));
      const link = await contrastOf(t2.getByRole("button", { name: "Use these exact words" }));
      ok(chipText >= 4.5 && chipIcon >= 4.5 && link >= 4.5, `in ${theme}: the chip's words are ${chipText.toFixed(2)}:1, its remove icon ${chipIcon.toFixed(2)}:1 (axe cannot read an icon's colour), the link-button ${link.toFixed(2)}:1 (4.5 for all three)`);
      const x = await sizesOf(t2.locator(".chat-chip-x"));
      ok(x.length === 1 && x[0][0] >= 24 && x[0][1] >= 24, `the remove button is ${x[0]?.join("x")} (WCAG 2.2 asks for 24 by 24 at least)`);
    }
    await setTheme(C, "light");
    for (const width of [390, 320]) {
      await C.setViewportSize({ width, height: 800 });
      await C.evaluate(() => window.scrollTo(0, 0));
      await calm(C);
      ok(await noSideways(C), `at ${width} px the page does not scroll sideways, with the line and the chip in it`);
      await axe(`context between messages, ${width} px wide`, C);
    }
    await C.setViewportSize({ width: 1360, height: 900 });

    console.log("  Search again on an old reply, and an edit of an earlier message, are sent with what came BEFORE that message");
    posted.length = 0;
    await t2.getByRole("button", { name: "Search again", exact: true }).click();
    await asked(1);
    await focusOnReply(C, 1);
    ok(true, "Search again: the button is gone with the old reply, and the focus is on the new one (not on the body)");
    await turnDone(1);
    ok(posted.length === 1 && posted[0].body.mode === "auto" && posted[0].body.message === "only after 2022" && same(posted[0].body.history, [{ role: "user", text: Q1 }, { role: "assistant", language: "en", papers: [PAPER_2021], text: ANSWER }]) && !bodyHas(0, "children"), "Search again on the second reply asks the same words in Auto with the turns before ITS question (the first turn, with its words as it is then the last), and nothing of the later turn 'and in children?'");
    ok(await C.locator(".chat-bubble").count() === 3, "(no new message: it is asked again in its place)");
    await doneN(C, 3);

    posted.length = 0;
    await C.locator(".chat-u").nth(1).hover({ position: { x: 20, y: 10 } });
    await C.locator(".chat-u").nth(1).getByRole("button", { name: "Edit your message", exact: true }).click();
    const ta = C.locator(".chat-edit-ta");
    await ta.fill("only after 2020");
    await ta.press("Enter");
    await C.waitForFunction(() => !document.querySelector(".chat-edit"), null, { timeout: 8000 });
    await doneN(C, 2);
    ok(posted.length === 1 && posted[0].body.message === "only after 2020" && same(posted[0].body.history, [{ role: "user", text: Q1 }, { role: "assistant", language: "en", papers: [PAPER_2021], text: ANSWER }]) && !bodyHas(0, "children") && !bodyHas(0, "2022"), "an edit of the second message is sent with the first turn only: nothing at or after the edited message, and nothing of the words or replies it replaced");
    const t2e = turnN(1);
    ok((await t2e.locator(".chat-chip").innerText()).trim() === "Papers from 2020 or later" && await t2e.locator(".result").count() === 3, "the edited message is read again: 2020 or later leaves three of the five papers");
    ok(await C.locator(".chat-ver-n").innerText().then((t) => t.replace(/\s+/g, "")) === "2/2" && await C.locator(".chat-bubble").count() === 2, "(and the replaced version, with the later turn, is kept one press away)");

    console.log("  taking the year filter off searches the topic as written, with no earlier turns, and is what later messages are sent with");
    posted.length = 0;
    const chip = t2e.getByRole("button", { name: "Remove the year filter (papers from 2020 or later) and search again", exact: true });
    ok((await chip.getAttribute("title")) === "Remove the year filter and search again", "(the chip's X also says, as a tooltip, that it searches again)");
    await chip.focus();
    await C.keyboard.press("Enter");
    await asked(1);
    // the button that had the focus is gone with the reply it was on: the focus is on the reply itself (a named group), not on the page's body
    await focusOnReply(C, 1);
    await turnDone(1);
    ok((await focusedReply(C)) === "Reply" && await C.evaluate(() => document.activeElement !== document.body), "the focus is still on that reply when it is ready (its name has lost 'being written'), and a screen reader hears 'Reply'");
    ok(posted.length === 1 && posted[0].raw === `{"mode":"search","message":"${Q1}"}`, `removing the chip (with the keyboard) searches the words the indexes were asked, as a search chosen by hand, and sends no history (${posted[0]?.raw})`);
    ok(await t2e.locator(".result").count() === 5 && await t2e.locator(".chat-chip, .chat-ctx").count() === 0 && /Searching papers, as you chose/.test(await t2e.innerText()) && new RegExp(`I searched for:\\s*${Q1}$`).test(await t2e.locator(".chat-searched").innerText()), "the list is whole again (five papers), there is no chip, and the reply says what was searched, since it is not what the bubble above says");

    posted.length = 0;
    await t2e.getByRole("button", { name: "Search again", exact: true }).click();
    await asked(1);
    await turnDone(1);
    ok(posted.length === 1 && posted[0].raw === `{"mode":"search","message":"${Q1}"}`, `Search again on a search made from other words than the bubble asks THOSE words again, not 'only after 2020' (${posted[0]?.raw})`);

    console.log("  'explain that simpler': the same papers, from the anchor the last reply searched, and the last answer's words are read");
    posted.length = 0;
    await sendC("explain that simpler");
    await doneN(C, 3);
    ok(same(posted[0].body.history, [{ role: "user", text: Q1 }, { role: "assistant", language: "en", papers: [PAPER_2021] }, { role: "user", text: "only after 2020" }, { role: "assistant", searchQuery: Q1, language: "en", papers: [PAPER_2021], text: ANSWER }]), "the reply made from other words than the bubble is sent with what it searched (the anchor), not with 'only after 2020' as if that had been searched");
    const t3 = turnN(2);
    ok(/said again in simpler words/.test(await t3.locator(".chat-answer").innerText()), "the server read the last answer's words from it and used them for the same papers (the stand-in says so in its answer)");
    ok(await t3.locator(".chat-ctx").count() === 1 && await t3.locator(".chat-ctx").getByRole("button").count() === 0 && /I searched for:\s*glaucoma screening in India/.test(await t3.locator(".chat-searched").nth(1).innerText()) && !/only after/.test(await t3.locator(".chat-searched").nth(1).innerText()), "it says what it was read as, with no 'exact words' (an instruction searched as it stands finds nothing), and what the papers were searched with");

    console.log("  'Use these exact words' on a refinement: the standalone question, as a search chosen by hand");
    await sendC("and in children?");
    await doneN(C, 4);
    posted.length = 0;
    const exactBtn = turnN(3).getByRole("button", { name: "Use these exact words", exact: true });
    const standalone = (await turnN(3).locator(".chat-ctx b").innerText()).trim();
    await exactBtn.click();
    await asked(1);
    await focusOnReply(C, 3);
    await turnDone(3);
    ok(posted.length === 1 && posted[0].body.mode === "search" && posted[0].body.message === standalone && Object.keys(posted[0].body).join() === "mode,message" && /children/.test(standalone), "it searches the question the reply says it was read as (the person's own 'and in children?' means nothing alone), and sends no history");
    ok(await turnN(3).locator(".chat-ctx").count() === 0 && new RegExp("I searched for:\\s*" + standalone.replace(/[?]/g, "\\?")).test(await turnN(3).locator(".chat-searched").innerText()), "and the reply says what it searched");

    console.log("  a search chosen by hand sends no history, even in a chat that has some");
    posted.length = 0;
    await sendC("glaucoma costs", "Search papers");
    await doneN(C, 5);
    ok(posted.length === 1 && posted[0].raw === '{"mode":"search","message":"glaucoma costs"}', `the body of a search chosen by hand is what it always was (${posted[0]?.raw})`);

    console.log("  what is never sent: a long paste, an Idea Check, a message taken for another tool");
    const PASTE = `LONGPASTE-CANARY ${"glaucoma screening cost review in rural clinics, ".repeat(10)}`;
    await sendC(PASTE);
    await C.waitForFunction(() => !document.querySelector('.chat-turn[data-status="working"]') && document.querySelectorAll(".chat-turn").length === 6, null, { timeout: 30000 });
    await sendC("IDEAOFFERCANARY my idea about bees to detect cancer, is it novel");
    await C.locator(".chat-offer").waitFor({ timeout: 20000 });
    await sendC("IDEACHECKCANARY my idea is to use drones to screen for glaucoma in remote villages, is it new?", "Idea Check");
    await C.locator(".chat-idea").waitFor({ timeout: 20000 });
    posted.length = 0;
    await sendC("only after 2019");
    await C.waitForFunction(() => !document.querySelector('.chat-turn[data-status="working"]') && document.querySelectorAll(".chat-turn").length === 8, null, { timeout: 30000 });
    const h = posted[0].body.history ?? [];
    ok(posted.length === 1 && h.length > 0 && h.length <= 6 && h.length % 2 === 0 && h[0].role === "user" && roles(h) === "user,assistant,user,assistant,user,assistant".slice(0, roles(h).length), "the follow-up after all of that is sent with a history that is still a question, then its reply, in order, at most three turns");
    ok(!bodyHas(0, "LONGPASTE-CANARY") && !bodyHas(0, "IDEAOFFERCANARY") && !bodyHas(0, "IDEACHECKCANARY") && !bodyHas(0, "bees") && !bodyHas(0, "drones"), "and nothing of the pasted text, of the idea the box offered to Idea Check, or of the idea that was checked is in it: not as a question, not by its start");
    ok(h.filter((e) => e.role === "user").every((e) => e.text.length <= 300), "(every question in it is at most 300 characters)");

    console.log("  a server that refuses the earlier turns: the message is sent again without them, once");
    posted.length = 0;
    refuse = 1;
    await sendC("and in men?");
    await C.waitForFunction(() => !document.querySelector('.chat-turn[data-status="working"]') && document.querySelectorAll(".chat-turn").length === 9, null, { timeout: 30000 });
    ok(posted.length === 2 && !!posted[0].body.history && posted[1].raw === '{"mode":"auto","message":"and in men?"}' && refuse === 0, `the first try had the history and was refused (400 invalid_history); the second is the message alone, as a first message (${posted[1]?.raw})`);
    ok(await C.locator('.chat-turn[data-status="done"]').count() === 9 && await C.locator('.chat-turn[data-status="error"]').count() === 0, "and the reply is an answer, not an error");
    // the browser logs every 400 it gets as a console error: the one this step caused is expected, and is taken out of what the end of the suite counts (any other is still counted)
    const caused = errors.filter((e) => /status of 400/.test(e));
    ok(caused.length === 1, `the browser logged exactly the one 400 that this step caused (${caused.length})`);
    for (const e of caused) errors.splice(errors.indexOf(e), 1);

    console.log("  a server that does not read the earlier turns (the switch CHAT_CONTEXT=off, or an older Worker): the follow-up is a plain search and nothing breaks");
    posted.length = 0;
    ignore = true;
    await sendC("only after 2018");
    await C.waitForFunction(() => !document.querySelector('.chat-turn[data-status="working"]') && document.querySelectorAll(".chat-turn").length === 10, null, { timeout: 30000 });
    ignore = false;
    ok(posted.length === 1 && !!posted[0].body.history, "the page cannot know: it sent the turns as it always does");
    ok(await turnN(9).getAttribute("data-status") === "done" && await turnN(9).locator(".chat-ctx, .chat-chip").count() === 0 && await turnN(9).locator(".result").count() > 0, "the reply is a finished search with papers, and it says nothing of context (none was read), not even a failure");

    console.log("  the conversation after reload keeps what the reply was read as");
    await settled(C);
    await C.reload({ waitUntil: "networkidle" });
    await C.locator(".chat-list").waitFor({ timeout: 15000 });
    ok(await C.locator(".chat-ctx").count() >= 2 && await C.locator(".chat-ctx b").first().innerText().then((t) => t.trim().length > 0), "after a reload the lines that say what a reply was read as are still there");

    console.log("  a new chat has no memory of the old one");
    posted.length = 0;
    await C.locator(".chat-head").getByRole("button", { name: "New chat" }).click();
    await C.locator(".hm-title").waitFor();
    await sendC("only after 2020");
    await doneN(C, 1);
    ok(posted.length === 1 && posted[0].raw === '{"mode":"auto","message":"only after 2020"}', `the first message of another chat carries nothing of the first (${posted[0]?.raw})`);
    await cx.close();
  };
  /* ============================ chat to chat ============================
     (docs/design/chat-actions-context.md, section 6.) Whose chats they are (a session that ends without a sign-out, another person on the same browser, another tab), the few words kept with each
     chat, the switch "Use my earlier chats" (off unless turned on), the chat chosen to continue from, a private chat, and, for every state of them, what /api/v1/chat was SENT: the body is compared
     whole, and what must never be in it is looked for in everything the page sent. The stand-in model reads a follow-up by the current message's words only, and says how many earlier-chat questions it
     read, which is what the page shows. Runs in contexts of its own, so it can be run alone: CHAT_ONLY=memory node e2e/chat.mjs <baseUrl>. */
  const memory = async () => {
    console.log("chat to chat: whose chats they are, the words kept, the switch, the chip, what is sent");
    const mx = await newCtx();
    const M = await mx.newPage();
    watch(M);
    /** What the page sent to /api/v1/chat since the last time `posted` was emptied, and everything it ever sent (for what must never be in any of it). */
    const posted = [];
    const everything = [];
    const record = (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/v1/chat") { const x = { raw: r.postData() ?? "", body: JSON.parse(r.postData() ?? "{}") }; posted.push(x); everything.push(x); } };
    M.on("request", record);
    const signInVia = async (p) => {
      await p.goto(BASE + "/", { waitUntil: "networkidle" });
      await p.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
      await p.getByRole("button", { name: "Continue with Google" }).last().click();
      await p.locator("#hm-h").waitFor({ timeout: 20000 });
    };
    const sendM = async (text, tool = "Search papers") => {
      await M.waitForFunction(() => !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 30000 });
      await pick(M, tool);
      await M.locator(".hm-input").fill(text);
      await M.keyboard.press("Enter");
    };
    const fresh = async () => { await M.locator(".ws-rail").getByRole("button", { name: "New chat" }).click(); await M.locator(".hm-title").waitFor(); };
    const rowOf = (title) => M.locator(".ws-recent li").filter({ hasText: title });
    const dropChat = async (title) => { await rowOf(title).getByRole("button", { name: `Delete the chat ${title}` }).click({ force: true }); await M.waitForFunction((t) => ![...document.querySelectorAll(".ws-recent li")].some((li) => li.textContent.includes(t)), title, { timeout: 8000 }); };
    const turnDoneM = (i) => M.waitForFunction((i) => document.querySelectorAll(".chat-turn")[i]?.getAttribute("data-status") === "done", i, { timeout: 30000 });
    const askedM = async (n) => { const t = Date.now(); while (posted.length < n) { if (Date.now() - t > 15000) throw new Error(`timed out waiting for request ${n}`); await new Promise((r) => setTimeout(r, 50)); } };
    /** A chat made by one search chosen by hand, and left: a chat of the person's own to be drawn on later. */
    const makeChat = async (text, tool = "Search papers") => { await fresh(); await sendM(text, tool); await doneN(M, 1); };
    const probe = async (text, tool = "Auto") => { posted.length = 0; await fresh(); await sendM(text, tool); await askedM(1); await doneN(M, 1); return posted[0]; };
    const same = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch { console.log("        expected", JSON.stringify(b), "\n        got     ", JSON.stringify(a)); return false; } };
    const store = (p) => p.evaluate(async () => ({
      raw: localStorage.getItem("scholar.chats.v1"),
      pref: localStorage.getItem("scholar.earlier"),
      active: sessionStorage.getItem("scholar.chat.active"),
      records: await new Promise((resolve) => { const r = indexedDB.open("scholar"); r.onerror = () => resolve(-1); r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains("chats")) return resolve(0); const c = db.transaction("chats").objectStore("chats").count(); c.onsuccess = () => resolve(c.result); }; }),
    }));
    const entries = async (p) => JSON.parse((await store(p)).raw ?? "[]");
    const goSettings = async (p = M) => { await p.locator(".ws-rail").getByRole("link", { name: "Settings" }).click(); await p.getByRole("heading", { name: "Chats" }).waitFor(); };
    const goHome = async (p = M) => { await p.locator(".ws-rail").getByRole("link", { name: "Home", exact: true }).click(); await p.locator("#hm-h").waitFor(); };
    const sw = (p = M) => p.getByRole("switch", { name: "Use my earlier chats", exact: true });
    /** The switch is pressed to the state asked for (a switch already there is left alone). */
    const setSwitch = async (on) => { if ((await sw().isChecked()) !== on) await sw().click(); await M.waitForFunction((on) => document.querySelector('input[role="switch"]')?.checked === on, on, { timeout: 5000 }); };
    const asks = (x) => (x.body.earlier ?? []).map((e) => e.question);

    await signInVia(M);
    const meId = await M.evaluate(() => fetch("/api/v1/auth/me", { credentials: "same-origin" }).then((r) => r.json()).then((j) => j.user.id));
    ok(typeof meId === "string" && meId.length > 0, "signed in (the account has an id, which is what each chat is stamped with)");

    console.log("  the account: each chat is stamped with its owner, and the words kept with it are the person's own");
    const PASTE = `PASTECANARY ${"glaucoma screening cost review in rural clinics, ".repeat(10)}`;
    await makeChat("diabetes in children");
    await makeChat("glaucoma screening in India");
    await makeChat("metformin in pregnancy");
    await makeChat("diabetes me exercise ka kya asar hota hai", "Auto");
    await fresh();
    await sendM("IDEACANARY my idea is to use drones for glaucoma screening in remote villages, is it new?", "Idea Check");
    await M.locator(".chat-idea").waitFor({ timeout: 20000 });
    await makeChat(PASTE, "Auto");
    await settled(M);
    let st = await store(M);
    let idx = JSON.parse(st.raw);
    ok(idx.length === 6 && idx.every((e) => e.owner === meId), `all six chats are stamped with the signed-in person's id (${idx.map((e) => (e.owner ?? "none").slice(0, 6)).join(",")})`);
    const kwOf = (title) => idx.find((e) => e.title.startsWith(title))?.kw ?? "";
    ok(/\bdiabetes\b/.test(kwOf("diabetes in children")) && /\bchildren\b/.test(kwOf("diabetes in children")), `the words kept with a chat are from the question (${kwOf("diabetes in children")})`);
    ok(!/reports|main|result|paper/.test(idx.map((e) => e.kw ?? "").join(" ")), "...and none of them is from an answer (the stand-in's answer says 'The first paper reports its main result')");
    ok(/translated/.test(kwOf("diabetes me exercise")) && /exercise/.test(kwOf("diabetes me exercise")), "the English words a search used are kept too");
    ok(!/IDEACANARY|drones|PASTECANARY/i.test(idx.map((e) => e.kw ?? "").join(" ")) && idx.find((e) => e.title.startsWith("IDEACANARY"))?.kw === undefined, "nothing of an Idea Check, or of a pasted text, is in the words that are kept (a chat of only an idea has no words at all)");
    ok(JSON.stringify(idx.map((e) => Object.keys(e).sort().join())).includes("id,kw,owner,title,updatedAt"), "an entry is its id, title, time, owner and words, and nothing else");

    console.log("  the switch: off unless it is turned on, and what is sent is exactly what it always was");
    await goSettings();
    const chatsSec = M.locator(".settings-sec", { has: M.getByRole("heading", { name: "Chats" }) });
    ok(await sw().count() === 1 && !(await sw().isChecked()) && (await sw().getAttribute("role")) === "switch", "Settings has a switch named 'Use my earlier chats' under Chats, and it is off");
    ok(/Off unless you turn it on/.test(await chatsSec.innerText()) && /never their answers, ideas or lists/i.test(await chatsSec.innerText()) && /earlier versions of a question you edited/.test(await chatsSec.innerText()), "its help line says it is off unless turned on, and what is never used; the Chats paragraph says earlier versions are kept");
    ok((await store(M)).pref === null, "nothing is stored while it is off");
    await goHome();
    let x = await probe("and in children?");
    ok(x.raw === '{"mode":"auto","message":"and in children?"}', `off: a follow-up that shares a word with an earlier chat is sent with nothing of it (${x.raw})`);
    await dropChat("and in children?");

    console.log("  the switch, on: only questions and their search words, from related chats, with a line on the answer that used them");
    await goSettings();
    await setSwitch(true);
    ok((await store(M)).pref === meId, "turned on, it is remembered on this device, as the id of the person who turned it on");
    await M.reload({ waitUntil: "networkidle" });
    await goSettings();
    ok(await sw().isChecked(), "after a reload it is still on");
    await goHome();
    x = await probe("and in children?");
    ok(Object.keys(x.body).join() === "mode,message,earlier" && same(x.body.earlier, [{ question: "diabetes in children" }]), "on, a short follow-up that shares a word with one chat is sent with that chat's question, and only that: 'question' (the stand-in searched it as written, so no search words)");
    const rep = M.locator(".chat-turn").first();
    ok(await rep.locator(".chat-earlier").count() === 1 && (await rep.locator(".chat-earlier").innerText()).startsWith("Used from your earlier chat: diabetes in children") && await rep.locator(".chat-earlier").getByRole("button", { name: "Do not use it and search again: remove the earlier question “diabetes in children”" }).count() === 1, "the answer says what it used, 'Used from your earlier chat: ...', with a button that removes it and asks again");
    ok((await rep.locator(".chat-earlier button").innerText()).trim() === "Do not use it and search again", "the button says in its own words what it does: it does not use that question and searches again (not just 'Remove', which reads as dismissing a note)");
    await dropChat("and in children?");
    x = await probe("and CRISPR?");
    ok(x.raw === '{"mode":"auto","message":"and CRISPR?"}', `on, an unrelated question carries nothing (${x.raw})`);
    ok(await M.locator(".chat-earlier").count() === 0, "...and its answer says nothing of earlier chats");
    await dropChat("and CRISPR?");
    x = await probe("does early detection of glaucoma reduce blindness in elderly people");
    ok(x.raw === '{"mode":"auto","message":"does early detection of glaucoma reduce blindness in elderly people"}', "on, a question that stands alone is not sent with other chats, though it shares a word with one: nothing would read them");
    await dropChat("does early detection");
    x = await probe("and in children?", "Search papers");
    ok(x.raw === '{"mode":"search","message":"and in children?"}', "on, a search chosen by hand is searched as written: nothing is sent with it");
    await dropChat("and in children?");

    console.log("  at most three, only the chats the rail lists, and a chat that was left out");
    await makeChat("asthma in children");
    await makeChat("obesity in children");
    await makeChat("vaccination in children");
    ok(await M.locator(".ws-recent li").count() === 6 && await rowOf("diabetes in children").count() === 0, "the rail lists six chats; the oldest, 'diabetes in children', is kept but not one of them");
    x = await probe("and in children?");
    ok(x.body.earlier.length === 3 && [...asks(x)].sort().join("|") === "asthma in children|obesity in children|vaccination in children", `three questions, from the three chats the rail lists that relate; the chat the rail does not list is not used (${asks(x).join(" | ")})`);
    ok(x.body.earlier.every((e) => Object.keys(e).every((k) => k === "question" || k === "searchQuery")), "...each only a question and, where it has them, its search words");
    ok(await M.locator(".chat-earlier").count() === 3, "the answer shows all three, each on a line of its own");
    await dropChat("and in children?");
    await rowOf("vaccination in children").getByRole("button", { name: "More for the chat vaccination in children" }).click({ force: true });
    await M.getByRole("menuitemcheckbox", { name: /Do not use this chat as memory/ }).click();
    await M.keyboard.press("Escape");
    ok((await entries(M)).find((e) => e.title === "vaccination in children")?.nomem === true, "'Do not use this chat as memory' is kept with the chat");
    x = await probe("and in children?");
    ok([...asks(x)].sort().join("|") === "asthma in children|obesity in children", `a chat that was left out is not drawn on (${asks(x).join(" | ")})`);
    await dropChat("and in children?");
    await M.reload({ waitUntil: "networkidle" });
    await rowOf("vaccination in children").getByRole("button", { name: "More for the chat vaccination in children" }).click({ force: true });
    ok(await M.getByRole("menuitemcheckbox", { name: /Do not use this chat as memory/ }).getAttribute("aria-checked") === "true", "after a reload the chat is still left out, and its menu says so");
    await M.getByRole("menuitemcheckbox", { name: /Do not use this chat as memory/ }).click();
    ok((await entries(M)).find((e) => e.title === "vaccination in children")?.nomem === undefined, "...and it can be taken back");
    await M.keyboard.press("Escape");

    console.log("  remove from the answer: asks again without it, and the choice stays on that answer");
    posted.length = 0;
    await fresh();
    await sendM("and in children?", "Auto");
    await askedM(1);
    await doneN(M, 1);
    ok(await M.locator(".chat-earlier").count() === 3, "(three lines)");
    await M.locator(".chat-earlier").first().getByRole("button").click();
    await askedM(2);
    await focusOnReply(M, 0);
    ok(true, "the focus is on the reply once the button that was pressed is gone (not on the body)");
    await turnDoneM(0);
    ok(posted[1].body.message === "and in children?" && posted[1].body.earlier.length === 2 && !asks(posted[1]).includes(asks(posted[0])[0]), `removing one asks the same words again with the other two (${asks(posted[1]).join(" | ")})`);
    ok(await M.locator(".chat-bubble").count() === 1 && await M.locator(".chat-earlier").count() === 2, "(in the same place, with no new message, and two lines)");
    await M.locator(".chat-earlier").first().getByRole("button").click();
    await askedM(3);
    await turnDoneM(0);
    await M.locator(".chat-earlier").first().getByRole("button").click();
    await askedM(4);
    await turnDoneM(0);
    ok(posted[3].raw === '{"mode":"auto","message":"and in children?"}' && await M.locator(".chat-earlier").count() === 0, `with the last one removed nothing is sent but the message (${posted[3].raw}), and the line is gone`);
    await M.locator(".chat-turn").first().getByRole("button", { name: "Search again", exact: true }).click();
    await askedM(5);
    await focusOnReply(M, 0);
    await turnDoneM(0);
    ok(posted[4].raw === '{"mode":"auto","message":"and in children?"}', "'Search again' on that answer does not bring them back, though the switch is on and they relate: the choice was made for this answer");
    await dropChat("and in children?");

    console.log("  what is left on an answer after Remove is a limit, never a permission: the switch turned off in Settings stops it");
    posted.length = 0;
    await fresh();
    await sendM("and in children?", "Auto");
    await askedM(1);
    await doneN(M, 1);
    const keptTwo = await M.locator(".chat-earlier").count();
    ok(keptTwo >= 2, `(an answer that used ${keptTwo} earlier questions)`);
    await M.locator(".chat-earlier").first().getByRole("button").click();
    await askedM(2);
    await turnDoneM(0);
    ok(Array.isArray(posted[1].body.earlier) && posted[1].body.earlier.length === keptTwo - 1, "Remove asks again with the rest");
    await goSettings();
    await setSwitch(false);
    await goHome();
    await M.locator(".chat-turn").first().getByRole("button", { name: "Search again", exact: true }).click();
    await askedM(3);
    await turnDoneM(0);
    ok(!("earlier" in posted[2].body), `with the switch off, Search again on that answer sends no question of another chat, though they are stored on it (${posted[2].raw})`);
    await M.locator(".chat-turn").first().getByRole("button", { name: "Search again", exact: true }).click();
    await askedM(4);
    await turnDoneM(0);
    ok(!("earlier" in posted[3].body), "...and again");
    await dropChat("and in children?");
    await goSettings();
    await setSwitch(true);
    await goHome();

    console.log("  the chat chosen to continue from: its last three questions go with every message of the new chat, in Auto, until the chip is removed");
    await goSettings();
    await setSwitch(false);
    ok((await store(M)).pref === null, "(the switch is off for this part: the chip does not need it)");
    await goHome();
    await fresh();
    const chatMenu = M.getByRole("button", { name: "Chat options", exact: true });
    const beforeFrom = await entries(M);
    await chatMenu.click();
    await M.getByRole("menu", { name: "Chat options" }).waitFor();
    ok(await M.getByRole("menuitem", { name: /^Private chat/ }).count() === 1 && await M.getByRole("group", { name: "Continue from an earlier chat" }).getByRole("menuitem").count() === beforeFrom.length, "the box's menu offers a private chat, and every kept chat to continue from (not only the six of the rail)");
    await M.getByRole("menuitem", { name: "glaucoma screening in India", exact: true }).click();
    const chip = M.locator(".hm-box .chat-chip");
    ok((await chip.innerText()).replace(/\s+/g, " ").trim() === "Continuing from: glaucoma screening in India" && await M.locator(".hm-title").isVisible(), "a chip says 'Continuing from: glaucoma screening in India', and the page is a new, empty chat");
    posted.length = 0;
    await sendM("does early detection of cataract reduce blindness in elderly people", "Auto");
    await askedM(1);
    await doneN(M, 1);
    ok(posted[0].raw === '{"mode":"auto","message":"does early detection of cataract reduce blindness in elderly people","earlier":[{"question":"glaucoma screening in India"}]}', `the first message is sent with that chat's question, though it stands alone and shares no word with it (${posted[0].raw})`);
    ok(await M.locator(".hm-box .chat-chip").count() === 1 && await M.locator(".ws-recent li").first().innerText().then((t) => /does early detection of cataract/.test(t)), "the chip stays, and the new chat is a chat of its own in the rail");
    await sendM("and in children?", "Auto");
    await askedM(2);
    await doneN(M, 2);
    ok(Object.keys(posted[1].body).join() === "mode,message,history,earlier" && same(posted[1].body.earlier, [{ question: "glaucoma screening in India" }]), "every message of the chat is sent with it, after the turns of this chat");
    await sendM("glaucoma costs", "Search papers");
    await askedM(3);
    await doneN(M, 3);
    ok(posted[2].raw === '{"mode":"search","message":"glaucoma costs"}' && await M.locator(".hm-box .chat-chip").count() === 1, "a search chosen by hand sends nothing of it, and the chip stays");
    ok(/used in Auto only/.test(await M.locator(".hm-box .chat-chip").innerText()), "...and says it is used in Auto only");
    await pick(M, "Auto");
    await M.getByRole("button", { name: "Stop continuing from glaucoma screening in India" }).click();
    ok(await M.locator(".hm-box .chat-chip").count() === 0, "the chip's remove button takes it away");
    await sendM("and in men?", "Auto");
    await askedM(4);
    await doneN(M, 4);
    ok(Object.keys(posted[3].body).join() === "mode,message,history", `after that nothing is sent with it (${posted[3].raw.slice(0, 60)}...)`);
    const sourceUnchanged = (await entries(M)).find((e) => e.title === "glaucoma screening in India");
    ok(!!sourceUnchanged, "the chat it was started from is as it was");
    await dropChat("does early detection of cataract");
    // from the rail's menu of a chat
    await rowOf("obesity in children").getByRole("button", { name: "More for the chat obesity in children" }).click({ force: true });
    await M.getByRole("menuitem", { name: /Continue in a new chat/ }).click();
    ok((await M.locator(".hm-box .chat-chip").innerText()).includes("obesity in children"), "the menu of a chat in the rail can start one too");
    posted.length = 0;
    await sendM("tell me more about cost", "Auto");
    await askedM(1);
    await doneN(M, 1);
    ok(same(posted[0].body.earlier, [{ question: "obesity in children" }]), "...with that chat's one question");
    await dropChat("tell me more about cost");

    console.log("  a private chat: not kept, not used, and gone when it is left");
    await goSettings();
    await setSwitch(true);
    await goHome();
    await fresh();
    const idxBefore = (await store(M)).raw;
    const recordsBefore = (await store(M)).records;
    await chatMenu.click();
    await M.getByRole("menuitem", { name: /^Private chat/ }).click();
    ok((await M.locator(".hm-box .chat-chip").innerText()).includes("Private chat: not kept, not used as memory"), "choosing it puts a chip in the box that says so");
    posted.length = 0;
    await sendM("zebrafishcanary in children and in men?", "Auto");
    await askedM(1);
    await doneN(M, 1);
    ok(posted[0].raw === '{"mode":"auto","message":"zebrafishcanary in children and in men?"}', "a private chat is not sent with questions of other chats either, though the switch is on");
    ok(await M.locator(".chat-title").innerText() === "Private chat" && /not kept/.test(await M.locator("[role=note]").first().innerText()), "its heading says it is private, and a note says it is not kept");
    await sendM("and in women?", "Auto");
    await askedM(2);
    await doneN(M, 2);
    ok(Object.keys(posted[1].body).join() === "mode,message,history" && posted[1].body.history[0].text.startsWith("zebrafishcanary"), "...but it leans on its own earlier messages, as any chat does");
    await new Promise((r) => setTimeout(r, 1200));
    st = await store(M);
    ok(st.raw === idxBefore && st.records === recordsBefore, "nothing of it is in the list of chats or in the browser's storage");
    ok(await M.locator(".ws-recent li").filter({ hasText: "zebrafishcanary" }).count() === 0, "and it is not in the rail");
    await goSettings();
    await goHome();
    ok(await M.locator(".chat-bubble").count() === 2 && (await M.locator(".chat-title").innerText()) === "Private chat", "going to Settings and back is not leaving a private chat: it is still on the screen, with both of its messages");
    await fresh();
    ok(await M.locator(".chat-list").count() === 0, "it is gone when it is left (New chat)");
    x = await probe("and in children?");
    ok(!JSON.stringify(everything.map((e) => e.body.earlier ?? [])).includes("zebrafishcanary"), "and nothing of it was ever drawn on");
    await dropChat("and in children?");
    await fresh();
    await chatMenu.click();
    await M.getByRole("menuitem", { name: /^Private chat/ }).click();
    await M.getByRole("button", { name: "Make this a normal chat again" }).click();
    ok(await M.locator(".hm-box .chat-chip").count() === 0, "(the chip of a private chat that has not begun has its own remove button)");

    console.log("  the box's two choices are for the next message: they keep what was typed, and they do not outlive opening another chat");
    const DRAFT = "a question typed before choosing";
    await fresh();
    await M.locator(".hm-input").fill(DRAFT);
    await chatMenu.click();
    await M.getByRole("menuitem", { name: /^Private chat/ }).click();
    ok((await M.locator(".hm-input").inputValue()) === DRAFT && (await M.locator(".hm-box .chat-chip").count()) === 1, "choosing a private chat after typing keeps the text in the box (it is the question to ask privately), and the chip says so");
    await M.getByRole("button", { name: "Make this a normal chat again" }).click();
    ok((await M.locator(".hm-input").inputValue()) === DRAFT, "...and taking the chip away keeps it too");
    await chatMenu.click();
    await M.getByRole("menuitem", { name: "glaucoma screening in India", exact: true }).click();
    ok((await M.locator(".hm-input").inputValue()) === DRAFT && (await M.locator(".hm-box .chat-chip").count()) === 1, "choosing a chat to continue from keeps the text as well");
    await M.getByRole("button", { name: "Stop continuing from glaucoma screening in India" }).click();
    await M.locator(".hm-input").fill("");
    await makeChat("disposable chat for the chip test", "Search papers");
    await fresh();
    await chatMenu.click();
    await M.getByRole("menuitem", { name: /^Private chat/ }).click();
    await rowOf("disposable chat for the chip").getByRole("button").first().click();
    await M.locator(".chat-bubble").first().waitFor();
    await dropChat("disposable chat for the chip");
    await M.locator(".hm-title").waitFor();
    ok(await M.locator(".hm-box .chat-chip").count() === 0, "a private-chat choice made for the next chat does not survive opening another chat: when that chat is deleted the box is a normal one, not a private one with its chip back");
    await makeChat("second disposable chat for the chip test", "Search papers");
    await fresh();
    await chatMenu.click();
    await M.getByRole("menuitem", { name: "glaucoma screening in India", exact: true }).click();
    ok(await M.locator(".hm-box .chat-chip").count() === 1, "(a chat is chosen to continue from)");
    await rowOf("second disposable chat").getByRole("button").first().click();
    await M.locator(".chat-bubble").first().waitFor();
    await dropChat("second disposable chat");
    await M.locator(".hm-title").waitFor();
    ok(await M.locator(".hm-box .chat-chip").count() === 0, "...and a chat chosen to continue from does not survive it either");

    console.log("  accessibility: the chip, the line on the answer, the menus and the switch, in light, dark and read, and on a phone");
    // a conversation that has all of it on one screen: the chip (a chat chosen to continue from) and an answer that says what it used from it
    await fresh();
    await chatMenu.click();
    await M.getByRole("menuitem", { name: "glaucoma screening in India", exact: true }).click();
    posted.length = 0;
    await sendM("and in children?", "Auto");
    await askedM(1);
    await doneN(M, 1);
    const line = M.locator(".chat-earlier").first();
    ok(await line.count() === 1 && (await line.innerText()).startsWith("Used from your earlier chat: glaucoma screening in India"), "(the answer says it used the chosen chat's question, and the chip is in the box)");
    await M.mouse.move(5, 5);
    for (const theme of ["light", "dark", "read"]) {
      await setTheme(M, theme);
      await M.evaluate(() => window.scrollTo(0, 0));
      await calm(M);
      await faded(M);
      await axe(`chat to chat, ${theme}: the chip, the line on the answer, the box's menu button`, M);
      const c = { chip: await contrastOf(M.locator(".hm-box .chat-chip")), chipX: await contrastOf(M.locator(".hm-box .chat-chip-x")), more: await contrastOf(M.locator(".hm-more")), remove: await contrastOf(line.getByRole("button")) };
      ok(Object.values(c).every((v) => v >= 4.5), `in ${theme}: the chip ${c.chip.toFixed(2)}:1, its remove icon ${c.chipX.toFixed(2)}:1, the box menu's icon ${c.more.toFixed(2)}:1, the Remove link ${c.remove.toFixed(2)}:1 (axe cannot read an icon's colour; 4.5 for all)`);
    }
    await setTheme(M, "light");
    const sz = { more: await sizesOf(M.locator(".hm-more")), x: await sizesOf(M.locator(".hm-box .chat-chip-x")) };
    ok(sz.more[0][0] >= 24 && sz.more[0][1] >= 24 && sz.x[0][0] >= 24 && sz.x[0][1] >= 24, `the box menu button is ${sz.more[0].join("x")} and the chip's remove button ${sz.x[0].join("x")} (WCAG 2.2 asks for 24 by 24)`);
    for (const width of [390, 320]) {
      await M.setViewportSize({ width, height: 800 });
      await M.evaluate(() => window.scrollTo(0, 0));
      await calm(M);
      ok(await noSideways(M), `at ${width} px the page does not scroll sideways, with the chip and the line in it`);
      await axe(`chat to chat, ${width} px wide: the chip and the line`, M);
    }
    await M.setViewportSize({ width: 1360, height: 900 });

    console.log("  accessibility: the box's menu, open (keyboard first)");
    await M.locator(".hm-more").focus();
    await M.keyboard.press("Enter");
    const menu = M.getByRole("menu", { name: "Chat options" });
    await menu.waitFor();
    const onItem = () => M.evaluate(() => document.activeElement?.textContent ?? "");
    ok(/^Private chat/.test(await onItem()), "Enter on the button opens the menu with the focus on its first item");
    await M.keyboard.press("ArrowDown");
    ok(!/^Private chat/.test(await onItem()) && (await M.evaluate(() => document.activeElement?.getAttribute("role"))) === "menuitem", "the arrow keys move between its items");
    await M.keyboard.press("ArrowUp");
    ok(/^Private chat/.test(await onItem()), "...and back");
    await calm(M);
    await axe("the box's menu, open, light", M);
    await setTheme(M, "dark");
    await calm(M);
    await axe("the box's menu, open, dark", M);
    await setTheme(M, "light");
    await M.keyboard.press("Escape");
    await menu.waitFor({ state: "hidden" });
    ok(await M.evaluate(() => document.activeElement?.getAttribute("aria-label")) === "Chat options", "Escape closes it, and the focus is back on its button");

    console.log("  accessibility: the menu of a chat in the rail, by keyboard, on a desktop and in the drawer on a phone");
    const moreBtn = rowOf("obesity in children").getByRole("button", { name: "More for the chat obesity in children" });
    await rowOf("obesity in children").getByRole("button").first().focus();
    await M.keyboard.press("Tab");
    ok(await M.evaluate(() => document.activeElement?.getAttribute("aria-label")) === "More for the chat obesity in children" && await moreBtn.evaluate((el) => getComputedStyle(el).opacity) === "1", "Tab from a chat in the rail reaches its menu button, which is shown when it has the focus");
    const mcs = [];
    for (const theme of ["light", "dark", "read"]) {
      await setTheme(M, theme);
      await calm(M);
      mcs.push(await contrastOf(moreBtn));
    }
    await setTheme(M, "light");
    ok(mcs.every((v) => v >= 4.5) && (await sizesOf(moreBtn))[0][0] >= 24, `...its icon is ${mcs.map((v) => v.toFixed(2)).join(", ")}:1 in light, dark and read, and ${(await sizesOf(moreBtn))[0].join("x")}`);
    await M.keyboard.press("Enter");
    const railMenu = M.getByRole("menu", { name: "More for the chat obesity in children" });
    await railMenu.waitFor();
    ok(/Continue in a new chat/.test(await onItem()), "Enter opens it, with the focus on its first item");
    await M.keyboard.press("ArrowDown");
    ok(/Do not use this chat as memory/.test(await onItem()) && (await M.evaluate(() => document.activeElement?.getAttribute("role"))) === "menuitemcheckbox", "the arrow keys move between the items of this menu as they do in the box's menu (the second is a checkbox item, which a menu is made of too)");
    await M.keyboard.press("ArrowDown");
    ok(/Continue in a new chat/.test(await onItem()), "...round the end");
    await M.keyboard.press("ArrowUp");
    ok(/Do not use this chat as memory/.test(await onItem()), "...and back");
    await M.keyboard.press("Home");
    ok(/Continue in a new chat/.test(await onItem()), "Home goes to the first item");
    await M.keyboard.press("End");
    ok(/Do not use this chat as memory/.test(await onItem()), "End to the last");
    await M.keyboard.press("Home");
    await calm(M);
    await axe("the menu of a chat in the rail, open, light", M);
    await M.keyboard.press("Escape");
    await railMenu.waitFor({ state: "hidden" });
    ok(await M.evaluate(() => document.activeElement?.getAttribute("aria-label")) === "More for the chat obesity in children", "Escape closes it, and the focus is back on its button");
    await M.setViewportSize({ width: 390, height: 800 });
    await M.getByRole("button", { name: "Open the menu" }).click();
    const drawer = M.locator(".ws-drawer");
    await drawer.waitFor();
    await calm(M); // it slides in
    await drawer.getByRole("button", { name: "More for the chat obesity in children" }).click({ force: true });
    const dMenu = M.getByRole("menu", { name: "More for the chat obesity in children" });
    await dMenu.waitFor();
    await calm(M);
    ok(await dMenu.evaluate((el) => { const r = el.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!top?.closest(".pop"); }), "in the drawer on a phone the menu is above the drawer, not behind it");
    await axe("the menu of a chat in the drawer, open, 390 px", M);
    await M.keyboard.press("Escape");
    await dMenu.waitFor({ state: "hidden" });
    await M.keyboard.press("Escape");
    await drawer.waitFor({ state: "detached" });
    await M.setViewportSize({ width: 1360, height: 900 });

    console.log("  accessibility: the switch in Settings, in every theme and on a phone, and by keyboard");
    await goSettings();
    const sws = await sizesOf(sw().locator("xpath=.."));
    ok(!!(await sw().getAttribute("aria-describedby")) && /Off unless/.test(await M.locator(`#${await sw().getAttribute("aria-describedby")}`).innerText()), "the switch is described by its help line");
    await sw().focus();
    await M.keyboard.press("Space");
    await M.waitForFunction(() => document.querySelector('input[role="switch"]')?.checked === false, null, { timeout: 5000 });
    await M.keyboard.press("Space");
    await M.waitForFunction(() => document.querySelector('input[role="switch"]')?.checked === true, null, { timeout: 5000 });
    ok(await sw().isChecked() && (await store(M)).pref === meId, "the space bar turns it off and on, and the choice is kept");
    for (const theme of ["light", "dark", "read"]) {
      await setTheme(M, theme);
      await calm(M);
      await axe(`Settings with the switch, ${theme}`, M);
    }
    await setTheme(M, "light");
    ok(sws[0][1] >= 24, `(the switch is pressed by its whole label, ${sws[0].join("x")})`);
    for (const width of [390, 320]) {
      await M.setViewportSize({ width, height: 800 });
      await calm(M);
      ok(await noSideways(M), `at ${width} px Settings does not scroll sideways`);
      await axe(`Settings with the switch, ${width} px wide`, M);
    }
    await M.setViewportSize({ width: 1360, height: 900 });
    await goHome();

    console.log("  storage that refuses: the switch stays off and says so");
    const blockedPref = await newCtx();
    await blockedPref.addInitScript(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k === "scholar.earlier") throw new DOMException("blocked", "QuotaExceededError"); return set.call(this, k, v); }; });
    const BP = await blockedPref.newPage();
    watch(BP);
    await signInVia(BP);
    await BP.locator(".ws-rail").getByRole("link", { name: "Settings" }).click();
    await BP.getByRole("heading", { name: "Chats" }).waitFor();
    await sw(BP).click();
    await BP.getByText(/would not keep that choice/).waitFor({ timeout: 5000 });
    ok(!(await sw(BP).isChecked()), "a browser that will not store the choice leaves the switch off, and a notice says so");
    await blockedPref.close();
    const blockedDb = await newCtx();
    await blockedDb.addInitScript(() => { const open = indexedDB.open.bind(indexedDB); indexedDB.open = (...a) => { if (a[0] === "scholar") throw new DOMException("blocked", "SecurityError"); return open(...a); }; });
    const BD = await blockedDb.newPage();
    watch(BD);
    await signInVia(BD);
    await BD.locator(".hm-input").fill("glaucoma screening");
    await BD.keyboard.press("Enter");
    await BD.locator('.chat-turn[data-status="done"]').waitFor({ timeout: 30000 });
    await BD.getByText(/would not keep your chats/).first().waitFor({ timeout: 5000 });
    await BD.locator(".ws-rail").getByRole("link", { name: "Settings" }).click();
    await BD.getByRole("heading", { name: "Chats" }).waitFor();
    ok(await sw(BD).isDisabled() && !(await sw(BD).isChecked()) && /would not keep your chats, so there is nothing to use/.test(await BD.locator(".settings-sec", { has: BD.getByRole("heading", { name: "Chats" }) }).innerText()), "when the browser will not keep the chats, the switch is off and cannot be turned on, and the page says why");
    await blockedDb.close();

    console.log("  nothing of the kind for a person who is not signed in");
    const vctx = await newCtx();
    const V = await vctx.newPage();
    watch(V);
    const vposted = [];
    V.on("request", (r) => { if (r.method() === "POST" && new URL(r.url()).pathname === "/api/v1/chat") vposted.push(r.postData() ?? ""); });
    await V.addInitScript((id) => { try { localStorage.setItem("scholar.earlier", id); } catch { /* ignore */ } }, meId);
    await V.goto(BASE + "/home", { waitUntil: "networkidle" });
    await V.locator("#hm-h").waitFor({ timeout: 20000 });
    await V.getByRole("button", { name: "Chat options", exact: true }).click();
    ok(await V.getByRole("menuitem", { name: /^Private chat/ }).count() === 1 && await V.getByRole("group", { name: "Continue from an earlier chat" }).count() === 0, "a visitor can start a private chat, and is not offered to continue from a chat");
    await V.keyboard.press("Escape");
    await V.locator(".hm-input").fill("diabetes in children");
    await V.keyboard.press("Enter");
    await V.locator('.chat-turn[data-status="done"]').waitFor({ timeout: 30000 });
    await V.locator(".hm-input").fill("and in children?");
    await V.keyboard.press("Enter");
    await V.waitForFunction(() => document.querySelectorAll('.chat-turn[data-status="done"]').length === 2, null, { timeout: 30000 });
    ok(vposted.every((r) => !r.includes("earlier")), "a visitor's messages carry no questions of other chats, even if the device holds a choice for someone else");
    ok(vposted.length === 2 && vposted[0] === '{"mode":"auto","message":"diabetes in children"}' && vposted[1] === '{"mode":"auto","message":"and in children?"}', `a visitor's follow-up is exactly the message, with no earlier turns: nothing of the conversation leaves the device for somebody who is not signed in (${vposted[1]})`);
    ok((await V.evaluate(() => localStorage.getItem("scholar.chats.v1"))).includes("diabetes in children"), "(a visitor's chats are kept, as before)");
    await vctx.close();

    console.log("  the account: a session that ends without a sign-out, and another person on the same browser");
    const before = (await entries(M)).length;
    ok(before >= 6, `(the first person has ${before} chats in this browser)`);
    const second = await newCtx();
    const S = await second.newPage();
    watch(S);
    idp.setUser({ sub: "chat-ui-2", email: "dev.k@example.edu", email_verified: true, name: "Dev K" });
    await signInVia(S);
    const meId2 = await S.evaluate(() => fetch("/api/v1/auth/me", { credentials: "same-origin" }).then((r) => r.json()).then((j) => j.user.id));
    ok(meId2 !== meId, "(a second person has an account of their own)");
    const cookies2 = await second.cookies();
    await second.close();
    idp.setUser({ sub: "chat-ui-1", email: "isha.m@example.edu", email_verified: true, name: "Isha M" });
    await mx.clearCookies();
    await mx.addCookies(cookies2);
    await M.reload({ waitUntil: "networkidle" });
    await M.locator("#hm-h").waitFor({ timeout: 20000 });
    await M.waitForFunction(() => document.querySelectorAll(".ws-recent li").length === 0, null, { timeout: 8000 });
    st = await store(M);
    ok(st.records === 0 && (JSON.parse(st.raw ?? "[]")).length === 0, `the second person's session is on this browser: the first person's chats are gone from the list and from the browser's storage (${st.records} records)`);
    ok(await M.locator(".chat-list").count() === 0 && st.active === null, "...and from the page");
    await goSettings();
    ok(!(await sw().isChecked()), "the switch is off for the second person, though the first turned it on on this device: it is theirs to turn on");
    await goHome();
    x = await probe("and in children?");
    ok(x.raw === '{"mode":"auto","message":"and in children?"}', "...and nothing is sent with their messages");

    console.log("  the account: a session that has ended (a cookie that ran out, no sign-out) deletes nothing; the same person finds their chats again, another person removes them");
    await dropChat("and in children?"); // (the one the probe above made: this part counts the second person's chats)
    await makeChat("quokka habitat research");
    await settled(M);
    ok((await entries(M)).some((e) => e.owner === meId2), "(the second person has a chat, stamped with their own id)");
    await mx.clearCookies();
    await M.goto(BASE + "/home", { waitUntil: "networkidle" });
    await M.locator(".ws-anon").waitFor({ timeout: 20000 });
    st = await store(M);
    ok(st.records === 1 && (JSON.parse(st.raw ?? "[]")).length === 1 && (JSON.parse(st.raw))[0].owner === meId2, `with the session gone the chat of the person who had it is still in the browser: the list and its record (${st.records} record) are not deleted by a cookie that ran out`);
    ok(await M.locator(".ws-recent li").count() === 0 && await M.locator(".chat-list").count() === 0 && st.active === null, "...but whoever comes to this browser next does not see it: not in the rail, not on the page");
    await M.getByRole("button", { name: "Chat options", exact: true }).click();
    ok(await M.getByRole("group", { name: "Continue from an earlier chat" }).count() === 0, "...nor is it offered to continue from");
    await M.keyboard.press("Escape");
    posted.length = 0;
    await sendM("owl pellets habitat survey", "Search papers");
    await doneN(M, 1);
    await settled(M);
    st = await store(M);
    const both = JSON.parse(st.raw);
    ok(both.length === 2 && both.some((e) => e.owner === meId2) && st.records === 2, "a visitor's own chat is added to the list without dropping the held one (the list is written whole)");
    ok(await M.locator(".ws-recent li").count() === 1 && /owl pellets/.test(await M.locator(".ws-recent li").first().innerText()), "(and only the visitor's is in the rail)");
    await mx.addCookies(cookies2);
    await M.reload({ waitUntil: "networkidle" });
    await M.locator("#hm-h").waitFor({ timeout: 20000 });
    await M.waitForFunction(() => document.querySelectorAll(".ws-recent li").length === 2, null, { timeout: 8000 });
    ok(/quokka habitat research/.test(await M.locator(".ws-recent").innerText()), "the same person signing in again finds their chat in the rail: nothing was lost with the session");
    await rowOf("quokka habitat research").getByRole("button").first().click();
    await M.locator(".chat-bubble").first().waitFor();
    ok(/quokka habitat research/.test(await M.locator(".chat-bubble").first().innerText()), "...and it opens, with its messages");
    await mx.clearCookies();
    idp.setUser({ sub: "chat-ui-1", email: "isha.m@example.edu", email_verified: true, name: "Isha M" });
    await signInVia(M);
    await M.waitForFunction(() => !document.body.textContent.includes("quokka habitat research"), null, { timeout: 8000 });
    st = await store(M);
    ok(!(st.raw ?? "").includes("quokka") && st.records === 0, `when somebody else signs in, the first person's chats are removed from the list and from the browser's storage (${st.records} records left). The owl chat the visitor made was on screen when the first person signed in, so it had become theirs, and went with the rest`);

    console.log("  the account: chats kept before they had an owner are adopted by the person who opens them, and are not used as memory until then");
    await goSettings();
    await setSwitch(true);
    await goHome();
    const old = (id, text, at) => ({ id, title: text, updatedAt: at, kw: text.replace(/ in /g, " ") });
    const msgsOf = (id, text) => [{ id: `${id}u`, role: "user", text, at: 1 }, { id: `${id}a`, role: "assistant", mode: "search", query: text, language: "en", auto: false, how: "chosen", confidence: 1, understood: true, status: "done", step: null, stepsDone: [], papers: [], papersFinal: true, notices: [], live: "", answer: null, generalLive: "", general: null, at: 2 }];
    const seeds = [old("oldone", "migraine in children", Date.now() - 1000), old("oldtwo", "epilepsy in children", Date.now() - 2000)];
    await M.evaluate(async ({ seeds, recs }) => {
      localStorage.setItem("scholar.chats.v1", JSON.stringify(seeds));
      const db = await new Promise((res) => { const r = indexedDB.open("scholar", 2); r.onupgradeneeded = () => { for (const s of ["pendingInk", "chats"]) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); }; r.onsuccess = () => res(r.result); });
      await new Promise((res) => { const tx = db.transaction("chats", "readwrite"); for (const [id, v] of Object.entries(recs)) tx.objectStore("chats").put(v, id); tx.oncomplete = () => res(); });
      db.close();
    }, { seeds, recs: { oldone: { id: "oldone", messages: msgsOf("oldone", "migraine in children") }, oldtwo: { id: "oldtwo", messages: msgsOf("oldtwo", "epilepsy in children") } } });
    await M.reload({ waitUntil: "networkidle" });
    await M.locator(".ws-recent li").first().waitFor();
    ok(await M.locator(".ws-recent li").count() === 2, "the two chats kept before there was an owner are in the rail, as they were");
    x = await probe("and in children?");
    ok(x.raw === '{"mode":"auto","message":"and in children?"}', "...but they are not drawn on: nobody has said they are theirs");
    await dropChat("and in children?");
    await M.locator(".ws-recent li").filter({ hasText: "migraine in children" }).getByRole("button").first().click();
    await M.locator(".chat-bubble").first().waitFor();
    ok((await entries(M)).find((e) => e.id === "oldone")?.owner === meId && (await entries(M)).find((e) => e.id === "oldtwo")?.owner === undefined, "opening one makes it the signed-in person's, and only that one");
    x = await probe("and in children?");
    ok(same(asks(x), ["migraine in children"]), `from then on it is drawn on, and the one nobody opened is not (${asks(x).join(" | ")})`);
    await dropChat("and in children?");

    console.log("  the words go with the chat: delete, the thirty-chat limit, clearing, signing out");
    await makeChat("quokka canaryword habitat");
    await settled(M);
    ok((await store(M)).raw.includes("canaryword"), "(the words of a chat are in the list)");
    await dropChat("quokka canaryword habitat");
    ok(!(await store(M)).raw.includes("canaryword"), "deleting a chat takes its words with it");
    const thirty = Array.from({ length: 30 }, (_, i) => ({ id: `fill${i}`, title: `filler chat ${i}`, updatedAt: Date.now() - (i + 5) * 1000, owner: meId, kw: i === 29 ? "evictcanary" : `filler${i}x` }));
    await M.evaluate((thirty) => localStorage.setItem("scholar.chats.v1", JSON.stringify(thirty)), thirty);
    await M.reload({ waitUntil: "networkidle" });
    await makeChat("platypus venom research");
    await settled(M);
    st = await store(M);
    ok((JSON.parse(st.raw)).length === 30 && !st.raw.includes("evictcanary") && st.raw.includes("platypus"), "the thirty-first chat pushes the oldest out of the list, and its words with it");
    await goSettings();
    await M.getByRole("button", { name: /^Delete all \d+ chats in this browser$/ }).click();
    await M.waitForFunction(() => localStorage.getItem("scholar.chats.v1") === null, null, { timeout: 8000 });
    ok((await store(M)).raw === null, "'Delete all chats' takes the whole list, and the words in it");
    await goHome();
    await makeChat("alligator habitat research");
    await settled(M);
    ok((await store(M)).raw.includes("alligator"), "(a chat again)");

    console.log("  another tab: what the first tab removes does not stay on the second");
    const T2 = await mx.newPage();
    watch(T2);
    await T2.goto(BASE + "/", { waitUntil: "networkidle" });
    await T2.locator("#hm-h").waitFor({ timeout: 20000 });
    await T2.locator(".ws-recent li").first().getByRole("button").first().click();
    await T2.locator(".chat-bubble").first().waitFor();
    await M.bringToFront();
    await M.locator(".ws-rail").getByRole("button", { name: "Sign out" }).click();
    await until(M, () => localStorage.getItem("scholar.chats.v1") === null && localStorage.getItem("scholar.signedin") === null);
    await T2.waitForFunction(() => document.querySelectorAll(".chat-list").length === 0 && document.querySelectorAll(".ws-recent li").length === 0, null, { timeout: 8000 });
    ok(true, "a chat that was open in a second tab is let go of when the first signs out: it is not on the screen, nor in its rail");
    await T2.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new Event("pagehide")); });
    await T2.waitForTimeout(1200);
    st = await store(T2);
    ok(st.records === 0 && st.raw === null, "...and nothing it held was saved back (the browser's storage is empty)");
    ok(st.pref === meId, "(the choice 'Use my earlier chats' stays on the device when someone signs out: it is the device's, and is off for anyone else)");
    await T2.close();

    ok(everything.every((e) => !/IDEACANARY|PASTECANARY|drones|reports its main/.test(JSON.stringify(e.body.earlier ?? []))), `in everything the page sent in this block (${everything.length} requests), no question of another chat is an idea, a pasted text or an answer`);
    await mx.close();
  };
  /* ============================ layout, touch and two tabs ============================
     What the memory block cannot see: a long unbroken word at 320 px (the page clips what goes sideways, so a test of the page's width cannot fail: the right edge of every box and button is measured instead),
     the buttons beside a chat in the rail on a touch screen, and two tabs on one chat against the real IndexedDB. Runs in contexts of its own, so it can be run alone: CHAT_ONLY=layout node e2e/chat.mjs <baseUrl>. */
  const layout = async () => {
    console.log("layout, touch and two tabs: a long word at 320 px, the rail's buttons for a finger, a chat open in two tabs");
    const mx = await newCtx();
    const M = await mx.newPage();
    watch(M);
    const signInVia = async (p) => {
      await p.goto(BASE + "/", { waitUntil: "networkidle" });
      await p.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
      await p.getByRole("button", { name: "Continue with Google" }).last().click();
      await p.locator("#hm-h").waitFor({ timeout: 20000 });
    };
    const sendM = async (text, tool = "Search papers") => {
      await M.waitForFunction(() => !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 30000 });
      await pick(M, tool);
      await M.locator(".hm-input").fill(text);
      await M.keyboard.press("Enter");
    };
    const fresh = async () => { await M.locator(".ws-rail").getByRole("button", { name: "New chat" }).click(); await M.locator(".hm-title").waitFor(); };
    const makeChat = async (text, tool = "Search papers") => { await fresh(); await sendM(text, tool); await doneN(M, 1); };
    const chatMenu = M.getByRole("button", { name: "Chat options", exact: true });
    await signInVia(M);
    console.log("  a long unbroken word (a DOI, a URL) does not push the conversation, the chip or the menu off a 320 px screen");
    const LONG = "glaucomascreeningdetectionandmanagement".repeat(2); // 78 letters and no space
    await makeChat(`${LONG} in india`, "Search papers");
    await makeChat(`diabetes me ${LONG.slice(0, 60)} ka kya asar hota hai`, "Auto");
    /** What is past the window's edge: the page clips what goes sideways (so no scroll bar shows it, and a test of the page's width cannot fail), and a button cut off that way cannot be reached even by keyboard. */
    const spill = (p) => p.evaluate(() => {
      const w = innerWidth;
      return [".ws-col", "main", ".chat-list", ".chat-turn", ".chat-und", ".chat-u-actions button", ".chat-acts button", ".hm-box", ".hm-box .chat-chip", ".hm-box .chat-chip-x", ".chat-bubble", ".result-title"].flatMap((sel) => [...document.querySelectorAll(sel)].filter((el) => el.getBoundingClientRect().right > w + 0.5).map((el) => `${sel} to ${Math.round(el.getBoundingClientRect().right)}`));
    });
    await M.setViewportSize({ width: 320, height: 800 });
    await M.evaluate(() => window.scrollTo(0, 0));
    await calm(M);
    ok(/translated: diabetes me glaucoma/.test(await M.locator(".chat-searched").first().innerText()), "(the reply says it searched for words that include the 60-letter word)");
    let past = await spill(M);
    ok(past.length === 0, `at 320 px, with a 60-letter word in the question and in what the reply says it searched for, the conversation, its lines and its buttons are all inside the window (past the edge: ${past.join(", ") || "nothing"})`);
    await M.setViewportSize({ width: 1360, height: 900 });
    await fresh();
    await M.setViewportSize({ width: 320, height: 800 });
    await frames(M); // (the empty home has glows that never stop moving: calm() would wait for them)
    await chatMenu.click();
    const longMenu = M.getByRole("menu", { name: "Chat options" });
    await longMenu.waitFor();
    await frames(M);
    const menuFit = await longMenu.evaluate((el) => { const items = [...el.querySelectorAll(".hm-menu-item")]; return { w: innerWidth, right: Math.round(el.getBoundingClientRect().right), itemsRight: Math.max(...items.map((i) => Math.round(i.getBoundingClientRect().right))), overflowing: items.filter((i) => i.scrollWidth > i.clientWidth + 1).length }; });
    ok(menuFit.right <= menuFit.w && menuFit.itemsRight <= menuFit.w && menuFit.overflowing === 0, `the box's menu, with a chat whose title is one long word, fits a 320 px window (menu to ${menuFit.right}, items to ${menuFit.itemsRight} of ${menuFit.w}, ${menuFit.overflowing} item wider than itself)`);
    await M.getByRole("menuitem", { name: new RegExp(`^${LONG.slice(0, 20)}`) }).first().click();
    await M.locator(".hm-box .chat-chip").waitFor();
    await frames(M);
    past = await spill(M);
    ok(past.length === 0, `...and the chip that says which chat is continued (its title is one long word) and its X are inside the window too (past the edge: ${past.join(", ") || "nothing"})`);
    ok((await sizesOf(M.locator(".hm-box .chat-chip-x")))[0][0] >= 24, "(the X is still a target of 24 px or more)");
    await M.getByRole("button", { name: /^Stop continuing from/ }).click();
    await M.setViewportSize({ width: 1360, height: 900 });

    console.log("  on a touch screen the two buttons beside a chat in the rail are apart enough for a finger (one of them deletes the chat at once)");
    const tx = await newCtx({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await tx.addCookies(await mx.cookies());
    const TP = await tx.newPage();
    watch(TP);
    await TP.goto(BASE + "/home", { waitUntil: "networkidle" });
    await TP.locator("#hm-h").waitFor({ timeout: 20000 });
    if (!(await TP.evaluate(() => matchMedia("(hover: none)").matches || matchMedia("(pointer: coarse)").matches))) {
      console.log("  note: this browser does not match a touch pointer in a touch context; the check is skipped");
    } else {
      await TP.locator(".hm-input").fill("glaucoma screening");
      await TP.keyboard.press("Enter");
      await TP.locator('.chat-turn[data-status="done"]').waitFor({ timeout: 30000 });
      await TP.getByRole("button", { name: "Open the menu" }).click();
      await TP.locator(".ws-drawer").waitFor();
      await calm(TP);
      const pair = await TP.locator(".ws-drawer .ws-recent li").first().evaluate((li) => {
        const box = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, width: b.width, height: b.height }; };
        return { more: box(li.querySelector(".ws-recent-more")), del: box(li.querySelector(".ws-recent-x:not(.ws-recent-more)")), open: box(li.querySelector(".ws-recent-open")) };
      });
      // (to the pixel: the drawer slides in on a spring, and a box that is 40 px can be read as 39.98 while it is still settling)
      ok([pair.more.width, pair.more.height, pair.del.width, pair.del.height].every((v) => Math.round(v) >= 40), `on touch both are at least 40 by 40 (${Math.round(pair.more.width)}x${Math.round(pair.more.height)} and ${Math.round(pair.del.width)}x${Math.round(pair.del.height)})`);
      ok(pair.del.left - pair.more.right >= 7.5, `...with at least 8 px between them (${(pair.del.left - pair.more.right).toFixed(1)}), Delete the farthest from the title`);
    }
    await tx.close();

    console.log("  two tabs on one chat: a tab that was left behind does not write over what the other saved, and takes it up when it is brought back");
    await makeChat("metformin hba1c in adults", "Search papers");
    await settled(M);
    const recordsOf = (p) => p.evaluate(async () => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open("scholar"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      const all = await new Promise((resolve) => { const q = db.transaction("chats").objectStore("chats").getAll(); q.onsuccess = () => resolve(q.result); });
      db.close();
      return all.filter((c) => /metformin/.test(c.messages[0]?.text ?? "")).map((c) => ({ rev: c.rev ?? 0, first: c.messages[0].text, versions: c.messages[0].versions?.length ?? 0, messages: c.messages.length }));
    });
    const X = await mx.newPage();
    watch(X);
    await X.goto(BASE + "/", { waitUntil: "networkidle" });
    await X.locator("#hm-h").waitFor({ timeout: 20000 });
    await X.locator(".ws-recent li").first().getByRole("button").first().click();
    await X.locator(".chat-bubble").first().waitFor();
    await X.locator(".chat-u").first().hover({ position: { x: 20, y: 10 } });
    await X.getByRole("button", { name: "Edit your message", exact: true }).click();
    await X.locator(".chat-edit-ta").fill("metformin hba1c in elderly people");
    await X.locator(".chat-edit-ta").press("Enter");
    await X.waitForFunction(() => !document.querySelector(".chat-edit") && document.querySelectorAll('.chat-turn[data-status="done"]').length === 1 && /elderly/.test(document.querySelector(".chat-bubble")?.textContent ?? ""), null, { timeout: 30000 });
    await settled(X);
    let recs = await recordsOf(X);
    ok(recs.length === 1 && recs[0].versions === 2 && /elderly/.test(recs[0].first), `(the second tab edited the question: the record has two versions and the new words (${JSON.stringify(recs)}))`);
    ok(/in adults/.test(await M.locator(".chat-bubble").first().innerText()), "(the first tab, which was not looked at, still shows the old words)");
    await M.locator(".chat-turn").first().getByRole("button", { name: "Search again", exact: true }).click();
    await M.getByText(/changed in another tab/).waitFor({ timeout: 10000 });
    await M.waitForFunction(() => /elderly/.test(document.querySelector(".chat-bubble")?.textContent ?? ""), null, { timeout: 8000 });
    await frames(M);
    recs = await recordsOf(M);
    ok(recs.length === 1 && recs[0].versions === 2 && /elderly/.test(recs[0].first), `the first tab acted on its old copy: nothing was written over the edit and its kept version, the page took the other copy up and said so (${JSON.stringify(recs)})`);
    ok(await M.locator(".chat-ver-n").count() === 1, "...and the pager of the edit is on its screen");
    await X.locator(".chat-u").first().hover({ position: { x: 20, y: 10 } });
    await X.getByRole("button", { name: "Edit your message", exact: true }).click();
    await X.locator(".chat-edit-ta").fill("metformin hba1c in children");
    await X.locator(".chat-edit-ta").press("Enter");
    await X.waitForFunction(() => !document.querySelector(".chat-edit") && document.querySelectorAll('.chat-turn[data-status="done"]').length === 1 && /children/.test(document.querySelector(".chat-bubble")?.textContent ?? ""), null, { timeout: 30000 });
    await settled(X);
    await M.evaluate(() => { window.dispatchEvent(new Event("focus")); });
    await M.waitForFunction(() => /in children/.test(document.querySelector(".chat-bubble")?.textContent ?? ""), null, { timeout: 8000 });
    ok(true, "a tab that is brought back to the front takes up what the other tab saved without a word (the new edit is on its screen)");
    await X.close();

    await mx.close();
  };
  const only = process.env.CHAT_ONLY;
  if (!only || only === "actions") await actions();
  if (only === "actions") throw new Stop();
  if (!only || only === "context") await context();
  if (only === "context") throw new Stop();
  if (!only || only === "memory") await memory();
  if (only === "memory") throw new Stop();
  if (!only || only === "layout") await layout();
  if (only === "layout") throw new Stop();

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
  ok(/Each claim was read against the sentences it cites/.test(await answer.innerText()) && await answer.locator(".ask-status[data-tone=ok]").count() === 1 && await answer.locator(".chat-left-out").count() === 0, "and it says what that means: each claim was read against the sentences it cites, and nothing was left out");
  ok(await page.locator(".result[data-retracted=true] .retract").first().isVisible() && await page.locator(".chat-note[data-kind=retracted]").isVisible(), "the retracted paper has its banner, and a line says it was not used for the answer");
  ok(await page.locator(".chat-turn > .sr-only[role=status]").innerText().then((t) => /Answer ready, 5 papers/.test(t)), "a polite message tells a screen reader that the answer is ready (not the words one by one)");
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
  console.log("general background: apart from the papers, always labelled");
  const bgBox = page.locator(".chat-turn").last().locator(".chat-general");
  const justDone = () => page.locator('.chat-list > li:last-child .chat-turn[data-status="done"]');
  await bgBox.waitFor({ timeout: 20000 });
  await justDone().waitFor({ timeout: 30000 });
  ok(/General background, not from a paper in your results/.test(await bgBox.innerText()) && await bgBox.getByLabel("General background, not from a paper in your results").count() >= 0, "when nothing was found, a short background follows under the label 'General background, not from a paper in your results'");
  ok(await bgBox.locator(".cite-chip").count() === 0 && !/\[\d/.test(await bgBox.innerText()) && /No paper is cited here/.test(await bgBox.innerText()), "it has no citation or source mark, and says that no paper is cited");
  ok(await page.locator(".chat-turn").last().locator(".chat-answer").count() === 0 && await page.locator(".chat-turn").last().locator(".result").count() === 0, "and it is not inside a checked answer, and there are no invented papers");
  await page.waitForTimeout(700);
  await page.evaluate(() => window.scrollTo(0, 0));
  await axe("a background under its label, light", page);
  await setTheme(page, "dark");
  await page.waitForTimeout(500);
  await axe("a background under its label, dark", page);
  await setTheme(page, "light");
  await page.screenshot({ path: OUT + "3-background.png" });
  await bgBox.getByRole("button", { name: "Edit the question and search again" }).click();
  await page.waitForFunction(() => document.activeElement?.classList.contains("hm-input"), null, { timeout: 3000 }).catch(() => {}); // the focus is given a moment after the click
  ok((await page.locator(".hm-input").inputValue()) === "nothing at all" && await page.locator(".hm-input").evaluate((el) => el === document.activeElement), "'Edit the question and search again' puts the question back in the box, ready to change");
  await page.locator(".hm-input").fill("");
  await send("nothing gibberish", { tool: false });
  await justDone().waitFor({ timeout: 30000 });
  ok(await page.locator(".chat-turn").last().locator(".chat-general").count() === 0 && /Nothing was found/.test(await page.locator(".chat-turn").last().innerText()), "a subject the model does not recognise gets no background: only the plain line that nothing was found");
  await send("nothing greeting", { tool: false });
  await justDone().waitFor({ timeout: 30000 });
  ok(/finds research papers and answers from them/.test(await page.locator(".chat-turn").last().locator(".chat-why").innerText()) && await page.locator(".chat-turn").last().locator(".chat-general").count() === 0, "a message that is not a research question gets one plain sentence about what the box is for, not a background");
  await send("nothing cites", { tool: false });
  await justDone().waitFor({ timeout: 30000 });
  ok(await page.locator(".chat-turn").last().locator(".chat-general").count() === 0 && !/Smith et al/.test(await page.locator(".chat-turn").last().innerText()), "a background that names a paper is never left on screen, though its words were arriving");

  await send("an unanswerable glaucoma question", { tool: false });
  await justDone().waitFor({ timeout: 30000 });
  ok(/do not seem to answer this directly/.test(await page.locator(".chat-list > li:last-child .chat-why").first().innerText()), "when the papers do not answer, it says so and shows no sentence of the model's");
  ok(await page.locator(".chat-list > li:last-child .chat-general .chat-text").count() === 1 && await page.locator(".chat-list > li:last-child .result").count() === 5, "...the background follows under its label, and the five papers are still listed");
  await send("hallucinate glaucoma", { tool: false });
  await page.locator('.chat-list > li:last-child .chat-turn[data-status="done"]').waitFor({ timeout: 30000 });
  ok(/could not be checked/.test(await page.locator(".chat-list > li:last-child .chat-why").innerText()), "an answer that could not be checked says so");
  ok(await page.locator(".chat-list > li:last-child .chat-answer").count() === 0, "an answer whose evidence is not a real sentence is not shown");
  ok(await page.locator(".chat-list > li:last-child .chat-general").count() === 0, "and no background is written to cover for it (the model had an answer; that is a failure, not a gap in the papers)");

  console.log("the support judge: what it leaves out, what it could not read, and the sentences it found");
  const lastLi = ".chat-list > li:last-child";
  await send("judgedrop glaucoma", { tool: false });
  await page.locator(`${lastLi} .chat-turn[data-status="done"]`).waitFor({ timeout: 30000 });
  ok(/One statement was left out: the sentences it cited do not support it/.test(await page.locator(`${lastLi} .chat-left-out`).innerText()) && !/invented/.test(await page.locator(`${lastLi} .chat-answer`).innerText()), "a claim the sentences do not support is left out, and the reader is told one statement was");
  await send("judgefail glaucoma", { tool: false });
  await page.locator(`${lastLi} .chat-turn[data-status="done"]`).waitFor({ timeout: 30000 });
  const warn = page.locator(`${lastLi} .ask-status[data-tone=warn]`);
  ok(/not read against them this time/.test(await warn.innerText()) && await page.locator(`${lastLi} .chat-left-out`).count() === 0 && await page.locator(`${lastLi} .chat-answer`).getByRole("button", { name: /^Source 1/ }).isVisible(), "when the judge cannot be used the answer is still shown, with its marks, and the banner does not say each claim was read");
  await send("judgemove glaucoma", { tool: false });
  await page.locator(`${lastLi} .chat-turn[data-status="done"]`).waitFor({ timeout: 30000 });
  await page.locator(`${lastLi} .chat-evidence summary`).click();
  ok(/Performance was lower for images with cataract/.test(await page.locator(`${lastLi} .chat-evidence`).innerText()), "the sentences behind the answer are the ones the judge found");

  console.log("\"Check strictly\": the reader asks for a stronger second reading");
  await send("tighten glaucoma", { tool: false });
  await page.locator(`${lastLi} .chat-turn[data-status="done"]`).waitFor({ timeout: 30000 });
  const strictBtn = page.locator(`${lastLi} .chat-strict`).getByRole("button", { name: "Check strictly" });
  ok(await strictBtn.isVisible() && /also claims a cure/.test(await page.locator(`${lastLi} .chat-answer`).innerText()), "an answer that was read claim by claim offers 'Check strictly', and says what it costs");
  ok(/About 5,000 tokens/.test(await page.locator(`${lastLi} .chat-strict-h`).innerText()) && !!(await strictBtn.getAttribute("aria-describedby")), "the cost is said in words, and tied to the button for a screen reader");
  // at the foot of the page, where the last answer must be clear of the prompt box that sticks to the bottom of the window (the page keeps room for it); the check ran on whatever
  // place the page had scrolled to, and on a machine that scrolls differently the buttons of the answer were half under the box
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(400);
  await axe("an answer with Check strictly", page);
  await strictBtn.click();
  await page.locator(`${lastLi} .chat-answer`).waitFor();
  await page.waitForFunction((sel) => /read strictly/.test(document.querySelector(sel)?.textContent ?? ""), `${lastLi} .chat-answer`, { timeout: 15000 });
  const strictAns = await page.locator(`${lastLi} .chat-answer`).innerText();
  ok(/The first paper reports its main result/.test(strictAns) && !/cure/.test(strictAns), "the statement that said more than its sentence is cut down to what the sentence says");
  ok(/One statement was shortened to what its sentences say/.test(await page.locator(`${lastLi} .chat-left-out`).innerText()), "the reader is told one statement was shortened");
  ok(await page.locator(`${lastLi} .chat-strict`).count() === 0 && await page.locator(`${lastLi} .chat-answer`).getByRole("button", { name: /^Source 1/ }).isVisible(), "the button is gone once it was used, and the mark still opens its paper");
  await page.locator(`${lastLi} .chat-evidence summary`).click();
  ok(/AUC of 0\.94/.test(await page.locator(`${lastLi} .chat-evidence`).innerText()), "the sentence behind it is still the abstract's own");
  await axe("an answer checked strictly", page);

  await send("tightenfail glaucoma", { tool: false });
  await page.locator(`${lastLi} .chat-turn[data-status="done"]`).waitFor({ timeout: 30000 });
  const failBtn = page.locator(`${lastLi} .chat-strict`).getByRole("button", { name: "Check strictly" });
  const answerOnly = (sel) => page.locator(sel).evaluate((el) => { const c = el.cloneNode(true); c.querySelectorAll(".chat-strict").forEach((n) => n.remove()); return c.textContent; });
  const beforeFail = await answerOnly(`${lastLi} .chat-answer`);
  await failBtn.click();
  await page.locator(`${lastLi} .chat-strict-err`).waitFor({ timeout: 15000 });
  ok(/could not be done/.test(await page.locator(`${lastLi} .chat-strict-err`).innerText()) && await page.locator(`${lastLi} .chat-strict-err`).getAttribute("role") === "alert", "when the stronger check fails the reader is told, in an alert");
  ok((await answerOnly(`${lastLi} .chat-answer`)) === beforeFail && await failBtn.isVisible(), "...the answer is exactly as it was, and the button is there to try again");
  await axe("a strict check that failed", page);

  await send("tightenquota glaucoma", { tool: false });
  await page.locator(`${lastLi} .chat-turn[data-status="done"]`).waitFor({ timeout: 30000 });
  await page.locator(`${lastLi} .chat-strict`).getByRole("button", { name: "Check strictly" }).click();
  await page.locator(`${lastLi} .chat-strict-err`).waitFor({ timeout: 15000 });
  ok(/allowance/i.test(await page.locator(`${lastLi} .chat-strict-err`).innerText()), "when the day's allowance is used up the reader is told so");

  await send("tightenslow glaucoma", { tool: false });
  await page.locator(`${lastLi} .chat-turn[data-status="done"]`).waitFor({ timeout: 30000 });
  const slowBefore = await answerOnly(`${lastLi} .chat-answer`);
  await page.locator(`${lastLi} .chat-strict`).getByRole("button", { name: "Check strictly" }).click();
  const working = page.locator(`${lastLi} .chat-strict[role=status]`);
  await working.waitFor({ timeout: 5000 });
  ok(/20 to 45 seconds/.test(await working.innerText()), "while it runs the reader is told how long it takes, in a polite status");
  await working.getByRole("button", { name: "Cancel" }).click();
  await page.locator(`${lastLi} .chat-strict`).getByRole("button", { name: "Check strictly" }).waitFor({ timeout: 5000 });
  await page.waitForTimeout(4500); // the server's answer, after the cancel, must change nothing
  ok((await answerOnly(`${lastLi} .chat-answer`)) === slowBefore && await page.locator(`${lastLi} .chat-strict-err`).count() === 0, "Cancel leaves the answer exactly as it was, without an error, and the late answer does not change it");

  console.log("Search again while a strict check runs: the old check's answer is not given to the new reply");
  await send("tightenslow glaucoma retry", { tool: false });
  await page.locator(`${lastLi} .chat-turn[data-status="done"]`).waitFor({ timeout: 30000 });
  await page.locator(`${lastLi} .chat-strict`).getByRole("button", { name: "Check strictly" }).click();
  await page.locator(`${lastLi} .chat-strict[role=status]`).waitFor({ timeout: 5000 });
  await page.locator(`${lastLi} .chat-turn`).getByRole("button", { name: "Search again", exact: true }).click();
  await page.locator(`${lastLi} .chat-turn[data-status="done"]`).waitFor({ timeout: 30000 });
  await page.locator(`${lastLi} .chat-strict`).getByRole("button", { name: "Check strictly" }).waitFor({ timeout: 5000 });
  const retried = await answerOnly(`${lastLi} .chat-answer`);
  await page.waitForTimeout(4500); // the server answers the first check after the retry
  ok((await answerOnly(`${lastLi} .chat-answer`)) === retried && !/read strictly/.test(await page.locator(`${lastLi} .chat-answer`).innerText()) && await page.locator(`${lastLi} .chat-strict-err`).count() === 0 && await page.locator(`${lastLi} .chat-strict[role=status]`).count() === 0, "the strict check that was running is stopped by Search again, and its late answer changes nothing of the new reply (no 'read strictly', no error, no spinner); the new reply can be checked strictly itself");

  await send("tighten glaucoma again", { tool: false });
  await page.locator(`${lastLi} .chat-turn[data-status="done"]`).waitFor({ timeout: 30000 });
  await page.locator(`${lastLi} .chat-strict`).getByRole("button", { name: "Check strictly" }).click();
  await page.waitForFunction((sel) => /read strictly/.test(document.querySelector(sel)?.textContent ?? ""), `${lastLi} .chat-answer`, { timeout: 15000 });
  await until(page, async () => (await indexedDB.databases()).length > 0);
  await page.waitForTimeout(1200);
  await page.reload({ waitUntil: "networkidle" });
  ok(/read strictly/.test(await page.locator(`${lastLi} .chat-answer`).innerText()) && /shortened/.test(await page.locator(`${lastLi} .chat-left-out`).innerText()) && await page.locator(`${lastLi} .chat-strict`).count() === 0, "after a reload the answer that was checked strictly is kept, with what was done to it");

  console.log("a silent wait says so");
  await page.evaluate(() => sessionStorage.setItem("scholar.quiet.ms", "1500")); // production waits 15 s
  await send("stalled glaucoma screening", { tool: "Search papers" });
  await page.locator(".chat-quiet").waitFor({ timeout: 6000 });
  ok(/Still working/.test(await page.locator(".chat-quiet").innerText()) && await page.locator(".chat-quiet").getAttribute("role") === "status", "after a silence the reply says 'Still working…' (a polite status for a screen reader)");
  await page.locator(".chat-turn .result").first().waitFor({ timeout: 10000 });
  await page.locator(".chat-quiet").waitFor({ state: "detached", timeout: 6000 });
  ok(true, "and the line goes as soon as the server speaks again");
  await page.locator('.chat-turn[data-status="done"]').last().waitFor({ timeout: 30000 });
  await page.evaluate(() => sessionStorage.removeItem("scholar.quiet.ms"));

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
  await settled(page);
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
  // the papers are kept a moment after they arrive (a save at most every 800 ms): waited for in what is kept, not for a time (on a busy machine a fixed wait was too short)
  await until(page, async () => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open("scholar"); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const all = await new Promise((resolve) => { const q = db.transaction("chats").objectStore("chats").getAll(); q.onsuccess = () => resolve(q.result); });
    db.close();
    return all.some((c) => c.messages.some((m) => m.role === "assistant" && m.status === "working" && m.papers.length > 0));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('.chat-turn[data-status="interrupted"]').waitFor({ timeout: 15000 });
  ok(/interrupted/.test(await page.locator('.chat-turn[data-status="interrupted"]').innerText()) && await page.locator('.chat-turn[data-status="interrupted"] .result').count() > 0, "the reply is marked interrupted and keeps the papers that had come");
  await page.locator('.chat-turn[data-status="interrupted"]').getByRole("button", { name: "Search again" }).click();
  await page.locator('.chat-turn[data-status="done"]').waitFor({ timeout: 30000 });
  ok(true, "'Search again' finishes it");

  console.log("Change");
  await page.locator(".ws-rail").getByRole("button", { name: "New chat" }).click();
  await send("Mere thesis ke references check karo aur batao ki kya yeh idea pehle se kisi ne kiya hai");
  await page.locator('.chat-turn[data-status="done"]').waitFor({ timeout: 30000 });
  await page.locator(".chat-change").click();
  await page.getByRole("menuitem", { name: /Idea Check/ }).click();
  await page.locator(".chat-idea").waitFor({ timeout: 10000 });
  ok(new URL(page.url()).pathname === "/" && /Mere thesis/.test(await page.locator(".chat-idea textarea").first().inputValue()), "'Change' to Idea Check opens it under the same text, inside the conversation");

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
  ok(new URL(page.url()).pathname === "/" && /searches only after you have seen and approved the search plan/.test(await page.locator(".chat-offer").last().innerText()), "an idea is offered to Idea Check, which starts only by a click and an approval: the page did not move");
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

  await settled(page);
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

  console.log("Indian sources");
  await page.locator(".chat-head").getByRole("button", { name: "New chat" }).click();
  await page.locator(".hm-title").waitFor();
  const scopeBtn = page.locator(".hm-scope");
  ok(await scopeBtn.isVisible() && (await scopeBtn.getAttribute("aria-pressed")) === "false", "the box has an 'Indian sources' switch, off");
  await scopeBtn.click();
  ok((await scopeBtn.getAttribute("aria-pressed")) === "true" && /Indian sources is on: only journals published in India/.test(await page.locator(".hm-fine").innerText()), "pressed, it is on, and the line under the box says where the search will look");
  await pick(page, "Idea Check");
  ok(await page.locator(".hm-scope").count() === 0, "it is not offered for a tool that does not search");
  await send("glaucoma screening");
  await lastDone().waitFor({ timeout: 30000 });
  const indTurn = turns().last();
  ok(/Searched only Indian sources/.test(await indTurn.locator(".chat-und").allInnerTexts().then((x) => x.join(" "))), "the reply says it searched only Indian sources");
  ok(await indTurn.locator(".result").count() === 3, "the papers from the Indian sources are listed");
  const thesisCard = indTurn.locator(".result", { hasText: "glaucoma awareness among adults in Karnataka" });
  ok(await thesisCard.getByText("Thesis", { exact: true }).isVisible(), "a thesis says it is one");
  const shodh = thesisCard.getByRole("link", { name: /^Open on Shodhganga/ });
  ok((await shodh.getAttribute("href")) === "https://shodhganga.inflibnet.ac.in/handle/10603/00001" && (await thesisCard.locator(".result-title a").getAttribute("href")) === "https://shodhganga.inflibnet.ac.in/handle/10603/00001", "its title and its 'Shodhganga' button open its page on Shodhganga");
  ok(await page.locator(".chat-answer").last().isVisible(), "an answer is written from the papers that have an abstract");
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await axe("Indian sources, a conversation with a thesis", page);
  await thesisCard.scrollIntoViewIfNeeded();
  await page.screenshot({ path: OUT + "6-indian-sources.png" });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".chat-turn").first().waitFor({ timeout: 15000 });
  ok((await page.locator(".hm-scope").getAttribute("aria-pressed")) === "true", "the switch is remembered on this device");
  await indTurn.waitFor();
  ok(/Searched only Indian sources/.test(await turns().last().innerText()), "and the reply still says where it looked after a reload");
  await page.locator(".hm-scope").click();
  ok((await page.locator(".hm-scope").getAttribute("aria-pressed")) === "false" && await page.evaluate(() => localStorage.getItem("scholar.scope")) === null, "turned off, it is forgotten");
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(400);
  ok(await noSideways(page) && await page.locator(".hm-scope").isVisible(), "on a narrow phone the switch keeps to its icon, and nothing scrolls sideways");
  await page.setViewportSize({ width: 1360, height: 900 });

  console.log("Settings and signing out");
  await page.locator(".ws-rail").getByRole("link", { name: "Settings" }).click();
  await page.getByRole("heading", { name: "Chats" }).waitFor();
  ok(/only in this browser/.test(await page.locator(".settings-sec", { has: page.getByRole("heading", { name: "Chats" }) }).innerText()), "Settings says the chats are kept only in this browser");
  // (what is about to be removed includes the owner and the words each chat is found by: they are part of the list)
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("scholar.chats.v1") ?? "[]"));
  ok(kept.length > 0 && kept.every((e) => typeof e.owner === "string") && kept.some((e) => typeof e.kw === "string" && e.kw.length > 0), `before signing out the list holds each chat's owner and the words it is found by (${kept.length} chats)`);
  await page.locator(".ws-rail").getByRole("button", { name: "Sign out" }).click();
  await page.locator(".ws-anon").waitFor({ timeout: 20000 });
  const left = await page.evaluate(async () => ({
    index: localStorage.getItem("scholar.chats.v1"),
    active: sessionStorage.getItem("scholar.chat.active"),
    stored: await new Promise((resolve) => { const r = indexedDB.open("scholar"); r.onerror = () => resolve(-1); r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains("chats")) return resolve(0); const c = db.transaction("chats").objectStore("chats").count(); c.onsuccess = () => resolve(c.result); }; }),
  }));
  ok(left.index === null && left.active === null && left.stored === 0, "signing out removes every conversation from this browser, with the owner and the words in the list");

  console.log("without signing in");
  const anon = await newCtx();
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
  await ap.waitForTimeout(900); // the cards and the reply are still fading in: axe would read half-transparent colours
  await ap.evaluate(() => window.scrollTo(0, 0)); // axe reads what is on screen: the box at the bottom covers part of whatever is scrolled under it
  await axe("conversation, signed out", ap);
  await ap.locator(".hm-input").fill("check my references please");
  await ap.keyboard.press("Enter");
  await ap.locator(".chat-offer").waitFor({ timeout: 20000 });
  ok(/Check references/.test(await ap.locator(".chat-und").last().innerText()), "the words of a tool are enough for it to be offered, with no model");
  // small talk, joined or not (docs/design/not-research.md): the page answers it, in the language it was written in, and never leaves the reader at a dead end
  const talkTurn = () => ap.locator(".chat-turn").last();
  const talkDone = () => ap.waitForFunction(() => !document.querySelector('.chat-turn[data-status="working"]'), null, { timeout: 30000 });
  await ap.locator(".hm-input").fill("Hey How are you?");
  await ap.keyboard.press("Enter");
  await ap.locator(".chat-talk").waitFor({ timeout: 20000 });
  const talkText = await talkTurn().innerText();
  ok(/Hello! I'm doing well, thank you\. This box finds research papers and answers from them/.test(talkText) && !/I understood this as/.test(talkText) && await talkTurn().locator(".result").count() === 0, "'Hey How are you?' in Auto: a greeting answered by the page, with no 'I understood this as Search papers' and no papers");
  ok(await talkTurn().locator(".chat-talk .chip-btn").count() === 4 && await talkTurn().getByRole("button", { name: "Search for these words anyway" }).isVisible(), "...with example searches to click and a way to search the words anyway");
  await ap.waitForTimeout(900);
  await ap.evaluate(() => window.scrollTo(0, 0));
  await axe("small talk reply", ap);
  const turnsBefore = await ap.locator(".chat-turn").count();
  await talkTurn().locator(".chat-talk .chip-btn").first().click();
  await ap.waitForFunction((n) => document.querySelectorAll(".chat-turn").length > n, turnsBefore, { timeout: 20000 });
  await talkDone();
  ok(/graph neural networks/.test(await ap.locator(".chat-list").innerText()) && await talkTurn().locator(".result").count() > 0, "an example search sends that search at once");
  await ap.locator(".hm-input").fill("hello bhai kaise ho");
  await ap.keyboard.press("Enter");
  await ap.waitForFunction(() => /Namaste!/.test([...document.querySelectorAll(".chat-turn")].at(-1)?.textContent ?? ""), null, { timeout: 20000 });
  ok(/Namaste! Main theek hu, shukriya\. Ye box research papers dhundta hai/.test(await talkTurn().innerText()), "a Hinglish greeting gets a Hinglish reply");
  await talkTurn().getByRole("button", { name: "Search for these words anyway" }).click();
  await talkDone();
  ok(/Searching papers, as you chose/.test(await talkTurn().innerText()) && await talkTurn().locator(".chat-talk").count() === 0 && !/Namaste!/.test(await talkTurn().innerText()), "'Search for these words anyway' searches them as written, in the same place");
  await anon.close();

  console.log("the page does not move under the reader");
  // While a conversation is on screen the box is fixed to the bottom of the window. A rule meant to keep focused things clear of it (scroll-padding on the whole page) also applied to the
  // box's own text field, so the browser kept trying to scroll the field out from behind the box it sits in: the page crept down with every letter typed, and jumped when the logo focused the field.
  const still = await newCtx({ viewport: { width: 1360, height: 560 } });
  const sp = await still.newPage();
  watch(sp);
  await sp.goto(BASE + "/home", { waitUntil: "networkidle" });
  await sp.locator("#hm-h").waitFor({ timeout: 20000 });
  ok(await sp.locator("footer.footer").count() === 1, "the footer (sources, How we verify, Privacy, Terms) is on the home screen");
  const settle = (p) => p.waitForFunction(() => !document.querySelector('.chat-turn[data-status="working"]') && document.querySelectorAll(".chat-turn").length > 0, null, { timeout: 30000 });
  const scrollY = (p) => p.evaluate(() => Math.round(window.scrollY));
  for (const q of ["glaucoma screening", "diabetic retinopathy"]) {
    await sp.locator(".hm-input").fill(q);
    await sp.keyboard.press("Enter");
    await settle(sp);
    await sp.waitForTimeout(700);
  }
  const room = await sp.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  ok(room > 1200, `(two searches make a page long enough to scroll: ${room}px)`);
  ok(await sp.locator("footer.footer").count() === 0, "once a search has been asked the footer is not shown under the conversation");
  await sp.evaluate(() => window.scrollTo(0, 400));
  const rest = await scrollY(sp);
  await sp.locator(".hm-input").click();
  await sp.waitForTimeout(150);
  ok(await scrollY(sp) === rest, `clicking into the box does not scroll the page (${rest} then ${await scrollY(sp)})`);
  let crept = 0;
  for (const ch of "and what about the cost of screening in rural clinics") {
    await sp.keyboard.type(ch);
    await sp.waitForTimeout(25);
    if (await scrollY(sp) !== rest) crept++;
  }
  ok(crept === 0, `typing in the box does not move the page (it moved on ${crept} of 53 letters)`);
  await sp.keyboard.type(" and then a much longer follow up that keeps going so that the box has to wrap onto a second and a third line, because that is how a real person writes a question");
  await sp.waitForTimeout(300);
  ok(await sp.evaluate(() => document.querySelector(".hm-input").clientHeight > 40), "(the box grew to a second line)");
  ok(await scrollY(sp) === rest, `...nor when the box grows to more lines (${rest} then ${await scrollY(sp)})`);
  await sp.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const end = await scrollY(sp);
  await sp.keyboard.type(" and one more thing");
  await sp.waitForTimeout(200);
  ok(errors.length === 0, `typing a long question after a search raises no error (React stops at 50 nested updates in a row: ${errors.length ? errors[0].slice(0, 60) : "none raised"})`);
  ok(Math.abs(await scrollY(sp) - end) <= 1, `...and at the very end of the page it stays where it is (${end} then ${await scrollY(sp)})`);
  await sp.evaluate(() => window.scrollTo(0, 600));
  await sp.locator(".ws-logo").click();
  await sp.waitForTimeout(500);
  ok(await scrollY(sp) === 0, `the logo brings the reader to the top of the page, not down it (${await scrollY(sp)})`);
  ok(await sp.evaluate(() => document.activeElement?.classList.contains("hm-input")), "...with the box ready to type in");
  // what the page rule was for: a focused button in the conversation must not end up behind the box (WCAG 2.4.11 Focus Not Obscured)
  await sp.evaluate(() => window.scrollTo(0, 0));
  await sp.locator(".chat-turn").last().locator(".result").last().getByRole("button").last().focus();
  await sp.waitForTimeout(150);
  const clear = await sp.evaluate(() => ({ bottom: document.activeElement.getBoundingClientRect().bottom, boxTop: document.querySelector(".hm-box").getBoundingClientRect().top }));
  ok(clear.bottom <= clear.boxTop + 1, `a button reached by the keyboard is scrolled clear of the box (its bottom ${Math.round(clear.bottom)}, the box starts at ${Math.round(clear.boxTop)})`);
  await sp.getByRole("button", { name: "New chat" }).first().click();
  await sp.locator("footer.footer").waitFor({ timeout: 5000 });
  ok(true, "...and a new chat brings it back");
  await still.close();

  console.log("storage that refuses");
  const blocked = await newCtx();
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
  if (!(e instanceof Stop)) {
    console.log(" FAIL unexpected error:", e);
    failures++;
  }
} finally {
  await browser.close();
  idp.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall chat browser checks passed");
  process.exit(failures ? 1 : 0);
}
