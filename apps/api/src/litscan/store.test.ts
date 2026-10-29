import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { LITSCAN_PURGE_SQL, appendEvent, createScan, deleteScan, endScan, eventsAfter, failIfStale, getScan, itemsOf, listScans, partsOf, refundScan, runningScan, snapshotOf, takeScan, tickOf } from "./store";
import { testD1 } from "../test-d1";
import type { LitscanItem, LitscanPart } from "@scholar/shared";

let db: D1Database;
let sql: DatabaseSync;
const items: LitscanItem[] = [
  { question: "Q one?", searchQuery: "alpha beta" },
  { question: "Q two?", searchQuery: "gamma delta" },
];
const answered = (idx: number): LitscanPart => ({ idx, status: "answered", found: 5, text: "Claim [1].", sources: [{ n: 1, paperId: "doi:10.1/a", title: "T", year: 2020, doi: "10.1/a", authors: [], venue: null, url: null }], citations: [{ n: 1, paperId: "doi:10.1/a", sentenceNo: 2, sentence: "S." }] });
const gap = (idx: number): LitscanPart => ({ idx, status: "gap", found: 0, reason: "nothing_found" });
const make = (id = "s1", userId = "u1") => createScan(db, { id, userId, topic: "a topic of research", language: "en", items, estimate: 4400 });
const state = (id: string) => (sql.prepare("SELECT state FROM litscans WHERE id = ?").get(id) as { state: string }).state;

beforeEach(() => {
  ({ db, sql } = testD1());
  sql.prepare("INSERT INTO users (id, email) VALUES ('u1', 'u1@example.com'), ('u2', 'u2@example.com')").run();
});

