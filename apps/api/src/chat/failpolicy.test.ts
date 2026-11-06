import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyChatEvent, chatRefusalShare, NOTICE_KINDS, startAssistant, streamShapeProblems, type AssistantMsg, type ChatEvent } from "@scholar/shared";
import { FOLLOWUP_UNREAD_NOTICE } from "@scholar/shared";
import type { StreamComplete } from "../docs/qa";
import { AllProvidersFailedError, NoRouteError, QuotaError, createGateway, type GatewayConfig } from "../llm";
import type { Ledger, LlmProvider, ProviderResponse } from "../llm";
import { FOLLOW_UP_OUTCOMES, UNREAD_OUTCOMES } from "../outcomes";
import { readEarlier, readHistory } from "./history";
import { routeFollowUp, routerCallFailed, ROUTER_CONTEXT_SCHEMA, ROUTER_CONTEXT_SYSTEM, type FollowUpCheck, type RouterContext } from "./router";

/**
 * R5, the follow-up failure policy (docs/design/intent-and-state.md, 4.6): with `CHAT_FAILPOLICY=on`, a follow-up whose router call FAILED is searched as written, the papers are shown, and NO written answer,
 * NO judge and NO background answer is made: the reply ends with the reason `not_answered`, the outcome `followup_unread`, and a notice of the kind `weak` (S-FOLLOWUP-UNREAD). With `shadow` only
 * `followup_unread_shadow` is counted and nothing else changes; with the flag unset or `off`, nothing changes at all.
 *
 * WHICH CHECKS MEAN "THE ROUTER CALL FAILED": only `model_failed` (router.ts, the end of `routeFollowUp`). It is the one value that says no usable reply came back. Every other value of `FollowUpCheck`
 * is a reply that came back and was read: `doubt` (the model said it was not sure), `unreadable` (a reply with no valid mode), `intent` (a search with no valid intent), and the restatement and query
 * checks (the model's words were refused by the server's own checks). Those are the server not trusting the model's reading, and they stay as they are (the policy is not widened): the first part of
 * this file pins which is which, with the real gateway under the router, one provider behaviour at a time.
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

const must = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error("a fixture that must be valid was refused");
  return r as Extract<T, { ok: true }>;
};
const u = (text: string) => ({ role: "user", text });
const a = (extra: Record<string, unknown> = {}) => ({ role: "assistant", ...extra });
const GLAUCOMA = [u("glaucoma screening in rural India"), a({ searchQuery: "glaucoma screening rural India", papers: [{ n: 1, title: "Deep learning for glaucoma screening from fundus photographs", year: 2021 }], text: "Screening found glaucoma early [1]." })];
const ctxOf = (history: unknown, earlier: unknown = []): RouterContext => ({ history: must(readHistory(history)).history, earlier: must(readEarlier(earlier)).earlier });

afterEach(() => vi.restoreAllMocks());

/* ---------------------------------------------------------------- which check means "the call failed" */

/**
 * The router's own model call, built the way the Worker builds it (`routeCompleteFor` in routes.ts), on the REAL gateway with a fake provider, so that what the gateway does with a timeout, a malformed
 * reply, an empty reply, a refusal and a used-up allowance is what is tested, and not what a stand-in says it does.
 */
function routerOn(provider: LlmProvider | null, quota = false) {
  const config: GatewayConfig = {
    routes: Object.fromEntries(["classify", "summarize_public", "qa", "review", "verify", "understand"].map((t) => [t, { public: [{ provider: "workersai", model: "m" }], private: [{ provider: "workersai", model: "m" }] }])) as GatewayConfig["routes"],
    dailyTokenQuota: 1000,
    perCallTimeoutMs: 5000,
    publicCacheTtlSeconds: 60,
    maxPromptChars: 100_000,
  };
  const ledger: Ledger = { tokensToday: async () => (quota ? 1000 : 0), record: async () => {} };
  const gateway = createGateway({ providers: provider ? { workersai: provider } : {}, ledger, config });
  return async (req: { system: string; user: string; schema?: Record<string, unknown>; maxTokens?: number; label?: string }) => {
    const r = await gateway.complete({ task: "classify", sensitivity: "private", subject: "u", system: req.system, user: req.user, schema: req.schema, maxTokens: req.maxTokens, timeoutMs: 30_000, label: req.label });
    return { json: r.json, model: r.model };
  };
}
const said = (text: string): ProviderResponse => ({ text, tokensIn: 10, tokensOut: 5 });
const provider = (impl: () => Promise<ProviderResponse>) => {
  const complete = vi.fn(impl);
  return { id: "workersai", privateOk: true, complete } satisfies LlmProvider;
};
const GOOD = (over: Record<string, unknown> = {}) => JSON.stringify({ mode: "search", confidence: 0.9, intent: "refine", question: "glaucoma screening in rural India, in children", search_query: "glaucoma screening children", year_from: 0, year_to: 0, answer_language: "", ...over });

