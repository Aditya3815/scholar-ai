// The Notebook of the new Paper Reader (docs/design/paper-reader.md, 19.3 and 19.9) against the real Worker, local D1 and the fake identity provider: written for READER "on" (the named run
// reader-on starts the Worker so; scripts/lib/suites.mjs). Make a page, edit it, a conflict between two windows, rename it, delete it and bring it back; another person; the data export carries
// the notebook; deleting the paper, and deleting the account, remove the rows.
//   node scripts/notebook-e2e.mjs    (the Worker must be running with READER on: `npm run integration -w apps/api -- --run=reader-on`)
import { SAMPLE_PAPER, makePdf } from "@scholar/test-support/make-pdf.mjs";
import { APP, countFailure, createClient, finish, loginWith, ok, sqlResults, startIdp } from "./lib/harness.mjs";

const idp = await startIdp();
const login = loginWith(idp);
const upload = (c) => c.send(`${APP}/api/v1/documents`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/pdf", "X-Filename": "notebook.pdf" }, body: makePdf(SAMPLE_PAPER, { title: "Notebook paper" }) });
const text = (id, md = "words") => ({ id, kind: "text", md });
const quote = (id, over = {}) => ({ id, kind: "quote", noteId: null, page: 2, quote: "recruited 214 participants", color: "pink", ...over });
const rows = async (where) => (await sqlResults([`SELECT COUNT(*) AS n FROM doc_notebook_pages WHERE ${where}`]))?.[0]?.[0]?.n;

try {
  const A = await login("nb-a", "nb-a@example.com", "Asha Notebook");
  const B = await login("nb-b", "nb-b@example.com", "Bela Other");
  const doc = (await (await upload(A)).json()).document;
  await A.api(`/api/v1/documents/${doc.id}/finish`, { method: "POST", body: { pages: 3 } });
  const NB = `/api/v1/documents/${doc.id}/notebook`;
  const PG = (id) => `${NB}/pages/${id}`;

  console.log("who may ask");
  ok((await (await A.api(`/api/v1/documents/${doc.id}`)).json()).features?.reader === true, "READER is on in this run (the paper's details say so)");
  ok((await createClient(APP).api(NB)).status === 401, "the notebook needs sign-in");
  ok((await B.api(NB)).status === 404 && (await B.api(PG("p1"), { method: "PUT", body: { blocks: [] } })).status === 404, "another person's paper: 404, for reading and for writing");
  ok((await A.api(PG("p1"), { method: "PUT", body: { blocks: [] }, origin: null })).status === 403, "a write has the cross-origin check");
  ok(JSON.stringify((await (await A.api(NB)).json()).pages) === "[]", "a paper with no notes has no pages: opening it made none");

  console.log("make a page, edit it");
  const made = await A.api(PG("p1"), { method: "PUT", body: { title: "Methods", style: "ruled", blocks: [text("t1", "# Sample\nWho was **recruited**")] } });
  const p1 = (await made.json()).page;
  ok(made.status === 201 && p1.rev === 1 && p1.title === "Methods" && p1.style === "ruled" && p1.position === 1, "PUT with no revision makes the page: 201, revision 1, at the end");
  const edit = await A.api(PG("p1"), { method: "PUT", body: { rev: 1, blocks: [text("t1", "# Sample\nWho was **recruited**"), quote("q1")] } });
  ok(edit.status === 200 && (await edit.json()).page.rev === 2, "PUT with the revision it started from replaces the blocks: revision 2");
  ok((await A.api(PG("p1"), { method: "PUT", body: { rev: 2, blocks: [quote("q2", { page: 4 })] } })).status === 400, "a quote of a page the paper does not have is refused (400)");
  ok((await A.api(PG("p1"), { method: "PUT", body: { rev: 2, blocks: [{ id: "c1", kind: "capture", page: 1, x: 0, y: 0, w: 0.5, h: 0.5 }] } })).status === 400, "a capture is refused in phase 2");
  ok((await A.api(PG("p1"), { method: "PUT", body: { rev: 2, blocks: Array.from({ length: 201 }, (_, i) => text(`b${i}`)) } })).status === 413, "201 blocks is too many (413)");
  ok((await A.api(PG("p1"), { method: "PUT", body: { rev: 2, blocks: [text("big", "x".repeat(70_000))] } })).status === 413, "a body over the limit is refused (413)");

  console.log("two windows");
  const fromA = await A.api(PG("p1"), { method: "PUT", body: { rev: 2, blocks: [text("t1", "window A was here"), quote("q1")] } });
  ok(fromA.status === 200, "window A saves on revision 2");
  const fromB = await A.api(PG("p1"), { method: "PUT", body: { rev: 2, blocks: [text("t1", "window B was here")] } });
  const conflict = await fromB.json();
  ok(fromB.status === 409 && conflict.type === "conflict" && conflict.page.rev === 3 && conflict.page.blocks[0].md === "window A was here", "window B, still on revision 2, gets 409 and the server's page");
  ok((await A.api(PG("p1"), { method: "PATCH", body: { title: "Methods and sample" } })).status === 200, "a rename needs no revision");
  const after = (await (await A.api(NB)).json()).pages[0];
  ok(after.title === "Methods and sample" && after.rev === 3, "and does not move the blocks' revision");

  console.log("pages: another one, a move, delete and Undo");
  await A.api(PG("p2"), { method: "PUT", body: { title: "Results", blocks: [text("r1", "Sensitivity was 0.87")] } });
  await A.api(PG("p2"), { method: "PATCH", body: { position: 0.5 } });
  ok(JSON.stringify((await (await A.api(NB)).json()).pages.map((p) => p.id)) === '["p2","p1"]', "a page moved to the top comes first (a place between its neighbours, nothing renumbered)");
  const gone = (await (await A.api(NB)).json()).pages[0];
  ok((await A.api(PG("p2"), { method: "DELETE" })).status === 204 && (await A.api(PG("p2"), { method: "DELETE" })).status === 404, "DELETE answers 204, once");
  const back = await A.api(PG("p2"), { method: "PUT", body: { title: gone.title, style: gone.style, position: gone.position, blocks: gone.blocks } });
  ok(back.status === 201 && JSON.stringify((await back.json()).page.blocks) === JSON.stringify(gone.blocks), "Undo puts the page back with all its blocks (PUT with no revision)");

  console.log("export and deletion");
  const exp = await (await A.api("/api/v1/account/export")).json();
  const mine = (exp.notebook ?? []).filter((p) => p.docId === doc.id);
  ok(mine.length === 2 && mine[0].title === "Results" && mine[1].blocks.some((b) => b.kind === "quote" && b.quote === "recruited 214 participants"), `the data export carries the notebook, in order (${mine.map((p) => p.title).join(", ")})`);
  ok(JSON.stringify((await (await B.api("/api/v1/account/export")).json()).notebook) === "[]", "and nobody else's");
  ok((await rows(`doc_id = '${doc.id}'`)) === 2, "(two rows before the paper is deleted)");
  ok((await A.api(`/api/v1/documents/${doc.id}`, { method: "DELETE" })).status === 200 && (await rows(`doc_id = '${doc.id}'`)) === 0, "deleting the paper deletes its pages of notes");
  const doc2 = (await (await upload(A)).json()).document;
  await A.api(`/api/v1/documents/${doc2.id}/notebook/pages/k1`, { method: "PUT", body: { blocks: [text("k", "kept until the account goes")] } });
  ok((await rows(`doc_id = '${doc2.id}'`)) === 1, "(a page on a second paper)");
  ok((await A.api("/api/v1/account", { method: "DELETE", body: { confirm: "DELETE" } })).status === 200 && (await rows(`doc_id = '${doc2.id}'`)) === 0, "deleting the account deletes every page of notes");
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  countFailure();
}
await idp.close?.();
finish("all notebook checks passed", (n) => `${n} check(s) FAILED`);
