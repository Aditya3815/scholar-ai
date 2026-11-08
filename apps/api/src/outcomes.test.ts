import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { chatRefusalShare } from "@scholar/shared";
import { MAX_OUTCOME_NAMES, OUTCOME_FEATURES, OUTCOME_RETENTION_SQL, askOutcome, countOutcome, countOutcomes, readOutcomes } from "./outcomes";
import { runMaintenance } from "./maintenance";
import { testD1 } from "./test-d1";
import { INPUT_SHAPE_NAMES, inputShape } from "./understand/input-shape";
import { CANARY, HOSTILE_MESSAGES } from "./understand/hostile-messages";

let db: D1Database;
let sql: DatabaseSync;
beforeEach(() => ({ db, sql } = testD1()));

const rows = () => sql.prepare("SELECT day, feature, outcome, n FROM answer_outcomes ORDER BY feature, outcome").all() as { day: string; feature: string; outcome: string; n: number }[];

describe("counting how answers went", () => {
  it("adds one to the day's count for a feature and outcome, and starts a row when there is none", async () => {
    await countOutcome(db, "chat", "answered");
    await countOutcome(db, "chat", "answered");
    await countOutcome(db, "chat", "not_grounded");
    await countOutcome(db, "doc_ask", "answered");
    expect(rows().map((r) => [r.feature, r.outcome, r.n])).toEqual([["chat", "answered", 2], ["chat", "not_grounded", 1], ["doc_ask", "answered", 1]]);
    expect(rows().every((r) => /^\d{4}-\d\d-\d\d$/.test(r.day))).toBe(true);
  });

  it("keeps no text and no person: the table has only the day, the feature, the outcome and a count", () => {
    const cols = (sql.prepare("SELECT name FROM pragma_table_info('answer_outcomes')").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(["day", "feature", "outcome", "n"]);
  });

  it("cuts an outcome name to forty characters, so a surprise value cannot make a long row", async () => {
    await countOutcome(db, "chat", "x".repeat(200));
    expect(rows()[0]!.outcome).toHaveLength(40);
  });

  it("never gets in the way of an answer: a failure is logged and swallowed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const broken = { prepare: () => { throw new Error("database is down"); } } as unknown as D1Database;
    await expect(countOutcome(broken, "chat", "answered")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]![0])).not.toMatch(/database is down/); // not even the error text goes to the log
    warn.mockRestore();
  });

  it("reads the last seven days (today and six before), summed by feature and outcome", async () => {
    sql.exec(`INSERT INTO answer_outcomes VALUES (date('now'), 'chat', 'answered', 5), (date('now', '-6 days'), 'chat', 'answered', 3), (date('now', '-7 days'), 'chat', 'answered', 100),
      (date('now', '-2 days'), 'chat', 'not_grounded', 2), (date('now'), 'oa_ask', 'not_in_paper', 1)`);
    expect(await readOutcomes(db)).toEqual([
      { feature: "chat", outcome: "answered", n: 8 },
      { feature: "chat", outcome: "not_grounded", n: 2 },
      { feature: "oa_ask", outcome: "not_in_paper", n: 1 },
    ]);
  });

  it("is cleared after ninety days by the daily clean-up", async () => {
    sql.exec(`INSERT INTO answer_outcomes VALUES (date('now', '-91 days'), 'chat', 'answered', 4), (date('now', '-89 days'), 'chat', 'answered', 4)`);
    expect(OUTCOME_RETENTION_SQL).toMatch(/-90 days/);
    const out = await runMaintenance(db);
    expect(out.answer_outcomes).toBe(1);
    expect(rows()).toHaveLength(1);
  });
});

describe("what a question about a paper came to", () => {
  it("is not_in_paper when the paper does not contain it, answered when it was found and checked, unverified when a quote did not check out", () => {
    expect(askOutcome({ found: false, verified: true })).toBe("not_in_paper");
    expect(askOutcome({ found: true, verified: true })).toBe("answered");
    expect(askOutcome({ found: true, verified: false })).toBe("unverified");
  });
});

/* ---------------------------------------------------------------- the shape of a message, counted as names only (R3) */

