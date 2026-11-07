import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyChatEvent, startAssistant, streamShapeProblems, thinkIsHonest, type AssistantMsg, type ChatEvent } from "@scholar/shared";
import type { StreamComplete } from "../docs/qa";

/**
 * M4/M5 (design PDF "Sodhsetu understanding, follow-ups and MCP", pages 3 to 9 and 13): the Understand step wired into POST /api/v1/chat, with the stand-in model (understand-wire.ts, stubUnderstand) and the
 * stand-in search. What each intent does when CHAT_UNDERSTAND is "on", what "shadow" does (nothing on the wire, counts only), what "off" does (nothing at all, the ledger not even read), the ledger's trust
 * rules (a paper is never used from the page's copy; the writer and the judge never see the ledger), the visitor's switch and cap, and GET /chat/config.
 */

const calls = vi.hoisted(() => [] as { who: string; label?: string; system: string; user: string }[]);

vi.mock("./stub", async (importOriginal) => {
  const real = await importOriginal<typeof import("./stub")>();
  const rec = (who: string, f: StreamComplete): StreamComplete => async (req, hooks) => {
    calls.push({ who, label: req.label, system: req.system, user: req.user });
    return f(req, hooks);
  };
  return { ...real, stubChatStream: rec("writer", real.stubChatStream), stubJudgeStream: (env?: unknown) => rec("judge", real.stubJudgeStream(env)) };
});
vi.mock("./understand-wire", async (importOriginal) => {
  const real = await importOriginal<typeof import("./understand-wire")>();
  return {
    ...real,
    stubUnderstand: async (req: Parameters<typeof real.stubUnderstand>[0]) => (calls.push({ who: "understand", label: req.label, system: req.system, user: req.user }), real.stubUnderstand(req)),
    stubChatReply: async (req: Parameters<typeof real.stubChatReply>[0]) => (calls.push({ who: "chat_reply", label: req.label, system: req.system, user: req.user }), real.stubChatReply(req)),
  };
});

import { chatRoutes } from "./routes";

const TOKEN = "t".repeat(40);
const sessionRow = { id: "user-1", name: "Test", email: "t@example.org", orcid: null, avatar_url: null, role: "scholar", privacy_ack: null, stale: 0, providers: "google" };

/** A D1 stand-in: the session, the day's tokens, the visitor's count (`visitorN` is what the next increment returns), and every count written. */
function fakeDb(o: { visitorN?: number } = {}) {
  const outcomes: string[] = [];
  let visitor = (o.visitorN ?? 1) - 1;
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first: async () => {
              if (/FROM sessions/.test(sql)) return sessionRow;
              if (/SUM\(tokens_in/.test(sql)) return { t: 0 };
              if (/understand_visitors/.test(sql)) return { n: ++visitor };
              return null;
            },
            run: async () => {
              if (/answer_outcomes/.test(sql)) outcomes.push(`${String(args[0])}:${String(args[1])}`);
              return {};
            },
            all: async () => ({ results: [] }),
            __args: args,
          };
        },
      };
    },
    async batch(statements: { __args: unknown[] }[]) {
      for (const s of statements) outcomes.push(`${String(s.__args[0])}:${String(s.__args[1])}`);
      return statements.map(() => ({}));
    },
  };
  return { db, outcomes };
}

type Opts = { signedIn?: boolean; env?: Record<string, string>; visitorN?: number };
async function post(body: unknown, opts: Opts = {}) {
  const { db, outcomes } = fakeDb({ visitorN: opts.visitorN });
  const headers: Record<string, string> = { "content-type": "application/json", origin: "http://localhost", "cf-connecting-ip": "203.0.113.7", ...(opts.signedIn === false ? {} : { cookie: `sid=${TOKEN}` }) };
  const res = await chatRoutes.request("http://localhost/", { method: "POST", headers, body: JSON.stringify(body) }, { DB: db, ENABLE_DEV_ROUTES: "1", QA_STUB: "1", CROSSREF_MAILTO: "t@example.org", ...opts.env });
  const text = await res.text();
  // the shadow's counts are written after the reply, on their own: give them a turn of the event loop
  await new Promise((r) => setTimeout(r, 20));
  return { res, text, outcomes };
}
const eventsOf = (text: string): ChatEvent[] =>
  text.split("\n\n").flatMap((block) => {
    const data = block.split("\n").find((l) => l.startsWith("data:"));
    return data ? [JSON.parse(data.slice(5)) as ChatEvent] : [];
  });
