import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyChatEvent, startAssistant, streamShapeProblems, thinkIsHonest, type AssistantMsg, type ChatEvent, type OaAskEvent } from "@scholar/shared";

/**
 * CHAT_TOOLS wired into POST /api/v1/chat (docs/design/chat-tools.md), with the stand-in search, the stand-in reference check (tools-stub.ts) and stand-ins for the retraction service and "Ask this paper"
 * (the real ones are run end to end by scripts/chat-tools-e2e.mjs). Off: nothing changes. On: the cheap tools run in the reply, Idea Check stays a card, a search chosen by hand never runs a tool, a tool
 * that fails says so and shows no made-up result, the limits hold, and every Thinking line is honest.
 */

const seen = vi.hoisted(() => ({ retractions: [] as string[][], asks: [] as { question: string; key: string; clientAbstract: string }[], retractionsFail: false, askEvents: null as OaAskEvent[] | null }));

vi.mock("../search/retraction-service", async (importOriginal) => {
  const real = await importOriginal<typeof import("../search/retraction-service")>();
  return {
    ...real,
    retractionService: {
      ...real.retractionService,
      check: async (_env: unknown, dois: string[]) => {
        seen.retractions.push(dois);
        if (seen.retractionsFail) throw new Error("down");
        return { checked: dois.map((doi) => ({ doi, status: doi.includes("retracted") ? "retracted" : "not_retracted", notices: doi.includes("retracted") ? [`${doi}-notice`] : [] })), invalid: [] };
      },
    },
  };
});
vi.mock("../oa/service", async (importOriginal) => {
  const real = await importOriginal<typeof import("../oa/service")>();
  return {
    ...real,
    oaService: {
      ...real.oaService,
      ask: async (_env: unknown, a: { question: string; key: string; clientAbstract: string }, s: { send: (e: OaAskEvent) => Promise<void> }) => {
        seen.asks.push({ question: a.question, key: a.key, clientAbstract: a.clientAbstract });
        const events: OaAskEvent[] = seen.askEvents ?? [
          { type: "ingest", status: "ready", progress: 1, source: "europepmc" },
          { type: "paper", key: a.key, title: "Smartphone-based retinal imaging in rural clinics", source: "europepmc", license: "cc-by", permissive: true },
          { type: "stage", stage: "retrieving" },
          { type: "delta", text: "They used" },
          { type: "answer", answer: { id: "a1", question: a.question, found: true, answer: "They used smartphone adapters [1].", verified: true, citations: [{ n: 1, page: 1, idx: 0, quote: "Low-cost smartphone adapters were used", section: "Methods" }], createdAt: 0 } },
        ];
        for (const e of events) await s.send(e);
      },
    },
  };
});

// "undmaybe" in a message makes the stand-in Understand model only 0.6 sure of what it read (the 0.45 to 0.75 band), whatever it read
vi.mock("./understand-wire", async (importOriginal) => {
  const real = await importOriginal<typeof import("./understand-wire")>();
  return {
    ...real,
    stubUnderstand: async (req: Parameters<typeof real.stubUnderstand>[0]) => {
      const r = await real.stubUnderstand(req);
      return /undmaybe/.test(req.user) ? { ...r, json: { ...(r.json as object), confidence: 0.6 } } : r;
    },
  };
});

import { chatRoutes } from "./routes";

const TOKEN = "t".repeat(40);
const sessionRow = { id: "user-1", name: "Test", email: "t@example.org", orcid: null, avatar_url: null, role: "scholar", privacy_ack: null, stale: 0, providers: "google" };