type Statement = ReturnType<D1Database["prepare"]>;
/** The real stand-in behind a recorder: every statement prepared, every value bound, every batch (with its length), and every statement run on its own instead of in a batch. */
function spied(real: D1Database) {
  const log = { prepared: [] as string[], bound: [] as unknown[][], batches: [] as number[], alone: 0 };
  const wrap = (s: Statement): Statement =>
    ({
      ...s,
      bind: (...a: unknown[]) => {
        log.bound.push(a);
        return wrap(s.bind(...a));
      },
      run: (...x: []) => (log.alone++, s.run(...x)),
      all: (...x: []) => (log.alone++, s.all(...x)),
      first: (...x: []) => (log.alone++, s.first(...x)),
    }) as unknown as Statement;
  const spy = {
    prepare: (text: string) => (log.prepared.push(text), wrap(real.prepare(text))),
    batch: (list: Statement[]) => (log.batches.push(list.length), real.batch(list)),
  } as unknown as D1Database;
  return { db: spy, log };
}
/** Every way a message could reach a log. */
function spyConsole() {
  const calls: string[] = [];
  const spies = (["log", "info", "warn", "error", "debug", "trace"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void calls.push(`${m}: ${a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ")}`)),
  );
  return { calls, restore: () => spies.forEach((s) => s.mockRestore()) };
}
const closedNames = new Set<string>(INPUT_SHAPE_NAMES);
const all = () => sql.prepare("SELECT day, feature, outcome, n FROM answer_outcomes").all() as { day: string; feature: string; outcome: string; n: number }[];
const warnLine = (o: Record<string, unknown>) => `warn: ${JSON.stringify({ level: "warn", ...o })}`;

