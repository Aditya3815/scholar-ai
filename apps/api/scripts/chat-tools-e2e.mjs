// CHAT_TOOLS end to end (docs/design/chat-tools.md): POST /api/v1/chat on the real Worker + local D1 + fake IdP, with the offline stand-ins (QA_STUB=1): the chat's search and model, the reference
// check (src/chat/tools-stub.ts), Crossref's retraction data (src/library/retraction-stub.ts) and the open-access network (src/oa/stub.ts). The retraction service, "Ask this paper" and a paper's
// own ask are the real ones.
// - Default run (CHAT_TOOLS "on" in wrangler.jsonc, which scripts/integration.mjs passes on in INTEGRATION_VARS): the cheap tools run in the reply.
// - INTEGRATION_VARS="CHAT_TOOLS:off" (with --only="chat tools"): a pasted list is still OFFERED (the card), and nothing runs.
// - Add CHAT_UNDERSTAND:on to also see a question about one paper of the chat answered from that paper.
import { startFakeIdp } from "./fake-idp.mjs";
import { createClient } from "./test-client.mjs";
import { checkStream, reportStreams } from "./lib/stream-rule.mjs";
import { SAMPLE_PAPER, makePdf } from "./lib/make-pdf.mjs";

const APP = process.env.APP ?? "http://localhost:8788";
const VARS = process.env.INTEGRATION_VARS ?? "";
const TOOLS_ON = /(^|,)CHAT_TOOLS:on(,|$)/.test(VARS);
const UND_ON = /(^|,)CHAT_UNDERSTAND:on(,|$)/.test(VARS);
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

async function chat(client, body) {
  const res = await client.send(`${APP}/api/v1/chat`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify(body) });
  const text = await res.text();
  const all = text.split("\n\n").flatMap((b) => { const d = b.split("\n").find((l) => l.startsWith("data:")); return d ? [JSON.parse(d.slice(5))] : []; });
  const events = all.filter((e) => e.type !== "think");
  return { res, events, think: all.filter((e) => e.type === "think"), tools: events.filter((e) => String(e.type).startsWith("tool")), done: events.at(-1), understood: events.find((e) => e.type === "understood") };
}
const honest = (t) => { const have = new Set(Object.values(t.counts ?? {})); return [...String(t.text).replace(/“[^”]*”/g, "“”").matchAll(/\d[\d,]*(?:\.\d+)?/g)].every((m) => have.has(Number(m[0].replace(/,/g, "")))); };

const LIST = [
  "[1] Watson, J. D., & Crick, F. H. C. (1953). Molecular structure of nucleic acids. Nature, 171, 737-738.",
  "[2] Vaswani, A., et al. (2017). Attention is all you need. Advances in Neural Information Processing Systems.",
  "[3] Invented, Q. (2021). A study that does not exist at all. Journal of Nothing, 1, 1-2.",
  "[4] Mismatch, M. (2019). Deep residual learning for image recognition. CVPR, 770-778.",
].join("\n");
const RETRACT = "Is 10.5555/retracted-chat-tools retracted? And 10.5555/clear-chat-tools?";