describe("the five ways a router call fails, through the real gateway, are all `model_failed` (and are `fellBack`)", () => {
  beforeEach(() => void vi.spyOn(console, "error").mockImplementation(() => {}));

  const FAILURES: [string, () => { complete: ReturnType<typeof routerOn>; provider: ReturnType<typeof provider> | null; tries: number }][] = [
    ["a timeout", () => { const p = provider(async () => { throw new Error("timeout"); }); return { complete: routerOn(p), provider: p, tries: 1 }; }],
    ["a malformed reply, twice (it is asked again once)", () => { const p = provider(async () => said("[assistant]")); return { complete: routerOn(p), provider: p, tries: 2 }; }],
    ["a quota refusal (the day's allowance is used)", () => { const p = provider(async () => said(GOOD())); return { complete: routerOn(p, true), provider: p, tries: 0 }; }],
    ["a refused call (the provider says no)", () => { const p = provider(async () => { throw new Error("HTTP 403: the request was refused"); }); return { complete: routerOn(p), provider: p, tries: 1 }; }],
    ["a refused call (no provider may take it)", () => ({ complete: routerOn(null), provider: null, tries: 0 })],
    ["an empty reply (no text at all, twice)", () => { const p = provider(async () => said("")); return { complete: routerOn(p), provider: p, tries: 2 }; }],
  ];
  for (const [label, make] of FAILURES) {
    it(`${label}: the check is model_failed, the words are searched as written, and the call count is what the router's own retry rule gives`, async () => {
      const { complete, provider: p, tries } = make();
      const r = await routeFollowUp("and in children?", complete, ctxOf(GLAUCOMA));
      expect(r.followUp).toMatchObject({ check: "model_failed", fellBack: true, intent: "new", rewrote: false });
      expect(r.route).toMatchObject({ mode: "search", how: "fallback", confidence: 0 });
      expect(r.route.searchQuery).toBeUndefined();
      expect(routerCallFailed(r.followUp)).toBe(true);
      if (p) expect(p.complete).toHaveBeenCalledTimes(tries);
    });
  }

  it("the failures are of the three kinds the gateway has: its own error, the allowance, and no route", async () => {
    const seen: unknown[] = [];
    for (const [, make] of FAILURES) {
      const { complete } = make();
      await complete({ system: ROUTER_CONTEXT_SYSTEM, user: 'Message:\n"""\nx y\n"""', schema: ROUTER_CONTEXT_SCHEMA as unknown as Record<string, unknown> }).catch((e) => seen.push(e));
    }
    expect(seen.filter((e) => e instanceof AllProvidersFailedError)).toHaveLength(4);
    expect(seen.filter((e) => e instanceof QuotaError)).toHaveLength(1);
    expect(seen.filter((e) => e instanceof NoRouteError)).toHaveLength(1);
  });
});

