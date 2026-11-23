// Browser e2e for live presence and live updates in a shared paper (docs/design/paper-live.md, section 6): written for SHARE, READER and LIVE "on" (the named run share-on starts the Worker so;
// scripts/lib/suites.mjs). Two browser contexts, the owner and an editor, on one paper: the avatar appears ("1 person here"), the list says "Viewing p. 3", a block the editor types in shows
// Bela's small avatar on the owner's side (its tooltip on hover, focus and a tap) and her caret at the right letter, a saved block and a comment appear without a reload, a page tab carries the editor's dot, "Go to where" jumps, axe in Light, Dark and Read, a phone.
// With LIVE_SHOTS=<folder> it also takes the owner's pictures (the row and its list in Light and Dark, a block being edited, a tab with a dot, a phone, Reconnecting…).
//   node e2e/live.mjs [baseUrl]    (default http://localhost:8788; SHARE, READER and LIVE must be on there)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { SAMPLE_PAPER, makePdf } from "@scholar/test-support/make-pdf.mjs";
import { BASE, axeCheck, countFailure, desk, finish, launch, noSideways, ok, phone, setTheme, sleep, startIdp, watchPage } from "./lib/browser.mjs";

const SHOTS = process.env.LIVE_SHOTS ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = async (p, name, clip) => {
  if (SHOTS) await p.screenshot({ path: join(SHOTS, `${name}.png`), ...(clip ? { clip } : {}) });
};

const idp = await startIdp();
const browser = await launch();
const errors = [];
const watch = (p) => watchPage(p, errors);
const axe = (p, label, context) => axeCheck(p, label, { inlineCites: true, context });
const OWNER = { sub: "live-owner", email: "asha.owner@example.edu", email_verified: true, name: "Asha Owner" };
const EDITOR = { sub: "live-editor", email: "bela.e@example.edu", email_verified: true, name: "Bela Editor" };

async function signedIn(who, view = desk(1280, 860)) {
  idp.setUser(who);
  const c = await browser.newContext(view);
  const p = await c.newPage();
  watch(p);
  await p.goto(BASE + "/", { waitUntil: "networkidle" });
  await p.locator(".in-head").getByRole("button", { name: /^Sign in$/ }).click();
  await p.getByRole("button", { name: "Continue with Google" }).last().click();
  await p.locator("#hm-h").waitFor({ timeout: 20000 });
  await sleep(600);
  return { c, p };
}
const api = (p, path, method = "GET", body) => p.request.fetch(BASE + path, { method, headers: { Origin: BASE, "Content-Type": "application/json" }, data: body === undefined ? undefined : JSON.stringify(body) });
const openPaper = async (p, docId) => {
  await p.goto(`${BASE}/papers/${docId}`, { waitUntil: "networkidle" });
  await p.locator(".desk").waitFor({ timeout: 30000 });
  await p.locator('[data-page="1"] .textLayer span').first().waitFor({ timeout: 30000 });
};
const row = (p) => p.locator(".lv-row");