type Opts = { signedIn?: boolean; env?: Record<string, unknown>; docs?: { id: string; title: string }[] };
function fakeDb(o: Opts) {
  const outcomes: string[] = [];
  const writes: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first: async () => (/FROM sessions/.test(sql) ? sessionRow : /SUM\(tokens_in/.test(sql) ? { t: 0 } : null),
            run: async () => {
              if (/answer_outcomes/.test(sql)) outcomes.push(`${String(args[0])}:${String(args[1])}`);
              if (/INSERT INTO doc_qa/.test(sql)) writes.push(`doc_qa:${String(args[1])}`);
              return {};
            },
            all: async () => {
              if (/FROM documents/.test(sql)) return { results: o.docs ?? [] };
              if (/FROM doc_chunks/.test(sql)) return { results: [{ idx: 0, page: 3, text: "Dropout was applied at a rate of 0.5 to every hidden layer during training.", embedding: null }, { idx: 1, page: 4, text: "The model reached 91 percent accuracy on the held-out set.", embedding: null }] };
              return { results: [] };
            },
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
  return { db, outcomes, writes };
}

async function post(body: unknown, opts: Opts = {}) {
  const { db, outcomes, writes } = fakeDb(opts);
  const headers: Record<string, string> = { "content-type": "application/json", origin: "http://localhost", "cf-connecting-ip": "203.0.113.7", ...(opts.signedIn === false ? {} : { cookie: `sid=${TOKEN}` }) };
  const res = await chatRoutes.request("http://localhost/", { method: "POST", headers, body: JSON.stringify(body) }, { DB: db, ENABLE_DEV_ROUTES: "1", QA_STUB: "1", CROSSREF_MAILTO: "t@example.org", ...opts.env });
  const text = await res.text();
  return { res, text, outcomes, writes };
}
const eventsOf = (text: string): ChatEvent[] =>
  text.split("\n\n").flatMap((block) => {
    const data = block.split("\n").find((l) => l.startsWith("data:"));
    return data ? [JSON.parse(data.slice(5)) as ChatEvent] : [];
  });
const run = async (body: unknown, opts: Opts = {}) => {
  const { res, text, outcomes, writes } = await post(body, opts);
  expect(res.status, text).toBe(200);
  const ev = eventsOf(text);
  const reply = ev.reduce((m: AssistantMsg, e) => applyChatEvent(m, e), startAssistant("r", "q", 0, true));
  return { ev, text, outcomes, writes, reply, understood: ev.find((e) => e.type === "understood") as Extract<ChatEvent, { type: "understood" }>, done: ev.at(-1) as Extract<ChatEvent, { type: "done" }>, think: ev.filter((e) => e.type === "think") as Extract<ChatEvent, { type: "think" }>[], tools: ev.filter((e) => e.type.startsWith("tool")) };
};
const auto = (message: string, extra: Record<string, unknown> = {}) => ({ mode: "auto", message, ...extra });
const ON = { CHAT_TOOLS: "on" };
const ON_THINK = { CHAT_TOOLS: "on", CHAT_THINK: "on" };

const LIST = [
  "[1] Watson, J. D., & Crick, F. H. C. (1953). Molecular structure of nucleic acids. Nature, 171, 737-738.",
  "[2] Vaswani, A., et al. (2017). Attention is all you need. Advances in Neural Information Processing Systems.",
  "[3] Invented, Q. (2021). A study that does not exist at all. Journal of Nothing, 1, 1-2.",
  "[4] Mismatch, M. (2019). Deep residual learning for image recognition. CVPR, 770-778.",
].join("\n");
const LEDGER = [
  {
    turn: 1,
    user: "glaucoma screening in rural India",
    intent: "search",
    standalone: "glaucoma screening in rural India",
    reply: "Screening found glaucoma early.",
    papers: [
      { n: 1, id: "doi:10.1000/glaucoma.1", doi: "10.1000/glaucoma.1", title: "Deep learning for glaucoma screening from fundus photographs", year: 2021, first_author: "Rao" },
      { n: 2, id: "doi:10.1000/glaucoma.2", doi: "10.1000/glaucoma.2", title: "Smartphone-based retinal imaging in rural clinics", year: 2022, first_author: "Iyer" },
    ],
  },
];

beforeEach(() => {
  seen.retractions.length = 0;
  seen.asks.length = 0;
  seen.retractionsFail = false;
  seen.askEvents = null;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-09T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("off (unset, off, shadow, a typo): the card as before, nothing runs", () => {
  it("a pasted list ends `routed` with no tool event, whatever the switch says when it is not exactly on", async () => {
    for (const value of [undefined, "off", "shadow", "On", "true"]) {
      const r = await run(auto(LIST), { env: value === undefined ? {} : { CHAT_TOOLS: value } });
      expect(r.tools, String(value)).toEqual([]);
      expect(r.done.reason, String(value)).toBe("routed");
      expect(r.understood.mode).toBe("verify");
      expect(r.understood.confirm, String(value)).toBeUndefined();
    }
    expect(seen.retractions).toEqual([]);
  });

  it("the same stream, byte for byte, with the switch unset and at off, for a list, a retraction question and a search", async () => {
    for (const m of [LIST, "is 10.1000/abc.retracted retracted?", "glaucoma screening in rural India"]) {
      const a = (await post(auto(m))).text.replace(/"tookMs":\d+/g, "");
      const b = (await post(auto(m), { env: { CHAT_TOOLS: "off" } })).text.replace(/"tookMs":\d+/g, "");
      expect(b, m).toBe(a);
    }
  });
});

describe("on: Check references runs in the reply", () => {
  it("every reference gets the page's verdict, in the order of the paste; the reply ends `tool`, asks 'Did you want this?', and keeps the verdicts", async () => {
    const r = await run(auto(LIST), { env: ON });
    expect(r.understood.mode).toBe("verify");
    // the rules decided: ONE line ("I understood this as ..." with Change), no "Did you want this?"
    expect(r.understood.confirm).toBeUndefined();
    expect(r.tools[0]).toEqual({ type: "tool", tool: "verify", total: 4, skipped: 0 });
    expect(r.tools.filter((e) => e.type === "tool_ref")).toHaveLength(4);
    expect(r.done).toMatchObject({ type: "done", answered: false, reason: "tool" });
    expect(r.reply.tool?.kind).toBe("verify");
    if (r.reply.tool?.kind === "verify") expect(r.reply.tool.items.map((i) => i.verdict?.status)).toEqual(["verified", "verified", "not_found", "mismatch"]);
    expect(r.outcomes).toContain("chat:tool_verify");
    expect(streamShapeProblems("chat", r.ev as never)).toEqual([]);
  });

  it("a reference that cannot be checked says why and has no verdict; the minute's limit gives each reference over it the same", async () => {
    const r = await run(auto(`${LIST}\n[5] Unreachable, U. (2020). A paper the databases cannot be asked about. Journal, 1, 1-2.`), { env: ON });
    const last = r.tools.filter((e) => e.type === "tool_ref").map((e) => (e as Extract<ChatEvent, { type: "tool_ref" }>).item).find((i) => i.n === 5)!;
    expect(last.verdict).toBeNull();
    expect(last.error).toMatch(/could not be reached/);
    const limited = await run(auto(LIST), { env: { ...ON, VERIFY_LIMITER: { limit: async () => ({ success: false }) } } });
    const items = limited.tools.filter((e) => e.type === "tool_ref").map((e) => (e as Extract<ChatEvent, { type: "tool_ref" }>).item);
    expect(items.every((i) => i.verdict === null && /Too many/.test(i.error ?? ""))).toBe(true);
  });

  it("the Thinking block says what ran, from its own counts (every line honest)", async () => {
    const r = await run(auto(LIST), { env: ON_THINK });
    const ids = r.think.map((t) => t.id);
    expect(ids).toEqual(["understood", "tool", "tool_result"]);
    for (const t of r.think) expect(thinkIsHonest(t), t.text).toBe(true);
    expect(r.think.find((t) => t.id === "tool_result")).toMatchObject({ counts: { checked: 4, verified: 2, mismatch: 1, notFound: 1, unchecked: 0 } });
    expect(r.think[0]!.actions).toEqual(["change"]);
  });

  it("a request with no list keeps the card", async () => {
    const r = await run(auto("please check my references for errors"), { env: ON });
    expect(r.tools).toEqual([]);
  });
});

describe("on: retractions", () => {
  it("DOIs with a word that asks about retraction are checked at Crossref; the reply says which are retracted, with the notice", async () => {
    const r = await run(auto("is 10.1000/abc.retracted retracted? and 10.1000/clear.2"), { env: ON_THINK });
    expect(seen.retractions).toEqual([["10.1000/abc.retracted", "10.1000/clear.2"]]);
    expect(r.understood.mode).toBe("verify");
    // the rules decided: ONE line ("I understood this as ..." with Change), no "Did you want this?"
    expect(r.understood.confirm).toBeUndefined();
    expect(r.reply.tool).toMatchObject({ kind: "retractions", dois: 2, final: true, checked: [{ doi: "10.1000/abc.retracted", status: "retracted", notices: ["10.1000/abc.retracted-notice"] }, { doi: "10.1000/clear.2", status: "not_retracted" }] });
    expect(r.think.find((t) => t.id === "tool_result")?.counts).toEqual({ retracted: 1, clear: 1, unknown: 0 });
    expect(r.done.reason).toBe("tool");
  });

  it("a check that could not run says 'unknown' for every DOI, never 'not retracted'", async () => {
    seen.retractionsFail = true;
    const r = await run(auto("10.1000/x.1 retract hua kya?"), { env: ON });
    expect(r.reply.tool).toMatchObject({ kind: "retractions", checked: [{ doi: "10.1000/x.1", status: "unknown" }] });
  });

  it("only what the person wrote is checked: the DOIs of the message, each once, and nothing else", async () => {
    const message = "Are these retracted? 10.1000/a.1, 10.1000/b.2 and again 10.1000/a.1.";
    const r = await run(auto(message), { env: ON });
    expect(seen.retractions).toEqual([["10.1000/a.1", "10.1000/b.2"]]);
    const checked = (r.tools.find((e) => e.type === "tool_retractions") as Extract<ChatEvent, { type: "tool_retractions" }>).checked.map((c) => c.doi);
    expect(checked).toEqual(["10.1000/a.1", "10.1000/b.2"]);
    for (const d of checked) expect(message.toLowerCase()).toContain(d);
    expect(r.tools[0]).toEqual({ type: "tool", tool: "retractions", dois: 2 });
  });

  it("a bare DOI is still searched as written", async () => {
    const r = await run(auto("10.1000/glaucoma.1"), { env: ON });
    expect(r.tools).toEqual([]);
    expect(seen.retractions).toEqual([]);
  });
});

describe("on: never for a search chosen by hand, a greeting, or Idea Check", () => {
  it("a search chosen by hand runs no tool, even with DOIs and 'retracted'", async () => {
    const r = await run({ mode: "search", message: "is 10.1000/abc.retracted retracted?" }, { env: ON });
    expect(r.tools).toEqual([]);
    expect(r.understood.how).toBe("chosen");
  });
  it("small talk and an idea stay what they were", async () => {
    expect((await run(auto("hi, how are you?"), { env: ON })).tools).toEqual([]);
    const idea = await run(auto("now my idea about bees, is it novel"), { env: ON });
    expect(idea.tools).toEqual([]);
    expect(idea.done.reason).toBe("routed");
  });
});

describe("on, with the Understand step: a question about one paper of the chat is answered from its full text", () => {
  const UND = { ...ON_THINK, CHAT_UNDERSTAND: "on" };
  it("'the second paper' runs Ask this paper on that paper (looked up again by DOI): its card, then its answer with checked quotes", async () => {
    const r = await run(auto("dusre paper ka method kya hai?", { ledger: LEDGER }), { env: UND });
    expect(seen.asks).toHaveLength(1);
    expect(seen.asks[0]!.key).toBe("doi:10.1000/glaucoma.2");
    // the abstract the server has (the paper looked up again), never the page's copy
    expect(seen.asks[0]!.clientAbstract).toMatch(/smartphone adapters/i);
    expect(r.understood).toMatchObject({ mode: "paper", intent: "ask_results" });
    // a sure reading (0.88): one line, no "Did you want this?"
    expect(r.understood.confirm).toBeUndefined();
    expect(r.think.filter((t) => t.id === "confirm" || /Did you want|chahiye tha/.test(t.text))).toEqual([]);
    const papers = r.ev.filter((e) => e.type === "papers") as Extract<ChatEvent, { type: "papers" }>[];
    expect(papers.at(-1)!.results.map((p) => p.doi)).toEqual(["10.1000/glaucoma.2"]);
    expect(r.reply.tool).toMatchObject({ kind: "ask_paper", paper: { doi: "10.1000/glaucoma.2" }, ask: { answer: { verified: true }, live: "" } });
    expect(r.think.find((t) => t.id === "tool_result")).toMatchObject({ counts: { quotes: 1 } });
    // no written chat answer from the abstracts: the paper's own answer is the reply
    expect(r.ev.some((e) => e.type === "answer")).toBe(false);
    for (const t of r.think) expect(thinkIsHonest(t), t.text).toBe(true);
  });

  it("a reading only 0.45 to 0.75 sure asks 'Did you want this?', in the SAME line as what was understood (one line, one Change)", async () => {
    const r = await run(auto("undmaybe dusre paper ka method kya hai?", { ledger: LEDGER }), { env: UND });
    expect(r.reply.tool?.kind).toBe("ask_paper");
    expect(r.understood.confirm).toBe(true);
    const und = r.think.filter((t) => t.kind === "understood" || t.id === "confirm");
    expect(und).toHaveLength(1);
    expect(und[0]).toMatchObject({ id: "understood", actions: ["change"] });
    expect(und[0]!.text).toMatch(/Ask this paper, yahin chala raha hoon\. Aapko ye chahiye tha\?$/);
  });

  it("the step could not be used and the rules chose the tool: one line, no question (the rules decided)", async () => {
    const r = await run(auto("undtimeout is 10.1000/abc.retracted retracted?"), { env: UND });
    expect(r.reply.tool?.kind).toBe("retractions");
    expect(r.understood).toMatchObject({ fallback: true });
    expect(r.understood.confirm).toBeUndefined();
    expect(r.think.filter((t) => t.kind === "understood" || t.id === "confirm").map((t) => t.text)).toEqual(["Check retractions, run here"]);
  });

  it("a visitor keeps the answer from the abstracts (Ask this paper needs a sign-in)", async () => {
    const r = await run(auto("dusre paper ka method kya hai?", { ledger: LEDGER }), { env: { ...UND, CHAT_UNDERSTAND_VISITORS: "on" }, signedIn: false });
    expect(seen.asks).toEqual([]);
    expect(r.tools).toEqual([]);
  });

  it("an ask that fails says so in its place and makes nothing up", async () => {
    seen.askEvents = [{ type: "error", code: "quota", title: "You have used today's AI allowance" }];
    const r = await run(auto("dusre paper ka method kya hai?", { ledger: LEDGER }), { env: UND });
    expect(r.reply.tool).toMatchObject({ kind: "ask_paper", ask: { answer: null, error: { code: "quota" } } });
    expect(r.outcomes).toContain("chat:tool_ask_paper_failed");
    // in the person's language (the message is Hinglish)
    expect(r.think.find((t) => t.id === "tool_result")?.text).toBe("Is baar jawab nahi ban paaya");
  });

  it("the minute's limit for questions is held", async () => {
    const r = await run(auto("dusre paper ka method kya hai?", { ledger: LEDGER }), { env: { ...UND, ASK_LIMITER: { limit: async () => ({ success: false }) } } });
    expect(seen.asks).toEqual([]);
    expect(r.reply.tool).toMatchObject({ kind: "ask_paper", ask: { error: { code: "rate_limited" } } });
  });
});

describe("on: a question about the person's own paper", () => {
  const UND = { ...ON, CHAT_UNDERSTAND: "on" };
  it("with one paper uploaded, it is answered from that paper, and kept with that paper's questions", async () => {
    const r = await run(auto("what dropout rate did my uploaded paper use?"), { env: UND, docs: [{ id: "doc-1", title: "Dropout in deep networks" }] });
    expect(r.understood.mode).toBe("paper");
    expect(r.reply.tool).toMatchObject({ kind: "ask_doc", paper: { title: "Dropout in deep networks" } });
    // the stand-in model answers from the paper's own passages, and the quotes are checked against them
    expect(r.reply.tool?.kind === "ask_doc" && r.reply.tool.ask.answer?.citations.every((c) => /Dropout|accuracy/.test(c.quote))).toBe(true);
    expect(r.writes).toEqual(["doc_qa:doc-1"]);
    expect(r.outcomes).toContain("doc_ask:answered");
    // its id never leaves the server
    expect(r.text).not.toContain("doc-1");
  });
  it("with several and no title named, or none, the card stays", async () => {
    const two = await run(auto("what does my uploaded paper say?"), { env: UND, docs: [{ id: "a", title: "One paper" }, { id: "b", title: "Another paper" }] });
    expect(two.tools).toEqual([]);
    expect(two.done.reason).toBe("routed");
    const none = await run(auto("what does my uploaded paper say?"), { env: UND, docs: [] });
    expect(none.tools).toEqual([]);
  });
});