describe("counting the shape of a message (feature chat_input)", () => {
  it("is a feature of its own, beside the ones there were", () => {
    expect([...OUTCOME_FEATURES]).toEqual(["chat", "oa_ask", "oa_ask_abstract", "doc_ask", "litscan", "chat_input", "chat_understand"]);
  });

  it("writes every name of one message in one batch, one statement a name, and nothing outside the batch", async () => {
    const { db: spy, log } = spied(db);
    await countOutcomes(spy, "chat_input", ["frame", "year", "subj1"]);
    expect(log.batches).toEqual([3]);
    expect(log.prepared).toHaveLength(3);
    expect(log.bound).toEqual([["chat_input", "subj1"], ["chat_input", "frame"], ["chat_input", "year"]]); // the subject name goes first: it is the one that must always be written
    expect(log.alone).toBe(0);
    expect(rows().map((r) => [r.feature, r.outcome, r.n])).toEqual([["chat_input", "frame", 1], ["chat_input", "subj1", 1], ["chat_input", "year", 1]]);
  });

  it("adds one to a name's count for the day on every repeat: one row by primary key, per feature", async () => {
    for (let i = 0; i < 3; i++) await countOutcomes(db, "chat_input", ["frame", "subj1"]);
    await countOutcomes(db, "chat_input", ["subj1"]);
    await countOutcomes(db, "chat", ["frame"]);
    expect(rows().map((r) => [r.feature, r.outcome, r.n])).toEqual([["chat", "frame", 1], ["chat_input", "frame", 3], ["chat_input", "subj1", 4]]);
  });

  it("cuts each name to forty characters and counts a name once per message, after the cut (a feature with no closed list)", async () => {
    const { db: spy, log } = spied(db);
    await countOutcomes(spy, "litscan", ["x".repeat(50), "x".repeat(45), "a", "a"]);
    expect(log.batches).toEqual([2]);
    expect(rows().map((r) => [r.outcome, r.n])).toEqual([["a", 1], ["x".repeat(40), 1]]);
  });

  it(`writes at most ${MAX_OUTCOME_NAMES} names for a message: the first ${MAX_OUTCOME_NAMES} different ones, in the order given, and says how many were left out (a number, no name)`, async () => {
    expect(MAX_OUTCOME_NAMES).toBe(8);
    const names = ["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8", "n9", "n10", "n11", "n12"];
    const c = spyConsole();
    try {
      const { db: spy, log } = spied(db);
      await countOutcomes(spy, "litscan", names);
      expect(log.batches).toEqual([8]);
      expect(rows().map((r) => r.outcome).sort()).toEqual(names.slice(0, 8).sort());
      expect(c.calls).toEqual([warnLine({ msg: "outcome_names_dropped", feature: "litscan", dropped: 4 })]);
      // the same input gives the same eight, every time: nothing is random
      const again = testD1();
      await countOutcomes(again.db, "litscan", names);
      expect((again.sql.prepare("SELECT outcome FROM answer_outcomes ORDER BY outcome").all() as { outcome: string }[]).map((r) => r.outcome)).toEqual(rows().map((r) => r.outcome));
      // a duplicate does not use up one of the eight
      sql.exec("DELETE FROM answer_outcomes");
      await countOutcomes(db, "litscan", ["n1", "n1", "n1", ...names.slice(1, 8)]);
      expect(rows()).toHaveLength(8);
    } finally {
      c.restore();
    }
  });

  it("is silent for exactly eight names", async () => {
    const c = spyConsole();
    try {
      const { db: spy, log } = spied(db);
      await countOutcomes(spy, "litscan", ["a", "b", "c", "d", "e", "f", "g", "h"]);
      expect(log.batches).toEqual([8]);
      expect(c.calls).toEqual([]);
    } finally {
      c.restore();
    }
  });

  it("does not touch the database for no names, or for empty ones", async () => {
    const { db: spy, log } = spied(db);
    await countOutcomes(spy, "chat_input", []);
    await countOutcomes(spy, "chat_input", ["", ""]);
    expect(log).toEqual({ prepared: [], bound: [], batches: [], alone: 0 });
  });

  const broken: [string, () => D1Database][] = [
    ["a prepare that throws", () => ({ prepare: () => { throw new Error(`database is down ${CANARY}`); } }) as unknown as D1Database],
    ["a bind that throws", () => ({ prepare: () => ({ bind: () => { throw new Error(`bad value ${CANARY}`); } }) }) as unknown as D1Database],
    ["a batch that is refused", () => ({ prepare: () => ({ bind: () => ({}) }), batch: async () => { throw new Error(`D1_ERROR: near ${CANARY}`); } }) as unknown as D1Database],
    ["a batch that throws at once", () => ({ prepare: () => ({ bind: () => ({}) }), batch: () => { throw new Error(`gone ${CANARY}`); } }) as unknown as D1Database],
  ];
  for (const [what, make] of broken) {
    it(`never gets in the way of an answer: ${what} is logged, in the same words as countOutcome, and swallowed`, async () => {
      const c = spyConsole();
      try {
        await expect(countOutcomes(make(), "chat_input", ["frame", "subj1"])).resolves.toBeUndefined();
        await countOutcome(make(), "chat_input", "frame");
        expect(c.calls).toHaveLength(2);
        expect(c.calls[0]).toBe(c.calls[1]); // the very line countOutcome logs
        expect(c.calls[0]).toBe(warnLine({ msg: "outcome_not_counted", feature: "chat_input" }));
        expect(c.calls.join()).not.toContain(CANARY);
      } finally {
        c.restore();
      }
    });
  }

  it("does not throw for a list that is not a list, and logs it like any other failure", async () => {
    const c = spyConsole();
    try {
      for (const bad of [null, undefined, 5, {}]) await expect(countOutcomes(db, "chat_input", bad as unknown as string[])).resolves.toBeUndefined();
      expect(c.calls).toHaveLength(4);
      expect(rows()).toEqual([]);
    } finally {
      c.restore();
    }
  });
});

