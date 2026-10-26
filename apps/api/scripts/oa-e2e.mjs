// W4: asking any open-access paper. Real Worker + local D1, R2 and Workflows + fake IdP, with the offline stand-ins for the network (Europe PMC, OpenAlex, arXiv, publishers) and for
// the model and embeddings (QA_STUB=1). `npm run integration -w apps/api` starts everything. The DOI says what the stand-in network does: see src/oa/stub.ts.
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";

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

/** Asks a paper and reads the whole stream. */
async function ask(client, ref, question, { origin = APP, abstract, raw } = {}) {
  const res = await client.send(`${APP}/api/v1/papers/oa/ask`, {
    method: "POST",
    headers: { ...(origin ? { Origin: origin } : {}), "Content-Type": "application/json", Accept: "text/event-stream" },
    body: raw ?? JSON.stringify({ ...ref, question, ...(abstract ? { abstract } : {}) }),
  });
  if (!res.ok || !String(res.headers.get("content-type")).includes("text/event-stream")) return { res, events: [], text: "" };
  const events = [];
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  for await (const part of res.body) {
    const s = dec.decode(part, { stream: true });
    text += s;
    buf += s;
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const data = buf.slice(0, i).split("\n").find((l) => l.startsWith("data:"));
      buf = buf.slice(i + 2);
      if (data) events.push(JSON.parse(data.slice(5)));
    }
  }
  return { res, events, text };
}
const sql = async (...statements) => (await (await fetch(`${APP}/api/v1/dev/sql`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: statements }) })).json()).results ?? [];
const paperRow = async (key) => (await sql(`SELECT * FROM oa_papers WHERE key = '${key}'`))[0]?.[0];
const of = (events, type) => events.filter((e) => e.type === type);
const last = (events) => events.at(-1);
const QUESTION = "How many adults were enrolled in the study?";

