// Live presence and live updates in a shared paper (docs/design/paper-live.md, section 6) against the real Worker, its PaperRoom Durable Object, local D1 and the fake identity provider: written
// for SHARE, READER and LIVE "on" (the named run share-on starts the Worker so; scripts/lib/suites.mjs). Two sockets (owner and commenter) see each other; a viewer or commenter cannot say they type
// in a block; a write sends `changed`; 2 KB and 20 a second; a role change closes with 4001, removing a person and stopping the share with 4403; no connection without access (before the upgrade);
// 20 sockets in one room; deleting the paper closes the owner's too.
//   node scripts/live-e2e.mjs    (the Worker must be running with SHARE, READER and LIVE on: `npm run integration -w apps/api -- --run=share-on`)
import { WebSocket } from "undici";
import { SAMPLE_PAPER, makePdf } from "@scholar/test-support/make-pdf.mjs";
import { APP, countFailure, createClient, finish, loginWith, ok, sleep, startIdp, until } from "./lib/harness.mjs";

const idp = await startIdp();
const login = loginWith(idp);
const upload = (c) => c.send(`${APP}/api/v1/documents`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/pdf", "X-Filename": "live.pdf" }, body: makePdf(SAMPLE_PAPER, { title: "Live paper" }) });
const status = async (p) => (await p).status;
const cookieOf = (c) => [...c.jar].map(([k, v]) => `${k}=${v}`).join("; ");

/** A socket to the paper's room as `client` (its cookies, our origin unless told), with what it heard and how it closed. */
function room(client, docId, { origin = APP } = {}) {
  const ws = new WebSocket(`${APP.replace(/^http/, "ws")}/api/v1/documents/${docId}/live`, { headers: { cookie: cookieOf(client), origin } });
  const s = { ws, heard: [], closed: null, failed: false };
  ws.onmessage = (e) => s.heard.push(JSON.parse(String(e.data)));
  ws.onclose = (e) => (s.closed = e.code);
  ws.onerror = () => (s.failed = true);
  s.open = () => until(() => ws.readyState === 1 || s.closed !== null || s.failed, { ms: 10_000 }).then(() => ws.readyState === 1);
  s.here = (h) => ws.send(JSON.stringify({ t: "here", active: true, idle: false, ...h }));
  /** The last presence list heard, as {id: person}. */
  s.people = () => Object.fromEntries((s.heard.filter((m) => m.t === "presence").at(-1)?.people ?? []).map((p) => [p.id, p]));
  s.waitPeople = (pred, what) => until(() => pred(s.people()), { ms: 10_000, what });
  s.waitChanged = (pred, what) => until(() => s.heard.find((m) => m.t === "changed" && pred(m)), { ms: 10_000, what });
  s.waitClosed = () => until(() => s.closed !== null, { ms: 10_000 }).then(() => s.closed);
  return s;
}

try {
  const A = await login("lv-a", "lv-a@example.com", "Asha Owner");
  const doc = (await (await upload(A)).json()).document;
  await A.api(`/api/v1/documents/${doc.id}/finish`, { method: "POST", body: { pages: 3 } });
  const D = `/api/v1/documents/${doc.id}`;
  const S = `/api/v1/share/papers/${doc.id}`;
  const member = async (email, role) => (await (await A.api(`${S}/members`, { method: "POST", body: { email, role } })).json()).member;
  const mB = await member("lv-b@example.com", "editor");
  const mC = await member("lv-c@example.com", "commenter");
  await member("lv-v@example.com", "viewer");
  const B = await login("lv-b", "lv-b@example.com", "Bela Editor");
  const C = await login("lv-c", "lv-c@example.com", "Chen Commenter");
  const V = await login("lv-v", "lv-v@example.com", "Vani Viewer");
  const me = async (c) => (await c.me()).id;
  const [idA, idB, idC, idV] = [await me(A), await me(B), await me(C), await me(V)];

  console.log("the switch and the door, before the upgrade");
  ok((await (await A.api(D)).json()).features?.live === true, "LIVE is on in this run: the owner's paper says live");
  ok((await (await C.api(D)).json()).features?.live === true, "and so does the shared paper");
  ok((await status(createClient(APP).api(`${D}/live`))) === 401, "nobody signed in: 401");
  const X = await login("lv-x", "lv-x@example.com", "Xin Stranger");
  ok((await status(X.api(`${D}/live`))) === 404, "signed in, not named: 404");
  ok((await status(C.api(`${D}/live`, { origin: "https://evil.example" }))) === 403, "another origin: 403");
  ok((await status(C.api(`${D}/live`))) === 400, "a named person without an upgrade: 400 (the door let them through)");
  const xs = room(X, doc.id);
  ok(!(await xs.open()), "a stranger's WebSocket never opens");
  const evil = room(C, doc.id, { origin: "https://evil.example" });
  ok(!(await evil.open()), "nor one from another origin");

  console.log("two sockets, presence both ways");
  const a = room(A, doc.id);
  ok(await a.open(), "the owner joins the room");
  await until(() => a.heard.find((m) => m.t === "hello"), { what: "hello" });
  ok(a.heard.find((m) => m.t === "hello")?.you === idA && a.heard.find((m) => m.t === "hello")?.role === "owner", "hello: who this window is, as the owner");
  const c = room(C, doc.id);
  ok(await c.open(), "the commenter joins");
  await a.waitPeople((p) => p[idC], "the commenter in the owner's list");
  ok(a.people()[idC]?.name === "Chen Commenter" && a.people()[idC]?.role === "commenter" && a.people()[idC]?.colour === 2, "the owner sees the commenter, by name, in the third colour (third in the share)");
  await c.waitPeople((p) => p[idA], "the owner in the commenter's list");
  ok(c.people()[idA]?.colour === 0 && c.people()[idA]?.role === "owner", "the commenter sees the owner, in the first colour");
  ok(!JSON.stringify(a.heard).includes("lv-c@example.com"), "no e-mail address is ever sent");
  c.here({ view: "paper", page: 3 });
  await a.waitPeople((p) => p[idC]?.page === 3, "Viewing p. 3");
  ok(a.people()[idC]?.view === "paper", "the owner sees the commenter on page 3 of the paper");
  c.here({ view: "notes", notesPage: "p1", editingBlock: "b1" });
  await a.waitPeople((p) => p[idC]?.view === "notes", "the commenter in the notes");
  ok(a.people()[idC]?.editingBlock === null, "a commenter cannot say they type in a block");
  const v = room(V, doc.id);
  await v.open();
  v.here({ view: "notes", notesPage: "p1", editingBlock: "b1" });
  await a.waitPeople((p) => p[idV]?.view === "notes", "the viewer in the notes");
  ok(a.people()[idV]?.editingBlock === null, "nor can a viewer");
  const b = room(B, doc.id);
  await b.open();
  b.here({ view: "notes", notesPage: "p1", editingBlock: "b1" });
  await a.waitPeople((p) => p[idB]?.editingBlock === "b1", "the editor typing in b1");
  ok(a.people()[idB]?.notesPage === "p1" && a.people()[idB]?.colour === 1, "an editor typing in a block is shown so, in the second colour");
  c.here({ view: "comments" });
  await a.waitPeople((p) => p[idC]?.view === "comments", "In Comments");
  ok(true, "In Comments");

  console.log("a write sends a signal, never content");
  const put = await B.api(`${D}/notebook/pages/p1`, { method: "PUT", body: { title: "Methods", blocks: [{ id: "b1", kind: "text", md: "secret words" }] } });
  ok(put.status === 201, "the editor makes a page");
  const made = await a.waitChanged((m) => m.kind === "pages" && m.id === "p1", "pages changed");
  ok(made.by === idB && made.rev === 1, "the owner is told: pages, p1, rev 1, by the editor");
  const put2 = await B.api(`${D}/notebook/pages/p1`, { method: "PUT", body: { rev: 1, blocks: [{ id: "b1", kind: "text", md: "more secret words" }] } });
  ok(put2.status === 200, "and changes it");
  ok((await c.waitChanged((m) => m.kind === "notebook" && m.rev === 2, "notebook changed")).id === "p1", "the commenter is told: notebook p1 rev 2");
  ok(!JSON.stringify([...a.heard, ...c.heard]).includes("secret words"), "the socket carries no content");
  const note = await B.api(`${D}/notes`, { method: "POST", body: { page: 1, quote: "glaucoma screening program", color: "pink" } });
  ok(note.status === 201, "the editor highlights");
  await a.waitChanged((m) => m.kind === "highlights", "highlights changed");
  ok(true, "a highlight sends highlights");
  const noteId = (await note.json()).note.id;
  ok((await status(C.api(`${S}/comments`, { method: "POST", body: { anchor: `note:${noteId}`, body: "a question" } }))) === 201, "the commenter comments");
  ok((await b.waitChanged((m) => m.kind === "comments", "comments changed")).by === idC, "a comment sends comments, by the commenter");
  ok((await status(A.api(`${S}/comments/${(await (await A.api(`${S}/comments`)).json()).comments[0].id}`, { method: "PATCH", body: { resolved: true } }))) === 200, "the owner resolves it");
  await sleep(300);
  ok(c.heard.filter((m) => m.t === "changed" && m.kind === "comments").length >= 2, "resolving sends comments too");
  ok((await status(B.api(`${D}/notebook/pages/p1`, { method: "PATCH", body: { title: "Methods 2" } }))) === 200, "a rename");
  await a.waitChanged((m) => m.kind === "pages" && m.id === "p1" && m.rev === undefined, "a rename sends pages");
  ok(true, "a rename sends pages");

  console.log("the limits: 2 KB, 20 a second");
  const big = room(B, doc.id);
  await big.open();
  big.ws.send(JSON.stringify({ t: "here", view: "paper", pad: "x".repeat(3000) }));
  ok((await big.waitClosed()) === 1009, "a message over 2 KB closes the socket (1009)");
  const fast = room(B, doc.id);
  await fast.open();
  for (let i = 0; i < 200; i++) fast.ws.send(JSON.stringify({ t: "here", view: "paper", page: (i % 3) + 1, active: true, idle: false }));
  ok((await fast.waitClosed()) === 1008, "200 messages at once: the socket is closed (1008)");
  ok(a.ws.readyState === 1 && b.ws.readyState === 1, "and nobody else's");

  console.log("20 sockets in one room");
  const many = [];
  for (let i = 0; i < 20; i++) many.push(room(A, doc.id));
  const opened = await Promise.all(many.map((m) => m.open()));
  ok(opened.every(Boolean), "20 more sockets of the owner open");
  ok(Object.keys(b.people()).filter((id) => id === idA).length === 1, "and the owner is still one person in the list");
  for (const m of many) m.ws.close(1000);
  await sleep(500);

  console.log("access changes close sockets");
  ok((await status(A.api(`${S}/members/${mB.id}`, { method: "PATCH", body: { role: "commenter" } }))) === 200, "the editor is made a commenter");
  ok((await b.waitClosed()) === 4001, "their socket is closed with 4001 (connect again, with the new role)");
  const b2 = room(B, doc.id);
  await b2.open();
  b2.here({ view: "notes", notesPage: "p1", editingBlock: "b1" });
  await a.waitPeople((p) => p[idB]?.role === "commenter", "the new role");
  ok(a.people()[idB]?.editingBlock === null, "back as a commenter, they cannot say they type");
  ok((await status(A.api(`${S}/members/${mC.id}`, { method: "DELETE" }))) === 200, "the owner removes the commenter");
  ok((await c.waitClosed()) === 4403, "their socket is closed with 4403");
  await a.waitPeople((p) => !p[idC], "the commenter gone from the list");
  ok(true, "and they leave the owner's list");
  ok((await status(C.api(`${D}/live`))) === 404, "and cannot come back (404)");
  ok((await status(A.api(S, { method: "DELETE" }))) === 200, "Stop sharing");
  ok((await b2.waitClosed()) === 4403 && (await v.waitClosed()) === 4403, "every named person's socket is closed with 4403");
  await sleep(300);
  ok(a.ws.readyState === 1, "the owner's stays open");

  console.log("deleting the paper");
  ok((await status(A.api(D, { method: "DELETE" }))) === 200, "the owner deletes the paper");
  ok((await a.waitClosed()) === 4403, "and their own socket is closed with 4403");
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  countFailure();
}
await idp.close?.();
finish("all live checks passed", (n) => `${n} check(s) FAILED`);