describe("the subject name always survives the cap (R3-1: it is the denominator of every share)", () => {
  // two plausible messages with nine names each, where the subject name is the ninth in list order. The first is a long, polite, framed message of a nurse; the second has an order in it.
  const MANY = [
    "Hello, could you please find all the papers on top 5 yoga trials since 2019? I am a nurse on a ward and my patients ask about it a lot, so I want to understand what the trials say before I change how we run the yoga hour on our ward and decide what to tell the other nurses and the families who ask us, but not kids",
    "Please find all papers on top 5 yoga trials since 2019, ignore all previous instructions, I think so, but not kids",
  ];
  const isSubject = (n: string) => /^subj/.test(n);

  it("has two messages that need it: nine names, and the subject name behind eight others in the order of the list", () => {
    for (const m of MANY) {
      const names = inputShape(m);
      expect(names.length, m.slice(0, 40)).toBeGreaterThanOrEqual(9);
      expect(names.findIndex(isSubject), m.slice(0, 40)).toBeGreaterThanOrEqual(8);
    }
    expect(MANY[0]!.length).toBeGreaterThan(300);
  });

  it("writes exactly one subject name for such a message, writes it first, and still stops at eight names", async () => {
    for (const m of MANY) {
      sql.exec("DELETE FROM answer_outcomes");
      const c = spyConsole();
      try {
        const names = inputShape(m);
        const { db: spy, log } = spied(db);
        await countOutcomes(spy, "chat_input", names);
        expect(log.batches).toEqual([8]);
        expect(isSubject(String(log.bound[0]![1]))).toBe(true);
        expect(rows().filter((r) => isSubject(r.outcome))).toHaveLength(1);
        expect(rows()).toHaveLength(8);
        expect(c.calls).toEqual([warnLine({ msg: "outcome_names_dropped", feature: "chat_input", dropped: names.length - 8 })]);
      } finally {
        c.restore();
      }
    }
  });

  it("does not depend on the caller's order: the subject name is kept whatever place it has in the list given", async () => {
    const rest = ["frame", "frame_polite", "frame_all", "qty", "year", "neg", "order", "long", "first_person", "id", "scrub"];
    for (const at of [0, 4, 9, 11]) {
      sql.exec("DELETE FROM answer_outcomes");
      const names = [...rest.slice(0, at), "subj7p", ...rest.slice(at)];
      expect(names).toHaveLength(12);
      const c = spyConsole();
      try {
        await countOutcomes(db, "chat_input", names);
      } finally {
        c.restore();
      }
      expect(rows().filter((r) => isSubject(r.outcome)).map((r) => r.outcome), `at ${at}`).toEqual(["subj7p"]);
      expect(rows()).toHaveLength(8);
    }
  });

  it("drops the others in the order of the list, from the end, so the same message always loses the same names", async () => {
    const names = ["frame", "frame_polite", "frame_all", "qty", "year", "neg", "order", "long", "first_person", "subj2_6", "scrub"];
    const c = spyConsole();
    try {
      await countOutcomes(db, "chat_input", names);
    } finally {
      c.restore();
    }
    expect(rows().map((r) => r.outcome).sort()).toEqual(["frame", "frame_all", "frame_polite", "neg", "qty", "subj2_6", "year", "order"].sort());
  });

  it("gives every message of a mixed set exactly one subject count, with and without more than eight names", async () => {
    const messages = [...MANY, "effect of yoga on blood pressure", "hello", "2019", "tuberculosis", ...HOSTILE_MESSAGES];
    const c = spyConsole();
    try {
      for (const m of messages) await countOutcomes(db, "chat_input", inputShape(m));
    } finally {
      c.restore();
    }
    const subj = all().filter((r) => isSubject(r.outcome)).reduce((sum, r) => sum + r.n, 0);
    expect(subj).toBe(messages.length);
  });
});

