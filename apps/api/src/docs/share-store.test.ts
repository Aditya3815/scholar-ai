import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_COMMENTS_PER_DOC, SHARE_INVITES_PER_DAY, SHARE_MAX_MEMBERS, SHARE_RESEND_MS } from "@scholar/shared";
import { testD1 } from "../test-d1";
import { deleteDocument } from "./routes";
import { forgetPersonStatements, shareExport } from "./service";
import { addComment, claimSend, deleteComment, invite, listComments, removeMember, resolveThread, sharedWith, shareSettings, updateShare } from "./share-store";

/** The limits of section 6, the Resend rule, comments, and what deleting does (docs/design/paper-share.md). */

let db: D1Database;
let sql: ReturnType<typeof testD1>["sql"];
const files = { delete: async () => {} } as unknown as R2Bucket;

beforeEach(() => {
  ({ db, sql } = testD1());
  sql.prepare("INSERT INTO users (id, email, email_verified, name) VALUES ('owner', 'owner@example.org', 1, 'Asha'), ('bo', 'bo@example.org', 1, 'Bo')").run();
  sql.prepare("INSERT INTO documents (id, user_id, title, filename, size_bytes) VALUES ('d1', 'owner', 'A paper', 'a.pdf', 10), ('d2', 'owner', 'Another', 'b.pdf', 10)").run();
  sql.prepare("INSERT INTO doc_notes (id, doc_id, page, quote) VALUES ('n1', 'd1', 1, 'a quote of some length')").run();
  sql.prepare(`INSERT INTO doc_notebook_pages (doc_id, id, title, position, blocks) VALUES ('d1', 'p1', 'Notes', 1, '[{"id":"b1","kind":"text","md":"hello"}]')`).run();
});

const ask = (email: string, extra: { docId?: string; count?: boolean } = {}, now?: number) =>
  invite(db, { docId: extra.docId ?? "d1", ownerId: "owner", ownerEmail: "owner@example.org", email, role: "viewer", count: extra.count }, now);

describe("people: the limits", () => {
  it(`${SHARE_MAX_MEMBERS} people a paper`, async () => {
    for (let i = 0; i < SHARE_MAX_MEMBERS; i++) expect((await ask(`p${i}@example.org`)).ok).toBe(true);
    expect(await ask("one-more@example.org")).toEqual({ ok: false, reason: "full" });
    // another paper has its own fifty
    expect((await ask("one-more@example.org", { docId: "d2" })).ok).toBe(true);
  });

  it(`${SHARE_INVITES_PER_DAY} invitations a day an owner; a removal does not give one back; a new day starts again`, async () => {
    const now = Date.parse("2026-11-18T10:00:00Z");
    sql.prepare("INSERT INTO share_daily (user_id, day, invites) VALUES ('owner', '2026-11-18', ?)").run(SHARE_INVITES_PER_DAY - 1);
    const last = await ask("last@example.org", {}, now);
    expect(last.ok).toBe(true);
    if (last.ok) await removeMember(db, "d1", last.member.id);
    expect(await ask("over@example.org", {}, now)).toEqual({ ok: false, reason: "daily" });
    // Undo of a removal is not counted
    expect((await ask("last@example.org", { count: false }, now)).ok).toBe(true);
    expect((await ask("over@example.org", {}, now + 86_400_000)).ok).toBe(true);
  });

  it("naming someone again changes the role and is not counted; the owner's own address is refused", async () => {
    await ask("bo@example.org");
    const again = await invite(db, { docId: "d1", ownerId: "owner", ownerEmail: "owner@example.org", email: "bo@example.org", role: "editor" });
    expect(again.ok && again.created === false && again.member.role === "editor").toBe(true);
    expect(sql.prepare("SELECT invites FROM share_daily").get()).toEqual({ invites: 1 });
    expect(await invite(db, { docId: "d1", ownerId: "owner", ownerEmail: "Owner@Example.org", email: "owner@example.org", role: "viewer" })).toEqual({ ok: false, reason: "self" });
  });

  it("an invitation is e-mailed once, and again (Resend) only an hour after", async () => {
    const r = await ask("bo@example.org");
    if (!r.ok) throw new Error("no");
    const t = Date.now();
    expect(await claimSend(db, "d1", r.member.id, t)).toBe(true);
    expect(await claimSend(db, "d1", r.member.id, t)).toBe(false);
    expect(await claimSend(db, "d1", r.member.id, t + SHARE_RESEND_MS - 60_000)).toBe(false);
    expect(await claimSend(db, "d1", r.member.id, t + SHARE_RESEND_MS + 60_000)).toBe(true);
  });

  it("the owner's dialog lists the people, with the name once they signed in; 'Shared with me' lists the paper for that person", async () => {
    await ask("bo@example.org");
    await updateShare(db, "d1", { linkMode: "anyone", linkRole: "commenter" });
    const before = await shareSettings(db, "d1", false);
    expect(before.members.map((m) => [m.email, m.joined, m.name])).toEqual([["bo@example.org", false, null]]);
    const mine = await sharedWith(db, "bo");
    expect(mine.map((p) => [p.docId, p.title, p.ownerName, p.role])).toEqual([["d1", "A paper", "Asha", "viewer"]]);
    expect((await shareSettings(db, "d1", true)).members[0]).toMatchObject({ joined: true, name: "Bo" });
    expect(before).toMatchObject({ linkMode: "anyone", linkRole: "commenter", link: false });
  });
});

