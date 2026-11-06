import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THINK_KINDS, applyChatEvent, contextBefore, followUpNote, startAssistant, streamShapeProblems, thinkIsHonest, type AssistantMsg, type ChatEvent } from "@scholar/shared";
import type { StreamComplete } from "../docs/qa";
import { CLEAN_CASES } from "./clean-cases";

/**
 * `sinceYear` on POST /api/v1/chat (docs/design/chatview-and-trending.md, decision T9): an optional whole year, from 1990 to this year, that a Trending chip sets. The server applies it exactly like the
 * router's year filter (before the cards are numbered, before the evidence is picked, on the lists sent while the sources answer, and carried to "the same papers" by the reply's own range) and says it
 * on `understood.context.yearFrom`, which is where the page already reads a year chip from. A request without it is what it always was: the differential check below.
 */

/** Every call the stand-ins receive: the router, the writer (and the background, by its label), the judge and the strict check. */
const calls = vi.hoisted(() => [] as { who: string; label?: string; system: string; user: string }[]);

vi.mock("./stub", async (importOriginal) => {
  const real = await importOriginal<typeof import("./stub")>();
  const rec = (who: string, f: StreamComplete): StreamComplete => async (req, hooks) => {
    calls.push({ who, label: req.label, system: req.system, user: req.user });
    return f(req, hooks);
  };
  return { ...real, stubChatStream: rec("writer", real.stubChatStream), stubJudgeStream: (env?: unknown) => rec("judge", real.stubJudgeStream(env)), stubStrictStream: rec("strict", real.stubStrictStream) };
});
vi.mock("./stub-route", async (importOriginal) => {
  const real = await importOriginal<typeof import("./stub-route")>();
  return { ...real, stubRoute: async (req: Parameters<typeof real.stubRoute>[0]) => (calls.push({ who: "router", label: req.label, system: req.system, user: req.user }), real.stubRoute(req)) };
});

import { chatRoutes } from "./routes";

const TOKEN = "t".repeat(40);
const sessionRow = { id: "user-1", name: "Test", email: "t@example.org", orcid: null, avatar_url: null, role: "scholar", privacy_ack: null, stale: 0, providers: "google" };

function fakeDb(used = 0) {
  const outcomes: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first: async () => (/FROM sessions/.test(sql) ? sessionRow : /SUM\(tokens_in/.test(sql) ? { t: used } : null),
            run: async () => {
              if (/answer_outcomes/.test(sql)) outcomes.push(String(args[1]));
              return {};
            },
            all: async () => ({ results: [] }),
            // a statement as a batch holds it (CHAT_COUNTERS writes the names of a message in one batch)
            __args: args,
          };
        },
      };
    },
    async batch(statements: { __args: unknown[] }[]) {
      for (const s of statements) outcomes.push(`batch:${String(s.__args[0])}:${String(s.__args[1])}`);
      return statements.map(() => ({}));
    },
  };
  return { db, outcomes };
}

type Opts = { signedIn?: boolean; used?: number; env?: Record<string, string>; headers?: Record<string, string>; path?: string };
async function post(body: unknown, opts: Opts = {}) {
  const { db, outcomes } = fakeDb(opts.used ?? 0);
  const headers: Record<string, string> = { "content-type": "application/json", origin: "http://localhost", ...(opts.signedIn === false ? {} : { cookie: `sid=${TOKEN}` }), ...opts.headers };
  const res = await chatRoutes.request(`http://localhost${opts.path ?? "/"}`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }, { DB: db, ENABLE_DEV_ROUTES: "1", QA_STUB: "1", CROSSREF_MAILTO: "t@example.org", ...opts.env });
  const text = await res.text();
  return { res, text, outcomes, json: () => JSON.parse(text) as Record<string, unknown> };
}
const eventsOf = (text: string): ChatEvent[] =>
  text.split("\n\n").flatMap((block) => {
    const data = block.split("\n").find((l) => l.startsWith("data:"));
    return data ? [JSON.parse(data.slice(5)) as ChatEvent] : [];
  });
type Understood = Extract<ChatEvent, { type: "understood" }>;
const run = async (body: unknown, opts: Opts = {}) => {
  const { res, text, outcomes } = await post(body, opts);
  expect(res.status).toBe(200);
  const ev = eventsOf(text);
  return {
    ev,
    text,
    outcomes,
    understood: ev.find((e) => e.type === "understood") as Understood,
    answer: (ev.find((e) => e.type === "answer") as Extract<ChatEvent, { type: "answer" }> | undefined)?.answer,
    done: ev.at(-1) as Extract<ChatEvent, { type: "done" }>,
    lists: ev.filter((e) => e.type === "papers") as Extract<ChatEvent, { type: "papers" }>[],
    finalPapers: (ev.filter((e) => e.type === "papers" && e.final).at(-1) as Extract<ChatEvent, { type: "papers" }> | undefined)?.results ?? [],
    notices: (ev.filter((e) => e.type === "notice") as Extract<ChatEvent, { type: "notice" }>[]).map((n) => ({ kind: n.kind, text: n.text })),
  };
};

const auto = (message: string, extra: Record<string, unknown> = {}) => ({ mode: "auto", message, ...extra });
const byHand = (message: string, extra: Record<string, unknown> = {}) => ({ mode: "search", message, ...extra });
const u = (text: string) => ({ role: "user", text });
const a = (extra: Record<string, unknown> = {}) => ({ role: "assistant", ...extra });
const GLAUCOMA = [u("glaucoma screening in rural India"), a({ searchQuery: "glaucoma screening rural India", papers: [{ n: 1, title: "Deep learning for glaucoma screening from fundus photographs", year: 2021 }], text: "Screening found glaucoma early [1]." })];
const callsOf = (who: string) => calls.filter((c) => c.who === who);

