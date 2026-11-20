import { describe, expect, it } from "vitest";
import { INVITE_NOTE_MAX } from "./share";
import { buildInviteEmail, cleanInviteNote, escapeHtml, inviteLine } from "./invite-email";

/** The invitation e-mail's words and HTML (the Worker sends them, the Share dialog previews them). The message the binding gets is tested in apps/api docs/invite-mail.test.ts. */

const IN = { inviterName: "Asha", paperTitle: "Glaucoma screening", role: "viewer" as const, link: "https://sodhsetu.in/papers/x1", to: "ravi@uni.edu" };

describe("the invitation e-mail", () => {
  it("is a table layout at most 600 px wide, with a hidden preheader, light and dark colours, and no remote picture", () => {
    const m = buildInviteEmail(IN);
    expect(m.html).toContain('max-width:600px');
    expect(m.html).toContain('role="presentation"');
    expect(m.html).toContain('<meta name="color-scheme" content="light dark">');
    expect(m.html).toContain("@media (prefers-color-scheme:dark)");
    expect(m.html).toMatch(/<div style="display:none;[^"]*mso-hide:all[^"]*">You can view it\. Open it on Sodhsetu\./);
    expect(m.html).not.toMatch(/src="https?:/);
    expect(m.html).not.toMatch(/<script/i);
  });

  it("the preheader starts with the note when there is one", () => {
    expect(buildInviteEmail({ ...IN, note: "Have a look before Monday" }).preheader).toBe("“Have a look before Monday” You can view it.");
  });

  it("the plain text says what the HTML says, without any markup", () => {
    const m = buildInviteEmail({ ...IN, note: "Two\nlines" });
    expect(m.text).not.toMatch(/<[a-z]/i);
    expect(m.text).toBe(
      [
        "Asha shared a paper with you on Sodhsetu",
        "",
        "“Glaucoma screening”",
        "You can view it.",
        "",
        "Asha wrote:",
        "> Two",
        "> lines",
        "",
        "Open the paper: https://sodhsetu.in/papers/x1",
        "Sign in with Google as ravi@uni.edu to open it.",
        "",
        "--",
        "You got this e-mail because Asha shared a paper with ravi@uni.edu on Sodhsetu. If you were not expecting it, you can ignore it: nothing happens unless you open the link.",
        "Sent by Sodhsetu (https://sodhsetu.in) on behalf of Asha.",
      ].join("\n"),
    );
  });

  it("an empty name or title has words of its own", () => {
    const m = buildInviteEmail({ ...IN, inviterName: "  ", paperTitle: "\u0000" });
    expect(m.subject).toBe("Someone shared “Untitled paper” with you");
  });

  it("the picture is named by the src it is given, at 128 px wide and its own proportion", () => {
    const m = buildInviteEmail({ ...IN, picture: { src: "data:image/jpeg;base64,AAAA", width: 300, height: 424 } });
    expect(m.html).toMatch(/<img src="data:image\/jpeg;base64,AAAA" width="128" height="181"/);
  });
});

describe("cleaning what the owner wrote", () => {
  it("a line: one line, no controls or direction marks, cut with an ellipsis", () => {
    expect(inviteLine("a\r\nb\tc\u0007 ‮d", 100)).toBe("a b c d");
    expect(inviteLine("abcdefghij", 5)).toBe("abcd…");
    expect(inviteLine(42, 5)).toBe("");
  });
  it("a note: line breaks kept, at most one empty line, controls gone, empty is null", () => {
    expect(cleanInviteNote("  one \r\n\r\n\r\n two\u0000 ")).toBe("one\n\ntwo");
    expect(cleanInviteNote(" \n ")).toBeNull();
    expect(cleanInviteNote(5)).toBeNull();
    expect(INVITE_NOTE_MAX).toBe(500);
  });
  it("HTML escaping covers text and attributes", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });
});
