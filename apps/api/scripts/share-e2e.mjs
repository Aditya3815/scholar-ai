// Sharing a paper's workspace (docs/design/paper-share.md, section 9) against the real Worker, local D1 and the fake identity provider: written for SHARE "on" and READER "on" (the named
// run share-on starts the Worker so; scripts/lib/suites.mjs). Invite, then sign in as the invited address; each role against the routes; stop sharing ends an open session; a link open to
// anyone, signed out; expiry and reset; comments; the e-mail (the stand-in) and Resend; Leave; the export; deleting the paper and the account.
//   node scripts/share-e2e.mjs    (the Worker must be running with SHARE and READER on: `npm run integration -w apps/api -- --run=share-on`)
import { createHash } from "node:crypto";
import { SAMPLE_PAPER, makePdf } from "@scholar/test-support/make-pdf.mjs";
import { APP, countFailure, createClient, finish, loginWith, ok, sqlResults, startIdp } from "./lib/harness.mjs";

const idp = await startIdp();
const login = loginWith(idp);
const upload = (c) => c.send(`${APP}/api/v1/documents`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/pdf", "X-Filename": "shared.pdf" }, body: makePdf(SAMPLE_PAPER, { title: "Glaucoma screening" }) });
/** A JPEG's structure as the Worker reads it (SOI, JFIF, optionally Exif, a 300 x 388 frame header, the scan, EOI); the Worker never decodes the picture. */
function fakeJpeg({ exif = false, fill = 0x55 } = {}) {
  const seg = (m, body) => [0xff, m, ((body.length + 2) >> 8) & 0xff, (body.length + 2) & 0xff, ...body];
  const text = (t) => [...t].map((ch) => ch.charCodeAt(0));
  return Buffer.from([
    0xff, 0xd8, ...seg(0xe0, [...text("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]), ...(exif ? seg(0xe1, [...text("Exif"), 0, 0, ...text("GPS 28.6N")]) : []),
    ...seg(0xc0, [8, 1, 132, 1, 44, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]), ...seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]), ...Array(400).fill(fill), 0xff, 0xd9,
  ]);
}
const one = async (sql) => (await sqlResults([sql]))?.[0]?.[0];
const status = async (p) => (await p).status;

try {
  const A = await login("sh-a", "sh-a@example.com", "Asha Owner");
  const doc = (await (await upload(A)).json()).document;
  await A.api(`/api/v1/documents/${doc.id}/finish`, { method: "POST", body: { pages: 3 } });
  const D = `/api/v1/documents/${doc.id}`;
  const S = `/api/v1/share/papers/${doc.id}`;

  console.log("the switch");
  const mine = await (await A.api(D)).json();
  ok(mine.features?.share === true && mine.features?.reader === true && !mine.access, "SHARE is on in this run: the owner's paper says it can be shared (and has no `access`)");

  console.log("invite, then sign in as the invited address");
  const inviteNote = "Please read the methods <b>first</b> & tell me.\nThanks!";
  const inv = await A.api(`${S}/members`, { method: "POST", body: { email: "Sh-B@Example.com", role: "commenter", note: inviteNote, picture: fakeJpeg({ exif: true }).toString("base64") } });
  const invited = await inv.json();
  ok(inv.status === 201 && invited.member.email === "sh-b@example.com" && invited.member.joined === false, "Invite: 201, the address lower-cased, not joined yet");
  ok(invited.emailed === true, "the invitation was e-mailed (the stand-in mailer of a test run)");
  const mail = await (await fetch(`${APP}/api/v1/dev/last-invite`)).json();
  ok(mail.to === "sh-b@example.com" && mail.from?.email === "invites@notify.sodhsetu.in" && mail.subject === `Asha Owner shared “${doc.title}” with you`, "the e-mail: to the address, from invites@, the subject names the owner and the paper");
  ok(mail.text.includes("Asha Owner wrote:\n> Please read the methods <b>first</b> & tell me.\n> Thanks!") && mail.text.includes(`/papers/${doc.id}`) && mail.text.includes("You can view it and add comments."), "its plain text: the note quoted, the role in words, the link");
  ok(mail.html.includes("Please read the methods &lt;b&gt;first&lt;/b&gt; &amp; tell me.<br>Thanks!") && !mail.html.includes("<b>first") && mail.html.includes(`/papers/${doc.id}"`) && mail.html.includes(">Open the paper</a>"), "its HTML: the note escaped, the button to the paper");
  const att = mail.attachments ?? [];
  ok(att.length === 1 && att[0].disposition === "inline" && att[0].type === "image/jpeg" && mail.html.includes(`src="cid:${att[0].contentId}"`), "the first page goes as one inline JPEG, named by its Content-ID in the HTML (no address of it anywhere)");
  ok(att[0]?.content === fakeJpeg().toString("base64"), "the picture is passed on byte for byte, with its metadata segment (Exif) taken out");
  const odd = await (await A.api(`${S}/members`, { method: "POST", body: { email: "sh-d@example.com", role: "viewer", picture: Buffer.from("\x89PNG not a jpeg at all, just bytes ......................................................................................................................").toString("base64") } })).json();
  const plain = await (await fetch(`${APP}/api/v1/dev/last-invite`)).json();
  ok(odd.emailed === true && plain.to === "sh-d@example.com" && (plain.attachments ?? []).length === 0 && !plain.html.includes("<img"), "a picture that is not a JPEG is left out: the e-mail still goes, with the page-shaped block");
  await A.api(`${S}/members/${odd.member.id}`, { method: "DELETE" });
  // the stored cover (made by the page at upload) is the first choice: from any device, with no picture in the body
  const coverPut = await A.send(`${APP}${D}/cover`, { method: "PUT", headers: { Origin: APP, "Content-Type": "image/jpeg" }, body: fakeJpeg({ exif: true, fill: 0x66 }) });
  ok(coverPut.status === 200, "the paper has a stored cover");
  const lastInvite = async (email, body = {}) => {
    const r = await (await A.api(`${S}/members`, { method: "POST", body: { email, role: "viewer", ...body } })).json();
    const m = await (await fetch(`${APP}/api/v1/dev/last-invite`)).json();
    await A.api(`${S}/members/${r.member.id}`, { method: "DELETE" });
    return r.emailed === true && m.to === email ? m : null;
  };
  const fromCover = await lastInvite("sh-f@example.com");
  ok(fromCover?.attachments?.length === 1 && fromCover.attachments[0].content === fakeJpeg({ fill: 0x66 }).toString("base64") && fromCover.html.includes(`src="cid:${fromCover.attachments[0].contentId}"`), "no picture in the body: the e-mail carries the stored cover as its inline JPEG (its Exif taken out)");
  const coverFirst = await lastInvite("sh-g@example.com", { picture: fakeJpeg().toString("base64") });
  ok(coverFirst?.attachments?.[0]?.content === fakeJpeg({ fill: 0x66 }).toString("base64"), "the cover is chosen over a picture the dialog sent");
  const owner = await one(`SELECT user_id FROM documents WHERE id = '${doc.id}'`);
  await fetch(`${APP}/api/v1/dev/r2-object?key=${encodeURIComponent(`docs/${owner.user_id}/${doc.id}.cover.jpg`)}`, { method: "DELETE" });
  const noCover = await lastInvite("sh-h@example.com");
  ok(noCover && (noCover.attachments ?? []).length === 0 && !noCover.html.includes("<img"), "the cover missing from storage: the e-mail still goes, with the page-shaped block");
  const drawn = await lastInvite("sh-i@example.com", { picture: fakeJpeg().toString("base64") });
  ok(drawn?.attachments?.[0]?.content === fakeJpeg().toString("base64"), "and a picture the dialog drew is used then");
  ok((await status(A.api(`${S}/members`, { method: "POST", body: { email: "sh-e@example.com", role: "viewer", note: "x".repeat(501) } }))) === 400, "a note over 500 characters is refused");
  ok((await status(A.api(`${S}/members/${invited.member.id}/resend`, { method: "POST" }))) === 429, "Resend at once: 429 (once an hour)");
  ok((await status(A.api(`${S}/members`, { method: "POST", body: { email: "sh-a@example.com", role: "viewer" } }))) === 400, "the owner's own address is refused");
  ok((await status(A.api(`${S}/members`, { method: "POST", body: { email: "not an address", role: "viewer" } }))) === 400, "a wrong address is refused");
  ok((await status(A.api(`${S}`, { method: "PUT", body: { linkRole: "editor" } }))) === 400, "Editor by link is refused");
  const B = await login("sh-b", "sh-b@example.com", "Bela Commenter");
  const asB = await (await B.api(D)).json();
  ok(asB.access?.role === "commenter" && asB.access.via === "member" && asB.access.ownerName === "Asha Owner", "the invited person opens it as Commenter, shared by the owner");
  ok(JSON.stringify(asB.history) === "[]" && asB.document.tags.length === 0 && asB.document.lastPage === null, "without the owner's questions, tags or reading place");
  const withMe = await (await B.api("/api/v1/share/with-me")).json();
  ok(withMe.items.length === 1 && withMe.items[0].docId === doc.id && withMe.items[0].role === "commenter", "Shared with me lists it");
  ok(((await (await B.api("/api/v1/documents")).json()).sharedWithMe ?? 0) === 1, "and the list of papers says one was shared");
  ok((await one(`SELECT user_id FROM doc_members WHERE doc_id = '${doc.id}'`))?.user_id !== null, "the invitation is matched to the account");
  ok((await (await A.api(S)).json()).share.members[0].lastOpenedAt !== null, "the owner sees when it was opened");

  console.log("each role against the routes");
  ok((await status(B.api(`${D}/file`))) === 200 && (await status(B.api(`${D}/notes`))) === 200 && (await status(B.api(`${D}/notebook`))) === 200, "a Commenter reads the PDF, the highlights and the notes");
  ok((await status(B.api(`${D}/notes`, { method: "POST", body: { page: 1, quote: "glaucoma screening program" } }))) === 403, "a Commenter cannot highlight (403)");
  ok((await status(B.api(`${D}/notebook/pages/p1`, { method: "PUT", body: { blocks: [] } }))) === 403, "nor write notes");
  ok((await status(B.api(D, { method: "DELETE" }))) === 403 && (await status(B.api(D, { method: "PATCH", body: { title: "x" } }))) === 403, "nor delete or rename the paper");
  ok((await status(B.api(S))) === 403, "nor open the Share dialog");
  ok((await (await B.api(`${D}/ink`)).json()).strokes.length === 0, "the drawing is not shared");
  await A.api(`${S}/members/${invited.member.id}`, { method: "PATCH", body: { role: "editor" } });
  const note = await B.api(`${D}/notes`, { method: "POST", body: { page: 1, quote: "glaucoma screening program", color: "pink" } });
  ok(note.status === 201, "made Editor, the same person highlights");
  const page = await B.api(`${D}/notebook/pages/p1`, { method: "PUT", body: { title: "From Bela", blocks: [{ id: "b1", kind: "text", md: "a note by Bela" }] } });
  ok(page.status === 201, "and writes a page of notes");
  ok((await status(B.api(`${D}/ink`, { method: "PUT", body: { strokes: [], rev: 0 } }))) === 403, "but never draws on the owner's drawing");
  const C = await login("sh-c", "sh-c@example.com", "Chen Stranger");
  ok((await status(C.api(D))) === 404 && (await status(C.api(`${D}/file`))) === 404, "someone not named: 404");
  ok((await status(createClient(APP).api(D))) === 401, "nobody signed in: 401");

  console.log("comments");
  const noteId = (await note.json()).note.id;
  const c1 = await B.api(`${S}/comments`, { method: "POST", body: { anchor: `note:${noteId}`, body: "Is this the main result?" } });
  const c1j = (await c1.json()).comment;
  ok(c1.status === 201 && c1j.mine && c1j.author === "Bela Commenter", "a comment on a highlight");
  const r1 = await A.api(`${S}/comments`, { method: "POST", body: { parentId: c1j.id, body: "Yes" } });
  ok(r1.status === 201 && (await r1.json()).comment.parentId === c1j.id, "a reply from the owner");
  ok((await status(B.api(`${S}/comments`, { method: "POST", body: { anchor: "block:p1:b1", body: "on the block" } }))) === 201, "a comment on a notebook block");
  ok((await status(B.api(`${S}/comments`, { method: "POST", body: { anchor: "note:nope", body: "x" } }))) === 400, "on a thing that is not there: 400");
  ok((await status(A.api(`${S}/comments/${c1j.id}`, { method: "PATCH", body: { body: "changed" } }))) === 403, "only the author edits a comment");
  ok((await status(A.api(`${S}/comments/${c1j.id}`, { method: "PATCH", body: { resolved: true } }))) === 200, "the owner resolves a thread");
  ok((await (await B.api(`${S}/comments`)).json()).comments.length === 3, "every comment is listed");

  console.log("the link: anyone, signed out; reset; expiry; stop");
  const opened = await (await A.api(S, { method: "PUT", body: { linkMode: "anyone", linkRole: "commenter", expiry: 7 } })).json();
  const token = opened.token;
  ok(typeof token === "string" && token.length === 43, "opening to anyone makes the link (43 characters), shown once");
  ok((await one(`SELECT COUNT(*) AS n FROM doc_shares WHERE token_hash = '${token}'`))?.n === 0 && (await one(`SELECT COUNT(*) AS n FROM doc_shares WHERE token_hash = '${createHash("sha256").update(token).digest("hex")}'`))?.n === 1, "the database keeps its SHA-256, not the link");
  const V = createClient(APP);
  ok((await status(V.api(D))) === 401, "a visitor without the link: 401");
  const open = await V.api("/api/v1/share/open", { method: "POST", body: { token } });
  ok(open.status === 200 && (await open.json()).docId === doc.id, "/open says which paper");
  const setCookie = open.headers.get("set-cookie") ?? "";
  ok(/HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie) && /Path=\/api\/v1/i.test(setCookie), "the token is kept in an HttpOnly, SameSite=Strict cookie for the API only");
  const asV = await (await V.api(D)).json();
  ok(asV.access?.role === "viewer" && asV.access.via === "link" && asV.access.signedIn === false, "signed out, a Commenter link reads as Viewer");
  ok((await status(V.api(`${S}/comments`))) === 200 && (await status(V.api(`${S}/comments`, { method: "POST", body: { anchor: `note:${noteId}`, body: "x" } }))) === 403, "the visitor reads the comments but cannot write");
  const C2 = await login("sh-c", "sh-c@example.com", "Chen Stranger");
  await C2.api("/api/v1/share/open", { method: "POST", body: { token } });
  ok((await (await C2.api(D)).json()).access?.role === "commenter", "signed in, the same link gives Commenter");
  const reset = await (await A.api(`${S}/link`, { method: "POST", body: { expiry: 30 } })).json();
  ok(reset.token !== token, "Reset makes a new link");
  ok((await status(V.api(D))) === 404, "and the old one stops at once (the open session too)");
  ok((await status(createClient(APP).api("/api/v1/share/open", { method: "POST", body: { token } }))) === 404, "the old link cannot be opened again");
  const V2 = createClient(APP);
  await V2.api("/api/v1/share/open", { method: "POST", body: { token: reset.token } });
  ok((await status(V2.api(D))) === 200, "the new one works");
  await sqlResults([`UPDATE doc_shares SET expires_at = datetime('now', '-1 minute') WHERE doc_id = '${doc.id}'`]);
  ok((await status(V2.api(D))) === 404, "expired: it stops");
  await A.api(S, { method: "PUT", body: { expiry: null } });
  ok((await status(V2.api(D))) === 200, "until stopped: it works again");
  await A.api(S, { method: "PUT", body: { viewersDownload: false } });
  ok((await (await V2.api(D)).json()).access.viewersDownload === false, "Viewers can download: off is told to the page");
  ok((await status(A.api(S, { method: "DELETE" }))) === 200, "Stop sharing");
  ok((await status(V2.api(D))) === 404 && (await status(B.api(D))) === 404, "ends every open session: the link and the people");
  ok((await one(`SELECT COUNT(*) AS n FROM doc_members WHERE doc_id = '${doc.id}'`))?.n === 0, "and the addresses are gone");

  console.log("leave, export, and deleting");
  await A.api(`${S}/members`, { method: "POST", body: { email: "sh-b@example.com", role: "viewer" } });
  ok((await status(B.api(`/api/v1/share/with-me/${doc.id}`, { method: "DELETE" }))) === 200 && (await status(B.api(D))) === 404, "Leave takes it off the list");
  await A.api(`${S}/members`, { method: "POST", body: { email: "sh-b@example.com", role: "commenter" } });
  const expA = await (await A.api("/api/v1/account/export")).json();
  ok(expA.sharedPapers?.[0]?.people?.[0]?.email === "sh-b@example.com" && expA.sharedPapers[0].comments.length === 3, "the owner's export: the people and the comments");
  const expB = await (await B.api("/api/v1/account/export")).json();
  ok(expB.myCommentsOnSharedPapers?.length === 2 && !expB.sharedPapers?.length, "the member's export: their own comments");
  ok((await status(B.api("/api/v1/account", { method: "DELETE", body: { confirm: "DELETE" } }))) === 200, "the member deletes their account");
  ok((await one(`SELECT COUNT(*) AS n FROM doc_members WHERE doc_id = '${doc.id}'`))?.n === 0, "their membership is gone");
  const left = (await (await A.api(`${S}/comments`)).json()).comments;
  ok(left.length === 3 && left.filter((c) => c.author === null).length === 2, "their comments stay, by a former member");
  ok((await status(A.api(D, { method: "DELETE" }))) === 200, "the owner deletes the paper");
  ok((await one(`SELECT (SELECT COUNT(*) FROM doc_comments WHERE doc_id = '${doc.id}') + (SELECT COUNT(*) FROM doc_shares WHERE doc_id = '${doc.id}') AS n`))?.n === 0, "its comments and its link go with it");
  const doc2 = (await (await upload(A)).json()).document;
  await A.api(`/api/v1/share/papers/${doc2.id}/members`, { method: "POST", body: { email: "sh-c@example.com", role: "viewer" } });
  ok((await status(A.api("/api/v1/account", { method: "DELETE", body: { confirm: "DELETE" } }))) === 200, "the owner deletes their account");
  ok((await one(`SELECT COUNT(*) AS n FROM doc_members WHERE doc_id = '${doc2.id}'`))?.n === 0, "everything they shared goes");
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  countFailure();
}
await idp.close?.();
finish("all sharing checks passed", (n) => `${n} check(s) FAILED`);
