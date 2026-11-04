import { describe, expect, it } from "vitest";
import { testD1 } from "./test-d1";
import { MAINTENANCE_JOBS } from "./maintenance";
import { JOB_SPECS, runJob } from "./jobs";
import { COUNT_SQL } from "./outcomes";

/**
 * The query plans of what runs often or on big tables (docs/design/scalability.md). A table that holds a row for every call or every visit grows without a limit, and a query that
 * reads all of it gets slower every day and bills for every row read. These tests read the plan SQLite chooses (D1 is SQLite) and fail when a hot query or a nightly purge
 * has to read a whole table, so a new query or a dropped index is noticed in review, not in production.
 */
const { sql } = testD1();
const plan = (text: string, args: unknown[] = []): string => (sql.prepare(`EXPLAIN QUERY PLAN ${text}`).all(...(args as never[])) as { detail: string }[]).map((r) => r.detail).join(" | ");
/** True when some step reads every row of a table (a SCAN that is not through an index). */
const scans = (p: string) => p.split(" | ").some((step) => /^SCAN\b/.test(step) && !/USING (COVERING )?INDEX/.test(step) && !/\bUSING INTEGER PRIMARY KEY\b/.test(step));

describe("the nightly purges read only what they delete", () => {
  for (const job of MAINTENANCE_JOBS) {
    it(`${job.name}: ${job.sql.slice(0, 70)}`, () => {
      const p = plan(job.sql);
      expect(scans(p), p).toBe(false);
    });
  }
  it("every purge deletes only what is past its date (a purge with no date would empty the table)", () => {
    for (const job of MAINTENANCE_JOBS) expect(job.sql, job.name).toMatch(/WHERE/);
  });
});

describe("what runs on every request or every call reads a few rows", () => {
  const HOT: [string, string, unknown[]][] = [
    ["the session", "SELECT u.id, (s.last_seen_at < datetime('now', '-1 day')) AS stale FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?1 AND s.expires_at > datetime('now') AND u.deleted_at IS NULL", ["x"]],
    ["a person's tokens of today", "SELECT COALESCE(SUM(tokens_in + tokens_out), 0) AS t FROM llm_usage WHERE subject = ?1 AND ts >= date('now')", ["u"]],
    ["the sign-in methods of a person", "SELECT DISTINCT provider FROM identities WHERE user_id = ?1", ["u"]],
    ["the library", "SELECT paper_id, data FROM library_items WHERE user_id = ?1 ORDER BY saved_at DESC LIMIT 2000", ["u"]],
    ["the papers of a person", "SELECT id FROM documents WHERE user_id = ?1 ORDER BY created_at DESC", ["u"]],
    ["the events of a scan after one", "SELECT seq, data FROM litscan_events WHERE scan_id = ?1 AND seq > ?2 ORDER BY seq", ["s", 0]],
    ["one tick of the scan stream", "SELECT l.state AS state, e.seq AS seq, e.data AS data FROM litscans l LEFT JOIN litscan_events e ON e.scan_id = l.id AND e.seq > ?2 WHERE l.id = ?1 ORDER BY e.seq LIMIT ?3", ["s", 0, 201]],
    ["the highlights offered by Remember this (count)", "SELECT COUNT(*) AS n FROM doc_notes n JOIN documents d ON d.id = n.doc_id WHERE d.user_id = ?1 AND length(n.quote) >= 40", ["u"]],
    ["the usage of the last 14 days (admin)", "SELECT provider, model, COUNT(*) FROM llm_usage WHERE ts >= date('now', '-14 days') GROUP BY provider, model", []],
    ["the DOIs of saved papers that were never checked", "SELECT DISTINCT l.doi FROM library_items l WHERE l.doi IS NOT NULL AND NOT EXISTS (SELECT 1 FROM paper_retraction r WHERE r.doi = l.doi) LIMIT ?1", [400]],
    ["the DOIs to look at again", "SELECT r.doi FROM paper_retraction r WHERE r.state <> 'retracted' AND r.checked_at < datetime('now', '-7 days') ORDER BY r.checked_at LIMIT ?1", [400]],
    ["the people who saved a paper that turned out retracted", "SELECT user_id, paper_id FROM library_items WHERE doi = ?1", ["10.1/x"]],
    ["the usage of a feature in the last 14 days (admin)", "SELECT label, COUNT(*) FROM llm_usage WHERE ts >= date('now', '-14 days') GROUP BY label", []],
    // the Trending job (src/trending) keeps its list in KV and touches the database only for its heartbeat, like every scheduled job: both writes are by the job's name, the table's primary key
    ["the heartbeat of a scheduled job at its end, when it went well (the Trending job's too)", "UPDATE job_runs SET last_finished_at = datetime('now'), last_result = 'ok', last_ok_at = datetime('now'), last_error = NULL WHERE name = ?1", ["trending"]],
    ["the heartbeat of a scheduled job at its end, when it failed (the Trending job's too)", "UPDATE job_runs SET last_finished_at = datetime('now'), last_result = 'failed', last_error = ?2, failures = failures + 1 WHERE name = ?1", ["trending", "x"]],
  ];
  for (const [name, text, args] of HOT) {
    it(name, () => {
      const p = plan(text, args);
      expect(scans(p), p).toBe(false);
    });
  }
});

