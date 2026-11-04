import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatEvent } from "@scholar/shared";
import { CANARY, HOSTILE_MESSAGES } from "../understand/hostile-messages";
import { INPUT_SHAPE_NAMES, inputShape } from "../understand/input-shape";
import { MAX_OUTCOME_NAMES } from "../outcomes";
import { chatRoutes } from "./routes";

/**
 * R3, the hook (docs/design/intent-and-state.md, 4.4): with `CHAT_COUNTERS=on` the chat route counts what a message in the prompt box LOOKED like (the closed names of understand/input-shape.ts), one batch
 * for the message, at the end of it, and never any of its text. With the flag unset, `off`, `shadow` or anything else, nothing is read, counted or stored, and what goes over the wire is what it always was
 * (the byte-for-byte differential for that is in since-year.test.ts, which runs its whole list in every position). The pure parts (the names, the batch, the closed list) have their own tests
 * (understand/input-shape.test.ts, outcomes.test.ts); this file is about the route.
 *
 * What is counted, and what is not (the decision is written in docs/design/intent-and-state.md, 4.4 "As built"):
 *  - an Auto message that carries no earlier turns: its shape, by name. A follow-up is another population (a follow-up "only after 2020" would be `year` and `subj0`), and the names have none for it;
 *  - a search chosen by hand: only `anyway`, when it carries that flag (it is the nearest thing to a wrong-refusal rate that needs no new request field). A search by hand is mostly a re-send ("Use my exact
 *    words"), so counting its shape would count one message twice;
 *  - `one_source`, after the search: exactly one provider contributed a paper to the list.
 */

const TOKEN = "t".repeat(40);
const sessionRow = { id: "user-1", name: "Test", email: "t@example.org", orcid: null, avatar_url: null, role: "scholar", privacy_ack: null, stale: 0, providers: "google" };
type Bound = { sql: string; args: unknown[] };

/** A D1 that knows a session and has a `batch`, and writes down everything that is prepared, bound, run alone and batched. */
function fakeDb(opts: { failBatch?: boolean } = {}) {
  const prepared: string[] = [];
  const alone: Bound[] = [];
  const batches: Bound[][] = [];
  const db = {
    prepare(sql: string) {
      prepared.push(sql);
      return {
        bind(...args: unknown[]) {
          return {
            __bound: { sql, args } as Bound,
            first: async () => (/FROM sessions/.test(sql) ? sessionRow : /SUM\(tokens_in/.test(sql) ? { t: 0 } : null),
            run: async () => {
              alone.push({ sql, args });
              return {};
            },
            all: async () => ({ results: [] }),
          };
        },
      };
    },
    async batch(statements: { __bound: Bound }[]) {
      // a database that fails with an error that quotes what it was given, as D1's own errors do
      if (opts.failBatch) throw new Error(`D1_ERROR: could not run ${JSON.stringify(statements.map((s) => s.__bound.args))} ${CANARY}`);
      batches.push(statements.map((s) => s.__bound));
      return statements.map(() => ({}));
    },
  };
  return { db, prepared, alone, batches };
}

/** The lines the route wrote before there were counters (the judge's, with how long it took; the development log of what the stand-in model said) are not the counter's business and are never the same twice. */
const mine = (lines: string[]) => lines.filter((l) => !l.includes('"msg":"chat_judge"') && !l.includes('"msg":"chat_debug"'));

/** Everything the code says through `console`, as one line each. */
function spyConsole() {
  const lines: string[] = [];
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void lines.push(a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" "))));
  return { lines, restore: () => spies.forEach((s) => s.mockRestore()) };
}
afterEach(() => vi.restoreAllMocks());

type Opts = { signedIn?: boolean; env?: Record<string, string>; failBatch?: boolean };
async function post(body: unknown, opts: Opts = {}) {
  const d = fakeDb({ failBatch: opts.failBatch });
  const con = spyConsole();
  try {
    const headers: Record<string, string> = { "content-type": "application/json", origin: "http://localhost", ...(opts.signedIn === false ? {} : { cookie: `sid=${TOKEN}` }) };
    const res = await chatRoutes.request("http://localhost/", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }, { DB: d.db, ENABLE_DEV_ROUTES: "1", QA_STUB: "1", CROSSREF_MAILTO: "t@example.org", ...opts.env });
    const text = await res.text();
    return { res, text, ...d, console: mine(con.lines), wire: text.replace(/"tookMs":\d+/g, '"tookMs":0') };
  } finally {
    con.restore();
  }
}
const eventsOf = (text: string): ChatEvent[] =>
  text.split("\n\n").flatMap((block) => {
    const data = block.split("\n").find((l) => l.startsWith("data:"));
    return data ? [JSON.parse(data.slice(5)) as ChatEvent] : [];
  });
