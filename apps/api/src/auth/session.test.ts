import { describe, expect, it, vi } from "vitest";
import { testD1 } from "../test-d1";
import { SESSION_TTL_SECONDS, createSession, destroySession, userFromSession } from "./session";

function setup() {
  const t = testD1();
  t.sql.prepare("INSERT INTO users (id, email, name, orcid, role) VALUES ('u1', 'a@example.org', 'Asha', '0000-0002-1825-0097', 'scholar')").run();
  t.sql.prepare("INSERT INTO identities (provider, subject, user_id) VALUES ('google', 'g-1', 'u1')").run();
  return t;
}

describe("userFromSession", () => {
  it("finds the person with their sign-in methods in ONE query (it runs on every request of a signed-in person)", async () => {
    const { db, sql } = setup();
    sql.prepare("INSERT INTO identities (provider, subject, user_id) VALUES ('orcid', 'o-1', 'u1')").run();
    const token = await createSession(db, "u1", "test");
    const prepare = vi.spyOn(db, "prepare");
    const user = await userFromSession(db, token);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(user).toMatchObject({ id: "u1", name: "Asha", email: "a@example.org", orcid: "0000-0002-1825-0097", role: "scholar" });
    expect([...user!.providers].sort()).toEqual(["google", "orcid"]);
  });
  it("a person with no sign-in method on record has an empty list, not a list with an empty word", async () => {
    const { db, sql } = setup();
    sql.prepare("DELETE FROM identities").run();
    const user = await userFromSession(db, await createSession(db, "u1", undefined));
    expect(user!.providers).toEqual([]);
  });
  it("a method is listed once however many identities of it there are", async () => {
    const { db, sql } = setup();
    sql.prepare("INSERT INTO identities (provider, subject, user_id) VALUES ('google', 'g-2', 'u1')").run();
    expect((await userFromSession(db, await createSession(db, "u1", undefined)))!.providers).toEqual(["google"]);
  });
  it("refuses a missing, short, long, unknown or expired token, and a person who was deleted", async () => {
    const { db, sql } = setup();
    for (const bad of [undefined, "", "short", "x".repeat(101), "y".repeat(43)]) expect(await userFromSession(db, bad)).toBeNull();
    const token = await createSession(db, "u1", undefined);
    sql.prepare("UPDATE sessions SET expires_at = datetime('now', '-1 seconds')").run();
    expect(await userFromSession(db, token)).toBeNull();
    const t2 = await createSession(db, "u1", undefined);
    sql.prepare("UPDATE users SET deleted_at = datetime('now') WHERE id = 'u1'").run();
    expect(await userFromSession(db, t2)).toBeNull();
  });
  it("slides the session only when it is a day old (a write on every request would be the busiest write of the database)", async () => {
    const { db, sql } = setup();
    const token = await createSession(db, "u1", undefined);
    const writes = () => (sql.prepare("SELECT last_seen_at, expires_at FROM sessions").get() as { last_seen_at: string; expires_at: string });
    const before = writes();
    await userFromSession(db, token);
    expect(writes()).toEqual(before);
    sql.prepare("UPDATE sessions SET last_seen_at = datetime('now', '-2 days'), expires_at = datetime('now', '+1 day')").run();
    await userFromSession(db, token);
    const after = writes();
    expect(after.last_seen_at > before.last_seen_at.slice(0, 10)).toBe(true);
    expect(Date.parse(after.expires_at.replace(" ", "T") + "Z") - Date.now()).toBeGreaterThan((SESSION_TTL_SECONDS - 60) * 1000);
  });
  it("destroySession removes the session; a session without a token does nothing", async () => {
    const { db, sql } = setup();
    const token = await createSession(db, "u1", undefined);
    await destroySession(db, undefined);
    expect((sql.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n).toBe(1);
    await destroySession(db, token);
    expect(await userFromSession(db, token)).toBeNull();
  });
});
