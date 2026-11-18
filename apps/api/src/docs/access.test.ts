import { beforeEach, describe, expect, it } from "vitest";
import { SHARE_TOKEN } from "@scholar/shared";
import { testD1 } from "../test-d1";
import { sha256Hex } from "../hash";
import { linkTokenHash, newLinkToken, resolveAccess, sameHash } from "./access";
import { makeLink, removeMember, updateShare, invite, stopSharing } from "./share-store";

/** The one gate (docs/design/paper-share.md, 2 and 6): every role, an expired link, a reset token, a removed person, the switch. */

const DOC = { id: "d1", user_id: "owner" };
let db: D1Database;
let sql: ReturnType<typeof testD1>["sql"];
const ON = { SHARE: "on" };

function people() {
  const add = (id: string, email: string | null, verified = 1) => sql.prepare("INSERT INTO users (id, email, email_verified, name) VALUES (?, ?, ?, ?)").run(id, email, verified, id);
  add("owner", "owner@example.org");
  add("ed", "ed@example.org");
  add("co", "co@example.org");
  add("vi", "vi@example.org");
  add("pending", "late@example.org");
  add("unverified", "sneaky@example.org", 0);
  add("orcid", null, 0);
  add("stranger", "stranger@example.org");
  sql.prepare("INSERT INTO documents (id, user_id, title, filename, size_bytes) VALUES ('d1', 'owner', 'A paper', 'a.pdf', 10)").run();
}

async function member(email: string, role: "viewer" | "commenter" | "editor") {
  const r = await invite(db, { docId: "d1", ownerId: "owner", ownerEmail: "owner@example.org", email, role });
  if (!r.ok) throw new Error(r.reason);
  return r.member;
}
const roleOf = async (userId: string | null, linkToken: string | null = null, env: Record<string, string> = ON) => (await resolveAccess({ DB: db, ...env } as never, { doc: DOC, user: userId ? { id: userId } : null, linkToken }))?.role ?? null;

beforeEach(() => {
  ({ db, sql } = testD1());
  people();
});

describe("the link token", () => {
  it("is 32 random bytes in base64url: 43 characters, different every time", () => {
    const a = newLinkToken();
    const b = newLinkToken();
    expect(a).toMatch(SHARE_TOKEN);
    expect(a).toHaveLength(43);
    expect(a).not.toBe(b);
  });

  it("is stored only as its SHA-256", async () => {
    const { token } = await makeLink(db, "d1", 30);
    const row = sql.prepare("SELECT * FROM doc_shares WHERE doc_id = 'd1'").get() as Record<string, unknown>;
    expect(Object.values(row)).not.toContain(token);
    expect(row.token_hash).toBe(await sha256Hex(token));
    expect(JSON.stringify(sql.prepare("SELECT * FROM doc_shares").all())).not.toContain(token);
  });

  it("is compared in constant time (same answer as ===, whatever the lengths)", async () => {
    const h = await linkTokenHash("x".repeat(43));
    expect(sameHash(h, h)).toBe(true);
    expect(sameHash(h, h.slice(0, -1) + (h.endsWith("0") ? "1" : "0"))).toBe(false);
    expect(sameHash(h, h.slice(1))).toBe(false);
    expect(sameHash("", "")).toBe(true);
  });
});

