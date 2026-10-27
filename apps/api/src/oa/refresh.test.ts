import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { OA_REFRESH_DAYS } from "@scholar/shared";
import { testD1 } from "../test-d1";
import { contentHashOf } from "./ingest";
import { claimRefresh, keepOld, markRefreshed } from "./store";

let db: D1Database;
let sql: DatabaseSync;
const DAY = 86_400_000;
const NOW = Date.parse("2026-10-28T12:00:00Z");
const sqlTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const paper = (key: string, status: string, readyDaysAgo: number | null, extra = "") =>
  sql.prepare(`INSERT INTO oa_papers (key, status, ready_at${extra ? ", " + extra.split("=")[0] : ""}) VALUES (?, ?, ?${extra ? ", ?" : ""})`).run(...([key, status, readyDaysAgo === null ? null : sqlTime(NOW - readyDaysAgo * DAY), ...(extra ? [extra.split("=")[1]] : [])] as never[]));
const get = (key: string) => sql.prepare("SELECT status, attempt, ready_at, refresh_at FROM oa_papers WHERE key = ?").get(key) as { status: string; attempt: number; ready_at: string | null; refresh_at: string | null };

beforeEach(() => {
  ({ db, sql } = testD1());
});

describe("which papers are fetched again", () => {
  it("only a paper that is ready and was read more than 180 days ago, and it gets the next try number", async () => {
    paper("old", "ready", OA_REFRESH_DAYS + 1);
    paper("fresh", "ready", 10);
    paper("working", "reading", OA_REFRESH_DAYS + 1);
    paper("never", "ready", null);
    expect(await claimRefresh(db, "fresh", NOW, OA_REFRESH_DAYS)).toBeNull();
    expect(await claimRefresh(db, "working", NOW, OA_REFRESH_DAYS)).toBeNull();
    expect(await claimRefresh(db, "never", NOW, OA_REFRESH_DAYS)).toBeNull();
    expect(await claimRefresh(db, "nope", NOW, OA_REFRESH_DAYS)).toBeNull();
    expect(await claimRefresh(db, "old", NOW, OA_REFRESH_DAYS)).toBe(1);
    expect(get("old")).toMatchObject({ status: "ready", attempt: 1 }); // it stays ready: it keeps answering
  });

  it("is claimed by one asker, and not again for an hour (a lost refresh is tried again then)", async () => {
    paper("old", "ready", 200);
    const [a, b] = await Promise.all([claimRefresh(db, "old", NOW, OA_REFRESH_DAYS), claimRefresh(db, "old", NOW, OA_REFRESH_DAYS)]);
    expect([a, b].filter((x) => x !== null)).toHaveLength(1);
    expect(await claimRefresh(db, "old", NOW + 30 * 60_000, OA_REFRESH_DAYS)).toBeNull();
    expect(await claimRefresh(db, "old", NOW + 61 * 60_000, OA_REFRESH_DAYS)).toBe(2);
  });
});

describe("what ends a refresh", () => {
  it("the same file: the paper is as fresh as a new reading, and nothing else changes", async () => {
    paper("old", "ready", 200);
    await claimRefresh(db, "old", NOW, OA_REFRESH_DAYS);
    await markRefreshed(db, "old", NOW);
    const r = get("old");
    expect(r).toMatchObject({ status: "ready", refresh_at: null, ready_at: sqlTime(NOW) });
    expect(await claimRefresh(db, "old", NOW + 2 * DAY, OA_REFRESH_DAYS)).toBeNull();
  });

  it("the new file could not be fetched: the copy that works stays, and is looked at again in thirty days, not at every question", async () => {
    paper("old", "ready", 200);
    await claimRefresh(db, "old", NOW, OA_REFRESH_DAYS);
    await keepOld(db, "old", NOW, OA_REFRESH_DAYS);
    expect(get("old")).toMatchObject({ status: "ready", refresh_at: null, ready_at: sqlTime(NOW - (OA_REFRESH_DAYS - 30) * DAY) });
    expect(await claimRefresh(db, "old", NOW + 29 * DAY, OA_REFRESH_DAYS)).toBeNull();
    expect(await claimRefresh(db, "old", NOW + 31 * DAY, OA_REFRESH_DAYS)).toBe(2);
  });

  it("a paper that is no longer ready (it is being read again) is left alone", async () => {
    paper("busy", "reading", 5);
    await keepOld(db, "busy", NOW, OA_REFRESH_DAYS);
    expect(get("busy").ready_at).toBe(sqlTime(NOW - 5 * DAY));
  });
});

describe("telling whether a file changed", () => {
  it("is the SHA-256 of its bytes, the same for text and for the bytes of that text", async () => {
    expect(await contentHashOf("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(await contentHashOf(new TextEncoder().encode("abc"))).toBe(await contentHashOf("abc"));
    expect(await contentHashOf("abd")).not.toBe(await contentHashOf("abc"));
  });
});
