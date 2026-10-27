import { beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { testD1 } from "../test-d1";
import { BATCH, MAX_DOIS_PER_RUN, dueDois, recheckRetractions } from "./retraction";
import { stubCrossrefCalls, stubCrossrefFetch } from "./retraction-stub";

let db: D1Database;
let sql: DatabaseSync;
const ENV = { CROSSREF_MAILTO: "test@example.com", fetch: stubCrossrefFetch };

const user = (id: string) => sql.prepare("INSERT INTO users (id, email) VALUES (?, ?)").run(id, `${id}@example.com`);
const save = (userId: string, doi: string | null, extra: Record<string, unknown> = {}) => {
  const id = doi ? `doi:${doi.toLowerCase()}` : `t:${Math.random().toString(36).slice(2)}`;
  const paper = { id, doi, title: `Paper ${doi ?? id}`, retracted: false, retractionSources: [], ...extra };
  sql.prepare("INSERT INTO library_items (user_id, paper_id, data) VALUES (?, ?, ?)").run(userId, id, JSON.stringify(paper));
  return id;
};
const state = (doi: string) => sql.prepare("SELECT state, checked_at, retracted_at FROM paper_retraction WHERE doi = ?").get(doi) as { state: string; checked_at: string; retracted_at: string | null } | undefined;
const alerts = (userId: string) => sql.prepare("SELECT paper_id, title, kind, seen_at FROM library_alerts WHERE user_id = ? ORDER BY paper_id").all(userId) as { paper_id: string; title: string; kind: string; seen_at: string | null }[];
const daysAgo = (doi: string, days: number) => sql.prepare("UPDATE paper_retraction SET checked_at = datetime('now', ?) WHERE doi = ?").run(`-${days} days`, doi);

beforeEach(() => {
  ({ db, sql } = testD1());
  user("u1");
  user("u2");
  stubCrossrefCalls.length = 0;
});

describe("which saved papers are due for a look", () => {
  it("lists a DOI once however many people saved it and however it was spelled", async () => {
    save("u1", "10.1/Same");
    save("u2", "10.1/SAME");
    expect(await dueDois(db)).toEqual(["10.1/same"]);
  });

  it("leaves out papers without a DOI, a DOI with a comma (the service cannot take it), and papers saved already marked as retracted", async () => {
    save("u1", null);
    save("u1", "10.1/a,b");
    save("u1", "10.1/known-bad", { retracted: true });
    save("u1", "10.1/fine");
    expect(await dueDois(db)).toEqual(["10.1/fine"]);
  });

  it("asks again only after a week, and never about one already known to be retracted", async () => {
    for (const d of ["10.1/new", "10.1/recent", "10.1/old", "10.1/gone"]) save("u1", d);
    sql.exec("INSERT INTO paper_retraction (doi, state) VALUES ('10.1/recent', 'clear'), ('10.1/old', 'clear'), ('10.1/gone', 'retracted')");
    daysAgo("10.1/recent", 6);
    daysAgo("10.1/old", 8);
    daysAgo("10.1/gone", 30);
    expect(await dueDois(db)).toEqual(["10.1/new", "10.1/old"]); // never-checked first, then the longest waiting
  });

  it("takes at most the limit it is given, never-checked first", async () => {
    for (let i = 0; i < 5; i++) save("u1", `10.1/p${i}`);
    expect(await dueDois(db, 3)).toHaveLength(3);
    expect(MAX_DOIS_PER_RUN).toBeGreaterThanOrEqual(BATCH);
  });
});

describe("the re-check", () => {
  it("records clear papers, and a retracted one with a notice for everyone who saved it", async () => {
    const mine = save("u1", "10.1/fine");
    const a = save("u1", "10.5555/retracted.1");
    const b = save("u2", "10.5555/RETRACTED.1"); // spelled differently
    save("u2", "10.1/also-fine");
    const out = await recheckRetractions(db, ENV);
    expect(out).toEqual({ checked: 3, retracted: 1, unknown: 0, alerts: 2 });
    expect(state("10.1/fine")?.state).toBe("clear");
    expect(state("10.5555/retracted.1")?.state).toBe("retracted");
    expect(state("10.5555/retracted.1")?.retracted_at).toBeTruthy();
    expect(alerts("u1")).toEqual([{ paper_id: a, title: "Paper 10.5555/retracted.1", kind: "retracted", seen_at: null }]);
    expect(alerts("u2").map((x) => x.paper_id)).toEqual([b]);
    expect(alerts("u1").some((x) => x.paper_id === mine)).toBe(false);
  });

  it("makes no second notice and no second request when it runs again the same day", async () => {
    save("u1", "10.5555/retracted.2");
    await recheckRetractions(db, ENV);
    const calls = stubCrossrefCalls.length;
    const again = await recheckRetractions(db, ENV);
    expect(again).toEqual({ checked: 0, retracted: 0, unknown: 0, alerts: 0 });
    expect(stubCrossrefCalls.length).toBe(calls);
    expect(alerts("u1")).toHaveLength(1);
  });

  it("does not notify someone who saved the paper after it was marked retracted, nor change what anyone saved", async () => {
    save("u1", "10.5555/retracted.3", { retracted: true });
    const before = sql.prepare("SELECT data FROM library_items").all();
    await recheckRetractions(db, ENV);
    expect(alerts("u1")).toHaveLength(0);
    expect(sql.prepare("SELECT data FROM library_items").all()).toEqual(before);
  });

  it("notices a paper that was clear a week ago and has been retracted since, once, and keeps the date it was first seen", async () => {
    const id = save("u1", "10.5555/retracted.4");
    sql.exec("INSERT INTO paper_retraction (doi, state) VALUES ('10.5555/retracted.4', 'clear')");
    daysAgo("10.5555/retracted.4", 9);
    expect((await recheckRetractions(db, ENV)).alerts).toBe(1);
    const first = state("10.5555/retracted.4")?.retracted_at;
    expect(first).toBeTruthy();
    expect(alerts("u1").map((x) => x.paper_id)).toEqual([id]);
    // a later run does not touch it (retracted is final until someone says otherwise) and the date stays
    sql.exec("UPDATE paper_retraction SET checked_at = datetime('now', '-30 days')");
    await recheckRetractions(db, ENV);
    expect(state("10.5555/retracted.4")?.retracted_at).toBe(first);
    expect(alerts("u1")).toHaveLength(1);
  });

  it("a DOI the service rejects is marked unknown alone: the rest of its batch is checked, and it is not asked about again for a week", async () => {
    for (const d of ["10.1/a", "10.1/b", "10.5555/reject.1", "10.1/c", "10.5555/retracted.5"]) save("u1", d);
    const out = await recheckRetractions(db, ENV);
    expect(out).toMatchObject({ checked: 5, retracted: 1, unknown: 1 });
    expect(state("10.5555/reject.1")?.state).toBe("unknown");
    expect(state("10.1/c")?.state).toBe("clear");
    expect(state("10.5555/retracted.5")?.state).toBe("retracted");
    expect(await dueDois(db)).toEqual([]);
  });

  it("stops when the service is down, keeping what earlier batches found, and does not mark the rest (tomorrow's run takes them)", async () => {
    for (let i = 0; i < BATCH; i++) save("u1", `10.1/first${String(i).padStart(2, "0")}`);
    save("u1", "10.9/zzz-outage"); // sorts after the others: it lands in the second batch
    await expect(recheckRetractions(db, ENV)).rejects.toThrow(/HTTP 503/);
    expect(state("10.1/first00")?.state).toBe("clear");
    expect(state("10.9/zzz-outage")).toBeUndefined();
    expect(await dueDois(db)).toEqual(["10.9/zzz-outage"]);
  });

  it("asks the service in batches, not once for each paper", async () => {
    for (let i = 0; i < BATCH + 5; i++) save("u1", `10.1/n${String(i).padStart(3, "0")}`);
    await recheckRetractions(db, ENV);
    expect(stubCrossrefCalls.map((c) => c.length)).toEqual([BATCH, 5]);
  });
});

describe("the schema", () => {
  it("holds no person in the shared table", () => {
    const cols = (sql.prepare("SELECT name FROM pragma_table_info('paper_retraction')").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(["doi", "state", "checked_at", "retracted_at"]);
  });

  it("refuses a state the code does not know", () => {
    expect(() => sql.exec("INSERT INTO paper_retraction (doi, state) VALUES ('10.1/x', 'maybe')")).toThrow();
  });
});
