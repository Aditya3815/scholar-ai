import { describe, expect, it, vi } from "vitest";
import { INVITE_PICTURE_CID, INVITE_PICTURE_MAX_BYTES } from "@scholar/shared";
import { INVITE_FROM, bindingMailer, inviteMessage, mailerFor, sentByStandIn, standInMailer } from "./invite-mail";
import { checkInvitePicture } from "./invite-picture";

/** The invitation e-mail (docs/design/paper-share.md, S4): what it says, what the binding is given, the picture's checks, and that nothing else is in it or in the logs. */

const MAIL = { to: "ravi@uni.edu", paperTitle: "Glaucoma screening", inviterName: "Aditya", role: "commenter" as const, link: "https://sodhsetu.in/papers/abc123" };

/** A JPEG's structure (what the Worker reads): SOI, APP0 (JFIF), optionally APP1 (Exif) and a comment, a frame header of the size given, a table, the scan, EOI. */
function fakeJpeg(o: { width?: number; height?: number; exif?: boolean; scan?: number; sof?: number } = {}): Uint8Array {
  const w = o.width ?? 300;
  const h = o.height ?? 388;
  const seg = (marker: number, body: number[]) => [0xff, marker, ((body.length + 2) >> 8) & 0xff, (body.length + 2) & 0xff, ...body];
  const text = (s: string) => Array.from(s, (ch) => ch.charCodeAt(0));
  const bytes = [
    0xff, 0xd8,
    ...seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ...(o.exif ? [...seg(0xe1, [...text("Exif"), 0, 0, ...text("GPS 28.6N 77.2E secret")]), ...seg(0xfe, text("a comment"))] : []),
    ...seg(0xdb, Array(65).fill(1)),
    ...seg(o.sof ?? 0xc0, [8, (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
    ...seg(0xc4, Array(20).fill(0)),
    ...seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]),
    ...Array(o.scan ?? 400).fill(0x55),
    0xff, 0xd9,
  ];
  return new Uint8Array(bytes);
}
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

describe("the invitation", () => {
  it("names the paper, who shared it, the role in plain words, the address to sign in with and the link, in plain text and in HTML", () => {
    const m = inviteMessage(MAIL);
    expect(m.subject).toBe("Aditya shared “Glaucoma screening” with you");
    for (const part of [m.text, m.html]) {
      expect(part).toContain("Glaucoma screening");
      expect(part).toContain("Aditya shared a paper with you");
      expect(part).toContain("You can view it and add comments.");
      expect(part).toContain("https://sodhsetu.in/papers/abc123");
      expect(part).toContain("ravi@uni.edu");
      expect(part).toContain("you can ignore it");
    }
    expect(m.html).toContain(">Open the paper</a>");
    expect(m.attachments).toBeUndefined();
    // without a picture: the page-shaped block, and no picture at all
    expect(m.html).not.toContain("<img");
  });

  it("each role in its own words", () => {
    expect(inviteMessage({ ...MAIL, role: "viewer" }).text).toContain("You can view it.");
    expect(inviteMessage({ ...MAIL, role: "editor" }).text).toContain("You can view it, add comments and edit its highlights and notes.");
  });

  it("the owner's note is quoted in both parts, line breaks kept (one empty line at most), and escaped", () => {
    const m = inviteMessage({ ...MAIL, note: "Please read section 3.\n\n\n\n<b>bold</b> & thanks" });
    expect(m.text).toContain("Aditya wrote:\n> Please read section 3.\n>\n> <b>bold</b> & thanks");
    expect(m.html).toContain("Please read section 3.<br><br>&lt;b&gt;bold&lt;/b&gt; &amp; thanks");
    expect(m.html).not.toContain("<b>bold");
  });

  it("escapes everything the owner wrote, and keeps the subject to one line", () => {
    const evil = '"><img src=x onerror=alert(1)><script>alert(1)</script>';
    const m = inviteMessage({ ...MAIL, paperTitle: `${evil}\r\nBcc: x@y.z`, inviterName: `Eve ${evil}`, note: evil });
    for (const bad of ["<script>", "<img src=x", "onerror=alert(1)>", '"><img']) expect(m.html).not.toContain(bad);
    expect(m.html).toContain("&lt;script&gt;");
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.text).not.toMatch(/\r/);
  });

  it("a link that is not http(s) never becomes one", () => {
    expect(inviteMessage({ ...MAIL, link: "javascript:alert(1)" }).html).not.toContain("javascript:");
  });

  it("a Hindi title stays as it is (the service encodes the subject header), with the direction marks taken out", () => {
    const m = inviteMessage({ ...MAIL, paperTitle: "ग्लूकोमा ‮जाँच", inviterName: "आदित्य" });
    expect(m.subject).toBe("आदित्य shared “ग्लूकोमा जाँच” with you");
    expect(m.html).toContain("ग्लूकोमा जाँच");
    expect(m.html).toContain('<meta charset="utf-8">');
  });

  it("a long title is cut in the subject with an ellipsis, and kept whole (to 200 characters) in the e-mail", () => {
    const long = "A randomised trial of ".repeat(8).trim();
    const m = inviteMessage({ ...MAIL, paperTitle: long });
    expect(m.subject.length).toBeLessThan(110);
    expect(m.subject).toContain("…”");
    expect(m.text).toContain(long);
  });

  it("with a picture: one inline JPEG part, and the HTML names it by its Content-ID, with alt text and its size", () => {
    const got = checkInvitePicture(b64(fakeJpeg()));
    if (!got.ok) throw new Error(got.reason);
    const m = inviteMessage({ ...MAIL, picture: got.picture });
    expect(m.attachments).toHaveLength(1);
    const a = m.attachments![0]!;
    expect(a).toMatchObject({ disposition: "inline", contentId: INVITE_PICTURE_CID, filename: "first-page.jpg", type: "image/jpeg" });
    expect(a.content).toBe(got.picture.bytes);
    expect(m.html).toContain(`src="cid:${INVITE_PICTURE_CID}"`);
    expect(m.html).toMatch(/<img [^>]*alt="The first page of “Glaucoma screening”"/);
    expect(m.html).toMatch(/<img [^>]*width="128" height="166"/);
    // no address of the paper's file anywhere
    expect(m.html).not.toMatch(/\/api\/|\.pdf|cover/);
  });

  it("is sent from invites@notify.sodhsetu.in through the binding, as the builder's fields", async () => {
    const send = vi.fn(async () => ({ messageId: "m1" }));
    expect(await bindingMailer({ send })(MAIL)).toBe(true);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ from: INVITE_FROM, to: "ravi@uni.edu", subject: expect.any(String), text: expect.any(String), html: expect.any(String) }));
    expect(INVITE_FROM).toEqual({ name: "Sodhsetu", email: "invites@notify.sodhsetu.in" });
  });

  it("a failure is false, and the log says the kind of error only: never the address, the paper, the note or the link", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const ok = await bindingMailer({ send: async () => { throw new TypeError(`bad ${MAIL.to} ${MAIL.link}`); } })({ ...MAIL, note: "a private note" });
    expect(ok).toBe(false);
    const said = JSON.stringify(log.mock.calls);
    expect(said).toContain("invite_mail_failed");
    for (const secret of [MAIL.to, MAIL.link, MAIL.paperTitle, "a private note"]) expect(said).not.toContain(secret);
    log.mockRestore();
  });

  it("local runs and tests use the stand-in, which keeps the message as the binding would get it; without a binding there is no mailer", async () => {
    expect(mailerFor({ ENABLE_DEV_ROUTES: "1", QA_STUB: "1" })).toBe(standInMailer);
    expect(mailerFor({})).toBeNull();
    expect(mailerFor({ EMAIL: { send: async () => ({ messageId: "x" }) } as never })).not.toBeNull();
    await standInMailer(MAIL);
    expect(sentByStandIn.at(-1)?.subject).toBe("Aditya shared “Glaucoma screening” with you");
  });
});