type Understood = Extract<ChatEvent, { type: "understood" }>;
const run = async (body: unknown, opts: Opts = {}) => {
  const { res, text, outcomes } = await post(body, opts);
  expect(res.status, text).toBe(200);
  const ev = eventsOf(text);
  const reply = ev.reduce((m: AssistantMsg, e) => applyChatEvent(m, e), startAssistant("r", "q", 0, true));
  return {
    ev,
    text,
    outcomes,
    reply,
    understood: ev.find((e) => e.type === "understood") as Understood,
    done: ev.at(-1) as Extract<ChatEvent, { type: "done" }>,
    papers: (ev.filter((e) => e.type === "papers" && e.final).at(-1) as Extract<ChatEvent, { type: "papers" }> | undefined)?.results ?? [],
    notices: (ev.filter((e) => e.type === "notice") as Extract<ChatEvent, { type: "notice" }>[]).map((n) => n.kind),
    steps: (ev.filter((e) => e.type === "step") as Extract<ChatEvent, { type: "step" }>[]).map((s) => s.step),
    think: ev.filter((e) => e.type === "think") as Extract<ChatEvent, { type: "think" }>[],
    general: ev.find((e) => e.type === "general") as Extract<ChatEvent, { type: "general" }> | undefined,
  };
};
const auto = (message: string, extra: Record<string, unknown> = {}) => ({ mode: "auto", message, ...extra });
const ON = { CHAT_UNDERSTAND: "on" };
const ON_THINK = { CHAT_UNDERSTAND: "on", CHAT_THINK: "on" };
const callsOf = (who: string) => calls.filter((c) => c.who === who);

/** A chat that searched "glaucoma screening in rural India" and listed three papers of the stand-in search (their real stand-in DOIs), as the page sends it (ledgerForSend). */
const CANARY = "CANARY-LEDGER-7f3a";
const LEDGER = [
  {
    turn: 1,
    user: "glaucoma screening in rural India",
    intent: "search",
    standalone: "glaucoma screening in rural India",
    reply: `Screening found glaucoma early. ${CANARY}`,
    papers: [
      { n: 1, id: "doi:10.1000/glaucoma.1", doi: "10.1000/glaucoma.1", title: "Deep learning for glaucoma screening from fundus photographs", year: 2021, first_author: "Rao" },
      { n: 2, id: "doi:10.1000/glaucoma.2", doi: "10.1000/glaucoma.2", title: "Smartphone-based retinal imaging in rural clinics", year: 2022, first_author: "Iyer" },
      { n: 3, id: "doi:10.1000/glaucoma.4", doi: "10.1000/glaucoma.4", title: "Cost of population screening for glaucoma in India", year: 2020, first_author: "Shah" },
    ],
  },
];

