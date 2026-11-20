// Browser e2e for sharing a paper's workspace (docs/design/paper-share.md, section 9): written for SHARE "on" and READER "on" (the named run share-on starts the Worker so;
// scripts/lib/suites.mjs). The Share dialog on a wide screen and a phone (labelled, menus, focus back to Share, Remove with Undo, the link opened to anyone), "Shared with me", the shared
// reader per role (Viewer: no tools, no Agents; Commenter: comments on a highlight and a block, with the thread's head, the box (off while empty), Ctrl+Enter, a reply, Edit and Delete in the
// ⋯ menu, the list's cards and counts; Editor: highlights), the owner's Comments button in the page header and Resolve, a phone, a visitor through the link signed out, and axe in Light, Dark and Read.
// With SHARE_SHOTS=<folder> it also takes the owner's pictures.
//   node e2e/share.mjs [baseUrl]    (default http://localhost:8788; SHARE and READER must be on there)
import { mkdirSync, writeFileSync } from "node:fs";
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
  // ink on the page (paper-reader.md 25): a circle round "recruited", drawn by the owner
  const circle = Array.from({ length: 25 }, (_, k) => [Math.round(Math.cos((k / 24) * Math.PI * 2) * 300 + 250), Math.round(Math.sin((k / 24) * Math.PI * 2) * 80), 50]).flat();
  await api(op, `${D}/notebook/pages/p1/ink`, "PUT", { strokes: [{ id: "ink1", tool: "pen", color: "red", w: 14, a: { k: "text", b: "b1", at: 13, q: "recruited" }, pts: circle }] });
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
  // the note and the preview of the e-mail: shown once an address is typed; the preview is the e-mail itself, with the picture of the first page
  ok((await dlg.getByLabel("Message (optional)").count()) === 0, "no message box before an address is typed (the dialog stays clean)");
  await dlg.getByLabel("Add people by e-mail").fill(COMMENTER.email);
  await dlg.getByLabel("Message (optional)").fill("Have a look at the methods before Monday.\nThanks!");
  const previewBtn = dlg.getByRole("button", { name: "Preview e-mail" });
  await previewBtn.click();
  ok((await dlg.getByRole("button", { name: "Hide the e-mail" }).getAttribute("aria-expanded")) === "true", "Preview e-mail is a disclosure (aria-expanded)");
  const frame = dlg.frameLocator('iframe[title="Preview of the invitation e-mail"]');
  await frame.getByRole("heading", { name: "Asha Owner shared a paper with you" }).waitFor({ timeout: 15000 });
  await frame.locator('img[alt^="The first page of"]').waitFor({ timeout: 15000 });
  await sleep(500);
  const shown = await frame.locator("body").innerText();
  ok(shown.includes("Have a look at the methods before Monday.") && shown.includes("You can view it and add comments.") && shown.includes(`Sign in with Google as ${COMMENTER.email}`), "the preview shows the note, the role in words and the address to sign in with");
  ok(await frame.locator('img[alt^="The first page of"]').evaluate((img) => img.src.startsWith("data:image/jpeg") && img.naturalWidth === 300), "the preview shows the picture of the first page (a 300 px JPEG)");
  ok(/Subject\s+Asha Owner shared “.+” with you/.test(await dlg.locator(".sh-preview-head").innerText()), "the preview shows the subject");
  for (const theme of ["light", "dark"]) {
    await op.emulateMedia({ colorScheme: theme });
    await setTheme(op, theme, 250);
    await dlg.locator(".sh-preview").scrollIntoViewIfNeeded();
    await axe(op, `the Share dialog with the e-mail's preview, ${theme}`, ".sh-dialog");
    await shot(op, `dialog-preview-${theme}`);
  }
  if (SHOTS) {
    await dlg.locator(".sh-body").evaluate((el) => (el.scrollTop = 0));
    await shot(op, "dialog-preview-top");
  }
  await op.emulateMedia({ colorScheme: "light" });
  await setTheme(op, "light");
  await dlg.getByRole("button", { name: /^Role for the new person/ }).click();
  await op.getByRole("menuitemradio", { name: "Can comment" }).click();
  await dlg.getByRole("button", { name: "Invite" }).click();
  await dlg.getByText(COMMENTER.email).first().waitFor({ timeout: 10000 });
  const sent = await (await op.request.get(`${BASE}/api/v1/dev/last-invite`)).json();
  const pic = sent.attachments?.[0];
  if (SHOTS && pic) {
    writeFileSync(join(SHOTS, "invite-picture.jpg"), Buffer.from(pic.content, "base64"));
    writeFileSync(join(SHOTS, "invite.json"), JSON.stringify({ ...sent, attachments: sent.attachments.map((a) => ({ ...a, content: `${a.size} bytes` })) }, null, 1));
  }
  ok(sent.to === COMMENTER.email && pic?.disposition === "inline" && pic.type === "image/jpeg" && pic.size > 2000 && pic.size <= 60 * 1024 && sent.html.includes(`cid:${pic.contentId}`), `the e-mail carries the first page drawn by the browser as an inline JPEG (${Math.round((pic?.size ?? 0) / 1024)} KB)`);
  ok(sent.text.includes("> Have a look at the methods before Monday.\n> Thanks!"), "and the note");
  ok((await dlg.getByLabel("Message (optional)").count()) === 0, "after Invite the message box and the preview are gone");
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
  // a comment on the highlight, from its card: the thread's head (back to Comments), the quote it hangs on, the box at the bottom
  await cp.getByRole("tab", { name: /Highlights/ }).click();
  await cp.getByRole("button", { name: /Comment on the highlight on page 1/ }).click();
  const write = cp.getByRole("textbox", { name: "Add a comment" });
  await write.waitFor({ timeout: 10000 });
  const send = cp.locator(".cm-foot").getByRole("button", { name: "Comment", exact: true });
  ok(await send.isDisabled(), "the box's Comment button is off while the box is empty");
  ok(await cp.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Add a comment"), "a thread with nothing in it puts the cursor in the box");
  const quote = cp.locator(".cm-quote");
  ok((await quote.getAttribute("data-color")) === "pink" && (await quote.locator("blockquote").innerText()).includes("glaucoma screening program") && (await quote.getByRole("button", { name: "Show it on page 1 of the paper" }).innerText()).includes("p. 1"), "the thread hangs on a quote card: the meaning's colour, the words, and p. 1 ↗");
  ok((await cp.locator(".cm-head").getByRole("button", { name: "All comments" }).innerText()).trim() === "Comments", "the head: ← Comments (back to the list)");
  await write.fill("Is this the main result of the screening?");
  ok(await send.isEnabled(), "and on once something is written");
  ok((await cp.locator(".cm-hint").innerText()).trim() === "Enter to send · Shift+Enter for a new line" && (await write.getAttribute("enterkeyhint")) === "send", "with a keyboard the hint says Enter sends, Shift+Enter makes a new line");
  await write.press("Shift+Enter");
  await write.pressSequentially("(page 1)");
  ok((await write.inputValue()) === "Is this the main result of the screening?\n(page 1)", "Shift+Enter makes a new line, and does not send");
  await write.press("Enter");
  await cp.locator(".cm-thread").filter({ hasText: "Is this the main result" }).waitFor({ timeout: 8000 });
  ok(true, "Enter sends: the comment shows as the head of its thread");
  const reply = cp.getByRole("textbox", { name: "Reply" });
  const replyBox = cp.locator(".cm-thread-reply");
  ok((await reply.count()) === 1 && (await replyBox.count()) === 1 && (await replyBox.getByRole("button", { name: "Reply", exact: true }).isDisabled()) && (await cp.locator(".cm-foot").count()) === 0, "the box moves to the end of the thread, as Reply (off while empty)");
  ok(await cp.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Reply"), "and keeps the cursor");
  ok((await cp.locator(".cm-status").innerText()).trim() === "Open" && (await cp.locator(".cm-head").getByRole("button", { name: /Resolve/ }).count()) === 0, "the thread's state is Open; a Commenter cannot resolve");
  ok((await cp.locator(".cm-c time").first().innerText()).trim() === "Just now" && !!(await cp.locator(".cm-c time").first().getAttribute("title")), "the time is relative (Just now), the full date its tooltip");
  // a reply, sent by Ctrl+Enter too
  await reply.fill("A typo here, to be deleted");
  await reply.press("Control+Enter");
  await cp.locator(".cm-replies").getByText("A typo here").waitFor({ timeout: 8000 });
  ok(await cp.locator(".cm-replies").evaluate((el) => parseFloat(getComputedStyle(el).borderLeftWidth) >= 2 && el.getBoundingClientRect().left > el.closest(".cm-thread").querySelector(".cm-c").getBoundingClientRect().left + 8), "a reply hangs under the first comment, indented on a thread line");
  ok((await cp.locator(".cm-replies .cm-av").first().evaluate((e) => e.getBoundingClientRect().width)) < (await cp.locator(".cm-thread > .cm-c .cm-av").first().evaluate((e) => e.getBoundingClientRect().width)), "with a smaller avatar than the thread's head");
  // Edit and Delete live in the comment's ⋯ menu; Delete asks first, in place
  const mine = cp.locator(".cm-replies .cm-c").first();
  await mine.hover();
  await mine.getByRole("button", { name: "Actions of your comment" }).click();
  const m = cp.getByRole("menu", { name: "Actions of your comment" });
  ok(JSON.stringify((await m.getByRole("menuitem").allInnerTexts()).map((t) => t.trim())) === JSON.stringify(["Edit", "Delete"]), "a comment's ⋯ menu: Edit, Delete");
  await m.getByRole("menuitem", { name: "Edit" }).click();
  const edit = cp.getByRole("textbox", { name: "Edit your comment" });
  await edit.fill("Edited: still to be deleted");
  await cp.locator(".cm-replies").getByRole("button", { name: "Save" }).click();
  await cp.locator(".cm-replies").getByText("Edited: still to be deleted").waitFor({ timeout: 8000 });
  ok((await cp.locator(".cm-replies .cm-text").first().innerText()).trim() === "Edited: still to be deleted", "Edit saves it in place");
  await mine.hover();
  await mine.getByRole("button", { name: "Actions of your comment" }).click();
  await cp.getByRole("menu", { name: "Actions of your comment" }).getByRole("menuitem", { name: "Delete" }).click();
  const ask = cp.getByRole("group", { name: "Delete this comment?" });
  ok(await ask.isVisible() && (await cp.evaluate(() => document.activeElement?.textContent?.trim() === "Cancel")), "Delete asks first, in place (the focus on Cancel)");
  await ask.getByRole("button", { name: "Delete" }).click();
  await cp.locator(".cm-replies").waitFor({ state: "detached", timeout: 8000 });
  ok(true, "and deletes it");
  // a long thread: five replies (newest last); the earlier ones fold behind "Show 3 earlier replies"
  const head = (await (await api(cp, `/api/v1/share/papers/${docId}/comments`)).json()).comments.find((c) => !c.parentId);
  const added = [];
  for (let k = 1; k <= 5; k++) added.push((await api(cp, `/api/v1/share/papers/${docId}/comments`, "POST", { parentId: head.id, body: `Reply number ${k}` })).status());
  ok(added.every((st) => st === 200 || st === 201), `five replies added through the API (${added.join(",")})`);
  await openPaper(cp, docId);
  await cp.getByRole("button", { name: "Comments, 1 open" }).click();
  await cp.locator(".cm-card").first().click();
  const fold = cp.getByRole("button", { name: "Show 3 earlier replies" });
  await fold.waitFor({ timeout: 8000 });
  ok((await fold.getAttribute("aria-expanded")) === "false" && JSON.stringify((await cp.locator(".cm-replies .cm-text").allInnerTexts()).map((t) => t.trim())) === JSON.stringify(["Reply number 4", "Reply number 5"]), "a thread of more than 3 replies shows the last two, newest last, the rest folded");
  await shot(cp, "thread-folded");
  await fold.click();
  ok((await cp.locator(".cm-replies .cm-text").count()) === 5 && (await cp.getByRole("button", { name: "Show fewer replies" }).getAttribute("aria-expanded")) === "true", "Show 3 earlier replies opens them all");
  await reply.fill("Which page has the numbers?");
  // the end of the thread in sight, as after typing (the body keeps room for the Agents button)
  await cp.locator(".cm-body-scroll").evaluate((el) => (el.scrollTop = el.scrollHeight));
  await shot(cp, "thread-light");
  for (const theme of ["dark", "read"]) {
    await setTheme(cp, theme, 250);
    await shot(cp, `thread-${theme}`);
  }
  await setTheme(cp, "light");
  await reply.fill("");
  // a comment on a block of the notes, from the read-only notes
  await cp.getByRole("button", { name: "All comments" }).click();
  await cp.getByRole("button", { name: "Back to notes" }).click();
  await cp.getByRole("button", { name: "Comment on this block" }).first().click();
  await cp.getByRole("textbox", { name: "Add a comment" }).fill("Who exactly was recruited?");
  await cp.getByRole("button", { name: "Comment", exact: true }).click();
  await cp.locator(".cm-thread").filter({ hasText: "Who exactly" }).waitFor({ timeout: 8000 });
  ok((await cp.locator(".cm-quote .cm-go").innerText()).includes("Methods"), "a comment on a notebook block: its quote card names the page of notes");
  await cp.getByRole("button", { name: "All comments" }).click();
  const cards = cp.locator(".cm-card");
  ok((await cards.count()) === 2, "the list has a card for each thread");
  const seg = await cp.getByRole("group", { name: "Show" }).getByRole("button").allInnerTexts();
  ok(JSON.stringify(seg.map((t) => t.replace(/\s+/g, " ").trim())) === JSON.stringify(["Open 2", "Resolved 0", "All 2"]), `the filter is one segmented control with counts (${seg.join(" | ")})`);
  ok((await cards.filter({ hasText: "Is this the main result" }).locator(".cm-chip").innerText()).trim() === "p. 1" && (await cp.locator(".cm-card u, .cm-card a").count()) === 0, "a card: p. 1, the quote (not a link), the first comment");
  await shot(cp, "comments-list-light");
  for (const theme of ["light", "dark", "read"]) {
    await setTheme(cp, theme, 250);
    await axe(cp, `the shared reader as Commenter, the list, ${theme}`);
  }
  await setTheme(cp, "light");
  await cards.filter({ hasText: "Is this the main result" }).click();
  await cp.locator(".cm-quote").waitFor({ timeout: 5000 });
  ok(true, "a card opens its thread");
  for (const theme of ["light", "dark", "read"]) {
    await setTheme(cp, theme, 250);
    await axe(cp, `the shared reader as Commenter, a thread, ${theme}`);
  }
  await setTheme(cp, "light");
  await cp.getByRole("button", { name: "All comments" }).click();
  await cp.getByRole("button", { name: "Back to notes" }).click();
  await cp.locator(".nbr-title", { hasText: "Methods" }).waitFor({ timeout: 10000 });
  ok((await cp.locator(".nbr").getByText("Who was").count()) > 0, "a Commenter's Notes tab shows the owner's page of notes (read only)");
  ok((await cp.locator(".nbr-head").getByRole("button", { name: "Comments, 2 open" }).count()) === 1, "the Comments button sits in the page's head row, with the count");
  await shot(cp, "reader-commenter");
  // a phone: the notes and the comments
  {
    const ph = await browser.newContext({ ...phone(390, 844), storageState: await cc.storageState() });
    const pp2 = await ph.newPage();
    watch(pp2);
    await openPaper(pp2, docId);
    await pp2.getByRole("radio", { name: "Notes" }).click();
    await pp2.locator(".nbr-title", { hasText: "Methods" }).waitFor({ timeout: 10000 });
    await shot(pp2, "phone-notes");
    await pp2.getByRole("button", { name: "Comments, 2 open" }).click();
    await pp2.locator(".cm-card").first().waitFor({ timeout: 8000 });
    ok(await noSideways(pp2), "no sideways scroll in the comments on a phone");
    await shot(pp2, "phone-comments");
    await pp2.locator(".cm-card").first().click();
    await pp2.locator(".cm-quote").waitFor({ timeout: 5000 });
    const sizes = await pp2.locator(".cm-head button, .cm-thread-reply button, .cm-fold").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    ok(sizes.every((h) => h >= 44), `on a phone the thread's buttons are 44 px (${sizes.join(",")})`);
    ok(await noSideways(pp2), "no sideways scroll in a thread on a phone");
    await axe(pp2, "a thread, phone", ".cm");
    await shot(pp2, "phone-thread");
    await ph.close();
  }
  // the agents (paper-reader.md 24): a Commenter asks on their own allowance, with Ask, Explain and Critique; the Note-taker and "+ Add to notes" write the notes, so they are not offered
  await cp.locator(".desk-fab").click();
  const cdrawer = cp.getByRole("complementary", { name: "Agents" });
  await cdrawer.waitFor();
  ok(JSON.stringify(await cdrawer.getByRole("radio").allInnerTexts()) === JSON.stringify(["Ask", "Explain", "Critique"]), "a Commenter's agents: Ask, Explain, Critique (no Note-taker)");
  await cdrawer.getByRole("radio", { name: "Explain" }).click();
  await cdrawer.locator('[data-agent="explain"]').getByRole("button", { name: "Explain the method" }).click();
  await cdrawer.locator('[data-agent="explain"] .ask-answer, [data-agent="explain"] .ask-error').first().waitFor({ timeout: 20000 });
  ok((await cdrawer.locator('[data-agent="explain"] .ask-answer').count()) === 1 && (await cdrawer.locator(".ask-add").count()) === 0, "a Commenter's Explain answers, with no + Add to notes");
  await cdrawer.getByRole("button", { name: "Close the agents" }).click();

  /* ================================================================ 4. the owner sees the comments and resolves one */
  await openPaper(op, docId);
  const cmBtn = op.getByRole("button", { name: "Comments, 2 open" });
  await cmBtn.waitFor({ timeout: 10000 });
  ok((await cmBtn.evaluate((b) => b.closest(".nb-bar") !== null)) && (await op.locator(".desk-comments-filter").count()) === 0, "the owner's Comments button is in the page's header row (no row of its own)");
  if (SHOTS) await op.locator(".nb-tabsrow").evaluate((el) => el.scrollIntoView());
  if (SHOTS) await op.locator("#dw-panel-side").screenshot({ path: join(SHOTS, "panel-header.png") });
  await cmBtn.click();
  await op.locator(".cm-card").filter({ hasText: "Is this the main result" }).click();
  await op.locator(".cm-head").getByRole("button", { name: "Resolve" }).click();
  await op.locator(".cm-status", { hasText: "Resolved" }).waitFor({ timeout: 8000 });
  ok((await op.locator(".cm-head").getByRole("button", { name: "Reopen" }).count()) === 1, "the owner resolves a thread from its head; Reopen takes its place");
  await op.getByRole("button", { name: "All comments" }).click();
  ok((await op.locator(".cm-card").count()) === 1 && JSON.stringify((await op.getByRole("group", { name: "Show" }).getByRole("button").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim())) === JSON.stringify(["Open 1", "Resolved 1", "All 2"]), "Open shows the other; the counts follow");
  await op.getByRole("group", { name: "Show" }).getByRole("button", { name: /^Resolved/ }).click();
  ok((await op.locator(".cm-card .cm-badge").count()) === 1, "Resolved lists it, with its badge");

  /* ================================================================ 5. the Viewer */
  console.log("the Viewer");
  const { c: vc, p: vp } = await signedIn(VIEWER);
  await openPaper(vp, docId);
  ok((await vp.locator(".desk-shared-banner").textContent())?.includes("You can view"), "the banner says You can view");
  ok((await vp.locator(".desk-tools").count()) === 0 && (await vp.getByRole("button", { name: /Agents/ }).count()) === 0, "a Viewer has no tools and no Agents (Ask runs on the owner's index)");
  ok((await vp.getByRole("button", { name: /Download/ }).count()) > 0, "and can download (the owner allows it)");
  await vp.locator(".nbr-title", { hasText: "Methods" }).waitFor({ timeout: 10000 });
  ok((await vp.locator(".nbr").getByText("Who was").count()) > 0 && (await vp.locator(".nbr textarea, .nbr [contenteditable=true]").count()) === 0, "a Viewer's Notes tab shows the page of notes, with nothing to edit");
  await vp.locator(".nbr .nb-inksvg path").first().waitFor({ timeout: 10000 });
  ok((await vp.locator(".nbr .nb-inksvg path").count()) === 1 && (await vp.locator(".nb-inkcatch").count()) === 0 && (await vp.getByRole("button", { name: "Draw" }).count()) === 0, "a Viewer sees the owner's ink on the page, read only: no Draw, nothing takes the pen");
  const ringed = await vp.evaluate(() => {
    const el = document.querySelector('.nbr [data-block="b1"] [data-ink-text]');
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const i = n.data.indexOf("recruited");
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + 1);
      const w = r.getBoundingClientRect();
      const c = document.querySelector(".nbr .nb-inksvg path").getBoundingClientRect();
      return c.left < w.left + 30 && c.right > w.left && c.top < w.bottom && c.bottom > w.top;
    }
    return false;
  });
  ok(ringed, "and it is drawn at the word it is attached to");
  ok((await api(vp, `${D}/notebook/pages/p1/ink`, "PUT", { strokes: [] })).status() === 403, "a Viewer cannot draw on the notes (403)");
  await shot(vp, "reader-viewer");
  await axe(vp, "the shared reader as Viewer");

  /* ================================================================ 6. the Editor highlights */
  const { c: ec, p: ep } = await signedIn(EDITOR);
  await openPaper(ep, docId);
  ok((await ep.locator(".desk-tools").count()) === 1 && (await ep.getByRole("radio", { name: /Draw/ }).count()) === 0, "an Editor gets the tools, without Draw");
  await ep.locator(".nb").getByText("Who was").first().waitFor({ timeout: 15000 });
  ok(true, "an Editor's Notes tab is the notebook itself");
  ok((await ep.locator(".nb").getByRole("button", { name: "Draw" }).count()) === 1, "an Editor can draw on the pages of notes (Draw in the notes' toolbar)");
  const edInk = await api(ep, `${D}/notebook/pages/p1/ink`, "PUT", { rev: 1, strokes: [] });
  ok(edInk.status() === 200, `and the server lets an Editor's ink in (${edInk.status()})`);
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