/** The stand-in's list, in its order, with the year of each: 2021, 2022, 2019 (retracted), 2018 (no abstract), 2020. The Indian list: 2021, 2016, 2022. */
const NOW = new Date("2026-11-03T12:00:00Z");
beforeEach(() => {
  calls.length = 0;
  // only the clock is held still (the stream's own timers keep running), so that "this year" is a fixed number
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the field: a whole year from 1990 to this year, or a 400 in the repository's problem format", () => {
  it("1990, a year in between and this year are accepted, in Auto and in a search chosen by hand, in the Indian scope and with `anyway`", async () => {
    for (const year of [1990, 2005, 2025, 2026]) {
      expect((await post(auto("effect of yoga on blood pressure", { sinceYear: year }))).res.status, `auto ${year}`).toBe(200);
      expect((await post(byHand("effect of yoga on blood pressure", { sinceYear: year }))).res.status, `search ${year}`).toBe(200);
    }
    expect((await post(byHand("glaucoma screening", { sinceYear: 2020, scope: "india" }))).res.status).toBe(200);
    expect((await post(byHand("glaucoma screening", { sinceYear: 2020, anyway: true }))).res.status).toBe(200);
  });

  it("anything else is `invalid_since_year` (400, with a title and a detail that say what is allowed), and nothing is read, searched or sent to a model", async () => {
    const bad: unknown[] = [1989, 1900, 0, -1, -0, 2027, 3000, 1e21, 2025.5, 1990.0001, "2025", "", " 2025", null, true, false, [2025], { year: 2025 }, [], {}];
    for (const sinceYear of bad) {
      const r = await post(auto("effect of yoga on blood pressure", { sinceYear }));
      expect(r.res.status, JSON.stringify(sinceYear)).toBe(400);
      expect(r.res.headers.get("content-type"), JSON.stringify(sinceYear)).toMatch(/json/);
      expect(r.res.headers.get("cache-control")).toBe("no-store");
      const body = r.json();
      expect(body, JSON.stringify(sinceYear)).toMatchObject({ type: "invalid_since_year", title: expect.any(String) });
      expect(String(body.detail)).toMatch(/1990/);
      expect(String(body.detail)).toMatch(/2026/);
      expect(Object.keys(body).sort()).toEqual(["detail", "title", "type"]);
      // the same for a search chosen by hand
      expect((await post(byHand("glaucoma screening", { sinceYear }))).res.status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it("a number that JSON writes out of range (1e400) or without a fraction (2025.0) is read as the number it is", async () => {
    const raw = (v: string) => `{"mode":"auto","message":"effect of yoga on blood pressure","sinceYear":${v}}`;
    expect((await post(raw("1e400"))).res.status).toBe(400);
    expect((await post(raw("2025.0"))).res.status).toBe(200);
  });

  it("'this year' is the year of the server's clock: the last second of a year does not accept the next one, the first second of it does", async () => {
    vi.setSystemTime(new Date("2026-12-31T23:59:59Z"));
    expect((await post(auto("effect of yoga on blood pressure", { sinceYear: 2027 }))).res.status).toBe(400);
    expect((await post(auto("effect of yoga on blood pressure", { sinceYear: 2026 }))).res.status).toBe(200);
    vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
    expect((await post(auto("effect of yoga on blood pressure", { sinceYear: 2027 }))).res.status).toBe(200);
    expect((await post(auto("effect of yoga on blood pressure", { sinceYear: 2028 }))).res.status).toBe(400);
  });

  it("is checked before the history, whoever sends it, and for a person who is not signed in", async () => {
    expect((await post(auto("only after 2020", { history: GLAUCOMA, sinceYear: 1800 }))).json()).toMatchObject({ type: "invalid_since_year" });
    expect((await post(auto("effect of yoga on blood pressure", { sinceYear: "x" }), { signedIn: false })).res.status).toBe(400);
  });

  it("another request's refusals are as they were: a bad mode, scope and flag still answer with their own kind", async () => {
    expect((await post({ mode: "x", message: "yoga", sinceYear: 2025 })).json()).toMatchObject({ type: "invalid_mode" });
    expect((await post({ mode: "auto", message: "yoga", scope: "mars", sinceYear: 2025 })).json()).toMatchObject({ type: "invalid_scope" });
    expect((await post({ mode: "auto", message: "yoga", anyway: true, sinceYear: 2025 })).json()).toMatchObject({ type: "invalid_flag" });
  });
});

describe("applied like the router's year filter", () => {
  it("Auto, first message: the papers are cut by year BEFORE they are numbered, so the card number and the mark are the place in the list that is shown", async () => {
    const r = await run(auto("effect of yoga on blood pressure", { sinceYear: 2022 }));
    expect(r.finalPapers.map((p) => p.year)).toEqual([2022]);
    // [1] is the 2022 paper whatever its place in the unfiltered list (it was second there)
    expect(r.answer?.citations.map((c) => [c.n, c.paperId])).toEqual([[1, "doi:10.1000/glaucoma.2"]]);
    expect(r.answer?.grounded).toBe(true);
    expect(streamShapeProblems("chat", r.ev)).toEqual([]);
    // counted as any first answer is, not as a follow-up
    expect(r.outcomes).toEqual(["answered"]);
  });

  it("...and the evidence is picked from what is left: no paper that the filter took away is read by the writer or the judge", async () => {
    await run(auto("effect of yoga on blood pressure", { sinceYear: 2022 }));
    const writer = callsOf("writer").filter((c) => c.label === "chat_search");
    expect(writer).toHaveLength(1);
    expect(writer[0]!.user).toContain("Smartphone-based retinal imaging in rural clinics");
    for (const gone of ["Deep learning for glaucoma screening", "Cost of population screening", "A retracted study"]) expect(writer[0]!.user).not.toContain(gone);
    for (const j of callsOf("judge")) expect(j.user).not.toContain("Deep learning for glaucoma screening");
  });

  it("the lists sent while the sources answer are cut too (the first one that has any paper in it, and every later one)", async () => {
    const r = await run(auto("effect of yoga on blood pressure", { sinceYear: 2022 }));
    expect(r.lists.length).toBeGreaterThanOrEqual(2);
    for (const l of r.lists) expect(l.results.every((p) => (p.year ?? 0) >= 2022)).toBe(true);
  });

  it("a search chosen by hand stays searched as written (no router, no search words of a model, the words as typed) plus the filter", async () => {
    const r = await run(byHand("effect of yoga on blood pressure", { sinceYear: 2022 }));
    expect(r.understood).toMatchObject({ mode: "search", auto: false, how: "chosen", query: "effect of yoga on blood pressure" });
    expect(r.understood.searchQuery).toBeUndefined();
    expect(callsOf("router")).toHaveLength(0);
    expect(r.finalPapers.map((p) => p.year)).toEqual([2022]);
    expect(r.understood.context).toEqual({ turns: 0, intent: "new", rewrote: false, yearFrom: 2022 });
    // "searched as written" also for a text the rules would not call a search, which only `anyway` sends
    const odd = await run(byHand("hello there friend", { sinceYear: 2022, anyway: true }));
    expect(odd.understood).toMatchObject({ how: "chosen", query: "hello there friend" });
    expect(odd.finalPapers.map((p) => p.year)).toEqual([2022]);
  });

  it("in the Indian scope too: the scope is kept and the list is cut", async () => {
    const r = await run(byHand("glaucoma screening", { scope: "india", sinceYear: 2022 }));
    expect(r.understood).toMatchObject({ scope: "india" });
    expect(r.finalPapers.map((p) => p.year)).toEqual([2022]);
    expect(r.understood.context).toMatchObject({ yearFrom: 2022 });
  });

  it("a person who is not signed in gets the cut list and the sign-in line, as ever", async () => {
    const r = await run(auto("effect of yoga on blood pressure", { sinceYear: 2022 }), { signedIn: false });
    expect(r.finalPapers.map((p) => p.year)).toEqual([2022]);
    expect(r.done).toMatchObject({ answered: false, reason: "sign_in" });
    expect(calls).toHaveLength(0);
  });

  it("a day with no allowance left for a model reading the earlier turns: the words are searched as written and the filter still applies", async () => {
    const r = await run(auto("and in children?", { history: GLAUCOMA, sinceYear: 2022 }), { used: 60_000 });
    expect(r.done).toMatchObject({ answered: false, reason: "quota" });
    expect(r.finalPapers.map((p) => p.year)).toEqual([2022]);
    expect(r.understood.context).toMatchObject({ yearFrom: 2022 });
    expect(calls).toHaveLength(0);
  });

  it("says plainly, in the words and under the kind of the year filter, when the range leaves few papers and when it leaves none", async () => {
    const few = await run(auto("effect of yoga on blood pressure", { sinceYear: 2020 }));
    expect(few.finalPapers.map((p) => p.year)).toEqual([2021, 2022, 2020]);
    expect(few.notices.filter((n) => n.kind === "years")).toEqual([{ kind: "years", text: "Only 3 of the papers found are from 2020 or later, so this list is short. Remove the year filter to see more." }]);
    const none = await run(auto("effect of yoga on blood pressure", { sinceYear: 2026 }));
    expect(none.notices.find((n) => n.kind === "years")).toEqual({ kind: "years", text: "No paper from 2026 or later was found for this. Remove the year filter to see more." });
    expect(none.done).toMatchObject({ answered: false });
    expect(none.ev.some((e) => e.type === "token" || e.type === "answer")).toBe(false);
    // a search that found nothing at all is the ordinary line, not a year line
    const empty = await run(auto("nothing at all about glaucoma", { sinceYear: 2020 }));
    expect(empty.notices.map((n) => n.kind)).toEqual(["nothing"]);
  });

  it("a source that did not answer is still said, next to the year line", async () => {
    const r = await run(auto("partial glaucoma", { sinceYear: 2020 }));
    expect(r.notices.map((n) => n.kind)).toEqual(["partial", "years"]);
  });
});

describe("shown the way the year filter is shown: understood.context.yearFrom", () => {
  it("a first message carries a context with the year and nothing else (no question, no turns read, no earlier chats, no fallback)", async () => {
    const r = await run(auto("effect of yoga on blood pressure", { sinceYear: 2024 }));
    expect(r.understood.context).toEqual({ turns: 0, intent: "new", rewrote: false, yearFrom: 2024 });
    expect(callsOf("router")).toHaveLength(0); // the rules settled it: the filter did not make a model read anything
    expect(r.understood).toMatchObject({ how: "rules", query: "effect of yoga on blood pressure" });
    expect(r.understood.searchQuery).toBeUndefined();
  });

  it("the page's own reader makes the one year chip of it: followUpNote gives the range in words and no 'earlier question' line", async () => {
    const r = await run(auto("effect of yoga on blood pressure", { sinceYear: 2022 }));
    const m = r.ev.reduce<AssistantMsg>((acc, e) => applyChatEvent(acc, e), startAssistant("a1", "effect of yoga on blood pressure", 0, true));
    expect(followUpNote(m)).toEqual({ years: { from: 2022, words: "2022 or later" } });
  });

  it("no year is said when none was applied: small talk and another tool's offer say nothing of the filter", async () => {
    const talk = await run(auto("thanks a lot", { sinceYear: 2024 }));
    expect(talk.ev.map((e) => e.type)).toEqual(["understood", "general", "done"]);
    expect(talk.understood.context).toBeUndefined();
    const idea = await run(auto("now my idea about bees, is it novel", { sinceYear: 2024 }));
    expect(idea.understood).toMatchObject({ mode: "idea" });
    expect(idea.understood.context).toBeUndefined();
    expect(idea.ev.some((e) => e.type === "papers")).toBe(false);
  });

  it("with the switch for context off the filter is still applied and said (it is not context)", async () => {
    const r = await run(auto("effect of yoga on blood pressure", { sinceYear: 2022 }), { env: { CHAT_CONTEXT: "off" } });
    expect(r.finalPapers.map((p) => p.year)).toEqual([2022]);
    expect(r.understood.context).toEqual({ turns: 0, intent: "new", rewrote: false, yearFrom: 2022 });
  });

  it("with turns before it and a model's reading, the context keeps what the reading said (turns, intent, question) and the year is the larger of the two", async () => {
    // "only after 2020" is read as from 2020; the chip's 2022 is the larger: the filter is 2022 and the page says 2022
    const r = await run(auto("only after 2020", { history: GLAUCOMA, sinceYear: 2022 }));
    expect(r.understood.context).toEqual({ turns: 1, intent: "refine", rewrote: true, question: "glaucoma screening rural India only after 2020", yearFrom: 2022 });
    expect(r.finalPapers.map((p) => p.year)).toEqual([2022]);
    expect(r.notices.find((n) => n.kind === "years")?.text).toMatch(/^Only 1 of the papers found is from 2022 or later/);
    // the router's year is the larger one: 2022 asked for, the chip's 2021 is not what is applied
    const r2 = await run(auto("only after 2022", { history: GLAUCOMA, sinceYear: 2021 }));
    expect(r2.understood.context).toMatchObject({ yearFrom: 2022 });
    expect(r2.finalPapers.map((p) => p.year)).toEqual([2022]);
    // a router's year with no chip is as it was
    const r3 = await run(auto("only after 2022", { history: GLAUCOMA }));
    expect(r3.understood.context).toEqual({ turns: 1, intent: "refine", rewrote: true, question: "glaucoma screening rural India only after 2022", yearFrom: 2022 });
  });

  it("a follow-up whose reading could not be used still shows the chip: the page hides the whole of a context that fell back, and the filter must not be hidden with it", async () => {
    // without a chip such a reading says nothing (as ever)
    const plain = await run(auto("restatefail and in children", { history: GLAUCOMA }));
    expect(plain.understood.context).toEqual({ turns: 1, intent: "new", rewrote: false, fellBack: true });
    // with one, the words are still searched as written, the papers are still cut, and the year is said
    const r = await run(auto("restatefail and in children", { history: GLAUCOMA, sinceYear: 2022 }));
    expect(r.understood).toMatchObject({ how: "fallback", query: "restatefail and in children" });
    expect(r.understood.searchQuery).toBeUndefined();
    expect(r.understood.context).toEqual({ turns: 1, intent: "new", rewrote: false, yearFrom: 2022 });
    expect(r.finalPapers.map((p) => p.year)).toEqual([2022]);
    const m = r.ev.reduce<AssistantMsg>((acc, e) => applyChatEvent(acc, e), startAssistant("a1", "restatefail and in children", 0, true));
    expect(followUpNote(m)).toEqual({ years: { from: 2022, words: "2022 or later" } });
    // it is still counted as a reading that was not used
    expect(r.outcomes).toEqual(["followup_rewrite_failed"]);
  });

  it("the same value from both is that value; the router's upper end is kept as it is", async () => {
    const same = await run(auto("only after 2021", { history: GLAUCOMA, sinceYear: 2021 }));
    expect(same.understood.context).toMatchObject({ yearFrom: 2021 });
    expect(same.finalPapers.map((p) => p.year)).toEqual([2021, 2022]);
    // "in 2021" is a range from 2021 to 2021: a chip of 2020 does not widen it, one of 2021 leaves it
    const both = await run(auto("only in 2021", { history: GLAUCOMA, sinceYear: 2020 }));
    expect(both.understood.context).toMatchObject({ yearFrom: 2021, yearTo: 2021 });
    expect(both.finalPapers.map((p) => p.year)).toEqual([2021]);
  });

  it("a chip that starts after the router's own upper end cannot be met together with it: the person's words are the filter, the chip's year is dropped, and what the page shows is what was applied", async () => {
    const r = await run(auto("papers before 2021", { history: GLAUCOMA, sinceYear: 2025 }));
    expect(r.understood.context).toMatchObject({ yearTo: 2021 });
    expect(r.understood.context?.yearFrom).toBeUndefined();
    expect(r.finalPapers.map((p) => p.year)).toEqual([2021, 2019, 2018, 2020]);
  });

  it("a first message that the rules leave to a model (here a Hinglish one) is read as ever, with its search words, and the filter is the chip's", async () => {
    const r = await run(auto("kuch bhi", { sinceYear: 2022 }));
    expect(r.understood).toMatchObject({ how: "model", searchQuery: "translated: kuch bhi" });
    expect(r.understood.context).toEqual({ turns: 0, intent: "new", rewrote: false, yearFrom: 2022 });
    expect(r.finalPapers.map((p) => p.year)).toEqual([2022]);
  });

  it("carried by 'the same papers': what the page keeps of this reply (its context range) and sends with the next message makes 'explain that simpler' the same filtered papers", async () => {
    const first = await run(auto("glaucoma screening in rural India", { sinceYear: 2022 }));
    // the browser builds the reply as the events say, and `contextBefore` is what it sends next
    const built = first.ev.reduce<AssistantMsg>((acc, e) => applyChatEvent(acc, e), startAssistant("a1", "glaucoma screening in rural India", 1, true));
    const reply: AssistantMsg = { ...built, searchQuery: "glaucoma screening rural India" };
    const history = contextBefore([{ id: "u1", role: "user", text: "glaucoma screening in rural India", at: 0 }, reply], 2);
    expect(history.at(-1)).toMatchObject({ role: "assistant", yearFrom: 2022 });
    // the next message carries no `sinceYear` of its own: the chip belongs to the first message
    const next = await run(auto("explain that simpler", { history }));
    expect(next.understood.context).toMatchObject({ intent: "same_papers", yearFrom: 2022 });
    expect(next.finalPapers.map((p) => p.year)).toEqual([2022]);
  });

  it("with the same papers asked again AND a chip: the larger of the carried range and the chip", async () => {
    const history = [u("glaucoma screening"), a({ searchQuery: "glaucoma screening", yearFrom: 2020, text: "Screening works [1]." })];
    const r = await run(auto("explain that simpler", { history, sinceYear: 2022 }));
    expect(r.understood.context).toMatchObject({ intent: "same_papers", yearFrom: 2022 });
    expect(r.finalPapers.map((p) => p.year)).toEqual([2022]);
  });
});

describe("what a model is given, and what is written down", () => {
  it("the year is a filter and not words: it is in no call of a model, in the writer's question or in a log; the judge reads the answer's claims and the abstracts, as ever", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    try {
      await run(auto("effect of yoga CANARY-WORDS on blood pressure", { sinceYear: 2022 }));
      await run(auto("only after 2020 CANARY-WORDS", { history: GLAUCOMA, sinceYear: 2022 }));
      expect(calls.length).toBeGreaterThan(2);
      for (const c of calls) expect(`${c.system}\n${c.user}`, c.who).not.toMatch(/sinceYear|since_year|since year/i);
      for (const w of callsOf("writer").filter((c) => c.label === "chat_search")) expect(w.user.split("\n")[0]).not.toMatch(/2022/);
      for (const j of callsOf("judge")) expect(`${j.system}\n${j.user}`).not.toMatch(/CANARY|Question:|conversation/);
      const logged = spies.flatMap((s) => s.mock.calls.map((c) => c.map(String).join(" "))).join("\n");
      expect(logged).not.toMatch(/sinceYear|CANARY|yoga/i);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });

  it("the judge, the strict check and the development judge do not so much as name it", () => {
    const src = readFileSync(fileURLToPath(new URL("./routes.ts", import.meta.url)), "utf8");
    const handlers = src.split("chatRoutes.post(").slice(1);
    const named = (path: string) => handlers.find((h) => h.startsWith(`"${path}"`)) ?? "";
    for (const path of ["/tighten", "/judge", "/route"]) {
      expect(named(path).length).toBeGreaterThan(200);
      expect(named(path)).not.toMatch(/sinceYear|since_year/i);
    }
  });

  it("the strict check ignores a sinceYear that is sent to it", async () => {
    const good = { text: "The first paper reports its main result and also claims a cure [1].", papers: [{ n: 1, title: "Deep learning for glaucoma screening", year: 2021, abstract: "We trained a convolutional network on 12,000 fundus photographs to detect glaucoma. The model reached an AUC of 0.94 on a held-out set. Performance was lower for images with cataract." }], citations: [{ n: 1, sentenceNo: 2 }] };
    const r = await post({ ...good, sinceYear: 2022 }, { path: "/tighten" });
    expect(r.res.status).toBe(200);
    for (const c of calls) expect(`${c.system}${c.user}`).not.toMatch(/sinceYear/);
  });
});

/* ---------------------------------------------------------------- the differential check */

/**
 * A request that says nothing of `sinceYear` is answered exactly as before the field existed. `since-year.golden.json` was written ONCE, from the code of the commit before this change (its
 * `producedFrom` says which), by running these requests through the route with the stand-in network and model: for each one, the status, the order of the events and a SHA-256 of the whole
 * stream as it went over the wire (only the time it took, which is not repeatable, is set to 0; `wire` below is what was run, and it has no way to write the file: a change that is meant to alter what a
 * first message gets must say so by re-recording it by hand from the code it replaces). Every request here is compared with that, byte for byte. The requests are not chosen to be about years:
 * they are the ways a message ends (answered, nothing found, a source down, not grounded, judged, small talk, another tool, the Indian scope, a follow-up, a refusal).
 */
type Case = { name: string; body: unknown; opts?: Opts };
const DIFF: Case[] = [
  { name: "auto, a plain question", body: auto("effect of yoga on blood pressure") },
  { name: "auto, nothing found", body: auto("nothing at all about glaucoma") },
  { name: "auto, a source down", body: auto("partial glaucoma screening") },
  { name: "auto, the papers do not answer", body: auto("unanswerable glaucoma question") },
  { name: "auto, a made-up citation", body: auto("hallucinate glaucoma") },
  { name: "auto, the judge drops a claim", body: auto("judgedrop glaucoma") },
  { name: "auto, a long abstract", body: auto("longabstract glaucoma") },
  { name: "auto, the open-access papers", body: auto("oapapers glaucoma") },
  { name: "auto, a message the rules leave to the model", body: auto("kuch bhi") },
  { name: "auto, small talk", body: auto("thanks a lot") },
  { name: "auto, another tool", body: auto("now my idea about bees, is it novel") },
  { name: "auto, Indian scope", body: auto("glaucoma screening", { scope: "india" }) },
  { name: "auto, not signed in", body: auto("effect of yoga on blood pressure"), opts: { signedIn: false } },
  { name: "auto, a message of 409 characters", body: auto(`glaucoma ${"screening ".repeat(40)}`) },
  { name: "auto, a message of 360 characters", body: auto("effect of yoga on blood pressure in adults ".repeat(8)) },
  { name: "search by hand", body: byHand("glaucoma screening") },
  { name: "search by hand, anyway", body: byHand("hello there friend", { anyway: true }) },
  { name: "search by hand, Indian scope", body: byHand("glaucoma screening", { scope: "india" }) },
  { name: "search by hand, nothing found", body: byHand("nothing about glaucoma") },
  { name: "follow-up, only after 2022", body: auto("only after 2022", { history: GLAUCOMA }) },
  { name: "follow-up, only after 2020 (a short list)", body: auto("only after 2020", { history: GLAUCOMA }) },
  { name: "follow-up, the same papers", body: auto("explain that simpler", { history: GLAUCOMA }) },
  { name: "follow-up, the same papers with the reply's range", body: auto("explain that simpler", { history: [u("glaucoma screening"), a({ searchQuery: "glaucoma screening", yearFrom: 2022, text: "Screening works [1]." })] }) },
  { name: "follow-up, a new topic", body: auto("newtopic CRISPR effects", { history: GLAUCOMA }) },
  { name: "follow-up, a message that stands alone", body: auto("effect of yoga on blood pressure", { history: GLAUCOMA }) },
  { name: "follow-up, earlier chats", body: auto("and in children?", { earlier: [{ question: "yoga and blood pressure", searchQuery: "yoga blood pressure" }] }) },
  { name: "follow-up, the switch is off", body: auto("only after 2020", { history: GLAUCOMA }), opts: { env: { CHAT_CONTEXT: "off" } } },
  { name: "follow-up, the day is used", body: auto("and in children?", { history: GLAUCOMA }), opts: { used: 60_000 } },
  { name: "follow-up, not signed in", body: auto("only after 2020", { history: GLAUCOMA }), opts: { signedIn: false } },
  { name: "refused, a bad mode", body: { mode: "x", message: "yoga" } },
  { name: "refused, a bad scope", body: auto("yoga", { scope: "mars" }) },
  { name: "refused, a flag with Auto", body: auto("yoga", { anyway: true }) },
  { name: "refused, a bad history", body: auto("only after 2020", { history: [{ role: "system", text: "x" }] }) },
  { name: "refused, history with a search by hand", body: byHand("glaucoma screening", { history: GLAUCOMA }) },
  { name: "refused, a message that is too short", body: byHand("x") },
  { name: "refused, a body that is not JSON", body: "not json" },
  { name: "the judge switch is off", body: auto("effect of yoga on blood pressure"), opts: { env: { CHAT_JUDGE: "off" } } },
  // R4 (docs/design/intent-and-state.md, 4.5): messages of the safety lane, added to the list on 4 Nov 2026 and recorded by hand from the code BEFORE the lane existed (`producedFrom` in the golden says which
  // commit). With CHAT_SAFETY unset, off or shadow they are answered as they always were (a search, small talk, an offer of Idea Check); with `core` or `on` they are the lane's own and are tested in
  // lane-route.test.ts, so the 37 requests above are the ones that must not move in any position.
  { name: "safety, an urgent symptom", body: auto("my father has chest pain and his left arm hurts right now") },
  { name: "safety, someone else in danger", body: auto("my friend collapsed and is not breathing, what do I do") },
  { name: "safety, self-harm", body: auto("I want to kill myself") },
  { name: "safety, the word suicidal", body: auto("I am suicidal") },
  { name: "safety, help me", body: auto("help me") },
  { name: "safety, a bare help", body: auto("help") },
  { name: "safety, I need help", body: auto("I need help") },
  { name: "safety, a long distress message", body: auto("I have not been able to sleep properly for weeks now. Work is piling up, my parents keep asking when I will settle down, and my friends have stopped calling because I never reply. I wake up every day tired before anything has even started. I used to enjoy cooking and going for walks but now it all feels pointless. Last night I sat on the balcony for hours thinking about everything I have done wrong. I cannot go on like this any more and I want to die") },
  { name: "safety, Hinglish urgent", body: auto("papa ko seene mein dard ho raha hai abhi aur saans nahi aa rahi") },
  { name: "safety, Hindi self-harm", body: auto("मैं मरना चाहता हूँ") },
  { name: "safety, a medicine decision", body: auto("I take amlodipine for my blood pressure, can I also take ibuprofen for knee pain") },
  { name: "safety, a health story with a question", body: auto("I am 10 weeks pregnant and drink three cups of coffee a day, is there any research on caffeine and miscarriage") },
  { name: "safety, a research topic on suicide", body: auto("suicide prevention programmes for farmers in India") },
  { name: "safety, urgent, not signed in", body: auto("my father has chest pain and his left arm hurts right now"), opts: { signedIn: false } },
  { name: "safety, self-harm, chosen by hand", body: byHand("I want to kill myself") },
  { name: "safety, help me, anyway", body: byHand("help me", { anyway: true }) },
  { name: "safety, self-harm, with turns before it", body: auto("I want to kill myself", { history: GLAUCOMA }) },
  // R8 (docs/design/intent-and-state.md, 4.8): messages of the request-frame cleaner (clean-cases.ts), added to the list on 4 Nov 2026 and recorded by hand from the code BEFORE the cleaner existed (`alsoProducedFromR8`
  // in the golden says which commit). With CHAT_CLEAN unset, off or shadow every one of them is answered as it always was; with CHAT_CLEAN on, the ones the cleaner changes are pinned in since-year.clean.golden.json.
  ...CLEAN_CASES,
];

const GOLDEN = fileURLToPath(new URL("./since-year.golden.json", import.meta.url));
type Golden = { producedFrom: string; entries: { name: string; status: number; types: string[]; end: string; bytes: number; sha256: string }[] };

/** What one request came to on the wire, with the time it took set to 0. */
async function wire(c: Case) {
  const { res, text } = await post(c.body, c.opts);
  const normal = text.replace(/"tookMs":\d+/g, '"tookMs":0');
  const types = res.headers.get("content-type")?.includes("event-stream") ? eventsOf(normal).map((e) => e.type) : [`json:${String((JSON.parse(normal) as { type?: unknown }).type)}`];
  const last = eventsOf(normal).at(-1) as { type?: string; answered?: boolean; reason?: string } | undefined;
  const end = last?.type === "done" ? `done:${last.answered ? "answered" : "no"}:${last.reason ?? ""}` : (last?.type ?? "refused");
  const bytes = new TextEncoder().encode(normal);
  const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { name: c.name, status: res.status, types, end, bytes: bytes.length, sha256 };
}

describe("a request without sinceYear is answered exactly as before the field existed", () => {
  it("every one of the requests (a stream's every event, in its order, byte for byte; a refusal's body) is what the code before this change gave", async () => {
    const now = await Promise.all(DIFF.map((c) => wire(c)));
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Golden;
    expect(golden.entries.map((e) => e.name)).toEqual(DIFF.map((c) => c.name));
    const changed = now.filter((n, i) => JSON.stringify(n) !== JSON.stringify(golden.entries[i])).map((n) => n.name);
    expect(changed).toEqual([]);
    // the list is real: streams of every kind and refusals
    expect(golden.entries.filter((e) => e.status === 200).length).toBeGreaterThanOrEqual(28);
    expect(golden.entries.filter((e) => e.status === 400).length).toBeGreaterThanOrEqual(6);
    expect(golden.entries.some((e) => e.types.includes("answer"))).toBe(true);
    expect(golden.entries.some((e) => e.types.includes("notice"))).toBe(true);
  });

  it("an explicit `sinceYear: undefined` is the key not being there (JSON leaves it out), and the same answer comes back", async () => {
    const plain = await wire({ name: "x", body: auto("effect of yoga on blood pressure") });
    const undef = await wire({ name: "x", body: auto("effect of yoga on blood pressure", { sinceYear: undefined }) });
    expect(undef).toEqual(plain);
  });
});

/**
 * The gate flags of the understanding releases (docs/design/intent-and-state.md, 4.0 and E5): in every position, the stream of every request of the list above is the golden's, byte for byte.
 * `CHAT_COUNTERS` (R3) only counts, so even `on` changes nothing on the wire; `CHAT_FAILPOLICY` (R5) acts only on a follow-up whose router call FAILED, and no request of the list has one (the stand-in
 * router fails on the word "boom", which none of them holds), so `shadow` and `on` change nothing here either. The two cases that do meet it are in failpolicy.test.ts, with their own expectations.
 * `CHAT_SAFETY` (R4) has four positions. Unset, `off` and `shadow` change nothing on the wire for ANY request of the list, the 17 messages of the safety lane included (shadow only reads and, with CHAT_COUNTERS
 * on, counts); `core` and `on` act on those 17 (lane-route.test.ts looks at what they do) and must leave the 37 requests that are not about safety exactly as the golden has them.
 */
describe("the gate flags leave the stream of every request of the list as the golden has it, in every position", () => {
  const POSITIONS: Record<string, Record<string, string>>[] = [
    { "CHAT_COUNTERS=off": { CHAT_COUNTERS: "off" } },
    { "CHAT_COUNTERS=shadow": { CHAT_COUNTERS: "shadow" } },
    { "CHAT_COUNTERS=on": { CHAT_COUNTERS: "on" } },
    { "CHAT_FAILPOLICY=off": { CHAT_FAILPOLICY: "off" } },
    { "CHAT_FAILPOLICY=shadow": { CHAT_FAILPOLICY: "shadow" } },
    { "CHAT_FAILPOLICY=on": { CHAT_FAILPOLICY: "on" } },
    { "both shadow": { CHAT_COUNTERS: "shadow", CHAT_FAILPOLICY: "shadow" } },
    { "both on": { CHAT_COUNTERS: "on", CHAT_FAILPOLICY: "on" } },
    { "CHAT_SAFETY=off": { CHAT_SAFETY: "off" } },
    { "CHAT_SAFETY=shadow": { CHAT_SAFETY: "shadow" } },
    { "CHAT_SAFETY=shadow with the counters on": { CHAT_SAFETY: "shadow", CHAT_COUNTERS: "on" } },
    { "every flag shadow": { CHAT_COUNTERS: "shadow", CHAT_FAILPOLICY: "shadow", CHAT_SAFETY: "shadow" } },
    { "a value that is not a position": { CHAT_SAFETY: "ON" } },
    // R8 (4.8): off and shadow change nothing on the wire for ANY request of the list, the cleaner's own messages included (shadow only makes the Reading and, with CHAT_COUNTERS on, counts it)
    { "CHAT_CLEAN=off": { CHAT_CLEAN: "off" } },
    { "CHAT_CLEAN=shadow": { CHAT_CLEAN: "shadow" } },
    { "CHAT_CLEAN=shadow with the counters on": { CHAT_CLEAN: "shadow", CHAT_COUNTERS: "on" } },
    { "CHAT_CLEAN=shadow with the lane in shadow and the counters on": { CHAT_CLEAN: "shadow", CHAT_SAFETY: "shadow", CHAT_COUNTERS: "on" } },
    { "a value of CHAT_CLEAN that is not a position": { CHAT_CLEAN: "ON" } },
    { "every gate flag shadow, the cleaner too": { CHAT_COUNTERS: "shadow", CHAT_FAILPOLICY: "shadow", CHAT_SAFETY: "shadow", CHAT_CLEAN: "shadow" } },
    // R9 (4.9): off and shadow change nothing on the wire for ANY request of the list (shadow only reads the list against the words and, with CHAT_COUNTERS on, counts what it would have done); "writer" and "on" are tested below
    { "CHAT_FLOOR=off": { CHAT_FLOOR: "off" } },
    { "CHAT_FLOOR=shadow": { CHAT_FLOOR: "shadow" } },
    { "CHAT_FLOOR=shadow with the counters on": { CHAT_FLOOR: "shadow", CHAT_COUNTERS: "on" } },
    { "CHAT_FLOOR=shadow with the cleaner in shadow and the counters on": { CHAT_FLOOR: "shadow", CHAT_CLEAN: "shadow", CHAT_COUNTERS: "on" } },
    { "a value of CHAT_FLOOR that is not a position": { CHAT_FLOOR: "ON" } },
    { "core is not a position of the floor": { CHAT_FLOOR: "core" } },
    { "every gate flag shadow, the floor too": { CHAT_COUNTERS: "shadow", CHAT_FAILPOLICY: "shadow", CHAT_SAFETY: "shadow", CHAT_CLEAN: "shadow", CHAT_FLOOR: "shadow" } },
  ];
  it("holds for all of them", async () => {
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Golden;
    const runs = POSITIONS.flatMap((p) => Object.entries(p).map(([label, flags]) => ({ label, flags })));
    const results = await Promise.all(runs.map(async ({ label, flags }) => ({ label, now: await Promise.all(DIFF.map((c) => wire({ ...c, opts: { ...c.opts, env: { ...c.opts?.env, ...flags } } }))) })));
    for (const { label, now } of results) {
      const changed = now.filter((n, i) => JSON.stringify(n) !== JSON.stringify(golden.entries[i])).map((n) => n.name);
      expect(changed, label).toEqual([]);
    }
  }, 300_000);

  it("CHAT_SAFETY=core and =on leave the 37 requests that are not about safety, and the cleaner's own messages (CHAT_CLEAN is not set), as the golden has them (the 17 of the lane are its own, and are looked at in lane-route.test.ts)", async () => {
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Golden;
    const others = DIFF.filter((c) => !c.name.startsWith("safety, "));
    expect(others).toHaveLength(37 + CLEAN_CASES.length);
    const flagSets: Record<string, string>[] = [{ CHAT_SAFETY: "core" }, { CHAT_SAFETY: "on" }, { CHAT_SAFETY: "on", CHAT_COUNTERS: "on", CHAT_FAILPOLICY: "on" }, { CHAT_SAFETY: "on", CHAT_CLEAN: "shadow", CHAT_COUNTERS: "on" }];
    for (const flags of flagSets) {
      const now = await Promise.all(others.map((c) => wire({ ...c, opts: { ...c.opts, env: { ...c.opts?.env, ...flags } } })));
      const changed = now.filter((n) => JSON.stringify(n) !== JSON.stringify(golden.entries.find((e) => e.name === n.name))).map((n) => n.name);
      expect(changed, JSON.stringify(flags)).toEqual([]);
    }
  }, 120_000);

  it("and the lane's 17 messages DO change in core and on (the check above is not vacuous): the ones that are read as a reply or get a line", async () => {
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Golden;
    const own = DIFF.filter((c) => c.name.startsWith("safety, "));
    const now = await Promise.all(own.map((c) => wire({ ...c, opts: { ...c.opts, env: { ...c.opts?.env, CHAT_SAFETY: "on" } } })));
    const changed = now.filter((n) => JSON.stringify(n) !== JSON.stringify(golden.entries.find((e) => e.name === n.name))).map((n) => n.name);
    expect(changed.length).toBeGreaterThanOrEqual(12);
    expect(changed).toContain("safety, self-harm");
    expect(changed).toContain("safety, help me");
    // a bare "help" is still small talk's, and a topic on suicide is still a search
    expect(changed).not.toContain("safety, a bare help");
    expect(changed).not.toContain("safety, a research topic on suicide");
  }, 120_000);

  it("the counters, when on, do write for the requests of the list that are first messages in Auto (the test is not vacuous)", async () => {
    const { outcomes } = await post(auto("effect of yoga on blood pressure"), { env: { CHAT_COUNTERS: "on" } });
    expect(outcomes.filter((o) => o.startsWith("batch:chat_input:")).length).toBeGreaterThan(0);
  });
});

/**
 * R8, CHAT_CLEAN=on (docs/design/intent-and-state.md, 4.8): the stream changes ONLY for a message the cleaner changes. Every request of the list (the 54 of before and the 23 of clean-cases.ts) is run with the flag on:
 * those the cleaner changes must be EXACTLY the ones pinned in since-year.clean.golden.json (a stream's every event, in its order, byte for byte), and every other request must be byte-identical to
 * since-year.golden.json. The pinned file was recorded by hand from the code of this release (it has no earlier code to come from: the streams are new); what each of them says is looked at in
 * clean-route.test.ts, so the hashes are not the only thing that holds them.
 */
const CLEAN_GOLDEN = fileURLToPath(new URL("./since-year.clean.golden.json", import.meta.url));
describe("CHAT_CLEAN=on changes the stream only of the messages the cleaner changes", () => {
  const withFlag = (c: Case, flags: Record<string, string>): Case => ({ ...c, opts: { ...c.opts, env: { ...c.opts?.env, ...flags } } });

  it("exactly the pinned requests change, each to its pinned stream, and every other request is the base golden's", async () => {
    const base = JSON.parse(readFileSync(GOLDEN, "utf8")) as Golden;
    const pinned = JSON.parse(readFileSync(CLEAN_GOLDEN, "utf8")) as Golden;
    const now = await Promise.all(DIFF.map((c) => wire(withFlag(c, { CHAT_CLEAN: "on" }))));
    const changed = now.filter((n) => JSON.stringify(n) !== JSON.stringify(base.entries.find((e) => e.name === n.name))).map((n) => n.name);
    expect(changed).toEqual(pinned.entries.map((e) => e.name));
    for (const p of pinned.entries) expect(now.find((n) => n.name === p.name), p.name).toEqual(p);
    // and the others, one by one, are the base golden's
    const others = now.filter((n) => !changed.includes(n.name));
    expect(others.length).toBe(DIFF.length - pinned.entries.length);
    for (const n of others) expect(n, n.name).toEqual(base.entries.find((e) => e.name === n.name));
  }, 180_000);

  it("the check is not vacuous, and the messages that must not change are among those that do not: by hand, anyway, Hinglish, a typo message, a hyphenated word, a title in quotes, only a frame, a follow-up that leans on the turns, all 17 of the lane", async () => {
    const pinned = JSON.parse(readFileSync(CLEAN_GOLDEN, "utf8")) as Golden;
    const names = pinned.entries.map((e) => e.name);
    expect(names).toContain("clean, the owner's message");
    expect(names.length).toBeGreaterThanOrEqual(12);
    for (const keep of ["clean, the owner's message, chosen by hand", "clean, a typo message with no frame", "clean, a hyphenated word that looks like a frame", "clean, a title in quotes", "clean, nothing but a frame", "clean, a Hinglish message", "clean, a follow-up that leans on the turns", "search by hand", "search by hand, anyway", "auto, a plain question", "auto, small talk", "auto, another tool", "follow-up, only after 2020 (a short list)", "auto, a message the rules leave to the model"]) {
      expect(names, keep).not.toContain(keep);
    }
    expect(names.filter((n) => n.startsWith("safety, "))).toEqual([]);
  });

  it("the lane's flag at on does not change what the cleaner does to these messages, and the cleaner does not change what the lane does to the lane's own (a signed-in person's words are the model's)", async () => {
    const lane = DIFF.filter((c) => c.name.startsWith("safety, "));
    const clean = DIFF.filter((c) => c.name.startsWith("clean, "));
    const laneOn = await Promise.all(lane.map((c) => wire(withFlag(c, { CHAT_SAFETY: "on" }))));
    const both = await Promise.all(lane.map((c) => wire(withFlag(c, { CHAT_SAFETY: "on", CHAT_CLEAN: "on" }))));
    expect(both.filter((b, i) => JSON.stringify(b) !== JSON.stringify(laneOn[i])).map((b) => b.name)).toEqual([]);
    const cleanOn = await Promise.all(clean.map((c) => wire(withFlag(c, { CHAT_CLEAN: "on" }))));
    const cleanAndLane = await Promise.all(clean.map((c) => wire(withFlag(c, { CHAT_CLEAN: "on", CHAT_SAFETY: "on" }))));
    expect(cleanAndLane.filter((b, i) => JSON.stringify(b) !== JSON.stringify(cleanOn[i])).map((b) => b.name)).toEqual([]);
  }, 180_000);

  it("shadow with the counters on writes its count and still changes nothing, for every request of the list", async () => {
    const base = JSON.parse(readFileSync(GOLDEN, "utf8")) as Golden;
    const now = await Promise.all(DIFF.map((c) => wire(withFlag(c, { CHAT_CLEAN: "shadow", CHAT_COUNTERS: "on" }))));
    expect(now.filter((n) => JSON.stringify(n) !== JSON.stringify(base.entries.find((e) => e.name === n.name))).map((n) => n.name)).toEqual([]);
    const { outcomes } = await post(auto("Can you search about convoluton nueral netwrk all papers"), { env: { CHAT_CLEAN: "shadow", CHAT_COUNTERS: "on" } });
    expect(outcomes.some((o) => o.endsWith(":would_clean"))).toBe(true);
  }, 180_000);
});

/**
 * R9, CHAT_FLOOR=writer and =on (docs/design/intent-and-state.md, 4.9): the stream changes ONLY for a request whose list the floor acts on. Every request of the list is run in each position: those that change must be EXACTLY
 * the ones pinned in since-year.floor.golden.json (a stream's every event, in its order, byte for byte), and every other request must be what the same flags WITHOUT the floor give (the base golden, or for the cleaner's own
 * requests with CHAT_CLEAN on, the clean golden). The pinned file was recorded by hand from the code of this release (its streams are new: there is no earlier code to record them from); what each of them says is looked at in
 * routes-tiers.test.ts, so the hashes are not the only thing that holds them. The stand-in search gives the same five glaucoma records for any words, so a request is changed when its words are not about glaucoma (no strong
 * paper: the writer is not asked) or are (one or two strong papers: a line, and in `on` another order).
 */
const FLOOR_GOLDEN = fileURLToPath(new URL("./since-year.floor.golden.json", import.meta.url));
type FloorPosition = "writer" | "on" | "on with the cleaner";
type FloorGolden = { producedFrom: string; positions: Record<FloorPosition, Golden["entries"]> };
describe("CHAT_FLOOR=writer and =on change the stream only of the requests whose list the floor acts on", () => {
  const withFlag = (c: Case, flags: Record<string, string>): Case => ({ ...c, opts: { ...c.opts, env: { ...c.opts?.env, ...flags } } });
  const POSITIONS: Record<FloorPosition, { flags: Record<string, string>; reference: "base" | "clean" }> = {
    writer: { flags: { CHAT_FLOOR: "writer" }, reference: "base" },
    on: { flags: { CHAT_FLOOR: "on" }, reference: "base" },
    "on with the cleaner": { flags: { CHAT_FLOOR: "on", CHAT_CLEAN: "on" }, reference: "clean" },
  };

  for (const position of Object.keys(POSITIONS) as FloorPosition[]) {
    const { flags, reference } = POSITIONS[position];
    it(`${position}: exactly the pinned requests change, each to its pinned stream, and every other request is what it is without the floor`, async () => {
      const base = JSON.parse(readFileSync(GOLDEN, "utf8")) as Golden;
      const clean = JSON.parse(readFileSync(CLEAN_GOLDEN, "utf8")) as Golden;
      const pinned = (JSON.parse(readFileSync(FLOOR_GOLDEN, "utf8")) as FloorGolden).positions[position];
      const without = (name: string) => (reference === "clean" ? clean.entries.find((e) => e.name === name) : undefined) ?? base.entries.find((e) => e.name === name);
      const now = await Promise.all(DIFF.map((c) => wire(withFlag(c, flags))));
      const changed = now.filter((n) => JSON.stringify(n) !== JSON.stringify(without(n.name))).map((n) => n.name);
      expect(changed).toEqual(pinned.map((e) => e.name));
      for (const p of pinned) expect(now.find((n) => n.name === p.name), p.name).toEqual(p);
      for (const n of now.filter((x) => !changed.includes(x.name))) expect(n, n.name).toEqual(without(n.name));
    }, 300_000);
  }

  it("the check is not vacuous, and the requests the floor must not touch are not among those that change: a search chosen by hand, small talk, another tool, nothing found, a refusal", () => {
    const floor = JSON.parse(readFileSync(FLOOR_GOLDEN, "utf8")) as FloorGolden;
    for (const position of Object.keys(floor.positions) as FloorPosition[]) {
      const names = floor.positions[position].map((e) => e.name);
      expect(names.length, position).toBeGreaterThanOrEqual(6);
      expect(names, position).toContain("auto, a plain question");
      for (const keep of ["search by hand", "search by hand, anyway", "search by hand, Indian scope", "search by hand, nothing found", "auto, small talk", "auto, another tool", "auto, nothing found", "refused, a bad mode", "refused, a body that is not JSON", "clean, the owner's message, chosen by hand"]) {
        expect(names, `${position}: ${keep}`).not.toContain(keep);
      }
    }
    // with the cleaner on, the owner's message is among the requests that change: its words are three, and no paper of the stand-in's list is about them
    expect(floor.positions["on with the cleaner"].map((e) => e.name)).toContain("clean, the owner's message");
    // without it his message has eight content stems and is not judged
    expect(floor.positions.on.map((e) => e.name)).not.toContain("clean, the owner's message");
  });

  it("shadow with the counters on writes its count and still changes nothing, for every request of the list", async () => {
    const base = JSON.parse(readFileSync(GOLDEN, "utf8")) as Golden;
    const now = await Promise.all(DIFF.map((c) => wire(withFlag(c, { CHAT_FLOOR: "shadow", CHAT_COUNTERS: "on" }))));
    expect(now.filter((n) => JSON.stringify(n) !== JSON.stringify(base.entries.find((e) => e.name === n.name))).map((n) => n.name)).toEqual([]);
    const { outcomes } = await post(auto("effect of yoga on blood pressure"), { env: { CHAT_FLOOR: "shadow", CHAT_COUNTERS: "on" } });
    expect(outcomes.some((o) => o.endsWith(":would_tier_none"))).toBe(true);
  }, 300_000);
});

/**
 * M1 (6 Nov 2026, design PDF "Sodhsetu understanding, follow-ups and MCP"): the earlier-chats feature was removed, and a tab opened before that may still send `earlier`. It is ignored unread: the request
 * of the list that carries it is answered byte for byte as the same message without it, in every position of the flags.
 */
describe("`earlier` from an old tab is ignored, not read and not refused", () => {
  it("the request that carries it streams exactly what the same message without it streams", async () => {
    const c = DIFF.find((x) => x.name === "follow-up, earlier chats")!;
    expect(JSON.stringify(c.body)).toContain("earlier");
    for (const env of [{}, { CHAT_CLEAN: "on" }, { CHAT_FLOOR: "on" }, { CHAT_FLOOR: "writer", CHAT_COUNTERS: "on" }] as Record<string, string>[]) {
      const withIt = await wire({ ...c, opts: { ...c.opts, env: { ...c.opts?.env, ...env } } });
      const without = await wire({ ...c, body: { mode: "auto", message: "and in children?" }, opts: { ...c.opts, env: { ...c.opts?.env, ...env } } });
      expect({ ...withIt, name: "" }, JSON.stringify(env)).toEqual({ ...without, name: "" });
    }
  }, 120_000);
});

/**
 * M2 (design PDF "Sodhsetu understanding, follow-ups and MCP", "Thinking dikhana"): CHAT_THINK. Unset, "off" and any other value send no `think` event, and every request of the list streams the golden, byte for byte
 * (the tests above run with it unset; here it is set to "off", "shadow" and a typo). With "on" the lines are ADDED and nothing else changes: the stream with every `think` block taken out is the stream without the
 * flag, byte for byte, for every request of the list, with the cleaner and the floor too. Every line is honest (each number in its text is one of its counts), says only what happened (a reading line only where the
 * reader ran, a checked line only where an answer was checked), and the lines of each request are pinned in since-year.think.golden.json (recorded by hand from this release: they are new).
 */
const THINK_GOLDEN = fileURLToPath(new URL("./since-year.think.golden.json", import.meta.url));
describe("CHAT_THINK: the Thinking block's lines", () => {
  const withFlag = (c: Case, flags: Record<string, string>): Case => ({ ...c, opts: { ...c.opts, env: { ...c.opts?.env, ...flags } } });
  const blocks = (text: string) => text.replace(/"tookMs":\d+/g, '"tookMs":0').split("\n\n");
  const isThink = (block: string) => block.split("\n").some((l) => l.startsWith("data:") && (JSON.parse(l.slice(5)) as { type?: string }).type === "think");
  const withoutThink = (text: string) => blocks(text).filter((b) => !isThink(b)).join("\n\n");
  const thinkOf = (text: string) => eventsOf(text).filter((e): e is Extract<ChatEvent, { type: "think" }> => e.type === "think");

  it("off, shadow and a value that is not a position send nothing: the golden, byte for byte", async () => {
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8")) as Golden;
    for (const value of ["off", "shadow", "On", "true"]) {
      const now = await Promise.all(DIFF.map((c) => wire(withFlag(c, { CHAT_THINK: value }))));
      expect(now.filter((n, i) => JSON.stringify(n) !== JSON.stringify(golden.entries[i])).map((n) => n.name), value).toEqual([]);
    }
  }, 300_000);

  for (const [label, flags] of [["alone", {}], ["with the cleaner on", { CHAT_CLEAN: "on" }], ["with the floor on", { CHAT_FLOOR: "on" }], ["with the counters on", { CHAT_COUNTERS: "on" }]] as [string, Record<string, string>][]) {
    it(`on, ${label}: the lines are only added: without them every stream is the one without the flag, byte for byte`, async () => {
      for (const c of DIFF) {
        const off = await post(c.body, withFlag(c, flags).opts);
        const on = await post(c.body, withFlag(c, { ...flags, CHAT_THINK: "on" }).opts);
        expect(on.res.status, c.name).toBe(off.res.status);
        expect(withoutThink(on.text), c.name).toBe(blocks(off.text).join("\n\n"));
        if (label === "with the counters on") expect(on.outcomes, c.name).toEqual(off.outcomes);
      }
    }, 300_000);
  }

  it("every line of every request is honest, says only what happened, and comes where its stage is", async () => {
    let lines = 0;
    for (const c of DIFF) {
      for (const flags of [{}, { CHAT_CLEAN: "on" }, { CHAT_FLOOR: "on" }] as Record<string, string>[]) {
        const { text } = await post(c.body, withFlag(c, { ...flags, CHAT_THINK: "on" }).opts);
        const ev = eventsOf(text);
        const think = thinkOf(text);
        lines += think.length;
        for (const t of think) {
          expect(THINK_KINDS, c.name).toContain(t.kind);
          expect(thinkIsHonest(t), `${c.name}: ${t.text} ${JSON.stringify(t.counts)}`).toBe(true);
          for (const a of t.actions ?? []) expect(["change", "exact_words"], c.name).toContain(a);
          if (t.kind !== "understood") expect(t.actions ?? [], c.name).toEqual([]);
        }
        const at = (pred: (e: ChatEvent) => boolean) => ev.findIndex(pred);
        const stepAt = (s: string) => at((e) => e.type === "step" && e.step === s);
        // "reading" only where the reader ran, after its step; "writing" only after the writer's or the background's step; "checked" only for a checked answer, after it
        const reading = at((e) => e.type === "think" && e.kind === "reading");
        expect(reading >= 0, c.name).toBe(stepAt("read") >= 0);
        if (reading >= 0) expect(reading, c.name).toBeGreaterThan(stepAt("read"));
        const answer = ev.find((e) => e.type === "answer") as Extract<ChatEvent, { type: "answer" }> | undefined;
        const checked = at((e) => e.type === "think" && e.kind === "checked");
        if (checked >= 0) {
          expect(answer?.answer.checked, c.name).toBe(true);
          expect(checked, c.name).toBeGreaterThan(at((e) => e.type === "answer"));
        }
        for (const w of think.filter((t) => t.kind === "writing")) expect(stepAt(w.id === "background" ? "general" : "write"), `${c.name}: ${w.id}`).toBeGreaterThanOrEqual(0);
        // a search's lines: what was searched comes after the search step, and the last word on what was found is the final list's
        const found = think.filter((t) => t.kind === "found");
        if (found.length) {
          const finalList = ev.filter((e) => e.type === "papers" && e.final).at(-1) as Extract<ChatEvent, { type: "papers" }>;
          expect(found.at(-1)!.counts?.kept, c.name).toBe(finalList.results.length);
          expect(found.at(-1)!.counts?.retracted ?? 0, c.name).toBe(finalList.results.filter((p) => p.retracted).length);
        }
        // nothing for the safety lane's own replies (their words leave no trace) or a refused request
        if (ev.some((e) => e.type === "done" && (e.reason === "urgent" || e.reason === "safety"))) expect(think, c.name).toEqual([]);
      }
    }
    expect(lines).toBeGreaterThan(100);
  }, 300_000);

  it("no line is written to a log", async () => {
    const said: string[] = [];
    const spies = (["log", "info", "warn", "error"] as const).map((k) => vi.spyOn(console, k).mockImplementation((...args: unknown[]) => void said.push(args.map(String).join(" "))));
    try {
      const texts: string[] = [];
      for (const c of DIFF) {
        const { text } = await post(c.body, withFlag(c, { CHAT_THINK: "on" }).opts);
        for (const t of thinkOf(text)) texts.push(t.text);
      }
      expect(texts.length).toBeGreaterThan(50);
      const logged = said.join("\n");
      for (const t of new Set(texts)) expect(logged.includes(t), t).toBe(false);
      expect(logged).not.toMatch(/"type":"think"|looking for papers on|sources answered/);
    } finally {
      for (const s of spies) s.mockRestore();
    }
  }, 300_000);

  it("the lines of every request are the pinned ones (since-year.think.golden.json)", async () => {
    const pinned = JSON.parse(readFileSync(THINK_GOLDEN, "utf8")) as { entries: { name: string; think: unknown[] }[] };
    const now = await Promise.all(DIFF.map(async (c) => ({ name: c.name, think: thinkOf((await post(c.body, withFlag(c, { CHAT_THINK: "on" }).opts)).text).map((t) => ({ id: t.id, kind: t.kind, text: t.text, ...(t.counts ? { counts: t.counts } : {}), ...(t.actions ? { actions: t.actions } : {}) })) })));
    expect(now).toEqual(pinned.entries);
    // what it pins is real: a search with an answer has the full set, small talk its one line, another tool its one line
    const of = (name: string) => pinned.entries.find((e) => e.name === name)!.think as { kind: string }[];
    expect(of("auto, a plain question").map((t) => t.kind)).toEqual(expect.arrayContaining(["understood", "searched", "found", "reading", "writing", "checked"]));
    expect(of("auto, small talk").map((t) => t.kind)).toEqual(["understood"]);
    expect(of("auto, another tool").map((t) => t.kind)).toEqual(["understood"]);
  }, 300_000);
});

describe.runIf(process.env.RERECORD_THINK === "1")("rerecord the think golden (by hand, never in CI)", () => {
  it("writes since-year.think.golden.json", async () => {
    const { writeFileSync } = await import("node:fs");
    const entries = await Promise.all(DIFF.map(async (c) => ({ name: c.name, think: (eventsOf((await post(c.body, { ...c.opts, env: { ...c.opts?.env, CHAT_THINK: "on" } })).text).filter((e) => e.type === "think") as Extract<ChatEvent, { type: "think" }>[]).map((t) => ({ id: t.id, kind: t.kind, text: t.text, ...(t.counts ? { counts: t.counts } : {}), ...(t.actions ? { actions: t.actions } : {}) })) })));
    writeFileSync(THINK_GOLDEN, JSON.stringify({ producedFrom: "POST /api/v1/chat of apps/api/src/chat/routes.ts with CHAT_THINK=on, the stand-in network and model (QA_STUB), the clock held at 2026-11-03T12:00:00Z, for every request of the differential list of since-year.test.ts: the think lines of each, in order. Recorded by hand on 6 Nov 2026 from the working tree of branch und-m2 (M2 of the design PDF \"Sodhsetu understanding, follow-ups and MCP\"): the lines are new, so there is no earlier code to record them from; what they say is read in think.test.ts and in the test that reads every line above.", entries }, null, 1) + "\n");
  }, 300_000);
});