describe("a reply that came back and was read is NOT a failed call, whatever the server made of it", () => {
  beforeEach(() => void vi.spyOn(console, "error").mockImplementation(() => {}));
  // [what is wrong, the reply, the check it ends in, whether the whole reading was put aside (the words searched as written) or only a part of it]
  const READ: [string, string, FollowUpCheck, boolean][] = [
    ["the model is not sure (confidence 0.3)", GOOD({ confidence: 0.3 }), "doubt", true],
    ["a reply with no mode at all (an empty object)", "{}", "unreadable", true],
    ["a reply with a mode that is none of ours", JSON.stringify({ mode: "banana", confidence: 0.99, search_query: "" }), "unreadable", true],
    ["a search with no valid intent", GOOD({ intent: "banana" }), "intent", true],
    ["a restatement that adds a number nobody wrote", GOOD({ question: "glaucoma screening 1987 in children" }), "numbers", true],
    ["search words that bleed the old topic into a new one (the rest of the reading is used)", GOOD({ intent: "new", question: "and in children?", search_query: "glaucoma screening in children" }), "bleed", false],
  ];
  for (const [label, text, check, fellBack] of READ) {
    it(`${label}: the check is ${check}, and it is not the router's failure`, async () => {
      const p = provider(async () => said(text));
      const r = await routeFollowUp("and in children?", routerOn(p), ctxOf(GLAUCOMA));
      expect(p.complete).toHaveBeenCalledTimes(1);
      expect(r.followUp?.check).toBe(check);
      expect(r.followUp?.fellBack).toBe(fellBack);
      expect(routerCallFailed(r.followUp)).toBe(false);
    });
  }

  it("a reading that is used (the check is ok) and a message no model read are not a failure either", async () => {
    const r = await routeFollowUp("and in children?", routerOn(provider(async () => said(GOOD()))), ctxOf(GLAUCOMA));
    expect(r.followUp).toMatchObject({ check: "ok", fellBack: false });
    expect(routerCallFailed(r.followUp)).toBe(false);
    expect(routerCallFailed(null)).toBe(false);
  });

  it("`routerCallFailed` is true for `model_failed` and for no other value of the check", () => {
    const base = { intent: "new", question: "x", rewrote: false, fellBack: true } as const;
    const checks: FollowUpCheck[] = ["ok", "empty", "length", "link", "instruction", "script", "numbers", "names", "negation", "novel", "bleed", "query", "years", "no_anchor", "unreadable", "doubt", "intent", "model_failed"];
    expect(checks.filter((c) => routerCallFailed({ ...base, check: c }))).toEqual(["model_failed"]);
  });
});

/* ---------------------------------------------------------------- the route */

const TOKEN = "t".repeat(40);
const sessionRow = { id: "user-1", name: "Test", email: "t@example.org", orcid: null, avatar_url: null, role: "scholar", privacy_ack: null, stale: 0, providers: "google" };
type Bound = { sql: string; args: unknown[] };
function fakeDb() {
  const outcomes: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            __bound: { sql, args } as Bound,
            first: async () => (/FROM sessions/.test(sql) ? sessionRow : /SUM\(tokens_in/.test(sql) ? { t: 0 } : null),
            run: async () => {
              if (/answer_outcomes/.test(sql)) outcomes.push(String(args[1]));
              return {};
            },
            all: async () => ({ results: [] }),
          };
        },
      };
    },
    async batch(statements: { __bound: Bound }[]) {
      return statements.map(() => ({}));
    },
  };
  return { db, outcomes };
}
type Opts = { signedIn?: boolean; env?: Record<string, string> };
async function post(body: unknown, opts: Opts = {}) {
  const { db, outcomes } = fakeDb();
  const log: string[] = [];
  const spies = (["log", "info", "warn", "error"] as const).map((m) => vi.spyOn(console, m).mockImplementation((...x: unknown[]) => void log.push(x.map((y) => (typeof y === "string" ? y : JSON.stringify(y))).join(" "))));
  try {
    const headers: Record<string, string> = { "content-type": "application/json", origin: "http://localhost", ...(opts.signedIn === false ? {} : { cookie: `sid=${TOKEN}` }) };
    const res = await chatRoutes.request("http://localhost/", { method: "POST", headers, body: JSON.stringify(body) }, { DB: db, ENABLE_DEV_ROUTES: "1", QA_STUB: "1", CROSSREF_MAILTO: "t@example.org", ...opts.env });
    const text = await res.text();
    return { res, text, outcomes, log, wire: text.replace(/"tookMs":\d+/g, '"tookMs":0') };
  } finally {
    spies.forEach((s) => s.mockRestore());
  }
}
const eventsOf = (text: string): ChatEvent[] =>
  text.split("\n\n").flatMap((block) => {
    const data = block.split("\n").find((l) => l.startsWith("data:"));
    return data ? [JSON.parse(data.slice(5)) as ChatEvent] : [];
  });
const auto = (message: string, extra: Record<string, unknown> = {}) => ({ mode: "auto", message, ...extra });
const callsOf = (who: string, label?: string) => calls.filter((c) => c.who === who && (label === undefined || c.label === label));
const check = (log: string[]) => log.map((l) => { try { return JSON.parse(l) as { msg?: string; check?: string }; } catch { return {}; } }).find((o) => o.msg === "chat_followup")?.check;
const noticesOf = (ev: ChatEvent[]) => ev.filter((e): e is Extract<ChatEvent, { type: "notice" }> => e.type === "notice").map((n) => ({ kind: n.kind, text: n.text }));
const UNREAD = { kind: "weak", text: FOLLOWUP_UNREAD_NOTICE };

