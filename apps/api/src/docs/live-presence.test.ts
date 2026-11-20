import { describe, expect, it } from "vitest";
import { LIVE_RATE_PER_SECOND } from "@scholar/shared";
import { DROPS_BEFORE_CLOSE, SILENT_IDLE_MS, applyHere, freshBucket, freshConn, presenceOf, readConn, revokes, take, type LiveWho } from "./live-presence";

const who = (userId: string, name: string, role: LiveWho["role"] = "editor", colour = 1, via: LiveWho["via"] = "member", memberId: string | null = `m-${userId}`): LiveWho => ({ userId, name, role, colour, via, memberId });

describe("the presence reducer (docs/design/paper-live.md, 6)", () => {
  it("join: a new socket is on the paper, active", () => {
    const c = freshConn("c1", who("u1", "Ravi"), 1000);
    expect(presenceOf([c], 1000)).toEqual([{ id: "u1", name: "Ravi", initial: "R", colour: 1, role: "editor", view: "paper", page: null, notesPage: null, editingBlock: null, active: true, idle: false }]);
  });

  it("page change and editing: the place follows the last here", () => {
    let c = freshConn("c1", who("u1", "Ravi"), 0);
    c = applyHere(c, { t: "here", view: "paper", page: 3, active: true, idle: false }, 10);
    expect(presenceOf([c], 10)[0]).toMatchObject({ view: "paper", page: 3 });
    c = applyHere(c, { t: "here", view: "notes", notesPage: "p1", editingBlock: "b2", active: true, idle: false }, 20);
    expect(presenceOf([c], 20)[0]).toMatchObject({ view: "notes", page: null, notesPage: "p1", editingBlock: "b2" });
  });

  it("a Viewer or a Commenter is never shown typing in a block, whatever the page sent", () => {
    for (const role of ["viewer", "commenter"] as const) {
      const c = applyHere(freshConn("c", who("u", "Sara", role), 0), { t: "here", view: "notes", notesPage: "p1", editingBlock: "b1", active: true, idle: false }, 1);
      expect(c.editingBlock).toBeNull();
    }
    const owner = applyHere(freshConn("c", who("o", "Asha", "owner", 0, "owner", null), 0), { t: "here", view: "notes", notesPage: "p1", editingBlock: "b1", active: true, idle: false }, 1);
    expect(owner.editingBlock).toBe("b1");
  });

  it("idle: the page's word, or a socket silent too long", () => {
    const c = applyHere(freshConn("c1", who("u1", "Ravi"), 0), { t: "here", view: "paper", active: false, idle: true }, 0);
    expect(presenceOf([c], 0)[0]).toMatchObject({ idle: true, active: false });
    const quiet = freshConn("c2", who("u2", "Eli"), 0);
    expect(presenceOf([quiet], SILENT_IDLE_MS + 1)[0]).toMatchObject({ idle: true, active: false });
  });

  it("leave: one entry a person, their windows folded; gone when the last goes", () => {
    const a = applyHere(freshConn("a", who("u1", "Ravi"), 0), { t: "here", view: "paper", page: 2, active: true, idle: false }, 5);
    const b = applyHere(freshConn("b", who("u1", "Ravi"), 0), { t: "here", view: "notes", notesPage: "p1", active: false, idle: false }, 9);
    const other = freshConn("c", who("u2", "Asha", "owner", 0, "owner", null), 0);
    const people = presenceOf([a, b, other], 10);
    expect(people.map((p) => p.id)).toEqual(["u2", "u1"]);
    expect(people[1]).toMatchObject({ view: "notes", notesPage: "p1", active: true });
    expect(presenceOf([other], 10).map((p) => p.id)).toEqual(["u2"]);
    expect(presenceOf([], 10)).toEqual([]);
  });

  it("a window typing in a block wins over a later one that only reads", () => {
    const typing = applyHere(freshConn("a", who("u1", "Ravi"), 0), { t: "here", view: "notes", notesPage: "p1", editingBlock: "b9", active: true, idle: false }, 5);
    const reading = applyHere(freshConn("b", who("u1", "Ravi"), 0), { t: "here", view: "paper", page: 7, active: true, idle: false }, 9);
    expect(presenceOf([typing, reading], 10)[0]).toMatchObject({ editingBlock: "b9", notesPage: "p1" });
  });

  it("an attachment of the wrong shape is no connection", () => {
    expect(readConn(null)).toBeNull();
    expect(readConn({ userId: 1 })).toBeNull();
    expect(readConn(freshConn("c", who("u", "x"), 0))).not.toBeNull();
  });
});

describe("which sockets an access change closes", () => {
  const owner = freshConn("o", who("o", "Asha", "owner", 0, "owner", null), 0);
  const member = freshConn("m", who("u1", "Ravi"), 0);
  const link = freshConn("l", who("u2", "Chen", "commenter", 3, "link", null), 0);
  it("a person removed (by row), a person who left (by account), the link, sharing stopped, the paper deleted", () => {
    expect([owner, member, link].map((c) => revokes(c, { memberId: "m-u1" }))).toEqual([false, true, false]);
    expect([owner, member, link].map((c) => revokes(c, { userId: "u2" }))).toEqual([false, false, true]);
    expect([owner, member, link].map((c) => revokes(c, { userId: "o" }))).toEqual([false, false, false]);
    expect([owner, member, link].map((c) => revokes(c, { via: "link" }))).toEqual([false, false, true]);
    expect([owner, member, link].map((c) => revokes(c, { via: "others" }))).toEqual([false, true, true]);
    expect([owner, member, link].map((c) => revokes(c, { via: "all" }))).toEqual([true, true, true]);
  });
});

describe("the rate limit: 20 a second per socket", () => {
  it("takes 20 at once, drops the 21st, refills with time", () => {
    const b = freshBucket(0);
    for (let i = 0; i < LIVE_RATE_PER_SECOND; i++) expect(take(b, 0)).toBe("ok");
    expect(take(b, 0)).toBe("drop");
    expect(take(b, 50)).toBe("ok"); // 50 ms refills one
    expect(take(b, 50)).toBe("drop");
    expect(take(b, 1050)).toBe("ok");
  });
  it("closes a socket that keeps on past it", () => {
    const b = freshBucket(0);
    for (let i = 0; i < LIVE_RATE_PER_SECOND; i++) take(b, 0);
    let last = "";
    for (let i = 0; i < DROPS_BEFORE_CLOSE; i++) last = take(b, 0);
    expect(last).toBe("close");
  });
});