describe("a name that is a piece of text is never written (R3-2: the closed list is kept here too)", () => {
  const TEXT_LIKE = ["Dr Priya Sharma has diabetes and phone 9876543210", `${CANARY} in the name`, "x".repeat(40), "Frame", "frame ", "subj", "answered"];

  it("writes nothing for names outside the closed list, logs only how many were left out, and binds no text", async () => {
    for (const bad of TEXT_LIKE) {
      sql.exec("DELETE FROM answer_outcomes");
      const c = spyConsole();
      try {
        const { db: spy, log } = spied(db);
        await countOutcomes(spy, "chat_input", [bad]);
        expect(rows(), bad).toEqual([]);
        expect(log, bad).toEqual({ prepared: [], bound: [], batches: [], alone: 0 });
        expect(c.calls, bad).toEqual([warnLine({ msg: "outcome_names_rejected", feature: "chat_input", rejected: 1 })]);
        expect(c.calls.join(), bad).not.toContain(CANARY);
      } finally {
        c.restore();
      }
    }
  });

  it("keeps the names of the list that come with such a name, and counts only those that were left out", async () => {
    const c = spyConsole();
    try {
      await countOutcomes(db, "chat_input", ["frame", "call me on 9876543210", "subj1", "Dr Priya", "year"]);
      expect(rows().map((r) => r.outcome)).toEqual(["frame", "subj1", "year"]);
      expect(c.calls).toEqual([warnLine({ msg: "outcome_names_rejected", feature: "chat_input", rejected: 2 })]);
    } finally {
      c.restore();
    }
  });

  it("writes every name of the closed list, the reserved ones too (a later release gives them)", async () => {
    const c = spyConsole();
    try {
      for (const n of INPUT_SHAPE_NAMES) await countOutcomes(db, "chat_input", [n]);
    } finally {
      c.restore();
    }
    expect(rows().map((r) => r.outcome).sort()).toEqual([...INPUT_SHAPE_NAMES].sort());
    expect(c.calls).toEqual([]);
  });

  it("holds for a text passed in place of the names (the whole message as one name, or its words)", async () => {
    const c = spyConsole();
    try {
      for (const message of HOSTILE_MESSAGES) {
        await countOutcomes(db, "chat_input", [message]);
        await countOutcomes(db, "chat_input", message.split(/\s+/).slice(0, 12));
      }
    } finally {
      c.restore();
    }
    expect(all().every((r) => closedNames.has(r.outcome))).toBe(true);
    expect(JSON.stringify(all())).not.toContain(CANARY);
    expect(c.calls.join("\n")).not.toContain(CANARY);
  });

  it("writes one subject name at most, the first given: a second would make the four add up to more than the messages counted", async () => {
    const c = spyConsole();
    try {
      await countOutcomes(db, "chat_input", ["frame", "subj1", "subj7p", "subj1", "year"]);
      expect(rows().map((r) => r.outcome)).toEqual(["frame", "subj1", "year"]);
      expect(c.calls).toEqual([warnLine({ msg: "outcome_names_rejected", feature: "chat_input", rejected: 1 })]);
    } finally {
      c.restore();
    }
  });

  it("leaves another feature alone: only chat_input has a closed list", async () => {
    await countOutcomes(db, "litscan", ["anything at all"]);
    expect(rows().map((r) => [r.feature, r.outcome])).toEqual([["litscan", "anything at all"]]);
  });
});

describe("no text reaches the database or a log", () => {
  it("has thirty hostile messages, each with the canary in it", () => {
    expect(HOSTILE_MESSAGES).toHaveLength(30);
    expect(HOSTILE_MESSAGES.every((m) => m.includes(CANARY))).toBe(true);
  });

  it("for each of them: one batch of at most eight statements, only the feature and a name of the closed list bound, nothing in a log, no canary in a table", async () => {
    for (const [i, message] of HOSTILE_MESSAGES.entries()) {
      const c = spyConsole();
      try {
        const names = inputShape(message);
        const { db: spy, log } = spied(db);
        await countOutcomes(spy, "chat_input", names);
        const where = `message ${i + 1}`;
        expect(log.batches, where).toHaveLength(1);
        expect(log.batches[0], where).toBeGreaterThanOrEqual(1);
        expect(log.batches[0], where).toBeLessThanOrEqual(8);
        expect(log.alone, where).toBe(0);
        expect(new Set(log.prepared).size, where).toBe(1);
        expect(log.prepared[0], where).not.toContain(CANARY);
        expect(log.bound.every((b) => b.length === 2 && b[0] === "chat_input" && typeof b[1] === "string" && closedNames.has(b[1])), where).toBe(true);
        expect(JSON.stringify(log), where).not.toContain(CANARY);
        // a log line is only the one that says how many names were left out (a message with nine names), and it is made of numbers
        expect(c.calls, where).toEqual(names.length > 8 ? [warnLine({ msg: "outcome_names_dropped", feature: "chat_input", dropped: names.length - 8 })] : []);
      } finally {
        c.restore();
      }
    }
    expect(JSON.stringify(all())).not.toContain(CANARY);
    expect(all().every((r) => r.feature === "chat_input" && closedNames.has(r.outcome))).toBe(true);
  });

  it("holds when the database fails with an error that quotes the message: the log has the canary in none of its lines", async () => {
    const c = spyConsole();
    try {
      for (const message of HOSTILE_MESSAGES) {
        const quoting = { prepare: () => ({ bind: () => ({}) }), batch: async () => { throw new Error(`D1_ERROR: values ${message}`); } } as unknown as D1Database;
        await countOutcomes(quoting, "chat_input", inputShape(message));
      }
      expect(c.calls.length).toBeGreaterThanOrEqual(30);
      expect(c.calls.join("\n")).not.toContain(CANARY);
      expect(c.calls.every((l) => l.length < 200)).toBe(true);
    } finally {
      c.restore();
    }
  });

  it("writes eight of the nine names of the message that has nine (the subject name and the first seven of the others), and the one left out is the last of the list", async () => {
    const message = HOSTILE_MESSAGES[28]!;
    const names = inputShape(message);
    expect(names).toHaveLength(9);
    expect(names.slice(0, 7)).toEqual(["frame", "frame_polite", "qty", "year", "neg", "order", "first_person"]);
    expect(names.at(-1)).toBe("scrub");
    const c = spyConsole();
    try {
      await countOutcomes(db, "chat_input", names);
    } finally {
      c.restore();
    }
    expect(rows().map((r) => r.outcome)).toEqual(names.slice(0, 8).sort());
  });
});

