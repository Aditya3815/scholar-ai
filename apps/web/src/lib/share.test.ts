import { beforeEach, describe, expect, it } from "vitest";
import { fakeNet, json, offline, problem, type Net } from "../test/fake-net";
import * as share from "./share";

/**
 * Sharing's requests (docs/design/paper-share.md), as they were before the one browser client (docs/design/untangle.md, F9): every call goes to /api/v1/share with the person's cookies, a
 * body as JSON (Content-Type only when there is one), a 204 resolves with nothing, and a refusal says the server's title and detail, or "The service answered <status>" without one.
 */

let net: Net;
beforeEach(() => {
  net = fakeNet();
});

const sent = () => net.calls.map((c) => [c.method, c.url, c.headers["content-type"] ?? null, c.body, c.credentials]);
const failureOf = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as { status?: number; message: string });

describe("the share routes", () => {
  it("sends each change to its address with its method and JSON body", async () => {
    await share.fetchShare("d1");
    await share.changeShare("d1", { linkMode: "anyone" as never });
    await share.resetLink("d1", "week" as never);
    await share.stopSharing("d1");
    await share.inviteMember("d1", "a@b.c", "viewer" as never);
    await share.inviteMember("d1", "a@b.c", "editor" as never, { restore: true });
    await share.changeMember("d1", "m1", "commenter" as never);
    await share.removeMember("d1", "m1");
    await share.resendInvite("d1", "m1");
    await share.inviteMember("d1", "a@b.c", "viewer" as never, { note: "Have a look", picture: "AAAA" });
    await share.resendInvite("d1", "m1", "BBBB");
    await share.fetchSharedWithMe();
    await share.leaveShared("d1");
    await share.openLink("tok");
    await share.fetchComments("d1");
    await share.addComment("d1", { anchor: "a", body: "hi" });
    await share.editComment("d1", "c1", { resolved: true });
    await share.deleteComment("d1", "c1");
    const J = "application/json";
    expect(sent()).toEqual([
      ["GET", "/api/v1/share/papers/d1", null, null, "same-origin"],
      ["PUT", "/api/v1/share/papers/d1", J, { linkMode: "anyone" }, "same-origin"],
      ["POST", "/api/v1/share/papers/d1/link", J, { expiry: "week" }, "same-origin"],
      ["DELETE", "/api/v1/share/papers/d1", null, null, "same-origin"],
      ["POST", "/api/v1/share/papers/d1/members", J, { email: "a@b.c", role: "viewer" }, "same-origin"],
      ["POST", "/api/v1/share/papers/d1/members", J, { email: "a@b.c", role: "editor", restore: true }, "same-origin"],
      ["PATCH", "/api/v1/share/papers/d1/members/m1", J, { role: "commenter" }, "same-origin"],
      ["DELETE", "/api/v1/share/papers/d1/members/m1", null, null, "same-origin"],
      ["POST", "/api/v1/share/papers/d1/members/m1/resend", J, {}, "same-origin"],
      ["POST", "/api/v1/share/papers/d1/members", J, { email: "a@b.c", role: "viewer", note: "Have a look", picture: "AAAA" }, "same-origin"],
      ["POST", "/api/v1/share/papers/d1/members/m1/resend", J, { picture: "BBBB" }, "same-origin"],
      ["GET", "/api/v1/share/with-me", null, null, "same-origin"],
      ["DELETE", "/api/v1/share/with-me/d1", null, null, "same-origin"],
      ["POST", "/api/v1/share/open", J, { token: "tok" }, "same-origin"],
      ["GET", "/api/v1/share/papers/d1/comments", null, null, "same-origin"],
      ["POST", "/api/v1/share/papers/d1/comments", J, { anchor: "a", body: "hi" }, "same-origin"],
      ["PATCH", "/api/v1/share/papers/d1/comments/c1", J, { resolved: true }, "same-origin"],
      ["DELETE", "/api/v1/share/papers/d1/comments/c1", null, null, "same-origin"],
    ]);
  });

  it("resolves with the reply's JSON, and with nothing for a 204", async () => {
    net.reply = () => json({ items: [{ docId: "d1" }] });
    expect(await share.fetchSharedWithMe()).toEqual({ items: [{ docId: "d1" }] });
    net.reply = () => new Response(null, { status: 204 });
    expect(await share.deleteComment("d1", "c1")).toBeUndefined();
  });

  it("says a refusal's title and detail, its title alone, or the status when it carried no problem", async () => {
    net.reply = () => problem(403, { type: "forbidden", title: "Only the owner can share this paper", detail: "Ask them" });
    expect(await failureOf(share.fetchShare("d1"))).toMatchObject({ status: 403, message: "Only the owner can share this paper. Ask them" });
    net.reply = () => problem(410, { type: "not_found", title: "This link has expired" });
    expect(await failureOf(share.openLink("t"))).toMatchObject({ status: 410, message: "This link has expired" });
    net.reply = () => problem(500, "oops");
    expect(await failureOf(share.fetchComments("d1"))).toMatchObject({ status: 500, message: "The service answered 500" });
  });

  it("lets a lost connection reject with fetch's own error", async () => {
    net.reply = offline;
    const e = await failureOf(share.fetchSharedWithMe());
    expect(e).toBeInstanceOf(TypeError);
  });
});