const auto = (message: string, extra: Record<string, unknown> = {}) => ({ mode: "auto", message, ...extra });
const byHand = (message: string, extra: Record<string, unknown> = {}) => ({ mode: "search", message, ...extra });
const ON = { CHAT_COUNTERS: "on" };
const namesOf = (batch: Bound[] | undefined) => (batch ?? []).map((s) => String(s.args[1]));
const CLOSED: ReadonlySet<string> = new Set(INPUT_SHAPE_NAMES);
const u = (text: string) => ({ role: "user", text });
const a = (extra: Record<string, unknown> = {}) => ({ role: "assistant", ...extra });
const GLAUCOMA = [u("glaucoma screening in rural India"), a({ searchQuery: "glaucoma screening rural India", papers: [{ n: 1, title: "Deep learning for glaucoma screening from fundus photographs", year: 2021 }], text: "Screening found glaucoma early [1]." })];

describe("with the flag unset, off or shadow nothing is counted, and nothing new is stored", () => {
  for (const [label, env] of [["unset", {}], ["off", { CHAT_COUNTERS: "off" }], ["shadow", { CHAT_COUNTERS: "shadow" }]] as const) {
    it(`${label}: no batch, no statement for chat_input, no extra line in the log`, async () => {
      for (const body of [auto("can you search about cnn please"), auto("effect of yoga on blood pressure"), byHand("hello there friend", { anyway: true }), auto("thanks a lot")]) {
        const r = await post(body, { env });
        expect(r.res.status).toBe(200);
        expect(r.batches, label).toEqual([]);
        expect(r.alone.filter((s) => s.args[0] === "chat_input"), label).toEqual([]);
        expect(r.console, label).toEqual([]);
      }
    });
  }

  it("a value that is not exactly a position (ON, true, yes) is off, and one line says which flag held it (the name of the flag, nothing of the message)", async () => {
    for (const value of ["ON", "true", "yes", " on", "1", ""]) {
      const r = await post(auto("can you search about cnn please"), { env: { CHAT_COUNTERS: value } });
      expect(r.batches, value).toEqual([]);
      expect(r.console, value).toEqual([JSON.stringify({ level: "warn", msg: "flag_bad_value", flag: "CHAT_COUNTERS" })]);
    }
  });

  it("what goes over the wire is the same in every position, with the database working and with it failing", async () => {
    for (const body of [auto("can you search about cnn please"), auto("nothing at all about glaucoma"), auto("thanks a lot"), byHand("glaucoma screening"), byHand("hello there friend", { anyway: true }), auto("only after 2022", { history: GLAUCOMA })]) {
      const base = await post(body);
      for (const [env, failBatch] of [[{ CHAT_COUNTERS: "off" }, false], [{ CHAT_COUNTERS: "shadow" }, false], [ON, false], [ON, true]] as const) {
        const r = await post(body, { env, failBatch });
        expect(r.res.status).toBe(base.res.status);
        expect(r.wire).toBe(base.wire);
      }
    }
  }, 120_000);
});

