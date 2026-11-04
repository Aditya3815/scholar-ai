import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { streamShapeProblems, type ChatEvent } from "@scholar/shared";
import type { StreamComplete } from "../docs/qa";
import { CANARY } from "../understand/hostile-messages";
import { noticeText, replyText } from "../understand/lane-text";

/**
 * R4, the safety lane in the chat route (docs/design/intent-and-state.md, 4.5 and 5.1), run through the real handler with the stand-in network and model. Every call a model or a search could receive
 * is written down, so that "no model call and no search" is something this file SEES and not something it hopes. The flag has four positions: unset or off (today), shadow (reads, counts, changes
 * nothing), core (acts on the unmistakable phrases of urgent, crisis and help) and on (acts on everything). The byte-for-byte proof that off and shadow change nothing is in since-year.test.ts (its
 * differential list now holds 17 messages of this lane and runs in every position); this file looks at what the lane does when it acts.
 */
const calls = vi.hoisted(() => [] as { who: string; label?: string; query?: string }[]);

vi.mock("./stub", async (importOriginal) => {
  const real = await importOriginal<typeof import("./stub")>();
  const rec = (who: string, f: StreamComplete): StreamComplete => async (req, hooks) => {
    calls.push({ who, label: req.label });
    return f(req, hooks);
  };
  return {
    ...real,
    stubChatStream: rec("writer", real.stubChatStream),
    stubJudgeStream: (env?: unknown) => rec("judge", real.stubJudgeStream(env)),
    stubStrictStream: rec("strict", real.stubStrictStream),
    stubSearchFor: (query: string, scope: Parameters<typeof real.stubSearchFor>[1]) => (calls.push({ who: "search", query }), real.stubSearchFor(query, scope)),
  };
});
vi.mock("./stub-route", async (importOriginal) => {
  const real = await importOriginal<typeof import("./stub-route")>();
  return { ...real, stubRoute: async (req: Parameters<typeof real.stubRoute>[0]) => (calls.push({ who: "router", label: req.label }), real.stubRoute(req)) };
});

import { chatRoutes } from "./routes";

const TOKEN = "t".repeat(40);
const sessionRow = { id: "user-1", name: "Test", email: "t@example.org", orcid: null, avatar_url: null, role: "scholar", privacy_ack: null, stale: 0, providers: "google" };

type Bound = unknown[];
function fakeDb() {
  const alone: Bound[] = [];
  const batches: Bound[][] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            first: async () => (/FROM sessions/.test(sql) ? sessionRow : /SUM\(tokens_in/.test(sql) ? { t: 0 } : null),
            run: async () => {
              if (/answer_outcomes/.test(sql)) alone.push(args);
              return {};
            },
            all: async () => ({ results: [] }),
            __args: args,
          };
        },
      };
    },
    async batch(statements: { __args: Bound }[]) {
      batches.push(statements.map((s) => s.__args));
      return statements.map(() => ({}));
    },
  };
  return { db, alone, batches };
}
const names = (rows: Bound[]) => rows.map((r) => `${String(r[0])}:${String(r[1])}`);

type Opts = { signedIn?: boolean; env?: Record<string, unknown> };
async function post(body: unknown, opts: Opts = {}) {
  const d = fakeDb();
  const lines: string[] = [];
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "))));
  try {
    const headers: Record<string, string> = { "content-type": "application/json", origin: "http://localhost", ...(opts.signedIn === false ? {} : { cookie: `sid=${TOKEN}` }) };
    const res = await chatRoutes.request("http://localhost/", { method: "POST", headers, body: JSON.stringify(body) }, { DB: d.db, ENABLE_DEV_ROUTES: "1", QA_STUB: "1", CROSSREF_MAILTO: "t@example.org", ...opts.env });
    const text = await res.text();
    const events = text.split("\n\n").flatMap((block) => {
      const data = block.split("\n").find((l) => l.startsWith("data:"));
      return data ? [JSON.parse(data.slice(5)) as ChatEvent] : [];
    });
    return { res, text, events, types: events.map((e) => e.type), done: events.at(-1) as Extract<ChatEvent, { type: "done" }>, ...d, console: lines.filter((l) => !l.includes('"msg":"chat_judge"') && !l.includes('"msg":"chat_debug"')) };
  } finally {
    for (const s of spies) s.mockRestore();
  }
}
const auto = (message: string, extra: Record<string, unknown> = {}) => ({ mode: "auto", message, ...extra });
const byHand = (message: string, extra: Record<string, unknown> = {}) => ({ mode: "search", message, ...extra });
const who = (w: string) => calls.filter((c) => c.who === w);
const general = (events: ChatEvent[]) => events.find((e) => e.type === "general") as Extract<ChatEvent, { type: "general" }> | undefined;
/** The lines of the lane (the stand-in's own list holds a retracted paper, so it also has its own "retracted" line, which is not the lane's). */
const notices = (events: ChatEvent[]) => (events.filter((e) => e.type === "notice") as Extract<ChatEvent, { type: "notice" }>[]).filter((n) => n.kind.startsWith("safety_"));
const u = (text: string) => ({ role: "user", text });
const a = (extra: Record<string, unknown> = {}) => ({ role: "assistant", ...extra });
const GLAUCOMA = [u("glaucoma screening in rural India"), a({ searchQuery: "glaucoma screening rural India", papers: [{ n: 1, title: "Deep learning for glaucoma screening from fundus photographs", year: 2021 }], text: "Screening found glaucoma early [1]." })];

