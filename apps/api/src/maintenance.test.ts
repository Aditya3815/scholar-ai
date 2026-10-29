import { describe, expect, it, vi } from "vitest";
import { testD1 } from "./test-d1";
import { MAINTENANCE_JOBS, chunkedDelete, runMaintenance } from "./maintenance";

const count = (sql: ReturnType<typeof testD1>["sql"], table: string) => (sql.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const fill = (sql: ReturnType<typeof testD1>["sql"], table: "llm_usage", old: number, fresh: number) => {
  const add = sql.prepare("INSERT INTO llm_usage (subject, task, sensitivity, provider, model, tokens_in, tokens_out, cost_cents, ok, ms, ts) VALUES ('u','qa','private','p','m',1,1,0,1,1, datetime('now', ?))");
  sql.exec("BEGIN");
  for (let i = 0; i < old; i++) add.run("-120 days");
  for (let i = 0; i < fresh; i++) add.run("-1 days");
  sql.exec("COMMIT");
  return table;
};

describe("chunkedDelete", () => {
  it("turns a purge into one that takes at most N rows a time, through the row number", () => {
    expect(chunkedDelete("DELETE FROM llm_usage WHERE ts < datetime('now', '-90 days')")).toBe("DELETE FROM llm_usage WHERE rowid IN (SELECT rowid FROM llm_usage WHERE ts < datetime('now', '-90 days') LIMIT ?1)");
  });
  it("keeps a condition that has a sub-select, and refuses anything that is not a plain DELETE ... WHERE", () => {
    expect(chunkedDelete("DELETE FROM litscan_events WHERE scan_id IN (SELECT id FROM litscans WHERE expires_at < datetime('now'))")).toContain("LIMIT ?1)");
    for (const bad of ["DELETE FROM llm_usage", "UPDATE llm_usage SET ok = 0 WHERE 1", "DROP TABLE llm_usage", "DELETE FROM a WHERE b; DELETE FROM c WHERE d", "SELECT 1"]) expect(() => chunkedDelete(bad)).toThrow();
  });
  it("every purge of the app can be made chunked", () => {
    for (const job of MAINTENANCE_JOBS) expect(() => chunkedDelete(job.sql), job.name).not.toThrow();
  });
});

describe("runMaintenance", () => {
  it("deletes what is past its date and nothing else, and counts it", async () => {
    const { db, sql } = testD1();
    fill(sql, "llm_usage", 30, 20);
    const out = await runMaintenance(db);
    expect(out.llm_usage).toBe(30);
    expect(count(sql, "llm_usage")).toBe(20);
    expect(Object.keys(out)).toEqual(MAINTENANCE_JOBS.map((j) => j.name));
  });
  it("takes a big table in pieces: 12,000 old rows with pieces of 5,000 are all gone, the new ones stay, and the count is the whole", async () => {
    const { db, sql } = testD1();
    fill(sql, "llm_usage", 12_000, 100);
    const run = vi.spyOn(db, "prepare");
    const out = await runMaintenance(db, { chunk: 5000 });
    expect(out.llm_usage).toBe(12_000);
    expect(count(sql, "llm_usage")).toBe(100);
    expect(run.mock.calls.filter(([q]) => /FROM llm_usage WHERE rowid IN/.test(q)).length).toBe(3);
  });
  it("one piece of exactly the chunk's size asks once more and stops when nothing is left", async () => {
    const { db, sql } = testD1();
    fill(sql, "llm_usage", 10, 0);
    const run = vi.spyOn(db, "prepare");
    const out = await runMaintenance(db, { chunk: 5 });
    expect(out.llm_usage).toBe(10);
    expect(run.mock.calls.filter(([q]) => /FROM llm_usage WHERE rowid IN/.test(q)).length).toBe(3);
  });
  it("a job that fails does not stop the others, and the run then fails, naming it (so the job's health check says so)", async () => {
    const { db, sql } = testD1();
    fill(sql, "llm_usage", 5, 0);
    const jobs = [{ name: "broken", sql: "DELETE FROM no_such_table WHERE x < 1" }, { name: "llm_usage", sql: "DELETE FROM llm_usage WHERE ts < datetime('now', '-90 days')" }];
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runMaintenance(db, { jobs })).rejects.toThrow(/broken/);
    expect(count(sql, "llm_usage")).toBe(0);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
  it("stops at its time budget and leaves the rest for tomorrow, without failing", async () => {
    const { db, sql } = testD1();
    fill(sql, "llm_usage", 30, 0);
    let t = 0;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await runMaintenance(db, { chunk: 10, budgetMs: 15, now: () => (t += 10) });
    expect(out.llm_usage).toBeLessThan(30);
    expect(count(sql, "llm_usage")).toBe(30 - out.llm_usage!);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    // the next night takes up where this one stopped
    expect((await runMaintenance(db, { chunk: 10 })).llm_usage).toBe(30 - out.llm_usage!);
    expect(count(sql, "llm_usage")).toBe(0);
  });
  it("an empty database is fine, and a second run does nothing", async () => {
    const { db } = testD1();
    const a = await runMaintenance(db);
    const b = await runMaintenance(db);
    expect(Object.values(a).every((n) => n === 0)).toBe(true);
    expect(b).toEqual(a);
  });
  it("a chunk of zero or less is not allowed to loop for ever", async () => {
    const { db, sql } = testD1();
    fill(sql, "llm_usage", 3, 0);
    expect((await runMaintenance(db, { chunk: 0 })).llm_usage).toBe(3);
  });
});
