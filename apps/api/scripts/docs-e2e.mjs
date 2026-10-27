// Uploaded papers + grounded Q&A integration test: real Worker + local D1 + local R2 + fake IdP, with the offline model stand-in
// (QA_STUB=1). Same setup as library-e2e.mjs; `npm run integration -w apps/api` starts everything.
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";
import { SAMPLE_PAPER, makePdf } from "./lib/make-pdf.mjs";
import { checkStream, reportStreams } from "./lib/stream-rule.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const idp = await startFakeIdp(9911);
const login = async (sub, email, name) => {
  idp.setUser({ sub, email, email_verified: true, name });
  const c = createClient(APP);
  await c.follow(`${APP}/api/v1/auth/google/start`);
  await c.ack();
  return c;
};
const pdf = makePdf(SAMPLE_PAPER, { title: "Glaucoma screening" });
const upload = (c, body, { name = "glaucoma_screening.pdf", origin = APP, type = "application/pdf", key } = {}) =>
  c.send(`${APP}/api/v1/documents`, { method: "POST", headers: { ...(origin ? { Origin: origin } : {}), "Content-Type": type, "X-Filename": encodeURIComponent(name), ...(key ? { "Idempotency-Key": key } : {}) }, body });
const pages = (texts) => texts.map((text, i) => ({ page: i + 1, text }));

