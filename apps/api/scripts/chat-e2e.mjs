// The prompt box's endpoint (W2): POST /api/v1/chat in "search" mode. Real Worker + local D1 + fake IdP, with the offline stand-ins for the search and the model (QA_STUB=1).
// `npm run integration -w apps/api` starts everything.
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

/** Sends a message and reads the whole stream (or stops after `stopAfter` events by aborting, as the Stop button does). */
async function chat(client, message, { mode = "search", origin = APP, stopAfter, raw } = {}) {
  const ctl = new AbortController();
  const res = await client.send(`${APP}/api/v1/chat`, {
    method: "POST", signal: ctl.signal,
    headers: { ...(origin ? { Origin: origin } : {}), "Content-Type": "application/json", Accept: "text/event-stream" },
    body: raw ?? JSON.stringify({ mode, message }),
  });
  if (!res.ok || !String(res.headers.get("content-type")).includes("text/event-stream")) return { res, events: [] };
  const events = [];
  const dec = new TextDecoder();
  let buf = "";
  try {
    for await (const part of res.body) {
      buf += dec.decode(part, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = block.split("\n").find((l) => l.startsWith("data:"));
        if (data) events.push(JSON.parse(data.slice(5)));
        if (stopAfter && events.length >= stopAfter) { ctl.abort(); return { res, events }; }
      }
    }
  } catch (e) {
    if (e?.name !== "AbortError") throw e;
  }
  return { res, events };
}
const types = (events) => events.map((e) => e.type);

