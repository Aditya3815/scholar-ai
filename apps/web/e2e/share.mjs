// Browser e2e for sharing a paper's workspace (docs/design/paper-share.md, section 9): written for SHARE "on" and READER "on" (the named run share-on starts the Worker so;
// scripts/lib/suites.mjs). The Share dialog on a wide screen and a phone (labelled, menus, focus back to Share, Remove with Undo, the link opened to anyone), "Shared with me", the shared
// reader per role (Viewer: no tools, no Agents; Commenter: comments on a highlight and a block; Editor: highlights), a visitor through the link signed out, and axe in Light, Dark and Read.
// With SHARE_SHOTS=<folder> it also takes the owner's pictures.
//   node e2e/share.mjs [baseUrl]    (default http://localhost:8788; SHARE and READER must be on there)
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { SAMPLE_PAPER, makePdf } from "@scholar/test-support/make-pdf.mjs";
import { BASE, axeCheck, countFailure, desk, finish, launch, noSideways, ok, phone, setTheme, sleep, startIdp, watchPage } from "./lib/browser.mjs";

const SHOTS = process.env.SHARE_SHOTS ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = async (p, name) => {
  if (SHOTS) await p.screenshot({ path: join(SHOTS, `${name}.png`) });
};

const idp = await startIdp();
const browser = await launch();
const errors = [];
const watch = (p) => watchPage(p, errors);
const axe = (p, label, context) => axeCheck(p, label, { inlineCites: true, context });
const OWNER = { sub: "share-owner", email: "asha.owner@example.edu", email_verified: true, name: "Asha Owner" };
const COMMENTER = { sub: "share-commenter", email: "ravi.c@example.edu", email_verified: true, name: "Ravi Commenter" };
const VIEWER = { sub: "share-viewer", email: "sara.v@example.edu", email_verified: true, name: "Sara Viewer" };
const EDITOR = { sub: "share-editor", email: "eli.e@example.edu", email_verified: true, name: "Eli Editor" };

/** A browser context signed in as `who` (through the page's own Sign in). */
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