beforeEach(() => void (calls.length = 0));

/** The five failures of the plan, as the stand-in router makes them (stub-route.ts): the word in the message says which. */
const MODES: [string, string, number][] = [
  ["a timeout", "routertimeout", 1],
  ["a malformed reply twice", "routermalformed", 2],
  ["a quota refusal", "routerquota", 1],
  ["a refused call", "routerrefused", 1],
  ["an empty reply", "routerempty", 2],
];
const failing = (word: string) => auto(`and in children? ${word}`, { history: GLAUCOMA });
const ON = { CHAT_FAILPOLICY: "on" };

describe("the notice and its place in the shared page code", () => {
  it("is a notice kind the page knows (`weak`), with the plain sentence of the plan", () => {
    expect(NOTICE_KINDS).toContain("weak");
    expect(FOLLOWUP_UNREAD_NOTICE).toBe("I could not tell what this refers to, so I searched your words on their own and wrote no answer.");
  });

  it("the reducer shows it on the reply like any other notice, and the reply ends with the reason not_answered and its papers", () => {
    const events: ChatEvent[] = [
      { type: "understood", mode: "search", query: "and in children?", language: "en", auto: true, how: "fallback", confidence: 0 },
      { type: "papers", results: [], final: true },
      { type: "notice", kind: "weak", text: FOLLOWUP_UNREAD_NOTICE },
      { type: "done", answered: false, reason: "not_answered", tookMs: 5 },
    ];
    const m: AssistantMsg = events.reduce(applyChatEvent, startAssistant("a1", "and in children?", 1, true));
    expect(m.status).toBe("done");
    expect(m.reason).toBe("not_answered");
    expect(m.notices).toEqual([UNREAD]);
    expect(m.answer).toBeNull();
  });
});

describe("CHAT_FAILPOLICY=on: five failures of the router, each gives the papers, no written answer, the notice and the outcome name", () => {
  for (const [label, word, tries] of MODES) {
    it(`${label}: no writer call, no judge call, no background call; the notice; reason not_answered; outcome followup_unread (n = 1 of 5)`, async () => {
      const r = await post(failing(word), { env: ON });
      expect(r.res.status).toBe(200);
      const ev = eventsOf(r.text);
      expect(streamShapeProblems("chat", ev)).toEqual([]);
      // the router was asked as many times as its own rule says, and nothing else was asked of a model
      expect(callsOf("router")).toHaveLength(tries);
      expect(callsOf("writer")).toEqual([]);
      expect(callsOf("judge")).toEqual([]);
      expect(callsOf("strict")).toEqual([]);
      // the papers are shown: the words as written were searched
      const understood = ev.find((e) => e.type === "understood") as Extract<ChatEvent, { type: "understood" }>;
      expect(understood.how).toBe("fallback");
      expect(understood.context?.fellBack).toBe(true);
      const papers = ev.filter((e) => e.type === "papers" && e.final).at(-1) as Extract<ChatEvent, { type: "papers" }>;
      expect(papers.results.length).toBeGreaterThan(0);
      // no written answer and no background answer reached the wire
      expect(ev.filter((e) => ["answer", "token", "general", "general_token"].includes(e.type))).toEqual([]);
      expect(ev.filter((e) => e.type === "step").map((e) => (e as { step: string }).step)).not.toContain("read");
      expect(ev.filter((e) => e.type === "step").map((e) => (e as { step: string }).step)).not.toContain("general");
      // the notices the list already had stay (the stand-in list has a retracted paper), and the new one is last and alone of its kind
      expect(noticesOf(ev).map((n) => n.kind)).toEqual(["retracted", "weak"]);
      expect(noticesOf(ev).filter((n) => n.kind === "weak")).toEqual([UNREAD]);
      expect(ev.at(-1)).toMatchObject({ type: "done", answered: false, reason: "not_answered" });
      expect(r.outcomes).toEqual([UNREAD_OUTCOMES.unread]);
      expect(r.outcomes).toEqual(["followup_unread"]);
    });
  }

  it("a search that finds nothing: no background answer either, the plain `nothing` line and the notice, the same ending", async () => {
    const r = await post(auto("and in children? nothing routertimeout", { history: GLAUCOMA }), { env: ON });
    const ev = eventsOf(r.text);
    expect(callsOf("writer")).toEqual([]);
    expect(ev.filter((e) => ["answer", "token", "general", "general_token"].includes(e.type))).toEqual([]);
    expect(noticesOf(ev).map((n) => n.kind)).toEqual(["nothing", "weak"]);
    expect(noticesOf(ev).at(-1)).toEqual(UNREAD);
    expect(ev.at(-1)).toMatchObject({ type: "done", answered: false, reason: "not_answered" });
    expect(r.outcomes).toEqual(["followup_unread"]);
  });

  it("the failure is logged as it was (counts and a closed name, no word of the message), and nothing new is logged", async () => {
    const off = await post(failing("routertimeout"));
    const on = await post(failing("routertimeout"), { env: ON });
    const keep = (log: string[]) => log.filter((l) => !l.includes('"msg":"chat_judge"') && !l.includes('"msg":"chat_debug"'));
    expect(keep(on.log)).toEqual(keep(off.log));
    expect(check(on.log)).toBe("model_failed");
    expect(on.log.join("\n")).not.toMatch(/children/);
  });

  it("the reducer ends with the notice on the reply (the same stream, read as the page reads it)", async () => {
    const r = await post(failing("routertimeout"), { env: ON });
    const m = eventsOf(r.text).reduce(applyChatEvent, startAssistant("a1", "and in children? routertimeout", 1, true));
    expect(m).toMatchObject({ status: "done", reason: "not_answered", answer: null, general: null });
    expect(m.notices.map((n) => n.kind)).toEqual(["retracted", "weak"]);
    expect(m.notices.find((n) => n.kind === "weak")).toEqual(UNREAD);
    expect(m.papers.length).toBeGreaterThan(0);
  });
});

