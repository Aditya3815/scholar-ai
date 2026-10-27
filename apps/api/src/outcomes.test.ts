import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { OUTCOME_RETENTION_SQL, askOutcome, countOutcome, readOutcomes } from "./outcomes";
import { runMaintenance } from "./maintenance";
import { testD1 } from "./test-d1";

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