try {
  /* ================================================================ the owner: a paper with a highlight and a page of notes */
  const { c: oc, p: op } = await signedIn(OWNER);
  await op.goto(BASE + "/papers", { waitUntil: "networkidle" });
  const handled = op.getByRole("region", { name: /how your papers are handled/ });
  if (await handled.count()) {
    await handled.getByRole("button", { name: "I understand, continue" }).click();
    await handled.waitFor({ state: "detached", timeout: 8000 });
  }
  await op.locator('input[type="file"]').setInputFiles({ name: "glaucoma_screening.pdf", mimeType: "application/pdf", buffer: makePdf(SAMPLE_PAPER, { title: "Glaucoma screening" }) });
  await op.waitForFunction(() => document.querySelector(".dc")?.getAttribute("data-status") === "ready", null, { timeout: 60000 });
  const docId = (await (await op.request.get(BASE + "/api/v1/documents")).json()).items[0].id;
  const D = `/api/v1/documents/${docId}`;
  const hl = await (await api(op, `${D}/notes`, "POST", { page: 1, quote: "glaucoma screening program", color: "pink", note: "The main claim" })).json();
  await api(op, `${D}/notebook/pages/p1`, "PUT", { title: "Methods", blocks: [{ id: "b1", kind: "text", md: "# Sample\nWho was **recruited**" }, { id: "b2", kind: "quote", noteId: hl.note.id, page: 1, quote: "glaucoma screening program", color: "pink" }] });
  await openPaper(op, docId);

  /* ================================================================ 1. the dialog, wide */
  console.log("the Share dialog");
  const shareBtn = op.getByRole("button", { name: "Share", exact: true });
  ok(await shareBtn.isVisible(), "the owner sees Share in the reader's header");
  // a short window: the head and the footer of the dialog stay in sight, its body scrolls
  await op.setViewportSize({ width: 1280, height: 720 });
  await shareBtn.click();
  const dlg = op.getByRole("dialog", { name: /^Share “/ });
  await dlg.waitFor({ timeout: 10000 });
  ok(await dlg.isVisible(), "a dialog labelled with the paper's title");
  ok((await dlg.getByRole("listitem").first().textContent())?.includes("Asha Owner (you)"), "People with access starts with the owner");
  const add = async (email, role) => {
    await dlg.getByLabel("Add people by e-mail").fill(email);
    await dlg.getByRole("button", { name: /^Role for the new person/ }).click();
    await op.getByRole("menuitemradio", { name: role }).click();
    await dlg.getByRole("button", { name: "Invite" }).click();
    await dlg.getByText(email).first().waitFor({ timeout: 10000 });
  };
  await add(COMMENTER.email, "Can comment");
  ok((await dlg.getByRole("status").filter({ hasText: "Invited ravi.c@example.edu. We e-mailed them." }).count()) === 1, "the dialog says the person was invited and e-mailed");
  await add(VIEWER.email, "Can view");
  await add(EDITOR.email, "Can edit");
  await add("temp.person@example.edu", "Can view");
  // Remove, then Undo
  await dlg.getByRole("button", { name: /^Access of temp\.person@example\.edu/ }).click();
  const menu = op.getByRole("menu", { name: /Access of temp\.person/ });
  ok(await menu.isVisible() && (await menu.getByRole("menuitemradio").count()) === 3, "a person's role is a menu of three (menuitemradio)");
  await menu.getByRole("menuitem", { name: "Remove" }).click();
  await sleep(400);
  const people = dlg.getByRole("list", { name: "People with access" });
  ok((await people.getByText("temp.person@example.edu").count()) === 0, "Remove takes them off");
  await dlg.getByRole("button", { name: "Undo" }).click();
  await people.getByText("temp.person@example.edu").first().waitFor({ timeout: 8000 });
  ok(true, "Undo puts them back");
  // general access: anyone with the link, as Commenter
  await dlg.getByRole("button", { name: /^General access/ }).click();
  await op.getByRole("menuitemradio", { name: "Anyone with the link" }).click();
  await dlg.getByRole("button", { name: /^People with the link are/ }).waitFor({ timeout: 8000 });
  await dlg.getByRole("button", { name: /^People with the link are/ }).click();
  await op.getByRole("menuitemradio", { name: "Commenter" }).click();
  await sleep(400);
  const token = await op.evaluate((id) => localStorage.getItem(`scholar.share.${id}`), docId);
  ok(typeof token === "string" && token.length === 43, "the link's token is kept on the owner's device (only its hash on the server)");
  ok((await dlg.getByRole("menuitemradio").count()) === 0, "menus close when a choice is made");
  const inSight = async (p, d, h) => {
    const done = await d.getByRole("button", { name: "Done" }).boundingBox();
    const title = await d.locator(".sh-title").boundingBox();
    return !!done && !!title && done.y + done.height <= h && title.y >= 0;
  };
  ok(await inSight(op, dlg, 720), "at 1280 by 720 the title and Done are both in sight (the body scrolls)");
  for (const theme of ["light", "dark", "read"]) {
    await setTheme(op, theme, 250);
    await axe(op, `the Share dialog, ${theme}`, ".sh-dialog");
    await shot(op, `dialog-desktop-${theme}`);
  }
  await setTheme(op, "light");
  await op.keyboard.press("Escape");
  await dlg.waitFor({ state: "detached", timeout: 5000 });
  ok(await op.evaluate(() => document.activeElement?.textContent?.trim() === "Share"), "Esc closes it and the focus goes back to Share");

  /* ================================================================ 2. the dialog on a phone: a bottom sheet */
  const pc = await browser.newContext({ ...phone(390, 700), storageState: await oc.storageState() });
  const pp = await pc.newPage();
  watch(pp);
  await openPaper(pp, docId);
  await pp.getByRole("button", { name: "Share", exact: true }).click();
  const sheet = pp.getByRole("dialog", { name: /^Share “/ });
  await sheet.waitFor({ timeout: 10000 });
  const box = await sheet.boundingBox();
  ok(!!box && Math.round(box.y + box.height) >= 699 && box.width >= 389, "on a phone the dialog is a sheet from the bottom, as wide as the screen");
  ok(await inSight(pp, sheet, 700), "at 390 by 700 the title and Done are both in sight");
  ok(await noSideways(pp), "no sideways scroll on a phone");
  await axe(pp, "the Share sheet, phone", ".sh-dialog");
  await shot(pp, "dialog-phone");
  await pc.close();

  /* ================================================================ 3. the Commenter: Shared with me, the banner, comments */
  console.log("the Commenter");
  const { c: cc, p: cp } = await signedIn(COMMENTER);
  await cp.goto(BASE + "/papers", { waitUntil: "networkidle" });
  const shared = cp.getByRole("region", { name: "Shared with me" });
  await shared.waitFor({ timeout: 15000 });
  ok(/glaucoma screening/i.test((await shared.textContent()) ?? "") && ((await shared.textContent()) ?? "").includes("Asha Owner · Can comment"), "Shared with me: the title, the owner and the role");
  await shared.scrollIntoViewIfNeeded();
  await shot(cp, "shared-with-me");
  await shared.locator(".shared-open").first().click();
  await cp.locator(".desk").waitFor({ timeout: 30000 });
  await cp.locator('[data-page="1"] .textLayer span').first().waitFor({ timeout: 30000 });
  const banner = cp.locator(".desk-shared-banner");
  ok((await banner.textContent())?.includes("Shared by Asha Owner · You can comment"), "the banner: Shared by Asha Owner · You can comment");
  ok((await cp.locator(".desk-tools").count()) === 0, "no tool segment for a Commenter");
  ok((await cp.getByRole("button", { name: "Share", exact: true }).count()) === 0, "no Share button");
  ok((await cp.getByRole("button", { name: "Rename this paper" }).count()) === 0, "no renaming");
  // a comment on the highlight, from its card
  await cp.getByRole("tab", { name: /Highlights/ }).click();
  await cp.getByRole("button", { name: /Comment on the highlight on page 1/ }).click();
  const write = cp.getByRole("textbox", { name: "Add a comment" });
  await write.waitFor({ timeout: 10000 });
  await write.fill("Is this the main result of the screening?");
  await cp.getByRole("button", { name: "Comment", exact: true }).click();
  await cp.locator(".cm-thread").filter({ hasText: "Is this the main result" }).waitFor({ timeout: 8000 });
  ok(true, "a comment on a highlight shows in its thread");
  // a comment on a block of the notes, from the read-only notes
  await cp.getByRole("button", { name: "All comments" }).click();
  await cp.getByRole("button", { name: "Back to notes" }).click();
  await cp.getByRole("button", { name: "Comment on this block" }).first().click();
  await cp.getByRole("textbox", { name: "Add a comment" }).fill("Who exactly was recruited?");
  await cp.getByRole("button", { name: "Comment", exact: true }).click();
  await cp.locator(".cm-thread").filter({ hasText: "Who exactly" }).waitFor({ timeout: 8000 });
  ok(true, "a comment on a notebook block");
  await cp.getByRole("button", { name: "All comments" }).click();
  ok((await cp.locator(".cm-thread").count()) === 2, "the Comments filter lists both threads");
  await shot(cp, "comment-thread");
  for (const theme of ["light", "dark", "read"]) {
    await setTheme(cp, theme, 250);
    await axe(cp, `the shared reader as Commenter, ${theme}`);
  }
  await setTheme(cp, "light");
  await cp.getByRole("button", { name: "Back to notes" }).click();
  await cp.locator(".nbr-title", { hasText: "Methods" }).waitFor({ timeout: 10000 });
  ok((await cp.locator(".nbr").getByText("Who was").count()) > 0, "a Commenter's Notes tab shows the owner's page of notes (read only)");
  await shot(cp, "reader-commenter");

  /* ================================================================ 4. the owner sees the comments and resolves one */
  await openPaper(op, docId);
  await op.getByRole("button", { name: /^Comments \(2\)/ }).click();
  await op.locator(".cm-thread").first().getByRole("button", { name: "Resolve" }).click();
  await sleep(400);
  ok((await op.locator(".cm-thread").count()) === 1, "the owner resolves a thread; Open shows the other");

  /* ================================================================ 5. the Viewer */
  console.log("the Viewer");
  const { c: vc, p: vp } = await signedIn(VIEWER);
  await openPaper(vp, docId);
  ok((await vp.locator(".desk-shared-banner").textContent())?.includes("You can view"), "the banner says You can view");
  ok((await vp.locator(".desk-tools").count()) === 0 && (await vp.getByRole("button", { name: /Agents/ }).count()) === 0, "a Viewer has no tools and no Agents (Ask runs on the owner's index)");
  ok((await vp.getByRole("button", { name: /Download/ }).count()) > 0, "and can download (the owner allows it)");
  await vp.locator(".nbr-title", { hasText: "Methods" }).waitFor({ timeout: 10000 });
  ok((await vp.locator(".nbr").getByText("Who was").count()) > 0 && (await vp.locator(".nbr textarea, .nbr [contenteditable=true]").count()) === 0, "a Viewer's Notes tab shows the page of notes, with nothing to edit");
  await shot(vp, "reader-viewer");
  await axe(vp, "the shared reader as Viewer");

  /* ================================================================ 6. the Editor highlights */
  const { c: ec, p: ep } = await signedIn(EDITOR);
  await openPaper(ep, docId);
  ok((await ep.locator(".desk-tools").count()) === 1 && (await ep.getByRole("radio", { name: /Draw/ }).count()) === 0, "an Editor gets the tools, without Draw");
  await ep.locator(".nb").getByText("Who was").first().waitFor({ timeout: 15000 });
  ok(true, "an Editor's Notes tab is the notebook itself");
  await shot(ep, "reader-editor");

  /* ================================================================ 7. a visitor with the link, signed out */
  console.log("the link");
  const lc = await browser.newContext(desk(1280, 860));
  const lp = await lc.newPage();
  watch(lp);
  await lp.goto(`${BASE}/s/${token}`, { waitUntil: "networkidle" });
  await lp.locator(".desk").waitFor({ timeout: 30000 });
  ok(lp.url().endsWith(`/papers/${docId}`), "the link opens the paper at its own address (the token leaves the address bar)");
  ok((await lp.locator(".desk-shared-banner").textContent())?.includes("You can view"), "signed out, a Commenter link reads as Viewer");
  await lp.goto(`${BASE}/s/${"x".repeat(43)}`, { waitUntil: "networkidle" });
  await lp.getByText("This link does not work").waitFor({ timeout: 10000 });
  ok(true, "a wrong link says it does not work");
  await lc.close();
  await Promise.all([oc.close(), cc.close(), vc.close(), ec.close()]);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  for (const ctx of browser.contexts()) for (const pg of ctx.pages()) {
    console.log("   page:", pg.url(), "dialogs:", await pg.locator("[role=dialog]").evaluateAll((els) => els.map((x) => x.getAttribute("aria-labelledby") + " " + (x.textContent ?? "").slice(0, 80))).catch(() => "?"));
    await shot(pg, "debug-" + Math.random().toString(36).slice(2, 6));
  }
  countFailure();
}
ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
await browser.close();
await idp.close?.();
finish("all sharing browser checks passed", (n) => `${n} check(s) FAILED`);