const NOW = new Date("2026-11-06T12:00:00Z");
beforeEach(() => {
  calls.length = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("GET /chat/config: the page sends the ledger only while the step reads it", () => {
  const config = async (env: Record<string, string>, signedIn = true) => {
    const { db } = fakeDb();
    const res = await chatRoutes.request("http://localhost/config", { headers: signedIn ? { cookie: `sid=${TOKEN}` } : {} }, { DB: db, CROSSREF_MAILTO: "t@example.org", ...env });
    expect(res.headers.get("cache-control")).toBe("no-store");
    return (await res.json()) as { ledger: boolean };
  };
  it("off (unset, off, or a value that is not a position): no", async () => {
    expect(await config({})).toEqual({ ledger: false });
    expect(await config({ CHAT_UNDERSTAND: "off" })).toEqual({ ledger: false });
    expect(await config({ CHAT_UNDERSTAND: "ON" })).toEqual({ ledger: false });
  });
  it("shadow and on: yes for a person who is signed in", async () => {
    expect(await config({ CHAT_UNDERSTAND: "shadow" })).toEqual({ ledger: true });
    expect(await config(ON)).toEqual({ ledger: true });
  });
  it("a visitor: only while CHAT_UNDERSTAND_VISITORS is on as well", async () => {
    expect(await config(ON, false)).toEqual({ ledger: false });
    expect(await config({ ...ON, CHAT_UNDERSTAND_VISITORS: "shadow" }, false)).toEqual({ ledger: false });
    expect(await config({ ...ON, CHAT_UNDERSTAND_VISITORS: "on" }, false)).toEqual({ ledger: true });
    expect(await config({ CHAT_UNDERSTAND_VISITORS: "on" }, false)).toEqual({ ledger: false });
  });
});

describe("off: the ledger is not read, and nothing changes", () => {
  it("a ledger, even a malformed one, is ignored: the same stream as without it, and no model reads anything new", async () => {
    const plain = await post(auto("effect of yoga on blood pressure"));
    const withLedger = await post(auto("effect of yoga on blood pressure", { ledger: LEDGER }));
    const bad = await post(auto("effect of yoga on blood pressure", { ledger: [{ turn: "x" }] }));
    const norm = (t: string) => t.replace(/"tookMs":\d+/g, '"tookMs":0');
    expect(norm(withLedger.text)).toBe(norm(plain.text));
    expect(bad.res.status).toBe(200);
    expect(norm(bad.text)).toBe(norm(plain.text));
    expect(callsOf("understand")).toHaveLength(0);
  });
});

describe("shadow: the rules decide and the stream is byte for byte the off stream; only counts are kept", () => {
  const MESSAGES = ["effect of yoga on blood pressure", "thanks a lot", "now my idea about bees, is it novel", "kuch bhi", "HY"];
  it("every message streams exactly as with the step off, and the step's counts are written (agreement included)", async () => {
    const norm = (t: string) => t.replace(/"tookMs":\d+/g, '"tookMs":0');
    for (const m of MESSAGES) {
      const off = await post(auto(m, { ledger: LEDGER }));
      const shadow = await post(auto(m, { ledger: LEDGER }), { env: { CHAT_UNDERSTAND: "shadow" } });
      expect(norm(shadow.text), m).toBe(norm(off.text));
      expect(shadow.outcomes, m).toContain("chat_understand:und_turn");
      expect(off.outcomes.some((o) => o.startsWith("chat_understand:")), m).toBe(false);
    }
    const s = await post(auto("effect of yoga on blood pressure"), { env: { CHAT_UNDERSTAND: "shadow" } });
    expect(s.outcomes).toContain("chat_understand:und_src_model");
    expect(s.outcomes).toContain("chat_understand:und_agree");
    const g = await post(auto("HY"), { env: { CHAT_UNDERSTAND: "shadow" } });
    expect(g.outcomes).toContain("chat_understand:und_src_greeting");
  });
  it("only names of the closed list are written, never a word of the message", async () => {
    const s = await post(auto("effect of yoga on blood pressure"), { env: { CHAT_UNDERSTAND: "shadow" } });
    for (const o of s.outcomes.filter((x) => x.startsWith("chat_understand:"))) expect(o).toMatch(/^chat_understand:und_[a-z0-9_]+$/);
    expect(s.outcomes.join(" ")).not.toMatch(/yoga/);
  });
});

describe("on: each intent", () => {
  it("a greeting (\"HY\", \"thanks bhai\", \"Aur batao sab badhiya?\") is conversation: no model, no search, a fixed reply in the person's language", async () => {
    for (const m of ["HY", "thanks bhai", "Aur batao sab badhiya?", "hlo"]) {
      const r = await run(auto(m), { env: ON });
      expect(r.done.reason, m).toBe("small_talk");
      expect(r.papers, m).toHaveLength(0);
      expect(r.steps, m).not.toContain("search");
      expect(r.understood.intent, m).toBe("chat");
      expect(r.general?.kind).toBe("not_research");
    }
    expect(callsOf("understand")).toHaveLength(0);
    expect(callsOf("chat_reply")).toHaveLength(0);
    const h = await run(auto("thanks bhai"), { env: ON });
    expect(h.general?.text).toMatch(/Koi baat nahi/);
  });
  it("conversation the model reads (\"tum kya kar sakte ho?\", an off-topic cricket score) gets the model's short reply, with no citation and no search", async () => {
    const r = await run(auto("cricket score kya hai aaj ka"), { env: ON });
    expect(r.understood.intent).toBe("chat");
    expect(r.done.reason).toBe("small_talk");
    expect(r.general?.text).toMatch(/research/);
    expect(r.papers).toHaveLength(0);
    expect(callsOf("chat_reply")).toHaveLength(1);
  });
  it("a conversation reply that cites a paper is thrown away and the message is searched instead (und_chat_leak)", async () => {
    const r = await run(auto("undleak glaucoma"), { env: ON });
    expect(r.understood.intent).toBe("search");
    expect(r.text).not.toMatch(/et al/);
    expect(r.steps).toContain("search");
    expect(r.outcomes).toContain("chat_understand:und_chat_leak");
  });
  it("a new search: the step's English words are searched, with its status line and Change", async () => {
    const r = await run(auto("ab diffusion models for MRI"), { env: ON_THINK });
    expect(r.understood.intent).toBe("search");
    expect(r.understood.how).toBe("model");
    expect(r.understood.statusLine).toMatch(/diffusion models for mri/i);
    expect(r.understood.searchQuery).toBe("diffusion models for MRI");
    expect(r.steps).toContain("search");
    const und = r.think.find((l) => l.kind === "understood");
    expect(und?.actions).toEqual(["change", "exact_words"]);
    expect(r.think.every((l) => thinkIsHonest(l))).toBe(true);
  });
  it("\"sirf 2020 ke baad\" after a search is refine_search: the last topic again from 2020, with the year chip, and every paper from 2020 on", async () => {
    const r = await run(auto("sirf 2020 ke baad", { ledger: LEDGER }), { env: ON });
    expect(r.understood.intent).toBe("refine_search");
    expect(r.understood.context).toMatchObject({ intent: "refine", yearFrom: 2020 });
    expect(r.papers.length).toBeGreaterThan(0);
    expect(r.papers.every((p) => (p.year ?? 0) >= 2020)).toBe(true);
    expect(r.reply.context?.yearFrom).toBe(2020);
  });
  it("\"dusre paper ka dataset kya hai?\" is ask_results: no new search; paper 2 is looked up again by its DOI and the answer is written from it, and the reply says so", async () => {
    const r = await run(auto("dusre paper ka dataset kya hai?", { ledger: LEDGER }), { env: ON_THINK });
    expect(r.understood.intent).toBe("ask_results");
    expect(r.steps).not.toContain("search");
    expect(r.papers.map((p) => p.doi)).toEqual(["10.1000/glaucoma.2"]);
    expect(r.notices).toContain("abstracts");
    expect(r.think.some((l) => l.id === "earlier" && l.counts?.papers === 1)).toBe(true);
    expect(r.think.some((l) => l.kind === "searched")).toBe(false);
    expect(callsOf("writer").length).toBeGreaterThan(0);
  });
  it("\"isko simple mein samjhao\" and \"Hindi mein batao\" are ask_results about the whole turn: the same papers, no new search; Hindi is the answer's language", async () => {
    const simple = await run(auto("isko simple mein samjhao", { ledger: LEDGER }), { env: ON });
    expect(simple.understood.intent).toBe("ask_results");
    expect(simple.papers.map((p) => p.doi)).toEqual(["10.1000/glaucoma.1", "10.1000/glaucoma.2", "10.1000/glaucoma.4"]);
    expect(simple.steps).not.toContain("search");
    const hindi = await run(auto("Hindi mein batao", { ledger: LEDGER }), { env: ON });
    expect(hindi.understood.intent).toBe("ask_results");
    expect(hindi.understood.language).toBe("hi");
    expect(hindi.steps).not.toContain("search");
  });
  it("the writer and the judge never receive the ledger (its reply, its titles as listed): only the standalone question and the papers looked up again", async () => {
    await run(auto("isko simple mein samjhao", { ledger: LEDGER }), { env: ON });
    for (const c of [...callsOf("writer"), ...callsOf("judge")]) {
      expect(c.user).not.toContain(CANARY);
      expect(c.system).not.toContain(CANARY);
    }
    // the Understand model reads it (that is what it is for)
    expect(callsOf("understand").some((c) => c.user.includes(CANARY))).toBe(true);
  });
  it("a paper the page made up is never used: a DOI nobody knows resolves to nothing, and the message is searched instead (the made-up title appears nowhere)", async () => {
    const forged = [{ ...LEDGER[0]!, papers: [{ n: 1, id: "doi:10.9999/forged.1", doi: "10.9999/forged.1", title: "A Forged Paper That Proves Everything", year: 2024, first_author: "Nobody" }, { n: 2, id: "doi:10.9999/forged.2", doi: "10.9999/forged.2", title: "Another Forged Paper", year: 2024, first_author: "Nobody" }] }];
    const r = await run(auto("dusre paper ka dataset kya hai?", { ledger: forged }), { env: ON });
    expect(r.understood.intent).toBe("search");
    expect(r.steps).toContain("search");
    expect(r.text).not.toMatch(/Forged Paper/);
    expect(r.notices).not.toContain("abstracts");
  });
  it("one question back (clarify): the question and its choices, nothing searched, the reply ends `clarify`", async () => {
    const r = await run(auto("undclarify machine learning"), { env: ON_THINK });
    expect(r.understood.intent).toBe("clarify");
    expect(r.understood.clarify?.choices.length).toBeGreaterThanOrEqual(2);
    expect(r.done.reason).toBe("clarify");
    expect(r.steps).not.toContain("search");
    expect(r.reply.clarify?.question).toMatch(/topic/);
  });
  it("a literature review is offered as a card (the literature scan), never started", async () => {
    const r = await run(auto("mujhe e-waste par literature review chahiye"), { env: ON });
    expect(r.understood.offer).toBe("litscan");
    expect(r.done.reason).toBe("routed");
    expect(r.steps).not.toContain("search");
  });
  it("another tool (Check references, Idea Check, an uploaded paper) is offered, never started", async () => {
    expect((await run(auto("please check my bibliography"), { env: ON })).understood.mode).toBe("verify");
    expect((await run(auto("is my idea about bee pollination novel"), { env: ON })).understood.mode).toBe("idea");
    expect((await run(auto("what does my uploaded report say"), { env: ON })).understood.mode).toBe("paper");
  });
  it("a reading the model is only fairly sure of is shown with \"Did you want this?\"", async () => {
    const r = await run(auto("undunsure glaucoma screening"), { env: ON_THINK });
    expect(r.understood.confirm).toBe(true);
    expect(r.think.find((l) => l.id === "confirm")?.actions).toEqual(["change"]);
  });
  it("the fail policy: a model that times out, answers invalid twice or is down hands the message to the rules, and the reply says so", async () => {
    for (const m of ["undtimeout glaucoma screening", "undgarbled glaucoma screening", "unddown glaucoma screening"]) {
      const r = await run(auto(m), { env: ON_THINK });
      expect(r.understood.fallback, m).toBe(true);
      expect(r.understood.confirm, m).toBe(true);
      expect(r.understood.intent, m).toBeUndefined();
      expect(r.think.some((l) => l.id === "unsure" && /could not understand/i.test(l.text)), m).toBe(true);
      expect(r.steps, m).toContain("search");
    }
  });
  it("a search chosen by hand never meets the step", async () => {
    const r = await run({ mode: "search", message: "glaucoma screening" }, { env: ON });
    expect(r.understood.intent).toBeUndefined();
    expect(callsOf("understand")).toHaveLength(0);
  });
  it("a malformed ledger is refused where it would be read (the page sends the message again without it)", async () => {
    const { res, text } = await post(auto("only after 2020", { ledger: [{ turn: 1, user: "x", papers: [{ n: 1, title: "t", id: "javascript:alert(1)" }] }] }), { env: ON });
    expect(res.status).toBe(400);
    expect(JSON.parse(text).type).toBe("invalid_ledger");
  });
  it("the counts of the step: who decided and the intent, never text", async () => {
    const r = await run(auto("ab diffusion models for MRI"), { env: ON });
    expect(r.outcomes).toEqual(expect.arrayContaining(["chat_understand:und_turn", "chat_understand:und_src_model", "chat_understand:und_int_search"]));
  });
  it("every stream of the position is well formed, and every Thinking line in it is honest", async () => {
    for (const body of [auto("HY"), auto("ab diffusion models for MRI"), auto("dusre paper ka dataset kya hai?", { ledger: LEDGER }), auto("sirf 2020 ke baad", { ledger: LEDGER }), auto("undclarify x y"), auto("undtimeout glaucoma"), auto("undunsure glaucoma"), auto("mujhe e-waste par literature review chahiye")]) {
      const r = await run(body, { env: ON_THINK });
      expect(streamShapeProblems("chat", r.ev), JSON.stringify(body)).toEqual([]);
      // the Thinking block's lines stay honest with the step deciding: every number a line states is one of its counts (the step's own words are inside “ ” quotes)
      for (const l of r.think) expect(thinkIsHonest(l), `${JSON.stringify(body)}: ${l.text}`).toBe(true);
      expect(r.think.length, JSON.stringify(body)).toBeGreaterThan(0);
    }
  });
});

describe("visitors", () => {
  it("with only CHAT_UNDERSTAND on, a visitor stays on the rules (no step, no new field)", async () => {
    const r = await run(auto("ab diffusion models for MRI"), { signedIn: false, env: ON });
    expect(r.understood.intent).toBeUndefined();
    expect(callsOf("understand")).toHaveLength(0);
  });
  it("with CHAT_UNDERSTAND_VISITORS on, the step reads a visitor's message too; the written answer is still for a person who is signed in", async () => {
    const r = await run(auto("ab diffusion models for MRI"), { signedIn: false, env: { ...ON, CHAT_UNDERSTAND_VISITORS: "on" } });
    expect(r.understood.intent).toBe("search");
    expect(r.done.reason).toBe("sign_in");
    expect(callsOf("understand")).toHaveLength(1);
  });
  it("past 40 calls a day the rules decide, and the Thinking block says to sign in for more", async () => {
    const r = await run(auto("ab diffusion models for MRI"), { signedIn: false, env: { ...ON_THINK, CHAT_UNDERSTAND_VISITORS: "on" }, visitorN: 41 });
    expect(r.understood.fallback).toBe(true);
    expect(r.think.some((l) => /Sign in for more/.test(l.text))).toBe(true);
    expect(callsOf("understand")).toHaveLength(0);
  });
  it("a greeting from a visitor costs no call of the day", async () => {
    const r = await run(auto("hii"), { signedIn: false, env: { ...ON, CHAT_UNDERSTAND_VISITORS: "on" }, visitorN: 41 });
    expect(r.understood.intent).toBe("chat");
    expect(r.understood.fallback).toBeUndefined();
  });
});