try {
  console.log("the privacy note comes first");
  {
    idp.setUser({ sub: "doc-new", email: "new@example.com", email_verified: true, name: "New Person" });
    const fresh = createClient(APP);
    await fresh.follow(`${APP}/api/v1/auth/google/start`);
    const refused = await upload(fresh, makePdf(SAMPLE_PAPER));
    ok(refused.status === 403 && (await refused.json()).type === "privacy_ack_required", "a first upload is refused until the privacy note has been read");
    ok((await fresh.api("/api/v1/account/privacy-ack", { method: "POST", body: { version: "something-old" } })).status === 400, "agreeing to a text that is not the current one is refused");
    ok((await fresh.api("/api/v1/account/privacy-ack", { method: "POST", body: { version: "x" }, origin: null })).status === 403, "agreeing has the cross-origin check");
    ok((await fresh.ack()).status === 200 && (await upload(fresh, makePdf(SAMPLE_PAPER))).status === 201, "after agreeing, the upload goes through");
    const exp0 = await (await fresh.api("/api/v1/account/export")).json();
    ok(/^2026-/.test(exp0.account.privacy_ack ?? "") && !!exp0.account.privacy_ack_at, "the export shows which text was agreed to, and when");
  }

  console.log("anonymous access is refused");
  const anon = createClient(APP);
  ok((await anon.api("/api/v1/documents")).status === 401, "GET /documents -> 401");
  ok((await upload(anon, pdf)).status === 401, "upload -> 401");
  ok((await anon.api("/api/v1/documents/abc/ask", { method: "POST", body: { question: "What?" } })).status === 401, "ask -> 401");
  ok((await anon.api("/api/v1/documents/abc/file")).status === 401, "file -> 401");

  console.log("upload");
  const A = await login("doc-a", "a@example.com", "Alice");
  ok((await (await A.api("/api/v1/documents")).json()).items.length === 0, "new account has no papers");
  ok((await upload(A, Buffer.from("just some text, not a pdf at all"), { type: "text/plain" })).status === 415, "a non-PDF is rejected (magic bytes, not Content-Type)");
  ok((await upload(A, Buffer.from("just some text, not a pdf at all"), { type: "application/pdf" })).status === 415, "a text file labelled application/pdf is rejected too");
  ok((await upload(A, pdf, { origin: null })).status === 403, "upload without an Origin is blocked (CSRF)");
  ok((await upload(A, pdf, { origin: "http://evil.example" })).status === 403, "upload from another origin is blocked");
  const big = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(26 * 1024 * 1024)]);
  ok((await upload(A, big)).status === 413, "a PDF over 25 MB is rejected");
  const res = await upload(A, pdf, { name: "../../etc/glaucoma_screening.pdf" });
  const doc = (await res.json()).document;
  ok(res.status === 201 && doc.status === "uploaded" && doc.sizeBytes === pdf.length, "a real PDF is stored");
  ok(doc.filename === "glaucoma_screening.pdf" && doc.title === "glaucoma screening", `filename is sanitised and the title derived (${doc.filename} / ${doc.title})`);
  const f = await A.api(`/api/v1/documents/${doc.id}/file`);
  const back = Buffer.from(await f.arrayBuffer());
  ok(f.status === 200 && f.headers.get("content-type") === "application/pdf" && back.equals(pdf), "the file downloads byte for byte");
  ok(/no-store/.test(f.headers.get("cache-control") ?? ""), "the file is never cached by shared caches");

  console.log("a repeated upload with the same Idempotency-Key");
  {
    const I = await login("doc-idem", "idem@example.com", "Ida Idem");
    await I.ack();
    const key = "11111111-2222-4333-8444-555555555555";
    const first = await upload(I, pdf, { key });
    const again = await upload(I, pdf, { key });
    const d1 = (await first.json()).document;
    const d2 = (await again.json()).document;
    ok(first.status === 201 && again.status === 201 && again.headers.get("idempotent-replayed") === "true" && first.headers.get("idempotent-replayed") === null, "the second try gets the first reply back, marked as a replay");
    ok(d1.id === d2.id && (await (await I.api("/api/v1/documents")).json()).items.length === 1, "and only one paper exists (a lost reply followed by a retry stores nothing twice)");
    ok((await upload(I, pdf, { key, name: "another_file.pdf" })).status === 422, "the same key with a different file is refused (422)");
    ok((await upload(I, pdf, { key: "short" })).status === 400, "a key that is not acceptable is refused (400)");
    const noKey = await upload(I, pdf);
    ok(noKey.status === 201 && (await (await I.api("/api/v1/documents")).json()).items.length === 2, "without a key an upload works as before (and a second paper is a second paper)");
    const bad = await upload(I, Buffer.from("not a pdf at all"), { key: "22222222-3333-4444-8555-666666666666" });
    const bad2 = await upload(I, pdf, { key: "22222222-3333-4444-8555-666666666666" });
    ok(bad.status === 415 && bad2.status === 201, "an error is not kept: after a refused file the same key can be used for a good one");
    const other = await login("doc-idem-2", "idem2@example.com", "Ivan Other");
    await other.ack();
    const theirs = await upload(other, pdf, { key });
    ok(theirs.status === 201 && theirs.headers.get("idempotent-replayed") === null, "another person using the same key is a different request");
    const both = await Promise.all([upload(I, pdf, { key: "33333333-4444-4555-8666-777777777777" }), upload(I, pdf, { key: "33333333-4444-4555-8666-777777777777" })]);
    const codes = both.map((r) => r.status).sort();
    ok((codes[0] === 201 && (codes[1] === 201 || codes[1] === 409)) && (await (await I.api("/api/v1/documents")).json()).items.length === 4, `two uploads at the same moment with one key store one paper (${codes.join(" and ")})`);
  }

  console.log("asking before the paper is indexed");
  ok((await A.api(`/api/v1/documents/${doc.id}/ask`, { method: "POST", body: { question: "What is this?" } })).status === 409, "not ready -> 409");

  console.log("indexing (the browser sends the text of each page)");
  const P = `/api/v1/documents/${doc.id}`;
  ok((await A.api(`${P}/pages`, { method: "POST", body: { pages: [] } })).status === 400, "an empty batch is rejected");
  ok((await A.api(`${P}/pages`, { method: "POST", body: { pages: Array.from({ length: 11 }, (_, i) => ({ page: i + 1, text: "x" })) } })).status === 400, "more than 10 pages per batch is rejected");
  ok((await A.api(`${P}/pages`, { method: "POST", body: { pages: [{ page: 0, text: "x" }] } })).status === 400, "page numbers start at 1");
  ok((await A.api(`${P}/pages`, { method: "POST", body: { pages: [{ page: 1, text: 5 }] } })).status === 400, "text must be a string");
  ok((await A.api(`${P}/pages`, { method: "POST", body: { pages: [{ page: 1, text: "y".repeat(160_000) }] } })).status === 413, "an oversized batch is rejected");
  let r = await (await A.api(`${P}/pages`, { method: "POST", body: { pages: pages(SAMPLE_PAPER.slice(0, 2)) } })).json();
  ok(r.ok && r.chunks >= 2, `pages 1-2 indexed (${r.chunks} chunks)`);
  r = await (await A.api(`${P}/pages`, { method: "POST", body: { pages: pages(SAMPLE_PAPER).slice(2) } })).json();
  ok(r.ok, "page 3 indexed in a second batch");
  const again = await (await A.api(`${P}/pages`, { method: "POST", body: { pages: pages(SAMPLE_PAPER.slice(0, 1)) } })).json();
  ok(again.ok, "re-sending a page replaces its chunks (idempotent)");
  const fin = (await (await A.api(`${P}/finish`, { method: "POST", body: { pages: 3 } })).json()).document;
  ok(fin.status === "ready" && fin.pages === 3 && fin.chunkCount >= 3, `finished: ready, 3 pages, ${fin.chunkCount} chunks`);

  console.log("asking questions");
  const ask = async (q) => A.api(`${P}/ask`, { method: "POST", body: { question: q } });
  let a = await (await ask("How were participants recruited?")).json();
  ok(a.answer.found && a.answer.verified && a.answer.citations.length >= 1, "answers with a verified citation");
  ok(a.answer.citations[0].page === 2 && /Pune/.test(a.answer.citations[0].quote), `the citation points at page 2 and quotes the paper (${a.answer.citations[0]?.quote?.slice(0, 50)})`);
  a = await (await ask("an unanswerable question about funding")).json();
  ok(a.answer.found === false && a.answer.citations.length === 0, "says so when the paper does not cover it, with no invented citations");
  a = await (await ask("please hallucinate something")).json();
  ok(a.answer.verified === false && a.answer.citations.length === 0 && !/\[1\]/.test(a.answer.answer), "an invented quote is dropped and the answer flagged as unverified");
  ok((await ask("hi")).status === 400, "a question shorter than 3 characters is rejected");
  ok((await ask("x".repeat(601))).status === 400, "a question over 600 characters is rejected");
  ok((await A.api(`${P}/ask`, { method: "POST", body: { question: "How were participants recruited?" }, origin: null })).status === 403, "asking without an Origin is blocked");
  const history = (await (await A.api(P)).json()).history;
  ok(history.length === 3 && history[0].question === "How were participants recruited?", "the question history is kept, oldest first");

  console.log("a scanned PDF (no text) fails clearly");
  const scanned = (await (await upload(A, makePdf([""]), { name: "scan.pdf" })).json()).document;
  const sFin = (await (await A.api(`/api/v1/documents/${scanned.id}/finish`, { method: "POST", body: { pages: 1 } })).json()).document;
  ok(sFin.status === "failed" && /scanned/i.test(sFin.error), "finishing with no text marks it failed with an explanation");
  const sAsk = await A.api(`/api/v1/documents/${scanned.id}/ask`, { method: "POST", body: { question: "What is this about?" } });
  ok(sAsk.status === 409, "asking a failed paper -> 409");

  console.log("cover, rename");
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
  const putCover = (body, origin = APP) => A.send(`${APP}${P}/cover`, { method: "PUT", headers: { ...(origin ? { Origin: origin } : {}), "Content-Type": "image/jpeg" }, body });
  ok((await putCover(Buffer.from("not a jpeg"))).status === 400, "a non-JPEG cover is rejected");
  ok((await putCover(jpeg)).status === 200, "a JPEG cover is stored");
  const cv = await A.api(`${P}/cover`);
  ok(cv.status === 200 && cv.headers.get("content-type") === "image/jpeg", "the cover is served as an image");
  ok((await (await A.api(P)).json()).document.hasCover === true, "hasCover is set");
  ok((await A.api(P, { method: "PATCH", body: { title: "   " } })).status === 400, "an empty title is rejected");
  const renamed = (await (await A.api(P, { method: "PATCH", body: { title: "Glaucoma screening (Pune cohort)" } })).json()).document;
  ok(renamed.title === "Glaucoma screening (Pune cohort)", "rename works");
  const list = await (await A.api("/api/v1/documents")).json();
  ok(list.items.length === 2 && list.usage.count === 2 && list.usage.bytes > 0, "the list reports usage");

  console.log("isolation between users");
  const B = await login("doc-b", "b@example.com", "Bob");
  ok((await (await B.api("/api/v1/documents")).json()).items.length === 0, "Bob sees none of Alice's papers");
  for (const [m, p, body] of [["GET", P], ["GET", `${P}/file`], ["GET", `${P}/cover`], ["POST", `${P}/ask`, { question: "How were participants recruited?" }], ["POST", `${P}/pages`, { pages: pages(["hello there general kenobi"]) }], ["PATCH", P, { title: "mine now" }], ["DELETE", P]]) {
    const res = await B.api(p, { method: m, body });
    ok(res.status === 404, `Bob ${m} ${p.replace(doc.id, ":id")} -> 404`);
  }
  ok((await (await A.api(P)).json()).document.title === "Glaucoma screening (Pune cohort)", "Alice's paper is untouched");

  console.log("streaming answers (server-sent events)");
  const sse = async (q, { signal, id = doc.id, origin = APP } = {}) => {
    const res = await A.send(`${APP}/api/v1/documents/${id}/ask?stream=1`, {
      method: "POST", signal,
      headers: { ...(origin ? { Origin: origin } : {}), "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ question: q }),
    });
    return res;
  };
  async function readEvents(res, { stopAfter } = {}) {
    const events = [];
    const dec = new TextDecoder();
    let buf = "";
    for await (const part of res.body) {
      buf += dec.decode(part, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = block.split("\n").find((l) => l.startsWith("data:"));
        if (data) events.push(JSON.parse(data.slice(5)));
        if (stopAfter && events.filter((e) => e.type === "delta").length >= stopAfter) return events;
      }
    }
    checkStream("ask", events, "paper question");
    return events;
  }
  const t0 = Date.now();
  const res1 = await sse("How were participants recruited?");
  ok(res1.status === 200 && /event-stream/.test(res1.headers.get("content-type") ?? ""), "an answer can be requested as a server-sent-event stream");
  const ev = await readEvents(res1);
  const kinds = ev.map((e) => (e.type === "stage" ? "stage:" + e.stage : e.type));
  ok(kinds[0] === "stage:retrieving" && kinds[1] === "sources", `it starts with retrieval and the pages it will read (${kinds.slice(0, 3).join(", ")})`);
  ok(kinds.indexOf("stage:thinking") > 1 && kinds.indexOf("stage:writing") > kinds.indexOf("stage:thinking"), "then thinking, then writing");
  ok(ev.filter((e) => e.type === "delta").length >= 3, `the answer text arrives in several pieces (${ev.filter((e) => e.type === "delta").length})`);
  ok(kinds.at(-2) === "stage:checking" && kinds.at(-1) === "answer", "it ends with a checking stage and the verified answer");
  const last = ev.at(-1).answer;
  ok(last.verified && last.citations[0].page === 2 && Date.now() - t0 > 300, "the final answer carries the checked citation");
  ok(ev.find((e) => e.type === "sources").pages.includes(2), "the announced pages include the page the answer came from");
  const hist = (await (await A.api(P)).json()).history;
  ok(hist.length === 4 && hist.at(-1).id === last.id, "the streamed answer is saved to the history like any other");

  const ctl = new AbortController();
  const res2 = await sse("How were participants recruited?", { signal: ctl.signal });
  await readEvents(res2, { stopAfter: 1 });
  ctl.abort();
  await new Promise((r) => setTimeout(r, 1200));
  ok((await (await A.api(P)).json()).history.length === 4, "a reader who leaves mid-answer leaves nothing half-saved");

  const resBad = await sse("hi");
  ok(resBad.status === 400 && /json/.test(resBad.headers.get("content-type") ?? ""), "validation errors are plain HTTP errors, not a stream");
  ok((await sse("How were participants recruited?", { origin: null })).status === 403, "the stream endpoint has the same CSRF protection");
  ok((await sse("What is this?", { id: scanned.id })).status === 409, "a paper that is not ready is refused before any stream starts");
  const resB = await B.send(`${APP}/api/v1/documents/${doc.id}/ask?stream=1`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/json" }, body: JSON.stringify({ question: "How were participants recruited?" }) });
  ok(resB.status === 404, "another user cannot stream questions about this paper");

  console.log("what the browser learned about the paper (title, DOI, outline, references)");
  const info = { pages: 3, title: "A Scanned Thesis About Rivers", doi: "10.1234/no.such.paper.2026", arxiv: null, outline: [{ title: "Introduction", page: 1, level: 1 }], headings: [{ title: "Methods", page: 2, level: 1 }], references: ["Smith, J. (2020). A study of studies about rivers. Journal of Water, 4(2), 1-10.", "Rao, P. (2019). Another long title about rivers and lakes. Hydrology Today, 8, 5-9."] };
  const putInfo = (id, body, { origin = APP, client = A } = {}) => client.send(`${APP}/api/v1/documents/${id}/info`, { method: "PUT", headers: { ...(origin ? { Origin: origin } : {}), "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
  ok((await putInfo(scanned.id, info, { origin: null })).status === 403, "storing it needs the same-origin check");
  ok((await putInfo(scanned.id, "not json")).status === 400 && (await putInfo(scanned.id, { title: "x" })).status === 400, "garbage is refused");
  ok((await putInfo(scanned.id, JSON.stringify({ ...info, references: ["y".repeat(200)].concat(Array(4000).fill("z".repeat(200))) }))).status === 413, "an absurdly large body is refused");
  ok((await putInfo(scanned.id, info, { client: B })).status === 404, "another user cannot write it");
  const stored = await (await putInfo(scanned.id, { ...info, metadata: { title: "forged" } })).json();
  ok(stored.info.references.length === 2 && stored.info.referencesSource === "pdf" && stored.info.metadata === null, "it is stored, and a forged metadata field is ignored");
  ok(stored.document.title === "A Scanned Thesis About Rivers", "a paper still carrying its file-name title takes the real title");
  const got = await (await A.api(`/api/v1/documents/${scanned.id}`)).json();
  ok(got.info.outline[0].title === "Introduction" && got.info.references[1].startsWith("Rao"), "reading the paper returns it");
  await A.api(`/api/v1/documents/${scanned.id}`, { method: "PATCH", body: { title: "My own name" } });
  const reput = await (await putInfo(scanned.id, info)).json();
  ok(reput.document.title === "My own name", "a title the user chose is never overwritten");
  ok((await (await A.api(`/api/v1/documents/${doc.id}`)).json()).info === null, "a paper nobody analysed has no info");

  console.log("highlights and notes");
  const NP = `${P}/notes`;
  ok((await createClient(APP).api(NP)).status === 401 && (await createClient(APP).api(NP, { method: "POST", body: { page: 1, quote: "some words here" } })).status === 401, "notes need sign-in");
  const made = await A.api(NP, { method: "POST", body: { page: 2, quote: "  recruited 214\n participants  ", note: "Check   the sample size", color: "pink" } });
  const note = (await made.json()).note;
  ok(made.status === 201 && note.quote === "recruited 214 participants" && note.note === "Check the sample size" && note.color === "pink" && note.page === 2, "a note is saved with its quote tidied, its colour and its page");
  const hl = (await (await A.api(NP, { method: "POST", body: { page: 1, quote: "Pune hospitals" } })).json()).note;
  ok(hl.note === "" && hl.color === "yellow", "a highlight with no note text is just a quote, in the default colour");
  const noteList = (await (await A.api(NP)).json()).items;
  ok(noteList.length === 2 && noteList[0].page === 1 && noteList[1].id === note.id, "the list comes back in page order");
  const edited = await A.api(`${NP}/${note.id}`, { method: "PATCH", body: { note: "Sample size is 214, not 241", color: "green" } });
  ok(edited.status === 200 && (await edited.json()).note.note === "Sample size is 214, not 241", "a note can be edited, and its colour changed");
  ok((await A.api(`${NP}/${note.id}`, { method: "PATCH", body: { color: "blue" } })).status === 200 && (await (await A.api(NP)).json()).items.find((n) => n.id === note.id).note.startsWith("Sample size"), "changing only the colour keeps the note text");
  ok((await A.api(NP, { method: "POST", body: { page: 0, quote: "some words here" } })).status === 400 && (await A.api(NP, { method: "POST", body: { page: 999, quote: "some words here" } })).status === 400, "a page that is not in the paper is refused");
  ok((await A.api(NP, { method: "POST", body: { page: 1, quote: "ab" } })).status === 400 && (await A.api(NP, { method: "POST", body: "nonsense" })).status === 400, "an empty selection and garbage are refused");
  ok((await A.api(NP, { method: "POST", body: { page: 1, quote: "some words here" }, origin: null })).status === 403, "notes have the cross-origin check");
  ok((await B.api(NP)).status === 404 && (await B.api(NP, { method: "POST", body: { page: 1, quote: "some words here" } })).status === 404, "another user cannot read or add notes to this paper");
  ok((await B.api(`${NP}/${note.id}`, { method: "PATCH", body: { note: "mine now" } })).status === 404 && (await B.api(`${NP}/${note.id}`, { method: "DELETE" })).status === 404, "...or change or delete one");
  ok((await A.api(`${NP}/${hl.id}`, { method: "DELETE" })).status === 200 && (await A.api(`${NP}/${hl.id}`, { method: "DELETE" })).status === 404, "a note can be deleted, once");
  ok((await (await A.api(NP)).json()).items.length === 1, "...and the list shrinks");

  console.log("drawing on a paper");
  const IP = `${P}/ink`;
  const dot = (id, over = {}) => ({ id, page: 1, tool: "pen", color: "blue", w: 0.0034, pts: [0.1, 0.1, 0.5, 0.2, 0.15, 0.5, 0.3, 0.12, 0.5], ...over });
  ok((await createClient(APP).api(IP)).status === 401 && (await createClient(APP).api(IP, { method: "PUT", body: { strokes: [], rev: 0 } })).status === 401, "drawing needs sign-in");
  const ink0 = await (await A.api(IP)).json();
  ok(Array.isArray(ink0.strokes) && ink0.strokes.length === 0 && ink0.rev === 0, "a paper nobody drew on has no strokes, revision 0");
  const saved1 = await A.api(IP, { method: "PUT", body: { strokes: [dot("s1"), dot("s2", { tool: "highlighter", color: "yellow", w: 0.02 })], rev: 0 } });
  ok(saved1.status === 200 && (await saved1.json()).rev === 1, "the first save is revision 1");
  const ink1 = await (await A.api(IP)).json();
  ok(ink1.strokes.length === 2 && ink1.rev === 1 && ink1.strokes[1].tool === "highlighter", "and it comes back as it was sent");
  const saved2 = await A.api(IP, { method: "PUT", body: { strokes: [dot("s1")], rev: 1 } });
  ok(saved2.status === 200 && (await saved2.json()).rev === 2 && (await (await A.api(IP)).json()).strokes.length === 1, "a later save (a stroke erased) replaces the drawing, revision 2");
  const stale = await A.api(IP, { method: "PUT", body: { strokes: [dot("late")], rev: 1 } });
  const staleBody = await stale.json();
  ok(stale.status === 409 && staleBody.type === "conflict" && staleBody.rev === 2 && staleBody.strokes.length === 1, "a save made from an old revision (another window drew since) is refused with the newer drawing");
  const second0 = await A.api(IP, { method: "PUT", body: { strokes: [dot("x")], rev: 0 } });
  ok(second0.status === 409, "starting from revision 0 when something is saved is refused too (two windows opened at the same time)");
  ok((await A.api(IP, { method: "PUT", body: { strokes: [dot("a", { page: 99 })], rev: 2 } })).status === 400, "a stroke on a page the paper does not have is refused");
  ok((await A.api(IP, { method: "PUT", body: { strokes: [dot("a", { color: "magenta" })], rev: 2 } })).status === 400 && (await A.api(IP, { method: "PUT", body: { strokes: [dot("a", { tool: "brush" })], rev: 2 } })).status === 400, "an unknown colour or tool is refused");
  ok((await A.api(IP, { method: "PUT", body: { strokes: [dot("a", { pts: [0.1, 0.1] })], rev: 2 } })).status === 400 && (await A.api(IP, { method: "PUT", body: { strokes: "x", rev: 2 } })).status === 400 && (await A.api(IP, { method: "PUT", body: { strokes: [], rev: "2" } })).status === 400, "broken points, a non-list and a non-number revision are refused");
  ok((await A.api(IP, { method: "PUT", body: { strokes: Array.from({ length: 4001 }, (_, i) => dot(`m${i}`)), rev: 2 } })).status === 413, "more strokes than a paper can hold is refused as too big");
  ok((await A.api(IP)).status === 200 && (await (await A.api(IP)).json()).rev === 2, "refused saves changed nothing");
  ok((await A.api(IP, { method: "PUT", body: { strokes: [], rev: 2 }, origin: null })).status === 403, "drawing has the cross-origin check");
  ok((await B.api(IP)).status === 404 && (await B.api(IP, { method: "PUT", body: { strokes: [], rev: 0 } })).status === 404, "another user cannot read or draw on this paper");
  ok((await A.api(IP, { method: "PUT", body: { strokes: [dot("tiny", { w: 0 }), dot("huge", { w: 9, pts: [-5, 99, 3, 7, 7, -1] })], rev: 2 } })).status === 200, "a width, position or pressure out of range is brought into range, not refused");
  const clamped = (await (await A.api(IP)).json()).strokes;
  ok(clamped[0].w === 0.0005 && clamped[1].w === 0.08 && clamped[1].pts[2] === 1 && clamped[1].pts[5] === 0, "the saved values are the clamped ones");
  ok((await A.api(IP, { method: "PUT", body: { strokes: [dot("s1")], rev: 3 } })).status === 200, "(put one stroke back for the export check)");

  console.log("My Workspace: status, tags, progress, search, remember");
  const MP = `${P}/meta`;
  const base0 = (await (await A.api(P)).json()).document;
  ok(base0.readState === "to_read" && base0.lastPage === null && base0.maxPage === null && base0.openedAt === null && Array.isArray(base0.tags) && base0.tags.length === 0, "a new paper is 'to read', has no place, no progress and no tags");
  ok((await createClient(APP).api(MP, { method: "PUT", body: { readState: "done" } })).status === 401, "status and tags need sign-in");
  ok((await B.api(MP, { method: "PUT", body: { readState: "done" } })).status === 404 && (await B.api(`${P}/progress`, { method: "POST", body: { page: 2 } })).status === 404, "another user cannot change them");
  ok((await A.api(MP, { method: "PUT", body: { readState: "done" }, origin: null })).status === 403, "they have the cross-origin check");
  ok((await A.api(MP, { method: "PUT", body: { readState: "finished" } })).status === 400 && (await A.api(MP, { method: "PUT", body: {} })).status === 400 && (await A.api(MP, { method: "PUT", body: { tags: "x" } })).status === 400, "a status that does not exist, an empty change and a tag list that is not a list are refused");
  const withTags = await (await A.api(MP, { method: "PUT", body: { readState: "reading", tags: ["  Methods ", "thesis", "METHODS", "", "शोध"] } })).json();
  ok(withTags.document.readState === "reading" && JSON.stringify(withTags.document.tags) === JSON.stringify(["Methods", "thesis", "शोध"]), "status and tags are saved, tidied, de-duplicated without regard to case, sorted");
  ok((await A.api(MP, { method: "PUT", body: { tags: Array.from({ length: 11 }, (_, i) => `t${i}`) } })).status === 400, "more than ten tags are refused");
  ok((await (await A.api(P)).json()).document.tags.length === 3, "a refused change changed nothing");
  ok(JSON.stringify((await (await A.api(MP, { method: "PUT", body: { tags: [] } })).json()).document.tags) === "[]" && (await (await A.api(P)).json()).document.readState === "reading", "tags can be emptied without touching the status");
  await A.api(MP, { method: "PUT", body: { readState: "to_read", tags: ["thesis"] } });

  const pr = `${P}/progress`;
  ok((await A.api(pr, { method: "POST", body: { page: 0 } })).status === 400 && (await A.api(pr, { method: "POST", body: { page: 999 } })).status === 400 && (await A.api(pr, { method: "POST", body: { page: "2" } })).status === 400, "a page that is not in the paper, or not a number, is refused");
  const p1 = (await (await A.api(pr, { method: "POST", body: { page: 1 } })).json()).document;
  ok(p1.lastPage === 1 && p1.maxPage === 1 && p1.readState === "to_read" && p1.openedAt > 0, "being on page 1 records the place and the time but does not make it 'reading'");
  const p3 = (await (await A.api(pr, { method: "POST", body: { page: 3 } })).json()).document;
  ok(p3.lastPage === 3 && p3.maxPage === 3 && p3.readState === "reading", "going past page 1 makes a 'to read' paper 'reading'");
  const goneBack = (await (await A.api(pr, { method: "POST", body: { page: 2 } })).json()).document;
  ok(goneBack.lastPage === 2 && goneBack.maxPage === 3, "going back moves the place but never the furthest page");
  await A.api(MP, { method: "PUT", body: { readState: "done" } });
  ok((await (await A.api(pr, { method: "POST", body: { page: 3 } })).json()).document.readState === "done", "a paper marked done stays done when it is opened again");
  ok((await A.api(pr, { method: "POST", body: { page: 2 }, origin: null })).status === 403, "progress has the cross-origin check");

  console.log("search across papers, highlights and notes");
  const find = async (client, q) => (await client.api(`/api/v1/documents/search?q=${encodeURIComponent(q)}`)).json();
  ok((await createClient(APP).api("/api/v1/documents/search?q=glaucoma")).status === 401, "search needs sign-in");
  const sr = await find(A, "glaucoma screening");
  ok(sr.papers.some((x) => x.docId === doc.id) && sr.passages.some((x) => x.docId === doc.id && /glaucoma/i.test(x.snippet)) , "a search finds the paper by its title and the passages that hold the words");
  ok((await find(A, "thesis")).papers.some((x) => x.docId === doc.id), "a tag is found too");
  ok((await find(A, "glaucoma zzzznotthere")).passages.length === 0, "all the words must be present");
  ok((await find(A, "  ?  ")).papers.length === 0 && (await find(A, "")).passages.length === 0, "a search with no usable word finds nothing and is not an error");
  ok((await find(A, "100% _ glaucoma")).passages.length === 0 && (await find(A, "%")).papers.length === 0, "the characters % and _ are ordinary characters, not wildcards");
  const hlText = "a distinctive quotation about calibration drift in tractor sensors";
  await A.api(`${P}/notes`, { method: "POST", body: { page: 1, quote: hlText, note: "revisit the xylophone claim", color: "green" } });
  const sh = await find(A, "calibration drift");
  ok(sh.highlights.some((x) => x.docId === doc.id && x.color === "green" && x.quote === hlText), "highlights are found by their words");
  ok((await find(A, "xylophone")).highlights.length === 1, "and notes by theirs");
  ok((await find(B, "glaucoma")).passages.length === 0 && (await find(B, "xylophone")).highlights.length === 0 && (await find(B, "glaucoma")).papers.length === 0, "another person's search never sees these");

  console.log("remember this");
  const rem0 = await (await B.api("/api/v1/documents/remember")).json();
  ok(rem0.highlight === null && rem0.total === 0, "someone with no highlights gets nothing");
  const rem = await (await A.api("/api/v1/documents/remember")).json();
  ok(rem.total === 1 && rem.highlight.quote === hlText && rem.highlight.docId === doc.id && rem.highlight.page === 1, "someone with a highlight gets it, with its paper and page");
  await A.api(`${P}/notes`, { method: "POST", body: { page: 2, quote: "short" } });
  ok((await (await A.api("/api/v1/documents/remember")).json()).total === 1, "a highlight shorter than 40 characters is not offered");
  ok((await A.api("/api/v1/documents/remember")).status === 200 && (await createClient(APP).api("/api/v1/documents/remember")).status === 401, "it needs sign-in");

  console.log("ask about my highlights");
  const AH = `${P}/ask-highlights`;
  const askH = (client, q, extra = {}) => client.api(AH, { method: "POST", body: { question: q, ...extra } });
  const histBefore = (await (await A.api(P)).json()).history.length;
  ok((await askH(createClient(APP), "what did I mark?")).status === 401, "asking about highlights needs sign-in");
  ok((await askH(B, "what did I mark?")).status === 404, "another user cannot ask about this paper's highlights");
  ok((await A.api(AH, { method: "POST", body: { question: "what did I mark?" }, origin: null })).status === 403, "it has the cross-origin check");
  ok((await askH(A, "x")).status === 400 && (await askH(A, "x".repeat(700))).status === 400 && (await A.api(AH, { method: "POST", body: "nonsense" })).status === 400, "a question that is too short, too long or not JSON is refused");
  const hq = await (await askH(A, "calibration drift in tractor sensors", { legend: { yellow: "Key result", green: 7, pink: "x".repeat(99) } })).json();
  ok(hq.answer.found && hq.answer.verified && hq.answer.citations.length === 1 && hq.answer.citations[0].page === 1 && /calibration drift/.test(hq.answer.citations[0].quote), "the answer cites the highlight it came from, checked against that highlight, with its page");
  ok(hq.used === 3 && hq.total === 3, "and says how many highlights it used out of how many there are");
  const hallu = await (await askH(A, "hallucinate something about calibration")).json();
  ok(hallu.answer.verified === false && hallu.answer.citations.length === 0, "an invented quote is not accepted");
  ok((await (await askH(A, "an unanswerable question")).json()).answer.found === false, "a question the highlights do not cover says so");
  ok((await (await A.api(P)).json()).history.length === histBefore, "none of this is added to the paper's own question history");
  const scannedAsk = await A.api(`/api/v1/documents/${scanned.id}/ask-highlights`, { method: "POST", body: { question: "what did I mark?" } });
  ok(scannedAsk.status === 409 && (await scannedAsk.json()).type === "no_highlights", "a paper with no highlights says so (409) instead of asking the model");
  for (const n of (await (await A.api(`${P}/notes`)).json()).items) if (n.quote === hlText || n.quote === "short") await A.api(`${P}/notes/${n.id}`, { method: "DELETE" }); // (back to the notes the later checks expect)

  console.log("reporting a problem with an answer");
  const report = (client, body, origin = APP) => client.api("/api/v1/feedback", { method: "POST", body, origin });
  const answerId = hist.at(-1).id;
  ok((await report(A, { kind: "answer", problem: "wrong_answer", note: "Mail me at a@example.com", docId: doc.id, answerId })).status === 201, "a wrong answer can be reported");
  ok((await report(B, { kind: "answer", problem: "wrong_answer", docId: doc.id, answerId })).status === 404, "another user cannot report (or read) someone else's answer");
  ok((await report(A, { kind: "answer", problem: "wrong_answer", docId: doc.id, answerId: "nonexistent" })).status === 404, "an answer that does not exist is refused");
  ok((await report(A, { kind: "answer", problem: "made_up", docId: doc.id, answerId })).status === 400, "a problem that is not on the list is refused");
  ok((await report(A, { kind: "answer", problem: "wrong_answer", docId: doc.id, answerId }, null)).status === 403, "reporting has the cross-origin check");

  console.log("export and deletion");
  const uid = (await A.me()).id;
  const inStorage = async (id) => (await (await A.api(`/api/v1/dev/r2-exists?key=${encodeURIComponent(`docs/${uid}/${id}.pdf`)}`)).json()).exists;
  ok((await inStorage(doc.id)) && (await inStorage(scanned.id)), "both uploaded PDFs are in storage before deletion");
  const exp = await (await A.api("/api/v1/account/export")).json();
  ok(exp.reports?.length === 1 && exp.reports[0].sent.question && !/a@example\.com/.test(JSON.stringify(exp.reports)), "the export lists what the user reported, with e-mail addresses taken out of the note");
  ok(exp.uploadedPapers.find((d) => d.id === doc.id).drawing?.strokes?.length === 1 && exp.uploadedPapers.find((d) => d.id === scanned.id).drawing === null, "the data export includes the drawing of the paper that has one, and null for the one that has none");
  ok(exp.uploadedPapers.find((d) => d.id === doc.id).highlightsAndNotes.length === 1 && /Sample size is 214/.test(JSON.stringify(exp.uploadedPapers)), "the data export includes the highlights and notes");
  const expDoc = exp.uploadedPapers.find((d) => d.id === doc.id);
  ok(expDoc.readingStatus === "done" && JSON.stringify(expDoc.tags) === '["thesis"]' && expDoc.readingProgress.furthestPage === 3 && !!expDoc.readingProgress.lastOpenedAt, "the data export includes the reading status, tags and how far the paper was read");
  ok(expDoc.highlightsAndNotes.every((n) => typeof n.colour === "string"), "...and the colour of each highlight");
  ok(exp.uploadedPapers.length === 2 && exp.uploadedPapers.find((d) => d.id === doc.id).questions.length === 4, "the data export lists the papers and the questions asked");
  ok((await A.api(P, { method: "DELETE" })).status === 200, "DELETE removes the paper");
  const gone = async (table) => ((await (await A.api("/api/v1/dev/sql", { method: "POST", body: { sql: [`SELECT COUNT(*) AS n FROM ${table} WHERE doc_id = '${doc.id}'`] } })).json()).results?.[0]?.[0]?.n);
  ok((await gone("doc_tags")) === 0 && (await gone("doc_notes")) === 0, "...and its tags and highlights are gone with it");
  ok((await A.api(P)).status === 404 && (await A.api(`${P}/file`)).status === 404, "...and its file");
  ok(!(await inStorage(doc.id)) && (await inStorage(scanned.id)), "...and the PDF is gone from storage, while the other paper's stays");
  ok(((await (await A.api("/api/v1/dev/sql", { method: "POST", body: { sql: [`SELECT COUNT(*) AS n FROM doc_ink WHERE doc_id = '${doc.id}'`] } })).json()).results?.[0]?.[0]?.n) === 0, "...and its drawing is deleted with it");
  ok((await A.api("/api/v1/account", { method: "DELETE", body: { confirm: "DELETE" } })).status === 200, "deleting the account succeeds with papers present");
  ok(!(await inStorage(scanned.id)), "deleting the account removes every uploaded PDF from storage");
  const A2 = await login("doc-a", "a@example.com", "Alice");
  ok((await (await A2.api("/api/v1/documents")).json()).items.length === 0, "a new account with the same sign-in has no papers left");

  const counted = await (await A.api("/api/v1/dev/sql", { method: "POST", body: { sql: ["SELECT outcome, SUM(n) AS n FROM answer_outcomes WHERE feature = 'doc_ask' GROUP BY outcome"] } })).json();
  ok((counted.results?.[0] ?? []).some((r) => r.outcome === "answered" && r.n >= 1), "a question about a paper of your own is counted as answered");
  reportStreams(ok);
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
}
await idp.close?.();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall document checks passed");
process.exit(failures ? 1 : 0);