try {
  const A = await login("tools-a", "tools-a@example.com", "Tools A");
  if (!TOOLS_ON) {
    console.log("CHAT_TOOLS unset: the tools are offered, never run");
    const list = await chat(A, { mode: "auto", message: LIST });
    checkStream("chat", list.events, "a list, switch off");
    ok(list.res.status === 200 && list.understood?.mode === "verify" && list.done?.reason === "routed" && list.tools.length === 0, "a pasted list is taken for Check references and offered (the card), and nothing is checked");
    const ret = await chat(A, { mode: "auto", message: RETRACT });
    ok(ret.tools.length === 0 && ret.done?.type === "done", "DOIs that ask about retraction run no check either");
  } else {
    console.log("CHAT_TOOLS on: Check references in the reply");
    const list = await chat(A, { mode: "auto", message: LIST });
    checkStream("chat", list.events, "a list");
    const refs = list.tools.filter((e) => e.type === "tool_ref").map((e) => e.item).sort((a, b) => a.n - b.n);
    ok(list.understood?.mode === "verify" && list.understood?.confirm === undefined, "it is understood as Check references; the rules decided, so there is no 'Did you want this?' (one line)");
    if (list.think.length) ok(list.think.filter((t) => t.kind === "understood" || t.id === "confirm").length === 1, "the Thinking block has one understood line, with its Change");
    ok(list.tools[0]?.type === "tool" && list.tools[0].tool === "verify" && list.tools[0].total === 4, "the reply says it checks 4 references");
    ok(JSON.stringify(refs.map((i) => i.verdict?.status)) === JSON.stringify(["verified", "verified", "not_found", "mismatch"]), `each gets the page's verdict, in order (${refs.map((i) => i.verdict?.status).join(", ")})`);
    ok(list.done?.type === "done" && list.done.reason === "tool" && list.done.answered === false, "the reply ends `tool`: no written chat answer");
    if (list.think.length) ok(list.think.every(honest) && list.think.some((t) => t.id === "tool_result" && t.counts?.checked === 4), "the Thinking block says what was checked, with honest numbers");

    console.log("a visitor gets the same check (Check references needs no sign-in)");
    const V = createClient(APP);
    const vis = await chat(V, { mode: "auto", message: LIST });
    ok(vis.tools.filter((e) => e.type === "tool_ref").length === 4, "four verdicts for a visitor too");

    console.log("retractions");
    const ret = await chat(A, { mode: "auto", message: RETRACT });
    checkStream("chat", ret.events, "retractions");
    const r = ret.tools.find((e) => e.type === "tool_retractions");
    ok(!!r && r.checked.find((c) => c.doi === "10.5555/retracted-chat-tools")?.status === "retracted" && r.checked.find((c) => c.doi === "10.5555/clear-chat-tools")?.status === "not_retracted", "Crossref's data says which DOI is retracted and which is not");
    ok(r?.checked.find((c) => c.status === "retracted")?.notices.includes("10.5555/retracted-chat-tools-notice"), "...with the retraction notice's DOI");
    ok(JSON.stringify(r?.checked.map((c) => c.doi)) === JSON.stringify(["10.5555/retracted-chat-tools", "10.5555/clear-chat-tools"]) && ret.tools[0]?.dois === 2, `only the DOIs the person wrote are checked (${r?.checked.map((c) => c.doi).join(", ")})`);

    console.log("never for a search chosen by hand, a greeting or an idea");
    const hand = await chat(A, { mode: "search", message: RETRACT });
    ok(hand.tools.length === 0 && hand.understood?.how === "chosen", "a search chosen by hand runs no tool");
    const hi = await chat(A, { mode: "auto", message: "hi, how are you?" });
    ok(hi.tools.length === 0, "a greeting runs nothing");
    const idea = await chat(A, { mode: "auto", message: "now my idea about bees, is it novel" });
    ok(idea.tools.length === 0 && idea.done?.reason === "routed", "Idea Check is still a card");

    console.log("a question about the person's own paper");
    const pdf = makePdf(SAMPLE_PAPER, { title: "Glaucoma screening" });
    const up = await A.send(`${APP}/api/v1/documents`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/pdf", "X-Filename": encodeURIComponent("glaucoma_screening.pdf") }, body: pdf });
    const doc = (await up.json()).document;
    await A.api(`/api/v1/documents/${doc.id}/pages`, { method: "POST", body: { pages: SAMPLE_PAPER.map((text, i) => ({ page: i + 1, text })) } });
    const fin = (await (await A.api(`/api/v1/documents/${doc.id}/finish`, { method: "POST", body: { pages: SAMPLE_PAPER.length } })).json()).document;
    ok(fin?.status === "ready", "the paper is uploaded and ready");
    const own = await chat(A, { mode: "auto", message: "In my uploaded paper, how long did the follow-up last?" });
    checkStream("chat", own.events, "own paper");
    const start = own.tools.find((e) => e.type === "tool");
    const end = own.tools.filter((e) => e.type === "tool_ask").map((e) => e.event).find((x) => x.type === "answer" || x.type === "error");
    ok(start?.tool === "ask_doc" && /glaucoma/i.test(start.paper?.title ?? ""), `it is answered from that paper (${start?.tool ?? "no tool"})`);
    ok(end?.type === "answer" && end.answer.citations.length > 0, "with quotes from the paper, each checked against it");
    ok(!JSON.stringify(own.events).includes(doc.id), "the paper's id never leaves the server");
    const page = await (await A.api(`/api/v1/documents/${doc.id}`)).json();
    ok((page.history ?? []).some((q) => /follow-up/.test(q.question)), "the question is kept with the paper's own questions, as one asked on its page");

    if (UND_ON) {
      console.log("with the Understand step: a question about one paper of the chat");
      const LEDGER = [{ turn: 1, user: "glaucoma screening in rural India", intent: "search", standalone: "glaucoma screening in rural India", reply: "Screening found glaucoma early.", papers: [
        { n: 1, id: "doi:10.1000/glaucoma.1", doi: "10.1000/glaucoma.1", title: "Deep learning for glaucoma screening from fundus photographs", year: 2021, first_author: "Rao" },
        { n: 2, id: "doi:10.1000/glaucoma.2", doi: "10.1000/glaucoma.2", title: "Smartphone-based retinal imaging in rural clinics", year: 2022, first_author: "Iyer" },
      ] }];
      const ask = await chat(A, { mode: "auto", message: "dusre paper ka method kya hai?", ledger: LEDGER });
      checkStream("chat", ask.events, "a result's paper");
      const s = ask.tools.find((e) => e.type === "tool");
      const asked = ask.tools.filter((e) => e.type === "tool_ask").map((e) => e.event);
      ok(s?.tool === "ask_paper" && s.paper?.doi === "10.1000/glaucoma.2", "the second paper of the chat is asked, by its DOI");
      const basis = asked.find((x) => x.type === "paper");
      ok(!!basis && asked.some((x) => x.type === "answer" || x.type === "error"), `"Ask this paper" says what the answer is made from (${basis?.source ?? "?"}) and ends with an answer or a reason`);
    }
  }
  reportStreams(ok);
} catch (e) {
  console.error(e);
  failures++;
} finally {
  idp.close?.();
}
console.log(failures ? `\n${failures} FAIL` : "\nall ok");
process.exit(failures ? 1 : 0);