describe("a count is one row by the primary key, however many a day has", () => {
  // R3 (CHAT_COUNTERS=on): every message of the prompt box writes up to eight of these in one batch, and every answer one. SQLite prints no plan at all for an INSERT with ON CONFLICT (the plan of the
  // statement is empty, so the check above would pass for any statement), so what is checked is what makes it one row: its conflict target is the primary key of the table, and a row is found by that key.
  it("the upsert of a count names the whole primary key (day, feature, outcome) as its conflict target, which is the table's primary key", () => {
    const pk = (sql.prepare("PRAGMA table_info(answer_outcomes)").all() as { name: string; pk: number }[]).filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    expect(pk).toEqual(["day", "feature", "outcome"]);
    expect(COUNT_SQL).toBe("INSERT INTO answer_outcomes (day, feature, outcome, n) VALUES (date('now'), ?1, ?2, 1) ON CONFLICT (day, feature, outcome) DO UPDATE SET n = n + 1");
  });
  it("a row by that key is found by the key (a search by the primary key's index, no scan), and the rows of the last seven days are read by the day, its first column", () => {
    const byKey = plan("UPDATE answer_outcomes SET n = n + 1 WHERE day = ?1 AND feature = ?2 AND outcome = ?3", ["2026-11-04", "chat_input", "frame"]);
    expect(byKey).toContain("SEARCH answer_outcomes USING INDEX sqlite_autoindex_answer_outcomes_1 (day=? AND feature=? AND outcome=?)");
    const week = plan("SELECT feature, outcome, SUM(n) AS n FROM answer_outcomes WHERE day >= date('now', '-6 days') GROUP BY feature, outcome ORDER BY feature, SUM(n) DESC, outcome", []);
    expect(week).toContain("SEARCH answer_outcomes USING INDEX sqlite_autoindex_answer_outcomes_1 (day>?)");
    expect(scans(byKey), byKey).toBe(false);
  });
});

describe("the heartbeat table cannot grow", () => {
  // /api/v1/health/jobs reads all of job_runs (one row per scheduled job): that is cheap only while the table stays that small, so a run must update its row, never add one
  it("has one row per scheduled job after any number of runs, the Trending job's included: its start is an upsert on its name", async () => {
    const { db, sql: raw } = testD1();
    const before = (raw.prepare("SELECT COUNT(*) AS n FROM job_runs").get() as { n: number }).n;
    expect(before).toBe(Object.keys(JOB_SPECS).length); // the migrations seed exactly the jobs there are
    for (let i = 0; i < 5; i++) {
      await runJob(db, "trending", async () => i);
      await runJob(db, "trending", async () => { throw new Error("boom"); }).catch(() => undefined);
    }
    expect((raw.prepare("SELECT COUNT(*) AS n FROM job_runs").get() as { n: number }).n).toBe(before);
    expect((raw.prepare("SELECT runs, failures FROM job_runs WHERE name = 'trending'").get() as { runs: number; failures: number })).toEqual({ runs: 10, failures: 5 });
  });
});