describe("accessTo: the role of each person", () => {
  it("the owner is the owner, whatever the switch says (as every paper route was before sharing)", async () => {
    expect(await roleOf("owner", null, {})).toBe("owner");
    expect(await roleOf("owner", null, ON)).toBe("owner");
  });

  it("named people have the role they were given", async () => {
    await member("ed@example.org", "editor");
    await member("co@example.org", "commenter");
    await member("vi@example.org", "viewer");
    expect(await roleOf("ed")).toBe("editor");
    expect(await roleOf("co")).toBe("commenter");
    expect(await roleOf("vi")).toBe("viewer");
    expect(await roleOf("stranger")).toBeNull();
    expect(await roleOf(null)).toBeNull();
  });

  it("an address with no account yet matches the first sign-in with it, and the match is kept", async () => {
    await member("late@example.org", "commenter");
    expect(sql.prepare("SELECT user_id FROM doc_members").get()).toEqual({ user_id: null });
    expect(await roleOf("pending")).toBe("commenter");
    expect(sql.prepare("SELECT user_id FROM doc_members").get()).toEqual({ user_id: "pending" });
    // the account's address changes later: the paper stays theirs to open
    sql.prepare("UPDATE users SET email = 'other@example.org' WHERE id = 'pending'").run();
    expect(await roleOf("pending")).toBe("commenter");
  });

  it("an address that is not verified never matches, and an ORCID account (no address) cannot", async () => {
    await member("sneaky@example.org", "editor");
    expect(await roleOf("unverified")).toBeNull();
    expect(await roleOf("orcid")).toBeNull();
  });

  it("a person removed loses access on the next request; stop sharing removes everyone", async () => {
    const m = await member("ed@example.org", "editor");
    await member("vi@example.org", "viewer");
    expect(await roleOf("ed")).toBe("editor");
    await removeMember(db, "d1", m.id);
    expect(await roleOf("ed")).toBeNull();
    expect(await roleOf("vi")).toBe("viewer");
    await stopSharing(db, "d1");
    expect(await roleOf("vi")).toBeNull();
  });

  it("with SHARE off, or at dark for an owner who is not listed, nobody but the owner has a role", async () => {
    await member("ed@example.org", "editor");
    await updateShare(db, "d1", { linkMode: "anyone" });
    const { token } = await makeLink(db, "d1", 30);
    for (const env of [{}, { SHARE: "off" }, { SHARE: "shadow" }, { SHARE: "ON" }, { SHARE: "dark" }, { SHARE: "dark", SHARE_BETA_USERS: "ed someone" }]) {
      expect(await roleOf("ed", null, env), JSON.stringify(env)).toBeNull();
      expect(await roleOf(null, token, env), JSON.stringify(env)).toBeNull();
      expect(await roleOf("owner", null, env)).toBe("owner");
    }
    expect(await roleOf("ed", null, { SHARE: "dark", SHARE_BETA_USERS: "x, owner" })).toBe("editor");
  });
});

describe("accessTo: the link", () => {
  it("restricted: the link opens nothing; anyone: Viewer or Commenter, a visitor who is not signed in is a Viewer", async () => {
    const { token } = await makeLink(db, "d1", 30);
    expect(await roleOf(null, token)).toBeNull();
    expect(await roleOf("stranger", token)).toBeNull();
    await updateShare(db, "d1", { linkMode: "anyone", linkRole: "viewer" });
    expect(await roleOf(null, token)).toBe("viewer");
    expect(await roleOf("stranger", token)).toBe("viewer");
    await updateShare(db, "d1", { linkRole: "commenter" });
    expect(await roleOf(null, token)).toBe("viewer");
    expect(await roleOf("stranger", token)).toBe("commenter");
  });

  it("a wrong token opens nothing, and a member with the link keeps the higher role", async () => {
    await updateShare(db, "d1", { linkMode: "anyone", linkRole: "commenter" });
    const { token } = await makeLink(db, "d1", 30);
    expect(await roleOf(null, newLinkToken())).toBeNull();
    await member("vi@example.org", "viewer");
    await member("ed@example.org", "editor");
    expect(await roleOf("vi", token)).toBe("commenter");
    expect(await roleOf("ed", token)).toBe("editor");
  });

  it("reset: the old link stops at once, the new one works", async () => {
    await updateShare(db, "d1", { linkMode: "anyone" });
    const old = (await makeLink(db, "d1", 30)).token;
    const fresh = (await makeLink(db, "d1", 30)).token;
    expect(await roleOf(null, old)).toBeNull();
    expect(await roleOf(null, fresh)).toBe("viewer");
  });

  it("expired: it stops; 'until stopped' has no end; switching back to restricted stops it", async () => {
    await updateShare(db, "d1", { linkMode: "anyone" });
    const { token } = await makeLink(db, "d1", 7);
    expect(await roleOf(null, token)).toBe("viewer");
    sql.prepare("UPDATE doc_shares SET expires_at = datetime('now', '-1 minute')").run();
    expect(await roleOf(null, token)).toBeNull();
    await updateShare(db, "d1", { expiry: null });
    expect(await roleOf(null, token)).toBe("viewer");
    await updateShare(db, "d1", { linkMode: "restricted" });
    expect(await roleOf(null, token)).toBeNull();
  });

  it("an Editor link cannot be stored by the gate's reading: a link_role of editor counts as no link", async () => {
    await updateShare(db, "d1", { linkMode: "anyone" });
    const { token } = await makeLink(db, "d1", 30);
    sql.prepare("UPDATE doc_shares SET link_role = 'editor'").run();
    expect(await roleOf("stranger", token)).toBeNull();
  });
});