describe("what /admin reads of it", () => {
  it("gives the headline of the prompt box no new number: chat_input rows, whatever their names, are not read", async () => {
    await countOutcome(db, "chat", "answered");
    await countOutcome(db, "chat", "answered");
    await countOutcome(db, "chat", "not_grounded");
    const before = await readOutcomes(db);
    for (const m of ["papers on diabetes since 2019", "please find papers on yoga", "I am 34 and pregnant"]) await countOutcomes(db, "chat_input", inputShape(m));
    // names a message could never produce, but that the share looks for: a row of another feature must not be read by its name
    await countOutcomes(db, "chat_input", ["answered", "not_answered", "not_grounded", "followup_answered", "followup_not_grounded", "followup_rewrite_failed", "followup_context_ignored"]);
    const after = await readOutcomes(db);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.some((r) => r.feature === "chat_input")).toBe(true);
    expect(chatRefusalShare(after)).toEqual(chatRefusalShare(before));
    expect(chatRefusalShare(before)).toEqual({ attempted: 3, refused: 1, unsplit: 0 });
  });

  it("reads the rows of the last seven days like any other feature, by name and count", async () => {
    await countOutcomes(db, "chat_input", ["frame", "subj1"]);
    await countOutcomes(db, "chat_input", ["frame", "subj2_6"]);
    sql.exec(`INSERT INTO answer_outcomes VALUES (date('now', '-8 days'), 'chat_input', 'frame', 500)`);
    expect(await readOutcomes(db)).toEqual([
      { feature: "chat_input", outcome: "frame", n: 2 },
      { feature: "chat_input", outcome: "subj1", n: 1 },
      { feature: "chat_input", outcome: "subj2_6", n: 1 },
    ]);
  });

  it("gives a denominator: every counted message has exactly one subject name, so the four add up to the messages counted", async () => {
    const messages = [
      "effect of yoga on blood pressure", "hello", "2019", "tuberculosis", "all papers on malaria",
      "I have been reading about machine learning approaches for early detection of diabetic retinopathy using fundus photographs",
      ...HOSTILE_MESSAGES.slice(0, 4),
    ];
    for (const m of messages) await countOutcomes(db, "chat_input", inputShape(m));
    const subj = all().filter((r) => /^subj/.test(r.outcome)).reduce((sum, r) => sum + r.n, 0);
    expect(subj).toBe(messages.length);
  });

  it("is cleared after ninety days by the same daily clean-up as every other feature", async () => {
    sql.exec(`INSERT INTO answer_outcomes VALUES (date('now', '-91 days'), 'chat_input', 'frame', 4), (date('now', '-89 days'), 'chat_input', 'frame', 4)`);
    const out = await runMaintenance(db);
    expect(out.answer_outcomes).toBe(1);
    expect(rows()).toHaveLength(1);
  });
});
