// The agents of the new Paper Reader, phase 3 (docs/design/paper-reader.md, 9.3, 16 and 23), against the real Worker, local D1, the fake identity provider and the stand-in model: written for
// READER "on" (the named run reader-on starts the Worker so; scripts/lib/suites.mjs). Explain (a selection of this paper, checked to be in it; a named idea; streamed and in one piece), Critique
// (streamed: the stages, then the checked points, the stand-in's invented point dropped), the Note-taker (a draft from the highlights only), none of them kept in the question history, each
// counted under reader_agent_<name>, another person's paper refused, and an agent block kept in the notes.
//   node scripts/agents-e2e.mjs    (the Worker must be running with READER on: `npm run integration -w apps/api -- --run=reader-on`)
import { SAMPLE_PAPER, makePdf } from "@scholar/test-support/make-pdf.mjs";
import { APP, countFailure, finish, loginWith, ok, readEvents, sqlResults, startIdp } from "./lib/harness.mjs";
import { checkStream, reportStreams } from "./lib/stream-rule.mjs";

const idp = await startIdp();
const login = loginWith(idp);
const pages = (texts) => texts.map((text, i) => ({ page: i + 1, text }));
const counted = async (feature) => Object.fromEntries(((await sqlResults([`SELECT outcome, SUM(n) AS n FROM answer_outcomes WHERE feature = '${feature}' GROUP BY outcome`]))?.[0] ?? []).map((r) => [r.outcome, r.n]));

