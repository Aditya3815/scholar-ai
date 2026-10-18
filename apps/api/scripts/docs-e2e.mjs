// Uploaded papers + grounded Q&A integration test: real Worker + local D1 + local R2 + fake IdP, with the offline model stand-in
// (QA_STUB=1). Same setup as library-e2e.mjs; `npm run integration -w apps/api` starts everything.
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";
import { SAMPLE_PAPER, makePdf } from "./lib/make-pdf.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? "  ok  " : " FAIL "} ${msg}`); if (!cond) failures++; };

const idp = await startFakeIdp(9911);
const login = async (sub, email, name) => {
  idp.setUser({ sub, email, email_verified: true, name });
  const c = createClient(APP);
  await c.follow(`${APP}/api/v1/auth/google/start`);
  return c;
};
const pdf = makePdf(SAMPLE_PAPER, { title: "Glaucoma screening" });
const upload = (c, body, { name = "glaucoma_screening.pdf", origin = APP, type = "application/pdf" } = {}) =>
  c.send(`${APP}/api/v1/documents`, { method: "POST", headers: { ...(origin ? { Origin: origin } : {}), "Content-Type": type, "X-Filename": encodeURIComponent(name) }, body });
const pages = (texts) => texts.map((text, i) => ({ page: i + 1, text }));

try {
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

  console.log("export and deletion");
  const exp = await (await A.api("/api/v1/account/export")).json();
  ok(exp.uploadedPapers.length === 2 && exp.uploadedPapers.find((d) => d.id === doc.id).questions.length === 4, "the data export lists the papers and the questions asked");
  ok((await A.api(P, { method: "DELETE" })).status === 200, "DELETE removes the paper");
  ok((await A.api(P)).status === 404 && (await A.api(`${P}/file`)).status === 404, "...and its file");
  ok((await A.api("/api/v1/account", { method: "DELETE", body: { confirm: "DELETE" } })).status === 200, "deleting the account succeeds with papers present");
  const A2 = await login("doc-a", "a@example.com", "Alice");
  ok((await (await A2.api("/api/v1/documents")).json()).items.length === 0, "a new account with the same sign-in has no papers left");
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
}
await idp.close?.();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nall document checks passed");
process.exit(failures ? 1 : 0);
