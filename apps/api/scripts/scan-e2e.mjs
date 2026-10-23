// Scanned papers integration test: real Worker + local D1 + local R2 + fake IdP, with the offline stand-in for the two reading models (QA_STUB=1,
// see src/ocr/stub.ts) and the daily limit set low (OCR_PAGES_PER_DAY, see integration.mjs). `npm run integration -w apps/api` starts everything.
import sharp from "sharp";
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";
import { makePageJpeg, makeScanPdf } from "./lib/make-scan-pdf.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
const PER_DAY = Number(process.env.OCR_PER_DAY ?? 25);
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
const sql = async (...statements) => (await (await fetch(`${APP}/api/v1/dev/sql`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: statements }) })).json()).results;

const page1 = await makePageJpeg({ lines: ["Scanned report, page one"] });
const upload = async (c, pages = 7) => {
  const pdf = makeScanPdf(await Promise.all(Array.from({ length: pages }, (_, i) => makePageJpeg({ lines: [`Scanned report, page ${i + 1}`] }))));
  const res = await c.send(`${APP}/api/v1/documents`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/pdf", "X-Filename": encodeURIComponent("scanned_report.pdf") }, body: pdf });
  return (await res.json()).document;
};
const scan = (c, id, body, origin = APP) => c.api(`/api/v1/documents/${id}/scan`, { method: "POST", body, origin });
const read = (c, id, page, bytes, { origin = APP, query = "", type = "image/jpeg" } = {}) =>
  c.send(`${APP}/api/v1/documents/${id}/ocr?page=${page}${query}`, { method: "POST", headers: { ...(origin ? { Origin: origin } : {}), "Content-Type": type }, body: bytes });
const blank = (c, id, page) => c.send(`${APP}/api/v1/documents/${id}/ocr?page=${page}&blank=1`, { method: "POST", headers: { Origin: APP } });
const detail = async (c, id) => (await (await c.api(`/api/v1/documents/${id}`)).json());
const withComment = (jpeg, obj) => {
  const t = Buffer.from(JSON.stringify(obj));
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([0xff, 0xfe, (t.length + 2) >> 8, (t.length + 2) & 0xff]), t, jpeg.subarray(2)]);
};