describe("with the flag on, one Auto message is one batch of names from the closed list", () => {
  it("counts a framed message by its shape, and the list it found: one batch, the subject name first, no text in any value", async () => {
    const r = await post(auto("Can you search about CRISPR off-target effects since 2019, all papers please"), { env: ON });
    expect(r.res.status).toBe(200);
    expect(r.batches).toHaveLength(1);
    const batch = r.batches[0]!;
    expect(batch.length).toBeGreaterThan(0);
    expect(batch.length).toBeLessThanOrEqual(MAX_OUTCOME_NAMES);
    expect(namesOf(batch)).toEqual(["subj2_6", "frame", "frame_polite", "frame_all", "year", "one_source"]);
    for (const s of batch) {
      expect(s.sql).toMatch(/^INSERT INTO answer_outcomes \(day, feature, outcome, n\) VALUES \(date\('now'\), \?1, \?2, 1\) ON CONFLICT \(day, feature, outcome\) DO UPDATE SET n = n \+ 1$/);
      expect(s.args).toHaveLength(2);
      expect(s.args[0]).toBe("chat_input");
      expect(CLOSED.has(String(s.args[1]))).toBe(true);
      expect(String(s.args[1]).length).toBeLessThanOrEqual(40);
    }
    // the count of how the answer went is a separate row of the other feature, as it always was, and the shape never goes through it
    expect(r.alone.filter((s) => s.args[0] === "chat_input")).toEqual([]);
    expect(r.alone.map((s) => s.args[0])).toEqual(["chat"]);
  });

  it("counts a visitor's message too (signed out), by its shape only", async () => {
    const r = await post(auto("please tell me about tuberculosis in Kerala"), { env: ON, signedIn: false });
    expect(r.res.status).toBe(200);
    expect(r.batches).toHaveLength(1);
    expect(namesOf(r.batches[0])).toEqual(["subj2_6", "frame", "frame_polite", "one_source"]);
  });

  it("counts a greeting (subject zero, no list) and a message the rules leave to the model", async () => {
    const hi = await post(auto("thanks"), { env: ON });
    expect(namesOf(hi.batches[0])).toEqual(["subj0"]);
    // small talk is no search: there is no list, so there is no `one_source`
    const talk = await post(auto("thanks a lot"), { env: ON });
    expect(namesOf(talk.batches[0])).toEqual(inputShape("thanks a lot"));
    const model = await post(auto("kuch bhi"), { env: ON });
    expect(model.batches).toHaveLength(1);
    // exactly one subject name, which is the denominator of every share
    expect(namesOf(model.batches[0]).filter((n) => /^subj/.test(n))).toHaveLength(1);
  });

  it("adds `one_source` only when exactly one provider contributed a paper (the stand-in list is from one, the Indian one from three, a search that found nothing from none)", async () => {
    expect(namesOf((await post(auto("effect of yoga on blood pressure"), { env: ON })).batches[0])).toContain("one_source");
    expect(namesOf((await post(auto("glaucoma screening", { scope: "india" }), { env: ON })).batches[0])).not.toContain("one_source");
    expect(namesOf((await post(auto("nothing at all about glaucoma"), { env: ON })).batches[0])).not.toContain("one_source");
  });

  it("counts a message that ends too long for a search (the count is made as the message ends, whatever the ending)", async () => {
    const r = await post(auto(`glaucoma ${"screening ".repeat(40)}`), { env: ON });
    expect(r.batches).toHaveLength(1);
    expect(namesOf(r.batches[0])).toContain("long");
  });

  it("keeps to eight statements for the message that has the most names, and the subject name is among them", async () => {
    const r = await post(auto(HOSTILE_MESSAGES[28]!), { env: ON, signedIn: false });
    expect(r.res.status).toBe(200);
    expect(r.batches).toHaveLength(1);
    expect(r.batches[0]!.length).toBe(MAX_OUTCOME_NAMES);
    expect(namesOf(r.batches[0]).filter((n) => /^subj/.test(n))).toHaveLength(1);
    // the message has nine names of its own and `one_source` makes ten: the last two of the order are the ones left out, and one line says how many, in a number
    expect(namesOf(r.batches[0])).toEqual([...inputShape(HOSTILE_MESSAGES[28]!).slice(0, 8)].sort((x, y) => Number(/^subj/.test(y)) - Number(/^subj/.test(x))));
    expect(r.console).toEqual([JSON.stringify({ level: "warn", msg: "outcome_names_dropped", feature: "chat_input", dropped: 2 })]);
  });
});

describe("what is not counted", () => {
  it("a search chosen by hand counts nothing, but `anyway`, when it carries it", async () => {
    const plain = await post(byHand("hello there friend"), { env: ON });
    expect(plain.res.status).toBe(200);
    expect(plain.batches).toEqual([]);
    const anyway = await post(byHand("hello there friend", { anyway: true }), { env: ON });
    expect(anyway.res.status).toBe(200);
    expect(anyway.batches).toHaveLength(1);
    expect(namesOf(anyway.batches[0])).toEqual(["anyway"]);
  });

  it("a follow-up (a message that carries the earlier turns, or earlier chats) counts nothing: it is not a first message, and it is the one place the names would mean something else", async () => {
    for (const body of [auto("only after 2022", { history: GLAUCOMA }), auto("and in children?", { earlier: [{ question: "yoga and blood pressure", searchQuery: "yoga blood pressure" }] }), auto("only after 2020", { history: GLAUCOMA })]) {
      const r = await post(body, { env: ON });
      expect(r.res.status).toBe(200);
      expect(r.batches).toEqual([]);
    }
    // the switch that ignores earlier turns does not make a follow-up a first message
    expect((await post(auto("only after 2020", { history: GLAUCOMA }), { env: { ...ON, CHAT_CONTEXT: "off" } })).batches).toEqual([]);
  });

  it("a request that is refused counts nothing: it never became a message", async () => {
    for (const body of [{ mode: "x", message: "yoga" }, auto("yoga", { anyway: true }), auto("yoga", { scope: "mars" }), byHand("x"), "not json", auto("yoga", { sinceYear: "2025" })]) {
      const r = await post(body, { env: ON });
      expect(r.res.status).toBe(400);
      expect(r.batches).toEqual([]);
    }
  });
});