const CORE = { CHAT_SAFETY: "core" };
const ON = { CHAT_SAFETY: "on" };

beforeEach(() => {
  calls.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe.each([["core", CORE], ["on", ON]] as const)("CHAT_SAFETY=%s: an urgent symptom, self-harm and a plain call for help are answered by the page", (_label, env) => {
  const CASES: [string, string, "urgent" | "safety", "urgent" | "crisis" | "help"][] = [
    ["an urgent symptom", "my father has chest pain and his left arm hurts right now", "urgent", "urgent"],
    ["someone else in danger", "my friend collapsed and is not breathing right now", "urgent", "urgent"],
    ["self-harm", "I want to kill myself", "safety", "crisis"],
    ["the word suicidal", "I am suicidal", "safety", "crisis"],
    ["a plain call for help", "help me", "safety", "help"],
    ["a call for help with no topic", "please help me I cant do this anymore", "safety", "help"],
    ["Hinglish", "mujhe marna hai", "safety", "crisis"],
    ["Hindi", "मैं मरना चाहता हूँ", "safety", "crisis"],
  ];
  for (const [what, message, reason, reply] of CASES) {
    for (const signedIn of [true, false]) {
      it(`${what}, ${signedIn ? "signed in" : "a visitor"}: understood, one fixed reply, done as ${reason}; no model, no router, no search, no papers`, async () => {
        const r = await post(auto(message), { signedIn, env });
        expect(r.res.status).toBe(200);
        expect(r.types).toEqual(["understood", "general", "done"]);
        expect(streamShapeProblems("chat", r.events)).toEqual([]);
        expect(r.done).toMatchObject({ answered: false, reason });
        const g = general(r.events)!;
        expect(g.kind).toBe("not_research");
        const lang = /[ऀ-ॿ]/.test(message) ? "hi" : /^mujhe/.test(message) ? "hinglish" : "en";
        expect(g.text).toBe(replyText(reply, lang));
        expect(g.text).not.toMatch(/\p{N}/u); // no number is checked yet
        expect(calls).toEqual([]);
      });
    }
  }

  it("the reply is the same for a follow-up: a message that carries turns before it still gets the lane, before the router is asked", async () => {
    const r = await post(auto("I want to kill myself", { history: GLAUCOMA }), { env });
    expect(r.types).toEqual(["understood", "general", "done"]);
    expect(r.done.reason).toBe("safety");
    expect(calls).toEqual([]);
  });

  it("the lane runs before small talk: 'help me' is the lane's, and a bare 'help' is still answered by small talk as before", async () => {
    const helpMe = await post(auto("help me"), { env });
    expect(helpMe.done.reason).toBe("safety");
    expect(general(helpMe.events)!.text).toBe(replyText("help", "en"));
    const help = await post(auto("help"), { env });
    expect(help.done.reason).toBe("small_talk");
    expect(general(help.events)!.text).not.toBe(replyText("help", "en"));
  });

  it("a topic search that holds a trigger word is a search: no lane reply", async () => {
    for (const m of ["suicide prevention programmes for farmers in India", "I am doing research on suicide", "chest pain management in emergency departments", "I need help finding papers on diabetes"]) {
      const r = await post(auto(m), { env });
      expect(r.types.includes("papers"), m).toBe(true);
      expect(r.done.reason ?? "", m).not.toMatch(/^(urgent|safety)$/);
    }
  });

  it("two requests of the same message give the same stream (nothing about the lane depends on the time or a count)", async () => {
    const x = await post(auto("I want to kill myself"), { env });
    const y = await post(auto("I want to kill myself"), { env });
    expect(x.text.replace(/"tookMs":\d+/g, "")).toBe(y.text.replace(/"tookMs":\d+/g, ""));
  });
});

describe("a search chosen by hand is searched as written: no reply, no withheld answer, only lines above the answer", () => {
  it.each([["core", CORE], ["on", ON]] as const)("CHAT_SAFETY=%s: a crisis phrase gets the crisis line under its own kind, right after 'understood' and before the papers, and the answer is still written", async (_l, env) => {
    const r = await post(byHand("I want to kill myself"), { env });
    expect(r.types.slice(0, 3)).toEqual(["understood", "notice", "step"]);
    expect(notices(r.events).map((n) => n.kind)).toEqual(["safety_crisis"]);
    expect(notices(r.events)[0]!.text).toBe(noticeText("safety_crisis", "en", { auto: false, careKind: null }));
    expect(r.types.indexOf("notice")).toBeLessThan(r.types.indexOf("papers"));
    expect(r.types).toContain("answer");
    expect(who("search").map((c) => c.query)).toEqual(["I want to kill myself"]); // searched as written
    expect(who("router")).toEqual([]);
    expect(r.done.answered).toBe(true);
  });

  it("an urgent or help cue gets the urgent line; the button under the urgent reply sends exactly such a search (anyway) and its papers carry the line", async () => {
    const r = await post(byHand("my father has chest pain and his left arm hurts right now", { anyway: true }), { env: ON });
    expect(notices(r.events).map((n) => n.kind)).toEqual(["safety_urgent"]);
    expect(r.types).toContain("papers");
    expect(r.done.reason).not.toBe("urgent");
    const help = await post(byHand("help me", { anyway: true }), { env: ON });
    expect(notices(help.events).map((n) => n.kind)).toEqual(["safety_urgent"]);
    expect(help.types).toContain("answer");
  });

  it("two cues keep both lines, in the order crisis, urgent", async () => {
    const r = await post(byHand("my brother took too many tablets and is unconscious right now and I want to die"), { env: ON });
    expect(notices(r.events).map((n) => n.kind)).toEqual(["safety_crisis", "safety_urgent"]);
    expect(r.types.indexOf("papers")).toBeGreaterThan(r.types.lastIndexOf("notice", r.types.indexOf("papers")));
  });

  it("a medicine decision by hand has the decision line, without the words 'no answer was written', and its answer is written", async () => {
    const r = await post(byHand("can I take paracetamol with my blood pressure tablets"), { env: ON });
    expect(notices(r.events).map((n) => n.kind)).toEqual(["safety_decision"]);
    expect(notices(r.events)[0]!.text).not.toMatch(/no answer was written/);
    expect(r.types).toContain("answer");
  });

  it("in core a hand-chosen search gets a line for the core phrases only", async () => {
    const decision = await post(byHand("can I take paracetamol with my blood pressure tablets"), { env: CORE });
    expect(notices(decision.events)).toEqual([]);
  });
});

describe("CHAT_SAFETY=on: a personal medicine decision and a health story keep the search, and the lines come before the papers", () => {
  it("a decision in Auto: the search runs, a line under its own kind comes right after 'understood', no written answer, no judge, no background, the reason 'decision'", async () => {
    const r = await post(auto("can I take paracetamol with my blood pressure tablets"), { env: ON });
    // (the router's own step may come first: the rules do not settle this message for a signed-in person)
    expect(r.types[r.types.indexOf("understood") + 1]).toBe("notice");
    const n = notices(r.events)[0]!;
    expect(n.kind).toBe("safety_decision");
    expect(n.text).toBe(noticeText("safety_decision", "en", { auto: true, careKind: null }));
    expect(r.types).toContain("papers");
    expect(r.types).not.toContain("answer");
    expect(r.types).not.toContain("token");
    expect(r.types).not.toContain("general");
    expect(who("writer")).toEqual([]);
    expect(who("judge")).toEqual([]);
    expect(who("search")).toHaveLength(1);
    expect(r.done).toMatchObject({ answered: false, reason: "decision" });
  });

  it("a decision for a visitor is also 'decision' (signing in would not give an answer), and one that finds nothing has no background either", async () => {
    const visitor = await post(auto("can I take paracetamol with my blood pressure tablets"), { env: ON, signedIn: false });
    expect(visitor.done.reason).toBe("decision");
    const nothing = await post(auto("nothing at all about glaucoma, can I take the tablets"), { env: ON });
    expect(nothing.types).not.toContain("general_token");
    expect(nothing.types).not.toContain("general");
    expect(nothing.done.reason).toBe("decision");
  });

  it("a health story with a research question: the line above the papers, then the search and the written answer go on", async () => {
    const r = await post(auto("i am 8 weeks pregnant, what does research say about caffeine and miscarriage"), { env: ON });
    expect(r.types[r.types.indexOf("understood") + 1]).toBe("notice");
    expect(notices(r.events)[0]).toMatchObject({ kind: "safety_care" });
    expect(r.types).toContain("answer");
    expect(r.done.answered).toBe(true);
  });

  it("a distress story with a topic gets the distress line, and one with no topic gets the help reply and not the no-topic question", async () => {
    const withTopic = await post(auto("i have been feeling very low and hopeless lately, is there any research on yoga for depression"), { env: ON });
    expect(notices(withTopic.events)[0]!.text).toBe(noticeText("safety_care", "en", { auto: true, careKind: "distress" }));
    const noTopic = await post(auto("I have felt very low for months and I cannot sleep, what does research say"), { env: ON });
    expect(noTopic.types).toEqual(["understood", "general", "done"]);
    expect(noTopic.done.reason).toBe("safety");
  });

  it("core leaves the decision and care messages alone, as today (they are only counted)", async () => {
    const r = await post(auto("can I take paracetamol with my blood pressure tablets"), { env: CORE });
    expect(notices(r.events)).toEqual([]);
    expect(r.types).toContain("answer");
  });
});

describe("unset, off, shadow and a value that is not a position: the lane changes nothing", () => {
  const URGENT = "my father has chest pain and his left arm hurts right now";
  for (const [label, env] of [["unset", {}], ["off", { CHAT_SAFETY: "off" }], ["shadow", { CHAT_SAFETY: "shadow" }], ["ON", { CHAT_SAFETY: "ON" }], ["true", { CHAT_SAFETY: "true" }], ["CORE", { CHAT_SAFETY: "CORE" }]] as const) {
    it(`${label}: an urgent message is searched and answered as it always was, with no new line`, async () => {
      const r = await post(auto(URGENT), { env });
      expect(r.types).toContain("papers");
      expect(r.types).toContain("answer");
      expect(notices(r.events).map((n) => n.kind).filter((k) => k.startsWith("safety"))).toEqual([]);
      expect(r.done.reason).toBeUndefined();
      expect(who("search")).toHaveLength(1);
    });
  }
  it("a value that is not a position is off, and one line says which flag held it", async () => {
    const r = await post(auto("I want to kill myself"), { env: { CHAT_SAFETY: "ON" } });
    expect(r.console.filter((l) => l.includes("flag_bad_value"))).toEqual([JSON.stringify({ level: "warn", msg: "flag_bad_value", flag: "CHAT_SAFETY" })]);
  });
  it("the kill switch: a KV key can lower the flag (on to shadow), never raise it", async () => {
    const kv = (value: string | null) => ({ get: async () => value, put: async () => {} }) as unknown as KVNamespace;
    const lowered = await post(auto("I want to kill myself"), { env: { CHAT_SAFETY: "on", CACHE: kv("shadow") } });
    expect(lowered.types).toContain("papers");
    const raised = await post(auto("I want to kill myself"), { env: { CHAT_SAFETY: "shadow", CACHE: kv("on") } });
    expect(raised.types).toContain("papers");
    const same = await post(auto("I want to kill myself"), { env: { CHAT_SAFETY: "on", CACHE: kv(null) } });
    expect(same.done.reason).toBe("safety");
    const toCore = await post(auto("I wish I was dead"), { env: { CHAT_SAFETY: "on", CACHE: kv("core") } });
    expect(toCore.types).toContain("papers"); // a broad phrase does not act at core
  });
});

describe("shadow only counts, and only through the same switch as everything else that is new (CHAT_COUNTERS exactly 'on')", () => {
  const sent = async (message: string, env: Record<string, unknown>) => {
    const r = await post(auto(message), { env });
    return { ...r, shape: r.batches.flat().map((row) => String(row[1])), outcomes: names(r.alone) };
  };
  it("CHAT_SAFETY=shadow with CHAT_COUNTERS unset stores nothing new at all: no batch, no lane name", async () => {
    for (const m of ["I want to kill myself", "help me", "my father has chest pain and his left arm hurts right now", "can I take paracetamol with my blood pressure tablets"]) {
      const r = await sent(m, { CHAT_SAFETY: "shadow" });
      expect(r.batches, m).toEqual([]);
      expect(r.outcomes.filter((o) => /would_|lane_/.test(o)), m).toEqual([]);
    }
  });
  it("CHAT_SAFETY=shadow with CHAT_COUNTERS=on counts would_* in the one batch of the message, the lane's names first so that the cap of eight cannot take them", async () => {
    const r = await sent("I want to kill myself", { CHAT_SAFETY: "shadow", CHAT_COUNTERS: "on" });
    expect(r.batches).toHaveLength(1);
    expect(r.batches[0]!.length).toBeLessThanOrEqual(8);
    expect(r.shape.slice(0, 2)).toEqual(expect.arrayContaining(["would_crisis"]));
    expect(r.shape).toContain("would_crisis");
    expect(r.shape.some((n) => /^subj/.test(n))).toBe(true);
    expect(r.shape.filter((n) => n.startsWith("lane_"))).toEqual([]);
    for (const [m, name] of [["help me", "would_help"], ["my father has chest pain and his left arm hurts right now", "would_urgent"], ["can I take paracetamol with my blood pressure tablets", "would_decision"], ["i am 8 weeks pregnant, what does research say about caffeine and miscarriage", "would_care"]] as const) {
      expect((await sent(m, { CHAT_SAFETY: "shadow", CHAT_COUNTERS: "on" })).shape, m).toContain(name);
    }
  });
  it("shadow changes nothing that goes over the wire, whether it counts or not", async () => {
    const plain = await post(auto("I want to kill myself"), {});
    for (const env of [{ CHAT_SAFETY: "shadow" }, { CHAT_SAFETY: "shadow", CHAT_COUNTERS: "on" }]) {
      const r = await post(auto("I want to kill myself"), { env });
      expect(r.text.replace(/"tookMs":\d+/g, "")).toBe(plain.text.replace(/"tookMs":\d+/g, ""));
    }
  });
  it("with the lane acting, the names are lane_*; the reply is counted as an outcome of its own only when the counters are on", async () => {
    const off = await sent("I want to kill myself", { CHAT_SAFETY: "on" });
    expect(off.batches).toEqual([]);
    expect(off.outcomes).toEqual([]); // not even the outcome of the reply: nothing new is stored while CHAT_COUNTERS is not 'on'
    const on = await sent("I want to kill myself", { CHAT_SAFETY: "on", CHAT_COUNTERS: "on" });
    expect(on.shape).toContain("lane_crisis");
    expect(on.outcomes).toContain("chat:safety");
    const urgent = await sent("my father has chest pain and his left arm hurts right now", { CHAT_SAFETY: "on", CHAT_COUNTERS: "on" });
    expect(urgent.outcomes).toContain("chat:urgent");
    const decision = await sent("can I take paracetamol with my blood pressure tablets", { CHAT_SAFETY: "on", CHAT_COUNTERS: "on" });
    expect(decision.outcomes).toContain("chat:decision");
    expect(decision.shape).toContain("lane_decision");
  });
  it("a message that is not read as anything counts no lane name; a search chosen by hand counts only `anyway`", async () => {
    const plain = await sent("effect of yoga on blood pressure", { CHAT_SAFETY: "on", CHAT_COUNTERS: "on" });
    expect(plain.shape.filter((n) => /^(lane_|would_)/.test(n))).toEqual([]);
    const hand = await post(byHand("I want to kill myself"), { env: { CHAT_SAFETY: "on", CHAT_COUNTERS: "on" } });
    expect(hand.batches).toEqual([]);
  });
  it("a follow-up is not counted (as before), though the lane answers it", async () => {
    const r = await post(auto("I want to kill myself", { history: GLAUCOMA }), { env: { CHAT_SAFETY: "on", CHAT_COUNTERS: "on" } });
    expect(r.done.reason).toBe("safety");
    expect(r.batches).toEqual([]);
  });
});

describe("nothing of what the person wrote reaches a log, a counted value or a bound value", () => {
  it("a crisis message with a canary in it, in every position, leaves the canary nowhere but in the stream's own `understood` line", async () => {
    for (const env of [{}, { CHAT_SAFETY: "shadow", CHAT_COUNTERS: "on" }, { ...CORE, CHAT_COUNTERS: "on" }, { ...ON, CHAT_COUNTERS: "on" }]) {
      for (const message of [`I want to kill myself ${CANARY}`, `help me ${CANARY}`, `my father has chest pain and his left arm hurts right now ${CANARY}`, `can I take ${CANARY} tablet`]) {
        const r = await post(auto(message), { env });
        expect(r.console.join("\n"), JSON.stringify(env)).not.toContain(CANARY);
        expect(JSON.stringify([r.alone, r.batches])).not.toContain(CANARY);
        const reply = general(r.events);
        if (reply) expect(reply.text).not.toContain(CANARY);
        for (const n of notices(r.events)) expect(n.text).not.toContain(CANARY);
      }
    }
  });
});