describe("the picture of the first page", () => {
  it("a JPEG of a page's size passes, its size read from the frame header (baseline and progressive)", () => {
    for (const sof of [0xc0, 0xc2]) expect(checkInvitePicture(b64(fakeJpeg({ sof })))).toMatchObject({ ok: true, picture: { width: 300, height: 388 } });
  });

  it("the metadata segments (Exif, comments) are taken out; the rest is passed on byte for byte", () => {
    const got = checkInvitePicture(b64(fakeJpeg({ exif: true })));
    if (!got.ok) throw new Error(got.reason);
    expect(Buffer.from(got.picture.bytes).toString("latin1")).not.toContain("GPS");
    expect(Buffer.from(got.picture.bytes).equals(Buffer.from(fakeJpeg()))).toBe(true);
  });

  it("refuses what is not base64, not a JPEG, cut short, too big or not the size of a page", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, ...Array(300).fill(0)]);
    const cases: [unknown, string][] = [
      [12, "not_text"],
      ["not base64!!", "not_base64"],
      ["data:image/jpeg;base64,/9j/", "not_base64"],
      [b64(png), "not_jpeg"],
      [b64(fakeJpeg().subarray(0, 300)), "not_jpeg"],
      [b64(fakeJpeg({ scan: INVITE_PICTURE_MAX_BYTES })), "too_big"],
      ["A".repeat(INVITE_PICTURE_MAX_BYTES * 2), "too_big"],
      [b64(fakeJpeg({ width: 2000, height: 2600 })), "bad_size"],
      [b64(fakeJpeg({ width: 40, height: 52 })), "bad_size"],
      [b64(fakeJpeg({ width: 300, height: 1200 })), "bad_size"],
    ];
    for (const [raw, reason] of cases) expect(checkInvitePicture(raw)).toEqual({ ok: false, reason });
  });

  it("a segment whose length runs past the end, or a scan before any frame header, is refused", () => {
    const bad = fakeJpeg();
    bad[4] = 0x7f; // APP0's length: far past the end
    expect(checkInvitePicture(b64(bad))).toEqual({ ok: false, reason: "bad_segment" });
    const noFrame = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 4, 0, 0, ...Array(200).fill(0x55), 0xff, 0xd9]);
    expect(checkInvitePicture(b64(noFrame))).toEqual({ ok: false, reason: "no_frame" });
  });
});