try {
  console.log("access");
  const anon = createClient(APP);
  ok((await scan(anon, "abc", { pages: 1, scanPages: [1] })).status === 401, "POST /scan without signing in -> 401");
  ok((await read(anon, "abc", 1, page1)).status === 401, "POST /ocr without signing in -> 401");
  ok((await anon.api("/api/v1/documents/abc/scan")).status === 401, "GET /scan -> 401");
  ok((await anon.api("/api/v1/documents/abc/scan/text")).status === 401, "GET /scan/text -> 401");

  const A = await login("scan-a", "a@example.com", "Alice");
  const B = await login("scan-b", "b@example.com", "Bob");
  const doc = await upload(A, 7);
  ok(doc.status === "uploaded" && doc.scanned === false && doc.scanPending === 0, "a PDF of page pictures uploads like any PDF, and is not marked as scanned until the browser says so");

  console.log("a paper that is not marked as scanned has nothing to read");
  const early = await read(A, doc.id, 1, page1);
  ok(early.status === 409 && (await early.json()).type === "not_scanned", "reading a page of a paper that was not registered as a scan -> 409");

  console.log("registering the scan");
  ok((await scan(A, doc.id, { pages: 7, scanPages: [1, 2, 3, 4, 5, 6, 7] }, null)).status === 403, "no Origin -> 403 (CSRF check)");
  ok((await scan(A, doc.id, { pages: 7, scanPages: [1] }, "http://evil.example")).status === 403, "another origin -> 403");
  for (const [what, body] of [
    ["no body", undefined],
    ["pages missing", { scanPages: [1] }],
    ["pages not a whole number", { pages: 2.5, scanPages: [1] }],
    ["pages as text", { pages: "7", scanPages: [1] }],
    ["more pages than the limit", { pages: 501, scanPages: [1] }],
    ["zero pages", { pages: 0, scanPages: [1] }],
    ["no list", { pages: 7 }],
    ["empty list", { pages: 7, scanPages: [] }],
    ["a page beyond the paper", { pages: 7, scanPages: [1, 8] }],
    ["page zero", { pages: 7, scanPages: [0] }],
    ["a page given as text", { pages: 7, scanPages: ["1"] }],
    ["a fractional page", { pages: 7, scanPages: [1.5] }],
    ["a list that is not a list", { pages: 7, scanPages: "1,2" }],
    ["a huge list", { pages: 7, scanPages: Array.from({ length: 600 }, () => 1) }],
  ]) {
    const r = await scan(A, doc.id, body);
    ok(r.status === 400 && (await r.json()).type === "invalid_scan", `refused: ${what}`);
  }
  ok((await scan(B, doc.id, { pages: 7, scanPages: [1] })).status === 404, "another person's paper -> 404");
  ok((await scan(A, "doesnotexist", { pages: 7, scanPages: [1] })).status === 404, "a paper that does not exist -> 404");
  ok((await detail(A, doc.id)).scan === null, "nothing was registered by the refused requests");

  const reg = await (await scan(A, doc.id, { pages: 7, scanPages: [7, 6, 5, 4, 3, 2, 1, 3] })).json();
  ok(reg.document.scanned === true && reg.document.scanPending === 7 && reg.document.status === "indexing" && reg.document.pages === 7, "registered: scanned, 7 pages to read (a repeated page counts once), still indexing");
  ok(reg.scan.pending.join(",") === "1,2,3,4,5,6,7", "the pages still to be read are listed, in order");
  ok(reg.scan.pages === 7 && reg.scan.read === 0 && reg.scan.items.length === 0 && reg.scan.perDay === PER_DAY && reg.scan.usedToday === 0, `nothing read yet, limit per day is ${PER_DAY}`);
  ok((await (await A.api("/api/v1/documents")).json()).items.find((d) => d.id === doc.id).scanPending === 7, "the paper list shows how many pages are still to be read");

  console.log("what a page picture must look like");
  const refuse = async (what, res, status, type) => {
    const j = await res.json().catch(() => ({}));
    ok(res.status === status && (!type || j.type === type), `${what} -> ${status}${type ? " " + type : ""} (got ${res.status} ${j.type ?? ""})`);
  };
  await refuse("no Origin", await read(A, doc.id, 1, page1, { origin: null }), 403);
  await refuse("another origin", await read(A, doc.id, 1, page1, { origin: "http://evil.example" }), 403);
  await refuse("someone else's paper", await read(B, doc.id, 1, page1), 404);
  for (const p of ["0", "8", "abc", "-1", "1.5", ""]) await refuse(`page=${p || "(none)"}`, await read(A, doc.id, p, page1), 400, "invalid_page");
  await refuse("a text file", await read(A, doc.id, 1, Buffer.from("this is not a picture")), 415, "not_a_jpeg");
  await refuse("a PNG", await read(A, doc.id, 1, await sharp({ create: { width: 600, height: 800, channels: 3, background: "#fff" } }).png().toBuffer()), 415, "not_a_jpeg");
  await refuse("an empty body", await read(A, doc.id, 1, Buffer.alloc(0)), 415, "not_a_jpeg");
  await refuse("a PDF sent as the picture", await read(A, doc.id, 1, Buffer.from("%PDF-1.4\n" + "x".repeat(2000))), 415, "not_a_jpeg");
  await refuse("a JPEG cut off in the header", await read(A, doc.id, 1, page1.subarray(0, 12)), 415, "not_a_jpeg");
  await refuse("a huge picture (4000 x 4000)", await read(A, doc.id, 1, await makePageJpeg({ width: 4000, height: 4000, quality: 20 })), 400, "invalid_image_size");
  await refuse("a long picture (500 x 3000)", await read(A, doc.id, 1, await makePageJpeg({ width: 500, height: 3000, quality: 30 })), 400, "invalid_image_size");
  await refuse("a tiny picture (60 x 80)", await read(A, doc.id, 1, await makePageJpeg({ width: 60, height: 80 })), 400, "invalid_image_size");
  await refuse("a picture over 1.5 MB", await read(A, doc.id, 1, Buffer.concat([page1, Buffer.alloc(1_600_000)])), 413, "too_large");
  ok((await detail(A, doc.id)).scan.usedToday === 0, "none of the refused pictures used a page of today's allowance");

  console.log("reading the pages");
  const cases = {
    1: ["ok", (r) => r.chunks >= 1 && /Page 1 of the scanned report/.test(r.text) && r.disputed.length === 0 && r.disagreement === 0],
    2: ["ok", (r) => r.chunks >= 1],
    3: ["warn", (r) => r.disagreement >= 0.02 && r.disagreement < 0.15 && r.disputed.includes("2019") && r.disputed.includes("2018") && r.chunks >= 1 && r.text.length > 100],
    4: ["unreliable", (r) => r.why === "models_disagree" && r.text === "" && r.chunks === 0 && r.disagreement > 0.15],
    5: ["empty", (r) => r.text === "" && r.chunks === 0 && r.disagreement === 0],
    6: ["unreliable", (r) => r.why === "repeating" && r.text === "" && r.chunks === 0],
    7: ["ok", (r) => r.chunks >= 1],
  };
  let last;
  const first = {};
  for (const p of [1, 2, 3, 4, 5, 6, 7]) {
    const res = await read(A, doc.id, p, await makePageJpeg({ lines: [`Scanned report, page ${p}`] }));
    const j = await res.json();
    const [want, check] = cases[p];
    ok(res.status === 200 && j.result.status === want && check(j.result), `page ${p}: ${want}${j.result.status !== want ? ` (got ${j.result.status} ${j.result.why ?? ""})` : ` (differ ${((j.result.disagreement ?? 0) * 100).toFixed(1)}%, ${j.result.chunks} passages)`}`);
    last = j;
    first[p] = j.result;
  }
  ok(last.result.done === true && last.document.status === "ready" && last.document.scanPending === 0 && last.document.chunkCount >= 4, `after the last page the paper is ready (${last.document.chunkCount} passages) with nothing pending`);
  ok(last.result.usedToday === 7, "every page that was sent to the models used a page of today's allowance, whatever the outcome (7)");

  const d1 = await detail(A, doc.id);
  ok(d1.scan.pending.length === 0, "nothing is pending after the last page");
  ok(d1.scan.read === 3 && d1.scan.warned === 1 && d1.scan.unreliable === 2 && d1.scan.empty === 1, `counts: ${d1.scan.read} read, ${d1.scan.warned} with doubt, ${d1.scan.unreliable} not reliable, ${d1.scan.empty} empty`);
  ok(d1.scan.items.map((i) => `${i.page}:${i.status}`).join(" ") === "1:ok 2:ok 3:warn 4:unreliable 5:empty 6:unreliable 7:ok", "per page: " + d1.scan.items.map((i) => `${i.page}:${i.status}`).join(" "));
  ok(d1.scan.items.find((i) => i.page === 3).disputed.includes("2019"), "the numbers the models read differently are kept with the page");
  ok(d1.scan.usedToday === 7 && d1.scan.perDay === PER_DAY, `today's use is shown with the limit (${d1.scan.usedToday} of ${d1.scan.perDay})`);

  const texts = await (await A.api(`/api/v1/documents/${doc.id}/scan/text`)).json();
  ok(texts.pages.map((p) => p.page).join(",") === "1,2,3,7", `the text of the pages that were used is kept, in order (${texts.pages.map((p) => p.page)})`);
  ok(!JSON.stringify(texts).includes("harbour") && !texts.pages.some((p) => /The sample was dried/.test(p.text)), "nothing from the pages that were refused is kept");
  ok((await B.api(`/api/v1/documents/${doc.id}/scan/text`)).status === 404 && (await B.api(`/api/v1/documents/${doc.id}/scan`)).status === 404, "another person cannot read what was read, or the page list");

  console.log("only what was used can answer a question");
  const chunkPages = (await sql(`SELECT DISTINCT page FROM doc_chunks WHERE doc_id = '${doc.id}' ORDER BY page`))[0].map((r) => r.page);
  ok(chunkPages.join(",") === "1,2,3,7", `passages exist only for the pages that were used (${chunkPages})`);
  const ask = await (await A.api(`/api/v1/documents/${doc.id}/ask`, { method: "POST", body: { question: "What happened to soil moisture in region R1?" } })).json();
  ok(ask.answer.found && ask.answer.verified && ask.answer.citations.length >= 1 && ask.answer.citations.every((c) => [1, 2, 3, 7].includes(c.page)), `a question is answered from the pages that were read, with a verified quote (page ${ask.answer.citations[0]?.page})`);

  console.log("a page is not read, or charged, twice");
  const again = await (await read(A, doc.id, 1, page1)).json();
  ok(again.result.status === "ok" && again.result.text === first[1].text && again.result.chunks === first[1].chunks, "asking again for a page that was read returns it as it was");
  ok((await detail(A, doc.id)).scan.usedToday === d1.scan.usedToday, "...without using another page of the allowance");
  const dup = await (await read(A, doc.id, 5, page1)).json();
  ok(dup.result.status === "empty", "an empty page stays empty when asked again");

  console.log("a page that was not read reliably can be tried again");
  const usedBefore = (await detail(A, doc.id)).scan.usedToday;
  const retry = await (await read(A, doc.id, 4, await makePageJpeg({ lines: ["better scan"] }))).json();
  ok(retry.result.status === "unreliable" && (await detail(A, doc.id)).scan.usedToday === usedBefore + 1, "page 4 read again: same result here, and it does use a page of the allowance");
  const better = await (await read(A, doc.id, 4, withComment(await makePageJpeg({ lines: ["better scan"] }), { first: "Harbour figures: berth occupancy rose to 71 percent in 2020 across the four terminals.", second: "Harbour figures: berth occupancy rose to 71 percent in 2020 across the four terminals." }))).json();
  ok(better.result.status === "ok" && better.result.chunks >= 1, "a better scan of that page is accepted the second time");
  const d2 = await detail(A, doc.id);
  ok(d2.scan.unreliable === 1 && d2.scan.read === 4 && d2.document.chunkCount > d1.document.chunkCount, "its text now counts: one page fewer unreliable, more passages");
  const after = await (await A.api(`/api/v1/documents/${doc.id}/ask`, { method: "POST", body: { question: "How far did berth occupancy rise at the harbour?" } })).json();
  ok(after.answer.found && after.answer.citations.some((c) => c.page === 4), "and a question about it is answered from page 4");

  console.log("a page found empty by the browser");
  const doc2 = await upload(A, 3);
  await scan(A, doc2.id, { pages: 3, scanPages: [1, 2, 3] });
  const used0 = (await detail(A, doc2.id)).scan.usedToday;
  const bl = await (await blank(A, doc2.id, 2)).json();
  ok(bl.result.status === "empty" && bl.result.chunks === 0 && (await detail(A, doc2.id)).scan.usedToday === used0, "a blank page sent as blank is marked empty and does not use the allowance");
  ok((await blank(B, doc2.id, 1)).status === 404, "someone else cannot mark a page of this paper");
  ok((await (await A.send(`${APP}/api/v1/documents/${doc2.id}/ocr?page=9&blank=1`, { method: "POST", headers: { Origin: APP } })).status) === 400, "a blank page outside the paper -> 400");

  console.log("models that cannot be reached");
  const f1 = await (await read(A, doc2.id, 1, withComment(await makePageJpeg({ lines: ["x"] }), { fail: "second" }))).json();
  ok(f1.result.status === "retry" && f1.result.why === "second_reading_failed" && f1.result.done === false, "one model down: the page is not judged, it is to be tried again");
  const d3 = await detail(A, doc2.id);
  ok(d3.scan.usedToday === used0 && d3.document.scanPending === 2 && d3.scan.items.every((i) => i.page !== 1), "...it is still pending and no page of the allowance was used");
  const f2 = await read(A, doc2.id, 1, withComment(await makePageJpeg({ lines: ["x"] }), { fail: "both" }));
  ok(f2.status === 502 && (await f2.json()).type === "ai_failed" && (await detail(A, doc2.id)).scan.usedToday === used0, "both down: 502, nothing changed, nothing used");
  const f3 = await (await read(A, doc2.id, 1, withComment(await makePageJpeg({ lines: ["x"] }), { cutOff: true }))).json();
  ok(f3.result.status === "unreliable" && f3.result.why === "cut_off", "a model that ran out of room: not used");
  const f4 = await (await read(A, doc2.id, 3, withComment(await makePageJpeg({ lines: ["x"] }), { first: "", second: "" }))).json();
  ok(f4.result.status === "empty" && f4.result.done === true, "both models read nothing: empty; and the last pending page ends the reading");
  const fin2 = (await detail(A, doc2.id)).document;
  ok(fin2.status === "failed" && /None of the pages could be read reliably/.test(fin2.error ?? ""), `a paper where no page could be used is failed, with a reason (${fin2.status})`);
  const rescue = await (await read(A, doc2.id, 1, withComment(await makePageJpeg({ lines: ["y"] }), { first: "Seed germination was recorded daily for twelve days in each of the three trays.", second: "Seed germination was recorded daily for twelve days in each of the three trays." }))).json();
  ok(rescue.result.status === "ok" && rescue.document.status === "ready", "reading a page again can turn a failed paper into a ready one");

  console.log("registering again keeps what was read");
  const re = await (await scan(A, doc.id, { pages: 7, scanPages: [1, 2, 3, 4, 5, 6, 7] })).json();
  ok(re.scan.read === d2.scan.read && re.scan.unreliable === d2.scan.unreliable && re.document.scanPending === 0 && re.document.status === "ready", "asking again changes nothing and the paper stays ready");
  ok((await detail(A, doc.id)).document.chunkCount === d2.document.chunkCount, "...and keeps all its passages");
  const extra = await upload(A, 4);
  await scan(A, extra.id, { pages: 4, scanPages: [1, 2] });
  const partial = await detail(A, extra.id);
  ok(partial.document.scanPending === 2 && partial.scan.pages === 2, "a paper with some pages that have text lists only the pages to read");
  const grown = await (await scan(A, extra.id, { pages: 4, scanPages: [1, 2, 3, 4] })).json();
  ok(grown.document.scanPending === 4, "a longer list adds pages");

  console.log("the daily limit");
  const C = await login("scan-c", "c@example.com", "Carol");
  const big = await upload(C, 40);
  await scan(C, big.id, { pages: 40, scanPages: Array.from({ length: 40 }, (_, i) => i + 1) });
  let used = 0;
  let firstRefusal = null;
  for (let p = 1; p <= 40 && !firstRefusal; p++) {
    const r = await read(C, big.id, p, await makePageJpeg({ lines: [`p${p}`] }));
    if (r.status === 429) firstRefusal = { p, body: await r.json() };
    else if (r.status === 200) used++;
    else throw new Error(`unexpected ${r.status} on page ${p}`);
  }
  ok(used === PER_DAY && firstRefusal?.p === PER_DAY + 1, `${used} pages were read, then the limit: page ${firstRefusal?.p} was refused`);
  ok(firstRefusal?.body.type === "ocr_daily_limit" && new RegExp(String(PER_DAY)).test(firstRefusal.body.detail) && /continue tomorrow/i.test(firstRefusal.body.detail), "the refusal says what the limit is and that reading continues tomorrow");
  const dc = await detail(C, big.id);
  ok(dc.scan.usedToday === PER_DAY && dc.scan.perDay === PER_DAY && dc.document.scanPending === 40 - PER_DAY && dc.document.status === "indexing", "nothing else changed: what was read is kept and the rest is still to be read");
  ok((await read(C, big.id, PER_DAY + 1, page1)).status === 429, "the limit holds on another try");
  ok((await blank(C, big.id, 40)).status === 200, "a blank page does not need allowance");
  const cb = await doc2Free(C);
  async function doc2Free(c) { const d = await upload(c, 2); await scan(c, d.id, { pages: 2, scanPages: [1, 2] }); return read(c, d.id, 1, page1); }
  ok(cb.status === 429, "the limit is per person, across all their papers");
  const bd = await upload(B, 2);
  await scan(B, bd.id, { pages: 2, scanPages: [1, 2] });
  ok((await read(B, bd.id, 1, page1)).status === 200, "another person is not affected");
  // the next day: a new row is used
  await sql(`UPDATE ocr_usage SET day = '2000-01-01' WHERE user_id = (SELECT id FROM users WHERE email = 'c@example.com')`);
  ok((await read(C, big.id, PER_DAY + 1, page1)).status === 200, "the next day the allowance is new (the count is per UTC day)");

  console.log("parallel pages");
  const par = await upload(B, 6);
  await scan(B, par.id, { pages: 6, scanPages: [1, 2, 3, 4, 5, 6] });
  const results = await Promise.all([1, 2, 3, 4, 5, 6].map((p) => read(B, par.id, p, page1).then((r) => r.json())));
  ok(results.every((r) => r.result && r.result.page >= 1) && new Set(results.map((r) => r.result.page)).size === 6, "six pages sent at the same time are all read");
  const dpar = await detail(B, par.id);
  ok(dpar.scan.items.length === 6 && dpar.document.scanPending === 0 && dpar.scan.usedToday === 7, `all six are kept, none lost (${dpar.scan.items.length}), and 7 pages were used in all by this person (one earlier)`);
  const chunkRows = (await sql(`SELECT COUNT(*) AS n, COUNT(DISTINCT idx) AS u FROM doc_chunks WHERE doc_id = '${par.id}'`))[0][0];
  ok(chunkRows.n === chunkRows.u, "no passage was stored twice");

  console.log("export");
  const exp = await (await A.api("/api/v1/account/export")).json();
  const ep = exp.uploadedPapers.find((p) => p.id === doc.id);
  ok(ep.readFromScan && ep.readFromScan.pages.length === 7 && ep.readFromScan.textComplete === true, "the account export says how each page of a scan was read");
  ok(ep.readFromScan.text.map((t) => t.page).join(",") === "1,2,3,4,7", "...and holds the text of the pages that were used, and nothing of the others");
  ok(ep.readFromScan.pages.find((p) => p.page === 3).numbersTheyDisagreedOn.includes("2019") && ep.readFromScan.pages.find((p) => p.page === 6).why === "repeating", "...with the numbers the models disagreed on and why a page was left out");

  console.log("deleting");
  ok((await A.api(`/api/v1/documents/${doc.id}`, { method: "DELETE" })).status === 200, "deleting the scanned paper works");
  const left = (await sql(`SELECT COUNT(*) AS n FROM doc_ocr WHERE doc_id = '${doc.id}'`, `SELECT COUNT(*) AS n FROM doc_chunks WHERE doc_id = '${doc.id}'`)).map((r) => r[0].n);
  ok(left[0] === 0 && left[1] === 0, "its page list and its passages are gone");
  const idC = (await sql(`SELECT id FROM users WHERE email = 'c@example.com'`))[0][0].id;
  ok((await sql(`SELECT COUNT(*) AS n FROM ocr_usage WHERE user_id = '${idC}'`))[0][0].n >= 1, "Carol's usage rows exist before her account is erased");
  const del = await C.api("/api/v1/account", { method: "DELETE", body: { confirm: "DELETE" } });
  const erased = (await sql(`SELECT COUNT(*) AS n FROM ocr_usage WHERE user_id = '${idC}'`, `SELECT COUNT(*) AS n FROM doc_ocr WHERE doc_id = '${big.id}'`)).map((r) => r[0].n);
  ok(del.status === 200 && erased[0] === 0 && erased[1] === 0, `erasing the account removes the usage rows and the page lists (${del.status})`);
} catch (e) {
  console.error(e);
  failures++;
}
idp.close?.();
console.log(failures === 0 ? "\nscanned papers: all passed" : `\nscanned papers: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