describe("no text of a message reaches a bound value or a log", () => {
  it("for each of the thirty hostile messages (the canary in every one): one batch of at most eight statements, only the feature and a closed name bound, no canary anywhere", async () => {
    let counted = 0;
    for (const [i, message] of HOSTILE_MESSAGES.entries()) {
      const r = await post(auto(message), { env: ON, signedIn: false });
      const where = `hostile message ${i + 1}`;
      expect(r.console.join("\n"), where).not.toContain(CANARY);
      expect(JSON.stringify([r.prepared, r.alone, r.batches]), where).not.toContain(CANARY);
      if (r.res.status !== 200) {
        expect(r.batches, where).toEqual([]);
        continue;
      }
      counted++;
      expect(r.batches, where).toHaveLength(1);
      expect(r.batches[0]!.length, where).toBeGreaterThanOrEqual(1);
      expect(r.batches[0]!.length, where).toBeLessThanOrEqual(MAX_OUTCOME_NAMES);
      for (const s of r.batches[0]!) {
        expect(s.args, where).toHaveLength(2);
        expect(s.args[0], where).toBe("chat_input");
        expect(CLOSED.has(String(s.args[1])), where).toBe(true);
      }
      // the only line that may be in the log is the one that says how many names were left out, in numbers
      for (const line of r.console) expect(line, where).toMatch(/^\{"level":"warn","msg":"outcome_names_dropped","feature":"chat_input","dropped":\d+\}$/);
    }
    // the test is not empty: most of them are messages the route takes
    expect(counted).toBeGreaterThanOrEqual(20);
  });

  it("holds when the database fails with an error that quotes what it was given: the answer is the same, and the log holds one line without a word of the error", async () => {
    for (const message of [HOSTILE_MESSAGES[0]!, HOSTILE_MESSAGES[9]!, "can you search about cnn please", HOSTILE_MESSAGES[13]!]) {
      const ok = await post(auto(message), { env: ON, signedIn: false });
      const bad = await post(auto(message), { env: ON, signedIn: false, failBatch: true });
      expect(bad.res.status).toBe(ok.res.status);
      expect(bad.wire).toBe(ok.wire);
      if (bad.res.status !== 200) continue;
      expect(bad.batches).toEqual([]);
      expect(bad.console).toEqual([JSON.stringify({ level: "warn", msg: "outcome_not_counted", feature: "chat_input" })]);
      expect(bad.console.join("\n")).not.toContain(CANARY);
    }
    // the stream ended in a terminal event, as it must
    const r = await post(auto("effect of yoga on blood pressure"), { env: ON, failBatch: true });
    expect(eventsOf(r.text).at(-1)?.type).toBe("done");
  });

  it("holds when the database has no `batch` at all (a counter that cannot run is a counter that did not run)", async () => {
    const d = fakeDb();
    const noBatch = { prepare: d.db.prepare } as unknown as D1Database;
    const con = spyConsole();
    try {
      const res = await chatRoutes.request("http://localhost/", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", cookie: `sid=${TOKEN}` }, body: JSON.stringify(auto("effect of yoga on blood pressure")) }, { DB: noBatch, ENABLE_DEV_ROUTES: "1", QA_STUB: "1", CROSSREF_MAILTO: "t@example.org", ...ON });
      const text = await res.text();
      expect(res.status).toBe(200);
      expect(eventsOf(text).at(-1)?.type).toBe("done");
      expect(mine(con.lines)).toEqual([JSON.stringify({ level: "warn", msg: "outcome_not_counted", feature: "chat_input" })]);
    } finally {
      con.restore();
    }
  });
});
