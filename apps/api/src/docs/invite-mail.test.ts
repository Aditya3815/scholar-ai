import { describe, expect, it, vi } from "vitest";
import { INVITE_FROM, bindingMailer, inviteMessage, mailerFor, standInMailer } from "./invite-mail";

/** The invitation e-mail (docs/design/paper-share.md, S4): what it says, and that nothing else is in it or in the logs. */

const MAIL = { to: "ravi@uni.edu", paperTitle: "Glaucoma screening", inviterName: "Aditya", role: "commenter" as const, link: "https://sodhsetu.in/papers/abc123" };

describe("the invitation", () => {
  it("names the paper, who shared it, the role and the link, in plain text and in HTML", () => {
    const m = inviteMessage(MAIL);
    expect(m.subject).toBe('Aditya shared "Glaucoma screening" with you on Sodhsetu');
    for (const part of [m.text, m.html]) {
      expect(part).toContain("Glaucoma screening");
      expect(part).toContain("Aditya");
      expect(part).toContain("Can comment");
      expect(part).toContain("https://sodhsetu.in/papers/abc123");
      expect(part).toContain("Sign in with Google using this e-mail address");
    }
  });

  it("escapes what the owner wrote in HTML, and keeps a header to one line", () => {
    const m = inviteMessage({ ...MAIL, paperTitle: 'A <script>alert(1)</script> "title"\r\nBcc: x@y.z', inviterName: "Eve <eve@x>" });
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.subject).not.toMatch(/[\r\n]/);
  });

  it("is sent from invites@notify.sodhsetu.in through the binding", async () => {
    const send = vi.fn(async () => ({ messageId: "m1" }));
    expect(await bindingMailer({ send })(MAIL)).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: INVITE_FROM, to: "ravi@uni.edu", subject: expect.any(String), text: expect.any(String), html: expect.any(String) }));
    expect(INVITE_FROM).toEqual({ name: "Sodhsetu", email: "invites@notify.sodhsetu.in" });
  });

  it("a failure is false, and the log says the kind of error only: never the address, the paper or the link", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const ok = await bindingMailer({ send: async () => { throw new TypeError(`bad ${MAIL.to} ${MAIL.link}`); } })(MAIL);
    expect(ok).toBe(false);
    const said = JSON.stringify(log.mock.calls);
    expect(said).toContain("invite_mail_failed");
    for (const secret of [MAIL.to, MAIL.link, MAIL.paperTitle]) expect(said).not.toContain(secret);
    log.mockRestore();
  });

  it("local runs and tests use the stand-in; without a binding there is no mailer (the dialog copies the invite)", () => {
    expect(mailerFor({ ENABLE_DEV_ROUTES: "1", QA_STUB: "1" })).toBe(standInMailer);
    expect(mailerFor({})).toBeNull();
    expect(mailerFor({ EMAIL: { send: async () => ({}) } as never })).not.toBeNull();
  });
});