try {
  /* ================================================================ a paper with a page of notes, shared with an editor */
  const { c: oc, p: op } = await signedIn(OWNER);
  await op.goto(BASE + "/papers", { waitUntil: "networkidle" });
  const handled = op.getByRole("region", { name: /how your papers are handled/ });
  if (await handled.count()) {
    await handled.getByRole("button", { name: "I understand, continue" }).click();
    await handled.waitFor({ state: "detached", timeout: 8000 });
  }
  await op.locator('input[type="file"]').setInputFiles({ name: "live_paper.pdf", mimeType: "application/pdf", buffer: makePdf(SAMPLE_PAPER, { title: "Glaucoma screening" }) });
  await op.waitForFunction(() => document.querySelector(".dc")?.getAttribute("data-status") === "ready", null, { timeout: 60000 });
  const docId = (await (await op.request.get(BASE + "/api/v1/documents")).json()).items[0].id;
  const D = `/api/v1/documents/${docId}`;
  const hl = await (await api(op, `${D}/notes`, "POST", { page: 1, quote: "glaucoma screening program", color: "pink" })).json();
  await api(op, `${D}/notebook/pages/p1`, "PUT", { title: "Methods", blocks: [{ id: "b1", kind: "text", md: "Who was recruited" }, { id: "b2", kind: "text", md: "How they were seen" }] });
  await api(op, `/api/v1/share/papers/${docId}/members`, "POST", { email: EDITOR.email, role: "editor" });
  await openPaper(op, docId);
  // the row keeps its place before anyone comes (no layout shift)
  const slot = op.locator(".lv, .desk-live-wait").first();
  const before = await slot.boundingBox();
  ok(before !== null && Math.round(before.width) === 116, "the header keeps the presence row's width while nobody else is here");

  /* ================================================================ the editor comes: the avatar, the list */
  const { p: ep } = await signedIn(EDITOR);
  await openPaper(ep, docId);
  console.log("presence");
  await row(op).waitFor({ timeout: 15000 });
  ok((await row(op).getAttribute("aria-label")) === "1 person here", "the owner sees a button \"1 person here\"");
  const after = await op.locator(".lv").boundingBox();
  ok(after && before && Math.abs(after.x - before.x) < 1 && Math.abs(after.width - before.width) < 1, "the row did not move or grow when the editor came");
  const av = op.locator(".lv-row .lv-av").first();
  ok((await av.textContent()) === "B", "Bela's avatar shows her initial");
  ok((await av.evaluate((e) => getComputedStyle(e).width)) === "24px", "the avatar is 24 px");
  ok((await av.evaluate((e) => getComputedStyle(e).boxShadow)).includes("0px 0px 0px 2px"), "with a 2 px ring");
  ok((await row(ep).getAttribute("aria-label")) === "1 person here" && (await ep.locator(".lv-row .lv-av").first().textContent()) === "A", "the editor sees the owner (and never herself)");
  await ep.getByRole("button", { name: "Go to page 3" }).click().catch(async () => ep.evaluate(() => document.querySelector('[data-page="3"]')?.scrollIntoView()));
  await sleep(1500);
  await row(op).click();
  const list = op.getByRole("dialog", { name: "People on this paper" });
  await list.waitFor({ timeout: 5000 });
  await sleep(400);
  ok(await list.getByText("Viewing p. 3").isVisible(), "the list says \"Viewing p. 3\"");
  const lb = await list.boundingBox();
  ok(lb && lb.x >= 0 && lb.x + lb.width <= 1280 && lb.y > 50, "the list sits under the row, inside the window");
  await shot(op, "row-and-list-light");
  await setTheme(op, "dark", 400);
  await shot(op, "row-and-list-dark");
  for (const theme of ["light", "dark", "read"]) {
    await setTheme(op, theme, 250);
    await axe(op, `the presence list, ${theme}`, ".desk-head");
  }
  await setTheme(op, "light");
  await op.keyboard.press("Escape");
  ok(!(await list.isVisible()), "Esc closes the list");
  ok(await op.locator('.thumb[aria-label*="Bela Editor is here"]').count() === 1, "the thumbnail of page 3 carries Bela's dot and says so");

  /* ================================================================ the notes: the tab dot, "is editing", a saved block */
  console.log("the notes");
  await op.getByRole("button", { name: "Split" }).click().catch(() => {});
  await ep.getByRole("button", { name: "Split" }).click().catch(() => {});
  await ep.getByRole("tab", { name: /^Methods/ }).click();
  const eb = ep.locator('.nb [data-block="b2"]');
  await eb.click();
  await sleep(1200);
  const edge = op.locator('.nb [data-block="b2"][data-live-edit]');
  await edge.waitFor({ timeout: 10000 });
  ok(await edge.evaluate((e) => { const b = getComputedStyle(e, "::before"); return b.width === "3px" && b.backgroundColor !== "rgba(0, 0, 0, 0)"; }), "with a thin coloured edge (3 px)");
  ok(await op.getByRole("tab", { name: /Methods.*Bela Editor is here/ }).count() === 1, "the page tab carries Bela's dot and says so");
  // the marker is a small avatar only: the words are its name and its tooltip
  const mk = op.getByRole("button", { name: "Bela Editor is editing this block" });
  ok((await mk.count()) === 1 && (await mk.textContent()) === "B", "the block carries Bela's small avatar, named \"Bela Editor is editing this block\"");
  ok(!((await edge.innerText()) ?? "").includes("is editing"), "with no visible name beside it");
  ok(await mk.evaluate((e) => { const a = getComputedStyle(e.firstElementChild); return a.width === "20px" && a.boxShadow.includes("0px 0px 0px 2px") && e.getBoundingClientRect().width === 24; }), "20 px, with a 2 px ring, in a 24 px button");
  const tip = op.getByRole("tooltip");
  const B2 = '.nb [data-block="b2"]';
  const blockClip = async (p, up = 24) => { const b = await p.locator(B2).boundingBox(); const n = await p.locator(".nb").first().boundingBox(); return { x: n.x, y: b.y - up, width: n.width, height: b.height + up + 16 }; };
  await mk.hover();
  await tip.waitFor({ timeout: 3000 });
  ok((await tip.textContent()) === "Bela Editor is editing", "pointing at it shows the tooltip \"Bela Editor is editing\"");
  ok((await mk.getAttribute("aria-describedby")) === (await tip.getAttribute("id")), "the avatar is described by its tooltip");
  const tb = await tip.boundingBox();
  ok(tb && tb.x >= 0 && tb.y >= 0 && tb.x + tb.width <= 1280, "the tooltip is inside the window");
  ok(await tip.evaluate((e) => { const r = e.getBoundingClientRect(); const y = (r.top + r.bottom) / 2; return [[r.left + 10, y], [r.right - 10, y]].every(([x, y]) => document.elementFromPoint(x, y)?.closest(".lv-tip") === e); }), "and drawn whole, over everything (the panel does not cut it)");
  await sleep(300);
  await shot(op, "avatar-tooltip");
  await shot(op, "avatar-tooltip-close", await blockClip(op, 60));
  await op.keyboard.press("Escape");
  await tip.waitFor({ state: "detached", timeout: 2000 });
  ok(true, "Esc closes the tooltip");
  await op.mouse.move(5, 500);
  await mk.focus();
  await tip.waitFor({ timeout: 3000 });
  ok(true, "keyboard focus on the avatar shows the tooltip too");
  await op.keyboard.press("Escape");
  await mk.blur();

  console.log("the caret");
  // the editor puts the cursor in the middle of "they" (offset 6 of "How they were seen"): the owner's caret stands at that letter
  const caretAt = async (n) => {
    await ep.keyboard.press("Home");
    for (let i = 0; i < n; i++) await ep.keyboard.press("ArrowRight");
  };
  const caretX = () => op.evaluate((sel) => { const c = document.querySelector(`${sel} .lv-caret`); if (!c) return null; const r = c.getBoundingClientRect(); return r.left + r.width / 2; }, B2);
  const letterX = (i) => op.evaluate(([sel, i]) => { const t = document.querySelector(`${sel} .nb-text`); const w = document.createTreeWalker(t, NodeFilter.SHOW_TEXT); const n = w.nextNode(); const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1); return r.getBoundingClientRect().left; }, [B2, i]);
  await caretAt(6);
  await op.locator(`${B2} .lv-caret`).waitFor({ timeout: 5000 });
  await sleep(500);
  let cx = await caretX();
  let lx = await letterX(6);
  ok(cx !== null && Math.abs(cx - lx) < 2, `the owner sees Bela's caret in the middle of "they" (${cx?.toFixed(1)} against ${lx.toFixed(1)})`);
  ok(await op.locator(`${B2} .lv-caret`).evaluate((e) => getComputedStyle(e, "::before").animationName === "lv-blink" && getComputedStyle(e, "::before").width === "2px"), "a 2 px line, blinking");
  await shot(op, "caret-mid-word");
  await shot(op, "caret-mid-word-close", await blockClip(op));
  await op.locator(`${B2} .lv-caret`).hover({ force: true });
  await sleep(300);
  ok(await op.locator(`${B2} .lv-flag`).evaluate((e) => getComputedStyle(e).visibility === "visible" && e.textContent === "Bela Editor"), "pointing at the caret shows Bela's name on its flag");
  await shot(op, "caret-flag", await blockClip(op, 30));
  await op.mouse.move(5, 500);
  await caretAt(9);
  await op.waitForFunction(([sel, x]) => { const c = document.querySelector(`${sel} .lv-caret`); return c && Math.abs(c.getBoundingClientRect().left + c.getBoundingClientRect().width / 2 - x) > 4; }, [B2, cx], { timeout: 5000 });
  await sleep(300);
  cx = await caretX();
  lx = await letterX(9);
  ok(cx !== null && Math.abs(cx - lx) < 2, "the caret moves when Bela moves her cursor (to the start of \"were\")");
  await op.locator(`${B2} .lv-cr[data-faded]`).waitFor({ state: "attached", timeout: 6000 });
  ok(true, "it fades when it has not moved for a few seconds");
  await caretAt(4);
  await op.locator(`${B2} .lv-cr:not([data-faded])`).waitFor({ state: "attached", timeout: 4000 });
  ok(true, "and comes back when it moves");
  await shot(op, "block-being-edited");
  await shot(op, "tab-with-avatar", await op.locator(".nb-tabsrow").boundingBox());
  await caretAt(6);
  await sleep(400);
  await shot(op, "block-avatar-light", await blockClip(op));
  await setTheme(op, "dark", 400);
  await caretAt(6);
  await sleep(400);
  await shot(op, "block-avatar-dark", await blockClip(op));
  await mk.hover();
  await tip.waitFor({ timeout: 3000 });
  await sleep(300);
  await shot(op, "avatar-tooltip-dark", await blockClip(op, 60));
  await op.mouse.move(5, 500);
  for (const theme of ["light", "dark", "read"]) {
    await setTheme(op, theme, 250);
    await caretAt(6);
    await sleep(300);
    await axe(op, `the block's avatar and caret, ${theme}`, ".nb");
  }
  await setTheme(op, "light");
  await ep.keyboard.press("End");
  await ep.keyboard.type(", in the clinic");
  await ep.keyboard.press("Escape");
  await op.locator(".nb", { hasText: "How they were seen, in the clinic" }).waitFor({ timeout: 8000 });
  ok(true, "the editor's saved block appears on the owner's page without a reload");
  await ep.locator('.nb [data-block="b1"]').click();
  await ep.keyboard.press("End");
  await ep.keyboard.type(" (adults)");
  await op.locator('.nb [data-block="b1"]').click();
  await op.keyboard.press("End");
  await op.keyboard.type(" over 40");
  await sleep(3500);
  ok(((await op.locator('.nb [data-block="b1"]').textContent()) ?? "").includes("over 40"), "both typing in one block: the owner keeps theirs (the merge of section 19)");

  /* ================================================================ a comment, live */
  console.log("comments");
  // the header's Comments button shows only once the paper has a comment: a comment from the other window brings it, without a reload
  ok((await op.getByRole("button", { name: /^Comments/ }).count()) === 0, "no comment yet: no Comments button in the notes page's header");
  await api(ep, `/api/v1/share/papers/${docId}/comments`, "POST", { anchor: `note:${hl.note.id}`, body: "Is this the main claim?" });
  await op.getByRole("button", { name: /^Comments/ }).waitFor({ timeout: 8000 });
  ok(true, "a comment from another window brings the Comments button, without a reload");
  await op.getByRole("button", { name: /^Comments/ }).click();
  await op.getByText("Is this the main claim?").waitFor({ timeout: 8000 });
  ok(true, "a comment appears on the owner's side without a reload");
  ok(await op.locator(".desk-comments-filter, .cm-head").first().isVisible(), "the comments panel is open");

  /* ================================================================ Go to where */
  await ep.keyboard.press("Escape");
  await ep.locator('.thumb[aria-label^="Go to page 2"]').click();
  await sleep(1500);
  await row(op).click();
  await op.getByRole("dialog", { name: "People on this paper" }).getByText("Viewing p. 2").waitFor({ timeout: 8000 });
  await op.getByRole("button", { name: "Go to where Bela Editor is" }).click();
  await sleep(1200);
  ok((await op.locator(".thumb[aria-current=true]").getAttribute("aria-label"))?.startsWith("Go to page 2"), "Go to where Bela Editor is takes the owner to page 2");

  /* ================================================================ a phone */
  console.log("a phone");
  const pc = await browser.newContext({ ...phone(390, 760), storageState: await oc.storageState() });
  const pp = await pc.newPage();
  watch(pp);
  await openPaper(pp, docId);
  await pp.locator(".lv-row").waitFor({ timeout: 15000 });
  ok((await pp.locator(".lv-row .lv-av").count()) === 1, "a phone shows one stacked avatar");
  ok(await noSideways(pp), "no sideways scroll on a phone");
  await pp.locator(".lv-row").click();
  await pp.getByRole("dialog", { name: "People on this paper" }).waitFor({ timeout: 5000 });
  await sleep(400);
  const sheet = await pp.getByRole("dialog", { name: "People on this paper" }).boundingBox();
  ok(sheet && sheet.x >= 0 && sheet.x + sheet.width <= 390 && sheet.y > 40, "on a phone the list is a sheet under the row, inside the screen");
  await shot(pp, "phone-presence");
  await axe(pp, "the presence list, phone", ".desk-head");
  await pp.keyboard.press("Escape");
  // a tap on a block's avatar shows the name
  await ep.locator(B2).click();
  await pp.getByRole("radio", { name: "Notes" }).click();
  const pmk = pp.getByRole("button", { name: "Bela Editor is editing this block" });
  await pmk.waitFor({ timeout: 10000 });
  ok(await pmk.evaluate((e) => { const r = e.getBoundingClientRect(); const b = getComputedStyle(e, "::before"); return r.width === 24 && b.position === "absolute" && b.left === "-10px"; }), "on a phone the avatar has a 44 px place to tap");
  await pmk.tap();
  const ptip = pp.getByRole("tooltip");
  await ptip.waitFor({ timeout: 3000 });
  ok((await ptip.textContent()) === "Bela Editor is editing", "a tap on the avatar shows \"Bela Editor is editing\"");
  const ptb = await ptip.boundingBox();
  ok(ptb && ptb.x >= 0 && ptb.x + ptb.width <= 390 && ptb.y >= 0, "inside the screen");
  ok(await ptip.evaluate((e) => { const r = e.getBoundingClientRect(); const y = (r.top + r.bottom) / 2; return [[r.left + 10, y], [r.right - 10, y]].every(([x, y]) => document.elementFromPoint(x, y)?.closest(".lv-tip") === e); }), "drawn whole, over the toolbar");
  ok(await noSideways(pp), "no sideways scroll with the tooltip shown");
  await sleep(300);
  await shot(pp, "phone-avatar-tap");
  await pp.locator(".nb-bar").tap().catch(() => {});
  await ptip.waitFor({ state: "detached", timeout: 3000 });
  ok(true, "a tap elsewhere closes it");
  await axe(pp, "the block's avatar, phone", ".nb");
  await ep.keyboard.press("Escape");
  await pc.close();

  /* ================================================================ Reconnecting…: the socket is dropped and refused for a while (Playwright stands between the page and the room) */
  console.log("reconnecting");
  const rp = await oc.newPage();
  watch(rp);
  let held = null;
  let refuse = false;
  await rp.routeWebSocket(/\/live$/, (ws) => {
    if (refuse) return void ws.close({ code: 4000, reason: "test" });
    held = ws;
    ws.connectToServer();
  });
  await openPaper(rp, docId);
  await row(rp).waitFor({ timeout: 15000 });
  refuse = true;
  held?.close({ code: 4000, reason: "test" });
  await sleep(2500);
  ok((await rp.locator(".lv-line").count()) === 0, "no \"Reconnecting…\" in the first seconds without a connection");
  await rp.locator(".lv-line", { hasText: "Reconnecting…" }).waitFor({ timeout: 10000 });
  ok(true, "\"Reconnecting…\" after 5 s without a connection");
  await shot(rp, "reconnecting", { x: 560, y: 0, width: 720, height: 110 });
  refuse = false;
  await row(rp).waitFor({ timeout: 40000 });
  await rp.locator(".lv-line").waitFor({ state: "detached", timeout: 5000 });
  ok(true, "back: the line goes and the row comes back");
  await rp.close();
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  countFailure();
}
ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
await browser.close();
await idp.close?.();
finish("all live browser checks passed", (n) => `${n} check(s) FAILED`);
