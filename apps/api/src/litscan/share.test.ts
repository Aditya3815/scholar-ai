import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { LitscanItem, LitscanPart } from "@scholar/shared";
import { LITSCAN_MAX_SHARES } from "@scholar/shared";
import { SHARE_TOKEN, createShare, newToken, publicScan, revokeShare, shareOf } from "./share";
import { LITSCAN_PURGE_SQL, appendEvent, createScan, deleteScan, endScan, getScan } from "./store";
import { testD1 } from "../test-d1";

let db: D1Database;
let sql: DatabaseSync;
const items: LitscanItem[] = [{ question: "Q one?", searchQuery: "alpha beta" }, { question: "Q two?", searchQuery: "gamma delta" }];
const gap = (idx: number): LitscanPart => ({ idx, status: "gap", found: 0, reason: "nothing_found" });
const answered = (idx: number): LitscanPart => ({ idx, status: "answered", found: 3, text: "Claim [1].", sources: [{ n: 1, paperId: "doi:10.1/a", title: "T", year: 2020, doi: "10.1/a", authors: [], venue: null, url: null }], citations: [{ n: 1, paperId: "doi:10.1/a", sentenceNo: 2, sentence: "S." }] });
const make = async (id: string, userId = "u1", ended = true) => {
  await createScan(db, { id, userId, topic: "a topic of research", language: "en", items, estimate: 6000 });
  await appendEvent(db, id, "part:0", { type: "part", part: answered(0) });
  await appendEvent(db, id, "part:1", { type: "part", part: gap(1) });
  if (ended) await endScan(db, id, "completed");
  return (await getScan(db, id, userId))!;
};

beforeEach(() => {
  ({ db, sql } = testD1());
  sql.prepare("INSERT INTO users (id, email) VALUES ('u1', 'u1@example.com'), ('u2', 'u2@example.com')").run();
});

describe("a link to a scan", () => {
  it("is a long random token, a different one each time", () => {
    const a = newToken();
    expect(a).toMatch(SHARE_TOKEN);
    expect(newToken()).not.toBe(a);
  });

  it("can be made only for a scan that has ended", async () => {
    const running = await make("s1", "u1", false);
    expect(await createShare(db, running, "u1")).toEqual({ ok: false, reason: "running" });
    await endScan(db, "s1", "canceled");
    const ended = (await getScan(db, "s1", "u1"))!;
    expect((await createShare(db, ended, "u1")).ok).toBe(true);
  });

  it("gives the same link when it is asked for again, and one link a scan even when two clicks race", async () => {
    const scan = await make("s1");
    const [a, b] = await Promise.all([createShare(db, scan, "u1"), createShare(db, scan, "u1")]);
    expect(a.ok && b.ok && a.token === b.token).toBe(true);
    expect(sql.prepare("SELECT COUNT(*) AS n FROM litscan_shares").get()).toEqual({ n: 1 });
    expect(await shareOf(db, "s1")).toBe(a.ok ? a.token : null);
  });

  it(`is limited to ${LITSCAN_MAX_SHARES} at a time for a person (a link that has ended does not count)`, async () => {
    for (let i = 0; i < LITSCAN_MAX_SHARES; i++) expect((await createShare(db, await make(`s${i}`), "u1")).ok).toBe(true);
    const extra = await make("extra");
    expect(await createShare(db, extra, "u1")).toEqual({ ok: false, reason: "limit" });
    sql.prepare("UPDATE litscans SET expires_at = datetime('now', '-1 minutes') WHERE id = 's0'").run();
    expect((await createShare(db, extra, "u1")).ok).toBe(true);
    expect((await createShare(db, await make("other", "u2"), "u2")).ok).toBe(true);
  });
});

describe("what the link shows", () => {
  it("is the topic, the plan and the checked report, and nothing about the person or the scan's id", async () => {
    const scan = await make("s1");
    const r = await createShare(db, scan, "u1");
    if (!r.ok) throw new Error("no link");
    const pub = await publicScan(db, r.token);
    expect(pub).toMatchObject({ topic: "a topic of research", language: "en", state: "completed", total: 2 });
    expect(pub!.items).toEqual(items);
    expect(pub!.parts.map((p) => p.status)).toEqual(["answered", "gap"]);
    const text = JSON.stringify(pub);
    expect(text).not.toMatch(/u1|example\.com|"id"|"estimate"|user/);
    expect(Object.keys(pub!).sort()).toEqual(["createdAt", "expiresAt", "items", "language", "parts", "state", "topic", "total"]);
  });

  it("is not found for a wrong, malformed or turned-off link, or a scan past its day (all look the same)", async () => {
    const r = await createShare(db, await make("s1"), "u1");
    if (!r.ok) throw new Error("no link");
    expect(await publicScan(db, newToken())).toBeNull();
    expect(await publicScan(db, "short")).toBeNull();
    expect(await publicScan(db, `${r.token}x`)).toBeNull();
    expect(await publicScan(db, r.token)).not.toBeNull();
    sql.prepare("UPDATE litscans SET expires_at = datetime('now', '-1 minutes') WHERE id = 's1'").run();
    expect(await publicScan(db, r.token)).toBeNull();
  });

  it("stops at once when the owner turns it off, and only the owner can", async () => {
    const r = await createShare(db, await make("s1"), "u1");
    if (!r.ok) throw new Error("no link");
    expect(await revokeShare(db, "s1", "u2")).toBe(false);
    expect(await publicScan(db, r.token)).not.toBeNull();
    expect(await revokeShare(db, "s1", "u1")).toBe(true);
    expect(await publicScan(db, r.token)).toBeNull();
    expect(await revokeShare(db, "s1", "u1")).toBe(false);
  });
});

describe("the link goes with the scan", () => {
  it("when the owner deletes the scan", async () => {
    const r = await createShare(db, await make("s1"), "u1");
    if (!r.ok) throw new Error("no link");
    expect(await deleteScan(db, "s1", "u1")).toBe(true);
    expect(sql.prepare("SELECT COUNT(*) AS n FROM litscan_shares").get()).toEqual({ n: 0 });
    expect(await publicScan(db, r.token)).toBeNull();
  });

  it("in the daily clean-up", async () => {
    await createShare(db, await make("old"), "u1");
    await createShare(db, await make("new"), "u1");
    sql.prepare("UPDATE litscans SET expires_at = datetime('now', '-1 minutes') WHERE id = 'old'").run();
    for (const q of LITSCAN_PURGE_SQL) sql.prepare(q).run();
    expect(sql.prepare("SELECT scan_id FROM litscan_shares").all()).toEqual([{ scan_id: "new" }]);
  });
});