try {
  const A = await login("ag-a", "ag-a@example.com", "Asha Agents");
  const B = await login("ag-b", "ag-b@example.com", "Bela Other");
  const doc = (await (await A.send(`${APP}/api/v1/documents`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/pdf", "X-Filename": "agents.pdf" }, body: makePdf(SAMPLE_PAPER, { title: "Agents paper" }) })).json()).document;
  const P = `/api/v1/documents/${doc.id}`;
  const ask = (body, client = A) => client.api(`${P}/ask`, { method: "POST", body });
  const stream = (body) => A.send(`${APP}${P}/ask?stream=1`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(body) });

  console.log("before the paper is indexed");
  ok((await ask({ mode: "explain", question: "the method" })).status === 409, "Explain on a paper that is not ready: 409 (the page says it has no index)");
  ok((await ask({ mode: "critique" })).status === 409, "Critique too");
  await A.api(`${P}/pages`, { method: "POST", body: { pages: pages(SAMPLE_PAPER) } });
  const fin = (await (await A.api(`${P}/finish`, { method: "POST", body: { pages: 3 } })).json()).document;
  ok(fin.status === "ready", "the paper is indexed");

  console.log("the modes");
  ok((await ask({ mode: "summarise" })).status === 400, "a mode outside ask, explain, critique: 400");
  ok((await ask({ mode: "explain" })).status === 400, "Explain with nothing to explain: 400");
  ok((await ask({ mode: "explain", selection: "x".repeat(601) })).status === 400, "a selection over 600 characters: 400");
  const notIn = await ask({ mode: "explain", selection: "quantum chromodynamics of the strong interaction", page: 1 });
  ok(notIn.status === 400 && (await notIn.json()).title === "That passage is not in this paper", "a selection that is not in the paper: 400, said plainly");
  ok((await ask({ mode: "explain", question: "the method" }, B)).status === 404, "another person's paper: 404");
  ok((await A.api(`${P}/ask`, { method: "POST", body: { mode: "critique" }, origin: null })).status === 403, "the cross-origin check");

  console.log("Explain");
  const sel = "Participants were recruited from three hospitals in Pune";
  const once = await ask({ mode: "explain", selection: sel, page: 2 });
  const ea = (await once.json()).answer;
  ok(once.status === 200 && ea.found && ea.verified && ea.citations.length >= 1 && ea.citations.every((c) => c.page >= 1), `a selection is explained, its answer citing pages (${ea.citations.map((c) => c.page).join(", ")})`);
  ok(ea.question.includes(sel), "the answer says what it explained");
  const evs = (await readEvents(await stream({ mode: "explain", question: "sensitivity and specificity" }))).events;
  checkStream("ask", evs, "explain");
  const kinds = evs.map((e) => (e.type === "stage" ? "stage:" + e.stage : e.type));
  ok(kinds[0] === "stage:retrieving" && kinds[1] === "sources" && kinds.includes("delta") && kinds.at(-1) === "answer", `streamed: retrieval, pages, the text, the checked answer (${kinds.slice(0, 3).join(", ")} … ${kinds.at(-1)})`);

  console.log("Critique");
  const cevs = (await readEvents(await stream({ mode: "critique" }))).events;
  checkStream("ask", cevs, "critique");
  const ck = cevs.map((e) => (e.type === "stage" ? "stage:" + e.stage : e.type));
  const crit = cevs.at(-1).critique;
  ok(ck[0] === "stage:retrieving" && ck[1] === "sources" && !ck.includes("delta") && ck.at(-2) === "stage:checking" && ck.at(-1) === "critique", `streamed: the stages and pages, no text, then the checked points (${ck.join(", ")})`);
  ok(crit.points.length >= 1 && crit.dropped === 1, `points shown (${crit.points.length}); the stand-in's invented point dropped (${crit.dropped})`);
  ok(crit.points.every((p) => SAMPLE_PAPER[p.page - 1].replace(/\s+/g, " ").includes(p.quote)), "every point's quote is in the paper, on the page it gives");
  ok(crit.points.every((p) => ["thin_evidence", "missing_baseline", "overclaim", "limitation_stated", "limitation_unstated"].includes(p.kind) && p.text.length > 3), "every point has a kind of the list and its words");
  const none = await (await ask({ mode: "critique", question: "an unanswerable focus" })).json();
  ok(none.critique.points.length === 0 && none.critique.focus === "an unanswerable focus", "in one piece, with a focus: none when there is none");

  console.log("the Note-taker");
  const nt = () => A.api(`${P}/ask-highlights`, { method: "POST", body: { mode: "notes", legend: { yellow: "yellow", green: "green", blue: "blue", pink: "pink" } } });
  ok((await nt()).status === 409, "no highlights yet: 409");
  for (const [page, quote, color] of [[1, "automated glaucoma screening from retinal photographs", "yellow"], [2, "Participants were recruited from three hospitals in Pune", "green"], [3, "The model reached a sensitivity of 91 percent", "pink"]]) {
    await A.api(`${P}/notes`, { method: "POST", body: { page, quote, color } });
  }
  const d = await (await nt()).json();
  const draftPages = new Set(d.draft.blocks.flatMap((b) => (b.kind === "quote" ? [b.page] : [...b.md.matchAll(/\(p\. ([\d, ]+)\)/g)].flatMap((m) => m[1].split(",").map(Number)))));
  ok(d.draft.title === "Notes from my highlights" && [1, 2, 3].every((p) => draftPages.has(p)), `a draft page that keeps every page of the highlights (${[...draftPages].sort().join(", ")})`);
  ok(d.draft.blocks.some((b) => b.kind === "text" && b.md.startsWith("## Key idea")) && d.dropped === 1, "headings by meaning; the stand-in's bullet that names no highlight dropped");
  ok((await A.api(`${P}/notebook`).then((r) => r.json())).pages.length === 0, "nothing is kept until the reader adds it");
  ok((await B.api(`${P}/ask-highlights`, { method: "POST", body: { mode: "notes" } })).status === 404, "another person's paper: 404");

  console.log("never kept in the question history; counted");
  ok((await (await A.api(P)).json()).history.length === 0, "Explain and Critique are not kept in the paper's question history");
  const ex = await counted("reader_agent_explain");
  const cr = await counted("reader_agent_critique");
  const no = await counted("reader_agent_notes");
  ok(ex.answered >= 2, `reader_agent_explain counted (${JSON.stringify(ex)})`);
  ok(cr.critique_points >= 1 && cr.critique_none >= 1, `reader_agent_critique counted (${JSON.stringify(cr)})`);
  ok(no.notes_drafted >= 1, `reader_agent_notes counted (${JSON.stringify(no)})`);

  console.log("an agent block in the notes");
  const block = { id: "a1", kind: "agent", agent: "explain", ask: sel, md: "It means the sample came from three hospitals (p. 2).", pages: [2], at: Date.now() };
  const put = await A.api(`${P}/notebook/pages/p1`, { method: "PUT", body: { title: "Notes", blocks: [block] } });
  ok(put.status === 201, "a page with an agent block is kept");
  ok((await A.api(`${P}/notebook/pages/p1`, { method: "PUT", body: { rev: 1, blocks: [{ ...block, pages: [4] }] } })).status === 400, "an agent block citing a page the paper does not have: 400");
  const exp = await (await A.api("/api/v1/account/export")).json();
  ok((exp.notebook ?? []).some((p) => p.blocks.some((b) => b.kind === "agent" && b.ask === sel)), "it is in the data export");
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  countFailure();
}
reportStreams(ok);
await idp.close?.();
finish("all agents checks passed", (n) => `${n} check(s) FAILED`);