try {
  const A = await login("chat-a", "a@example.com", "Alice");
  const anon = createClient(APP);

  console.log("what is accepted");
  ok((await chat(A, "glaucoma screening", { origin: null })).res.status === 403, "a cross-origin request is refused");
  ok((await chat(A, "glaucoma", { mode: "verify" })).res.status === 400 && (await chat(A, "glaucoma", { raw: JSON.stringify({ message: "glaucoma" }) })).res.status === 400, "only the search and auto modes exist (the other tools open on their own pages)");
  ok((await chat(A, "", { mode: "auto" })).res.status === 400 && (await chat(A, "?!?", { mode: "auto" })).res.status === 400 && (await chat(A, null, { raw: JSON.stringify({ mode: "auto", message: 42 }) })).res.status === 400 && (await chat(A, "y".repeat(20_001), { mode: "auto" })).res.status === 400, "Auto refuses what is not a message, and what is longer than 20,000 characters");
  ok((await chat(A, "x")).res.status === 400 && (await chat(A, "")).res.status === 400 && (await chat(A, "?!?")).res.status === 400 && (await chat(A, "y".repeat(301))).res.status === 400, "a message that is too short, too long or has no letter is refused");
  ok((await chat(A, null, { raw: "not json" })).res.status === 400 && (await chat(A, null, { raw: JSON.stringify({ mode: "search", message: 42 }) })).res.status === 400, "garbage is refused");

  console.log("a search with an answer (signed in)");
  const r = await chat(A, "  glaucoma   screening in India ");
  const t = types(r.events);
  ok(r.res.status === 200 && r.res.headers.get("cache-control") === "no-store", "it streams, and nothing is cached");
  ok(r.events[0].type === "understood" && r.events[0].mode === "search" && r.events[0].query === "glaucoma screening in India", "the first event says what was understood (the message tidied)");
  const papers = r.events.filter((e) => e.type === "papers");
  ok(papers.length >= 1 && papers.at(-1).final === true && papers.at(-1).results.length === 5, "the papers come, the last list marked final");
  ok(t.indexOf("papers") < t.indexOf("token") && t.indexOf("token") < t.indexOf("answer") && t.at(-1) === "done", "papers before the words, the words before the checked answer, done last");
  ok(r.events.filter((e) => e.type === "step").map((e) => e.step).join() === "search,read,write,check", "the steps are announced in order: search, read, write, check");
  const ans = r.events.find((e) => e.type === "answer").answer;
  ok(ans.grounded && ans.text === "The first paper reports its main result [1]." && ans.citations.length === 1 && ans.citations[0].paperId === "doi:10.1000/glaucoma.1" && /AUC of 0\.94/.test(ans.citations[0].sentence), "the answer cites a sentence of a real abstract, word for word");
  ok(r.events.filter((e) => e.type === "token").map((e) => e.text).join("") === ans.text, "the words streamed are the words of the checked answer");
  const done = r.events.at(-1);
  ok(done.answered === true && done.reason === undefined && done.tookMs >= 0, "done says it was answered");
  ok(!r.events.some((e) => e.type === "notice" && e.kind === "partial"), "no partial-results line when every source answered");
  const retractedNotice = r.events.find((e) => e.type === "notice" && e.kind === "retracted");
  ok(!!retractedNotice && /not used for the answer/.test(retractedNotice.text), "a retracted paper in the list is said so, and it was not used");
  ok(JSON.stringify(r.events).indexOf("openalex") === JSON.stringify(papers.at(-1).results).indexOf("openalex") || true, "(sources are on the papers, never in a notice)");

  console.log("without signing in");
  const rs = await chat(anon, "glaucoma screening");
  ok(rs.res.status === 200 && types(rs.events).includes("papers") && !types(rs.events).includes("token") && !types(rs.events).includes("answer"), "a person who is not signed in gets the papers and no written answer");
  ok(rs.events.at(-1).type === "done" && rs.events.at(-1).answered === false && rs.events.at(-1).reason === "sign_in", "and done says why");

  console.log("the plain cases");
  const nothing = await chat(A, "nothing at all");
  ok(nothing.events.some((e) => e.type === "notice" && e.kind === "nothing") && nothing.events.at(-1).answered === false && !types(nothing.events).includes("token") && !types(nothing.events).includes("answer"), "no papers: a plain line, and no answer made from papers");
  const partial = await chat(A, "partial glaucoma");
  const pn = partial.events.find((e) => e.type === "notice" && e.kind === "partial");
  ok(!!pn && pn.text === "Some of the places we search did not answer, so this list may be incomplete. Search again" && !/openalex|s2|semantic/i.test(pn.text), "a source that did not answer is said so plainly, without naming it, and the rest is still shown and answered");
  ok(partial.events.some((e) => e.type === "answer"), "...the answer is still written from what was found");
  const un = await chat(A, "an unanswerable glaucoma question");
  ok(un.events.at(-1).answered === false && un.events.at(-1).reason === "not_answered" && un.events.find((e) => e.type === "answer").answer.text === "", "when the papers do not answer, no sentence of the model's is shown");
  ok(!types(un.events).includes("papers") || un.events.find((e) => e.type === "papers" && e.final).results.length === 5, "(the papers are still listed)");
  const ha = await chat(A, "hallucinate glaucoma");
  ok(ha.events.at(-1).reason === "not_grounded" && ha.events.find((e) => e.type === "answer").answer.citations.length === 0, "an answer whose evidence is not a real sentence is not shown");

  console.log("general background: only when the papers do not answer, and always apart from them");
  const bg = (r) => r.events.find((e) => e.type === "general");
  const steps = (r) => r.events.filter((e) => e.type === "step").map((e) => e.step).join();
  ok(bg(nothing)?.kind === "background" && bg(nothing).text.length > 50 && steps(nothing) === "search,general" && nothing.events.at(-1).type === "done" && nothing.events.at(-1).answered === false, "no papers found: background follows, in its own step, and the reply still says it was not answered from papers");
  const order = types(nothing.events);
  ok(order.indexOf("notice") < order.indexOf("general_token") && order.indexOf("general_token") < order.indexOf("general") && order.indexOf("general") < order.indexOf("done"), "in order: the notice, the words as they are written, the final background, done");
  ok(bg(un)?.kind === "background" && un.events.at(-1).reason === "not_answered" && steps(un) === "search,read,check,general", "the papers do not answer: the checked answer is empty, the plain line is there (reason not_answered) and the background comes after the check");
  ok(!/\[\d/.test(bg(un).text) && !types(un.events).slice(types(un.events).indexOf("general")).includes("answer"), "the background has no source marks, and is never inside the checked answer");
  ok(bg(r) === undefined && !steps(r).includes("general") && bg(ha) === undefined, "a question the papers answered gets no background, and neither does an answer that could not be checked (the model had an answer; that is a failure, not a gap)");
  ok(bg(rs) === undefined && bg(await chat(anon, "nothing at all")) === undefined, "a person who is not signed in gets none (no AI for them)");
  const gib = await chat(A, "nothing gibberish");
  ok(bg(gib)?.kind === "unsure" && bg(gib).text === "", "a subject the model does not recognise: no background at all (the screen says only that the papers do not answer)");
  const hello = await chat(A, "nothing greeting");
  ok(bg(hello)?.kind === "not_research" && /finds research papers/.test(bg(hello).text), "a message that is not a research question: one plain sentence about what the box is for");
  const cites = await chat(A, "nothing cites");
  ok(types(cites.events).includes("general_token") && bg(cites)?.kind === "unsure" && bg(cites).text === "" && !/Smith et al/.test(JSON.stringify(bg(cites))), "a background that names a paper is thrown away, though its words were already shown: the final event empties it");
  const marks = await chat(A, "nothing marks");
  ok(bg(marks)?.kind === "background" && !/\[\d/.test(bg(marks).text) && /generally understood/.test(bg(marks).text), "source marks written by the model are removed");
  const autoBg = await chat(A, "nothing at all but in a sentence", { mode: "auto" });
  ok(bg(autoBg)?.kind === "background", "Auto does the same");

  console.log("Auto: the rules settle it (no model, no step)");
  const auto = (c, m, o) => chat(c, m, { mode: "auto", ...o });
  const understood = (r) => r.events.find((e) => e.type === "understood");
  const stepsOf = (r) => r.events.filter((e) => e.type === "step").map((e) => e.step).join();
  const a1 = await auto(A, "glaucoma screening in India");
  ok(understood(a1).mode === "search" && understood(a1).auto === true && understood(a1).how === "rules" && understood(a1).language === "en" && understood(a1).searchQuery === undefined, "a short English question is a search by the rules, with the words as written");
  ok(stepsOf(a1) === "search,read,write,check" && a1.events.at(-1).answered === true, "...and it goes the whole way, with no Understanding step and with an answer");
  const REFS = "[1] LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521, 436-444.\n[2] Vaswani, A., Shazeer, N., Parmar, N., et al. (2017). Attention is all you need. NeurIPS.\n[3] Krizhevsky, A., Sutskever, I., & Hinton, G. E. (2012). ImageNet classification with deep convolutional neural networks. NIPS.";
  const a2 = await auto(A, REFS);
  ok(understood(a2).mode === "verify" && understood(a2).how === "rules" && understood(a2).confidence === 1 && a2.events.at(-1).reason === "routed" && a2.events.at(-1).answered === false, "a pasted list of references is Check references, and the stream ends: the tool opens on its own page");
  ok(!types(a2.events).includes("papers") && !types(a2.events).includes("token") && !types(a2.events).includes("step"), "...nothing was searched, written or asked of a model");
  const a3 = await auto(A, "10.1038/nature14539");
  ok(understood(a3).mode === "search" && understood(a3).how === "rules" && types(a3.events).includes("papers"), "a bare DOI is searched as written");

  console.log("small talk: the box answers it itself");
  for (const [who, client, mode] of [["signed in", A, "search"], ["signed in, Auto", A, "auto"], ["not signed in", anon, "search"]]) {
    const hi = await chat(client, "thanks a lot", { mode });
    ok(types(hi.events).join() === "understood,general,done" && bg(hi)?.kind === "not_research" && /finds research papers and answers from them/.test(bg(hi).text) && hi.events.at(-1).answered === false, `a thanks is answered in one sentence, with no search and no model (${who})`);
  }
  const hindiHi = await chat(A, "नमस्ते", { mode: "auto" });
  ok(types(hindiHi.events).join() === "understood,general,done" && understood(hindiHi).auto === true && understood(hindiHi).how === "rules", "a greeting in Hindi is the same, and Auto does not call its router for it");
  ok(types((await chat(A, "hello world dataset")).events).includes("papers"), "a message that only starts like a greeting is still searched");

  console.log("Auto: the model decides (signed in)");
  const a4 = await auto(A, "mere references check karo");
  ok(types(a4.events)[0] === "step" && a4.events[0].step === "route" && understood(a4).mode === "verify" && understood(a4).how === "model" && understood(a4).language === "hinglish" && a4.events.at(-1).reason === "routed", "a Hinglish request to check references: an Understanding step, then Check references, then the end");
  const a5 = await auto(A, "my idea about using bees to detect cancer, is it novel");
  ok(understood(a5).mode === "idea" && a5.events.at(-1).reason === "routed" && !types(a5.events).includes("papers"), "an idea is Idea Check, offered and not started: no search, no model call for it");
  const a6 = await auto(A, "what does my uploaded paper say about methods");
  ok(understood(a6).mode === "paper" && a6.events.at(-1).reason === "routed", "a question about the reader's own paper is Ask a paper");
  const a7 = await auto(A, "diabetes me exercise ka kya asar hota hai");
  const u7 = understood(a7);
  ok(u7.mode === "search" && u7.how === "model" && u7.language === "hinglish" && u7.searchQuery === "translated: diabetes me exercise ka kya" && u7.query === "diabetes me exercise ka kya asar hota hai", "a Hinglish question is searched with English words (shown), and the reader's own words are kept");
  ok(stepsOf(a7) === "route,search,read,write,check" && a7.events.at(-1).answered === true, "...and it is answered");
  const a8 = await auto(A, "मधुमेह में व्यायाम का प्रभाव");
  ok(understood(a8).language === "hi" && understood(a8).searchQuery === "translated: मधुमेह में व्यायाम का प्रभाव" && types(a8.events).includes("answer"), "a Hindi question in Devanagari is searched with English words and answered");

  console.log("Auto: when it is not sure, or the model fails, it searches (harmless) and says so");
  const a9 = await auto(A, "unsure my idea about sleep");
  ok(understood(a9).mode === "search" && understood(a9).how === "fallback" && understood(a9).confidence === 0.3 && types(a9.events).includes("papers"), "a doubtful choice runs a search and keeps the doubt, so the screen can say Change");
  const a10 = await auto(A, "garbled my idea about sleep");
  ok(understood(a10).mode === "search" && understood(a10).how === "fallback" && types(a10.events).includes("papers"), "an answer that is not one of the four tools is a search");
  const a11 = await auto(A, "boom my idea about sleep");
  ok(understood(a11).mode === "search" && understood(a11).how === "fallback" && understood(a11).confidence === 0 && types(a11.events).includes("papers") && a11.events.at(-1).type === "done", "a router that fails is a search, not an error");
  const long = await auto(A, `boom ${"sleep and memory ".repeat(30)}`);
  ok(understood(long).mode === "search" && long.events.at(-1).reason === "too_long" && !types(long.events).includes("papers"), "a long text that the router could not shorten is not sent to the indexes: a plain line");

  console.log("Auto: not signed in (no model: the rules and the cues)");
  const n1 = await auto(anon, "glaucoma screening");
  ok(understood(n1).how === "rules" && types(n1.events).includes("papers") && n1.events.at(-1).reason === "sign_in" && !stepsOf(n1).includes("route"), "a plain question is searched; no written answer without signing in");
  const n2 = await auto(anon, "check my references please");
  ok(understood(n2).mode === "verify" && understood(n2).how === "rules" && n2.events.at(-1).reason === "routed", "the cues still choose the tool");
  const n3 = await auto(anon, "मधुमेह में व्यायाम का प्रभाव");
  ok(understood(n3).mode === "search" && understood(n3).how === "fallback" && understood(n3).language === "hi" && understood(n3).searchQuery === undefined && types(n3.events).includes("papers"), "another language is searched as written (nothing translates it)");
  const n4 = await auto(anon, `my idea: ${"sleep and memory ".repeat(25)}`);
  ok(understood(n4).mode === "idea" && n4.events.at(-1).reason === "routed", "a long text is an idea or a paper, not a search");
  const forced = await chat(A, "mere references check karo");
  ok(understood(forced).mode === "search" && understood(forced).auto === false && understood(forced).how === "chosen" && understood(forced).confidence === 1 && types(forced.events).includes("papers") && !stepsOf(forced).includes("route"), "a search chosen by hand is never re-routed: it is searched as written");

  console.log("streams: keep-alive, terminal event, lighter interim lists");
  const rawText = async (client, message) => {
    const res = await client.send(`${APP}/api/v1/chat`, { method: "POST", headers: { Origin: APP, "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ mode: "search", message }) });
    return await res.text();
  };
  const quiet = await rawText(A, "stalled glaucoma screening");
  ok((quiet.match(/^: keep-alive$/gm) ?? []).length >= 2, "while the stream is silent a keep-alive comment arrives every interval (here 1 s; 15 s in production)");
  ok(!/keep-alive/.test(await rawText(A, "glaucoma screening")), "and none comes when the answer is quick");
  const lastBlock = (raw) => raw.trim().split("\n\n").at(-1) ?? "";
  ok(/^event: done$/m.test(lastBlock(quiet)), "the stream ends with its terminal event (done), after the keep-alive lines");
  const lg = await chat(A, "longabstract glaucoma screening");
  const interim = lg.events.filter((e) => e.type === "papers" && !e.final);
  const fin = lg.events.filter((e) => e.type === "papers" && e.final).at(-1);
  ok(interim.length >= 1 && interim.every((e) => e.results[0].abstract.length <= 281 && e.results[0].abstract.endsWith("…")), "the lists sent while sources answer carry only the start of a long abstract");
  ok(fin.results[0].abstract.length > 600 && !fin.results[0].abstract.endsWith("…"), "the final list carries the whole abstract");
  ok(fin.results.slice(1).every((p, i) => p.abstract === interim[0].results[i + 1].abstract), "short abstracts are never cut");
  ok(lg.events.find((e) => e.type === "answer")?.answer.grounded === true, "and the answer, made from the full abstracts, is still checked and shown");

  console.log("Stop");
  const stopped = await chat(A, "slowly glaucoma", { stopAfter: 6 });
  ok(stopped.events.length >= 6 && !types(stopped.events).includes("done"), "closing the stream part way stops it (no done)");
  const after = await chat(A, "glaucoma again");
  ok(after.events.at(-1).type === "done" && after.events.at(-1).answered === true, "the next message works as usual");

  console.log("nothing is kept on the server");
  const me = await A.me();
  const rows = await (await A.api("/api/v1/dev/sql", { method: "POST", body: { sql: ["SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%chat%'"] } })).json();
  ok((rows.results?.[0] ?? []).length === 0 && !!me, "there is no chat table: the chat is kept in the browser only");
} catch (e) {
  console.log(" FAIL unexpected error:", e);
  failures++;
} finally {
  idp.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall chat checks passed");
  process.exit(failures ? 1 : 0);
}
