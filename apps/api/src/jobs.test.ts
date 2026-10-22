import { afterEach, describe, expect, it, vi } from "vitest";
import { JOB_SPECS, STUCK_AFTER_MS, jobState, jobStatuses, runJob, type JobRow } from "./jobs";

const SPEC = JOB_SPECS.maintenance; // 24 h + 6 h grace
const NOW = Date.parse("2026-10-22T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString().slice(0, 19).replace("T", " ");
const H = 3_600_000;

const row = (over: Partial<JobRow> = {}): JobRow => ({
  name: "maintenance", last_started_at: ago(10 * H), last_finished_at: ago(10 * H), last_result: "ok", last_ok_at: ago(10 * H), last_error: null, runs: 5, failures: 0, ...over,
});

describe("jobState", () => {
  it("is ok after a recent good run", () => {
    expect(jobState(row(), SPEC, NOW)).toBe("ok");
  });
  it("allows the grace: a daily job is overdue only after 30 hours", () => {
    expect(jobState(row({ last_ok_at: ago(29.9 * H), last_started_at: ago(29.9 * H), last_finished_at: ago(29.9 * H) }), SPEC, NOW)).toBe("ok");
    expect(jobState(row({ last_ok_at: ago(30.1 * H), last_started_at: ago(30.1 * H), last_finished_at: ago(30.1 * H) }), SPEC, NOW)).toBe("overdue");
  });
  it("reports a job that has no row (it never reported, or the row was lost) as overdue, not as fine", () => {
    expect(jobState(undefined, SPEC, NOW)).toBe("overdue");
  });
  it("reports a row with no good run, or an unreadable time, as overdue", () => {
    expect(jobState(row({ last_ok_at: null }), SPEC, NOW)).toBe("overdue");
    expect(jobState(row({ last_ok_at: "not a time" }), SPEC, NOW)).toBe("overdue");
  });
  it("reports a failed last run as failing, even when the last good run is recent", () => {
    expect(jobState(row({ last_result: "failed", last_error: "boom" }), SPEC, NOW)).toBe("failing");
  });
  it("failing comes before overdue: the more useful word wins", () => {
    expect(jobState(row({ last_result: "failed", last_ok_at: ago(100 * H) }), SPEC, NOW)).toBe("failing");
  });
  it("a run that failed and then a run that succeeded in the same second is ok (the result is stored, not guessed from the times)", () => {
    const t = ago(2 * H);
    expect(jobState(row({ last_result: "ok", last_ok_at: t, last_started_at: t, last_finished_at: t }), SPEC, NOW)).toBe("ok");
  });
  it("a run in progress is fine, one that has not finished after an hour is stuck", () => {
    expect(jobState(row({ last_started_at: ago(5 * 60_000), last_finished_at: ago(10 * H) }), SPEC, NOW)).toBe("ok");
    expect(jobState(row({ last_started_at: ago(STUCK_AFTER_MS - 1000), last_finished_at: ago(10 * H) }), SPEC, NOW)).toBe("ok");
    expect(jobState(row({ last_started_at: ago(STUCK_AFTER_MS + 1000), last_finished_at: ago(10 * H) }), SPEC, NOW)).toBe("stuck");
  });
  it("a first run that started and never finished (no finish time) is stuck after an hour", () => {
    expect(jobState(row({ last_started_at: ago(2 * H), last_finished_at: null }), SPEC, NOW)).toBe("stuck");
  });
  it("a start time in the future (clock skew) is not reported as stuck", () => {
    expect(jobState(row({ last_started_at: ago(-2 * 60_000), last_finished_at: ago(10 * H) }), SPEC, NOW)).toBe("ok");
  });
});

describe("jobStatuses", () => {
  it("lists every known job once, even with no rows, and ignores rows of jobs that no longer exist", () => {
    const out = jobStatuses([row({ name: "retired-job" })], NOW);
    expect(out).toHaveLength(Object.keys(JOB_SPECS).length);
    expect(out[0]).toMatchObject({ name: "maintenance", state: "overdue", lastOkAt: null, runs: 0 });
  });
  it("gives times as ISO strings and keeps the error text of a failing job", () => {
    const [j] = jobStatuses([row({ last_result: "failed", last_error: "no such table", failures: 2 })], NOW);
    expect(j).toMatchObject({ state: "failing", lastOkAt: "2026-10-22T02:00:00.000Z", lastError: "no such table", failures: 2 });
  });
});

/** The smallest stand-in for D1 that records the statements it is given, and can be made to fail. */
function fakeDb(opts: { failOn?: RegExp } = {}) {
  const sql: string[] = [];
  const db = {
    prepare(s: string) {
      return {
        bind: (...args: unknown[]) => ({
          run: async () => {
            if (opts.failOn?.test(s)) throw new Error("D1 is down");
            sql.push(`${s.split(" ").slice(0, 2).join(" ")} | ${args.map(String).join(",")}`);
            return { success: true };
          },
        }),
      };
    },
  } as unknown as D1Database;
  return { db, sql };
}

describe("runJob", () => {
  afterEach(() => vi.restoreAllMocks());

  it("records the start, runs the job and records a good finish, returning the job's value", async () => {
    const { db, sql } = fakeDb();
    expect(await runJob(db, "maintenance", async () => ({ deleted: 3 }))).toEqual({ deleted: 3 });
    expect(sql).toHaveLength(2);
    expect(sql[0]).toMatch(/^INSERT INTO/);
    expect(sql[1]).toMatch(/^UPDATE job_runs/);
    expect(sql[1]).toContain("maintenance");
  });

  it("records a failure with a short, cleaned message, and rethrows the job's own error", async () => {
    const { db, sql } = fakeDb();
    const boom = new Error("cannot reach https://secret.example/x?token=abc for someone@example.org ".repeat(8));
    await expect(runJob(db, "maintenance", async () => { throw boom; })).rejects.toBe(boom);
    const failed = sql[1]!;
    expect(failed).toMatch(/^UPDATE job_runs/);
    expect(failed).not.toMatch(/someone@example\.org|secret\.example/);
    expect(failed.split("|")[1]!.split(",")[1]!.length).toBeLessThanOrEqual(200);
  });

  it("a job that throws something that is not an Error is still recorded and rethrown unchanged", async () => {
    const { db, sql } = fakeDb();
    await expect(runJob(db, "maintenance", async () => { throw "plain string"; })).rejects.toBe("plain string");
    expect(sql[1]).toContain("plain string");
  });

  it("a heartbeat that cannot be written never changes the job's result", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb({ failOn: /./ });
    expect(await runJob(db, "maintenance", async () => "done")).toBe("done");
    expect(log).toHaveBeenCalledTimes(2); // start and finish, both reported
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({ msg: "job_heartbeat_failed", step: "start" });
  });

  it("a heartbeat that cannot be written does not hide the job's own error either", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb({ failOn: /./ });
    const boom = new Error("real failure");
    await expect(runJob(db, "maintenance", async () => { throw boom; })).rejects.toBe(boom);
  });

  it("does not run the job twice, and runs it even when the start could not be recorded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb({ failOn: /^INSERT/ });
    const job = vi.fn(async () => 1);
    await runJob(db, "maintenance", job);
    expect(job).toHaveBeenCalledTimes(1);
  });
});