describe("a scan and its events", () => {
  it("is created running, with its plan and a started event, and read back by its owner only", async () => {
    await make();
    const row = await getScan(db, "s1", "u1");
    expect(row).toMatchObject({ state: "running", topic: "a topic of research", language: "en", est_tokens: 4400 });
    expect(itemsOf(row!)).toEqual(items);
    expect(await getScan(db, "s1", "u2")).toBeNull();
    expect(await getScan(db, "nope", "u1")).toBeNull();
    expect(await eventsAfter(db, "s1", 0)).toEqual([{ type: "started", total: 2, seq: 1 }]);
  });

  it("keeps events in order with their place, and returns only those after a given one", async () => {
    await make();
    await appendEvent(db, "s1", "w:0:searching", { type: "worker", idx: 0, stage: "searching" });
    await appendEvent(db, "s1", "part:0", { type: "part", part: gap(0) });
    expect((await eventsAfter(db, "s1", 0)).map((e) => [e.seq, e.type])).toEqual([[1, "started"], [2, "worker"], [3, "part"]]);
    expect((await eventsAfter(db, "s1", 2)).map((e) => e.seq)).toEqual([3]);
    expect(await eventsAfter(db, "s1", 3)).toEqual([]);
  });

  it("stores an event once: a retried step writing its result again changes nothing", async () => {
    await make();
    expect(await appendEvent(db, "s1", "part:0", { type: "part", part: answered(0) })).toBe(true);
    expect(await appendEvent(db, "s1", "part:0", { type: "part", part: gap(0) })).toBe(false);
    const parts = await partsOf(db, "s1");
    expect(parts).toHaveLength(1);
    expect(parts[0]!.status).toBe("answered");
  });

  it("does not take an event for a scan that has ended, or one that is not there", async () => {
    await make();
    await endScan(db, "s1", "canceled");
    expect(await appendEvent(db, "s1", "part:1", { type: "part", part: gap(1) })).toBe(false);
    expect(await appendEvent(db, "ghost", "part:1", { type: "part", part: gap(1) })).toBe(false);
    expect(await partsOf(db, "s1")).toEqual([]);
    expect(sql.prepare("SELECT COUNT(*) AS n FROM litscan_events WHERE scan_id = 'ghost'").get()).toEqual({ n: 0 });
  });

  it("gives every event its own place even when two are written at the same moment", async () => {
    await make();
    await Promise.all([0, 1, 2, 3, 4].map((i) => appendEvent(db, "s1", `w:${i}`, { type: "worker", idx: i, stage: "searching" })));
    const seqs = (await eventsAfter(db, "s1", 0)).map((e) => e.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("what the stream reads on each tick", () => {
  it("is the state and the new events in ONE query", async () => {
    await make();
    await appendEvent(db, "s1", "part:0", { type: "part", part: gap(0) });
    const prepare = vi.spyOn(db, "prepare");
    const t = await tickOf(db, "s1", 1);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(t.state).toBe("running");
    expect(t.events.map((e) => [e.seq, e.type])).toEqual([[2, "part"]]);
    expect(t.more).toBe(false);
  });
  it("gives the state with no events when there is nothing after the one asked, and again once the scan has ended", async () => {
    await make();
    expect(await tickOf(db, "s1", 1)).toEqual({ state: "running", events: [], more: false });
    await endScan(db, "s1", "completed");
    const t = await tickOf(db, "s1", 1);
    expect(t.state).toBe("completed");
    expect(t.events.map((e) => e.type)).toEqual(["done"]);
    expect(await tickOf(db, "s1", 2)).toEqual({ state: "completed", events: [], more: false });
  });
  it("a scan that is not there has no state and no events", async () => {
    expect(await tickOf(db, "ghost", 0)).toEqual({ state: null, events: [], more: false });
  });
  it("takes at most the cap, says there is more, and the next tick takes up after the last one sent", async () => {
    await make();
    for (let i = 0; i < 6; i++) await appendEvent(db, "s1", `w:${i}`, { type: "worker", idx: 0, stage: "searching" });
    const a = await tickOf(db, "s1", 0, 4);
    expect(a.events.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    expect(a.more).toBe(true);
    const b = await tickOf(db, "s1", 4, 4);
    expect(b.events.map((e) => e.seq)).toEqual([5, 6, 7]);
    expect(b.more).toBe(false);
  });
  it("exactly the cap is not 'more'", async () => {
    await make();
    await appendEvent(db, "s1", "w:0", { type: "worker", idx: 0, stage: "searching" });
    expect(await tickOf(db, "s1", 0, 2)).toMatchObject({ more: false });
  });
  it("another scan's events are never in it", async () => {
    await make("s1");
    await make("s2");
    expect((await tickOf(db, "s1", 0)).events.every((e) => e.type === "started")).toBe(true);
    expect((await tickOf(db, "s1", 0)).events).toHaveLength(1);
  });
});

describe("ending a scan", () => {
  it("writes one done event with the counts and the state, and only the first end counts", async () => {
    await make();
    await appendEvent(db, "s1", "part:0", { type: "part", part: answered(0) });
    await appendEvent(db, "s1", "part:1", { type: "part", part: gap(1) });
    expect(await endScan(db, "s1", "completed")).toBe(true);
    expect(await endScan(db, "s1", "canceled")).toBe(false);
    expect(state("s1")).toBe("completed");
    const events = await eventsAfter(db, "s1", 0);
    expect(events.at(-1)).toMatchObject({ type: "done", state: "completed", answered: 1, gaps: 1 });
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
  });

  it("a cancel that comes first wins over a finish that comes second, and keeps what was finished", async () => {
    await make();
    await appendEvent(db, "s1", "part:0", { type: "part", part: answered(0) });
    expect(await endScan(db, "s1", "canceled")).toBe(true);
    expect(await endScan(db, "s1", "completed")).toBe(false);
    expect(state("s1")).toBe("canceled");
    expect(await partsOf(db, "s1")).toHaveLength(1);
  });
});

describe("a scan that stopped moving", () => {
  const age = (id: string, minutes: number) => sql.prepare("UPDATE litscans SET updated_at = datetime('now', ?) WHERE id = ?").run(`-${minutes} minutes`, id);

  it("is ended as failed once it has been quiet for twelve minutes, and not before", async () => {
    await make();
    age("s1", 5);
    expect(await failIfStale(db, "s1")).toBe(false);
    expect(state("s1")).toBe("running");
    age("s1", 13);
    expect(await failIfStale(db, "s1")).toBe(true);
    expect(state("s1")).toBe("failed");
    expect((await eventsAfter(db, "s1", 0)).at(-1)).toMatchObject({ type: "done", state: "failed" });
    expect(await failIfStale(db, "s1")).toBe(false);
  });

  it("every event moves the clock, so a scan that is working is never called failed", async () => {
    await make();
    age("s1", 13);
    await appendEvent(db, "s1", "w:0", { type: "worker", idx: 0, stage: "reading" });
    expect(await failIfStale(db, "s1")).toBe(false);
  });

  it("a stale scan no longer counts as the one that is running (so the person can start another)", async () => {
    await make();
    expect(await runningScan(db, "u1")).toBe("s1");
    age("s1", 13);
    expect(await runningScan(db, "u1")).toBeNull();
    expect(await runningScan(db, "u2")).toBeNull();
  });
});

describe("what the page reads", () => {
  it("is the events folded together, in the plan's order, with the dates as ISO times", async () => {
    await make();
    await appendEvent(db, "s1", "w:1:searching", { type: "worker", idx: 1, stage: "searching" });
    await appendEvent(db, "s1", "part:0", { type: "part", part: gap(0) });
    const snap = await snapshotOf(db, (await getScan(db, "s1", "u1"))!);
    expect(snap).toMatchObject({ id: "s1", state: "running", total: 2, done: 1, stages: { 1: "searching" }, items, estimate: 4400, seq: 3 });
    expect(snap.parts).toEqual([gap(0)]);
    expect(new Date(snap.createdAt).toISOString()).toBe(snap.createdAt);
    expect(Date.parse(snap.expiresAt) - Date.parse(snap.createdAt)).toBe(24 * 3600 * 1000);
  });

  it("lists a person's scans of the last day, newest first, and nobody else's", async () => {
    await make("s1");
    sql.prepare("UPDATE litscans SET created_at = datetime('now', '-2 hours') WHERE id = 's1'").run();
    await make("s2");
    await make("s3", "u2");
    await appendEvent(db, "s2", "part:0", { type: "part", part: gap(0) });
    const list = await listScans(db, "u1");
    expect(list.map((s) => [s.id, s.done, s.total])).toEqual([["s2", 1, 2], ["s1", 0, 2]]);
    expect((await listScans(db, "u2")).map((s) => s.id)).toEqual(["s3"]);
  });

  it("does not show a scan past its day", async () => {
    await make();
    sql.prepare("UPDATE litscans SET expires_at = datetime('now', '-1 minutes')").run();
    expect(await getScan(db, "s1", "u1")).toBeNull();
    expect(await listScans(db, "u1")).toEqual([]);
  });
});

describe("removing, and the daily clean-up", () => {
  it("lets the owner delete a scan with its events, and nobody else", async () => {
    await make();
    expect(await deleteScan(db, "s1", "u2")).toBe(false);
    expect(await deleteScan(db, "s1", "u1")).toBe(true);
    expect(sql.prepare("SELECT COUNT(*) AS n FROM litscans").get()).toEqual({ n: 0 });
    expect(sql.prepare("SELECT COUNT(*) AS n FROM litscan_events").get()).toEqual({ n: 0 });
  });

  it("clean-up removes scans past their day with their events, and leaves the others", async () => {
    await make("old");
    await make("new");
    sql.prepare("UPDATE litscans SET expires_at = datetime('now', '-1 minutes') WHERE id = 'old'").run();
    for (const q of LITSCAN_PURGE_SQL) sql.prepare(q).run();
    expect(sql.prepare("SELECT id FROM litscans").all()).toEqual([{ id: "new" }]);
    expect(sql.prepare("SELECT DISTINCT scan_id FROM litscan_events").all()).toEqual([{ scan_id: "new" }]);
  });

  it("clean-up also drops the daily counters older than five weeks", async () => {
    sql.prepare("INSERT INTO litscan_daily (user_id, day, n) VALUES ('u1', date('now', '-40 days'), 2), ('u1', date('now'), 1)").run();
    for (const q of LITSCAN_PURGE_SQL) sql.prepare(q).run();
    expect(sql.prepare("SELECT COUNT(*) AS n FROM litscan_daily").get()).toEqual({ n: 1 });
  });
});

describe("the daily number of scans", () => {
  it("allows up to the cap and then refuses, per person and per day", async () => {
    for (let i = 0; i < 3; i++) expect(await takeScan(db, "u1", "2026-10-27", 3)).toBe(true);
    expect(await takeScan(db, "u1", "2026-10-27", 3)).toBe(false);
    expect(await takeScan(db, "u2", "2026-10-27", 3)).toBe(true);
    expect(await takeScan(db, "u1", "2026-10-28", 3)).toBe(true);
  });
  it("gives one back when a scan could not be started, and never goes below zero", async () => {
    await takeScan(db, "u1", "d", 1);
    expect(await takeScan(db, "u1", "d", 1)).toBe(false);
    await refundScan(db, "u1", "d");
    expect(await takeScan(db, "u1", "d", 1)).toBe(true);
    await refundScan(db, "u1", "d");
    await refundScan(db, "u1", "d");
    expect(sql.prepare("SELECT n FROM litscan_daily WHERE user_id = 'u1'").get()).toEqual({ n: 0 });
  });
});