describe("CHAT_FAILPOLICY unset or off: a failed router call is what it was (the words are searched, an answer is written and judged)", () => {
  for (const [label, env] of [["unset", {}], ["off", { CHAT_FAILPOLICY: "off" }], ["a bad value (ON)", { CHAT_FAILPOLICY: "ON" }]] as const) {
    it(`${label}: the writer and the judge are called, the answer is on the wire, no weak notice, the outcome is followup_rewrite_failed`, async () => {
      for (const [, word] of MODES) {
        calls.length = 0;
        const r = await post(failing(word), { env });
        const ev = eventsOf(r.text);
        expect(callsOf("writer", "chat_search").length, word).toBe(1);
        expect(callsOf("judge").length, word).toBeGreaterThan(0);
        expect(ev.some((e) => e.type === "answer"), word).toBe(true);
        expect(noticesOf(ev).filter((n) => n.kind === "weak"), word).toEqual([]);
        expect(ev.at(-1), word).toMatchObject({ type: "done", answered: true });
        expect(r.outcomes, word).toEqual([FOLLOW_UP_OUTCOMES.rewriteFailed]);
      }
    });
  }
});

describe("CHAT_FAILPOLICY=shadow: counts `followup_unread_shadow` and changes nothing else", () => {
  it("the stream is the one of `off`, byte for byte, for every failure; the outcomes are those of `off` and one more, `followup_unread_shadow`", async () => {
    for (const [label, word] of MODES) {
      const off = await post(failing(word));
      const shadow = await post(failing(word), { env: { CHAT_FAILPOLICY: "shadow" } });
      expect(shadow.wire, label).toBe(off.wire);
      expect(off.outcomes, label).toEqual(["followup_rewrite_failed"]);
      expect([...shadow.outcomes].sort(), label).toEqual(["followup_rewrite_failed", "followup_unread_shadow"]);
      expect(shadow.log.filter((l) => !l.includes('"msg":"chat_judge"') && !l.includes('"msg":"chat_debug"')), label).toEqual(off.log.filter((l) => !l.includes('"msg":"chat_judge"') && !l.includes('"msg":"chat_debug"')));
    }
  });

  it("nothing is counted for a follow-up the router read, for a first message, for a visitor, or for a read-but-doubted reply", async () => {
    for (const body of [auto("only after 2022", { history: GLAUCOMA }), auto("explain that simpler", { history: GLAUCOMA }), auto("newtopic CRISPR effects", { history: GLAUCOMA }), auto("effect of yoga on blood pressure routertimeout"), auto("and in children? unsure", { history: GLAUCOMA }), auto("and in children? garbled", { history: GLAUCOMA })]) {
      const r = await post(body, { env: { CHAT_FAILPOLICY: "shadow" } });
      expect(r.outcomes.filter((o) => o.endsWith("_shadow")), JSON.stringify(body)).toEqual([]);
    }
    const visitor = await post(failing("routertimeout"), { env: { CHAT_FAILPOLICY: "shadow" }, signedIn: false });
    expect(visitor.outcomes.filter((o) => o.endsWith("_shadow"))).toEqual([]);
  });
});

