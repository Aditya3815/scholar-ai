import { describe, expect, it } from "vitest";
import { findAccount, parseAccountRef } from "./accounts";

describe("parseAccountRef", () => {
  it("reads an e-mail address, trimmed and lower-cased", () => {
    expect(parseAccountRef("  Meera.Nair@Example.EDU ")).toEqual({ kind: "email", value: "meera.nair@example.edu" });
    expect(parseAccountRef("a+tag@sub.example.co.in")).toEqual({ kind: "email", value: "a+tag@sub.example.co.in" });
  });

  it("reads an ORCID iD, with a check digit X, in any case, or as a link", () => {
    expect(parseAccountRef("0000-0002-1825-0097")).toEqual({ kind: "orcid", value: "0000-0002-1825-0097" });
    expect(parseAccountRef(" 0000-0002-9079-593x ")).toEqual({ kind: "orcid", value: "0000-0002-9079-593X" });
    expect(parseAccountRef("https://orcid.org/0000-0002-1825-0097")).toEqual({ kind: "orcid", value: "0000-0002-1825-0097" });
    expect(parseAccountRef("http://www.orcid.org/0000-0002-1825-0097/")).toEqual({ kind: "orcid", value: "0000-0002-1825-0097" });
  });

  it("refuses what is neither: empty, too short, too long, names, a user id, several addresses, an address with a comment", () => {
    for (const bad of ["", "   ", "abc", "Meera Nair", "meera@", "@example.edu", "meera@example", "a@b.c", "x".repeat(250) + "@example.edu", "a@example.edu, b@example.edu", "a@example.edu b@example.edu", "<a@example.edu>", "0000-0002-1825", "0000-0002-1825-009", "https://evil.example/0000-0002-1825-0097"]) {
      expect(parseAccountRef(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("refuses anything that is not a string", () => {
    for (const bad of [null, undefined, 42, {}, [], ["a@example.edu"], true]) expect(parseAccountRef(bad)).toBeNull();
  });

  it("does not let SQL or wildcards through as a lookup value", () => {
    expect(parseAccountRef("a@example.edu' OR '1'='1")).toBeNull();
    expect(parseAccountRef("%@example.edu")).toEqual({ kind: "email", value: "%@example.edu" }); // bound as a parameter and compared with =, so % is just a character
  });
});

/** The statement and value that findAccount sends, answered from a one-row table. */
function fakeDb(rows: { id: string; role: string; email?: string; orcid?: string; deleted?: boolean }[]) {
  const seen: { sql: string; value: unknown }[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (value: unknown) => ({
        first: async () => {
          seen.push({ sql, value });
          const r = rows.find((x) => !x.deleted && (/lower\(email\)/.test(sql) ? x.email?.toLowerCase() === value : x.orcid === value));
          return r ? { id: r.id, role: r.role } : null;
        },
      }),
    }),
  } as unknown as D1Database;
  return { db, seen };
}

describe("findAccount", () => {
  const rows = [
    { id: "u1", role: "scholar", email: "Meera@Example.edu" },
    { id: "u2", role: "professor", orcid: "0000-0002-1825-0097" },
    { id: "u3", role: "scholar", email: "gone@example.edu", deleted: true },
    { id: "u4", role: "admin", email: "ops@example.edu" },
  ];

  it("finds by e-mail whatever the case of what is stored, and by ORCID iD", async () => {
    const { db } = fakeDb(rows);
    expect(await findAccount(db, { kind: "email", value: "meera@example.edu" })).toEqual({ id: "u1", role: "scholar" });
    expect(await findAccount(db, { kind: "orcid", value: "0000-0002-1825-0097" })).toEqual({ id: "u2", role: "professor" });
  });

  it("reports the role, so that an admin can be refused", async () => {
    expect((await findAccount(fakeDb(rows).db, { kind: "email", value: "ops@example.edu" }))?.role).toBe("admin");
  });

  it("finds nothing for an unknown address, and nothing for an account already deleted", async () => {
    const { db } = fakeDb(rows);
    expect(await findAccount(db, { kind: "email", value: "nobody@example.edu" })).toBeNull();
    expect(await findAccount(db, { kind: "email", value: "gone@example.edu" })).toBeNull();
  });

  it("looks only at accounts that are not deleted, and passes the value as a parameter", async () => {
    const { db, seen } = fakeDb(rows);
    await findAccount(db, { kind: "email", value: "x@example.edu" });
    await findAccount(db, { kind: "orcid", value: "0000-0002-1825-0097" });
    expect(seen.every((s) => /deleted_at IS NULL/.test(s.sql) && !s.sql.includes("example.edu") && !s.sql.includes("0000-"))).toBe(true);
  });
});