try {
  const A = await login("oa-a", "oa-a@example.com", "Asha");
  const anon = createClient(APP);

  console.log("what is accepted");
  ok((await ask(anon, { doi: "10.5555/oa.xml" }, QUESTION)).res.status === 401, "a person who is not signed in is refused");
  ok((await ask(A, { doi: "10.5555/oa.xml" }, QUESTION, { origin: null })).res.status === 403, "a cross-origin request is refused");
  ok((await ask(A, {}, QUESTION)).res.status === 400 && (await ask(A, { doi: "not a doi" }, QUESTION)).res.status === 400 && (await ask(A, { arxivId: "nonsense" }, QUESTION)).res.status === 400, "a paper with no DOI or arXiv number is refused");
  ok((await ask(A, { doi: "10.5555/oa.xml" }, "hi")).res.status === 400 && (await ask(A, { doi: "10.5555/oa.xml" }, "x".repeat(601))).res.status === 400, "a question that is too short or too long is refused");
  ok((await ask(A, null, null, { raw: "not json" })).res.status === 400, "garbage is refused");
  ok((await sql("SELECT COUNT(*) AS n FROM oa_papers"))[0][0].n === 0, "none of that created a paper in the index");

  console.log("a paper from Europe PMC's XML (new to the index)");
  const x = await ask(A, { doi: "10.5555/oa.xml" }, QUESTION);
  const types = x.events.map((e) => e.type);
  ok(x.res.status === 200 && last(x.events).type === "answer" && types.filter((t) => t === "answer").length === 1, "it streams and ends with the answer");
  const ing = of(x.events, "ingest");
  ok(ing.length >= 2 && ing.at(-1).status === "ready" && ing.at(-1).progress === 1 && ing.some((e) => e.started === true), "it says it is reading the paper, and that it is ready at the end (this person started it)");
  ok(ing.every((e, i) => i === 0 || e.progress >= ing[i - 1].progress || e.status === "ready"), "the progress never goes back");
  const paper = of(x.events, "paper")[0];
  ok(paper?.source === "europepmc" && paper.license === "cc-by" && paper.permissive === true && /Smartphone Retinal Imaging/.test(paper.title) && !paper.reason, "it says what the answer is made from: the full text from Europe PMC, CC BY, the title");
  ok(types.indexOf("ingest") < types.indexOf("paper") && types.indexOf("paper") < types.indexOf("answer"), "in that order: reading, the paper, the answer");
  const ans = last(x.events).answer;
  ok(ans.found && ans.verified && ans.citations.length >= 1, "the answer is found and verified");
  ok(ans.citations[0].section === "Methods > Participants" && /We enrolled 240 adults/.test(ans.citations[0].quote), `its citation names the section, not a page, and quotes the paper (${ans.citations[0]?.section})`);
  const row = await paperRow("doi:10.5555/oa.xml");
  ok(row.status === "ready" && row.source === "europepmc" && row.license === "cc-by" && row.attempt === 1 && row.chunk_count > 3 && row.done_chunks === row.chunk_count && row.instance?.startsWith("oa-"), `the index has the paper: ready, ${row.chunk_count} passages, all embedded, one try`);
  const stats = (await sql("SELECT COUNT(*) AS n, SUM(embedding IS NULL) AS missing, SUM(text LIKE '%old paper that must not be read%') AS refs FROM oa_chunks WHERE paper_key = 'doi:10.5555/oa.xml'"))[0][0];
  ok(stats.n === row.chunk_count && stats.missing === 0 && stats.refs === 0, "every passage has its embedding, and the reference list was not read as text");
  ok((await sql("SELECT COUNT(*) AS n FROM oa_daily WHERE user_id <> '*'"))[0][0].n === 1 && (await sql("SELECT n FROM oa_daily WHERE user_id = '*'"))[0][0].n === 1, "the person's day counts one new paper, and so does the whole service's");

  console.log("the same paper again (already in the index)");
  const again = await ask(A, { doi: "https://doi.org/10.5555/OA.XML" }, "What was the sensitivity and specificity?");
  const ing2 = of(again.events, "ingest");
  ok(last(again.events).type === "answer" && ing2.length === 1 && ing2[0].status === "ready", "nothing to wait for: it is ready at once (the DOI in another spelling is the same paper)");
  ok(/91 percent/.test(last(again.events).answer.citations.map((c) => c.quote).join(" ")), "and a different question gets its own answer from the same passages");
  const row2 = await paperRow("doi:10.5555/oa.xml");
  ok(row2.attempt === 1 && (await sql("SELECT COUNT(*) AS n FROM oa_papers"))[0][0].n === 1, "no second reading, no second row");
  ok((await sql("SELECT n FROM oa_daily WHERE user_id <> '*'"))[0][0].n === 1, "and a paper that is already there costs the person nothing");

  console.log("another person gets the shared copy");
  const B = await login("oa-b", "oa-b@example.com", "Bhaskar");
  const b1 = await ask(B, { doi: "10.5555/oa.xml" }, QUESTION);
  ok(last(b1.events).type === "answer" && of(b1.events, "ingest").length === 1 && of(b1.events, "ingest")[0].status === "ready", "a second person is answered from the same index at once");
  const cols = (await sql("SELECT name FROM pragma_table_info('oa_papers') UNION SELECT name FROM pragma_table_info('oa_chunks')"))[0].map((r) => r.name);
  ok(!cols.some((c) => /user|person|email|asked/.test(c)), `the shared tables hold no person (${cols.join(", ")})`);
  const st = await (await A.api("/api/v1/papers/oa/status?doi=10.5555/oa.xml")).json();
  ok(st.known && st.status === "ready" && st.progress === 1 && st.permissive === true && st.source === "europepmc", "the status of a paper can be read");
  ok((await (await A.api("/api/v1/papers/oa/status?doi=10.5555/never")).json()).known === false && (await anon.api("/api/v1/papers/oa/status?doi=10.5555/oa.xml")).status === 401 && (await A.api("/api/v1/papers/oa/status")).status === 400, "an unknown paper is 'not known'; the status needs sign-in and a paper");

  console.log("two people ask a new paper at the same moment");
  const C = await login("oa-c", "oa-c@example.com", "Chitra");
  const [c1, c2] = await Promise.all([ask(A, { doi: "10.5555/oa.slow" }, QUESTION), ask(C, { doi: "10.5555/oa.slow" }, QUESTION)]);
  ok(last(c1.events).type === "answer" && last(c2.events).type === "answer", "both are answered");
  const starters = [c1, c2].filter((r) => of(r.events, "ingest").some((e) => e.started === true)).length;
  ok(starters === 1, `exactly one of them started the reading, the other joined it (${starters})`);
  const slow = await paperRow("doi:10.5555/oa.slow");
  ok(slow.attempt === 1 && (await sql("SELECT COUNT(*) AS n FROM oa_chunks WHERE paper_key = 'doi:10.5555/oa.slow'"))[0][0].n === slow.chunk_count, "one reading, one set of passages");
  ok((await sql("SELECT SUM(n) AS n FROM oa_daily WHERE user_id <> '*'"))[0][0].n === 2 && (await sql("SELECT n FROM oa_daily WHERE user_id = '*'"))[0][0].n === 2, "the day counts only the person who brought the paper in: two new papers so far (the one asked by two people counts once)");

  console.log("a step that fails is tried again");
  const flaky = await ask(A, { doi: "10.5555/oa.flaky" }, QUESTION);
  ok(last(flaky.events).type === "answer" && of(flaky.events, "paper")[0]?.source === "europepmc", "the first download fails with a 500; the step is tried again and the answer comes");
  ok((await paperRow("doi:10.5555/oa.flaky")).status === "ready", "and the paper is ready");

  console.log("a paper from a PDF");
  const pdfQ = "How was the federated model trained across the hospitals?";
  const p = await ask(A, { doi: "10.5555/oa.pdf" }, pdfQ);
  const pp = of(p.events, "paper")[0];
  ok(last(p.events).type === "answer" && pp?.source === "pdf" && pp.license === "cc-by" && /Federated Learning/.test(pp.title), "the free PDF OpenAlex knows is read: source pdf, its licence and title");
  const pc = last(p.events).answer.citations[0];
  ok(pc && pc.section === undefined && pc.page >= 1 && /federated model across five hospitals/.test(pc.quote), `its citation is a page, not a section (page ${pc?.page})`);
  const prow = await paperRow("doi:10.5555/oa.pdf");
  ok(prow.pages === 3 && prow.source === "pdf" && prow.r2_key?.endsWith("source.pdf"), "the index has its pages and keeps the file");
  const land = await ask(A, { doi: "10.5555/oa.landing" }, pdfQ);
  ok(last(land.events).type === "answer" && of(land.events, "paper")[0]?.source === "pdf", "a landing page that names its PDF is followed once");
  const arx = await ask(A, { arxivId: "arXiv:2401.00001v2" }, "What do message passing networks predict?");
  ok(last(arx.events).type === "answer" && of(arx.events, "paper")[0]?.source === "arxiv" && (await paperRow("arxiv:2401.00001"))?.status === "ready", "an arXiv number alone is enough (the arXiv PDF)");

  console.log("a paper that cannot be read is answered from its abstract, and says why");
  const ABS = "This paper describes a screening programme in rural clinics. The programme reached eight thousand people in two years and found glaucoma in four percent of them.";
  const cases = [
    ["10.5555/oa.blocked", "blocked", "a publisher that answers 403"],
    ["10.5555/oa.scanned", "scanned", "a PDF that is pictures of pages"],
    ["10.5555/oa.wrong", "wrong_paper", "a link that leads to a different paper"],
    ["10.5555/oa.long", "too_long", "a PDF of 130 pages"],
  ];
  for (const [doi, reason, what] of cases) {
    const r = await ask(A, { doi }, "How many people did the programme reach?", { abstract: ABS });
    const pe = of(r.events, "paper")[0];
    ok(last(r.events).type === "answer" && pe?.source === "abstract" && pe.reason === reason && of(r.events, "ingest").at(-1)?.status === "unreadable", `${what}: "${reason}", answered from the abstract`);
    if (pe?.reason !== reason) console.log("        got", JSON.stringify(pe), JSON.stringify(of(r.events, "ingest").at(-1)), JSON.stringify(await paperRow(`doi:${doi}`)));
    const cit = last(r.events).answer.citations[0];
    ok(cit?.section === "Abstract" && /eight thousand people/.test(cit.quote), `...with the abstract named as the place (${doi.slice(9)})`);
    const rw = await paperRow(`doi:${doi}`);
    ok(rw.status === "unreadable" && rw.reason === reason && rw.chunk_count === 0, "...and the paper is marked unreadable, with no passages");
  }
  const closed = await ask(A, { doi: "10.5555/oa.closed" }, "What kind of study is this?");
  const ce = of(closed.events, "paper")[0];
  ok(last(closed.events).type === "answer" && ce?.source === "abstract" && ce.reason === "not_open_access", "a paper that is not open access: the abstract Europe PMC has, with the reason, and no abstract needs to come from the browser");
  const unr = await ask(A, { doi: "10.5555/oa.blocked" }, "How many people did the programme reach?", { abstract: ABS });
  ok(last(unr.events).type === "answer" && (await paperRow("doi:10.5555/oa.blocked")).attempt === 1, "asking again about a paper that cannot be read does not start another reading");
  const nothing = await ask(A, { doi: "10.5555/oa.blocked" }, "What is it about?");
  ok(last(nothing.events).type === "error" && last(nothing.events).code === "no_text", "with no abstract to be had either, it says there is nothing to read");

  console.log("limits and a lost reading");
  await sql(`INSERT INTO oa_daily (user_id, day, n) SELECT id, date('now'), 20 FROM users WHERE email = 'oa-c@example.com' ON CONFLICT (user_id, day) DO UPDATE SET n = 20`);
  const globalBefore = (await sql("SELECT n FROM oa_daily WHERE user_id = '*'"))[0][0].n;
  const capped = await ask(C, { doi: "10.5555/oa.never-seen" }, "Anything?", { abstract: ABS });
  ok(last(capped.events).type === "answer" && of(capped.events, "paper")[0]?.source === "abstract" && of(capped.events, "paper")[0]?.reason === "daily_cap" && !(await paperRow("doi:10.5555/oa.never-seen")), "a person who has brought in 20 new papers today is answered from the abstract, with the reason, and no new paper is added");
  ok(globalBefore === (await sql("SELECT n FROM oa_daily WHERE user_id = '*'"))[0][0].n, "(a person who is refused is not counted against the whole service)");
  const fine = await ask(C, { doi: "10.5555/oa.xml" }, QUESTION);
  ok(last(fine.events).type === "answer" && of(fine.events, "ingest").at(-1).status === "ready", "...but papers already in the index still work for them");
  await sql(`UPDATE oa_daily SET n = 300 WHERE user_id = '*'`);
  const braked = await ask(A, { doi: "10.5555/oa.another-new-one" }, "Anything?", { abstract: ABS });
  ok(last(braked.events).type === "answer" && of(braked.events, "paper")[0]?.reason === "daily_cap" && !(await paperRow("doi:10.5555/oa.another-new-one")), "when the whole service has taken in its 300 new papers for the day, nobody adds another: the abstract is used, with the reason");
  ok((await sql("SELECT n FROM oa_daily WHERE user_id <> '*' AND n < 20"))[0].every((r) => r.n >= 0) && (await sql("SELECT n FROM oa_daily WHERE user_id = '*'"))[0][0].n === 300, "and the refusal did not change the count");
  await sql(`UPDATE oa_daily SET n = 5 WHERE user_id = '*'`);
  await sql(`INSERT INTO oa_papers (key, doi, status, attempt, updated_at) VALUES ('doi:10.5555/oa.stale', '10.5555/oa.stale', 'fetching', 1, datetime('now', '-30 minutes'))`);
  const stale = await ask(A, { doi: "10.5555/oa.stale" }, "Anything?", { abstract: ABS });
  const srow = await paperRow("doi:10.5555/oa.stale");
  ok(last(stale.events).type === "answer" && srow.attempt === 2 && srow.status !== "fetching", "a reading that stopped moving for a quarter of an hour (its Workflow was lost) is given up and tried again, not waited for");

  console.log("nothing personal, nothing kept of the question");
  const tables = (await sql("SELECT name FROM sqlite_master WHERE type = 'table' AND substr(name, 1, 3) = 'oa_'"))[0].map((r) => r.name).sort();
  ok(tables.join() === "oa_chunks,oa_daily,oa_papers", `only the shared tables exist (${tables.join(", ")})`);
  ok((await sql("SELECT COUNT(*) AS n FROM oa_chunks WHERE text LIKE '%adults were enrolled in the study%'"))[0][0].n === 0, "the question was not stored anywhere");
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
} finally {
  idp.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall open-access checks passed");
  process.exit(failures ? 1 : 0);
}