describe("comments", () => {
  it("hang on a highlight or a block that exists; a reply joins its thread (one level); resolve; delete takes the replies", async () => {
    expect(await addComment(db, { docId: "d1", userId: "bo", anchor: "note:nope", parentId: null, body: "x" })).toEqual({ ok: false, reason: "anchor" });
    expect(await addComment(db, { docId: "d1", userId: "bo", anchor: "block:p1:nope", parentId: null, body: "x" })).toEqual({ ok: false, reason: "anchor" });
    expect(await addComment(db, { docId: "d1", userId: "bo", anchor: "elsewhere", parentId: null, body: "x" })).toEqual({ ok: false, reason: "anchor" });
    const root = await addComment(db, { docId: "d1", userId: "bo", anchor: "note:n1", parentId: null, body: "Is this the main result?" });
    const onBlock = await addComment(db, { docId: "d1", userId: "owner", anchor: "block:p1:b1", parentId: null, body: "Rewrite this" });
    if (!root.ok || !onBlock.ok) throw new Error("not added");
    const reply = await addComment(db, { docId: "d1", userId: "owner", anchor: "ignored", parentId: root.comment.id, body: "Yes" });
    const replyToReply = await addComment(db, { docId: "d1", userId: "bo", anchor: null, parentId: reply.ok ? reply.comment.id : "", body: "Thanks" });
    expect(reply.ok && reply.comment.anchor === "note:n1" && reply.comment.parentId === root.comment.id).toBe(true);
    expect(replyToReply.ok && replyToReply.comment.parentId === root.comment.id).toBe(true);
    await resolveThread(db, "d1", root.comment.id, true, "owner");
    const list = await listComments(db, "d1", "bo");
    expect(list.find((c) => c.id === root.comment.id)).toMatchObject({ resolved: true, mine: true, author: "Bo" });
    // a reply opens it again
    await addComment(db, { docId: "d1", userId: "bo", anchor: null, parentId: root.comment.id, body: "One more" });
    expect((await listComments(db, "d1", null)).find((c) => c.id === root.comment.id)?.resolved).toBe(false);
    await deleteComment(db, "d1", root.comment.id);
    expect((await listComments(db, "d1", null)).map((c) => c.id)).toEqual([onBlock.comment.id]);
  });

  it(`${MAX_COMMENTS_PER_DOC} a paper`, async () => {
    const insert = sql.prepare("INSERT INTO doc_comments (id, doc_id, anchor, user_id, body) VALUES (?, 'd1', 'note:n1', 'bo', 'x')");
    for (let i = 0; i < MAX_COMMENTS_PER_DOC; i++) insert.run(`c${i}`);
    expect(await addComment(db, { docId: "d1", userId: "bo", anchor: "note:n1", parentId: null, body: "one more" })).toEqual({ ok: false, reason: "full" });
  });
});

describe("deleting", () => {
  it("the paper removes its link, its people and its comments", async () => {
    await ask("bo@example.org");
    await updateShare(db, "d1", { linkMode: "anyone" });
    await addComment(db, { docId: "d1", userId: "bo", anchor: "note:n1", parentId: null, body: "hi" });
    await deleteDocument({ DB: db, FILES: files } as never, "owner", "d1");
    for (const t of ["doc_shares", "doc_members", "doc_comments"]) expect(sql.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE doc_id = 'd1'`).get(), t).toEqual({ n: 0 });
  });

  it("an invited person's account: the membership goes (a waiting invitation too), the comments stay by 'a former member'", async () => {
    await ask("bo@example.org");
    await ask("bo@example.org", { docId: "d2" });
    await sharedWith(db, "bo"); // matched: user_id set on both
    sql.prepare("UPDATE doc_members SET user_id = NULL WHERE doc_id = 'd2'").run(); // one still waiting for the address
    await addComment(db, { docId: "d1", userId: "bo", anchor: "note:n1", parentId: null, body: "kept" });
    await db.batch(forgetPersonStatements(db, "bo"));
    sql.prepare("DELETE FROM users WHERE id = 'bo'").run();
    expect(sql.prepare("SELECT COUNT(*) AS n FROM doc_members").get()).toEqual({ n: 0 });
    expect((await listComments(db, "d1", null))[0]).toMatchObject({ body: "kept", author: null });
  });

  it("the export: the owner's people and comments; a member's own comments", async () => {
    await ask("bo@example.org");
    await addComment(db, { docId: "d1", userId: "bo", anchor: "note:n1", parentId: null, body: "from Bo" });
    const owner = await shareExport(db, "owner");
    expect(owner.sharedPapers).toHaveLength(1);
    expect(owner.sharedPapers[0]).toMatchObject({ docId: "d1", generalAccess: "restricted", people: [{ email: "bo@example.org", role: "viewer" }], comments: [{ by: "Bo", text: "from Bo" }] });
    expect(owner.myCommentsOnSharedPapers).toEqual([]);
    const bo = await shareExport(db, "bo");
    expect(bo.sharedPapers).toEqual([]);
    expect(bo.myCommentsOnSharedPapers).toMatchObject([{ docId: "d1", text: "from Bo" }]);
  });
});

vi.mock("cloudflare:workers", () => ({ DurableObject: class {}, WorkflowEntrypoint: class {}, WorkerEntrypoint: class {}, RpcTarget: class {} }));