describe("the policy acts on a failed router call and on nothing else", () => {
  const SAME_IN_EVERY_POSITION: [string, ReturnType<typeof auto>][] = [
    ["a follow-up the router reads (a year)", auto("only after 2022", { history: GLAUCOMA })],
    ["a follow-up about the same papers", auto("explain that simpler", { history: GLAUCOMA })],
    ["a refinement", auto("and in children?", { history: GLAUCOMA })],
    ["a new topic", auto("newtopic CRISPR effects", { history: GLAUCOMA })],
    ["a model reply that is doubted", auto("and in children? unsure", { history: GLAUCOMA })],
    ["a model reply with no mode (unreadable)", auto("and in children? garbled", { history: GLAUCOMA })],
    ["a restatement the server refuses", auto("and in children? restatefail", { history: GLAUCOMA })],
    ["a new topic that bleeds the old one", auto("newtopic bleedtopic CRISPR", { history: GLAUCOMA })],
    ["a first message whose router fails (a first message has no earlier turns to lean on)", auto("kuch bhi routertimeout")],
    ["a message of a visitor", auto("and in children? routertimeout", { history: GLAUCOMA })],
  ];
  for (const [label, body] of SAME_IN_EVERY_POSITION) {
    it(`${label}: the stream of every position is the stream of off`, async () => {
      const visitor = label === "a message of a visitor";
      const off = await post(body, { signedIn: !visitor });
      for (const env of [{ CHAT_FAILPOLICY: "shadow" }, ON]) {
        const r = await post(body, { env, signedIn: !visitor });
        expect(r.wire).toBe(off.wire);
        // the shadow name is the only count that may differ, and only where the router really failed
        expect(r.outcomes.filter((o) => !o.endsWith("_shadow"))).toEqual(off.outcomes);
      }
    });
  }

  it("the doubted and unreadable replies still write an answer (the policy is not widened to them), and say `followup_rewrite_failed`", async () => {
    for (const word of ["unsure", "garbled", "restatefail"]) {
      calls.length = 0;
      const r = await post(auto(`and in children? ${word}`, { history: GLAUCOMA }), { env: ON });
      expect(callsOf("writer", "chat_search").length, word).toBe(1);
      expect(r.outcomes, word).toEqual([FOLLOW_UP_OUTCOMES.rewriteFailed]);
      expect(noticesOf(eventsOf(r.text)).filter((n) => n.kind === "weak"), word).toEqual([]);
    }
  });
});

describe("what /admin counts", () => {
  it("the name is its own, at most 40 characters, and the headline of /admin does not move for it: it is neither attempted nor refused nor unsplit (no model was asked to write an answer)", () => {
    expect(UNREAD_OUTCOMES.unread).toBe("followup_unread");
    expect(UNREAD_OUTCOMES.shadow).toBe("followup_unread_shadow");
    for (const n of Object.values(UNREAD_OUTCOMES)) expect(n.length).toBeLessThanOrEqual(40);
    // the four names of the context release are still four: the policy's two are not among them
    expect(Object.values(FOLLOW_UP_OUTCOMES)).toHaveLength(4);
    const base = [
      { feature: "chat", outcome: "answered", n: 10 },
      { feature: "chat", outcome: "not_grounded", n: 2 },
      { feature: "chat", outcome: "followup_answered", n: 5 },
      { feature: "chat", outcome: "followup_not_grounded", n: 1 },
      { feature: "chat", outcome: "followup_rewrite_failed", n: 3 },
    ];
    const withUnread = [...base, { feature: "chat", outcome: "followup_unread", n: 7 }, { feature: "chat", outcome: "followup_unread_shadow", n: 9 }];
    expect(chatRefusalShare(withUnread)).toEqual(chatRefusalShare(base));
    expect(chatRefusalShare(base)).toEqual({ attempted: 18, refused: 3, unsplit: 3 });
  });
});
